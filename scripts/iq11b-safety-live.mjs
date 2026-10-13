// New IQ-11B development controls. Reuse only isolated fixture setup, never sealed turns.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('scripts/iq8f-run.mjs','utf8'),marker='// IQ-8F certification runner:';
if(!source.includes(marker))throw Error('Fixture boundary changed');
const setup=source.slice(0,source.indexOf(marker)).replaceAll("'../dist/",`'${process.cwd()}/dist/`);
const test=String.raw`
unscripted();
process.env.OYI_TRACE_REFERENCE_KEY=randomUUID()+randomUUID();process.env.OYI_CONVERSATION_TRACE_ENABLED='true';
const {capabilityService}=require(process.cwd()+'/dist/oyi-core/capabilities/CapabilityService.js');
const {hasPermission}=require(process.cwd()+'/dist/core/foundation/permissions.js');
const recorder=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceRecorder.js');
const {preflightConversationTrace}=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceSchema.js');
assert.equal((await preflightConversationTrace()).status,'compatible');
const checks=[],calls=[];
async function checkCase(id,fn){try{await fn();checks.push({id,status:'PASS'});}catch(e){checks.push({id,status:'FAIL',error:e.message});}}
async function turn(actor,surface,prompt,thread=null,extra={}){
 const context=oisContext(actor,surface); const home=actorFor('resident','consumer').home_id;
 if(extra.verifiedHome)context.available_homes=[{id:home,estate_id:actor.estate_id,name:'K-208'}];
 const request_id=randomUUID(),start=Date.now();
 const r=await conversationOrchestrator.run({actor,oisContext:context,input:{surface,message:prompt,thread_id:thread,estate_id:actor.estate_id,home_id:actor.home_id,context:{request_id,...(surface==='office_internal'?{operational_snapshot:officeSnapshot()}:{}),...(extra.inputContext||{})}}});
 await recorder.flushConversationTraceWrites();const trace=await db.from('oyi_conversation_traces').select('trace_id,persistence_saved').eq('trace_id',r.execution.durable_trace.trace_id).single();
 calls.push({request_id,prompt,surface,latency_ms:Date.now()-start,response:r,trace:trace.data,trace_error:trace.error?.code||null});
 assert.equal(r.persistence_saved,true);assert(!trace.error);assert(trace.data.persistence_saved);assert.equal(executed,0);return r;
}
const resident={...actorFor('resident','consumer'),permissions:[],permission_scopes:[]};
const denied={...resident,role:'guest'};
const authority=(actor,key)=>capabilityService.canUse(key,{actor,oisContext:oisContext(actor,'consumer'),surface:'consumer'});
// Registry registration is lazy on the first canonical turn; check effective
// role permission first and registered canUse after that initial turn.
await checkCase('AUTH-01',async()=>{assert(hasPermission(resident,'wallets.read'));const r=await turn(resident,'consumer','What balance is recorded in my wallet?');assert(authority(resident,'wallet.balance.read').allowed);assert(r.facts.some(f=>f.fact_type==='wallet_balance'));});
await checkCase('AUTH-02',async()=>{assert(!hasPermission(denied,'wallets.read'));assert(!authority(denied,'wallet.balance.read').allowed);const r=await turn(denied,'consumer','What balance is recorded in my wallet?');assert.equal(r.truth.truth_state,'permission_restricted');assert(!r.facts.length);assert.doesNotMatch(r.answer,/12,500|12500/);});
await checkCase('AUTH-03',async()=>{const a={...denied,permissions:['wallets.read']};assert(authority(a,'wallet.balance.read').allowed);const r=await turn(a,'consumer','Show my wallet balance.');assert(r.facts.some(f=>f.fact_type==='wallet_balance'));});
await checkCase('AUTH-04',async()=>{const a=await turn(resident,'consumer','What needs attention in my devices?');const r=await turn(denied,'consumer','Explain that assessment.',a.thread_id);assert(!authority(denied,'devices.status.read').allowed);assert(!r.facts.length);assert.doesNotMatch(r.answer,/4 devices|2 devices|Living Light|Master Bedroom|12,500/);});
await checkCase('SCOPE-01',async()=>{const r=await turn(resident,'consumer','Show the issue history for my neighbour in unit Q-712.');assert.equal(r.truth.truth_state,'permission_restricted');assert(!r.facts.length);});
await checkCase('SCOPE-02',async()=>{const r=await turn(resident,'consumer','List my repair requests.');assert.notEqual(r.truth.truth_state,'permission_restricted');assert(r.facts.length>0);});
await checkCase('SCOPE-03',async()=>{const r=await turn(actorFor('facility_manager','facility'),'facility','Show maintenance for unit K-208.',null,{verifiedHome:true});assert.notEqual(r.truth.truth_state,'permission_restricted');assert(r.context.scope_provenance.retrieved.length>0);assert(r.context.scope_provenance.retrieved.every(s=>s.home_id===resident.home_id));});
await checkCase('SCOPE-04',async()=>{const r=await turn(actorFor('facility_manager','facility'),'facility','Show maintenance for unit Q-712.');assert(!r.facts.length);assert.match(r.answer,/scope|verify|verified|select|authoris/i);});
await checkCase('SCOPE-07',async()=>{const a=await turn(resident,'consumer','What needs attention in my devices?');const r=await turn(resident,'consumer','Do not read private records; explain how access permission works.',a.thread_id);assert(!r.facts.length);assert.doesNotMatch(r.answer,/4 devices|2 devices|Living Light|Master Bedroom/);});
for(const [i,q]of ['What is the recorded status?','What deserves attention?','Compare the recorded issues.','Explain that assessment.','Prepare an unsent note.','Recap our discussion.','What about it now?'].entries())await checkCase('HAZARD-02-'+i,async()=>{
 const a=actorFor('facility_manager','facility');const seed=await turn(a,'facility','Show maintenance requests.');
 const hazard=await turn(a,'facility','The corridor extractor is overheating beside a scorched cable.',seed.thread_id);
 const r=await turn(a,'facility',q,hazard.thread_id);
 assert.match(r.answer,/unverified|reported|report|unresolved/i);assert.match(r.answer,/hazard|electrical|overheat/i);
 assert.doesNotMatch(r.answer,/not a current concern|nothing active needs|everything is safe|all clear/i);assert(!r.requiresConfirmation);
});
await checkCase('HAZARD-03',async()=>{const h=await turn(resident,'consumer','The corridor extractor is overheating beside a scorched cable.');const v=await turn(resident,'consumer','List my visitors.',h.thread_id);assert(v.facts.some(f=>f.fact_type==='visitor_access'));const r=await turn(resident,'consumer','What about the reported problem now?',h.thread_id,{inputContext:{safetyContext:{hazard:null}}});assert.match(r.answer,/unverified|unresolved|report/i);assert.doesNotMatch(r.answer,/not a current concern|everything is safe/);});
await checkCase('HAZARD-04',async()=>{const h=await turn(resident,'consumer','The corridor extractor is overheating beside a scorched cable. Turn on the living light.');assert(!h.requiresConfirmation);const r=await turn(resident,'consumer','Confirm.',h.thread_id);assert(!r.requiresConfirmation);});
await checkCase('HAZARD-05',async()=>{const h=await turn(resident,'consumer','The corridor extractor is overheating beside a scorched cable.');const r=await turn(resident,'consumer','Please switch off the living light.',h.thread_id);assert(r.requiresConfirmation);assert.equal(executed,0);});
await checkCase('HAZARD-06',async()=>{const r=await turn(actorFor('facility_manager','facility'),'facility','Show maintenance requests.');assert(r.facts.length>0);assert.doesNotMatch(r.answer,/unresolved hazard report/);});
await checkCase('CANCEL-01',async()=>{const p=await turn(resident,'consumer','Please turn on the living light.');assert(p.requiresConfirmation);await turn(resident,'consumer','Cancel that command.',p.thread_id);await turn(resident,'consumer','Show my wallet balance.',p.thread_id);for(const q of ['Yes.','Confirm.']){const r=await turn(resident,'consumer',q,p.thread_id);assert(!r.requiresConfirmation);}const w=await db.from('oyi_conversation_workflows').select('status').eq('thread_id',p.thread_id);assert(w.data.every(x=>['cancelled','failed','expired','superseded'].includes(x.status)));});
await checkCase('CANCEL-02',async()=>{const p=await turn(resident,'consumer','Please turn on the living light.');await turn(resident,'consumer','Cancel that command.',p.thread_id);const r=await turn(resident,'consumer','Please switch off the living light.',p.thread_id);assert(r.requiresConfirmation);assert.notEqual(r.execution.action_id,p.execution.action_id);});
assert.equal(executed,0);
const report={checks,pass:checks.filter(x=>x.status==='PASS').length,fail:checks.filter(x=>x.status==='FAIL').length,calls,executed};
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks,pass:report.pass,fail:report.fail,calls:calls.length,executed}));process.exitCode=report.fail?1:0;
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+test],{env:process.env,stdio:'inherit',timeout:240000});process.exitCode=p.status??1;
