'use strict';
// Shared by the future armed relay and offline tests. Never enables the running relay.
const REF=/^hwo_[a-f0-9]{32}$/;
function validate(method,path,body,ledger){
 if(typeof path!=='string'||path.includes('%')||path.includes('..')||path.includes('#')||path.includes('\\'))throw Error('route_denied');
 const ownedRef=r=>REF.test(r)&&ledger.references.includes(r);
 const ownedId=id=>/^[1-9][0-9]{0,39}$/.test(id)&&ledger.transactions.includes(id);
 if(method==='POST'&&path==='/transaction/initialize'){
  if(!body||Object.keys(body).some(k=>!['reference','amount','currency','email','callback_url','metadata'].includes(k))||!ownedRef(body.reference)||!Number.isSafeInteger(body.amount)||body.amount<1||body.amount>10000||body.amount!==ledger.amounts[body.reference]||body.currency!=='NGN'||body.callback_url!=='https://localhost:18443/hardware/checkout'||!(ledger.customerEmail!==undefined?body.email===ledger.customerEmail:/^setup-[a-z0-9-]+@example\.invalid$/.test(body.email)))throw Error('initialization_denied');
  {const m=body.metadata,a=ledger.authorizations?.[body.reference];if(!m||!a||Object.keys(m).sort().join(',')!=='authorization_hash,order_id,purpose,reservation_id'||m.purpose!=='hardware_order'||m.order_id!==a.order_id||m.reservation_id!==a.reservation_id||m.authorization_hash!==a.authorization_hash)throw Error('authorization_binding_denied');}return;
 }
 if(method==='GET'&&path.startsWith('/transaction/verify/')&&ownedRef(path.slice(20))&&!body)return;
 if(method==='POST'&&path==='/refund'){
  const a=ledger.refundApprovals?.[body?.merchant_note];
  if(!body||Object.keys(body).sort().join(',')!=='amount,currency,merchant_note,transaction'||!ownedRef(body.transaction)||!Number.isSafeInteger(body.amount)||body.amount<1||body.amount>10000||body.amount!==ledger.paidAmounts[body.transaction]||body.currency!=='NGN'||!a||a.reference!==body.transaction||a.amount!==body.amount)throw Error('refund_denied');return;
 }
 if(method==='GET'&&!body){
  const list=/^\/refund\?transaction=([1-9][0-9]{0,39})&perPage=100&page=([1-9]|10)$/.exec(path);
  if(list&&ownedId(list[1]))return;
  if(/^\/refund\/[1-9][0-9]{0,39}$/.test(path)&&ledger.refunds.includes(path.slice(8)))return;
  if(path.startsWith('/dispute/transaction/')&&ownedId(path.slice(21)))return;
 }
 throw Error('route_denied');
}
module.exports={validate};
