'use strict';
// single-payment-acceptance runtime surface: relay routes, durable counter budget, server flags and HTTP routes.
// Stubbed provider and services only; no network beyond 127.0.0.1.
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {Readable}=require('node:stream');
const {handler}=require('./financial-relay.cjs');
const {ProviderCounter,prepare,budgetFor}=require('./provider-counter.cjs');
const {assertEnvironment,singlePaymentPathAllowed,webhookLimiter,mount}=require('./execution-server.cjs');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'single-payment-manifest.json'),'utf8'));
const REF='hwo_'+'a'.repeat(32),OTHER='hwo_'+'b'.repeat(32);
let n=0;const ok=(c,m)=>{assert.ok(c,m);n++;},eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
function response(){return {headers:{},status:null,body:'',setHeader(k,v){this.headers[k]=v;},writeHead(s){this.status=s;},end(b=''){this.body+=b;}};}
async function relay({method,url,body=null,reference=REF,counter,send}){
 const req=Readable.from([Buffer.from(JSON.stringify({method,url,reference,ticket:'synthetic-ticket',body}))]);req.method='POST';req.url='/financial';req.headers={};
 const res=response();let consumed=0;
 await handler({config:{manifest},key:'synthetic-only',send,counter,consume:()=>{consumed++;}})(req,res);
 return {status:res.status,body:res.body,consumed};
}
(async()=>{
 // Counter budget for this profile: initialize=1, read=3, refund=0; anything else is invalid.
 eq(budgetFor(manifest),{initialize:1,refund:0,read:3});
 for(const [k,v] of [['max_payment_initializations',2],['max_refund_initializations',1],['max_provider_reads',0],['max_provider_reads',4]])assert.throws(()=>budgetFor({...manifest,[k]:v}),/counter_budget_invalid/),n++;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'single-payment-counter-')),dir=path.join(root,'c'),plan='c'.repeat(64);
 prepare(dir,plan,manifest);
 let counter=new ProviderCounter(dir,{planSha256:plan,manifest}),sent=0;
 const send=async p=>{sent++;return {status:true,data:{reference:p.reference}};};
 // Route allowlist: initialize and verification of the payload's own reference only (the ticket binds it to the plan).
 for(const [method,url,body,reference] of [
  ['POST','/refund',{transaction:REF,amount:10000},REF],
  ['GET','/transaction/verify/'+OTHER,null,REF],
  ['GET','/dispute/transaction/123',null,REF],
  ['GET','/refund?transaction=123&perPage=100&page=1',null,REF],
  ['GET','/refund/123',null,REF],
  ['GET','/transaction/verify/'+REF,{x:1},REF],
  ['POST','/transaction/verify/'+REF,null,REF],
  ['DELETE','/transaction/initialize',null,REF],
 ]){const r=await relay({method,url,body,reference,counter,send});ok(r.status===503&&r.consumed===0,'denied '+method+' '+url);}
 eq(sent,0,'denied routes send nothing');eq(counter.summary().dispatched,{initialize:0,refund:0,read:0});
 let r=await relay({method:'POST',url:'/transaction/initialize',body:{reference:REF,amount:10000},counter,send});ok(r.status===200&&r.consumed===1);
 for(let i=0;i<3;i++){r=await relay({method:'GET',url:'/transaction/verify/'+REF,counter,send});ok(r.status===200,'read '+(i+1));}
 r=await relay({method:'GET',url:'/transaction/verify/'+REF,counter,send});ok(r.status===429&&JSON.parse(r.body).error==='provider_request_budget_exhausted','4th read refused');
 r=await relay({method:'POST',url:'/transaction/initialize',body:{reference:REF,amount:10000},counter,send});ok(r.status===429,'2nd initialization refused');
 eq(sent,4,'exactly one initialization and three reads sent');
 let s=counter.summary();eq(s.dispatched,{initialize:1,refund:0,read:3});eq([s.completed,s.denied,s.open_dispatches],[4,2,0]);
 // Restart persistence: a new relay process reopens the same counter with the same totals and remaining budget 0.
 counter.release();counter=new ProviderCounter(dir,{planSha256:plan,manifest});
 eq(counter.summary().dispatched,{initialize:1,refund:0,read:3},'restart keeps totals');
 r=await relay({method:'GET',url:'/transaction/verify/'+REF,counter,send});ok(r.status===429&&sent===4,'budget survives restart');
 // A crash between the durable dispatch record and its completion blocks restart until reviewed.
 const dir2=path.join(root,'c2');prepare(dir2,plan,manifest);const c2=new ProviderCounter(dir2,{planSha256:plan,manifest});c2.reserve('POST','/transaction/initialize',REF);
 fs.closeSync(c2.fd);fs.closeSync(c2.lock);  // simulate process death: lock and open dispatch remain
 assert.throws(()=>new ProviderCounter(dir2,{planSha256:plan,manifest}),/counter_locked/);n++;
 fs.unlinkSync(path.join(dir2,'relay.lock'));  // diagnosis only: even without the lock, the open dispatch refuses
 assert.throws(()=>new ProviderCounter(dir2,{planSha256:plan,manifest}),/counter_unresolved_dispatch/);n++;
 counter.release();fs.rmSync(root,{recursive:true,force:true});

 // Server flags: processing on (webhook + verification), recovery and refunds off.
 const base={HARDWARE_SETUP_ONLY:'true',SUPABASE_URL:'http://backend-rest:3000',HARDWARE_TEST_CALLBACK_ORIGIN:'https://localhost:18443',HARDWARE_PAYSTACK_CALLBACK_URL:'https://localhost:18443/hardware/checkout',OFFICE_HARDWARE_PAYMENT_CONFIRM_URL:'https://office.hardware.test/api/commerce/payments/confirm',OFFICE_HARDWARE_FINANCIAL_URL:'https://office.hardware.test/api/commerce/payments/operations',HARDWARE_EXECUTION_PROFILE:'single-payment-acceptance',HARDWARE_PAYMENT_INITIALIZATION_ENABLED:'true',HARDWARE_PAYMENT_PROCESSING_ENABLED:'true',HARDWARE_FINANCIAL_RECOVERY_ENABLED:'false',HARDWARE_REFUNDS_ENABLED:'false',OFFICE_HARDWARE_PAYMENT_CONFIRM_KEY:'a'.repeat(40),OFFICE_HARDWARE_FINANCIAL_KEY:'b'.repeat(40),HARDWARE_OFFICE_API_KEY:'c'.repeat(40)};
 assert.doesNotThrow(()=>assertEnvironment(base));n++;
 for(const [k,v] of [['HARDWARE_FINANCIAL_RECOVERY_ENABLED','true'],['HARDWARE_REFUNDS_ENABLED','true'],['HARDWARE_PAYMENT_PROCESSING_ENABLED','false'],['HARDWARE_PAYMENT_INITIALIZATION_ENABLED','false'],['HARDWARE_EXECUTION_PROFILE','single-payment'],['PAYSTACK_SECRET_KEY','sk_live_x']])assert.throws(()=>assertEnvironment({...base,[k]:v})),n++;
 for(const p of ['/initialize','/webhook','/reconcile'])ok(singlePaymentPathAllowed('POST',p));
 for(const [m,p] of [['POST','/recover'],['POST','/replay'],['POST','/refund'],['GET','/webhook'],['POST','/reconcile/x'],['POST','/initialize?x=1']])ok(!singlePaymentPathAllowed(m,p));
 let t=0;const lim=webhookLimiter(2,1000,()=>t);eq([lim(),lim(),lim(),lim()],['ok','ok','first_reject','reject']);t=1000;eq(lim(),'ok');

 // HTTP surface over the real Backend route handlers with stubbed services.
 const backend=path.join(__dirname,'../..');
 // Unreachable synthetic binding: the route module builds a client at import; no request is made through it.
 process.env.SUPABASE_URL||='http://127.0.0.1:1';process.env.SUPABASE_SERVICE_ROLE_KEY||='synthetic-test-key';
 const express=require(path.join(backend,'node_modules/express'));
 const {hardwareRoutes,hardwareWebhookHandler}=require(path.join(backend,'dist/commerce/hardwarePaymentRoutes'));
 const calls=[],notes=[],secret='sk_test_SYNTHETIC_NOT_A_CREDENTIAL';
 const {validSignature}=require(path.join(backend,'dist/commerce/hardwarePayments'));
 const services={bridge:(a,f)=>{notes.push(f.event);},payments:{initialize:async b=>{calls.push('initialize');return {state:'pending'};},reconcile:async ref=>{calls.push('reconcile:'+ref);},sweep:async()=>{calls.push('sweep');},webhook:async(raw,sig)=>{if(!validSignature(raw,sig,secret))throw Error('invalid_signature');calls.push('webhook');}}};
 const env={HARDWARE_OFFICE_API_KEY:'k'.repeat(40),HARDWARE_PAYMENT_INITIALIZATION_ENABLED:'true',HARDWARE_PAYMENT_PROCESSING_ENABLED:'true'};const saved={};for(const k in env){saved[k]=process.env[k];process.env[k]=env[k];}
 const app=mount({services,hardwareRoutes,hardwareWebhookHandler,profile:'single-payment-acceptance',limiter:webhookLimiter(5,60000)});
 const server=app.listen(0,'127.0.0.1');await new Promise(x=>server.once('listening',x));const o='http://127.0.0.1:'+server.address().port;
 const post=(p,body,h={})=>fetch(o+'/hardware-payments'+p,{method:'POST',headers:{'content-type':'application/json',...h},body:typeof body==='string'?body:JSON.stringify(body)});
 const key={'x-api-key':env.HARDWARE_OFFICE_API_KEY};
 try{
  eq((await post('/reconcile',{reference:REF})).status,403,'verification requires the service credential');
  eq((await post('/reconcile',{},key)).status,400,'empty body (sweep) refused');
  eq((await post('/reconcile',{reference:REF,extra:1},key)).status,400);
  eq((await post('/reconcile',{reference:'hwo_x'},key)).status,400);
  eq((await post('/reconcile',{reference:REF},key)).status,200);
  for(const p of ['/recover','/replay','/refund'])eq((await post(p,{reference:REF},key)).status,404,p+' absent');
  eq((await fetch(o+'/hardware-payments/webhook')).status,404);
  const raw=JSON.stringify({event:'charge.success',data:{reference:REF}}),sig=crypto.createHmac('sha512',secret).update(raw).digest('hex');
  eq((await post('/webhook',raw,{'x-paystack-signature':'0'.repeat(128)})).status,401,'bad signature 401');
  eq((await post('/webhook',raw,{'x-paystack-signature':sig})).status,200,'signed webhook 200');
  {const big=await post('/webhook','x'.repeat(70000),{'x-paystack-signature':sig});eq(big.status,413,'oversized body refused');eq(await big.text(),'Payload Too Large','no stack trace in error body');}
  {const bad=await post('/reconcile','{not json',key);eq(bad.status,400);ok(!(await bad.text()).includes('at '),'no stack trace on malformed JSON');}
  const statuses=[];for(let i=0;i<4;i++)statuses.push((await post('/webhook',raw,{'x-paystack-signature':sig})).status);
  eq(statuses,[200,200,429,429],'rate limit after 5 per window');
  eq(notes,['webhook_rate_limited'],'rate limiting noted once per window');
  eq(calls.filter(c=>c==='sweep').length,0,'no sweep reachable');
  eq(calls.filter(c=>c.startsWith('reconcile')),['reconcile:'+REF]);
 }finally{await new Promise(x=>server.close(x));for(const k in saved){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
 console.log(`single-payment runtime (relay routes, durable counter budget and restart, server flags, HTTP surface): ${n} assertions PASS; stubbed provider, no network requests beyond loopback`);
})().catch(e=>{console.error(e);process.exitCode=1;});
