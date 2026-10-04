import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { journeys } from './intelligence-quality-v1-corpus.mjs';

const root = new URL('../', import.meta.url);
process.chdir(root.pathname);
const head = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const startingHead='3a9956dc139746c592a10cc081d0de7c9a299989';
if (execFileSync('git',['diff',startingHead,'--','src','supabase','migrations'],{encoding:'utf8'}).trim()) throw new Error('Baseline refuses modified runtime/schema');
const url=process.env.SUPABASE_URL;
if (!['http://127.0.0.1:55421','http://localhost:55421'].includes(url)) throw new Error('IQ fixture requires the isolated local Supabase endpoint');
if (!process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY) throw new Error('Local fixture credential missing');
for (const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','GROQ_API_KEY','RESEND_API_KEY','TWILIO_AUTH_TOKEN','TUYA_ACCESS_ID','TUYA_ACCESS_SECRET','EDGE_API_URL','EDGE_BASE_URL','DATABASE_URL']) {
  if (process.env[key]) throw new Error(`Refusing external configuration: ${key}`);
}
if (fs.existsSync('.env')) throw new Error('Refusing worktree .env');
process.env.SUPABASE_SERVICE_ROLE_KEY=process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.OYI_TRACE_REFERENCE_KEY=randomBytes(48).toString('hex');
process.env.OYI_CONVERSATION_TRACE_ENABLED='true';
process.env.REDIS_ENABLED='false';
// Fail closed on HTTP egress. Any unsupported external read is recorded honestly.
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
  const target=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if (!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='55421') throw new Error('IQ_EXTERNAL_EGRESS_BLOCKED');
  return originalFetch(input,options);
};
const require=createRequire(import.meta.url);
const queuePath=require.resolve('bullmq');
require.cache[queuePath]={id:queuePath,filename:queuePath,loaded:true,exports:{Queue:class{},Worker:class{}}};
const redisPath=require.resolve('ioredis');
class NoNetworkRedis { on(){return this;} quit(){return Promise.resolve();} disconnect(){} }
NoNetworkRedis.default=NoNetworkRedis; NoNetworkRedis.Redis=NoNetworkRedis;
require.cache[redisPath]={id:redisPath,filename:redisPath,loaded:true,exports:NoNetworkRedis};

// Reuse ONLY the frozen fixture helper definitions, never its runner or scorer.
// Hash-pin the source so extraction cannot silently drift. No production module
// is rewritten/mocked. This avoids editing or replacing the 132-turn corpus.
const frozen=fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs','utf8');
const frozenHash=createHash('sha256').update(frozen).digest('hex');
if(frozenHash!=='f4589f7ef35e1297ca2ec68e5e724904062c1f29478752302cd13a6f66557dd7') throw new Error('Frozen corpus changed');
const from=frozen.indexOf('const ids = '),to=frozen.indexOf('function expected(prompt)');
if(from<0||to<=from) throw new Error('Fixture helper boundaries changed');
const {actorFor,oisContext,officeSnapshot}=new Function(`${frozen.slice(from,to)}; return {actorFor,oisContext,officeSnapshot};`)();
function snapshot(){
  const s=officeSnapshot();
  s.leads={total_open:39,needing_attention:Array.from({length:20},(_,i)=>({id:`iq-lead-${i+1}`,name:i===0?'IQ Low Value Old Lead':i===1?'IQ Qualified Abuja JV':i===2?'IQ Large Speculative Prospect':`IQ Routine Lead ${i+1}`,status:i===1?'qualified':'new',reason:i===0?'Overdue 60 days; small cosmetic inquiry; low value; no near-term deadline':i===1?'Owner consent and survey supplied; qualified JV; meeting deadline tomorrow; title diligence pending':i===2?'Largest claimed value, but no feasibility evidence or owner mandate':`Routine follow-up; no material deadline recorded`,last_activity_at:new Date(Date.now()-(i===0?60:3)*86400000).toISOString(),email:`iq-lead-${i+1}@fixture.invalid`}))};
  s.opportunities={total_open:3,stale:[{id:'iq-jv',name:'IQ Abuja JV — qualified, owner meeting tomorrow, title diligence pending',stage:'qualification',days_since_activity:8,owner:'IQ Commercial Manager'},{id:'iq-vi',name:'IQ VI Project — financing unverified, planning ready',stage:'review',days_since_activity:21,owner:'IQ Development Manager'},{id:'iq-speculative',name:'IQ Large Speculative Deal — ownership and feasibility unverified',stage:'new',days_since_activity:60,owner:null}]};
  s.development={projects:[{id:'iq-vi',name:'IQ VI Project',status:'planning ready; financing unverified',percent_complete:35,units_sold:0,units_total:40},{id:'iq-title',name:'IQ Title Dispute Project',status:'blocked by title dispute; survey ready',percent_complete:10,units_sold:0,units_total:80},{id:'iq-routine',name:'IQ Routine Completion',status:'minor cosmetic finishing only',percent_complete:98,units_sold:18,units_total:20}]};
  s.tasks.open.push({id:'iq-diligence',title:'IQ title diligence before JV commitment',status:'open',priority:'high',owner:'IQ Analyst',due_at:new Date(Date.now()+86400000).toISOString(),overdue:false});
  return s;
}
const {conversationOrchestrator}=await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const {flushConversationTraceWrites}=await import('../dist/oyi-core/observability/conversationTraceRecorder.js');
const {opaqueReference}=await import('../dist/oyi-core/observability/conversationTraceProjection.js');
const {supabaseAdmin}=await import('../dist/supabase/supabaseClient.js');
const traceProbe=await supabaseAdmin.from('oyi_conversation_traces').select('trace_id').limit(1);
if(traceProbe.error) throw new Error(`Local trace schema unavailable: ${traceProbe.error.code}`);
const estateProbe=await supabaseAdmin.from('estates').select('id,name');
if(estateProbe.error||estateProbe.data?.length!==1||estateProbe.data[0].name!=='Wave 11 Test Estate') throw new Error('Fixture identity mismatch');
const officeWorld=snapshot();
const records=[];
const artifact={version:1,starting_authoritative_head:startingHead,execution_head:head,frozen_wave11_sha256:frozenHash,generated_at:new Date().toISOString(),fixture:{endpoint:'local:55421',source:'retained Wave 11 isolated fixture; unique IQ threads',office_snapshot:officeWorld,external_execution:'not permitted',provider_configuration:'absent; canonical deterministic baseline, external egress denied'},records};
fs.mkdirSync('artifacts',{recursive:true});
const output='artifacts/intelligence-quality-v1-baseline.json';
if(fs.existsSync(output)) throw new Error('Refusing to overwrite baseline artifact');
for(const journey of journeys){
  let thread_id=null;
  const actor=actorFor(journey.actor_role,journey.surface);
  for(const turn of journey.turns){
    const started=Date.now(),requestId=randomUUID();
    const record={journey_id:journey.id,turn_number:turn.number,worker:journey.worker,surface:journey.surface,actor_role:journey.actor_role,prompt:turn.prompt,objective:journey.objective,envelope:turn.envelope,request_id:requestId};
    try{
      const response=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,journey.surface),input:{message:turn.prompt,surface:journey.surface,estate_id:actor.estate_id||null,home_id:actor.home_id||null,thread_id,context:{request_id:requestId,correlation_id:requestId,...(journey.surface==='office_internal'?{operational_snapshot:officeWorld}:{})}}});
      thread_id=response.thread_id||thread_id;
      await flushConversationTraceWrites();
      const trace=await supabaseAdmin.from('oyi_conversation_traces').select('*').eq('turn_ref',opaqueReference('turn',requestId)).maybeSingle();
      Object.assign(record,{thread_id,response,trace:trace.data||null,trace_error:trace.error?.code||null,latency_ms:Date.now()-started,status:'BLOCKED',failure_type:'EVALUATOR_HARNESS_FAILURE',review_reason:'Complete envelope review pending; no automatic judgment credit.',scores:Object.fromEntries(['understanding','context_memory','evidence','reasoning_judgment','initiative','communication','action_judgment'].map(k=>[k,null]))});
    }catch(error){Object.assign(record,{thread_id,status:'BLOCKED',failure_type:'INFRASTRUCTURE_BLOCKED',error:String(error?.message||error),latency_ms:Date.now()-started});}
    records.push(record);
    fs.writeFileSync(output,JSON.stringify(artifact,null,2)+'\n');
  }
  console.log(JSON.stringify({journey:journey.id,completed:records.length,total:280}));
}
artifact.completed_at=new Date().toISOString();
fs.writeFileSync(output,JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({journeys:journeys.length,turns:records.length,output,review:'required'}));
process.exit(0);
