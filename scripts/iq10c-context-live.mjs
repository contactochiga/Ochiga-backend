// New synthetic development journeys only; no sealed cases are evaluated.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const fixture=fs.readFileSync('scripts/iq8f-run.mjs','utf8'),marker='// IQ-8F certification runner:';
if(!fixture.includes(marker))throw Error('Fixture boundary changed');
const setup=fixture.slice(0,fixture.indexOf(marker)).replaceAll("'../dist/",`'${process.cwd()}/dist/`).replace('const check = async','const fixtureCheck = async');
const checks=String.raw`
process.env.OYI_TRACE_REFERENCE_KEY=randomUUID()+randomUUID();process.env.OYI_CONVERSATION_TRACE_ENABLED='true';
const recorder=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceRecorder.js');
const schema=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceSchema.js');
assert.equal((await schema.preflightConversationTrace()).status,'compatible');
const corpus=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq10c-development-contract.json'));
const mapping={OSA:['public_corporate','public'],OMA:['office_internal','ochiga_staff'],FACILITY:['facility','facility_manager'],CONSUMER:['consumer','resident']};
const journeys=[],checks=[];
function check(id,fn){try{fn();checks.push({id,status:'PASS'});}catch(e){checks.push({id,status:'FAIL',error:e.message});}}
for(const j of corpus.journeys){
 const [surface,role]=mapping[j.worker],actor=actorFor(role,surface),turns=[];let thread=null;
 const snapshot=surface==='office_internal'?officeSnapshot():null;
 for(const prompt of j.turns){
  const request=randomUUID();const start=Date.now();
  const response=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,surface),input:{surface,message:prompt,thread_id:thread,estate_id:actor.estate_id,home_id:actor.home_id,context:{request_id:request,...(snapshot?{operational_snapshot:snapshot}:{})}}});
  await recorder.flushConversationTraceWrites();thread=response.thread_id;
  const state=await db.from('oyi_conversation_threads').select('metadata').eq('id',thread).single();assert(!state.error);
  const trace=await db.from('oyi_conversation_traces').select('trace_id,persistence_saved,stages').eq('trace_id',response.execution.durable_trace.trace_id).single();
  turns.push({prompt,response,metadata:state.data.metadata,latency_ms:Date.now()-start,trace:trace.data});
  check(j.id+':'+turns.length+':saved-traced',()=>{assert.equal(response.persistence_saved,true);assert(trace.data?.trace_id);assert.equal(trace.data.persistence_saved,true);});
 }
 journeys.push({...j,surface,thread,turns});
}
const j=id=>journeys.find(j=>j.id===id), objective=(id,n)=>j(id).turns[n-1].metadata.public_opportunity_objective;
check('public-distinct-pair',()=>{const e=objective('C-PUBLIC-PAIR',2).entities;assert.equal(e.length,2);assert.notEqual(e[0].id,e[1].id);assert.equal(e[0].known_facts.location,'Minna');assert.equal(e[1].known_facts.location,'Calabar');assert.match(e[0].known_facts.land_size,/750/);assert.match(e[1].known_facts.land_size,/1800/);assert.equal(e[0].known_facts.structure_offered,'lease');assert.equal(e[1].known_facts.structure_offered,'JV');});
check('targeted-area-correction',()=>{const e=objective('C-PUBLIC-PAIR',3).entities;assert.match(e[0].known_facts.land_size,/820/);assert.match(e[1].known_facts.land_size,/1800/);assert(e[0].superseded.some(v=>v.field==='land_size'&&/750/.test(v.value)));});
check('targeted-owner-correction',()=>{const e=objective('C-PUBLIC-PAIR',4).entities;assert.match(e[1].known_facts.ownership_status,/family/);assert.doesNotMatch(e[0].known_facts.ownership_status,/family/);});
check('plural-summary-not-recency',()=>{const r=j('C-PUBLIC-PAIR').turns[4].response;assert.match(r.answer,/Minna/);assert.match(r.answer,/Calabar/);assert(!r.requiresConfirmation);});
check('location-return-and-other',()=>{const e=objective('C-PUBLIC-PAIR',7).entities;assert.equal(objective('C-PUBLIC-PAIR',6).active_entity_id,e[0].id);assert.match(e[1].known_facts.title_document_status,/not.*available/);assert(!e[0].known_facts.title_document_status);});
check('entity-withdrawal-terminal',()=>{const e=objective('C-PUBLIC-PAIR',9).entities;assert.equal(e[0].status,'withdrawn');assert.equal(e[1].status,'active');assert.equal(objective('C-PUBLIC-PAIR',9).active_entity_id,e[1].id);});
check('ambiguous-correction-no-write',()=>{const before=objective('C-PUBLIC-AMBIGUITY',2).entities,after=objective('C-PUBLIC-AMBIGUITY',3).entities;assert.deepEqual(after,before);assert.match(j('C-PUBLIC-AMBIGUITY').turns[2].response.answer,/Which property/);});
check('clarified-correction-binds-once',()=>{const e=objective('C-PUBLIC-AMBIGUITY',4).entities;assert.match(e[0].known_facts.land_size,/650/);assert.match(e[1].known_facts.land_size,/1000/);assert(!objective('C-PUBLIC-AMBIGUITY',4).pending_entity_update);});
check('replacement-not-addition',()=>{const e=objective('C-PUBLIC-REPLACEMENT',2).entities;assert.equal(e.length,1);assert.equal(e[0].known_facts.location,'Uyo');assert.match(e[0].known_facts.land_size,/1250/);});
// A negated completion claim is honest, not a positive completion promise.
check('public-handoff-honesty',()=>{assert.match(j('C-PUBLIC-REPLACEMENT').turns[3].response.answer,/no callback is confirmed|has not been.*confirmed/);assert.doesNotMatch(j('C-PUBLIC-REPLACEMENT').turns[3].response.answer,/will call you/);});
check('generic-property-reference-not-building-claim',()=>{assert.equal(objective('C-PUBLIC-PAIR',3).entities[0].known_facts.opportunity_type,'land');});
check('selected-details-actually-presented',()=>{assert.match(j('C-PUBLIC-PAIR').turns[5].response.answer,/Minna/);assert.match(j('C-PUBLIC-PAIR').turns[8].response.answer,/Calabar/);});
for(const id of ['C-OMA-REFERENCES','C-FACILITY-REFERENCES','C-CONSUMER-REFERENCES'])check(id+':candidate-retention',()=>{const t=j(id).turns[1],sets=t.metadata.result_sets;assert(Object.values(sets||{}).some(s=>s.candidate_refs?.length>1),'selecting one record must retain its candidates');});
check('consumer-cancellation-safety',()=>{const r=j('C-CONSUMER-REFERENCES').turns.at(-1).response;assert(!r.requiresConfirmation);assert.equal(executed,0);});
check('entity-provenance',()=>{assert(objective('C-PUBLIC-PAIR',9).entities.every(e=>e.provenance==='caller_supplied_unverified'));});
check('durable-structural-transition-only',()=>{
 const stages=j('C-PUBLIC-PAIR').turns[2].trace.stages;
 assert(stages.some(s=>s.stage==='turn_normalized'&&s.context_transition==='correct'));
 assert.doesNotMatch(JSON.stringify(stages),/Minna|Calabar|820 sqm|first property/);
});
check('operational-reference-answer-identity',()=>{
 assert.match(j('C-OMA-REFERENCES').turns[2].response.answer,/Lead Beta/);
 assert.match(j('C-OMA-REFERENCES').turns[5].response.answer,/Lead Beta/);
 assert.match(j('C-FACILITY-REFERENCES').turns[2].response.answer,/unresolved water issue/);
 assert.match(j('C-FACILITY-REFERENCES').turns[4].response.answer,/unresolved water issue/);
 assert.match(j('C-CONSUMER-REFERENCES').turns[2].response.answer,/Wave11 AC/);
 assert.match(j('C-CONSUMER-REFERENCES').turns[4].response.answer,/Wave11 AC/);
});
// New isolated scope changes and restoration; never access a production actor.
const extra=[];
async function boundary(id,fn){try{await fn();checks.push({id,status:'PASS'});}catch(e){checks.push({id,status:'FAIL',error:e.message});}}
await boundary('revoked-office-permission-not-restored',async()=>{
 const actor={...actorFor('ochiga_staff','office_internal'),role:'public',permissions:[],permission_scopes:[]};
 const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'office_internal'),input:{surface:'office_internal',thread_id:j('C-OMA-REFERENCES').thread,message:'Tell me about the second one.',context:{operational_snapshot:officeSnapshot()}}});extra.push({id:'revoked-office',response:r});assert.doesNotMatch(r.answer,/Lead Beta|Lead Alpha/);
});
await boundary('other-resident-cannot-restore-thread',async()=>{
 const actor=actorFor('resident_b','consumer');let denied=false;
 try{const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'consumer'),input:{surface:'consumer',thread_id:j('C-CONSUMER-REFERENCES').thread,message:'Tell me about the second one.'}});extra.push({id:'other-resident',response:r});assert.doesNotMatch(r.answer,/Wave11 AC|Living Light/);denied=r.truth?.truth_state==='permission_restricted';}catch(e){denied=/owner|authori|access|thread|scope/i.test(e.message);}assert(denied);
});
await boundary('public-expiry-does-not-restore-held-facts',async()=>{
 const target=j('C-PUBLIC-REPLACEMENT'),last=target.turns.at(-1).metadata;const updated={...last,public_opportunity_objective:{...last.public_opportunity_objective,updated_at:new Date(Date.now()-31*60000).toISOString()}};
 const write=await db.from('oyi_conversation_threads').update({metadata:updated}).eq('id',target.thread);assert(!write.error);
 const actor=actorFor('public','public_corporate');const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'public_corporate'),input:{surface:'public_corporate',thread_id:target.thread,message:'Show the first property.'}});extra.push({id:'expiry',response:r});assert.doesNotMatch(r.answer,/Uyo|Bauchi|1250/);
});
await boundary('sole-withdrawn-property-not-revived',async()=>{
 const actor=actorFor('public','public_corporate');let thread=null;const states=[];
 for(const message of ['I own a plot in Jos, 410 sqm.','Withdraw the first property.','It is 890 sqm.','Yes.','I have another plot in Zaria, 300 sqm.']){
  const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'public_corporate'),input:{surface:'public_corporate',thread_id:thread,message}});thread=r.thread_id;
  extra.push({id:'withdrawn-restoration',response:r});assert(!r.requiresConfirmation);
  const q=await db.from('oyi_conversation_threads').select('metadata').eq('id',thread).single();assert(!q.error);states.push(q.data.metadata.public_opportunity_objective);
 }
 for(const s of states.slice(1,4)){assert.equal(s.entities[0].status,'withdrawn');assert.match(s.entities[0].known_facts.land_size,/410/);assert.equal(s.active_entity_id,null);}
 assert.equal(states[4].entities.length,2);assert.equal(states[4].entities[0].status,'withdrawn');assert.equal(states[4].entities[1].known_facts.location,'Zaria');assert.equal(executed,0);
});
await boundary('new-explicit-fact-supersedes-pending-correction',async()=>{
 const actor=actorFor('public','public_corporate');let thread=null;let state;
 for(const message of ['I own a plot in Lafia, 400 sqm.','I have another plot in Lafia, 500 sqm.','Correct the Lafia property size to 600 sqm.','The second property is 700 sqm.']){
  const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'public_corporate'),input:{surface:'public_corporate',thread_id:thread,message}});thread=r.thread_id;extra.push({id:'pending-correction-replacement',response:r});
  const q=await db.from('oyi_conversation_threads').select('metadata').eq('id',thread).single();assert(!q.error);state=q.data.metadata.public_opportunity_objective;
 }
 assert.match(state.entities[0].known_facts.land_size,/400/);assert.match(state.entities[1].known_facts.land_size,/700/);assert(!state.pending_entity_update);
});
await boundary('contact-preference-binds-explicit-property',async()=>{
 const actor=actorFor('public','public_corporate');let thread=null;let state;
 for(const message of ['I own a plot in Owerri, 430 sqm.','I have another plot in Dutse, 530 sqm.','No phone calls about the first property.']){
  const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,'public_corporate'),input:{surface:'public_corporate',thread_id:thread,message}});thread=r.thread_id;extra.push({id:'entity-contact-preference',response:r});
  const q=await db.from('oyi_conversation_threads').select('metadata').eq('id',thread).single();assert(!q.error);state=q.data.metadata.public_opportunity_objective;
 }
 assert(state.entities[0].constraints.includes('no_phone_contact'));assert(!state.entities[1].constraints.includes('no_phone_contact'));assert.equal(executed,0);
});
await recorder.flushConversationTraceWrites();
const out={journeys,extra,checks,executed,pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length};
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify(out,null,2));console.log(JSON.stringify({checks,executed}));process.exitCode=out.fail?1:0;
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+checks],{env:process.env,stdio:'inherit',timeout:240000});process.exitCode=p.status??1;
