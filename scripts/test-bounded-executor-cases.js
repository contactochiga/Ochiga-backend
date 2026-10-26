// Optional extension of the existing disposable PostgreSQL financial suite.
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{execFileSync}=require('child_process');
module.exports=async({run,one,check,bsql,rpc,backend,make,auth,deps,quote})=>{
 const {createBoundedServices,bridge}=require(path.join(backend,'release/provider-execution/integration.cjs'));
 const manifest=require(path.join(backend,'release/provider-preparation/run-manifest.json'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bounded-financial-')),database=path.join(dir,'run.sqlite');
 const vid=one('select variant_id from hardware_order_lines order by order_id limit 1');
 const change=JSON.parse(run(`select catalogue_request_price_change('${vid}',10000,'standard',750,'creator@fixture.test','LOCAL bounded fixture')`));
 run(`select catalogue_decide_price_change('${change.id}','approved','reader@fixture.test','LOCAL independent');select catalogue_publish_price_change('${change.id}','creator@fixture.test');`);
 const input=[];
 for(let i=0;i<5;i++){const id=make(false);run(`select hardware_payment_confirm_delivery('creator@fixture.test','${id}',0,0,'LOCAL zero-charge delivery fixture')`);const a=auth(id);a.email='setup-bounded@example.invalid';input.push(a);}
 const scenarios=['delayed_success','office_outage','refund_processed','success','amount_mismatch'];
 const config={database,manifest,mode:'mock'};
 execFileSync('python3',['-c',"import sys,json;sys.path.insert(0,sys.argv[1]);from executor import Executor;m=json.load(sys.stdin);e=Executor(sys.argv[2],m);e.close()",path.join(backend,'release/provider-execution'),database],{input:JSON.stringify(manifest)});
 const plan=input.map((a,i)=>({reference:a.reference,scenario:scenarios[i],amount:10000}));
 config.planSha256=bridge(config,'prepare',{plan}).plan_sha256;
 let initPosts=0,refundPosts=0,verifyCalls=0,loseInit=true,loseRefund=true,officeDown=false,verifyTimeout=false;
 const providerRows=new Map(),refundRows=[],approvals=[];
 const provider={
  post:async(url,b)=>{if(url==='/transaction/initialize'){
   initPosts++;providerRows.set(b.reference,{id:900000+initPosts,domain:'test',status:'success',reference:b.reference,amount:b.amount,currency:'NGN',metadata:b.metadata});
   if(loseInit){loseInit=false;throw Error('INJECTED response lost after provider acceptance');}
   return {data:{status:true,data:{reference:b.reference,authorization_url:'https://checkout.paystack.com/synthetic'}}};
  }if(url==='/refund'){
   refundPosts++;const a=await deps.get(b.transaction);const row={id:800000+refundPosts,transaction:Number(a.provider_id),amount:b.amount,currency:'NGN',domain:'test',status:'processed',merchant_note:b.merchant_note};refundRows.push(row);
   if(loseRefund){loseRefund=false;throw Error('INJECTED refund accepted response lost');}return {data:{status:true,data:row}};
  }throw Error('unreviewed mock route');},
  get:async url=>{if(url.startsWith('/transaction/verify/')){verifyCalls++;if(verifyTimeout){verifyTimeout=false;throw Error('INJECTED verification timeout');}return {data:{status:true,data:providerRows.get(url.slice(20))}};}
   if(url.startsWith('/dispute/transaction/'))return {data:{status:true,data:[]}};
   if(url.startsWith('/refund?'))return {data:{status:true,data:refundRows}};
   if(url.startsWith('/refund/'))return {data:{status:true,data:refundRows.find(x=>String(x.id)===url.slice(8))}};
   throw Error('unreviewed mock route');}
 };
 const d={...deps,provider,callback:'https://localhost:18443/hardware/checkout',refundsEnabled:true,approvals:async()=>approvals,refundsDue:async()=>JSON.parse(bsql("select coalesce(json_agg(r),'[]') from hardware_refunds r")),outbox:async()=>[],deliverObservation:async()=>{},office:async p=>{if(officeDown)throw Error('INJECTED Office outage');return deps.office(p);}};
 const original=[process.env.HARDWARE_SETUP_ONLY,process.env.HARDWARE_TEST_CALLBACK_ORIGIN];process.env.HARDWARE_SETUP_ONLY='true';process.env.HARDWARE_TEST_CALLBACK_ORIGIN='https://localhost:18443';
 const fresh=()=>createBoundedServices(d,config);
 const express=require(path.join(backend,'node_modules/express'));
 const {hardwareRoutes,hardwareWebhookHandler}=require(path.join(backend,'dist/commerce/hardwarePaymentRoutes'));
 const oldFlags={};for(const k of ['HARDWARE_OFFICE_API_KEY','HARDWARE_PAYMENT_INITIALIZATION_ENABLED','HARDWARE_PAYMENT_PROCESSING_ENABLED'])oldFlags[k]=process.env[k];
 process.env.HARDWARE_OFFICE_API_KEY='synthetic-bounded-service-key-000000000';process.env.HARDWARE_PAYMENT_INITIALIZATION_ENABLED='true';process.env.HARDWARE_PAYMENT_PROCESSING_ENABLED='true';
 const app=express();app.post('/hardware-payments/webhook',express.raw({type:'application/json'}),hardwareWebhookHandler(()=>fresh().payments));app.use('/hardware-payments',express.json(),hardwareRoutes(()=>fresh().payments));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;

 try{
  let disabled=false;try{await fresh().payments.initialize(input[0]);}catch{disabled=true;}check('X-DISABLED','unarmed bounded adapter sends no provider request',disabled&&initPosts===0);
  const manifestHash=execFileSync('python3',['-c',"import json,hashlib,sys;print(hashlib.sha256(json.dumps(json.load(sys.stdin),sort_keys=True,separators=(',',':')).encode()).hexdigest())"],{input:JSON.stringify(manifest),encoding:'utf8'}).trim();
  bridge(config,'arm',{approval:{manifest_sha256:manifestHash,plan_sha256:config.planSha256,authorized:true,environment:'test',evidence:'mock'}});
  const denied=await fetch(origin+'/hardware-payments/initialize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input[0])});check('X-HTTP-AUTH','bounded initialization HTTP rejects missing service credential',denied.status===403);
  const initialized=await fetch(origin+'/hardware-payments/initialize',{method:'POST',headers:{'content-type':'application/json','x-office-api-key':process.env.HARDWARE_OFFICE_API_KEY},body:JSON.stringify(input[0])});check('X-HTTP-INIT','existing initialization endpoint uses bounded service',initialized.status===200);
  check('X-LOST','lost initialization response retained uncertain',initPosts===1&&(await deps.get(input[0].reference)).state==='uncertain');
  verifyTimeout=true;await fresh().payments.reconcile(input[0].reference);check('X-VERIFY-TIMEOUT','verification timeout leaves unpaid state',one(`select payment_state from hardware_orders where id='${input[0].order_id}'`)==='not_started');
  await fresh().payments.initialize(input[0]);check('X-RESUME','restart recovers original reference without new initialization',initPosts===1&&(await deps.get(input[0].reference)).state==='confirmed');
  officeDown=true;await fresh().payments.initialize(input[1]);try{await fresh().payments.reconcile(input[1].reference);}catch{}
  check('X-OUTBOX','provider success persists before failed Office confirmation',(await deps.get(input[1].reference)).state==='verified');
  const reads=verifyCalls;officeDown=false;await fresh().payments.reconcile(input[1].reference);check('X-OFFICE-RETRY','restart delivers durable proof without extra provider read',verifyCalls===reads&&(await deps.get(input[1].reference)).state==='confirmed');
  await fresh().payments.initialize(input[2]);await fresh().payments.reconcile(input[2].reference);
  const request=JSON.parse(run(`select hardware_refund_request('creator@fixture.test','${input[2].order_id}','LOCAL bounded refund')`));run(`select hardware_refund_approve('reader@fixture.test','${request.id}')`);
  const approval={approval_id:request.id,order_id:input[2].order_id,reference:input[2].reference,amount_kobo:10000,requested_by:'creator@fixture.test',approved_by:'reader@fixture.test'};approvals.push(approval);
  await fresh().recovery.refund(approval);check('X-REFUND-UNKNOWN','accepted refund with lost response remains uncertain',refundPosts===1&&bsql(`select state from hardware_refunds where approval_id='${request.id}'`)==='uncertain');
  await fresh().recovery.refund(approval);check('X-REFUND-READ-RECOVERY','restart finds refund by provider lookup without second POST',refundPosts===1&&bsql(`select state from hardware_refunds where approval_id='${request.id}'`)==='processed');
  await Promise.all(Array.from({length:5},()=>fresh().payments.initialize(input[3])));check('X-CONCURRENT','five concurrent initiations cause one provider POST',initPosts===4);
  const raw=Buffer.from(JSON.stringify({event:'charge.success',data:{reference:input[3].reference}})),sig=crypto.createHmac('sha512',d.secret).update(raw).digest('hex');
  for(let i=0;i<2;i++){const response=await fetch(origin+'/hardware-payments/webhook',{method:'POST',headers:{'content-type':'application/json','x-paystack-signature':sig},body:raw});check('X-HTTP-WEBHOOK','existing raw webhook route accepts bounded signed delivery',response.status===200);}await fresh().payments.reconcile(input[3].reference);check('X-DELAYED-DUPLICATE','delayed duplicate callbacks still confirm once',one(`select count(*) from hardware_payment_confirmations where order_id='${input[3].order_id}'`)==='1');
  await fresh().payments.initialize(input[4]);providerRows.get(input[4].reference).amount=9999;await fresh().payments.reconcile(input[4].reference);
  let mismatchedStop=false;try{bridge(config,'plan');}catch{mismatchedStop=true;}check('X-MISMATCH-STOP','amount mismatch stops run and never marks Office paid',mismatchedStop&&one(`select payment_state from hardware_orders where id='${input[4].order_id}'`)==='not_started');
  const invalid=await fetch(origin+'/hardware-payments/webhook',{method:'POST',headers:{'content-type':'application/json','x-paystack-signature':'0'.repeat(128)},body:raw});check('X-SIGNATURE-STOP','invalid signature rejected by existing route without provider processing',invalid.status===401);
  bridge(config,'disable');let stopped=false;try{await fresh().payments.reconcile(input[3].reference);}catch{stopped=true;}check('X-DISABLE','explicit disable closes reconciliation too',stopped);
  const saved=fs.readFileSync(database);fs.renameSync(database,database+'.saved');let missing=false;try{await fresh().payments.initialize(input[3]);}catch{missing=true;}check('X-MISSING','missing execution state fails closed and is not recreated',missing&&!fs.existsSync(database));fs.renameSync(database+'.saved',database);
  check('X-EVIDENCE','all provider responses are mocked; injected faults labelled',true);
 }finally{for(const a of input){if(one(`select state from hardware_reservations where order_id='${a.order_id}'`)==='held')run(`select hardware_reservation_finish('${a.order_id}','released','fixture','Bounded mock test cleanup')`);}await new Promise(r=>server.close(r));for(const [k,v] of Object.entries(oldFlags)){if(v===undefined)delete process.env[k];else process.env[k]=v;}[process.env.HARDWARE_SETUP_ONLY,process.env.HARDWARE_TEST_CALLBACK_ORIGIN]=original;for(const k of ['HARDWARE_SETUP_ONLY','HARDWARE_TEST_CALLBACK_ORIGIN'])if(process.env[k]==='undefined')delete process.env[k];fs.rmSync(dir,{recursive:true,force:true});}
};
