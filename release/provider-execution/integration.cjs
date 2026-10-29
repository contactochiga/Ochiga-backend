'use strict';
// Budget orchestration only. Existing services/SQL remain the sole financial authority.
const {execFileSync}=require('child_process'),crypto=require('crypto'),path=require('path');
const {validate}=require('./policy.cjs');
const {HardwarePayments,validSignature}=require('../../dist/commerce/hardwarePayments');
const {HardwareRecovery}=require('../../dist/commerce/hardwareRecovery');
function bridge(config,action,fields={}){
 const q={database:config.database,manifest:config.manifest,mode:config.mode,plan_sha256:config.planSha256,action,...fields};
 let raw;try{raw=execFileSync(config.python||'python3',[path.join(__dirname,'bridge.py')],{input:JSON.stringify(q),encoding:'utf8',stdio:['pipe','pipe','pipe']});}
 catch(e){try{const b=JSON.parse(e.stdout);throw Error(b.error);}catch(x){throw Error(x.message==='Unexpected end of JSON input'?'execution_state_unavailable':x.message);}}
 const r=JSON.parse(raw);if(!r.ok)throw Error(r.error);return r.result;
}
const wireHash=(method,url,body)=>crypto.createHash('sha256').update(JSON.stringify({method,url,body:body===undefined?null:body})).digest('hex');
const opid=(s)=>'hwo_'+crypto.createHash('sha256').update(s).digest('hex').slice(0,32);
function validInitializationResponse(response,reference){
 try{const d=response?.data,p=d?.data,u=new URL(p?.authorization_url);return d?.status===true&&p?.reference===reference&&u.protocol==='https:'&&u.hostname==='checkout.paystack.com'&&!u.port&&!u.username&&!u.password;}catch{return false;}
}
function createBoundedServices(d,config){
 if(!['mock','real-provider'].includes(config.mode)||!d.secret.startsWith('sk_test_'))throw Error('test_only');
 // Real transport must be the fixed-destination relay adapter; never caller-selected Axios defaults.
 if(config.mode==='real-provider'&&d.provider.boundary!=='isolated-paystack-relay-v1')throw Error('isolated_transport_required');
 const check=reference=>bridge(config,'check',{reference});
 const stop=reason=>bridge(config,'stop',{reason});
 const observe=(reference,id,state)=>bridge(config,'record',{reference,id,state});
 async function policyLedger(ref){
  const p=check(ref),a=await d.get(ref),refunds=await d.refundsDue(),approvals=await d.approvals();
  return {references:[ref],amounts:{[ref]:p.amount},...(config.manifest?.customer_email!==undefined?{customerEmail:config.manifest.customer_email}:{}),authorizations:{[ref]:a},transactions:a?.provider_id?[String(a.provider_id)]:[],refunds:refunds.filter(x=>x.reference===ref&&x.provider_refund_id).map(x=>String(x.provider_refund_id)),paidAmounts:{[ref]:a?.proof?.amount_kobo},refundApprovals:Object.fromEntries(approvals.filter(x=>x.reference===ref).map(x=>['hardware-refund:'+x.approval_id,{reference:ref,amount:Number(x.amount_kobo)}]))};
 }
 async function request(method,url,body,options){
  let ref;
  if(url==='/transaction/initialize')ref=body.reference;
  else if(url==='/refund')ref=body.transaction;
  else if(url.startsWith('/transaction/verify/'))ref=url.slice(20);
  else {
   const due=bridge(config,'plan').map(x=>({reference:x.reference})),refunds=await d.refundsDue();
   const match=/^\/refund\/(\d+)$/.exec(url);
   if(match)ref=refunds.find(x=>String(x.provider_refund_id)===match[1])?.reference;
   else {const id=/^\/dispute\/transaction\/(\d+)$/.exec(url)?.[1]||/^\/refund\?transaction=(\d+)&perPage=100&page=(?:[1-9]|10)$/.exec(url)?.[1];
    if(id)for(const row of due){const a=await d.get(row.reference);if(String(a?.provider_id)===id){ref=a.reference;break;}}
   }
  }
  if(!ref){stop('unowned_route');throw Error('unowned_route');}
  const item=check(ref),ledger=await policyLedger(ref);
  try{validate(method,url,body,ledger);}catch{stop('route_or_amount_failure');throw Error('route_or_amount_failure');}
  const kind=method==='GET'?'read':url==='/refund'?'refund':'payment';
  const id=kind==='payment'?ref:kind==='refund'?opid(body.merchant_note):opid(crypto.randomUUID());
  const request_hash=wireHash(method,url,body);
  const {ticket}=bridge(config,'claim',{reference:ref,id,kind,amount:kind==='read'?0:body.amount,parent:kind==='refund'?ref:null,request_hash});
  let response;
  try{if(config.mode==='real-provider'){response=await d.provider.dispatch({ticket,reference:ref,method,url,body:body===undefined?null:body});}else{bridge(config,'consume',{reference:ref,ticket,request_hash});response=method==='GET'?await d.provider.get(url,options):await d.provider.post(url,body,options);}}
  catch(e){observe(ref,id,kind==='read'?'returned':'uncertain');throw Error('provider_transport_uncertain');}
  // Binding checks happen before existing services receive provider evidence.
  const p=response?.data?.data;
  if(url.startsWith('/transaction/verify/')&&response?.data?.status===true){
   const a=await d.get(ref);
   if(!p||p.domain!=='test'||p.reference!==ref||p.currency!=='NGN'||p.amount!==item.amount||p.metadata?.order_id!==a?.order_id||p.metadata?.reservation_id!==a?.reservation_id||p.metadata?.authorization_hash!==a?.authorization_hash||p.metadata?.purpose!=='hardware_order'){
    stop('provider_evidence_mismatch');throw Error('provider_evidence_mismatch');
   }
   observe(ref,ref,p.status==='success'?'verified_success':['failed','abandoned'].includes(p.status)?'verified_failure':'returned');
  }
  if(kind==='payment'&&(!validInitializationResponse(response,ref))){
   observe(ref,id,'uncertain');throw Error('initialization_response_uncertain');
  }
  if(kind==='refund'&&(response?.data?.status!==true||!p)){
   observe(ref,id,'uncertain');throw Error('refund_response_uncertain');
  }
  if((url.startsWith('/refund/')||kind==='refund')&&p){
   const a=await d.get(ref),tx=typeof p.transaction==='object'?p.transaction?.id:p.transaction;
   if(p.domain!=='test'||p.currency!=='NGN'||p.amount!==item.amount||String(tx)!==String(a.provider_id)){stop('refund_evidence_mismatch');throw Error('refund_evidence_mismatch');}
  }
  if(url.startsWith('/refund?')&&Array.isArray(p)){
   const a=await d.get(ref);
   const ours=p.filter(x=>typeof x.merchant_note==='string'&&ledger.refundApprovals[x.merchant_note]);
   if(ours.length>1){stop('multiple_refunds');throw Error('multiple_refunds');}
   for(const x of ours){const tx=typeof x.transaction==='object'?x.transaction?.id:x.transaction;
    if(x.domain!=='test'||x.currency!=='NGN'||x.amount!==item.amount||String(tx)!==String(a.provider_id)){stop('refund_evidence_mismatch');throw Error('refund_evidence_mismatch');}
    observe(ref,opid(x.merchant_note),'returned');
   }
  }
  observe(ref,id,'returned');return response;
 }
 const provider={get:(url,opts)=>request('GET',url,undefined,opts),post:(url,body,opts)=>request('POST',url,body,opts)};
 const scoped=async fn=>{const refs=new Set(bridge(config,'plan').map(x=>x.reference));return (await fn()).filter(x=>refs.has(x.reference));};
 const guarded={...d,provider,rpc:async(name,args)=>{const result=await d.rpc(name,args);if(['manual_reconciliation','escalated','amount_mismatch'].includes(args?.p_state)){stop('financial_exception');}return result;},due:()=>scoped(d.due),approvals:()=>scoped(d.approvals),refundsDue:()=>scoped(d.refundsDue),outbox:()=>scoped(d.outbox),office:async proof=>{check(proof.reference);const result=await d.office(proof);if(!['paid','refund_required'].includes(result?.payment_state)){stop('office_confirmation_mismatch');throw Error('office_confirmation_mismatch');}return result;}};
 const p=new HardwarePayments(guarded),r=new HardwareRecovery(guarded);
 const payments={initialize:input=>{check(input?.reference);return p.initialize(input);},reconcile:ref=>{check(ref);return p.reconcile(ref);},sweep:()=>p.sweep(),webhook:async(raw,signature)=>{
  if(!validSignature(raw,signature,d.secret)){
   // A reachable test ingress must not let an unsigned request halt the run before the authorized payment is
   // verified; it is refused and durably noted instead. Other profiles keep the stricter stop.
   if(config.manifest?.execution_profile==='single-payment-acceptance'){try{bridge(config,'note',{event:'webhook_signature_rejected'});}catch{}}
   else stop('signature_failure');
   throw Error('invalid_signature');
  }
  const b=JSON.parse(raw.toString());const ref=b?.data?.reference||b?.data?.transaction_reference||b?.data?.transaction?.reference;check(ref);
  return p.webhook(raw,signature);
 }};
 const recovery={reconcile:ref=>{check(ref);return r.reconcile(ref);},refund:approval=>{check(approval?.reference);return r.refund(approval);},sweep:reference=>{if(reference===undefined)return r.sweep();check(reference);const select=fn=>async()=> (await fn()).filter(x=>x.reference===reference);return new HardwareRecovery({...guarded,due:select(guarded.due),approvals:select(guarded.approvals),refundsDue:select(guarded.refundsDue),outbox:select(guarded.outbox)}).sweep();}};
 payments.replayWebhook=async(raw,signature)=>{const b=JSON.parse(raw.toString()),ref=b?.data?.reference;bridge(config,'claim',{reference:ref,id:opid(crypto.randomUUID()),kind:'replay',amount:0});return payments.webhook(raw,signature);};
 if(config.manifest?.execution_profile==='single-payment-acceptance'){
  // One reference, verified through HardwarePayments only: no sweep, no recovery (extra verify and dispute reads), no refunds.
  const denied=()=>{throw Error('single_payment_only');};
  payments.sweep=denied;payments.replayWebhook=denied;for(const k of Object.keys(recovery))recovery[k]=denied;
 }
 return {payments,recovery,bridge:(action,fields)=>bridge(config,action,fields),provider};
}
module.exports={createBoundedServices,bridge,opid,wireHash,validInitializationResponse};
