import assert from 'node:assert/strict';
import {parseSemanticFrame} from '../dist/oyi-core/interpretation/SemanticFrameParser.js';
import {limitationAnswer} from '../dist/oyi-core/response/limitationTarget.js';
import {extractTitleStatus} from '../dist/oyi-core/context/publicOpportunityObjective.js';
import {projectResponse} from '../dist/oyi-core/response/projector.js';
import {mapResultEnvelope} from '../dist/oyi-core/response/envelopeMappers.js';
let assertions=0;
const ok=(v,m)=>{assert(v,m);assertions++;};
for(const q of ['What would happen if I asked you to switch the study lamp off?', 'How would it work if I requested you to turn the kitchen light on?']) {
 const f=parseSemanticFrame(q,{surface:'consumer'});ok(f.answerTarget.hypothetical_process,q);ok(!f.mutationIntent,q);ok(!f.operation.startsWith('device.power'),q);
}
ok(parseSemanticFrame('Turn off the kitchen light',{surface:'consumer'}).mutationIntent,'real command remains governed action');
for(const q of ['What is the humidity and temperature?', "What's the noise and airflow in the study?"]){const t=parseSemanticFrame(q,{surface:'consumer'}).answerTarget;const a=limitationAnswer(t,q);for(const n of q.match(/humidity|temperature|noise|airflow/g))ok(a.includes(n),`omitted ${n}`);}
ok(extractTitleStatus('We hold a certificate of occupancy.').includes('not verified'),'document not verification');
ok(extractTitleStatus('We have no C of O.').includes('not available'),'negative document assertion');
ok(extractTitleStatus("We don't have a C of O.").includes('not available'),'negated possession');
ok(extractTitleStatus('We never obtained a certificate of occupancy.').includes('not available'),'negative completed-possession claim');
ok(extractTitleStatus('What is a certificate of occupancy?')===null,'document question is not possession');
ok(extractTitleStatus('Do I need a C of O?')===null,'qualification question is not possession');
for(const q of ['Is anyone outside my door?', 'Is somebody inside my compound?'])ok(parseSemanticFrame(q,{surface:'consumer'}).domain==='visitors','permission not incidents');
ok(parseSemanticFrame('Is an intruder attacking at my gate?',{surface:'consumer'}).domain!=='visitors','hazard not visitor permission');
const result={status:'answered',answer:'records',blocks:[{type:'record_list',columns:[{key:'title'},{key:'status'},{key:'priority'},{key:'owner'}],rows:[{id:'task-a',title:'Synthetic follow-up',status:'open',priority:'high',owner:'Synthetic Staff'}]}]};
const e=mapResultEnvelope('office_tasks.query.read',result,{capability_status:'enabled'});ok(e.records[0].detail.includes('high priority'),'priority retained');ok(e.records[0].detail.includes('Synthetic Staff'),'owner retained');
const wallet={v:1,capability_key:'wallet.transactions.read',availability:'answered',capability_status:'enabled',subject:{domain:'wallet',object_class:'wallet',noun:'transactions',singular:'transaction',facets:['transactions']},records:[{label:'Meter purchase',fields:{amount:40,currency:'NGN',direction:'out'}},{label:'Salary funding',fields:{amount:90,currency:'NGN',direction:'in'}}],legacy_prose:''};
const q='Which was larger, the meter purchase or salary funding?',t=parseSemanticFrame(q,{surface:'consumer'}).answerTarget;
const p=projectResponse(t,wallet,{asked:q,raw:q});ok(p.primary.includes('90')&&p.primary.includes('40')&&p.primary.includes('money in')&&p.primary.includes('money out'),'typed comparison');
const small='Which was smaller, the meter purchase or salary funding?';ok(projectResponse(t,wallet,{asked:small,raw:small}).primary.includes('Meter purchase is smaller'),'comparison direction');
ok(!projectResponse(t,{...wallet,records:[wallet.records[0],{...wallet.records[1],fields:{...wallet.records[1].fields,currency:'USD'}}]},{asked:q,raw:q}),'no cross currency comparison');
ok(!projectResponse(t,{...wallet,availability:'unavailable'},{asked:q,raw:q}).primary.includes('90'),'unavailable not projected');
console.log(JSON.stringify({status:'PASS',assertions}));
