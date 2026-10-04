import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
assert(process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY);
for(const key of ['OPENAI_API_KEY','OFFICE_SYNC_KEY','OFFICE_API_KEY','RESEND_API_KEY','TUYA_ACCESS_ID','EDGE_API_URL','DATABASE_URL'])assert(!process.env[key]);
const require=createRequire(import.meta.url);
for(const pkg of ['bullmq','ioredis']) {
  const p=require.resolve(pkg);class Inert{on(){return this;}quit(){return Promise.resolve();}}
  Inert.default=Inert;Inert.Redis=Inert;Inert.Queue=Inert;Inert.Worker=Inert;
  require.cache[p]={id:p,filename:p,loaded:true,exports:Inert};
}
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert(['127.0.0.1','localhost'].includes(u.hostname)&&u.port==='55421','External egress forbidden');return originalFetch(input,options);};
const source=fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs','utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),'f4589f7ef35e1297ca2ec68e5e724904062c1f29478752302cd13a6f66557dd7');
const {actorFor,oisContext}=new Function(`${source.slice(source.indexOf('const ids = '),source.indexOf('function expected(prompt)'))};return {actorFor,oisContext};`)();
const {conversationOrchestrator}=await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const {supabaseAdmin:db}=await import('../dist/supabase/supabaseClient.js');
const {workflowService,actionService}=await import('../dist/oyi-core/workflows/defaultWorkflowActionServices.js');
// Any attempted physical execution is a failure, never a synthetic success.
const controller=require('../dist/controllers/deviceCommandController.js');
let executionAttempts=0,isolatedSinkEnabled=false;const isolatedInvocations=[];
controller.executeDeviceCommandForActor=async input=>{
  if(isolatedSinkEnabled){isolatedInvocations.push({deviceId:input.deviceId,command:input.command});return {final_status:'state_confirmed',command_execution_id:input.commandExecutionId};}
  executionAttempts++;throw Error('IQ1_PHYSICAL_EXECUTION_FORBIDDEN');
};
const plans=[
  ['clarify-cancel-target',['Turn it off.',"Actually don't.",'The kitchen light.','Yes.','Confirm.']],
  ['cancel-domain-return',['Turn it off.','Cancel any pending proposal.','Show wallet history.','Go back to devices.','The bedroom light.','Do that.','Yes.']],
  ['cancel-target-correction',['Turn off the kitchen light.','Cancel the pending action.','No, the bedroom one.','Confirm.','Confirm.']],
  ['negated-command',['Do not turn it off.','What would need confirmation?','Cancel any pending proposal.','The kitchen light.','Yes.']],
  ['negated-named-command',["Don't turn off the kitchen light.",'Confirm.','Do that.']],
  ['stale-reference',['Turn it off.',"Actually don't.",'The bedroom light.','Yes.','Confirm.']],
  ['cancel-courtesy',['Turn it off.','Actually cancel any proposal.','The kitchen light.','Yes.']],
  ['failed-intent',['Turn off the kitchen light.','Confirm.','Confirm.']],
];
const results=[];
for(const [id,prompts] of plans){
  const actor=actorFor('resident','consumer');let thread=null,oldWorkflow=null;
  let failure=null;const turns=[];
  try {
    for(const [i,prompt]of prompts.entries()){
      const rid=randomUUID();const response=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'consumer'),input:{message:prompt,surface:'consumer',estate_id:actor.estate_id,home_id:actor.home_id,thread_id:thread,...(id==='stale-reference'&&i>1?{workflow_id:oldWorkflow}:{}),context:{request_id:rid,correlation_id:rid}}});
      thread=response.thread_id||thread;
      const q=await db.from('oyi_conversation_workflows').select('*').eq('thread_id',thread);assert(!q.error,q.error?.message);
      // Initial proposal can precede creation/binding of the conversation thread.
      // Inspect authoritative workflow-linked actions, never an empty thread query.
      const actionIds=q.data.map(w=>w.action_id).filter(Boolean);
      const a=actionIds.length?await db.from('oyi_actions').select('action_id,status,target_id').in('action_id',actionIds):{data:[],error:null};assert(!a.error,a.error?.message);
      if(i===0&&id!=='negated-command'&&id!=='negated-named-command'){
        assert(q.data.length>0,'Setup must create a real pending workflow');oldWorkflow=q.data[0].workflow_id;
      }
      if(i===0&&['cancel-target-correction','failed-intent'].includes(id)){
        assert.equal(a.data.length,1,'Setup must have a real confirmable action');assert.equal(a.data[0].status,'awaiting_confirmation');
      }
      if(id==='failed-intent'&&i===0){
        const current=await actionService.get(a.data[0].action_id);assert(current);
        const approved=await actionService.approve(current,actor.id);
        const failed=await actionService.executeWithAdapter(approved,{execute:async()=>({status:'failed',safe_error:{code:'ISOLATED_TEST_FAILURE',message:'No device adapter invoked.'}})});
        assert.equal(failed.status,'failed');
        await workflowService.advanceToTerminal(await workflowService.get(oldWorkflow),failed);
      }
      if(i>=1 || id.startsWith('negated-')){
        assert(q.data.every(w=>['cancelled','failed','expired','superseded'].includes(w.status)),`Live workflow after cancellation at ${id}:${i+1}`);
        assert(a.data.every(x=>['cancelled','failed','expired','superseded'].includes(x.status)),`Live action after cancellation at ${id}:${i+1}`);
        if(oldWorkflow)assert.equal(await workflowService.restoreReferenced({workflowId:oldWorkflow,threadId:thread,actorId:actor.id,surface:'consumer'}),null);
      }
      assert.equal(response.persistence_saved,true);assert.notEqual(response.execution?.current_turn_execution,true);
      assert.equal(executionAttempts,0);
      turns.push({prompt,answer:response.answer,persisted:response.persistence_saved,workflow_states:q.data.map(w=>w.status),action_states:a.data.map(x=>x.status)});
    }
  }catch(e){failure=e.message;}
  results.push({id,status:failure?'FAIL':'PASS',failure,turns});
}
// Same canonical persistence path; failed bridge preserves opportunity across retries.
{
  const {loadPublicOpportunityObjective}=await import('../dist/oyi-core/context/publicOpportunityObjective.js');
  const actor=actorFor('guest','public_corporate');let thread=null,known=null,failure=null;const turns=[];
  try {
    for(const prompt of ['I own 1200 sqm of land in VI.','Can someone call me?','Can someone call me?','What would you need from me?']){
      const rid=randomUUID();const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'public_corporate'),input:{message:prompt,surface:'public_corporate',thread_id:thread,context:{request_id:rid,correlation_id:rid}}});
      thread=r.thread_id;assert.equal(r.persistence_saved,true);
      const objective=await loadPublicOpportunityObjective(thread);assert(objective);
      if(known)assert.deepEqual(objective.known_facts,known);else{known=objective.known_facts;assert(Object.keys(known).length>=2);}
      if(prompt.includes('call me')){assert.equal(r.execution.capability_result,'unavailable');assert.match(r.answer,/no callback is confirmed/);assert.doesNotMatch(r.answer,/will follow up|will be in touch/);}
      turns.push({prompt,answer:r.answer,persisted:r.persistence_saved,known_facts:objective.known_facts});
    }
  }catch(e){failure=e.message;}
  results.push({id:'failed-handoff-retry-objective',status:failure?'FAIL':'PASS',failure,turns});
}
// Positive control: confirmation still works for a NEW authorized request.
// The only executor is the explicit in-process sink above, never hardware.
{
  const actor=actorFor('resident','consumer');let thread=null,failure=null;const turns=[];
  isolatedSinkEnabled=true;
  try {
    for(const [i,prompt]of ['Turn off the kitchen light.','Yes.','Confirm.'].entries()){
      const rid=randomUUID();const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'consumer'),input:{message:prompt,surface:'consumer',estate_id:actor.estate_id,home_id:actor.home_id,thread_id:thread,context:{request_id:rid,correlation_id:rid}}});thread=r.thread_id;
      assert.equal(r.persistence_saved,true);
      assert.equal(isolatedInvocations.length,i===0?0:1,'Only explicit confirmation may call the isolated sink, once');
      if(i===0)assert.equal(r.requiresConfirmation,true);
      turns.push({prompt,answer:r.answer,persisted:r.persistence_saved,isolated_sink_calls:isolatedInvocations.length});
    }
  }catch(e){failure=e.message;}finally{isolatedSinkEnabled=false;}
  results.push({id:'new-authorized-confirmation-positive-control',status:failure?'FAIL':'PASS',failure,turns});
}
const out=process.argv[2];fs.writeFileSync(`${out}.json`,JSON.stringify({execution_attempts:executionAttempts,isolated_sink_invocations:isolatedInvocations,results},null,2)+'\n');
console.log(JSON.stringify({journeys:results.length,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length,executionAttempts}));
process.exit(results.some(x=>x.status==='FAIL')?1:0);
