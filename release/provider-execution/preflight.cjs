'use strict';
// Run only after separate authorization; read-only Office quotes, zero provider calls.
const fs=require('fs'),{bridge}=require('./integration.cjs');
async function main(){
 const config=JSON.parse(fs.readFileSync('/run/execution/config.json','utf8'));
 try{
  const plan=bridge(config,'plan'),orders=JSON.parse(fs.readFileSync('/run/execution/scenario-orders.json','utf8')),key=fs.readFileSync('/run/secrets/isolated-checkout-key','utf8').trim();
  for(const p of plan){const f=orders[p.scenario];if(!f||'hwo_'+f.order_id.replaceAll('-','')!==p.reference)throw Error();
   const r=await fetch('https://office.hardware.test/api/commerce/checkout/payment-quote',{method:'POST',headers:{'content-type':'application/json','x-api-key':key},body:JSON.stringify({id:f.order_id,guest_hash:f.guest_hash}),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error();const {payment}=await r.json();if(payment?.eligible!==true||payment.amount_kobo!==p.amount||!Number.isSafeInteger(payment.amount_kobo)||payment.amount_kobo>10000||payment.payment_state!=='not_started')throw Error();
  }
  console.log(JSON.stringify({preflight:'PASS',orders:plan.length,provider_calls:0}));
 }catch{try{bridge(config,'stop',{reason:'authoritative_preflight_failed'});}catch{}throw Error('authoritative_preflight_failed');}
}
if(require.main===module)main().catch(()=>{console.error('authoritative_preflight_failed; no provider requests sent');process.exitCode=1;});
module.exports={main};
