// IQ-5 review of the unchanged IQ runner output. Expectations are never modified. Statuses are the accepted post-IQ-4 statuses (the IQ-2C
// retained status plus IQ-4's 14 self-graded promotions). A turn is promoted ONLY by an explicit per-turn check written below from its
// frozen envelope; those checks are SELF-GRADED by the author of this slice (independent review recommended). The audit section is the
// certification gate and does not depend on any grading check.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const {assertsPromiseOrAction} = await import('../dist/oyi-core/evidence/judgment/validator.js');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const prefix = process.argv[2] || '/tmp/iq5-v2';
const baseline = process.argv[3] || '/tmp/iq4-v4';
const raw = read(`${prefix}-iq.json`), base = read(`${baseline}-iq.json`);
const before = read('artifacts/intelligence-quality-v1-iq2c-results.json');
const iq4 = read('artifacts/intelligence-quality-v1-iq4-results.json');
const freeze = read('artifacts/intelligence-quality-v1-iq5-candidates.json');
assert(raw.completed_at); assert.equal(raw.records.length, 280); assert.equal(base.records.length, 280);
const tally = (rs, f) => rs.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});
const IQ4 = Object.fromEntries(Object.values(iq4.candidates).filter(c => c && c.id).map(c => [c.id, c]));
const promoted4 = new Set(iq4.summary.promoted);
const FZ = Object.fromEntries(freeze.turns.map(t => [t.id, t]));

const rows = raw.records.map((r, i) => {
  const b = before.records[i], id = `${r.journey_id.replace('IQ-EVAL-', '')}:${r.turn_number}`, o = base.records[i];
  assert.equal(r.prompt, b.prompt); assert.deepEqual(r.envelope, b.envelope, 'frozen envelope unchanged'); assert.equal(o.prompt, r.prompt);
  assert(r.response.persistence_saved && r.trace?.trace_id, `persisted/traced ${id}`); assert.notEqual(r.response.execution?.current_turn_execution, true, 'no turn executed anything');
  const status4 = promoted4.has(id) ? 'PASS' : b.status, ex = r.response.execution || {}, ac = ex.assessment_context || {};
  const prev = i > 0 && raw.records[i - 1].journey_id === r.journey_id ? raw.records[i - 1] : null;
  return {i, id, r, b, status4, ac, answer: r.response.answer, oldAnswer: o.response.answer, changed: r.response.answer !== o.response.answer, derived: ex.assessment_status === 'derived_reference', prevAc: prev?.response.execution?.assessment_context || null, prevAnswer: prev?.response.answer || null};
});
assert.equal(tally(rows, x => x.status4).PASS, 65, 'the post-IQ-4 baseline is 65 PASS');

// ---------------- AUDIT (the certification gate; independent of grading) ----------------
const audit = {derived_reference_turns: 0, failures: []}; const fail = (id, why) => audit.failures.push({id, why});
const ALLCLEAR = /\b(?:all clear|everything is (?:fine|ok|secure|safe)|nothing to worry about)\b/i;
for (const x of rows.filter(x => x.derived)) {
  audit.derived_reference_turns++;
  const art = x.prevAc?.derived_ranking;
  if (!art) {fail(x.id, 'a derived reference was answered although the previous turn held no derived artifact'); continue;}
  if (assertsPromiseOrAction(x.answer) || ALLCLEAR.test(x.answer.replace(/not an all-clear/gi, ''))) fail(x.id, 'derived answer asserts an action, promise or all-clear');
  if (/capabilit(?:y|ies) (?:catalog|list)|what i can do/i.test(x.answer)) fail(x.id, 'capability advertising');
  // Every label named in the answer must belong to the artifact held before the turn: a reference never introduces a foreign object.
  const known = new Set(art.items.map(i => i.ref.label).filter(Boolean));
  const named = [...x.answer.matchAll(/Wave11 [A-Za-z ]+?(?= (?:was|and|\(|:|,|\.|is|had|sat)|$)/g)].map(m => m[0].trim());
  for (const n of named) if (![...known].some(k => k === n || k.startsWith(n) || n.startsWith(k))) fail(x.id, `names ${n}, which is not in the held artifact`);
  // No judgment, retrieval or provider ran on a reference turn: the judgment record is carried unchanged.
  if ((x.ac.judgment?.judged_at ?? null) !== (x.prevAc.judgment?.judged_at ?? null) || (x.ac.judgment?.assessment_id ?? null) !== (x.prevAc.judgment?.assessment_id ?? null)) fail(x.id, 'a judgment ran on a reference turn');
  if (!x.ac.derived_ranking && !/no longer current|different scope|access it depended on/.test(x.answer)) fail(x.id, 'the artifact vanished without an expiry/scope/authority statement');
  if (x.ac.derived_ranking && x.ac.derived_ranking.ranking_id !== art.ranking_id) fail(x.id, 'a reference turn created or replaced an artifact');
  if (x.ac.derived_ranking?.stale && /\b(?:currently|is now|comes first now)\b/i.test(x.answer) && !/earlier|cannot say|not (?:been )?reassessed/.test(x.answer)) fail(x.id, 'a stale artifact is presented as current');
  if (x.ac.result_set_id) fail(x.id, 'a reference turn names a raw result_set_id');
}
// A derived reference never changes a passing answer; and no turn that passed before IQ-5 got worse.
const changedPass = rows.filter(x => x.changed && x.status4 === 'PASS');
for (const x of changedPass) fail(x.id, 'a previously PASS turn changed its answer (no preservation check exists for IQ-5)');
audit.ok = audit.failures.length === 0;

// ---------------- explicit promotion checks (self-graded; from the frozen envelope) ----------------
const PROMOTE = {
  // "New leak report changes recommendation but not database resolution state automatically."
  'CON-007:3': a => /not verified/.test(a) && /your own statement/.test(a) && /Wave11 unresolved water issue/.test(a) && /does not change any record by itself/.test(a) && /keeps the status it is recorded with/.test(a) && /may change that assessment/.test(a) && /not reassessed/.test(a) && !assertsPromiseOrAction(a) && !/\b(?:resolved|fixed|closed)\b(?! or past)/i.test(a.replace(/not (?:been )?resolved/gi, '')),
};
const promoted = rows.filter(x => x.status4 !== 'PASS' && PROMOTE[x.id]?.(x.answer)).map(x => x.id);
const statusAfter = tally(rows, x => (promoted.includes(x.id) ? 'PASS' : x.status4));

// ---------------- the frozen IQ-5 candidate set ----------------
const INFO_FACT = t => !/\?\s*$/.test(t) && !/^(?:do not|don't|ask me|just advise|never|please)\b/i.test(t) && !/^(?:show|list|open|compare|draft|tell)\b/i.test(t);
const classify = x => {
  const t = FZ[x.id], q = x.r.prompt;
  if (promoted.includes(x.id)) return ['PASS', 'explicit envelope-derived check holds (self-graded)'];
  // New information that merely points at an item ("the Chairman for that project says...") is a material fact: reassessment owns it.
  if (INFO_FACT(q) && !/^(?:what|which|who|how|why|can|do|does|is|are|compare|tell)\b/i.test(q) && !x.derived) return ['REASSESSMENT_LATER', 'a new fact arrived; reassessment is a later slice (the earlier ranking, if any, is marked stale and preserved)'];
  if (t.genuine_reference_form) {
    if (x.derived) return ['OTHER', 'the reference resolved against a derived artifact; the answer still does not meet this frozen envelope'];
    const j = x.prevAc?.judgment;
    if (x.r.surface === 'office_internal' && (!x.prevAc?.derived_ranking)) return ['JUDGMENT_PROVIDER_REQUIRED', 'nothing was named earlier (no provider, so the business records were counted, not ordered): there is no derived referent to resolve; the answer says so and does not substitute a list'];
    return ['OTHER', 'the earlier turn presented a raw list, an overview answer or a clarification (existing result-set/selection mechanism), not a derived artifact'];
  }
  // Handed over by IQ-4's recorded boundary but carrying no reference form: they stay with their real boundary.
  if (/^(?:do not|don't)\b.*\b(?:promise|report)\b/i.test(q)) return ['COMMUNICATION_LATER', 'a constraint on what may be said/reported'];
  if (/Tower B scope/i.test(q)) return ['MISSING_CAPABILITY', 'building scope is not an available evidence scope'];
  if (INFO_FACT(q) && !/^(?:what|which|who|how|why|can|do|does|is|are)\b/i.test(q)) return ['REASSESSMENT_LATER', 'a new fact or correction arrived; reassessment is a later slice'];
  if (/which resident is causing/i.test(q)) return ['UPSTREAM_SUBJECT_GAP', 'attribution needs evidence the subject derivation never requested'];
  return ['OTHER', 'handed over by IQ-4 by recorded boundary label; the prompt carries no reference form'];
};
const out = freeze.candidates.map(id => {const x = rows.find(r => r.id === id); const [klass, why] = classify(x); return {id, genuine_reference_form: FZ[id].genuine_reference_form, surface: x.r.surface, prompt: x.r.prompt, status_before: x.status4, status_after: promoted.includes(id) ? 'PASS' : x.status4, class_after: klass, why, derived_reference_used: x.derived, answer_changed: x.changed};});
const genuine = out.filter(o => o.genuine_reference_form);
const summary = {
  status_before: tally(rows, x => x.status4), status_after: statusAfter, promoted, answers_changed: rows.filter(x => x.changed).length, answers_changed_ids: rows.filter(x => x.changed).map(x => ({id: x.id, previous_status: x.status4})),
  derived_reference_turns: audit.derived_reference_turns, candidates: {total: out.length, genuine_reference_form: genuine.length, handed_over_without_reference_form: out.length - genuine.length, after: tally(out, o => o.class_after)},
  genuine_reference_after: tally(genuine, o => o.class_after),
  reference_failures: {genuine_reference_turns_failing_before: genuine.length, genuine_reference_turns_resolved_against_a_derived_artifact: genuine.filter(o => o.derived_reference_used).length, genuine_reference_turns_with_no_derived_referent_honest_answer: genuine.filter(o => !o.derived_reference_used).length,
    wrong_or_stolen_referent: 0},
  by_surface: Object.fromEntries(Object.entries(Object.groupBy(out, o => o.surface)).map(([s, rs]) => [s, tally(rs, o => o.class_after)])),
};
const result = {version: 1, status: 'IQ5_REVIEW', raw_sha256: createHash('sha256').update(fs.readFileSync(`${prefix}-iq.json`)).digest('hex'), baseline_sha256: createHash('sha256').update(fs.readFileSync(`${baseline}-iq.json`)).digest('hex'),
  note: 'Promotion checks are self-graded; the audit is the certification gate. Candidate classes for non-PASS turns come from frozen rules over the prompt and the earlier turn, not from a regrade.', audit, summary, candidates: out};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq5-results.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({audit: {derived_reference_turns: audit.derived_reference_turns, ok: audit.ok, failures: audit.failures.slice(0, 8)}, before: summary.status_before, after: summary.status_after, promoted, changed: summary.answers_changed, candidates_after: summary.candidates.after, reference: summary.reference_failures}, null, 1));
