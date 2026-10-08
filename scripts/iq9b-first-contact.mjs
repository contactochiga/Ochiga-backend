// Certification transport only: unchanged canonical Core, real local persistence.
// No grading, answer rewriting, provider simulation, retries or corpus tuning.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const candidate='872fb7bf264d30865e1aadb5dfa44ae46a9579d6';
const base='artifacts/intelligence-quality-v1-iq9b';
const sha=s=>createHash('sha256').update(s).digest('hex');
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
assert(!fs.existsSync('.env'));
for(const k of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','RESEND_API_KEY','TWILIO_AUTH_TOKEN','TUYA_ACCESS_ID','TUYA_ACCESS_SECRET','EDGE_API_URL','DATABASE_URL'])assert(!process.env[k],`External configuration forbidden: ${k}`);
assert.equal(execFileSync('git',['diff',candidate,'--','src','supabase','migrations','package.json','package-lock.json','tsconfig.json'],{encoding:'utf8'}),'','Runtime/schema/dependency drift');
const seal=JSON.parse(fs.readFileSync(base+'-seal.json'));
for(const f of seal.files)assert.equal(sha(fs.readFileSync(f.path)),f.sha256,f.path);
for(const f of seal.dist_manifest)assert.equal(sha(fs.readFileSync(f.path)),f.sha256,f.path);
const corpus=JSON.parse(fs.readFileSync(base+'-corpus.json'));
assert.equal(corpus.items.length,520);
const marker=base+'-first-contact-start.json';
assert(!fs.existsSync(marker),'First contact already started; no replay permitted');
process.env.OYI_TRACE_REFERENCE_KEY=randomBytes(32).toString('hex'); // ephemeral local trace pseudonymization, never persisted
const require=createRequire(import.meta.url);
for(const pkg of ['bullmq','ioredis']){const p=require.resolve(pkg);class Inert{on(){return this;}quit(){return Promise.resolve();}disconnect(){}} Inert.default=Inert;Inert.Redis=Inert;Inert.Queue=Inert;Inert.Worker=Inert;require.cache[p]={id:p,filename:p,loaded:true,exports:Inert};}
const realFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert(['127.0.0.1','localhost'].includes(u.hostname)&&u.port==='55421','Nonfixture egress refused');return realFetch(input,options);};
let executionAttempts=0;
require('../dist/controllers/deviceCommandController.js').executeDeviceCommandForActor=async()=>{executionAttempts++;throw Error('IQ9B_PHYSICAL_EXECUTION_FORBIDDEN');};
const {conversationOrchestrator}=await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const {supabaseAdmin:db}=await import('../dist/supabase/supabaseClient.js');
const {flushConversationTraceWrites}=await import('../dist/oyi-core/observability/conversationTraceRecorder.js');
const {opaqueReference}=await import('../dist/oyi-core/observability/conversationTraceProjection.js');
const source=fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs','utf8');
const {actorFor,oisContext,officeSnapshot}=new Function(`${source.slice(source.indexOf('const ids = '),source.indexOf('function expected(prompt)'))};return {actorFor,oisContext,officeSnapshot};`)();
const estate=await db.from('estates').select('name');assert(!estate.error);assert.deepEqual(estate.data.map(e=>e.name),['Wave 11 Test Estate']);
const traceProbe=await db.from('oyi_conversation_traces').select('trace_id').limit(1);assert(!traceProbe.error,'Local trace schema unavailable');
const role={Oma:'ochiga_staff',Osa:'public',Facility:'facility_manager',Consumer:'resident'};
const started=Date.now(),records=[];
const snapshot=officeSnapshot();
fs.writeFileSync(marker,JSON.stringify({candidate,execution_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),started_at:new Date().toISOString(),seal_sha256:sha(fs.readFileSync(base+'-seal.json')),fixture:'verified loopback 55421',provider:'absent',snapshot},null,2)+'\n',{flag:'wx'});
const fd=fs.openSync(base+'-first-contact.jsonl','wx');
for(const it of corpus.items){
 const actor=actorFor(role[it.worker],it.surface),turns=[];let thread=null;
 for(const [index,prompt] of [...it.seeds,it.utterance].entries()){
  const begin=Date.now(),requestId=randomUUID(),before=executionAttempts;
  const turn={index,prompt,scored:index===it.seeds.length,request_id:requestId};
  try{
   const response=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,it.surface),input:{message:prompt,surface:it.surface,thread_id:thread,estate_id:actor.estate_id,home_id:actor.home_id,context:{request_id:requestId,correlation_id:requestId,...(it.surface==='office_internal'?{operational_snapshot:snapshot}:{})}}});
   thread=response.thread_id||thread;await flushConversationTraceWrites();
   const trace=await db.from('oyi_conversation_traces').select('*').eq('turn_ref',opaqueReference('turn',requestId)).maybeSingle();
   const state=thread?await db.from('oyi_conversation_threads').select('metadata').eq('id',thread).maybeSingle():{data:null,error:null};
   Object.assign(turn,{response,trace:trace.data??null,trace_error:trace.error?.code??null,thread_metadata:state.data?.metadata??null,metadata_error:state.error?.code??null});
  }catch(error){turn.error={name:error.name,message:String(error.message).slice(0,1000)};}
  Object.assign(turn,{thread_id:thread,latency_ms:Date.now()-begin,execution_attempts:executionAttempts-before});turns.push(turn);
  fs.writeSync(fd,JSON.stringify({id:it.id,worker:it.worker,surface:it.surface,kind:it.kind,turn})+'\n');fs.fsyncSync(fd);
 }
 records.push({id:it.id,worker:it.worker,surface:it.surface,kind:it.kind,turns});
 console.log(JSON.stringify({completed:records.length,total:520,id:it.id}));
}
fs.closeSync(fd);
fs.writeFileSync(base+'-first-contact-raw.json',JSON.stringify({candidate,seal_sha256:sha(fs.readFileSync(base+'-seal.json')),completed_at:new Date().toISOString(),duration_ms:Date.now()-started,execution_attempts:executionAttempts,records},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({completed:records.length,execution_attempts:executionAttempts,duration_ms:Date.now()-started}));
process.exit(0);
