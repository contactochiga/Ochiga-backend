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
const corpus=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq10d-development-contract.json'));
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
const turn=(id,n)=>journeys.find(j=>j.id===id).turns[n-1],answer=(id,n)=>turn(id,n).response.answer;
// "owned by" and "owner" express the same facet; no wording-only failure.
check('office-selected-owner',()=>{assert.match(answer('D-OMA',2),/own(?:er|ed by)/i);assert.match(answer('D-OMA',2),/Abuja JV.*office admin/i);assert.doesNotMatch(answer('D-OMA',2),/not authorised/);});
check('facility-category',()=>assert.match(answer('D-FACILITY',2),/category.*plumbing/i));
check('consumer-category',()=>assert.match(answer('D-CONSUMER',3),/category.*plumbing/i));
check('visitor-permission-not-arrival',()=>assert.match(answer('D-FACILITY',4),/not.*(?:arrival|presence)|permission.*not|does not establish/i));
check('wallet-separate-balance',()=>{assert.match(answer('D-CONSUMER',1),/balance/i);assert.match(answer('D-CONSUMER',1),/transaction|history/i);});
check('availability-not-power',()=>assert.match(answer('D-CONSUMER',5),/not|can't|cannot/i));
check('osa-first-identity',()=>{assert.match(answer('D-OSA',4),/Lokoja/);assert.doesNotMatch(answer('D-OSA',4),/Akure/);});
check('osa-second-identity',()=>{assert.match(answer('D-OSA',5),/Akure/);assert.doesNotMatch(answer('D-OSA',5),/Lokoja/);});
check('osa-first-constraint',()=>{const es=turn('D-OSA',5).metadata.public_opportunity_objective.entities;assert(es[0].constraints.includes('no_sale'));assert(!es[1].constraints.includes('no_sale'));assert.equal(es[0].known_facts.structure_offered,'lease');assert.doesNotMatch(answer('D-OSA',4),/structure offered: sale/);});
check('office-status-followup-answers-not-menu',()=>{assert.match(answer('D-OMA',4),/planning/);assert.doesNotMatch(answer('D-OMA',4),/Ask me about any|I can help with/);});
check('osa-withdrawal',()=>{const es=turn('D-OSA',7).metadata.public_opportunity_objective.entities;assert.equal(es[0].status,'withdrawn');assert.equal(es[1].status,'active');assert.match(answer('D-OSA',7),/Akure/);});
check('no-physical-execution',()=>assert.equal(executed,0));
const output={turns:journeys.reduce((s,j)=>s+j.turns.length,0),tests:checks.length,pass:checks.filter(x=>x.status==='PASS').length,fail:checks.filter(x=>x.status==='FAIL').length,checks,journeys,executed};
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify(output,null,2));console.log(JSON.stringify({tests:output.tests,pass:output.pass,fail:output.fail}));process.exitCode=output.fail?1:0;
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+'\n'+tests],{env:process.env,stdio:'inherit',timeout:240000});process.exitCode=p.status??1;
