'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {paymentStartDiagnostics}=require('./payment-start-diagnostics.cjs');
const {safeRunnerCode,saveRunnerDiagnostic}=require('./run.cjs');
const successQuote={eligible:true,payment:{eligible:true,amount_kobo:10000,payment_state:'not_started'}};
function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'payment-start-diagnostic-'));
 const state={mode:'real-provider',run_enabled:true,run_stopped:false,intent_count:0,dispatch_ticket_count:0,consumed_dispatch_ticket_count:0,provider_dispatch_count:0};
 const calls=[];
 const bridge=action=>{assert.equal(action,'status');return {...state};};
 const fetcher=async(url,options)=>{calls.push({url,options});throw Error('unexpected_fetch');};
 return {dir,state,calls,bridge,fetcher,diagnosticFile:path.join(dir,'diagnostic.json'),hostedResultFile:path.join(dir,'hosted.json')};
}
const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
async function runCase(name,quote,start,expected){
 const x=setup();let n=0;x.fetcher=async url=>{n++;return n===1?quote:start;};
 const out=await paymentStartDiagnostics({...x,checkoutUrl:'https://office.hardware.test/api/commerce/checkout',checkoutKey:'synthetic-only',order:{id:'synthetic-order',guest_hash:'synthetic-guest'},expectedAmountKobo:10000});
 assert.equal(out.ok,expected.ok,name);assert.equal(out.diagnostic.boundary,expected.boundary,name);
 if(expected.http!==undefined)assert.equal(out.diagnostic.office_http_status,expected.http,name);
 if(expected.code!==undefined)assert.equal(out.diagnostic.office_error_code,expected.code,name);
 if(expected.eligibility!==undefined)assert.equal(out.diagnostic.payment_start_eligibility,expected.eligibility,name);
 if(expected.eligibilityCode!==undefined)assert.equal(out.diagnostic.eligibility_code,expected.eligibilityCode,name);
 assert.equal(out.diagnostic.dispatch_ticket_issued,expected.ticket||false,name);
 assert.equal(out.diagnostic.financial_dispatch_authorization,expected.auth||'not_authorized',name);
 if(fs.existsSync(x.diagnosticFile)){
  const text=fs.readFileSync(x.diagnosticFile,'utf8');
  for(const forbidden of ['synthetic-order','synthetic-guest','synthetic-only','checkout.paystack.com'])assert.equal(text.includes(forbidden),false,name+' redaction');
 }
 return {x,out};
}
(async()=>{
 await runCase('authorization failure',response(403,{error:'checkout_key_required'}),null,{ok:false,boundary:'office_application_rejection',http:403,code:'checkout_key_required',eligibility:'rejected'});
 await runCase('expired reservation',response(200,{eligible:false,code:'reservation_expired',payment:{eligible:false,eligibility_code:'reservation_expired'}}),null,{ok:false,boundary:'office_quote_response',http:200,eligibility:'ineligible',eligibilityCode:'reservation_expired'});
 await runCase('incorrect order state',response(200,{eligible:true,payment:{eligible:true,amount_kobo:10000,payment_state:'cancelled'}}),null,{ok:false,boundary:'office_quote_response',http:200,eligibility:'ineligible',eligibilityCode:'order_state_invalid'});
 await runCase('quote missing scope',response(403,{error:'missing_service_scope'}),null,{ok:false,boundary:'office_application_rejection',http:403,code:'missing_service_scope',eligibility:'rejected'});
 await runCase('payment execution disabled',response(200,successQuote),response(503,{error:'payments_disabled'}),{ok:false,boundary:'office_application_rejection',http:503,code:'payments_disabled',eligibility:'eligible',auth:'rejected'});
 {
  const x=setup();let n=0;x.fetcher=async()=>{n++;if(n===1)return response(200,successQuote);const e=new Error('private transport details');e.name='TimeoutError';throw e;};
  const out=await paymentStartDiagnostics({...x,checkoutUrl:'https://office.hardware.test/api/commerce/checkout',checkoutKey:'never-log',order:{id:'s',guest_hash:'g'},expectedAmountKobo:10000});
  assert.equal(out.diagnostic.boundary,'connection_timeout');assert.equal(out.diagnostic.payment_start_eligibility,'eligible');assert.equal(out.diagnostic.office_http_status,200);assert.equal(out.diagnostic.dispatch_ticket_issued,false);
 }
 {
  const x=setup();let n=0;x.fetcher=async()=>{n++;return n===1?response(200,successQuote):response(200,{payment:{state:'pending',checkout_url:'https://checkout.paystack.com/synthetic'}});};
  x.bridge=action=>{assert.equal(action,'status');return {...x.state,dispatch_ticket_count:n>1?1:0};};
  const out=await paymentStartDiagnostics({...x,checkoutUrl:'https://office.hardware.test/api/commerce/checkout',checkoutKey:'never-log',order:{id:'s',guest_hash:'g'},expectedAmountKobo:10000});
  assert.equal(out.ok,true);assert.equal(out.diagnostic.payment_start_eligibility,'eligible');assert.equal(out.diagnostic.payment_start_state,'pending');assert.equal(out.diagnostic.hosted_checkout_url_valid,true);assert.equal(out.diagnostic.financial_dispatch_authorization,'authorized');assert.equal(out.diagnostic.dispatch_ticket_issued,true);assert.equal(fs.statSync(x.diagnosticFile).mode&0o777,0o600);assert.equal(fs.statSync(x.hostedResultFile).mode&0o777,0o600);
 }
 {
  const x=setup();let n=0;x.fetcher=async()=>{n++;return n===1?response(200,successQuote):response(200,{payment:{state:'processing'}});};
  const out=await paymentStartDiagnostics({...x,checkoutUrl:'https://office.hardware.test/api/commerce/checkout',checkoutKey:'never-log',order:{id:'s',guest_hash:'g'},expectedAmountKobo:10000});
  assert.equal(out.ok,false);assert.equal(out.diagnostic.payment_start_state,'processing');assert.equal(out.diagnostic.hosted_checkout_url_valid,false);assert.equal(out.diagnostic.financial_dispatch_authorization,'response_accepted');
 }
 {
  const x=setup();x.fetcher=async()=>{const e=new Error('hidden');e.code='ENOTFOUND';throw e;};
  const out=await paymentStartDiagnostics({...x,checkoutUrl:'https://office.hardware.test/api/commerce/checkout',checkoutKey:'never-log',order:{id:'s',guest_hash:'g'},expectedAmountKobo:10000});
  assert.equal(out.diagnostic.boundary,'connection_failure');assert.equal(out.diagnostic.office_http_status,null);
 }
 {
  const x=setup();x.bridge=()=>{throw Error('ledger details must not escape');};
  const out=await paymentStartDiagnostics({...x,checkoutUrl:'https://office.hardware.test/api/commerce/checkout',checkoutKey:'never-log',order:{id:'s',guest_hash:'g'},expectedAmountKobo:10000});
  assert.equal(out.diagnostic.boundary,'execution_ledger_unavailable');assert.equal(x.calls.length,0);
 }
 {
  const x=setup();let snapshots=0;x.bridge=action=>{assert.equal(action,'status');snapshots++;if(snapshots>=3)throw Error('ledger unavailable');return {...x.state};};
  let n=0;x.fetcher=async()=>{n++;return n===1?response(200,successQuote):response(503,{error:'checkout_unavailable'});};
  const out=await paymentStartDiagnostics({...x,checkoutUrl:'https://office.hardware.test/api/commerce/checkout',checkoutKey:'never-log',order:{id:'s',guest_hash:'g'},expectedAmountKobo:10000});
  assert.equal(out.diagnostic.dispatch_ticket_issued,null);assert.equal(out.diagnostic.financial_dispatch_authorization,'unknown');
 }
 {
  const x=setup();let n=0;x.fetcher=async()=>{n++;return n===1?response(200,successQuote):response(503,{error:'payment_backend_timeout_uncertain'});};
  const out=await paymentStartDiagnostics({...x,checkoutUrl:'https://office.hardware.test/api/commerce/checkout',checkoutKey:'never-log',order:{id:'s',guest_hash:'g'},expectedAmountKobo:10000});
  assert.equal(out.diagnostic.boundary,'office_application_rejection');assert.equal(out.diagnostic.office_failure_class,'connection_timeout');assert.equal(out.diagnostic.office_error_code,'payment_backend_timeout_uncertain');
 }
 {
  assert.equal(safeRunnerCode(new Error('execution_disabled')),'execution_disabled');
  assert.equal(safeRunnerCode(new Error('Bearer secret or private details')),'runner_preflight_failed');
  const file=path.join(os.tmpdir(),'runner-diagnostic-'+process.pid+'.json');saveRunnerDiagnostic(file,'execution_disabled');
  const first=fs.readFileSync(file,'utf8');saveRunnerDiagnostic(file,'runner_preflight_failed');
  assert.equal(fs.readFileSync(file,'utf8'),first);assert.equal(first.includes('private details'),false);assert.equal(fs.statSync(file).mode&0o777,0o600);fs.unlinkSync(file);
 }
 console.log('payment-start redacted diagnostics: 13 boundary and runner cases PASS; mocks only, no Office or Paystack requests');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
