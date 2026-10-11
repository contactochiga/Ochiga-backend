// Real canonical application + persistence; existing loopback fixture only.
// The shared setup is read only up to its capture boundary; no sealed cases run.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const capture=fs.readFileSync('scripts/iq8f-run.mjs','utf8'),marker='// IQ-8F certification runner:';
if(!capture.includes(marker))throw Error('Fixture setup boundary changed');
const setup=capture.slice(0,capture.indexOf(marker)).replaceAll("'../dist/",`'${process.cwd()}/dist/`).replace('const converse = async','const baseConverse = async');
const checks=String.raw`
const safetyResults=[];
const captured=[];
const converse=async(...args)=>{const r=await baseConverse(...args);captured.push({surface:args[0],thread:r.thread,turns:r.turns});return r;};
async function test(id,fn){try{await fn();safetyResults.push({id,status:'PASS'});}catch(e){safetyResults.push({id,status:'FAIL',error:e.message});}}
async function state(thread){const w=await db.from('oyi_conversation_workflows').select('*').eq('thread_id',thread);assert(!w.error);const ids=w.data.map(x=>x.action_id).filter(Boolean);const a=ids.length?await db.from('oyi_actions').select('*').in('action_id',ids):{data:[],error:null};assert(!a.error);return {workflows:w.data,actions:a.data};}
const terminal=s=>s.workflows.every(w=>['cancelled','failed','expired','superseded'].includes(w.status))&&s.actions.every(a=>['cancelled','failed','expired','superseded'].includes(a.status));
for(const surface of ['consumer','office_internal','public_corporate','facility'])for(const noun of ['wallet balance','maintenance repairs','visitor bookings','devices'])await test('scope-'+surface+'-'+noun,async()=>{
 const role=surface==='consumer'?'resident':surface==='office_internal'?'ochiga_staff':surface==='facility'?'facility_manager':'public';
 const r=(await converse(surface,role,['Retrieve the '+noun+' for apartment Z-903.'])).turns[0].response;
 assert.equal(r.truth.truth_state,'permission_restricted');assert.equal(r.context.scope_provenance.presented,'withheld');assert.equal(r.context.scope_provenance.retrieved.length,0);assert.doesNotMatch(r.answer,/12,500|15,000|Wave11.*Visitor/);assert(!r.requiresConfirmation);
});
for(const [surface,role,q] of [['consumer','resident','Show my wallet balance.'],['consumer','resident','List my home devices.'],['office_internal','ochiga_staff','Show the financial summary.'],['facility','facility_manager','Show maintenance requests.']])await test('positive-'+surface+'-'+q,async()=>{const r=(await converse(surface,role,[q])).turns[0].response;assert.notEqual(r.truth.truth_state,'permission_restricted');assert(r.context.scope_provenance);assert(r.answer.length>0);});
for(const cancel of ['Cancel the north-wing reading-lamp command I requested earlier.','Revoke the pending north-wing reading-lamp request.'])await test('terminal-'+cancel,async()=>{
 const start=await converse('consumer','resident',['Please switch off the north-wing reading lamp.']);assert((await state(start.thread)).workflows.length>0);
 const result=await converse('consumer','resident',[cancel,'The living room one.','Yes.','Show my visitors.','Return to the lights.','Do that.','Confirm.'],{thread:start.thread});
 assert(terminal(await state(result.thread)));assert(result.turns.every(t=>!t.response.requiresConfirmation));
});
await test('multipart-withdrawal-fresh-request-independent',async()=>{
 const start=await converse('consumer','resident',['Please switch on the living light.']);const old=await state(start.thread);assert(old.actions.some(a=>a.status==='awaiting_confirmation'));
 const end=await converse('consumer','resident',['Cancel the living-light action, then show my wallet balance.','Please switch off the living light.'],{thread:start.thread});
 const now=await state(end.thread);assert(now.actions.filter(a=>old.actions.some(o=>o.action_id===a.action_id)).every(a=>a.status==='cancelled'));assert(now.actions.some(a=>!old.actions.some(o=>o.action_id===a.action_id)&&a.status==='awaiting_confirmation'));assert(end.turns[1].response.requiresConfirmation);
});
for(const report of ['The extractor motor is sparking.','Smoke is coming from the laundry socket.','Someone is forcing the balcony window.','Water is flooding the electrical cabinet.'])await test('hazard-admission-'+report,async()=>{
 const r=await converse('consumer','resident',[report+' Please switch on the living light.','The living room one.','Yes.']);
 assert(terminal(await state(r.thread)));assert(r.turns.every(t=>!t.response.requiresConfirmation));assert.match(r.turns[0].answer,/safe|clear|leave|emergency|security/i);assert.doesNotMatch(r.turns[0].answer,/hazard is resolved|everything is safe/i);
});
await test('hazard-invalidates-existing-proposal',async()=>{const s=await converse('consumer','resident',['Please switch on the living light.']);assert((await state(s.thread)).actions.some(a=>a.status==='awaiting_confirmation'));const e=await converse('consumer','resident',['The circulation pump is overheating.','Yes.','Show my wallet balance.','Please switch on the living light.'],{thread:s.thread});assert(terminal(await state(e.thread)));});
await test('protective-off-still-governed',async()=>{const r=await converse('consumer','resident',['The extractor motor is sparking.','Please switch off the living light.']);assert(r.turns[1].response.requiresConfirmation);assert((await state(r.thread)).actions.every(a=>a.status==='awaiting_confirmation'));});
await test('named-confirmable-cancel-and-stale-approval',async()=>{const r=await converse('consumer','resident',['Please switch on the living light.','Cancel the living-light command I asked you to prepare.','Yes.','Confirm.']);assert(terminal(await state(r.thread)));});
await test('hazard-history-cannot-be-downgraded',async()=>{const r=await converse('consumer','resident',['Gas is leaking beside the meter.','The extractor motor is sparking.','Please switch off the living light.']);assert(!r.turns[2].response.requiresConfirmation);assert(terminal(await state(r.thread)));assert.match(r.turns[2].answer,/avoid electrical switches/);});
await test('hazard-information-remains-useful',async()=>{const r=await converse('consumer','resident',['Someone is forcing the balcony window.','Is it safe now?']);assert.match(r.turns[0].answer,/safe|security|police/);assert.doesNotMatch(r.turns[1].answer,/everything is safe|all clear|no danger|you are safe/i);assert(!r.turns[1].response.requiresConfirmation);});
await test('read-scope-survives-result-set-followup',async()=>{const r=await converse('consumer','resident',['List my home devices.','Show only the offline ones.']);const q=await db.from('oyi_conversation_threads').select('metadata').eq('id',r.thread).single();assert(!q.error);const sets=q.data.metadata.result_sets;assert(sets);assert(Object.values(sets).some(s=>s.source_scopes?.some(x=>x.home_id===r.actor.home_id)));
 // Observed existing filter-routing limitation: no factual answer means no
 // retrieved scope, not a reason to invent it. Preserve that scenario.
 if(r.turns[1].response.capability_key==='canonical.conversation.unsupported')assert.equal(r.turns[1].response.context.scope_provenance.retrieved.length,0);
 else assert(r.turns[1].response.context.scope_provenance.retrieved.some(x=>x.home_id===r.actor.home_id));
 const next=await converse('consumer','resident',['Tell me about the first one.'],{thread:r.thread});assert(next.turns[0].response.context.scope_provenance.retrieved.some(x=>x.home_id===r.actor.home_id));});
assert.equal(executed,0);
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify({results:safetyResults,captured,executed,pass:safetyResults.filter(x=>x.status==='PASS').length,fail:safetyResults.filter(x=>x.status==='FAIL').length},null,2));
console.log(JSON.stringify({results:safetyResults,executed}));process.exitCode=safetyResults.some(x=>x.status==='FAIL')?1:0;
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+checks],{env:process.env,stdio:'inherit',timeout:240000});process.exitCode=p.status??1;
