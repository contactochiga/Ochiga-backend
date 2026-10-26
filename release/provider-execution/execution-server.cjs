'use strict';
const fs=require('fs'),express=require('express');
function singleInitializationPathAllowed(method,path){return method==='POST'&&path==='/initialize';}
function assertEnvironment(e){
 if(e.HARDWARE_SETUP_ONLY!=='true'||e.SUPABASE_URL!=='http://backend-rest:3000'||e.HARDWARE_TEST_CALLBACK_ORIGIN!=='https://localhost:18443'||e.HARDWARE_PAYSTACK_CALLBACK_URL!=='https://localhost:18443/hardware/checkout'||e.OFFICE_HARDWARE_PAYMENT_CONFIRM_URL!=='https://office.hardware.test/api/commerce/payments/confirm'||e.OFFICE_HARDWARE_FINANCIAL_URL!=='https://office.hardware.test/api/commerce/payments/operations')throw Error('isolated_execution_binding_required');
 for(const k of ['PAYSTACK_SECRET_KEY','PAYSTACK_SECRECT_KEY','DATABASE_URL','RESEND_API_KEY','SMTP_HOST'])if(e[k])throw Error('wallet_or_customer_binding_denied');
 if(e.HARDWARE_EXECUTION_PROFILE==='single-initialization-only'){
  if(e.HARDWARE_PAYMENT_INITIALIZATION_ENABLED!=='true'||e.HARDWARE_PAYMENT_PROCESSING_ENABLED!=='false'||e.HARDWARE_FINANCIAL_RECOVERY_ENABLED!=='false'||e.HARDWARE_REFUNDS_ENABLED!=='false')throw Error('single_initialization_only_flags_required');
 }else{
  for(const k of ['HARDWARE_PAYMENT_INITIALIZATION_ENABLED','HARDWARE_PAYMENT_PROCESSING_ENABLED','HARDWARE_FINANCIAL_RECOVERY_ENABLED','HARDWARE_REFUNDS_ENABLED'])if(e[k]!=='true')throw Error('explicit_execution_flags_required');
 }
 for(const k of ['OFFICE_HARDWARE_PAYMENT_CONFIRM_KEY','OFFICE_HARDWARE_FINANCIAL_KEY','HARDWARE_OFFICE_API_KEY'])if(!e[k]||e[k].length<32)throw Error('isolated_scope_missing');
 if(e.OFFICE_HARDWARE_PAYMENT_CONFIRM_KEY===e.OFFICE_HARDWARE_FINANCIAL_KEY)throw Error('separate_scopes_required');
}
function app(){
 if(process.env.HARDWARE_BOUNDED_EXECUTION_ENABLED!=='true')return require('../../dist/commerce/hardwareSetupServer').setupApp();
 assertEnvironment(process.env);
 // Read the root-owned read-only key mount, then drop privileges before opening the run volume.
 const {setupWebhookSigningKey}=require('../../dist/commerce/hardwareSetupServer');
 const signingKey=setupWebhookSigningKey({...process.env,HARDWARE_TEST_WEBHOOK_KEY_FILE:'/run/secrets/hardware-test-key'});
 if(process.getuid()!==0)throw Error('controlled_privilege_drop_required');
 process.setgroups([]);process.setgid(1000);process.setuid(1000);
 const config=JSON.parse(fs.readFileSync('/run/execution/config.json','utf8'));
 if(config.mode!=='real-provider'||config.database!=='/run/execution/run.sqlite')throw Error('execution_config_invalid');
 const {bridge,createBoundedServices}=require('./integration.cjs');bridge(config,'plan');
 const {hardwareRecoveryDependencies}=require('../../dist/commerce/hardwareRecoveryRoutes');
 const d=hardwareRecoveryDependencies();d.secret=signingKey;d.provider=require('./relay-client.cjs').relayClient();
 const services=createBoundedServices(d,config);
 const {hardwareRoutes,hardwareWebhookHandler}=require('../../dist/commerce/hardwarePaymentRoutes');
 const a=express();a.disable('x-powered-by');
 if(process.env.HARDWARE_EXECUTION_PROFILE==='single-initialization-only'){
  a.use('/hardware-payments',(q,r,next)=>{if(!singleInitializationPathAllowed(q.method,q.path))return r.sendStatus(404);next();});
 }else a.post('/hardware-payments/webhook',express.raw({type:'application/json',limit:'256kb'}),hardwareWebhookHandler(()=>services.payments));
 a.use('/hardware-payments',express.json({limit:'16kb'}),hardwareRoutes(()=>services.payments));
 // The existing router authenticates every /hardware-payments path before falling through.
 // Refunds come exclusively from Office's independently approved queue, never request bodies.
 if(process.env.HARDWARE_EXECUTION_PROFILE!=='single-initialization-only'){
  a.post('/hardware-payments/recover',async(q,r)=>{if(Object.keys(q.body||{}).join(',')!=='reference')return r.sendStatus(400);try{await services.recovery.sweep(q.body.reference);r.json({accepted:true});}catch{r.status(503).json({error:'bounded_recovery_incomplete'});}});
  a.post('/hardware-payments/replay',async(q,r)=>{if(Object.keys(q.body||{}).join(',')!=='reference')return r.sendStatus(400);try{const raw=Buffer.from(JSON.stringify({event:'charge.success',data:{reference:q.body.reference}}));const signature=require('crypto').createHmac('sha512',d.secret).update(raw).digest('hex');await services.payments.replayWebhook(raw,signature);r.json({accepted:true,evidence:'injected-signed-replay'});}catch{r.sendStatus(503);}});
 }
 a.use((_q,r)=>r.sendStatus(404));return a;
}
if(require.main===module){try{app().listen(3000,'0.0.0.0');}catch{console.error('isolated_execution_startup_denied');process.exitCode=1;}}
module.exports={app,assertEnvironment,singleInitializationPathAllowed};
