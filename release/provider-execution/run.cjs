'use strict';
// Controller for already-authorized isolated services; no direct provider access.
// It cannot arm a run, switch flags, alter credentials or approve refunds.
const fs=require('fs');const {bridge}=require('./integration.cjs');
const {paymentStartDiagnostics}=require('./payment-start-diagnostics.cjs');
const RUNNER_ERRORS=new Set(['test_config_required','unknown_run_action','single_initialization_only','single_payment_only','reservation_hold_insufficient','reservation_status_unavailable','scenario_not_approved','fixture_binding_changed','execution_disabled','execution_state_missing','execution_state_inconsistent','execution_state_unavailable','execution_plan_missing','plan_mismatch','reference_outside_plan','fresh_disabled_run_required']);
// Single payment: live reservation time left, read from Office's existing checkout status projection (no provider call).
const HOLD_MIN_INITIALIZE_S=600,HOLD_MIN_CHECKOUT_S=300;
async function holdSeconds(f,key,now=Date.now){
 let r;try{r=await fetch('https://office.hardware.test/api/commerce/checkout/status',{method:'POST',headers:{'content-type':'application/json','x-api-key':key},body:JSON.stringify({id:f.order_id,guest_hash:f.guest_hash}),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('reservation_status_unavailable');}
 const v=r.ok?(await r.json())?.order?.reservation:null,expires=Date.parse(v?.expires_at);
 if(!v||!Number.isFinite(expires))throw Error('reservation_status_unavailable');
 return v.state==='held'?Math.floor((expires-now())/1000):0;
}
function safeRunnerCode(error){return RUNNER_ERRORS.has(error?.message)?error.message:'runner_preflight_failed';}
function saveRunnerDiagnostic(file,code){try{fs.writeFileSync(file,JSON.stringify({boundary:'runner_preflight_rejection',error_code:code,office_http_status:null,office_error_code:null,payment_start_eligibility:'not_checked',financial_dispatch_authorization:'not_authorized',dispatch_ticket_issued:false})+'\n',{flag:'wx',mode:0o600});}catch{}}
async function main(){
 let config,action=process.argv[2],scenario=process.argv[3],diagnosticFile;
 try{
 config=JSON.parse(fs.readFileSync('/run/execution/config.json','utf8'));
 if(config.mode!=='real-provider'||config.database!=='/run/execution/run.sqlite')throw Error('test_config_required');
 const singlePayment=config.manifest.execution_profile==='single-payment-acceptance';
 if(!(singlePayment?['initialize','verify','hold']:['initialize','reconcile','replay']).includes(action))throw Error('unknown_run_action');
 const file='/run/execution/hosted-'+scenario+'.json';
 diagnosticFile='/run/execution/payment-start-diagnostic-'+scenario+'.json';
 const runnerDiagnosticFile='/run/execution/runner-diagnostic-'+scenario+'.json';
 if(action==='initialize'&&(fs.existsSync(file)||fs.existsSync(diagnosticFile)||fs.existsSync(runnerDiagnosticFile))){console.log(JSON.stringify({scenario,state:'previous_attempt_recorded',replayed:false}));return;}
 const plan=bridge(config,'plan');
 if(config.manifest.execution_profile==='single-initialization-only'&&(action!=='initialize'||scenario!=='single_initialization'||plan.length!==1||plan[0].scenario!=='single_initialization'))throw Error('single_initialization_only');
 if(singlePayment&&(scenario!=='single_payment'||plan.length!==1||plan[0].scenario!=='single_payment'))throw Error('single_payment_only');
 const entry=plan.find(x=>x.scenario===scenario);if(!entry)throw Error('scenario_not_approved');
 const fixed='http://hardware-setup-backend:3000/hardware-payments/';
 const serviceKey=fs.readFileSync('/run/secrets/isolated-backend-key','utf8').trim();
 let body={reference:entry.reference},endpoint='recover';
 if(action==='hold'){
  const f=JSON.parse(fs.readFileSync('/run/execution/scenario-orders.json','utf8'))[scenario];if(!f||'hwo_'+f.order_id.replaceAll('-','')!==entry.reference)throw Error('fixture_binding_changed');
  const s=await holdSeconds(f,fs.readFileSync('/run/secrets/isolated-checkout-key','utf8').trim());
  console.log(JSON.stringify({scenario,action,reservation_seconds_remaining:Math.max(0,s),checkout_allowed:s>=HOLD_MIN_CHECKOUT_S,provider_calls:0}));return;
 }
 if(action==='initialize'){
  const fixtures=JSON.parse(fs.readFileSync('/run/execution/scenario-orders.json','utf8')),f=fixtures[scenario];
  if(!f||'hwo_'+f.order_id.replaceAll('-','')!==entry.reference||f.amount_kobo!==entry.amount)throw Error('fixture_binding_changed');
  const key=fs.readFileSync('/run/secrets/isolated-checkout-key','utf8').trim();
  // Single payment: at least 10 minutes of live hold before Office payment-start (and so before any provider call).
  if(singlePayment&&await holdSeconds(f,key)<HOLD_MIN_INITIALIZE_S)throw Error('reservation_hold_insufficient');
  // Read-only quote first; then the existing Office payment-start boundary. Never call Paystack here.
  const result=await paymentStartDiagnostics({
   bridge:(action)=>bridge(config,action),
   checkoutUrl:'https://office.hardware.test/api/commerce/checkout',
   checkoutKey:key,
   order:{id:f.order_id,guest_hash:f.guest_hash},
   expectedAmountKobo:entry.amount,
   diagnosticFile,
   hostedResultFile:file,
   timeoutMs:30000
  });
  console.log(JSON.stringify({scenario,state:result.ok?'office_response_recorded':'payment_start_refused',diagnostic_file:diagnosticFile,private_result_file:result.ok?file:null,diagnostic:result.diagnostic}));
  if(!result.ok)process.exitCode=1;
  return;
 }
 if(action==='replay'){endpoint='replay';body={reference:entry.reference};}
 // Single payment: one reference-scoped verification read through HardwarePayments (budget: three per run).
 if(action==='verify')endpoint='reconcile';
 const r=await fetch(fixed+endpoint,{method:'POST',headers:{'content-type':'application/json','x-api-key':serviceKey},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('bounded_operation_incomplete');
 const status=action==='verify'?bridge(config,'status'):undefined;
 console.log(JSON.stringify({scenario,action,accepted:true,evidence:action==='replay'?'injected-signed-replay':'provider-verification-required',...(status?{ledger:{intent_states:status.intent_states,provider_dispatch_count:status.provider_dispatch_count}}:{})}));
 }catch(error){
  const code=safeRunnerCode(error);
  if(action==='initialize'&&diagnosticFile){const name='/run/execution/runner-diagnostic-'+scenario+'.json';saveRunnerDiagnostic(name,code);}
  const e=new Error('bounded_run_refused_or_incomplete');e.safeDiagnostic={boundary:'runner_preflight_rejection',error_code:code,office_http_status:null,office_error_code:null,payment_start_eligibility:'not_checked',financial_dispatch_authorization:'not_authorized',dispatch_ticket_issued:false};throw e;
 }
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(e.safeDiagnostic||{boundary:'runner_preflight_rejection',error_code:'runner_preflight_failed'}));process.exitCode=1;});
module.exports={main,safeRunnerCode,saveRunnerDiagnostic,holdSeconds,HOLD_MIN_INITIALIZE_S,HOLD_MIN_CHECKOUT_S};
