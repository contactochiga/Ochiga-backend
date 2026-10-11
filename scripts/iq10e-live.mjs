import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const fixture=fs.readFileSync('scripts/iq8f-run.mjs','utf8'),marker='// IQ-8F certification runner:';
if(!fixture.includes(marker))throw Error('Fixture boundary changed');
const setup=fixture.slice(0,fixture.indexOf(marker)).replaceAll("'../dist/",`'${process.cwd()}/dist/`).replace('const check = async','const fixtureCheck = async');
const tests=String.raw`
process.env.OYI_TRACE_REFERENCE_KEY=randomUUID()+randomUUID();process.env.OYI_CONVERSATION_TRACE_ENABLED='true';
const recorder=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceRecorder.js');
const schema=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceSchema.js');
assert.equal((await schema.preflightConversationTrace()).status,'compatible');
const corpus=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq10e-development-contract.json'));
const mapping={OSA:['public_corporate','public'],OMA:['office_internal','ochiga_staff'],FACILITY:['facility','facility_manager'],CONSUMER:['consumer','resident']};
const journeys=[],checks=[];
function check(id,fn){try{fn();checks.push({id,status:'PASS'});}catch(e){checks.push({id,status:'FAIL',error:e.message});}}
for(const j of corpus.journeys){
 const [surface,role]=mapping[j.worker],actor=actorFor(role,surface),turns=[];let thread=null;
 for(const prompt of j.turns){
  const start=Date.now();const response=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,surface),input:{surface,message:prompt,thread_id:thread,estate_id:actor.estate_id,home_id:actor.home_id,context:{request_id:randomUUID(),...(surface==='office_internal'?{operational_snapshot:officeSnapshot()}:{})}}});
  await recorder.flushConversationTraceWrites();thread=response.thread_id;
  const state=await db.from('oyi_conversation_threads').select('metadata').eq('id',thread).single();assert(!state.error);
  const trace=await db.from('oyi_conversation_traces').select('trace_id,persistence_saved').eq('trace_id',response.execution.durable_trace.trace_id).single();
  turns.push({prompt,response,metadata:state.data.metadata,latency_ms:Date.now()-start,trace:trace.data});
  check(j.id+':'+turns.length+':saved-traced',()=>{assert.equal(response.persistence_saved,true);assert(trace.data?.trace_id);assert.equal(trace.data.persistence_saved,true);});
 }
 journeys.push({...j,turns});
}
const t=(id,n)=>journeys.find(j=>j.id===id).turns[n-1],a=(id,n)=>t(id,n).response.answer;
check('office-provider-off',()=>{assert.match(a('E-OMA',3),/can.t|cannot|not.*rank|not.*order/i);assert.doesNotMatch(a('E-OMA',3),/invest in.*first|best investment/i);});
check('office-status-direct',()=>assert.match(a('E-OMA',2),/qualified|new|status/i));
check('osa-identity-recall',()=>{assert.match(a('E-OSA',4),/Minna/);assert.doesNotMatch(a('E-OSA',4),/Makurdi/);});
check('osa-no-contact-promise',()=>assert.doesNotMatch(a('E-OSA',6),/will (?:call|contact)|callback.*(?:booked|scheduled)/i));
check('device-availability-not-power',()=>assert.match(a('E-CONSUMER',2),/not|can.t|unknown|cannot/i));
check('visitor-permission-not-arrival',()=>assert.match(a('E-CONSUMER',5),/not|cannot|can.t|unknown/i));
check('facility-not-strategic-ranking',()=>assert.match(a('E-FACILITY',3),/recorded|cannot|can.t|partial/i));
check('no-execution',()=>assert.equal(executed,0));
const out={turns:journeys.reduce((s,j)=>s+j.turns.length,0),tests:checks.length,pass:checks.filter(x=>x.status==='PASS').length,fail:checks.filter(x=>x.status==='FAIL').length,checks,journeys,executed};
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify(out,null,2));console.log(JSON.stringify({tests:out.tests,pass:out.pass,fail:out.fail}));process.exitCode=out.fail?1:0;
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+'\n'+tests],{env:process.env,stdio:'inherit',timeout:240000});process.exitCode=p.status??1;
