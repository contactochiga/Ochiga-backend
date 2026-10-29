const assert=require('assert/strict'),{validate,Budget}=require('../release/provider-preparation/runner-review.cjs');
const m=require('../release/provider-preparation/run-manifest.json');validate(m);let count=1;
for(const [key,value] of Object.entries({authorized:true,environment:'live',currency:'USD',max_payment_kobo:10001,max_total_payment_kobo:120001,max_refund_initializations:4})){assert.throws(()=>validate({...m,[key]:value}));count++;}
const b=new Budget(m),ref=i=>'hwo_'+i.toString(16).padStart(32,'0');
for(let i=0;i<12;i++){assert(b.reserve('payment',ref(i),10000));assert.equal(b.reserve('payment',ref(i),10000),false);count+=2;}
assert.throws(()=>b.reserve('payment',ref(12),10000));assert.throws(()=>b.reserve('refund',ref(1),100));count+=2;
const r=new Budget(m);for(let i=0;i<3;i++)assert(r.reserve('refund',ref(i),10000));assert.throws(()=>r.reserve('refund',ref(4),10000));count+=4;
const conflict=new Budget(m);conflict.reserve('payment',ref(1),10000);assert.throws(()=>conflict.reserve('payment',ref(1),9999));count++;
assert.throws(()=>validate({...m,scenarios:m.scenarios.map((s,i)=>i? s:{...s,id:'unreviewed'})}));count++;
console.log(count+' bounded-runner review checks PASS; provider calls=0');
