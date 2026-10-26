'use strict';
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {handler,classifyProviderStatus,safeFailure}=require('./financial-relay.cjs');

function response(){return {headers:{},status:null,body:'',setHeader(k,v){this.headers[k]=v;},writeHead(s){this.status=s;},end(b=''){this.body+=b;}};}
async function invoke(send){
 const payload={method:'GET',url:'/transaction/verify/hwo_'+'a'.repeat(32),reference:'hwo_'+'a'.repeat(32),ticket:'synthetic-ticket',body:null};
 const req=Readable.from([Buffer.from(JSON.stringify(payload))]);req.method='POST';req.url='/financial';req.headers={};
 const res=response();let consumed=0;
 await handler({config:{},key:'synthetic-only',send,consume:()=>{consumed++;}})(req,res);
 return {res,consumed};
}
(async()=>{
 assert.equal(classifyProviderStatus(401),'provider_http_4xx');
 assert.equal(classifyProviderStatus(429),'provider_rate_limited');
 assert.equal(classifyProviderStatus(503),'provider_http_5xx');
 assert.equal(classifyProviderStatus(200),null);
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
 console.log('provider relay classification: 19 assertions PASS; no provider/network requests');
})().catch(e=>{console.error(e);process.exitCode=1;});
