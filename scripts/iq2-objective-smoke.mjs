import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const require=createRequire(import.meta.url);
for(const pkg of ['bullmq','ioredis']){const p=require.resolve(pkg);class Inert{on(){return this;}quit(){return Promise.resolve();}}Inert.default=Inert;Inert.Redis=Inert;Inert.Queue=Inert;Inert.Worker=Inert;require.cache[p]={id:p,filename:p,loaded:true,exports:Inert};}
const fetchOriginal=globalThis.fetch;
globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert(['127.0.0.1','localhost'].includes(u.hostname)&&u.port==='55421');return fetchOriginal(input,options);};
require('../dist/controllers/deviceCommandController.js').executeDeviceCommandForActor=async()=>{throw Error('IQ2_EXECUTION_FORBIDDEN');};
const {parseSemanticFrame}=await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {nextConversationAssessment,validAssessment,ASSESSMENT_TTL_MS,loadConversationAssessment}=await import('../dist/oyi-core/context/conversationAssessmentContext.js');
const {conversationOrchestrator}=await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const {supabaseAdmin:db}=await import('../dist/supabase/supabaseClient.js');
const {workflowService}=await import('../dist/oyi-core/workflows/defaultWorkflowActionServices.js');
const source=fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs','utf8');
const {actorFor,oisContext,officeSnapshot}=new Function(`${source.slice(source.indexOf('const ids = '),source.indexOf('function expected(prompt)'))};return {actorFor,oisContext,officeSnapshot};`)();
const cases=[
 ['What can you do?',null],['What can Oma help me with?',null],['What actions can you perform?',null],
 ["Show me today's leads.",'retrieve'],['Give me the short version.','summarize'],
 ['What actually needs my attention?','assess'],['Is everything okay?','assess'],['Anything dangerous?','assess'],
 ['Does this sound like something Ochiga would pursue?','assess'],['Is this a strong opportunity?','assess'],
 ['Which three things can actually move Ochiga forward?','prioritize'],['What can wait?','prioritize'],
 ['Compare the two opportunities.','compare'],['Why is the second one more important?','explain'],['Why?','explain'],
 ['What would you do?','advise'],['What should I do next?','advise'],['Does that change your priority?','reassess'],
 ['Would turning off the kitchen light help save energy?','advise'],
 ["Actually don't.",null],['No, the bedroom one.',null],
 ['What matters here?','assess'],['What should I care about?','assess'],['What deserves attention?','assess'],
 ['Anything important?','assess'],['Which is more important?','compare'],['Which would you choose?','prioritize'],
 ['What do you think?','assess'],["What's your view?",'assess'],['Would you pursue it?','advise'],
 ['Is this worth it?','assess'],['Should I worry?','assess'],['How come?','explain'],
 ['Does that change your view?','reassess'],['Would you still prioritize it?','reassess'],['Given that, what now?','reassess'],
 ['Who is coming today?','retrieve'],['Do you have a yesterday baseline?','assess'],
 ['Do not invent an owner.','assess'],['Draft a decision brief.','summarize'],['What can be delegated?','advise'],
];
for(const [prompt,objective]of cases)assert.equal(parseSemanticFrame(prompt).cognitiveObjective,objective,prompt);
assert.equal(parseSemanticFrame('Would turning off the kitchen light help save energy?').mutationIntent,false);
assert.notEqual(parseSemanticFrame('Why?').operation,'device.diagnosis');
const now=Date.now();const initial=nextConversationAssessment(null,parseSemanticFrame('What matters most?'),'office_internal',now);assert(initial);
assert.equal(validAssessment(initial,'consumer',now),null);
assert.equal(validAssessment(initial,'office_internal',now+ASSESSMENT_TTL_MS),null);
assert.equal(nextConversationAssessment(initial,parseSemanticFrame('Show wallet history.'),'office_internal',now+1),null);
assert.equal(nextConversationAssessment(initial,parseSemanticFrame("Actually don't."),'office_internal',now+1),null);
assert.equal(nextConversationAssessment(initial,parseSemanticFrame('Why?'),'office_internal',now+1).question,initial.question);
assert.equal(nextConversationAssessment(initial,parseSemanticFrame('Is that just the biggest deal?'),'office_internal',now+1).question,initial.question);
for(const prompt of ['Why that?','Why not the other one?','What about this?','And now?','So?','Then what?','Still?','Which one?','The second one?']) {
 const state=nextConversationAssessment(initial,parseSemanticFrame(prompt),'office_internal',now+1);
 assert(state,prompt);assert.deepEqual(state.subject_domains,initial.subject_domains,prompt);
}
const corrected=nextConversationAssessment(initial,parseSemanticFrame('Actually, forget the leads. I mean the developments.'),'office_internal',now+1);
assert.equal(corrected.domain,'office_development');
const withClaim={...initial,target_ref:{canonical_id:'test-only',object_type:'lead',label:'synthetic'},pending_information:'unverified',material_information:{text:'unverified',target_id:'test-only',source:'user_assertion'}};
const scopeChanged=nextConversationAssessment(withClaim,parseSemanticFrame('Actually, forget the leads. I mean the developments.'),'office_internal',now+1);
assert.equal(scopeChanged.target_ref,null);assert.equal(scopeChanged.pending_information,null);assert.equal(scopeChanged.material_information,null);
assert.equal(nextConversationAssessment(initial,parseSemanticFrame("No, that's not what I mean."),'office_internal',now+1)?.objective,'prioritize');
assert.equal(nextConversationAssessment(initial,parseSemanticFrame('Show devices.'),'consumer',now+1),null);
const informed=nextConversationAssessment(initial,parseSemanticFrame('The Chairman for that project says financing is secured.'),'office_internal',now+1);
assert.equal(nextConversationAssessment(informed,parseSemanticFrame('The VI development.'),'office_internal',now+2).pending_information,informed.pending_information);
const results=[];
for(const [surface,role,prompts]of [
 ['office_internal','ochiga_staff',["I just got into the office. What actually needs my attention today?","Show me today's leads.",'Which three things matter most?','Why is the second one more important?','The Chairman for that project says financing is already secured.','Does that change your priority?']],
 ['public_corporate','public',['Is this a strong opportunity?','What should I do next?','Why?']],
 ['facility','facility_manager',['Anything dangerous?','What can wait?','Why?']],
 ['consumer','resident',['Is everything okay?','What would you do?','Why?','Does that prove the AC caused it?']],
]){
 const actor=actorFor(role,surface);let thread=null;
 for(const prompt of prompts){const input={message:prompt,surface,thread_id:thread,estate_id:actor?.estate_id,home_id:actor?.home_id,context:{request_id:randomUUID(),...(surface==='office_internal'?{operational_snapshot:officeSnapshot()}:{})}};
  const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,surface),input});thread=r.thread_id;
  assert.equal(r.persistence_saved,true);assert.notEqual(r.execution.current_turn_execution,true);
  if(prompt==="Show me today's leads.")assert.doesNotMatch(r.answer,/not authorised|not available/);
  if(prompt==="Show me today's leads."){const q=await db.from('oyi_conversation_threads').select('metadata').eq('id',thread).single();assert(!q.error);assert(q.data.metadata.result_sets.crm.object_refs.length>1,'Collision test needs a real previous CRM list');}
  assert.doesNotMatch(r.answer,/office_tasks query read|Ask me about any of these directly/);
  if(prompt.includes('got into the office')){assert.doesNotMatch(r.answer,/doesn't manage global/);assert.match(r.answer,/leads|opportunities/);}
  if(prompt.includes('second one'))assert.doesNotMatch(r.answer,/IQ Qualified Abuja JV/);
  if(prompt.includes('prove the AC'))assert.notEqual(r.capability_key,'devices.availability.read');
  const assessment=await loadConversationAssessment({...input,thread_id:thread},actor?.id||null);
  if(prompt!=="Show me today's leads.")assert(assessment,`${surface}: ${prompt}`);
  if(assessment){assert(assessment.subject_domains.length);assert(assessment.required_evidence_domains.length||assessment.restricted_evidence_domains.length);assert(assessment.missing_evidence_domains.every(d=>assessment.required_evidence_domains.includes(d)));}
  if(prompt.includes('Chairman'))assert.equal(assessment.pending_information,prompt);
  results.push({surface,prompt,answer:r.answer,assessment,persisted:r.persistence_saved});
 }
}
// Public capability discovery remains explicit; assessment prose must not
// select that worker accidentally. No new transport or execution sink.
{
 const actor=actorFor('resident','consumer');
 const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'consumer'),input:{surface:'consumer',message:'What can you access for my own home?',estate_id:actor.estate_id,home_id:actor.home_id}});
 assert.equal(r.capability_key,'global.capabilities.read');assert(r.persistence_saved);assert.notEqual(r.execution.current_turn_execution,true);
 results.push({surface:'consumer',prompt:'What can you access for my own home?',answer:r.answer,persisted:r.persistence_saved});
}
{
 const actor=actorFor('resident','consumer');let thread=null,workflowId=null;
 for(const [i,prompt]of ['Turn it off.','Would turning off the kitchen light help save energy?',"Actually don't."].entries()){
  const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'consumer'),input:{surface:'consumer',message:prompt,thread_id:thread,estate_id:actor.estate_id,home_id:actor.home_id}});thread=r.thread_id;
  assert(r.persistence_saved);assert.notEqual(r.execution.current_turn_execution,true);
  if(i===0){const w=await workflowService.restoreActive({threadId:thread,actorId:actor.id});assert.equal(w.status,'awaiting_clarification');workflowId=w.workflow_id;}
  const w=await workflowService.get(workflowId);
  if(i===1){assert.equal(w.status,'awaiting_clarification');assert(!w.action_id,'Advice must not answer pending target clarification');}
  if(i===2)assert.equal(w.status,'cancelled');
  results.push({surface:'consumer',prompt,answer:r.answer,workflow_status:w.status,persisted:r.persistence_saved});
 }
}
// Live expiry, explicit scope correction and domain switch use the SAME thread
// persistence, not a fake state machine. Never touch fixture operational data.
{
 const actor=actorFor('ochiga_staff','office_internal');let thread=null;
 for(const prompt of ['What matters most?','Actually, forget the leads. I mean the developments.','Show today\'s leads.']){
  const input={surface:'office_internal',message:prompt,thread_id:thread,context:{operational_snapshot:officeSnapshot()}};
  const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'office_internal'),input});thread=r.thread_id;assert(r.persistence_saved);
  const assessment=await loadConversationAssessment({...input,thread_id:thread},actor.id);
  if(prompt.includes('I mean'))assert.equal(assessment.domain,'office_development');
  if(prompt.startsWith('Show'))assert.equal(assessment,null);
  results.push({surface:'office_internal',prompt,answer:r.answer,assessment,persisted:r.persistence_saved});
 }
 const input={surface:'office_internal',message:'What matters most?',thread_id:thread,context:{operational_snapshot:officeSnapshot()}};
 const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'office_internal'),input});assert(r.persistence_saved);
 const q=await db.from('oyi_conversation_threads').select('metadata').eq('id',thread).single();assert(!q.error);
 q.data.metadata.conversation_assessment.expires_at=new Date(Date.now()-1).toISOString();
 const w=await db.from('oyi_conversation_threads').update({metadata:q.data.metadata}).eq('id',thread);assert(!w.error);
 assert.equal(await loadConversationAssessment(input,actor.id),null);
 assert.equal(await loadConversationAssessment(input,'30000000-0000-4000-8000-000000000002'),null);
 results.push({surface:'office_internal',prompt:input.message,answer:r.answer,expired_context_rejected:true,persisted:r.persistence_saved});
}
// Bind a claim only to an actually selected, authorized result. Corrections
// must remove that pointer; no claim or confirmation executes anything.
{
 const actor=actorFor('ochiga_staff','office_internal');let thread=null,target=null;
 const prompts=["Show me today's leads.",'Tell me about the second one.','Would you pursue it?',
  'The owner can only meet tomorrow.','Does that change your view?',
  'Actually, forget the leads. I mean the developments.'];
 for(const [i,prompt]of prompts.entries()){
  const input={surface:'office_internal',message:prompt,thread_id:thread,context:{operational_snapshot:officeSnapshot()}};
  const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'office_internal'),input});thread=r.thread_id;
  assert(r.persistence_saved);assert.notEqual(r.execution.current_turn_execution,true);
  const a=await loadConversationAssessment({...input,thread_id:thread},actor.id);
  if(i===2){assert(a.target_ref,'The live selected lead must seed the assessment');target=a.target_ref.canonical_id;}
  if(i===3){assert.equal(a.material_information.target_id,target);assert.equal(a.material_information.source,'user_assertion');assert.equal(a.material_information.text,prompt);}
  if(i===4){assert.equal(a.objective,'reassess');assert.equal(a.material_information.target_id,target);}
  if(i===5){assert.equal(a.target_ref,null);assert.equal(a.material_information,null);assert.deepEqual(a.subject_domains,['office_development']);}
  results.push({surface:input.surface,prompt,answer:r.answer,assessment:a,persisted:r.persistence_saved});
 }
}
for(const [surface,role]of [['office_internal','ochiga_staff'],['public_corporate','public'],['facility','facility_manager'],['consumer','resident']]){
 const actor=actorFor(role,surface);let thread=null,subjects=null;
 for(const prompt of ['What matters most?','How come?','And now?','So?','Then what?','Still?','Which one?']){
  const input={surface,message:prompt,thread_id:thread,estate_id:actor?.estate_id,home_id:actor?.home_id};
  const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,surface),input});thread=r.thread_id;
  const a=await loadConversationAssessment({...input,thread_id:thread},actor?.id||null);assert(a,prompt);
  if(subjects)assert.deepEqual(a.subject_domains,subjects,`${surface}: ${prompt}`);subjects=a.subject_domains;
  assert.doesNotMatch(r.answer,/Ask me about any of these|office_tasks query read/);assert(r.persistence_saved);assert.notEqual(r.execution.current_turn_execution,true);
  results.push({surface,prompt,answer:r.answer,assessment:a,persisted:r.persistence_saved});
 }
}
fs.writeFileSync(`${process.env.WAVE11_HARNESS_OUT}.json`,JSON.stringify({status:'PASS',parser_cases:cases.length,turns:results},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',parser_cases:cases.length,live_turns:results.length}));
