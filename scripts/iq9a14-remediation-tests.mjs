import assert from 'node:assert/strict';
import {hazardReportIn, hazardClassIn, hazardPrecaution} from '../dist/oyi-core/response/answerTarget.js';
import {activeDisclosureConstraints, redactNames} from '../dist/oyi-core/response/disclosureConstraint.js';
import {parseSemanticFrame} from '../dist/oyi-core/interpretation/SemanticFrameParser.js';
import {projectResponse} from '../dist/oyi-core/response/projector.js';
import {namedDevicePhraseFromControlMessage} from '../dist/oyi-core/runtime/conversationTargetResolver.js';
let n=0; const test=(name,fn)=>{try{fn();n++;}catch(e){e.message=`${name}: ${e.message}`;throw e;}};
test('intrusion language and positive non-hazard controls',()=>{
  for(const q of ['Someone broke into our block.', 'Someone is trying my door handle.', 'A burglar entered the house.']) {assert(hazardReportIn(q),q);assert.equal(hazardClassIn(q),'intrusion');}
  for(const q of ['Nobody broke into the house.', 'What if a burglar entered?', 'Show my visitors.']) assert(!hazardReportIn(q),q);
  assert.match(hazardPrecaution('intrusion'),/police/);
  assert.equal(hazardClassIn('I smell gas in the kitchen.'),'gas');
  assert.match(hazardPrecaution('gas'),/avoid electrical switches and flames/);
});
test('disclosure rule, release, negative release and thread isolation',()=>{
  const rule="Don't mention visitor names today.";
  assert.deepEqual(activeDisclosureConstraints([rule,'How many are active?']),['visitor_names']);
  assert.deepEqual(activeDisclosureConstraints([rule,'You can show visitor names again.']),[]);
  assert.deepEqual(activeDisclosureConstraints([rule,"You can count them, but don't show visitor names."]),['visitor_names']);
  assert.deepEqual(activeDisclosureConstraints(['Show visitor names.']),[]);
  assert.equal(redactNames('A+B (Guest) is active',['A+B (Guest)']).text,'a visitor record is active');
});
test('routing record subject over generic financial or utility modifier',()=>{
  assert.equal(parseSemanticFrame('Should we invest money in the development project?',{surface:'office_internal'}).domain,'office_development');
  assert.equal(parseSemanticFrame('Compare the electricity purchase and wallet funding.',{surface:'consumer'}).domain,'wallet');
  assert.equal(parseSemanticFrame('What is the status of the water issue?',{surface:'consumer'}).domain,'maintenance');
  assert.equal(parseSemanticFrame('Show electricity consumption in kWh.',{surface:'consumer'}).domain,'utilities');
  assert.notEqual(parseSemanticFrame('Can we promise funding to the JV owner?',{surface:'office_internal'}).answerTarget.facet,'owner');
  assert.equal(parseSemanticFrame('Who owns the stale opportunities?',{surface:'office_internal'}).answerTarget.facet,'owner');
});
test('visitor permission limitation for list and named status',()=>{
  const e={v:1,capability_key:'visitors.pending.read',availability:'answered',capability_status:'enabled',subject:{domain:'visitors',object_class:'visitor',noun:'visitor records',singular:'visitor record',facets:['list','status']},records:[{label:'Ada Guest',status:'inactive',state:'resolved'}],hints:{permission_only:true},legacy_prose:''};
  for(const q of ['List visitor records',"Is Ada Guest's pass valid?"])assert.match(projectResponse(parseSemanticFrame(q,{surface:'consumer'}).answerTarget,e,{asked:q,raw:q}).primary,/permission.*not (?:proof|evidence)/);
});
test('subject first device remains governed named target',()=>{
  assert.equal(namedDevicePhraseFromControlMessage('AC is sparking, switch it off now',{isControlRequest:()=>true}),'AC');
  assert.equal(namedDevicePhraseFromControlMessage('Turn it off',{isControlRequest:()=>true}),null);
});
test('explicit record subject beats status words naming another record',()=>{
  const q='Is my water issue open or resolved?';
  const e={v:1,capability_key:'maintenance.requests.read',availability:'answered',capability_status:'enabled',subject:{domain:'maintenance',noun:'maintenance requests',singular:'maintenance request',facets:['list','status']},records:[{label:'Unresolved water issue',status:'open',state:'open'},{label:'Resolved light issue',status:'resolved',state:'resolved'}],legacy_prose:''};
  assert.match(projectResponse(parseSemanticFrame(q,{surface:'consumer'}).answerTarget,e,{asked:q,raw:q}).primary,/water issue is still open/i);
});
console.log(JSON.stringify({status:'PASS',tests:n}));
