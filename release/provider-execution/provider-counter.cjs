'use strict';
// Durable provider-request counter: an independent witness on its own volume, separate from the run ledger.
// Every upstream request is reserved here (fsynced, hash-chained) before the relay can send it. No bodies, headers,
// credentials, URLs or customer data are recorded: only route class, a reference hash, outcome class and timing.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const canonical=v=>v&&typeof v==='object'&&!Array.isArray(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const OUTCOMES=new Set(['ok','provider_http_4xx','provider_rate_limited','provider_http_5xx','pre_dispatch_connection_failure','post_dispatch_timeout_or_lost_response','malformed_provider_response','provider_transport_unknown']);
const GENESIS='0'.repeat(64);
const exhausted=()=>Object.assign(Error('provider_request_budget_exhausted'),{code:'provider_request_budget_exhausted'});
function routeClass(method,url){
 if(method==='POST'&&url==='/transaction/initialize')return 'initialize';
 if(method==='POST'&&url==='/refund')return 'refund';
 if(method==='GET')return 'read';
 return null;
}
function budgetFor(manifest){
 const b={initialize:manifest?.max_payment_initializations,refund:manifest?.max_refund_initializations,read:manifest?.max_provider_reads};
 if(!Object.values(b).every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('counter_budget_invalid');
 // Single-initialization runs get exactly one provider initialization and nothing else, per authorized run.
 if(manifest.execution_profile==='single-initialization-only'&&(b.initialize!==1||b.refund!==0||b.read!==0))throw Error('counter_budget_invalid');
 // Single-payment runs: one initialization, at most three verification reads, no refunds.
 if(manifest.execution_profile==='single-payment-acceptance'&&(b.initialize!==1||b.refund!==0||b.read<1||b.read>3))throw Error('counter_budget_invalid');
 return b;
}
function header(planSha256,manifest){
 if(!/^[a-f0-9]{64}$/.test(planSha256||''))throw Error('counter_plan_invalid');
 return {budget:budgetFor(manifest),plan_sha256:planSha256,profile:manifest.execution_profile||'full-suite',version:1};
}
function safeDir(dir){
 const s=fs.lstatSync(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077))throw Error('counter_directory_unsafe');
 return s;
}
function readChain(file){
 const rows=[];let prev=GENESIS;
 if(!fs.existsSync(file))return {rows,head:prev};
 const text=fs.readFileSync(file,'utf8');
 if(text&&!text.endsWith('\n'))throw Error('counter_tampered');
 for(const line of text.split('\n').filter(Boolean)){
  let r;try{r=JSON.parse(line);}catch{throw Error('counter_tampered');}
  const {hash,...rest}=r;
  if(rest.prev!==prev||rest.seq!==rows.length+1||hash!==sha(canonical(rest)))throw Error('counter_tampered');
  rows.push(r);prev=hash;
 }
 return {rows,head:prev};
}
function tally(rows){
 const t={dispatched:{initialize:0,refund:0,read:0},completed:0,denied:0,open:[]};
 const done=new Set(rows.filter(r=>r.type==='completion').map(r=>r.dispatch_seq));
 for(const r of rows){
  if(r.type==='dispatch'){t.dispatched[r.route]++;if(!done.has(r.seq))t.open.push(r.seq);}
  else if(r.type==='completion')t.completed++;
  else if(r.type==='denied')t.denied++;
 }
 return t;
}
class ProviderCounter{
 // Opens an already-prepared counter directory. Missing, tampered, mismatched or concurrently used state fails closed.
 constructor(dir,{planSha256,manifest,expectedOwner}){
  const s=safeDir(dir);
  if(expectedOwner&&(s.uid!==expectedOwner.uid||s.uid===0))throw Error('counter_owner_mismatch');
  this.dir=dir;this.file=path.join(dir,'requests.jsonl');
  let stored;try{stored=JSON.parse(fs.readFileSync(path.join(dir,'header.json'),'utf8'));}catch{throw Error('counter_header_missing');}
  this.header=header(planSha256,manifest);
  if(canonical(stored)!==canonical(this.header))throw Error('counter_run_mismatch');
  // One relay process per counter. A lock left by a crash requires review; it is never cleared automatically.
  try{this.lock=fs.openSync(path.join(dir,'relay.lock'),'wx',0o600);}catch{throw Error('counter_locked');}
  fs.writeSync(this.lock,JSON.stringify({pid:process.pid,opened:new Date().toISOString()})+'\n');fs.fsyncSync(this.lock);
  try{const c=readChain(this.file);this.rows=c.rows;this.head=c.head;}catch(e){this.release();throw e;}
  if(tally(this.rows).open.length){this.release();throw Error('counter_unresolved_dispatch');}
  this.fd=fs.openSync(this.file,'a',0o600);
 }
 append(entry){
  const rest={...entry,prev:this.head,seq:this.rows.length+1,at:new Date().toISOString()};
  const row={...rest,hash:sha(canonical(rest))};
  fs.writeSync(this.fd,JSON.stringify(row)+'\n');fs.fsyncSync(this.fd);
  this.rows.push(row);this.head=row.hash;return row;
 }
 // Synchronous check-and-append: no await between the budget check and the durable record.
 reserve(method,url,reference){
  const route=routeClass(method,url);
  if(!route){this.append({type:'denied',route:'unclassified',reason:'route_not_counted'});throw exhausted();}
  if(tally(this.rows).dispatched[route]>=this.header.budget[route]){this.append({type:'denied',route,reason:'budget_exhausted'});throw exhausted();}
  return this.append({type:'dispatch',route,reference_sha256:sha(String(reference))}).seq;
 }
 complete(seq,outcome,upstreamStatus,ms){
  this.append({type:'completion',dispatch_seq:seq,outcome:OUTCOMES.has(outcome)?outcome:'provider_transport_unknown',upstream_status:Number.isInteger(upstreamStatus)?upstreamStatus:null,ms:Math.round(ms)});
 }
 summary(){return summarize(this.rows,this.header,this.file);}
 release(){
  for(const k of ['fd','lock'])if(this[k]!==undefined){try{fs.closeSync(this[k]);}catch{}this[k]=undefined;}
  try{fs.unlinkSync(path.join(this.dir,'relay.lock'));}catch{}
 }
}
function summarize(rows,h,file){
 const t=tally(rows);
 return {counter:'durable-provider-requests-v1',plan_sha256:h.plan_sha256,budget:h.budget,dispatched:t.dispatched,completed:t.completed,denied:t.denied,open_dispatches:t.open.length,records:rows.length,head_hash:rows.length?rows[rows.length-1].hash:GENESIS,file_sha256:fs.existsSync(file)?sha(fs.readFileSync(file)):null};
}
// Read-only inspection for evidence (works on a read-only mount; takes no lock).
function inspect(dir){
 const h=JSON.parse(fs.readFileSync(path.join(dir,'header.json'),'utf8')),file=path.join(dir,'requests.jsonl');
 return {...summarize(readChain(file).rows,h,file),locked:fs.existsSync(path.join(dir,'relay.lock'))};
}
// Preparation: creates a fresh, empty counter for one newly prepared run. Refuses to reuse a directory.
function prepare(dir,planSha256,manifest){
 const h=header(planSha256,manifest);
 fs.mkdirSync(dir,{mode:0o700});
 fs.writeFileSync(path.join(dir,'header.json'),canonical(h)+'\n',{flag:'wx',mode:0o600});
 return h;
}
if(require.main===module){
 const [cmd,dir,plan]=process.argv.slice(2);
 try{
  if(cmd==='--inspect')console.log(JSON.stringify(inspect(dir)));
  else if(cmd==='--prepare')console.log(JSON.stringify(prepare(dir,plan,JSON.parse(fs.readFileSync(0,'utf8')))));
  else throw Error('usage');
 }catch(e){console.error(/^counter_|^usage$/.test(e.message)?e.message:'counter_unavailable');process.exitCode=1;}
}
module.exports={ProviderCounter,inspect,prepare,routeClass,budgetFor,readChain};
