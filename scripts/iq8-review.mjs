// IQ-8 review of the unchanged IQ runner output against the accepted post-IQ-7 statuses (69 PASS / 206 FAIL / 5 BLOCKED). Expectations are never
// modified and no turn is promoted by this script: a changed answer is only classified. Audit = certification gate.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const {assertsPromiseOrAction} = await import('../dist/oyi-core/evidence/judgment/validator.js');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8')); const rd = read;
const prefix = process.argv[2] || '/tmp/iq7-v3', baseline = process.argv[3] || '/tmp/iq6-v4';
const out = process.argv[4] || '/tmp/iq7-review.json';
const raw = read(`${prefix}-iq.json`), base = read(`${baseline}-iq.json`);
const before = read('artifacts/intelligence-quality-v1-iq2c-results.json'), iq4 = read('artifacts/intelligence-quality-v1-iq4-results.json'), iq5 = read('artifacts/intelligence-quality-v1-iq5-results.json'), iq6 = read('artifacts/intelligence-quality-v1-iq6-results.json');
assert(raw.completed_at); assert.equal(raw.records.length, 280); assert.equal(base.records.length, 280);
// IQ-8: the baseline is the post-IQ7 run recorded in the candidate artifact
const cand = rd('artifacts/intelligence-quality-v1-iq8-candidates.json'); assert.equal(createHash('sha256').update(fs.readFileSync(`${baseline}-iq.json`)).digest('hex'), cand.source_run_sha256, 'baseline is the post-IQ7 run the candidate set was frozen from');
const promoted = new Set([...iq4.summary.promoted, ...iq5.summary.promoted, ...iq6.summary.promoted]);
const tally = (rs, f) => rs.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});
const ALLCLEAR = /\b(?:all clear|everything is (?:fine|ok|secure|safe)|nothing to worry about)\b/i;
const audit = {failures: []}; const fail = (id, why) => audit.failures.push({id, why});
const rows = raw.records.map((r, i) => {
  const b = before.records[i], o = base.records[i], id = `${r.journey_id.replace('IQ-EVAL-', '')}:${r.turn_number}`;
  assert.equal(r.prompt, b.prompt); assert.deepEqual(r.envelope, b.envelope, 'frozen envelope unchanged');
  if (!(r.response.persistence_saved && r.trace?.trace_id)) fail(id, 'not persisted/traced');
  if (r.response.execution?.current_turn_execution === true) fail(id, 'a turn executed something');
  const status = promoted.has(id) ? 'PASS' : b.status, a = r.response.answer;
  if (assertsPromiseOrAction(a) && !assertsPromiseOrAction(o.response.answer)) fail(id, 'new promise/action assertion');
  if (ALLCLEAR.test(a.replace(/not an all-clear/gi, '')) && !ALLCLEAR.test(o.response.answer.replace(/not an all-clear/gi, ''))) fail(id, 'new all-clear');
  return {id, status, prompt: r.prompt, old: o.response.answer, now: a, changed: a !== o.response.answer};
});
assert.equal(tally(rows, x => x.status).PASS, 69, 'accepted baseline is 69 PASS');
const changed = rows.filter(x => x.changed), changedPass = changed.filter(x => x.status === 'PASS');
const summary = {baseline_status: tally(rows, x => x.status), answers_changed: changed.length, changed_by_status: tally(changed, x => x.status), changed_pass_ids: changedPass.map(x => x.id),
  changed_ids: changed.map(x => x.id)};
fs.writeFileSync(out, JSON.stringify({summary, audit, changed: changed.map(x => ({id: x.id, status: x.status, prompt: x.prompt, old: x.old, now: x.now}))}, null, 1));
console.log(JSON.stringify({summary: {...summary, changed_ids: undefined}, audit}, null, 1));
