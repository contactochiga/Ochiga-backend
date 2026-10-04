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
const cleanup=[],results=[];
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
}finally{
 for(const [table,id]of cleanup){const {error}=await db.from(table).delete().eq('id',id);assert(!error,`Local fixture cleanup failed: ${table} ${id}`);}
}
fs.writeFileSync(`${process.env.WAVE11_HARNESS_OUT}.json`,JSON.stringify({status:'PASS',fixture:'verified loopback only',results,synthetic_rows_removed:cleanup.length},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',sources:results.length,synthetic_rows_removed:cleanup.length}));
