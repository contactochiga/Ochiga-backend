// Read-only interpretation of the frozen IQ-2 evidence, not a test runner.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const path='artifacts/intelligence-quality-v1-iq2-results.json';
const source=JSON.parse(fs.readFileSync(path));
const overrides={
 C:['OSA-003:6','FAC-004:3','FAC-004:6','FAC-007:6','FAC-008:6','FAC-008:7','FAC-009:5','FAC-010:5','CON-003:3'],
 D:['OSA-004:7','FAC-007:7','CON-008:6'],
 F:['OMA-003:3','FAC-001:5','FAC-001:6','FAC-006:7','FAC-007:5','FAC-009:3','CON-003:5'],
};
const definitions={
 A:'OBJECTIVE_NOT_RECOGNIZED',B:'OBJECTIVE_RECOGNIZED_WRONG_TYPE',C:'OBJECTIVE_RECOGNIZED_WRONG_TOPIC',
 D:'OBJECTIVE_RECOGNIZED_BUT_FOLLOWUP_LOST',E:'OBJECTIVE_RECOGNIZED_BUT_EVIDENCE_NEED_GENERIC',
 F:'OBJECTIVE_RECOGNIZED_AND_CORRECTLY_BOUNDED',
};
const reasons={
 A:'No cognitive job is recorded and the observed response does not handle the natural inquiry/instruction. Includes bounded retrieval/evidence-audit questions, not only assessment.',
 B:'Recorded cognitive move conflicts with the requested move.',
 C:'The observed worker/domain answer or evidence limitation concerns a different topic: generic estate counts, internal document ownership, or transactions instead of household spending.',
 D:'Summary/reference wording is recognized, but its prior opportunity/assessment/room subject is lost to a fresh capability or unsupported destination.',
 E:'The objective is visible, but the limitation does not identify the subject-specific evidence requirement; public qualification answers likewise fail to name the decisive missing evidence.',
 F:'The observed response is honest and appropriately bounded (limited estate evidence or clarification of an unestablished target). The remaining full-envelope demand requires judgment/derived ranking/fact reassessment; not an IQ-2 defect.',
};
const records=source.records.filter(r=>['IQRC-004','IQRC-006'].includes(r.primary_frozen_root_cause)).map(r=>{
 const id=`${r.journey_id.slice(8)}:${r.turn_number}`;
 const category=Object.keys(overrides).find(k=>overrides[k].includes(id))||(r.cognitive_objective?'E':'A');
 return {id,journey_id:r.journey_id,turn_number:r.turn_number,root_cause:r.primary_frozen_root_cause,
 surface:r.surface,prompt:r.prompt,objective:r.cognitive_objective,domain:r.semantic_frame?.domain||null,
 answer:r.answer,trace_id:r.trace.trace_id,category,classification:definitions[category],reason:reasons[category],
 objective_layer_failure:category!=='F',expected:r.envelope};
});
assert.equal(records.length,112);
const counts=Object.fromEntries(Object.keys(definitions).map(k=>[k,records.filter(r=>r.category===k).length]));
const result={starting_head:'74b892f73a4dacf6332900462994c1cac38b09a8',source_sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex'),
 scope:'Pre-edit review of all 112 frozen primary IQRC-004/006 failures. F is downstream, not an IQ-2 failure.',definitions,counts,
 by_root:Object.fromEntries(['IQRC-004','IQRC-006'].map(root=>[root,Object.fromEntries(Object.keys(definitions).map(k=>[k,records.filter(r=>r.root_cause===root&&r.category===k).length]))])),records};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq2b-prefixed-gap-map.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({counts,by_root:result.by_root},null,2));
