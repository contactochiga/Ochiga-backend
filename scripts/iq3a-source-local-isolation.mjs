import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const require=createRequire(import.meta.url);
for(const pkg of ['bullmq','ioredis']){const p=require.resolve(pkg);class Inert{on(){return this;}quit(){return Promise.resolve();}}Inert.default=Inert;Inert.Redis=Inert;Inert.Queue=Inert;Inert.Worker=Inert;require.cache[p]={id:p,filename:p,loaded:true,exports:Inert};}
const fetchOriginal=globalThis.fetch;
globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55421');return fetchOriginal(input,options);};
const {ensureRegistered}=await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const {capabilityService}=await import('../dist/oyi-core/capabilities/CapabilityService.js');
const {supabaseAdmin:db}=await import('../dist/supabase/supabaseClient.js');
ensureRegistered();
const src=fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs','utf8');
const {actorFor,oisContext}=new Function(`${src.slice(src.indexOf('const ids = '),src.indexOf('function expected(prompt)'))};return {actorFor,oisContext};`)();
const actor=actorFor('resident','consumer'),other=actorFor('resident_b','consumer'),ois=oisContext(actor,'consumer');
const context={actor,oisContext:ois,input:{surface:'consumer',message:'source isolation',estate_id:ois.estate_id,home_id:ois.home_id},resolvedTurn:{request_id:randomUUID(),scope:{estate_id:ois.estate_id,home_id:ois.home_id,room_id:null,building_id:null},semantic_frame:{normalizedText:'source isolation'},operation:'list'},legacyFallback:async()=>{throw Error('NO_FALLBACK');}};
const tables=[['maintenance.requests.read','maintenance_requests',{user_id:other.id,title:'IQ3A DISTINCTIVE B ONLY',status:'open'}],['security.incidents.read','facility_incidents',{title:'IQ3A DISTINCTIVE B ONLY',status:'open'}],['visitors.pending.read','visitor_access',{created_by:other.id,visitor_name:'IQ3A DISTINCTIVE B ONLY',visitor_phone:'+234000000099',status:'active',access_code:'IQ3A-TEST-NOT-REAL'}]];
const cleanup=[],results=[],live=[];
try {
 for(const [key,table,fields]of tables){
  const before=await capabilityService.readEvidence(key,context,5000);assert(!['unavailable','error','timeout','authority_denied'].includes(before.status));
  const id=randomUUID();const {error}=await db.from(table).insert({id,estate_id:ois.estate_id,home_id:other.home_id,...fields});assert(!error,`Local synthetic insert failed for ${table}: ${error?.code} ${error?.message}`);cleanup.push([table,id]);
  const proof=await db.from(table).select('id,home_id').eq('id',id).single();assert(!proof.error);assert.equal(proof.data.home_id,other.home_id);
  const after=await capabilityService.readEvidence(key,context,5000);
  assert.equal(after.record_count,before.record_count);assert.equal(after.zero_proven,before.zero_proven);assert.equal(after.status,before.status);assert.equal(after.truncated,before.truncated);assert.equal(after.complete,before.complete);assert.equal(after.source_total,before.source_total);
  assert(!JSON.stringify(after).includes(id));assert(!JSON.stringify(after).includes('IQ3A DISTINCTIVE B ONLY'));
  const attack=await capabilityService.readEvidence(key,{...context,input:{...context.input,home_id:other.home_id}});assert.equal(attack.status,'authority_denied');assert.equal(attack.record_count,0);
  results.push({key,status:'PASS',same_home_count:after.record_count,other_home_count_leak:false});
 }

 // ---- IQ-3A benchmark-required sources: real local rows for the OTHER home, real rooms for room scope ----
 const facilityActor=actorFor('facility_manager','facility'),facilityOis=oisContext(facilityActor,'facility');
 const facilityContext={actor:facilityActor,oisContext:facilityOis,input:{surface:'facility',message:'source isolation',estate_id:facilityOis.estate_id,context:{}},resolvedTurn:{request_id:randomUUID(),scope:{estate_id:facilityOis.estate_id,home_id:null,room_id:null,building_id:null},semantic_frame:{normalizedText:'source isolation'},operation:'list'},legacyFallback:async()=>{throw Error('NO_FALLBACK');}};
 const ins=async(table,row)=>{const {error}=await db.from(table).insert(row);assert(!error,`Local synthetic insert failed for ${table}: ${error?.code} ${error?.message}`);cleanup.push([table,row.id]);return row.id;};
 const MARK='IQ3A DISTINCTIVE B ONLY';
 const sameCount=async(key,ctx,mutate)=>{const before=await capabilityService.readEvidence(key,ctx,5000);assert(!['unavailable','error','timeout','authority_denied'].includes(before.status),`${key} baseline ${before.status}`);const id=await mutate();const after=await capabilityService.readEvidence(key,ctx,5000);
  for(const f of ['record_count','zero_proven','status','truncated','complete','source_total'])assert.equal(after[f],before[f],`${key}.${f}`);
  assert(!JSON.stringify(after).includes(id));assert(!JSON.stringify(after).includes(MARK));return {before,after};};
 const roomB=await ins('rooms',{id:randomUUID(),estate_id:ois.estate_id,home_id:other.home_id,name:MARK});
 for(const key of ['devices.status.read','devices.availability.read']){
  const {after}=await sameCount(key,context,()=>ins('devices',{id:randomUUID(),estate_id:ois.estate_id,home_id:other.home_id,name:MARK,type:'switch',category:'light',adapter:'iq3a-test',external_id:'iq3a-'+randomUUID()}));
  const direct=await db.from('devices').select('id',{count:'exact',head:true}).eq('home_id',ois.home_id);assert.equal(after.record_count,direct.count);
  const attack=await capabilityService.readEvidence(key,{...context,input:{...context.input,home_id:other.home_id}});assert.equal(attack.status,'authority_denied');assert.equal(attack.record_count,0);
  // Real rooms of the verified home: room scope returns exactly that room's devices; other home's room is not provable.
  for(const [room,label] of [['21000000-0000-4000-8000-000000000002','bedroom'],['21000000-0000-4000-8000-000000000003','kitchen'],['21000000-0000-4000-8000-000000000004','study']]){
   const expected=(await db.from('devices').select('id',{count:'exact',head:true}).eq('home_id',ois.home_id).eq('room_id',room)).count;
   const r=await capabilityService.readEvidence(key,{...context,input:{...context.input,room_id:room}},5000);
   assert.equal(r.record_count,expected,`${key} ${label}`);assert(expected?['available_complete','stale'].includes(r.status):r.status==='available_zero',`${key} ${label} ${r.status}`);assert.equal(r.complete,true,`${key} ${label} registry population complete below the bound`);assert.equal(r.zero_proven,expected===0);assert(!JSON.stringify(r).includes(MARK));
  }
  const crossRoom=await capabilityService.readEvidence(key,{...context,input:{...context.input,room_id:roomB}},5000);assert.equal(crossRoom.status,'scope_insufficient');assert.equal(crossRoom.zero_proven,false);assert.equal(crossRoom.record_count,0);
  live.push({key,status:'PASS',same_home_count:after.record_count,room_scope_verified:['bedroom','kitchen','study'],other_home_room_not_provable:true});
 }
 for(const key of ['devices.activity.read','devices.failures.read']){
  const {after}=await sameCount(key,context,()=>ins('ai_execution_ledger',{id:randomUUID(),estate_id:ois.estate_id,home_id:other.home_id,tool_id:'iq3a-test',execution_status:'failed',action:'device.command',result_summary:MARK,error_message:MARK,requested_at:new Date().toISOString(),completed_at:new Date().toISOString()}));
  const attack=await capabilityService.readEvidence(key,{...context,input:{...context.input,home_id:other.home_id}});assert.equal(attack.status,'authority_denied');
  live.push({key,status:'PASS',same_home_count:after.record_count});
 }
 {const key='scenes.list.read';const {after}=await sameCount(key,context,()=>ins('consumer_scenes',{id:randomUUID(),estate_id:ois.estate_id,home_id:other.home_id,name:MARK,actions:[],enabled:true}));
  assert.equal((await capabilityService.readEvidence(key,{...context,input:{...context.input,home_id:other.home_id}})).status,'authority_denied');live.push({key,status:'PASS',same_home_count:after.record_count});}
 {const key='facility.cameras.read';const {after}=await sameCount(key,facilityContext,()=>ins('facility_cameras',{id:randomUUID(),estate_id:ois.estate_id,home_id:other.home_id,privacy_scope:'home',name:MARK}));
  assert.equal((await capabilityService.readEvidence(key,context)).status,'authority_denied');live.push({key,status:'PASS',same_estate_count:after.record_count,home_private_camera_excluded:true});}
}finally{
 for(const [table,id]of cleanup){const {error}=await db.from(table).delete().eq('id',id);assert(!error,`Local fixture cleanup failed: ${table} ${id}`);}
}
fs.writeFileSync(`${process.env.WAVE11_HARNESS_OUT}.json`,JSON.stringify({status:'PASS',fixture:'verified loopback only',results,benchmark_required_sources:live,synthetic_rows_removed:cleanup.length},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',sources:results.length+live.length,synthetic_rows_removed:cleanup.length}));
