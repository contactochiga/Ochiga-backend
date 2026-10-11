import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.SUPABASE_URL ||= 'http://127.0.0.1:55421';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'isolated-pure-test-no-database-access';
const {parseSemanticFrame}=require('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {selectConversationReferences,resolveFollowUpReference}=require('../dist/oyi-core/interpretation/followUpResolver.js');
const {narrowedResultSetContext,validResultSetTime}=require('../dist/oyi-core/context/resultSetContext.js');
const {validPublicOpportunityTime,retainOpportunityEntities,opportunityEntityView,selectOpportunityEntity}=require('../dist/oyi-core/context/publicOpportunityObjective.js');
const results=[];const test=(id,fn)=>{try{fn();results.push({id,status:'PASS'});}catch(e){results.push({id,status:'FAIL',error:e.message});}};
const now=new Date().toISOString();const ref=(id,label)=>({canonical_id:id,object_type:'device',label,occurred_at:now,metric:null,metric_value:null,status:'unknown',attributes:{}});
const set={object_refs:[ref('a','Amber Lamp'),ref('b','Cobalt Lamp')],selected_object_ref:null,created_at:now,domain:'devices'};
const narrowed=narrowedResultSetContext(set,set.object_refs[0],{contract:{conversation_request_id:'c',thread_id:'t',temporal_scope:null},message:'Tell me about the first one.'});
test('retain-population',()=>{assert.equal(narrowed.object_refs.length,1);assert.equal(narrowed.candidate_refs.length,2);});
test('ordinal-after-selection',()=>assert.equal(resolveFollowUpReference(narrowed,{type:'ordinal',ordinal:'second'}).ref.canonical_id,'b'));
test('name-over-ordinal-recency',()=>assert.equal(resolveFollowUpReference(narrowed,{type:'ordinal',ordinal:'second'},'Amber Lamp, not the second one.').ref.canonical_id,'a'));
test('other-after-selection',()=>assert.equal(resolveFollowUpReference(narrowed,{type:'other'}).ref.canonical_id,'b'));
test('comparison-right-operand-not-subject',()=>assert.equal(resolveFollowUpReference(narrowed,{type:'ordinal',ordinal:'second'},'Explain that device versus the second one.').ref.canonical_id,'a'));
test('ambiguous-name',()=>assert.equal(selectConversationReferences('Show the Amber Lamp.',[{id:'a',label:'Amber Lamp'},{id:'b',label:'Amber Lamp'}]).kind,'ambiguous'));
test('same-place-ambiguous',()=>assert.equal(selectConversationReferences('The Akure property.',[{id:'a',label:'Property 1',location:'Akure'},{id:'b',label:'Property 2',location:'Akure'}]).kind,'ambiguous'));
test('plural-not-single',()=>assert.equal(selectConversationReferences('Both of them, please.',[{id:'a',label:'Amber'},{id:'b',label:'Cobalt'}]).kind,'multiple'));
for(const time of ['invalid',new Date(Date.now()-31*60000).toISOString(),new Date(Date.now()+60000).toISOString()]){
 test('result-expiry-'+time,()=>assert(!validResultSetTime({...set,created_at:time})));
 test('public-expiry-'+time,()=>assert(!validPublicOpportunityTime({updated_at:time})));
}
const base={objective_type:'development_partnership',known_facts:{location:'Minna',land_size:'750 sqm'},constraints:[],current_subject:'Minna',next_move:null,turns:1,created_at:now,updated_at:now};
const first=retainOpportunityEntities(base,null),pair=retainOpportunityEntities({...base,known_facts:{location:'Calabar',land_size:'1800 sqm'}},first,'introduce');
test('identity-introduction',()=>{assert.equal(pair.entities.length,2);assert.notEqual(pair.entities[0].id,pair.entities[1].id);assert.equal(pair.entities[0].known_facts.location,'Minna');});
test('targeted-update',()=>{const view=opportunityEntityView(pair,pair.entities[0]);const next=retainOpportunityEntities({...view,known_facts:{...view.known_facts,land_size:'820 sqm'}},view);assert.equal(next.entities[1].known_facts.land_size,'1800 sqm');assert.equal(next.entities[0].known_facts.land_size,'820 sqm');});
test('withdrawn-not-selectable',()=>{const s={...pair,entities:pair.entities.map((e,i)=>({...e,status:i===0?'withdrawn':'active'}))};assert.equal(selectOpportunityEntity(s,'The first property.').kind,'missing');});
const corpus=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq10c-development-contract.json'));
for(const group of corpus.paraphrase_partition.filter(g=>['addition','correction'].includes(g.family)))for(const m of group.texts)test('paraphrase-'+m,()=>assert.equal(parseSemanticFrame(m,{surface:'public_corporate'}).concepts.entity_transition,group.family==='addition'?'introduce':'correct'));
for(const [message,kind,id] of [
 ['The earlier property, please.','selected',pair.entities[0].id],
 ['Can we return to the one in Minna?','selected',pair.entities[0].id],
 ['And the other opportunity?','selected',pair.entities[0].id],
 ['Both of them, please.','multiple',null]
])test('paraphrase-reference-'+message,()=>{const s=selectOpportunityEntity(pair,message);assert.equal(s.kind,kind);if(id)assert.equal(s.selected[0].id,id);});
test('unknown-qualified-reference-not-active',()=>assert.equal(selectOpportunityEntity(pair,'The one in Lokoja.').kind,'missing'));
test('earlier-not-arbitrary-first',()=>assert.equal(selectConversationReferences('The previous property.',[{id:'a',label:'Property 1'},{id:'b',label:'Property 2'},{id:'c',label:'Property 3'}],'c').kind,'ambiguous'));
test('withdrawn-slot-not-updated',()=>{const prior={...first,active_entity_id:null,known_facts:{},entities:first.entities.map(e=>({...e,status:'withdrawn'}))};assert.deepEqual(retainOpportunityEntities({...prior,known_facts:{location:'Ilorin'}},prior),prior);const fresh=retainOpportunityEntities(base,prior,'introduce');assert.equal(fresh.entities.length,2);assert.notEqual(fresh.active_entity_id,prior.entities[0].id);assert.equal(fresh.entities[0].status,'withdrawn');});
test('withdrawn-first-slot-not-fallback-for-live-sibling',()=>{const prior={...pair,active_entity_id:null,entities:pair.entities.map((e,i)=>({...e,status:i===0?'withdrawn':'active'}))};assert.deepEqual(retainOpportunityEntities({...prior,known_facts:{location:'Ilorin'}},prior),prior);});
test('contact-preference-explicit-entity-not-recency',()=>{const {recordContactPreference}=require('../dist/oyi-core/capabilities/PublicOpportunityCapabilityModule.js');const updated=recordContactPreference(pair,'No phone calls about the first property.');assert(updated.entities[0].constraints.includes('no_phone_contact'));assert(!updated.entities[1].constraints.includes('no_phone_contact'));});
test('new-location-value-does-not-steal-subject',()=>assert.equal(selectOpportunityEntity(pair,'Correct the first property location to Calabar.').selected[0].id,pair.entities[0].id));
for(const message of corpus.paraphrase_partition.find(g=>g.family==='ambiguity').texts)test('no-invented-reference-'+message,()=>{
 const unresolved=selectOpportunityEntity({...pair,active_entity_id:null},message);
 assert.equal(unresolved.kind,'none');assert.equal(unresolved.selected.length,0);
 assert.equal(parseSemanticFrame(message,{surface:'public_corporate'}).mutationIntent,false);
});
test('explanation-preserved',()=>assert.equal(parseSemanticFrame('Why that recommendation?',{activeAssessment:true}).cognitiveObjective,'explain'));
test('correction-not-stop-command',()=>assert.equal(parseSemanticFrame('Here is a correction, not a request to stop.').mutationIntent,false));
for(const message of ['Do I have another property?','I do not have another property.','What if I had another plot?','Do not withdraw the first property.','Did you correct the second property?'])test('non-asserted-transition-'+message,()=>assert.equal(parseSemanticFrame(message,{surface:'public_corporate'}).concepts.entity_transition,null));
const projection=require('../dist/oyi-core/observability/conversationTraceProjection.js');
test('trace-transition-closed-vocabulary',()=>{
 const base={events:[],startedAt:Date.now(),completedAt:Date.now(),requestId:null,threadId:null,surface:'public_corporate',actor:null,response:null,error:null};
 const row=projection.projectConversationTrace({...base,events:[{stage:'turn_normalized',at:Date.now(),duration_ms:1,fields:{context_transition:'private secret location'}}]});
 assert(!JSON.stringify(row).includes('private secret location'));
 const valid=projection.projectConversationTrace({...base,events:[{stage:'turn_normalized',at:Date.now(),duration_ms:1,fields:{context_transition:'correct'}}]});assert.equal(valid.stages[0].context_transition,'correct');
});
for(const surface of ['consumer','facility','office_internal','public_corporate']){
 test('objective-retrieve-'+surface,()=>assert.equal(parseSemanticFrame('What status does the second project have?',{surface}).cognitiveObjective,'retrieve'));
 test('objective-prioritize-'+surface,()=>assert.equal(parseSemanticFrame('Which of these should I focus on?',{surface}).cognitiveObjective,'prioritize'));
 test('fact-not-action-'+surface,()=>assert.equal(parseSemanticFrame('The project financing is secured.',{surface,activeAssessment:true}).mutationIntent,false));
 test('cancel-still-terminal-'+surface,()=>assert.equal(parseSemanticFrame('Cancel the amber-lamp command.',{surface}).operation,'cancel'));
}
const out={results,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length};
if(process.env.WAVE11_HARNESS_OUT)fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));process.exitCode=out.fail?1:0;
