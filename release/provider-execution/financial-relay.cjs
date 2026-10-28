'use strict';
const http=require('http'),https=require('https'),fs=require('fs'),dns=require('dns').promises,{execFileSync}=require('child_process');
const {bridge,wireHash}=require('./integration.cjs');
const {ProviderCounter}=require('./provider-counter.cjs');
const COUNTER_DIR='/run/provider-counter';
function safeFailure(error){
 const code=typeof error?.code==='string'?error.code:'provider_transport_unknown';
 const allowed=new Set(['provider_request_budget_exhausted','provider_http_4xx','provider_rate_limited','provider_http_5xx','pre_dispatch_connection_failure','post_dispatch_timeout_or_lost_response','malformed_provider_response','provider_transport_unknown']);
 return allowed.has(code)?code:'provider_transport_unknown';
}
function classifyProviderStatus(status){
 if(status===429)return 'provider_rate_limited';
 if(status>=400&&status<500)return 'provider_http_4xx';
 if(status>=500&&status<600)return 'provider_http_5xx';
 return null;
}
// Kernel backstop: NEW-connection and denied-packet counters are readable with `iptables -L OUTPUT -v -x -n`.
function firewallRules(addresses){
 const rules=[['-P','OUTPUT','DROP'],['-A','OUTPUT','-m','conntrack','--ctstate','ESTABLISHED,RELATED','-m','comment','--comment','getoyi-established','-j','ACCEPT']];
 for(const ip of addresses)rules.push(['-A','OUTPUT','-d',ip,'-p','tcp','--dport','443','-m','conntrack','--ctstate','NEW','-m','comment','--comment','getoyi-provider-new','-j','ACCEPT']);
 rules.push(['-A','OUTPUT','-m','comment','--comment','getoyi-denied','-j','DROP']);
 return rules;
}
function handler({config,key,send,consume=bridge,counter}){return async(q,r)=>{
 r.setHeader('cache-control','no-store');
 if(q.method==='GET'&&q.url==='/counters'&&counter&&!q.headers.authorization){r.setHeader('content-type','application/json');r.writeHead(200);return r.end(JSON.stringify(counter.summary()));}
 // A configured relay without its durable counter never sends.
 if(!config||!key||!counter){r.writeHead(503);return r.end();}
 if(q.method!=='POST'||q.url!=='/financial'||q.headers.authorization){r.writeHead(403);return r.end();}
 try{
  let n=0,chunks=[];for await(const b of q){n+=b.length;if(n>32768)throw Error();chunks.push(b);}
  const p=JSON.parse(Buffer.concat(chunks));
  if(Object.keys(p).sort().join(',')!=='body,method,reference,ticket,url'||!['GET','POST'].includes(p.method)||typeof p.ticket!=='string')throw Error();
  const profile=config.manifest?.execution_profile;
  const exact=profile==='single-initialization-only'
   ? p.method==='POST'&&p.url==='/transaction/initialize'
   : profile==='single-payment-acceptance'
   // Initialization plus verification of the run's own reference only: no refund, refund-list or dispute route.
   ? (p.method==='POST'&&p.url==='/transaction/initialize')||(p.method==='GET'&&p.body===null&&p.url==='/transaction/verify/'+p.reference&&/^hwo_[a-f0-9]{32}$/.test(p.reference))
   : (p.method==='POST'&&['/transaction/initialize','/refund'].includes(p.url))||(p.method==='GET'&&(/^\/transaction\/verify\/hwo_[a-f0-9]{32}$/.test(p.url)||/^\/refund\/[1-9][0-9]{0,39}$/.test(p.url)||/^\/refund\?transaction=[1-9][0-9]{0,39}&perPage=100&page=([1-9]|10)$/.test(p.url)||/^\/dispute\/transaction\/[1-9][0-9]{0,39}$/.test(p.url)));
  if(!exact)throw Error('route_denied');
  // Consume once, durably, before the only possible external side effect.
  consume(config,'consume',{reference:p.reference,ticket:p.ticket,request_hash:wireHash(p.method,p.url,p.body)});
  // Durable, fsynced write-ahead record and hard budget; a failure here means nothing is sent.
  const seq=counter.reserve(p.method,p.url,p.reference),meta={},started=Date.now();
  let data;
  try{data=await send(p,key,meta);}catch(e){try{counter.complete(seq,safeFailure(e),meta.status,Date.now()-started);}catch{}throw e;}
  counter.complete(seq,'ok',meta.status,Date.now()-started);
  r.setHeader('content-type','application/json');r.writeHead(200);r.end(JSON.stringify(data));
 }catch(e){const code=safeFailure(e);const status=code==='provider_request_budget_exhausted'?429:code==='provider_http_4xx'?502:code==='provider_rate_limited'?503:code==='provider_http_5xx'?502:503;r.setHeader('content-type','application/json');r.writeHead(status);r.end(JSON.stringify({error:code}));}
};}
async function main(){
 for(const name of ['PAYSTACK_SECRET_KEY','PAYSTACK_SECRECT_KEY','DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','SMTP_HOST'])if(process.env[name])throw Error('unrelated_credentials_denied');
 let config=null,key=null,addresses=[];
 if(process.env.PROVIDER_FINANCIAL_RELAY_ENABLED==='true'){
  config=JSON.parse(fs.readFileSync('/run/execution/config.json','utf8'));
  if(config.mode!=='real-provider'||config.database!=='/run/execution/run.sqlite'||!['single-initialization-only','single-payment-acceptance'].includes(config.manifest?.execution_profile))throw Error();
  bridge(config,process.env.PROVIDER_FINANCIAL_EXECUTION_ENABLED==='true'?'plan':'preflight-plan');
  key=require('../../dist/commerce/hardwareSetupServer').setupWebhookSigningKey({HARDWARE_TEST_WEBHOOK_KEY_FILE:'/run/secrets/hardware-test-key'});
  addresses=(await dns.resolve4('api.paystack.co')).filter(ip=>! /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(18|19)\.|22[4-9]\.|2[3-5]\d\.)/.test(ip));
  if(!addresses.length)throw Error();
 }
 for(const rule of firewallRules(addresses))execFileSync('iptables',rule,{stdio:'ignore'});execFileSync('ip6tables',['-P','OUTPUT','DROP'],{stdio:'ignore'});
 const owner=config?fs.statSync(config.database):{uid:1000,gid:1000};if(owner.uid===0)throw Error('unprivileged_ledger_owner_required');process.setgroups([]);process.setgid(owner.gid);process.setuid(owner.uid);
 // Opened only after the privilege drop, so counter files are owned by the unprivileged ledger owner.
 const counter=config?new ProviderCounter(COUNTER_DIR,{planSha256:config.planSha256,manifest:config.manifest,expectedOwner:owner}):null;
 const send=(p,secret,meta={})=>new Promise((resolve,reject)=>{
  let dispatched=false,settled=false;
  const fail=(code)=>{if(settled)return;settled=true;const e=Error(code);e.code=code;reject(e);};
  const body=p.body===null?undefined:JSON.stringify(p.body);
  const req=https.request({hostname:'api.paystack.co',servername:'api.paystack.co',port:443,path:p.url,method:p.method,rejectUnauthorized:true,agent:false,lookup:(_h,_o,cb)=>cb(null,[{address:addresses[0],family:4}]),timeout:15000,headers:{authorization:'Bearer '+secret,accept:'application/json',...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{})}},res=>{
   meta.status=res.statusCode;
   let size=0,chunks=[];res.on('data',b=>{size+=b.length;if(size>2097152){res.destroy();fail('malformed_provider_response');}else chunks.push(b)});res.on('end',()=>{const providerClass=classifyProviderStatus(res.statusCode);if(providerClass)return fail(providerClass);try{const parsed=JSON.parse(Buffer.concat(chunks));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){return fail('malformed_provider_response');}settled=true;resolve(parsed);}catch{fail('malformed_provider_response');}});res.on('error',()=>fail(dispatched?'post_dispatch_timeout_or_lost_response':'pre_dispatch_connection_failure'));
  });req.on('socket',socket=>{socket.once('secureConnect',()=>{dispatched=true;});});req.on('timeout',()=>{req.destroy();fail(dispatched?'post_dispatch_timeout_or_lost_response':'pre_dispatch_connection_failure');});req.on('error',()=>fail(dispatched?'post_dispatch_timeout_or_lost_response':'pre_dispatch_connection_failure'));req.end(body);
 });
 const server=http.createServer(handler({config,key,send,counter}));server.on('connect',(_q,s)=>s.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
 server.listen(8080,'0.0.0.0',()=>console.log(JSON.stringify({relay:config?'bounded-financial':'disabled',counter:counter?counter.summary():null})));
 const shutdown=()=>{server.close();if(counter){console.log(JSON.stringify({relay:'stopping',counter:counter.summary()}));counter.release();}process.exit(0);};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
if(require.main===module)main().catch(()=>{console.error('bounded_relay_startup_denied');process.exitCode=1;});
module.exports={handler,safeFailure,classifyProviderStatus,firewallRules};
