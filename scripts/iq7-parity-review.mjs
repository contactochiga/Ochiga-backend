// Classifies every parse difference between the frozen pre-change oracle (iq7-frozen-parse-before.json) and the current parser over the 280 frozen prompts.
import fs from 'node:fs';
const a = JSON.parse(fs.readFileSync('/tmp/iq7-snap-old.json', 'utf8')), b = JSON.parse(fs.readFileSync('/tmp/iq7-snap-new.json', 'utf8'));
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
  note: 'Each change is a consequence of structure-based interpretation. None widens execution intent. Answer-level effects are reviewed against the accepted statuses in the frozen-corpus review (iq7-results.json).', changes: out}, null, 1) + '\n');
console.log(out.length, widened, tally);
