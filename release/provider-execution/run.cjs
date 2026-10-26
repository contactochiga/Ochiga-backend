'use strict';
// Controller for already-authorized isolated services; no direct provider access.
// It cannot arm a run, switch flags, alter credentials or approve refunds.
const fs=require('fs'),path=require('path');const {bridge}=require('./integration.cjs');
async function main(){
 const config=JSON.parse(fs.readFileSync('/run/execution/config.json','utf8'));
 if(config.mode!=='real-provider'||config.database!=='/run/execution/run.sqlite')throw Error('test_config_required');
 const plan=bridge(config,'plan');
 const action=process.argv[2],scenario=process.argv[3];
 if(!['initialize','reconcile','replay'].includes(action))throw Error('unknown_run_action');
 const entry=plan.find(x=>x.scenario===scenario);if(!entry)throw Error('scenario_not_approved');
 const fixed='http://hardware-setup-backend:3000/hardware-payments/';
 const serviceKey=fs.readFileSync('/run/secrets/isolated-backend-key','utf8').trim();
 let body={reference:entry.reference},endpoint='recover';
 if(action==='initialize'){
  const fixtures=JSON.parse(fs.readFileSync('/run/execution/scenario-orders.json','utf8')),f=fixtures[scenario];
  if(!f||'hwo_'+f.order_id.replaceAll('-','')!==entry.reference||f.amount_kobo!==entry.amount)throw Error('fixture_binding_changed');
  const file='/run/execution/hosted-'+scenario+'.json';
  if(fs.existsSync(file)){console.log(JSON.stringify({scenario,state:'previous_response_recorded',private_result_file:file,replayed:true}));return;}
  const key=fs.readFileSync('/run/secrets/isolated-checkout-key','utf8').trim();
  // Office remains the authority; this endpoint authorizes and invokes existing Backend initialization.
  const r=await fetch('https://office.hardware.test/api/commerce/checkout/payment-start',{method:'POST',headers:{'content-type':'application/json','x-api-key':key},body:JSON.stringify({id:f.order_id,guest_hash:f.guest_hash,accepted_total_kobo:entry.amount}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('office_payment_start_unavailable');
  const result=await r.json();
  // Hosted URLs are private output artifacts, never stdout/logged or committed.
  fs.writeFileSync(file,JSON.stringify(result),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({scenario,state:'office_response_recorded',private_result_file:file}));return;
 }
 if(action==='replay'){endpoint='replay';body={reference:entry.reference};}
 const r=await fetch(fixed+endpoint,{method:'POST',headers:{'content-type':'application/json','x-api-key':serviceKey},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('bounded_operation_incomplete');console.log(JSON.stringify({scenario,action,accepted:true,evidence:action==='replay'?'injected-signed-replay':'provider-verification-required'}));
}
if(require.main===module)main().catch(()=>{console.error('bounded_run_refused_or_incomplete; preserve state and inspect redacted ledger');process.exitCode=1;});
module.exports={main};
