// single-payment-acceptance end to end, inside the existing disposable PostgreSQL financial suite.
// Fake Paystack behind the REAL relay handler, durable provider counter, run ledger/bridge, integration guards,
// bounded HTTP surface, Backend payment SQL and Office confirmation SQL. Nothing leaves the process.
// The disposable run ledgers use the real-provider dispatch path (relay client contract) so the production code path is
// exercised; every provider response is synthetic and the ledgers are deleted afterwards.
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{Readable}=require('stream'),{execFileSync}=require('child_process');
module.exports=async({run,one,check,bsql,backend,make,auth,deps})=>{
 const X=path.join(backend,'release/provider-execution');
 const {createBoundedServices,bridge,validInitializationResponse}=require(path.join(X,'integration.cjs'));
 const {handler}=require(path.join(X,'financial-relay.cjs'));
 const {ProviderCounter,prepare,inspect}=require(path.join(X,'provider-counter.cjs'));
 const {mount,webhookLimiter}=require(path.join(X,'execution-server.cjs'));
 // Preparation binds the owner-approved inbox into each run's manifest; a synthetic deliverable-form address here.
 const manifest={...JSON.parse(fs.readFileSync(path.join(X,'single-payment-manifest.json'),'utf8')),customer_email:'acceptance-inbox@payments-test.getoyi.com'};
 const express=require(path.join(backend,'node_modules/express'));
 const {hardwareRoutes,hardwareWebhookHandler}=require(path.join(backend,'dist/commerce/hardwarePaymentRoutes'));
 const SECRET='sk_test_SYNTHETIC_NOT_A_CREDENTIAL',root=fs.mkdtempSync(path.join(os.tmpdir(),'single-payment-e2e-'));
 const env={HARDWARE_SETUP_ONLY:'true',HARDWARE_TEST_CALLBACK_ORIGIN:'https://localhost:18443',HARDWARE_OFFICE_API_KEY:'synthetic-single-payment-service-key-0000',HARDWARE_PAYMENT_INITIALIZATION_ENABLED:'true',HARDWARE_PAYMENT_PROCESSING_ENABLED:'true'};
 const saved={};for(const k in env){saved[k]=process.env[k];process.env[k]=env[k];}

 // Fake Paystack: initialize creates an 'abandoned' (unpaid) transaction; checkout() is the test-card payment.
 const provider={tx:new Map(),requests:[],faults:{},seq:0};
 const fail=code=>Object.assign(Error(code),{code});
 provider.send=async(p,key,meta)=>{
  provider.requests.push({method:p.method,url:p.url,key_is_test:key.startsWith('sk_test_')});
  if(p.method==='POST'&&p.url==='/transaction/initialize'){
   const b=p.body,id=700000+(++provider.seq);
   provider.tx.set(b.reference,{id,domain:'test',status:'abandoned',reference:b.reference,amount:b.amount,currency:b.currency,metadata:b.metadata,init:b});
   if(provider.faults.loseInit){provider.faults.loseInit=false;throw fail('post_dispatch_timeout_or_lost_response');}
   meta.status=200;return {status:true,message:'Authorization URL created',data:{authorization_url:'https://checkout.paystack.com/fake'+id,access_code:'fake'+id,reference:b.reference}};
  }
  if(p.method==='GET'&&p.url.startsWith('/transaction/verify/')){
   if(provider.faults.verifyTimeout){provider.faults.verifyTimeout=false;throw fail('post_dispatch_timeout_or_lost_response');}
   const t=provider.tx.get(p.url.slice(20));if(!t){meta.status=400;throw fail('provider_http_4xx');}
   meta.status=200;const {init,...data}=t;return {status:true,message:'Verification successful',data:{...data,...(provider.faults.mutate?.(data)||{})}};
  }
  throw fail('provider_transport_unknown');
 };
 const checkout=ref=>{provider.tx.get(ref).status='success';};
 const sends=()=>({initialize:provider.requests.filter(r=>r.method==='POST').length,read:provider.requests.filter(r=>r.method==='GET').length});

 function newRun(name){
  const dir=path.join(root,name);fs.mkdirSync(dir);const database=path.join(dir,'run.sqlite');
  const digest=execFileSync('python3',['-c',"import sys,json;sys.path.insert(0,sys.argv[1]);from executor import Executor;e=Executor(sys.argv[2],json.load(sys.stdin));print(e.digest);e.close()",X,database],{input:JSON.stringify(manifest),encoding:'utf8'}).trim();
  const id=make(false);run(`select hardware_payment_confirm_delivery('creator@fixture.test','${id}',0,0,'LOCAL zero-charge delivery fixture')`);
  const a=auth(id);a.email=manifest.customer_email;
  const config={database,manifest,mode:'real-provider',python:'python3'};
  config.planSha256=bridge(config,'prepare',{plan:[{reference:a.reference,scenario:'single_payment',amount:10000}]}).plan_sha256;
  const counterDir=path.join(dir,'provider-counter');prepare(counterDir,config.planSha256,manifest);
  const r={name,dir,config,digest,a,counterDir,counter:new ProviderCounter(counterDir,{planSha256:config.planSha256,manifest})};
  // Real relay handler + real counter + real ticket consumption, exactly as relay-client.cjs talks to it.
  const dispatch=async payload=>{
   const req=Readable.from([Buffer.from(JSON.stringify(payload))]);req.method='POST';req.url='/financial';req.headers={};
   const res={headers:{},status:null,body:'',setHeader(k,v){this.headers[k]=v;},writeHead(s){this.status=s;},end(b=''){this.body+=b;}};
   await handler({config,key:SECRET,send:provider.send,counter:r.counter})(req,res);
   if(res.status!==200){let code='provider_transport_unknown';try{code=JSON.parse(res.body).error||code;}catch{}throw fail(code);}
   return {data:JSON.parse(res.body)};
  };
  const d={...deps,secret:SECRET,callback:'https://localhost:18443/hardware/checkout',provider:{boundary:'isolated-paystack-relay-v1',dispatch},refundsEnabled:false,approvals:async()=>[],refundsDue:async()=>[],outbox:async()=>[],deliverObservation:async()=>{}};
  r.fresh=()=>createBoundedServices(d,config);
  r.restartRelay=()=>{r.counter.release();r.counter=new ProviderCounter(counterDir,{planSha256:config.planSha256,manifest});};
  r.arm=()=>bridge(config,'arm',{approval:{manifest_sha256:digest,plan_sha256:config.planSha256,authorized:true,environment:'test',evidence:'real-provider'}});
  r.status=()=>bridge(config,'status');
  r.order=()=>one(`select payment_state||'|'||(select state from hardware_reservations where order_id=o.id)||'|'||(select count(*) from hardware_payment_confirmations c where c.order_id=o.id) from hardware_orders o where id='${a.order_id}'`);
  r.attempt=()=>bsql(`select coalesce((select state from hardware_payment_attempts where reference='${a.reference}'),'none')`);
  return r;
 }
 const runs=[];
 const walletTables=(q)=>q("select coalesce(string_agg(relname,',' order by relname),'') from pg_class where relkind='r' and relnamespace='public'::regnamespace and relname like '%wallet%'").split(',').filter(Boolean);
 const walletSnap=()=>JSON.stringify({office:walletTables(one).map(t=>[t,one(`select md5(coalesce(string_agg(x::text,'|' order by x::text),'')) from ${t} x`)]),backend:walletTables(bsql).map(t=>[t,bsql(`select md5(coalesce(string_agg(x::text,'|' order by x::text),'')) from ${t} x`)])});
 const walletsBefore=walletSnap();

 try{
  // ---- Run A: complete lifecycle with duplicates, a bad signature, a verify timeout and concurrency.
  const A=newRun('A');runs.push(A);
  let refused=false;try{await A.fresh().payments.initialize(A.a);}catch{refused=true;}
  check('S-DISABLED','unarmed single-payment run sends nothing',refused&&provider.requests.length===0&&A.counter.summary().records===0);
  A.arm();
  // mount() binds one services object; rebuild it per request, as the server's route factories do.
  const server=express().use((q,r,n)=>mount({services:A.fresh(),hardwareRoutes,hardwareWebhookHandler,profile:'single-payment-acceptance',limiter:A.limiter||(A.limiter=webhookLimiter())})(q,r,n)).listen(0,'127.0.0.1');
  await new Promise(x=>server.once('listening',x));const origin='http://127.0.0.1:'+server.address().port,key={'x-api-key':env.HARDWARE_OFFICE_API_KEY};
  const post=(p,body,h={})=>fetch(origin+'/hardware-payments'+p,{method:'POST',headers:{'content-type':'application/json',...h},body:typeof body==='string'?body:JSON.stringify(body)});
  try{
   check('S-HTTP-AUTH','initialization without the Office service credential is refused',(await post('/initialize',A.a)).status===403&&provider.requests.length===0);
   const inits=await Promise.all(Array.from({length:5},()=>post('/initialize',A.a,key).then(async r=>({status:r.status,body:await r.json()}))));
   const urls=new Set(inits.filter(r=>r.body.checkout_url).map(r=>r.body.checkout_url));
   check('S-INIT-ONCE','five concurrent initializations send exactly one provider initialization',sends().initialize===1&&inits.every(r=>r.status===200)&&A.attempt()==='pending',{sends:sends(),states:inits.map(r=>r.body.state)});
   check('S-HOSTED','hosted checkout URL is the validated Paystack checkout host',urls.size===1&&[...urls][0].startsWith('https://checkout.paystack.com/'));
   const sent=provider.tx.get(A.a.reference).init;
   check('S-EXACT','provider received exactly NGN 10,000 kobo for the run reference with bound metadata and the manifest-bound test inbox',sent.amount===10000&&Number.isSafeInteger(sent.amount)&&sent.currency==='NGN'&&sent.reference===A.a.reference&&sent.metadata.order_id===A.a.order_id&&sent.metadata.reservation_id===A.a.reservation_id&&sent.metadata.authorization_hash===A.a.authorization_hash&&sent.metadata.purpose==='hardware_order'&&sent.callback_url==='https://localhost:18443/hardware/checkout'&&sent.email===manifest.customer_email);
   check('S-HELD','reservation is held and the order unpaid before checkout',A.order()==='not_started|held|0');
   check('S-EARLY-VERIFY','verification before checkout leaves the order unpaid',(await post('/reconcile',{reference:A.a.reference},key)).status===200&&A.order()==='not_started|held|0'&&A.attempt()==='pending'&&sends().read===1);
   checkout(A.a.reference);
   const raw=JSON.stringify({event:'charge.success',data:{reference:A.a.reference,amount:10000,currency:'NGN'}}),sig=crypto.createHmac('sha512',SECRET).update(raw).digest('hex');
   const bad=await post('/webhook',raw,{'x-paystack-signature':crypto.createHmac('sha512','sk_test_WRONG').update(raw).digest('hex')});
   check('S-WEBHOOK-AUTH','webhook signed with another key is refused and noted without stopping the run',bad.status===401&&A.status().run_enabled&&!A.status().run_stopped);
   const hooks=await Promise.all(Array.from({length:3},()=>post('/webhook',raw,{'x-paystack-signature':sig}).then(r=>r.status)));
   check('S-WEBHOOK-DUPLICATES','three concurrent identical signed deliveries are accepted once',hooks.every(s=>s===200)&&bsql(`select count(*) from hardware_payment_inbox where reference='${A.a.reference}'`)==='1');
   check('S-WEBHOOK-NOT-PROOF','a signed webhook alone does not mark Office paid',A.order()==='not_started|held|0'&&sends().read===1);
   A.restartRelay();
   check('S-RESTART','relay restart reopens the durable counter with the same totals',JSON.stringify(A.counter.summary().dispatched)===JSON.stringify({initialize:1,refund:0,read:1}));
   provider.faults.verifyTimeout=true;
   await post('/reconcile',{reference:A.a.reference},key);
   check('S-VERIFY-TIMEOUT','a timed-out verification read is counted and leaves the order unpaid',A.order()==='not_started|held|0'&&sends().read===2&&A.counter.summary().completed===3);
   const finals=await Promise.all(Array.from({length:3},()=>post('/reconcile',{reference:A.a.reference},key).then(r=>r.status)));
   check('S-PAID-ONCE','verified provider evidence confirms Office exactly once and allocates the reservation',finals.every(s=>s===200)&&A.order()==='paid|allocated|1'&&A.attempt()==='confirmed',{order:A.order(),attempt:A.attempt()});
   check('S-READS-BOUNDED','concurrent final verifications use one lease and stay within three reads',sends().read===3);
   await post('/reconcile',{reference:A.a.reference},key);await post('/initialize',A.a,key);
   for(let i=0;i<2;i++)await post('/webhook',raw,{'x-paystack-signature':sig});
   check('S-IDEMPOTENT','after confirmation, verify, initialize and webhook retries send nothing and change nothing',JSON.stringify(sends())==='{"initialize":1,"read":3}'&&A.order()==='paid|allocated|1');
   const s=A.counter.summary(),st=A.status();
   check('S-COUNT-AGREE','counter = ledger dispatches = provider requests (1 initialization + 3 reads); one Backend attempt; one Office confirmation',
    JSON.stringify(s.dispatched)==='{"initialize":1,"refund":0,"read":3}'&&s.open_dispatches===0&&st.provider_dispatch_count===4&&provider.requests.length===4&&bsql(`select count(*) from hardware_payment_attempts where order_id='${A.a.order_id}'`)==='1'&&A.order().endsWith('|1'),{counter:s.dispatched,ledger:st.provider_dispatch_count,provider:sends()});
   const notes=execFileSync('python3',['-c',"import sqlite3,sys;d=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);print(','.join(r[0] for r in d.execute(\"select event from events where event like 'webhook_%' order by seq\")))",A.config.database],{encoding:'utf8'}).trim();
   check('S-INGRESS-NOTED','the rejected webhook is durably noted in the run ledger',notes==='webhook_signature_rejected');
   check('S-NO-REFUND-ROUTE','refund, replay and recovery routes do not exist on the bounded server',(await Promise.all(['/refund','/replay','/recover'].map(p=>post(p,{reference:A.a.reference},key).then(r=>r.status)))).every(x=>x===404));
   check('S-NO-SWEEP','an empty verification request cannot sweep other attempts',(await post('/reconcile',{},key)).status===400);
   {// N1: noncanonical targets are sent verbatim (fetch would normalize them) with the service key and an empty body.
    const http=require('http'),port=server.address().port,raw=target=>new Promise(res=>{const q=http.request({agent:false,host:'127.0.0.1',port,method:'POST',path:target,headers:{'content-type':'application/json','content-length':2,...key}},r=>{r.resume();r.on('end',()=>res(r.statusCode));});q.on('error',()=>res('reset'));q.end('{}');});
    const snap=()=>bsql(`select coalesce(string_agg(reference||':'||state||':'||attempts,',' order by reference),'') from hardware_payment_attempts`)+'|'+bsql('select count(*) from hardware_refunds')+'|'+JSON.stringify(sends());
    const before=snap(),codes=[];
    for(const target of ['/hardware-payments//reconcile','//hardware-payments/reconcile','/hardware-payments/reconcile/','/hardware-payments/./reconcile','/hardware-payments/%72econcile','/hardware-payments//recover','/hardware-payments//refund','/hardware-payments//initialize'])codes.push(await raw(target));
    check('S-NONCANONICAL','noncanonical financial routes (incl. //reconcile with empty body and service key) are refused before any handler: no sweep, refund, reconciliation or provider request',codes.every(c=>c===404)&&snap()===before,{codes});
   }
   let refundRefused=false;try{await A.fresh().provider.post('/refund',{transaction:A.a.reference,amount:10000,currency:'NGN',merchant_note:'hardware-refund:x'});}catch{refundRefused=true;}
   check('S-REFUND-DENIED','a refund dispatch is refused and stops the run without any provider request',refundRefused&&provider.requests.length===4&&A.status().run_stopped);
  }finally{await new Promise(x=>server.close(x));}

  // ---- Run B: initialization response lost after the provider accepted it; restart verifies, never re-initializes.
  const B=newRun('B');runs.push(B);B.arm();const base=provider.requests.length;
  provider.faults.loseInit=true;await B.fresh().payments.initialize(B.a);
  check('S-LOST-INIT','lost initialization response is recorded uncertain and the run continues',B.attempt()==='uncertain'&&!B.status().run_stopped&&B.order()==='not_started|held|0');
  await B.fresh().payments.initialize(B.a);
  check('S-LOST-NO-RETRY','restart verifies the original reference instead of initializing again',provider.requests.length-base===2&&provider.requests.at(-1).method==='GET'&&B.order()==='not_started|held|0');
  checkout(B.a.reference);await B.fresh().payments.reconcile(B.a.reference);
  check('S-LOST-RECOVERED','the original reference is confirmed once after checkout',B.order()==='paid|allocated|1'&&JSON.stringify(B.counter.summary().dispatched)==='{"initialize":1,"refund":0,"read":2}');

  // ---- Runs C/D/E: provider evidence mismatches stop the run and never mark Office paid.
  for(const [name,mutate,code] of [['C',t=>({amount:9999}),'amount'],['D',t=>({currency:'USD'}),'currency'],['E',t=>({reference:'hwo_'+'f'.repeat(32)}),'reference'],['F',t=>({domain:'live'}),'domain']]){
   const R=newRun(name);runs.push(R);R.arm();await R.fresh().payments.initialize(R.a);checkout(R.a.reference);
   provider.faults.mutate=mutate;try{await R.fresh().payments.reconcile(R.a.reference);}catch{}provider.faults.mutate=undefined;
   check('S-MISMATCH-'+code.toUpperCase(),code+' mismatch in provider evidence stops the run and leaves Office unpaid',R.status().run_stopped&&R.order()==='not_started|held|0'&&R.attempt()!=='confirmed',{order:R.order(),attempt:R.attempt()});
  }

  // ---- Run G: provider counter budget is independent of the ledger: exhausted reads send nothing.
  const G=newRun('G');runs.push(G);G.arm();await G.fresh().payments.initialize(G.a);const gBase=provider.requests.length;
  for(let i=0;i<3;i++)G.counter.reserve('GET','/transaction/verify/'+G.a.reference,G.a.reference)&&G.counter.complete(G.counter.rows.at(-1).seq,'ok',200,1);
  checkout(G.a.reference);await G.fresh().payments.reconcile(G.a.reference);
  check('S-COUNTER-BACKSTOP','with the counter exhausted, verification is refused before sending and Office stays unpaid',provider.requests.length===gBase&&G.order()==='not_started|held|0'&&G.counter.summary().denied===1);

  {const w=JSON.parse(walletsBefore),names=[...w.office.map(x=>'office:'+x[0]),...w.backend.map(x=>'backend:'+x[0])];
   // ---- Run H: an order email other than the manifest-bound inbox is refused before any provider request.
  const H=newRun('H');runs.push(H);H.arm();const hBase=provider.requests.length;H.a.email='someone-else@payments-test.getoyi.com';
  await H.fresh().payments.initialize(H.a).catch(()=>{});
  check('S-INBOX-BOUND','an email other than the approved inbox sends nothing, stops the run and leaves Office unpaid',provider.requests.length===hBase&&H.status().run_stopped&&H.order()==='not_started|held|0'&&H.counter.summary().records===0,{attempt:H.attempt()});

  check('S-WALLETS','no wallet table changed ('+(names.join(', ')||'no wallet tables present')+')',walletSnap()===walletsBefore&&w.backend.length===0);}
  check('S-EVIDENCE','all provider responses were synthetic; no request left the process',provider.requests.every(r=>r.key_is_test));
 }finally{
  for(const r of runs){try{r.counter.release();}catch{}if(one(`select state from hardware_reservations where order_id='${r.a.order_id}'`)==='held')run(`select hardware_reservation_finish('${r.a.order_id}','released','fixture','Single-payment mock test cleanup')`);}
  for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  fs.rmSync(root,{recursive:true,force:true});
 }
};
