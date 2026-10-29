'use strict';
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {handler,classifyProviderStatus,safeFailure,firewallRules}=require('./financial-relay.cjs');
const {validInitializationResponse}=require('./integration.cjs');

function response(){return {headers:{},status:null,body:'',setHeader(k,v){this.headers[k]=v;},writeHead(s){this.status=s;},end(b=''){this.body+=b;}};}
const stubCounter={reserve:()=>1,complete(){},summary:()=>({stub:true})};
async function invoke(send,{profile='full-suite',method='GET',url='/transaction/verify/hwo_'+'a'.repeat(32),counter=stubCounter}={}){
 const payload={method,url,reference:'hwo_'+'a'.repeat(32),ticket:'synthetic-ticket',body:method==='POST'&&url==='/transaction/initialize'?{reference:'hwo_'+'a'.repeat(32),amount:10000}:null};
 const req=Readable.from([Buffer.from(JSON.stringify(payload))]);req.method='POST';req.url='/financial';req.headers={};
 const res=response();let consumed=0;
 await handler({config:{manifest:{execution_profile:profile}},key:'synthetic-only',send,counter,consume:()=>{consumed++;}})(req,res);
 return {res,consumed};
}
(async()=>{
 assert.equal(classifyProviderStatus(401),'provider_http_4xx');
 assert.equal(classifyProviderStatus(429),'provider_rate_limited');
 assert.equal(classifyProviderStatus(503),'provider_http_5xx');
 assert.equal(classifyProviderStatus(200),null);
 const ref='hwo_'+'9'.repeat(32);
 assert.equal(validInitializationResponse({data:{status:true,data:{reference:ref,authorization_url:'https://checkout.paystack.com/test-session'}}},ref),true);
 for(const u of ['http://checkout.paystack.com/test','https://evil.example/test','https://user@checkout.paystack.com/test','https://checkout.paystack.com:8443/test'])assert.equal(validInitializationResponse({data:{status:true,data:{reference:ref,authorization_url:u}}},ref),false);
 assert.equal(validInitializationResponse({data:{status:true,data:{reference:'hwo_'+'8'.repeat(32),authorization_url:'https://checkout.paystack.com/test'}}},ref),false);
 assert.equal(safeFailure(Object.assign(Error(),{code:'pre_dispatch_connection_failure'})),'pre_dispatch_connection_failure');
 assert.equal(safeFailure(Object.assign(Error(),{code:'post_dispatch_timeout_or_lost_response'})),'post_dispatch_timeout_or_lost_response');
 assert.equal(safeFailure(Object.assign(Error(),{code:'malformed_provider_response'})),'malformed_provider_response');
 const cases=[
  ['provider_http_4xx',502],['provider_rate_limited',503],['provider_http_5xx',502],
  ['pre_dispatch_connection_failure',503],['post_dispatch_timeout_or_lost_response',503],['malformed_provider_response',503],
 ];
 for(const [code,status] of cases){
  const result=await invoke(async()=>{const e=Error('sensitive provider body');e.code=code;throw e;});
  assert.equal(result.res.status,status);assert.equal(JSON.parse(result.res.body).error,code);assert.equal(result.consumed,1);
  assert.equal(result.res.body.includes('sensitive'),false);
 }
 const malformed=await invoke(async()=>{throw Error('unclassified');});
 assert.equal(JSON.parse(malformed.res.body).error,'provider_transport_unknown');
 assert.equal(malformed.res.body.includes('unclassified'),false);
 const success=await invoke(async()=>({status:true,data:{safe:true}}));
 assert.equal(success.res.status,200);assert.deepEqual(JSON.parse(success.res.body),{status:true,data:{safe:true}});
 let dispatched=0;
 for(const [method,url] of [['POST','/refund'],['GET','/transaction/verify/hwo_'+'a'.repeat(32)],['POST','/refund/123']]){
  const blocked=await invoke(async()=>{dispatched++;return {};},{profile:'single-initialization-only',method,url});
  assert.equal(blocked.res.status,503);assert.equal(blocked.consumed,0);
 }
 assert.equal(dispatched,0);
 const initOnly=await invoke(async()=>{dispatched++;return {ok:true};},{profile:'single-initialization-only',method:'POST',url:'/transaction/initialize'});
 assert.equal(initOnly.res.status,200);assert.equal(initOnly.consumed,1);assert.equal(dispatched,1);
 // A configured relay without its durable counter never consumes a ticket or sends.
 const noCounter=await invoke(async()=>{dispatched++;return {};},{profile:'single-initialization-only',method:'POST',url:'/transaction/initialize',counter:null});
 assert.equal(noCounter.res.status,503);assert.equal(noCounter.consumed,0);assert.equal(dispatched,1);
 // Budget exhaustion is reported explicitly and nothing is sent.
 const exhausted=await invoke(async()=>{dispatched++;return {};},{profile:'single-initialization-only',method:'POST',url:'/transaction/initialize',counter:{reserve(){throw Object.assign(Error('provider_request_budget_exhausted'),{code:'provider_request_budget_exhausted'});},complete(){},summary(){}}});
 assert.equal(exhausted.res.status,429);assert.equal(JSON.parse(exhausted.res.body).error,'provider_request_budget_exhausted');assert.equal(dispatched,1);
 // Firewall: default deny, NEW connections only to pinned provider addresses on 443, counted denials last.
 const rules=firewallRules(['203.0.113.7']);
 assert.deepEqual(rules[0],['-P','OUTPUT','DROP']);assert.equal(rules.length,4);
 assert.deepEqual(rules[2].slice(0,6),['-A','OUTPUT','-d','203.0.113.7','-p','tcp']);assert.ok(rules[2].includes('NEW')&&rules[2].includes('443'));
 assert.deepEqual(rules.at(-1),['-A','OUTPUT','-m','comment','--comment','getoyi-denied','-j','DROP']);
 assert.equal(firewallRules([]).filter(r=>r.includes('ACCEPT')).length,1);
 console.log('provider relay classification, hosted-response validation, single-init route restrictions, counter requirement and firewall rules: 46 assertions PASS; no provider/network requests');
})().catch(e=>{console.error(e);process.exitCode=1;});
