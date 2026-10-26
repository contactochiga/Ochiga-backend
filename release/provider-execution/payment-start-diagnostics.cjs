'use strict';
// Redacted controller-to-Office diagnostics. This module never contacts a provider.
const fs=require('fs');
const OFFICE_CODES=new Set([
 'checkout_key_required','checkout_disabled','payments_disabled','invalid_checkout',
 'invalid_payment_total','order_not_found','checkout_unavailable','price_changed',
 'product_unavailable','variant_unavailable','stock_unavailable','reservation_expired',
 'payment_not_eligible','delivery_restricted','payment_unavailable',
 'payment_processing_disabled','payment_backend_unconfigured','payment_backend_rejected',
 'payment_backend_rate_limited','payment_backend_timeout_uncertain',
 'payment_backend_connection_failure','payment_backend_transport_uncertain',
 'payment_backend_malformed_response','forbidden','missing_service_scope'
]);
const ELIGIBILITY_CODES=new Set([
 'eligible','order_not_found','order_state_invalid','payment_already_started',
 'reservation_expired','reservation_missing','reservation_invalid','product_unpublished',
 'price_unapproved','amount_mismatch','quote_unavailable','access_denied'
]);
const BOUNDARIES=new Set(['not_started','execution_ledger_unavailable','runner_precondition_rejected','connection_timeout','connection_failure','office_application_rejection','office_quote_response','office_application_response']);
const ELIGIBILITY_RESULTS=new Set(['unknown','not_checked','rejected','eligible','ineligible']);
const DISPATCH_RESULTS=new Set(['not_authorized','rejected','authorized','response_accepted','unknown']);
const PAYMENT_STATES=new Set(['created','initializing','pending','processing','confirmed','refund_required','manual_reconciliation']);
const OFFICE_FAILURE_CLASSES=new Set(['connection_failure','connection_timeout','transport_uncertain','application_rejection','rate_limited','malformed_response','unconfigured']);
function allowlistedCode(v,set){return typeof v==='string'&&set.has(v)?v:null;}
function officeFailureClass(code,boundary){
 if(code==='payment_backend_connection_failure')return 'connection_failure';
 if(code==='payment_backend_timeout_uncertain')return 'connection_timeout';
 if(code==='payment_backend_transport_uncertain')return 'transport_uncertain';
 if(code==='payment_backend_rate_limited')return 'rate_limited';
 if(code==='payment_backend_malformed_response')return 'malformed_response';
 if(code==='payment_backend_unconfigured')return 'unconfigured';
 if(code==='payment_backend_rejected'||code==='payment_not_eligible'||code==='payments_disabled')return 'application_rejection';
 return boundary==='office_application_rejection'?'application_rejection':null;
}
function transportClass(err){
 const code=typeof err?.code==='string'?err.code:'';
 if(err?.name==='TimeoutError'||code==='ETIMEDOUT'||code==='ESOCKETTIMEDOUT'||code==='UND_ERR_CONNECT_TIMEOUT')return 'connection_timeout';
 if(code==='ECONNREFUSED'||code==='ENOTFOUND'||code==='EAI_AGAIN'||code==='ECONNRESET'||err?.name==='TypeError')return 'connection_failure';
 return 'connection_failure';
}
function initialStatus(){return {readable:false,run_enabled:false,run_stopped:false,intent_count:0,intent_states:{},dispatch_ticket_count:0,consumed_dispatch_ticket_count:0,provider_dispatch_count:0};}
function snapshot(bridge){try{return {readable:true,...bridge('status')};}catch{return initialStatus();}}
function ticketDelta(before,after){if(!before?.readable||!after?.readable)return null;return Number(after?.dispatch_ticket_count||0)>Number(before?.dispatch_ticket_count||0);}
function safeDiagnostic(fields){
 const officeCode=allowlistedCode(fields.office_error_code,OFFICE_CODES);
 return {
  office_http_status:Number.isInteger(fields.office_http_status)?fields.office_http_status:null,
  office_error_code:officeCode,
  office_failure_class:allowlistedCode(fields.office_failure_class||officeFailureClass(officeCode,fields.boundary),OFFICE_FAILURE_CLASSES),
  boundary:allowlistedCode(fields.boundary,BOUNDARIES),
  payment_start_eligibility:allowlistedCode(fields.payment_start_eligibility,ELIGIBILITY_RESULTS),
  eligibility_code:allowlistedCode(fields.eligibility_code,ELIGIBILITY_CODES),
  payment_start_state:allowlistedCode(fields.payment_start_state,PAYMENT_STATES),
  hosted_checkout_url_valid:fields.hosted_checkout_url_valid===true,
  financial_dispatch_authorization:allowlistedCode(fields.financial_dispatch_authorization,DISPATCH_RESULTS),
  dispatch_ticket_issued:fields.dispatch_ticket_issued===null?null:fields.dispatch_ticket_issued===true,
  office_application_rejected:fields.office_application_rejected===true
 };
}
function writeDiagnostic(file,result){
 // Exclusive creation preserves a stopped/uncertain attempt and forbids silent retries.
 fs.writeFileSync(file,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
}
async function readJson(response){try{return await response.json();}catch{return null;}}
function eligibilityFrom(payload,status){
 const p=payload?.payment||payload?.data?.payment||payload?.data||{};
 const code=allowlistedCode(payload?.code||payload?.error||p?.eligibility_code,ELIGIBILITY_CODES);
 const valid=payload?.eligible===true||p?.eligible===true;
 const paymentState=p?.payment_state||p?.state;
 const allowedState=!paymentState||paymentState==='not_started';
 return {eligible:valid&&allowedState,code:valid&&allowedState?'eligible':code||(!allowedState?'order_state_invalid':'quote_unavailable'),amount_kobo:Number.isSafeInteger(p?.amount_kobo)?p.amount_kobo:null,payment_state:typeof paymentState==='string'&&['not_started','pending','paid','failed','cancelled','refund_required'].includes(paymentState)?paymentState:null,status};
}
async function paymentStartDiagnostics({fetcher=fetch,bridge,checkoutUrl,checkoutKey,order,expectedAmountKobo,diagnosticFile,hostedResultFile,timeoutMs=15000}){
 const before=snapshot(bridge);
 let report=safeDiagnostic({boundary:'not_started',payment_start_eligibility:'unknown',financial_dispatch_authorization:'not_authorized',dispatch_ticket_issued:false});
 const persist=()=>{const after=snapshot(bridge),delta=ticketDelta(before,after),issued=report.dispatch_ticket_issued===true||delta===true?true:delta===null?null:report.dispatch_ticket_issued;report=safeDiagnostic({...report,dispatch_ticket_issued:issued,financial_dispatch_authorization:issued===true?'authorized':issued===null?'unknown':report.financial_dispatch_authorization});writeDiagnostic(diagnosticFile,report);return report;};
 if(!before.readable||before.mode!=='real-provider'){
  report=safeDiagnostic({boundary:'execution_ledger_unavailable',payment_start_eligibility:'not_checked',financial_dispatch_authorization:'not_authorized',dispatch_ticket_issued:false});persist();return {ok:false,diagnostic:report};
 }
 if(before.intent_count!==0||before.dispatch_ticket_count!==0||!before.run_enabled||before.run_stopped){
  report=safeDiagnostic({boundary:'runner_precondition_rejected',payment_start_eligibility:'not_checked',financial_dispatch_authorization:'not_authorized',dispatch_ticket_issued:false});persist();return {ok:false,diagnostic:report};
 }
 const headers={'content-type':'application/json','x-api-key':checkoutKey};
 const request=async (suffix,body)=>{
  try{return await fetcher(`${checkoutUrl}/${suffix}`,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
  catch(err){report=safeDiagnostic({...report,boundary:transportClass(err),payment_start_eligibility:suffix==='payment-quote'?'unknown':report.payment_start_eligibility,financial_dispatch_authorization:'not_authorized'});persist();return null;}
 };
 const quote=await request('payment-quote',{id:order.id,guest_hash:order.guest_hash});
 if(!quote)return {ok:false,diagnostic:report};
 const quoteBody=await readJson(quote);
 if(!quote.ok){report=safeDiagnostic({...report,office_http_status:quote.status,office_error_code:allowlistedCode(quoteBody?.code||quoteBody?.error,OFFICE_CODES),boundary:'office_application_rejection',payment_start_eligibility:'rejected',eligibility_code:allowlistedCode(quoteBody?.code||quoteBody?.error,ELIGIBILITY_CODES),financial_dispatch_authorization:'not_authorized',office_application_rejected:true});persist();return {ok:false,diagnostic:report};}
 const eligibility=eligibilityFrom(quoteBody,quote.status);
 report=safeDiagnostic({...report,office_http_status:quote.status,boundary:'office_quote_response',payment_start_eligibility:eligibility.eligible?'eligible':'ineligible',eligibility_code:eligibility.code,financial_dispatch_authorization:'not_authorized'});
 if(!eligibility.eligible||eligibility.amount_kobo!==expectedAmountKobo||eligibility.payment_state!=='not_started'){
  if(eligibility.amount_kobo!==null&&eligibility.amount_kobo!==expectedAmountKobo)report=safeDiagnostic({...report,payment_start_eligibility:'ineligible',eligibility_code:'amount_mismatch'});
  if(eligibility.payment_state&&eligibility.payment_state!=='not_started')report=safeDiagnostic({...report,payment_start_eligibility:'ineligible',eligibility_code:'order_state_invalid'});
  persist();return {ok:false,diagnostic:report};
 }
 report=safeDiagnostic({...report,payment_start_eligibility:'eligible',eligibility_code:'eligible'});
 const start=await request('payment-start',{id:order.id,guest_hash:order.guest_hash,accepted_total_kobo:expectedAmountKobo});
 if(!start)return {ok:false,diagnostic:report};
 const startBody=await readJson(start);
 const after=snapshot(bridge);
 const issued=ticketDelta(before,after);
 if(!start.ok){report=safeDiagnostic({...report,office_http_status:start.status,office_error_code:allowlistedCode(startBody?.code||startBody?.error,OFFICE_CODES),boundary:'office_application_rejection',financial_dispatch_authorization:issued===true?'authorized':issued===null?'unknown':'rejected',dispatch_ticket_issued:issued,office_application_rejected:true});persist();return {ok:false,diagnostic:report};}
 const url=startBody?.checkout_url||startBody?.data?.checkout_url||startBody?.payment?.checkout_url;
 let validUrl=false;try{const u=new URL(url);validUrl=u.protocol==='https:'&&u.hostname==='checkout.paystack.com'&&!u.port&&!u.username&&!u.password;}catch{}
 const startState=startBody?.payment?.state||startBody?.state;
 report=safeDiagnostic({...report,office_http_status:start.status,boundary:'office_application_response',financial_dispatch_authorization:issued===true?'authorized':issued===null?'unknown':'response_accepted',dispatch_ticket_issued:issued,payment_start_state:startState,hosted_checkout_url_valid:validUrl});
 persist();
 if(!validUrl)return {ok:false,diagnostic:report};
 fs.writeFileSync(hostedResultFile,JSON.stringify(startBody),{flag:'wx',mode:0o600});
 return {ok:true,diagnostic:report};
}
module.exports={paymentStartDiagnostics,allowlistedCode,transportClass,eligibilityFrom,safeDiagnostic,officeFailureClass};
