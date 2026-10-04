import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const require=createRequire(import.meta.url);
for(const pkg of ['bullmq','ioredis']){const p=require.resolve(pkg);class Inert{on(){return this;}quit(){return Promise.resolve();}}Inert.default=Inert;Inert.Redis=Inert;Inert.Queue=Inert;Inert.Worker=Inert;require.cache[p]={id:p,filename:p,loaded:true,exports:Inert};}
globalThis.fetch=async()=>{throw Error('IQ3A_NETWORK_FORBIDDEN');};
const {supabaseAdmin}=await import('../dist/supabase/supabaseClient.js');
const {buildRoomHomeCapabilities}=await import('../dist/oyi-core/domains/roomHome/roomHomeCapabilities.js');
const module=buildRoomHomeCapabilities().find(m=>m.key==='rooms.inventory.read');
const context={input:{surface:'consumer',message:'Show rooms',home_id:'synthetic-home-a'},oisContext:{home_id:'synthetic-home-a',estate_id:'synthetic-estate'},resolvedTurn:{request_id:'iq3a-room-test'}};
const original=supabaseAdmin.from;
let queries=0;
try {
 for(const error of [{message:'synthetic source unavailable'},null]){
  supabaseAdmin.from=(table)=>{assert.equal(table,'rooms');queries++;return{select:()=>({eq:(column,value)=>{assert.equal(column,'home_id');assert.equal(value,'synthetic-home-a');return{limit:async limit=>{assert.equal(limit,100);return{data:[],error};}};}})};};
  const evidence=await module.collectEvidence(context),answer=await module.buildReadResponse(context,evidence);
  assert.equal(answer.status,error?'unavailable':'empty');
  if(error){assert.equal(evidence[0].truth_class,'unavailable');assert.equal(evidence[0].confidence,0);assert(!answer.answer.startsWith('I do not see any registered rooms'));}
 }
 await module.collectEvidence({...context,input:{...context.input,home_id:'synthetic-home-b'}});
 assert.equal(queries,3); // query assertion above proves verified A still wins
 const absent={...context,input:{...context.input,home_id:null},oisContext:{home_id:null,estate_id:null}};
 const evidence=await module.collectEvidence(absent);assert.equal(queries,3);
 assert.equal((await module.buildReadResponse(absent,evidence)).status,'unavailable');
 console.log(JSON.stringify({status:'PASS',cases:4,source:'isolated fault injection; no database queries executed'}));
} finally {supabaseAdmin.from=original;}
