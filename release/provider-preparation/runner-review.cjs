'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
function validate(m){
 assert.equal(m.mode,'preparation-only');assert.equal(m.authorized,false);assert.equal(m.currency,'NGN');assert.equal(m.environment,'test');
 for(const [k,max] of Object.entries({max_payment_initializations:12,max_payment_kobo:10000,max_total_payment_kobo:120000,max_refund_initializations:3,max_refund_kobo:10000,max_provider_reads:60,max_webhook_replays:3,max_duration_minutes:60})){assert(Number.isSafeInteger(m[k])&&m[k]>0&&m[k]<=max,k);}
 assert.deepEqual(m.scenarios.map(s=>s.id).sort(),['success','declined','delayed_success','duplicate_webhook','redirect_only','amount_mismatch','reference_mismatch','expired_reservation','office_outage','refund_processed','refund_failed','refund_attention'].sort());
 const approved=['real-provider','real-provider-plus-injected-network-fault','real-event-plus-controlled-replay','injected-browser-action','injected-verification-fault','real-provider-plus-controlled-expiry','real-provider-plus-injected-office-fault','real-provider-if-supported'];
 for(const s of m.scenarios)assert(approved.includes(s.evidence));
 return crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex');
}
class Budget {
 constructor(m){validate(m);this.m=m;this.payment=0;this.refund=0;this.total=0;this.intents=new Map();this.stopped=false;}
 reserve(kind,id,amount){
  if(this.stopped)throw Error('run_stopped');
  try{
   assert(['payment','refund'].includes(kind));assert(/^hwo_[a-f0-9]{32}$/.test(id));assert(Number.isSafeInteger(amount)&&amount>0&&amount<=this.m[kind==='payment'?'max_payment_kobo':'max_refund_kobo']);
   const intent=kind+':'+id;if(this.intents.has(intent)){assert.equal(this.intents.get(intent),amount);return false;}
   assert(this[kind]<this.m[kind==='payment'?'max_payment_initializations':'max_refund_initializations']);
   if(kind==='payment')assert(this.total+amount<=this.m.max_total_payment_kobo);
   this[kind]++;if(kind==='payment')this.total+=amount;this.intents.set(intent,amount);return true;
  }catch{this.stopped=true;throw Error('run_limit_or_input_violation');}
 }
}
if(require.main===module){
 if(process.argv[2]!=='--review'){console.error('provider_execution_not_authorized');process.exit(1);}
 const m=JSON.parse(fs.readFileSync(path.join(__dirname,'run-manifest.json'),'utf8'));
 console.log(JSON.stringify({manifest_sha256:validate(m),mode:m.mode,provider_calls:0,scenarios:m.scenarios}));
}
module.exports={validate,Budget};
