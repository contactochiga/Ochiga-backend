const a=require('assert/strict'),{validate:v}=require('./policy.cjs');
const ref='hwo_'+'a'.repeat(32),l={references:[ref],transactions:['123'],refunds:['456'],amounts:{[ref]:10000},paidAmounts:{123:10000},approvedRefunds:['123']};
let n=0;const ok=(m,p,b)=>{v(m,p,b,l);n++},no=(m,p,b)=>{a.throws(()=>v(m,p,b,l));n++};
const b={reference:ref,amount:10000,currency:'NGN',email:'setup-success@example.invalid',callback_url:'https://localhost:18443/hardware/checkout'};
ok('POST','/transaction/initialize',b);ok('GET','/transaction/verify/'+ref);ok('POST','/refund',{transaction:'123',amount:10000});ok('GET','/refund/456');ok('GET','/refund?transaction=123');ok('GET','/dispute/transaction/123');
for(const p of ['/transaction/initialize?x=1','https://api.paystack.co/transaction/initialize','/transfer','/wallets/webhook','/refund/999','/transaction/verify/hwo_fake','/refund?transaction=123&x=1','/refund/%34%35%36'])no('GET',p);
for(const x of [{amount:10001},{amount:9999},{currency:'USD'},{email:'customer@example.com'},{callback_url:'https://getoyi.com/hardware/checkout'},{reference:'hwo_'+'b'.repeat(32)},{metadata:{}}])no('POST','/transaction/initialize',{...b,...x});
no('POST','/refund',{transaction:'123',amount:9999});no('POST','/refund',{transaction:'999',amount:10000});no('DELETE','/refund/456');console.log(n+' strict financial-route checks PASS; no network requests');
