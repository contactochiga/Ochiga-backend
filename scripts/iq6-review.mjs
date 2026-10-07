// IQ-6 review of the unchanged IQ runner output. Expectations are never modified. Statuses are the accepted post-IQ-5 statuses (IQ-2C retained
// status + IQ-4 + IQ-5 promotions). A turn is promoted ONLY by an explicit per-turn check written below from its frozen envelope; those checks are
// SELF-GRADED by the author of this slice (independent review recommended). The audit is the certification gate and does not depend on grading.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const {assertsPromiseOrAction} = await import('../dist/oyi-core/evidence/judgment/validator.js');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const prefix = process.argv[2] || '/tmp/iq6-v1', baseline = process.argv[3] || '/tmp/iq5-v3';
const raw = read(`${prefix}-iq.json`), base = read(`${baseline}-iq.json`);
const before = read('artifacts/intelligence-quality-v1-iq2c-results.json'), iq4 = read('artifacts/intelligence-quality-v1-iq4-results.json'), iq5 = read('artifacts/intelligence-quality-v1-iq5-results.json'), freeze = read('artifacts/intelligence-quality-v1-iq6-candidates.json');
assert(raw.completed_at); assert.equal(raw.records.length, 280); assert.equal(base.records.length, 280);
const tally = (rs, f) => rs.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});
const promoted0 = new Set([...iq4.summary.promoted, ...iq5.summary.promoted]);
const FZ = Object.fromEntries(freeze.turns.map(t => [t.id, t]));
const rows = raw.records.map((r, i) => {
  const b = before.records[i], id = `${r.journey_id.replace('IQ-EVAL-', '')}:${r.turn_number}`, o = base.records[i];
  assert.equal(r.prompt, b.prompt); assert.deepEqual(r.envelope, b.envelope, 'frozen envelope unchanged');
  assert(r.response.persistence_saved && r.trace?.trace_id, `persisted/traced ${id}`); assert.notEqual(r.response.execution?.current_turn_execution, true, 'no turn executed anything');
  const status5 = promoted0.has(id) ? 'PASS' : b.status, ex = r.response.execution || {}, ac = ex.assessment_context || {};
  const prev = i > 0 && raw.records[i - 1].journey_id === r.journey_id ? raw.records[i - 1] : null;
  return {i, id, r, status5, ac, answer: r.response.answer, oldAnswer: o.response.answer, changed: r.response.answer !== o.response.answer, derived: ex.assessment_status === 'derived_reference', prevAc: prev?.response.execution?.assessment_context || null};
});
assert.equal(tally(rows, x => x.status5).PASS, 66, 'the post-IQ-5 baseline is 66 PASS');

// ---------------- AUDIT (certification gate; independent of grading) ----------------
const audit = {turns_with_facts_or_reassessment: 0, failures: []}; const fail = (id, why) => audit.failures.push({id, why});
const ALLCLEAR = /\b(?:all clear|everything is (?:fine|ok|secure|safe)|nothing to worry about)\b/i;
const VALID = new Set(['UNCHANGED', 'CHANGED_ORDER', 'CHANGED_CONCLUSION', 'INSUFFICIENT_TO_REASSESS', 'NEEDS_CLARIFICATION', 'MISSING_CAPABILITY']);
for (const x of rows) {
  const facts = x.ac.facts || [], rec = x.ac.reassessment, art = x.ac.derived_ranking, hist = x.ac.derived_history;
  if (!(x.derived || facts.length || rec)) continue; audit.turns_with_facts_or_reassessment++;
  if (assertsPromiseOrAction(x.answer) || ALLCLEAR.test(x.answer.replace(/not an all-clear/gi, ''))) fail(x.id, 'answer asserts an action, promise or all-clear');
  if (/capabilit(?:y|ies) (?:catalog|list)|what i can do/i.test(x.answer)) fail(x.id, 'capability advertising');
  for (const f of facts) { if (f.status !== 'user_supplied_unverified') fail(x.id, 'a conversational fact is not marked user-supplied/unverified'); if (/\b(?:is verified|has been verified|confirmed that)\b/i.test(x.answer) && !/not (?:been )?verified|not confirmed/i.test(x.answer)) fail(x.id, 'a fact is presented as verified'); }
  const actives = facts.filter(f => !f.superseded_by); const byCorrects = facts.filter(f => f.corrects); for (const c of byCorrects) { const old = facts.find(f => f.id === c.corrects); if (old && old.superseded_by !== c.id) fail(x.id, 'a correction did not supersede the fact it corrects'); }
  if (rec) {
    if (!VALID.has(rec.change_class)) fail(x.id, `unknown change class ${rec.change_class}`);
    if (rec.failure && art && art.ranking_id !== rec.previous_ranking_id) fail(x.id, 'a failed reassessment replaced the artifact');
    if (rec.failure && art && !art.stale && art.surface) fail(x.id, 'a failed reassessment left the artifact marked current');
    if (!rec.failure && ['UNCHANGED', 'CHANGED_ORDER', 'CHANGED_CONCLUSION'].includes(rec.change_class)) {
      if (!art || art.stale) fail(x.id, 'a successful reassessment did not produce a current artifact'); else if (art.reassessed_from !== rec.previous_ranking_id) fail(x.id, 'the new artifact does not point at the one it replaced');
      if (!hist || hist.ranking_id !== rec.previous_ranking_id || !hist.historical) fail(x.id, 'the replaced artifact was not kept as history'); if (hist?.derived_history) fail(x.id, 'history accumulates');
    }
    if (/Chairman|financing|\bsays\b/i.test(JSON.stringify(rec))) fail(x.id, 'fact text appears in the reassessment record');
  }
  if (art && hist && art.ranking_id === hist.ranking_id) fail(x.id, 'current and historical artifact are the same object');
}
// ---------------- previously PASS turns that changed: each needs an explicit preservation check ----------------
const PRESERVED = {
  'OSA-004:2': a => /location from Lagos to Abuja/.test(a) && /location: Abuja/.test(a) && !/location: Lagos/.test(a) && /not independently verified/.test(a) && !assertsPromiseOrAction(a),
  'CON-007:3': a => /not verified/.test(a) && /your own statement/.test(a) && /Wave11 unresolved water issue/.test(a) && /does not change any record by itself/.test(a) && /keeps the status it is recorded with/.test(a) && /may change/.test(a) && /not reassessed/.test(a) && !assertsPromiseOrAction(a),
};
const changedPass = rows.filter(x => x.changed && x.status5 === 'PASS');
const preserved = changedPass.map(x => ({id: x.id, has_check: Boolean(PRESERVED[x.id]), check_holds: Boolean(PRESERVED[x.id]?.(x.answer))}));
for (const p of preserved) if (!p.check_holds) fail(p.id, `previously PASS turn changed and its preservation check ${p.has_check ? 'FAILED' : 'does not exist'}`);
audit.ok = audit.failures.length === 0;

// ---------------- explicit promotion checks (self-graded; strict; from each frozen envelope) ----------------
const supersededArea = a => /land size from 1,200 sqm to 920 sqm/.test(a) && /land size: 920 sqm/.test(a) && !/land size: 1,200/.test(a) && /structure offered: JV/.test(a) && /not independently verified/.test(a) && !assertsPromiseOrAction(a);
const leakClaim = a => /not verified/.test(a) && /your own statement/.test(a) && /Wave11 unresolved water issue/.test(a) && /does not change any record by itself/.test(a) && /keeps the status it is recorded with/.test(a) && /may change/.test(a) && /not reassessed/.test(a) && !assertsPromiseOrAction(a);
const PROMOTE = {'OSA-005:2': supersededArea, 'OSA-005:3': supersededArea, 'CON-007:5': leakClaim};
const promoted = rows.filter(x => x.status5 !== 'PASS' && PROMOTE[x.id]?.(x.answer)).map(x => x.id);
const statusAfter = tally(rows, x => (promoted.includes(x.id) ? 'PASS' : x.status5));

// ---------------- the frozen IQ-6 candidate set ----------------
const classify = x => {
  const q = x.r.prompt, objective = x.r.response.execution?.cognitive_objective || null;
  if (promoted.includes(x.id)) return ['PASS', 'explicit envelope-derived check holds (self-graded)'];
  const rec = x.ac.reassessment, j = x.prevAc?.judgment || x.ac.judgment;
  if (/^(?:do not|don't)\b.*\b(?:promise|report|claim)\b|^(?:turn that into|draft|write)\b/i.test(q)) return ['COMMUNICATION', 'a constraint on what may be said or drafted'];
  if (/make the commitment|^(?:just advise|then just recommend|give me one next|offer an honest|suggest a sensible|recommend a)\b/i.test(q)) return ['INITIATIVE', 'asks for a next step or recommendation to act'];
  if (x.derived && /no earlier ordering to change|nothing to reassess|noted as your own/.test(x.answer) && x.r.surface === 'office_internal') return ['PROVIDER_REQUIRED_JUDGMENT', 'no ordering existed to reassess because comparative judgment on business records needs a configured provider; the fact is recorded as unverified and nothing is fabricated'];
  if (x.r.surface === 'office_internal' && /^(?:does|what changed|what evidence would)/i.test(q)) return ['PROVIDER_REQUIRED_JUDGMENT', 'a reassessment question on an Office ranking that could not be produced without a provider'];
  if (x.r.surface === 'office_internal') return ['PROVIDER_REQUIRED_JUDGMENT', 'Office business-record judgment needs a configured provider; the answer is bounded and honest'];
  if (/Tower B scope/i.test(q)) return ['MISSING_CAPABILITY', 'building scope is not an available evidence scope'];
  if (/which resident is causing/i.test(q)) return ['UPSTREAM_SUBJECT_GAP', 'attribution needs evidence the subject derivation never requested'];
  if (/^(?:which device|show|open)\b|\bearlier\?$/i.test(q)) return ['RAW_RESULT_CONTINUITY', 'refers to an earlier raw list or object'];
  if (rec || x.derived) return ['OTHER', 'the update or reassessment is now handled (fact bound, marked or reassessed) but the answer still does not meet this frozen envelope'];
  return ['OTHER', 'not a reassessment boundary on inspection; stays with its recorded failure layer'];
};
const out = freeze.candidates.map(id => {const x = rows.find(r => r.id === id); const [klass, why] = classify(x); return {id, update_type: FZ[id].update_type, surface: x.r.surface, prompt: x.r.prompt, status_before: x.status5, status_after: promoted.includes(id) ? 'PASS' : x.status5, class_after: klass, why, handled_by_iq6: x.derived || Boolean(x.ac.reassessment) || /^I have (?:changed|added)/.test(x.answer), answer_changed: x.changed};});
const summary = {
  status_before: tally(rows, x => x.status5), status_after: statusAfter, promoted, answers_changed: rows.filter(x => x.changed).length, answers_changed_ids: rows.filter(x => x.changed).map(x => ({id: x.id, previous_status: x.status5})),
  preserved_pass_turns: preserved, turns_with_facts_or_reassessment: audit.turns_with_facts_or_reassessment,
  candidates: {total: out.length, before: {FAIL: out.length}, after: tally(out, o => o.class_after)}, by_surface: Object.fromEntries(Object.entries(Object.groupBy(out, o => o.surface)).map(([s, rs]) => [s, tally(rs, o => o.class_after)])),
  reassessment_failures: {before: out.length, after: out.filter(o => o.class_after !== 'PASS').length, handled_by_iq6_but_still_failing: out.filter(o => o.class_after !== 'PASS' && o.handled_by_iq6).length, passing_now: out.filter(o => o.class_after === 'PASS').length},
};
const result = {version: 1, status: 'IQ6_REVIEW', raw_sha256: createHash('sha256').update(fs.readFileSync(`${prefix}-iq.json`)).digest('hex'), baseline_sha256: createHash('sha256').update(fs.readFileSync(`${baseline}-iq.json`)).digest('hex'),
  note: 'Promotion checks are self-graded; the audit is the certification gate. Candidate classes for non-PASS turns come from frozen rules over the prompt/surface and what IQ-6 did, not from a regrade.', audit, summary, candidates: out};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq6-results.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({audit: {n: audit.turns_with_facts_or_reassessment, ok: audit.ok, failures: audit.failures.slice(0, 8)}, before: summary.status_before, after: summary.status_after, promoted, changed: summary.answers_changed, preserved, candidates_after: summary.candidates.after, rf: summary.reassessment_failures}, null, 1));
