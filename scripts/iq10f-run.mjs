// First-contact capture only; does not grade, replay failed runs or mutate runtime.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const worker=process.env.WAVE11_HARNESS_OUT?.split('-').at(-1);
assert(['OMA','OSA','FACILITY','CONSUMER'].includes(worker));
const runtime='46efdbbae5ad3090c389cf9ddc799f15e00e68e3';
assert.equal(execFileSync('git',['diff',runtime,'--','src','supabase','package.json','package-lock.json'],{encoding:'utf8'}),'');
const manifest=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq10f-corpus-manifest.json'));
for(const [path,hash] of Object.entries(manifest.hashes))assert.equal(createHash('sha256').update(fs.readFileSync(path)).digest('hex'),hash,path);
const markerPath=`artifacts/intelligence-quality-v1-iq10f-${worker}-first-contact.lock`;
fs.writeFileSync(markerPath,JSON.stringify({worker,runtime,started_at:new Date().toISOString(),manifest_sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')},null,2),{flag:'wx'});
const fixture=fs.readFileSync('scripts/iq8f-run.mjs','utf8'),marker='// IQ-8F certification runner:';
assert(fixture.includes(marker));
const setup=fixture.slice(0,fixture.indexOf(marker)).replaceAll("'../dist/",`'${process.cwd()}/dist/`);
const run=String.raw`
const worker=process.env.WAVE11_HARNESS_OUT.split('-').at(-1);
process.env.OYI_TRACE_REFERENCE_KEY=randomUUID()+randomUUID();process.env.OYI_CONVERSATION_TRACE_ENABLED='true';unscripted();
const recorder=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceRecorder.js');
const schema=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceSchema.js');
const preflight=await schema.preflightConversationTrace();assert.equal(preflight.status,'compatible');
const corpus=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq10f-author-'+worker+'.json'));
const mapping={OMA:['office_internal','ochiga_staff'],OSA:['public_corporate','public'],FACILITY:['facility','facility_manager'],CONSUMER:['consumer','resident']};
const [surface,role]=mapping[worker];
const rawPath=process.env.WAVE11_HARNESS_OUT+'.jsonl',fd=fs.openSync(rawPath,'wx');
const counts={attempted:0,scored:0,setup:0,saved:0,traced:0,paired:0,exceptions:0,duplicates:0};
async function turn(c,thread,scored,run_id){
 const actor=actorFor(c.actor_mode==='resident_b'?'resident_b':role,surface);
 if(c.actor_mode==='restricted'){actor.permissions=[];actor.permission_scopes=[];}
 const request_id=randomUUID(),start=Date.now();let response=null,error=null;
 try{response=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,surface),input:{surface,message:c.prompt,thread_id:thread,estate_id:actor.estate_id,home_id:actor.home_id,context:{request_id,...(surface==='office_internal'?{operational_snapshot:officeSnapshot()}:{})}}});}
 catch(e){error={name:e.name,message:String(e.message),code:e.code??null};}
 const latency_ms=Date.now()-start;
 await recorder.flushConversationTraceWrites();
 const tid=response?.thread_id||thread;
 const state=tid?await db.from('oyi_conversation_threads').select('metadata').eq('id',tid).single():{data:null,error:null};
 const trace_id=response?.execution?.durable_trace?.trace_id;
 const trace=trace_id?await db.from('oyi_conversation_traces').select('*').eq('trace_id',trace_id).single():{data:null,error:null};
 const messages=tid?await db.from('oyi_conversation_messages').select('id,role,metadata').eq('thread_id',tid).eq('metadata->>trace_request_id',response?.persistence_trace_request_id||request_id):{data:[],error:null};
 const record={worker,id:c.id,run_id,scored,kind:scored?(c.kind||'primary'):'setup',prompt:c.prompt,actor_mode:c.actor_mode||'default',request_id,thread_id:tid,response,error,latency_ms,metadata:state.data?.metadata??null,trace:trace.data,messages:messages.data,capture_errors:{state:state.error?.code??null,trace:trace.error?.code??null,messages:messages.error?.code??null},execution_attempts:executed};
 fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);
 counts.attempted++;counts[scored?'scored':'setup']++;
 if(response?.persistence_saved)counts.saved++;if(trace.data?.trace_id&&trace.data.persistence_saved)counts.traced++;
 if(messages.data?.length===2&&messages.data.some(x=>x.role==='user')&&messages.data.some(x=>x.role==='assistant'))counts.paired++;
 if(error)counts.exceptions++;if(response?.persistence_duplicate)counts.duplicates++;
 return tid;
}
for(const j of corpus.journeys){let thread=null;for(const c of j.turns)thread=await turn(c,thread,true,j.id);}
for(const c of corpus.companions){
 const j=corpus.journeys.find(j=>j.turns.some(p=>p.id===c.parent_id));assert(j);
 let thread=null;for(const seed of j.turns.slice(0,j.turns.findIndex(p=>p.id===c.parent_id)))thread=await turn(seed,thread,false,c.id);
 await turn(c,thread,true,c.id);
}
fs.closeSync(fd);
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify({worker,runtime:'46efdbbae5ad3090c389cf9ddc799f15e00e68e3',preflight,counts,execution_attempts:executed,raw_path:rawPath,finished_at:new Date().toISOString()},null,2),{flag:'wx'});
console.log(JSON.stringify({worker,counts,execution_attempts:executed}));
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+'\n'+run],{env:process.env,stdio:'inherit',timeout:270000});
process.exitCode=p.status??1;
