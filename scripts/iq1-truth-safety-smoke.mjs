import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
process.env.SUPABASE_URL='http://127.0.0.1:55421';
process.env.SUPABASE_SERVICE_ROLE_KEY='unit-test-no-network';
const require=createRequire(import.meta.url);
for(const pkg of ['bullmq','ioredis']) {
  const p=require.resolve(pkg); class Inert { on(){return this;} quit(){return Promise.resolve();} }
  Inert.default=Inert; Inert.Redis=Inert; Inert.Queue=Inert; Inert.Worker=Inert;
  require.cache[p]={id:p,filename:p,loaded:true,exports:Inert};
}
globalThis.fetch=()=>{throw Error('No network in IQ-1 unit regression');};
const {buildOfficeInternalReadCapabilities}=require('../dist/oyi-core/capabilities/OfficeCorporateCapabilityModules.js');
const {publicOpportunityReadModule}=require('../dist/oyi-core/capabilities/PublicOpportunityCapabilityModule.js');
const bridge=require('../dist/oyi-core/ingress/officeHandoffBridge.js');
const {parseSemanticFrame}=require('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {ActionService}=require('../dist/oyi-core/actions/ActionService.js');
const {InMemoryActionRepository}=require('../dist/oyi-core/actions/ActionRepository.js');
const {WorkflowService}=require('../dist/oyi-core/workflows/WorkflowService.js');
const {InMemoryWorkflowRepository}=require('../dist/oyi-core/workflows/WorkflowRepository.js');
const {createOrContinueDeviceActionDraft}=require('../dist/oyi-core/capabilities/DeviceActionCapabilityModules.js');
const tests=[];
async function test(name,fn){try{await fn();tests.push({name,status:'PASS'});}catch(e){tests.push({name,status:'FAIL',error:e.message});}}
const modules=buildOfficeInternalReadCapabilities();
async function answer(key,snapshot){return modules.find(c=>c.key===key).buildReadResponse({input:{context:{operational_snapshot:snapshot}},resolvedTurn:{}},[]);}
await test('aggregate category equality, partial and unknown counts',async()=>{
  for(const values of [[8,21,60],[14,21,60],[null,21,60],[null,null,null],[8,9,10]]){
    const r=await answer('crm.opportunities.read',{opportunities:{total_open:9,stale:values.map((v,i)=>({id:`o${i}`,name:`Test ${i}`,days_since_activity:v}))}});
    const n=values.filter(v=>v!==null&&v>=14).length;
    assert.equal(/\bAll\b/.test(r.answer),n===values.length);
    if(n>0&&n<values.length)assert.match(r.answer,new RegExp(`\\b${n} (?:have|has)`));
  }
});
await test('empty is not proof of recent contact; absent snapshot unavailable',async()=>{
  const empty=await answer('crm.opportunities.read',{opportunities:{total_open:3,stale:[]}});
  assert.equal(empty.status,'empty');assert.doesNotMatch(empty.answer,/All.*recently/);
  assert.equal((await answer('crm.opportunities.read',{})).status,'unavailable');
});
await test('heterogeneous lead reasons never become implicit no-contact',async()=>{
  const run=reasons=>answer('crm.leads.read',{leads:{total_open:39,needing_attention:reasons.map((reason,i)=>({id:`l${i}`,name:`Lead ${i}`,reason}))}});
  assert.doesNotMatch((await run(['owner consent supplied','unknown',null])).answer,/All|no recent communication/);
  assert.match((await run(['No activity in 20 days','No recent communication'])).answer,/All have had no recent communication/);
  const mixed=await run(['Next action overdue since 2026-01-01','No recorded contact yet','unknown']);
  assert.match(mixed.answer,/1 has an overdue follow-up/);assert.match(mixed.answer,/1 has no recorded contact yet/);assert.doesNotMatch(mixed.answer,/All|no recent communication/);
});
await test('callback failure, timeout, rejected and incomplete receipt preserve objective',async()=>{
  const objective={objective_type:'development_partnership',known_facts:{location:'VI',land_size:'1200 sqm'},constraints:['no_sale']};
  const cap=publicOpportunityReadModule();
  for(const outcome of [{ok:false,reason:'not_configured'},{ok:false,reason:'timeout'},{ok:false,reason:'office_http_500'},{ok:true,handoff_id:'',status:'pending',routing_status:'unassigned'},{ok:true,handoff_id:'h',status:'failed',routing_status:'failed'}]){
    bridge.requestOfficeHandoff=async()=>outcome;
    const r=await cap.buildReadResponse({input:{message:'Can someone call me?',thread_id:'synthetic'},resolvedTurn:{request_id:'synthetic'}},[{payload:{objective}}]);
    assert.equal(r.status,'unavailable');assert.equal(r.metadata.office_handoff_ok,false);
    assert.strictEqual(r.metadata.public_opportunity_objective,objective);
    assert.match(r.answer,/no callback is confirmed/);assert.doesNotMatch(r.answer,/will follow up|will be in touch|call is booked/);
  }
  bridge.requestOfficeHandoff=async()=>({ok:true,handoff_id:'h',status:'pending',routing_status:'unassigned'});
  const r=await cap.buildReadResponse({input:{message:'Can someone call me?'},resolvedTurn:{request_id:'synthetic'}},[{payload:{objective}}]);
  assert.equal(r.status,'answered');assert.equal(r.metadata.office_handoff_ok,true);assert.match(r.answer,/not been booked or confirmed/);
});
await test('negated power and cancellation cannot emit mutation',()=>{
  for(const p of ["Do not turn it off.","Don't turn off the kitchen light.","Actually don’t.","Cancel any pending proposal.","Cancel the pending action.","Never switch the bedroom light on.","Actually cancel any proposal.","Do not do it; explain the limits.","No."]){
    const f=parseSemanticFrame(p);assert.equal(f.operation,'cancel',p);assert.equal(f.mutationIntent,false,p);
  }
  assert.equal(parseSemanticFrame('Turn off the kitchen light.').operation,'device.power.off');
});
await test('terminal workflow cannot create a fresh action or continue draft',async()=>{
  const as=new ActionService(new InMemoryActionRepository());
  for(const status of ['cancelled','failed','expired','superseded','completed']) {
    await assert.rejects(()=>as.create({workflow:{status},target:{},requestedOperation:'device.power.off',requestedState:false}),/terminal workflow/);
    const r=await createOrContinueDeviceActionDraft({input:{message:'The kitchen light.'}}, {status}, {requested:false});
    assert.equal(r.status,'unsupported');assert.equal(r.metadata?.action_id,undefined);
  }
});
await test('cancelled/failed actions reject repeated and stale approval/execution',async()=>{
  for(const terminal of ['cancelled','failed']){
    const repo=new InMemoryActionRepository(),as=new ActionService(repo);
    let a=await as.create({workflow:{workflow_id:'w',status:'awaiting_approval',thread_id:'t',capability_key:'devices.power.control',domain:'devices'},actorId:'a',target:{object_type:'device',canonical_id:'d'},requestedOperation:'device.power.off',requestedState:false});
    const stale=a;
    if(terminal==='cancelled') a=await as.cancel(a,'a');
    else {a=await as.approve(a,'a');a=await as.executeWithAdapter(a,{execute:async()=>({status:'failed'})});}
    for(let i=0;i<2;i++){
      const approved=await as.approve(a,'a'); assert.equal(approved.status,terminal);
      await assert.rejects(()=>as.executeWithAdapter(approved,{execute:async()=>{throw Error('MUST NOT EXECUTE');}}),/approved/);
    }
    await assert.rejects(()=>as.approve(stale,'a'),/revision conflict/i);
  }
});
await test('cancelled workflow is unrestorable by thread or explicit stale reference',async()=>{
  const repo=new InMemoryWorkflowRepository(),ws=new WorkflowService(repo);
  const w=await ws.create({request_id:'r',thread_id:'t',actor:{id:'a'},domain:'devices',capability_key:'devices.power.control',context:{surface:'consumer'},scope:{}},'awaiting_clarification');
  await ws.cancel(w);
  assert.equal(await ws.restoreActive({threadId:'t',actorId:'a'}),null);
  assert.equal(await ws.restoreReferenced({workflowId:w.workflow_id,threadId:'t',actorId:'a'}),null);
});
console.log(JSON.stringify({suite:'IQ-1 truth/safety',tests,pass:tests.filter(x=>x.status==='PASS').length,fail:tests.filter(x=>x.status==='FAIL').length},null,2));
process.exit(tests.some(x=>x.status==='FAIL')?1:0);
