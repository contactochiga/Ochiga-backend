import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const path='artifacts/intelligence-quality-v1-iq2b-results.json';
const source=JSON.parse(fs.readFileSync(path));
const clusters={
 retention:{ids:['OMA-009:4','OMA-009:5','CON-003:5','CON-003:7','CON-008:6','CON-008:7'],owner:'conversationAssessmentContext + canonicalConversationPersistence',cause:'Intervening retrieval or mutation erases non-executing assessment context, preventing later reference/return.'},
 subject:{ids:['OMA-008:5','FAC-005:5','FAC-010:5','FAC-010:7'],owner:'conversationAssessmentContext + ConversationOrchestrator',cause:'Explicit subject, anaphoric comparison operands and display labels have inconsistent precedence.'},
 correction:{ids:['OSA-004:7'],owner:'PublicOpportunityCapabilityModule',cause:'Qualification extraction does not supersede prior facts using correction grammar.'},
 requirement:{ids:['OMA-006:4','OMA-006:5','OSA-003:6','FAC-007:6','FAC-008:7','CON-009:7'],owner:'assessmentEvidenceRequirements / assessmentEvidenceAnswer',cause:'Domain-only requirements omit the governance/ownership/safety purpose of the question.'},
 counterfactual:{ids:['OMA-003:6'],owner:'SemanticFrameParser',cause:'Question about evidence that could change judgment is interpreted as a present material update.'},
};
const records=source.gaps.filter(g=>g.objective_layer_failure).map(g=>{
 const [root,c]=Object.entries(clusters).find(([,c])=>c.ids.includes(g.id))||[];assert(c,g.id);
 const r=source.records.find(r=>r.journey_id.slice(8)+':'+r.turn_number===g.id);
 return {id:g.id,journey_id:r.journey_id,turn_number:r.turn_number,worker:r.worker,prompt:r.prompt,
 objective:g.objective,subject:g.subject,active_assessment:g.assessment,
 expected_objective_layer_behaviour:g.envelope,actual_objective_layer_behaviour:g.reason,answer:g.answer,
 failure_subtype:g.category,root_cause:root,root_cause_description:c.cause,canonical_owner:c.owner,
 context:{assessment:g.assessment,semantic_frame:r.semantic_frame,trace:r.trace,result_sets:'Full historical result-set snapshots were not captured in this frozen artifact; only assessment pointers and trace evidence are available. Do not infer absent snapshots.'}};
});
assert.equal(records.length,18);assert.equal(new Set(records.map(r=>r.id)).size,18);
const output='artifacts/intelligence-quality-v1-iq2c-closure-corpus.json';assert(!fs.existsSync(output),'Never overwrite the frozen closure set');
fs.writeFileSync(output,JSON.stringify({starting_head:'aeed6f69643792b1553b5ac6fd7030dd8ebafd4e',source_sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex'),clusters,records},null,2)+'\n');
console.log(Object.fromEntries(Object.entries(clusters).map(([k,c])=>[k,c.ids.length])));
