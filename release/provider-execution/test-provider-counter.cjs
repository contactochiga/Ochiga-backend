'use strict';
// Durable provider-request counter: hard single-initialization limit, restart, crash, tamper, privacy and concurrency.
// Local files and a mocked upstream only; no provider or network requests.
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {Readable}=require('node:stream');
const {ProviderCounter,inspect,prepare,budgetFor}=require('./provider-counter.cjs');
const {handler}=require('./financial-relay.cjs');
const manifest=require('./single-init-manifest.json');
let n=0;const ok=(c,m)=>{assert.ok(c,m);n++;},eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;},throws=(f,code)=>{assert.throws(f,e=>e.message===code,code);n++;};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'provider-counter-'));
const plan='c'.repeat(64),ref='hwo_'+'d'.repeat(32);
const fresh=name=>{const d=path.join(root,name);prepare(d,plan,manifest);return d;};
const open=d=>new ProviderCounter(d,{planSha256:plan,manifest});
function response(){return {headers:{},status:null,body:'',setHeader(k,v){this.headers[k]=v;},writeHead(s){this.status=s;},end(b=''){this.body+=b;}};}
async function call(counter,send,{method='POST',url='/transaction/initialize'}={}){
 const req=Readable.from([Buffer.from(JSON.stringify({method,url,reference:ref,ticket:'t',body:method==='POST'?{reference:ref,amount:10000}:null}))]);
 req.method='POST';req.url='/financial';req.headers={};const res=response();
 await handler({config:{manifest},key:'synthetic-only',counter,send,consume:()=>{}})(req,res);return res;
}
(async()=>{
 eq(budgetFor(manifest),{initialize:1,refund:0,read:0});
 throws(()=>budgetFor({...manifest,max_payment_initializations:2}),'counter_budget_invalid');
 throws(()=>prepare(path.join(root,'bad-plan'),'x',manifest),'counter_plan_invalid');

 // Hard limit: exactly one initialization; the second is denied and recorded, before any send.
 const a=fresh('a');let c=open(a);
 const s1=c.reserve('POST','/transaction/initialize',ref);c.complete(s1,'ok',200,12);
 throws(()=>c.reserve('POST','/transaction/initialize',ref),'provider_request_budget_exhausted');
 throws(()=>c.reserve('GET','/transaction/verify/'+ref,ref),'provider_request_budget_exhausted');
 throws(()=>c.reserve('POST','/refund',ref),'provider_request_budget_exhausted');
 throws(()=>c.reserve('POST','/transfer',ref),'provider_request_budget_exhausted');
 let s=c.summary();eq([s.dispatched,s.completed,s.denied,s.open_dispatches],[{initialize:1,refund:0,read:0},1,4,0]);

 // Second concurrent relay on the same counter is refused.
 throws(()=>open(a),'counter_locked');
 // Restart keeps the durable count: no new budget.
 c.release();c=open(a);
 throws(()=>c.reserve('POST','/transaction/initialize',ref),'provider_request_budget_exhausted');
 eq(c.summary().dispatched.initialize,1);
 const ro=inspect(a);eq([ro.dispatched.initialize,ro.locked,ro.file_sha256===c.summary().file_sha256],[1,true,true]);c.release();
 eq(inspect(a).locked,false);

 // Privacy: only allow-listed fields; no reference, URL, body, key or amount is stored.
 const text=fs.readFileSync(path.join(a,'requests.jsonl'),'utf8');
 ok(!text.includes(ref)&&!text.includes('/transaction')&&!text.includes('sk_')&&!text.includes('10000')&&!text.includes('synthetic-only'),'no sensitive data recorded');
 const keys=new Set(text.trim().split('\n').flatMap(l=>Object.keys(JSON.parse(l))));
 ok([...keys].every(k=>['type','route','reference_sha256','reason','dispatch_seq','outcome','upstream_status','ms','prev','seq','at','hash'].includes(k)),'allow-listed fields only');
 eq(fs.statSync(path.join(a,'requests.jsonl')).mode&0o777,0o600);

 // Crash during a send: the lock remains (review required); after manual lock review the open dispatch still blocks.
 const b=fresh('b');c=open(b);c.reserve('POST','/transaction/initialize',ref);fs.closeSync(c.fd);fs.closeSync(c.lock);
 throws(()=>open(b),'counter_locked');
 fs.unlinkSync(path.join(b,'relay.lock'));
 throws(()=>open(b),'counter_unresolved_dispatch');

 // Tampering: edited, deleted or truncated records, a changed header, another run's plan, an unsafe directory, reuse.
 const t=fresh('t');c=open(t);c.complete(c.reserve('POST','/transaction/initialize',ref),'ok',200,1);try{c.reserve('POST','/transaction/initialize',ref);}catch{}c.release();
 const file=path.join(t,'requests.jsonl'),orig=fs.readFileSync(file,'utf8'),lines=orig.trim().split('\n');
 fs.writeFileSync(file,orig.replace('"initialize"','"read"'));throws(()=>open(t),'counter_tampered');
 fs.writeFileSync(file,[lines[0],lines[2]].join('\n')+'\n');throws(()=>open(t),'counter_tampered');
 fs.writeFileSync(file,orig.slice(0,-5));throws(()=>open(t),'counter_tampered');
 fs.writeFileSync(file,'');c=open(t);eq(c.summary().records,0);c.release(); // full erasure is caught by the reconciliation gate, not the chain
 fs.writeFileSync(file,orig);
 const h=path.join(t,'header.json'),hd=fs.readFileSync(h,'utf8');
 fs.writeFileSync(h,hd.replace('"initialize":1','"initialize":2'));throws(()=>open(t),'counter_run_mismatch');fs.writeFileSync(h,hd);
 throws(()=>new ProviderCounter(t,{planSha256:'e'.repeat(64),manifest}),'counter_run_mismatch');
 fs.rmSync(path.join(root,'missing'),{force:true,recursive:true});fs.mkdirSync(path.join(root,'missing'),{mode:0o700});throws(()=>open(path.join(root,'missing')),'counter_header_missing');
 fs.chmodSync(t,0o755);throws(()=>open(t),'counter_directory_unsafe');fs.chmodSync(t,0o700);
 assert.throws(()=>prepare(t,plan,manifest));n++;
 throws(()=>new ProviderCounter(t,{planSha256:plan,manifest,expectedOwner:{uid:fs.statSync(t).uid+1}}),'counter_owner_mismatch');

 // Through the real relay handler, even if the ledger ticket check were bypassed: 10 concurrent requests, 1 send.
 const k=fresh('k');c=open(k);let sends=0;
 const results=await Promise.all(Array.from({length:10},()=>call(c,async(_p,_k,meta)=>{sends++;meta.status=200;await new Promise(r=>setTimeout(r,20));return {status:true};})));
 eq([sends,results.filter(r=>r.status===200).length,results.filter(r=>r.status===429).length],[1,1,9]);
 s=c.summary();eq([s.dispatched.initialize,s.completed,s.denied,s.open_dispatches],[1,1,9,0]);
 const view=response();await handler({config:{manifest},key:'k',counter:c,send:()=>{throw Error();}})(Object.assign(Readable.from([]),{method:'GET',url:'/counters',headers:{}}),view);
 eq([view.status,JSON.parse(view.body).dispatched.initialize,JSON.parse(view.body).file_sha256===s.file_sha256],[200,1,true]);
 c.release();

 // Upstream failure is recorded as a completed dispatch with its safe class; budget is still spent.
 const f=fresh('f');c=open(f);
 const failed=await call(c,async(_p,_k,meta)=>{meta.status=503;throw Object.assign(Error('body'),{code:'provider_http_5xx'});});
 eq([failed.status,JSON.parse(failed.body).error],[502,'provider_http_5xx']);
 const last=JSON.parse(fs.readFileSync(path.join(f,'requests.jsonl'),'utf8').trim().split('\n').at(-1));
 eq([last.type,last.outcome,last.upstream_status],['completion','provider_http_5xx',503]);
 eq((await call(c,async()=>{sends++;return {};})).status,429);eq(sends,1);c.release();

 // Counter write failure: nothing is sent.
 const w=fresh('w');c=open(w);fs.closeSync(c.fd);
 const wf=await call(c,async()=>{sends++;return {};});eq([wf.status,sends],[503,1]);c.fd=undefined;c.release();

 fs.rmSync(root,{recursive:true,force:true});
 console.log('durable provider-request counter: '+n+' assertions PASS; mocked upstream only, provider requests=0');
})().catch(e=>{console.error(e);process.exitCode=1;});
