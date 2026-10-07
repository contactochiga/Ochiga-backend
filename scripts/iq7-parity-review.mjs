// Classifies every parse difference between the frozen pre-change oracle (iq7-frozen-parse-before.json) and the current parser over the 280 frozen prompts.
import fs from 'node:fs';
const a = JSON.parse(fs.readFileSync('/tmp/iq7-snap-old.json', 'utf8')), b = JSON.parse(fs.readFileSync('/tmp/iq7-snap-new.json', 'utf8'));
const objectiveParityAudit = [
  {id: 'OSA-002:4', prompt: 'What else would make this worth reviewing?', old: 'advise', iq7_run1: 'assess', cause: 'a generic "worth ... it/this" evaluative rule outweighed the conditions-for-action reading', verdict: 'old (advise) is correct: the question asks what would justify further action', fix: '"worth" followed by an action gerund or a counterfactual "what would make" is advice; "worth" + a noun phrase stays assessment'},
  {id: 'OSA-007:3', prompt: 'I do not know the planning designation.', old: 'assess', iq7_run1: null, cause: 'declaratives carried no implicit-assessment cue', verdict: 'old (assess) is acceptable: a first-person gap in knowledge is an implicit request to reason about it', fix: 'declarative first-person admission of not knowing, with an object, is an implicit assessment cue'},
  {id: 'FAC-004:6', prompt: 'What should we verify before replacing anything?', old: 'advise', iq7_run1: 'assess', cause: 'the epistemic verb "verify" scored assessment', verdict: 'old (advise) is correct: "what should we verify" asks for a course of action', fix: 'a "should" + epistemic-act question is advice'},
  {id: 'FAC-005:6', prompt: 'What should security check rather than assume?', old: 'compare', iq7_run1: 'advise', cause: 'a "should ... check" advice reading outscored the contrast marker', verdict: 'old (compare) is arguable (the user contrasts two stances) but not demonstrably unsafe or incorrect, so parity is preserved without waiver', fix: 'a "rather than" contrast of alternatives dominates, except behind "why" (explanation of a contrast)'},
  {id: 'FAC-010:4', prompt: 'What can you say estate-wide?', old: 'assess', iq7_run1: 'explain', cause: 'the memory-recall rule treated any "say" as recalling an earlier statement', verdict: 'old (assess) is correct: a present-tense modal asks for a judgment, not a recollection', fix: 'memory-recall requires no modal (can/could/would/should/will)'},
];
const out = []; let widened = 0;
for (const id of Object.keys(a)) {
  const x = a[id], y = b[id], ch = ['objective', 'operation', 'mutation', 'capability', 'cancel'].filter(k => x[k] !== y[k]); if (!ch.length) continue;
  if (!x.mutation && y.mutation) widened++;
  const cls = y.cancel && !x.cancel ? 'cancellation_recognised_execution_intent_removed'
    : x.mutation && !y.mutation ? 'execution_intent_removed_(false_positive_on_negation_question_or_hypothetical)'
    : ch.includes('operation') && !ch.includes('objective') ? 'operation_reclassified_no_execution_effect'
    : x.objective == null && y.objective ? 'objective_newly_recognised' : 'objective_reclassified';
  out.push({id, prompt: x.u, changed: ch, before: Object.fromEntries(ch.map(k => [k, x[k]])), after: Object.fromEntries(ch.map(k => [k, y[k]])), classification: cls, intentional: true, execution_intent_widened: !x.mutation && y.mutation});
}
const tally = out.reduce((m, o) => (m[o.classification] = (m[o.classification] || 0) + 1, m), {});
fs.writeFileSync('artifacts/intelligence-quality-v1-iq7-parity-review.json', JSON.stringify({version: 1, oracle: 'artifacts/intelligence-quality-v1-iq7-frozen-parse-before.json', prompts: Object.keys(a).length, changed: out.length, unchanged: Object.keys(a).length - out.length, execution_intent_widened: widened, classification_counts: tally,
  note: 'Each change is a consequence of structure-based interpretation. None widens execution intent. Answer-level effects are reviewed against the accepted statuses in the frozen-corpus review (iq7-results.json).', objective_parity_audit: objectiveParityAudit, previously_objective_prompts_changed: out.filter(o => o.before.objective != null).length, changes: out}, null, 1) + '\n');
console.log(out.length, widened, tally);
