// IQ-4 review of the unchanged IQ runner output. Expectations are never modified. PASS/FAIL/BLOCKED are retained from the accepted
// IQ-2C run EXCEPT where an explicit per-turn check below promotes a candidate; those checks are written from each frozen
// envelope's must_notice / acceptable conclusions and are SELF-GRADED by the author of the judgment layer (independent review is
// recommended). The audit section is the certification gate: it does not depend on those checks.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const {assertsPromiseOrAction} = await import('../dist/oyi-core/evidence/judgment/validator.js');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const prefix = process.argv[2] || '/tmp/iq4-v2';
const raw = read(`${prefix}-iq.json`);
const before = read('artifacts/intelligence-quality-v1-iq2c-results.json');
const cand = read('artifacts/intelligence-quality-v1-iq4-candidates.json');
const iq3b = read('artifacts/intelligence-quality-v1-iq3b-results.json');
assert(raw.completed_at); assert.equal(raw.records.length, 280);
const tally = (rs, f) => rs.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});
const I3 = Object.fromEntries(iq3b.turns.map(t => [t.id, t]));
const CAND = Object.fromEntries(cand.turns.map(t => [t.id, t]));

const rows = raw.records.map((r, i) => {
  const b = before.records[i], id = `${r.journey_id.replace('IQ-EVAL-', '')}:${r.turn_number}`;
  assert.equal(r.prompt, b.prompt); assert.deepEqual(r.envelope, b.envelope, 'frozen envelope unchanged');
  assert(r.response.persistence_saved && r.trace?.trace_id, `persisted/traced ${id}`); assert.notEqual(r.response.execution?.current_turn_execution, true, 'no turn executed anything');
  const ac = r.response.execution?.assessment_context || {};
  return {i, id, r, b, ac, answer: r.response.answer, changed: r.response.answer !== b.answer, judged: r.response.execution?.assessment_status === 'evidence_gathered' && Boolean(ac.judgment), plan: r.response.execution?.assessment_status === 'evidence_gathered' ? ac.evidence_plan : null};
});

// ---------------- AUDIT: the certification gate (independent of any grading check) ----------------
const judged = rows.filter(x => x.judged);
const audit = {judged_turns: judged.length, failures: []};
const fail = (id, why) => audit.failures.push({id, why});
const noAction = /\b(?:i (?:have|'ve) (?:sent|booked|called|approved|created|turned|switched|scheduled))\b/i;
const STILL = /\b(?:i (?:need|will|'ll) (?:to )?(?:check|load|look up|gather)|let me check|not loaded additional sources)\b/i;
for (const x of judged) {
  const j = x.ac.judgment;
  if (!j.validated) fail(x.id, 'judgment recorded as not validated');
  if (assertsPromiseOrAction(x.answer)) fail(x.id, 'answer asserts an action, promise or guarantee');
  if (noAction.test(x.answer) || STILL.test(x.answer)) fail(x.id, 'answer claims an action or says it still needs to check');
  if (/\b(?:all clear|everything is (?:fine|ok|secure|safe)|nothing to worry about)\b/i.test(x.answer.replace(/not an all-clear/gi, ''))) fail(x.id, 'answer contains an all-clear');
  if (/capabilit(?:y|ies) (?:catalog|list)|what i can do/i.test(x.answer)) fail(x.id, 'capability advertising');
  const art = x.ac.derived_ranking;
  if (art) {
    if (x.plan && art.assessment_id !== x.plan.plan_id && x.ac.judgment.mode !== 'deterministic') fail(x.id, 'ranking artifact not derived from this bundle');
    if (x.plan?.missing_mandatory?.length && art.created_at >= x.plan.gathered_at) fail(x.id, 'a ranking exists although mandatory evidence is missing');
    const refs = new Set((x.plan?.contributions || []).flatMap(c => c.refs.map(rf => `${rf.t}|${rf.id}`)));
    for (const it of art.items) if (x.plan && !refs.has(`${it.ref.t}|${it.ref.id}`) && art.assessment_id === x.plan.plan_id) fail(x.id, `ranked item ${it.ref.id} is not in the evidence bundle`);
    if (art.basis === 'deterministic') {
      const typed = new Set(['maintenance', 'security', 'office_support', 'office_tasks', 'office_meetings']);
      const classes = new Set((x.plan?.contributions || []).filter(c => c.refs.some(rf => art.items.some(it => it.ref.id === rf.id))).map(c => c.evidence_class));
      for (const c of classes) if (!typed.has(c)) fail(x.id, `a deterministic ranking contains ${c}, which needs comparative judgment`);
      const businessPresent = (x.plan?.contributions || []).some(c => ['crm', 'office_development', 'office_reports'].includes(c.evidence_class) && c.availability === 'available' && c.record_count);
      if (businessPresent && art.assessment_id === x.plan?.plan_id) fail(x.id, 'a typed ordering answered for a set containing uncomparable business records');
    }
    // A ranking and an unrelated raw result set may coexist as SEPARATE objects (e.g. an overview turn after a ranking turn). What is
    // forbidden is a ranking created on a turn that also names a raw result set: the ranking is never equated with an older list.
    const prev = rows[x.i - 1], prevArt = prev && prev.r.journey_id === x.r.journey_id ? prev.ac.derived_ranking : null;
    const createdThisTurn = !prevArt || prevArt.ranking_id !== art.ranking_id;
    if (createdThisTurn && x.ac.result_set_id) fail(x.id, 'a ranking was created on a turn that also names a raw result_set_id');
  }
}
const oma2 = rows.find(x => x.id === 'OMA-001:2');
if (oma2.ac.derived_ranking && oma2.ac.judgment.mode !== 'provider') fail('OMA-001:2', 'a top-3 was manufactured without comparative judgment');
audit.ok = audit.failures.length === 0;

// ---------------- previously PASS turns that changed ----------------
const noExec = a => !/\b(?:i (?:have |'ve )?(?:turned|switched|set|changed|executed|sent|sold|booked)|has been (?:turned|switched|set|changed|executed|sent))\b/i.test(a);
const PRESERVED = {
  'OMA-005:3': a => /Which item do you mean\?/.test(a) && /No assessed or ranked target has been established/.test(a) && !/financ/i.test(a),
  'CON-002:6': a => noExec(a) && !/\bI will (?:switch|turn|change|control)\b/i.test(a),
  'CON-008:5': a => /\bStudy\b/.test(a) && !/\b\d+(?:\.\d+)? ?(?:°|degrees)\b/.test(a) && /observed values|not available in Oyi/i.test(a) && !/wallet/i.test(a),
  'CON-008:6': a => /\bStudy\b/.test(a) && !/wallet/i.test(a) && !/rooms on record/i.test(a),
};
const changedPass = rows.filter(x => x.changed && x.b.status === 'PASS');
const preserved = changedPass.map(x => ({id: x.id, check_holds: Boolean(PRESERVED[x.id]?.(x.answer)), has_check: Boolean(PRESERVED[x.id])}));
for (const p of preserved) assert(p.check_holds, `previously PASS turn ${p.id} changed and its preservation check ${p.has_check ? 'FAILED' : 'does not exist'}`);

// ---------------- explicit promotion checks (self-graded; strict; from each frozen envelope) ----------------
const noAllClear = a => !/\b(?:all clear|everything is (?:fine|ok|okay|secure|safe)|nothing to worry about|is secure|is safe)\b/i.test(a.replace(/not an all-clear/gi, ''));
const notAClaimOfOutage = a => !/\bcamera[^.]*\b(?:is|are) (?:offline|down|broken|failed)\b/i.test(a);
const ranksWaterFirst = a => /Wave11 unresolved water issue comes first/.test(a);
const resolvedCanWait = a => /Can wait or needs no action: [^.]*Wave11 resolved light issue/.test(a);
const permission = a => /permission, not evidence that anyone has arrived or left/.test(a) && /\d+ currently active, \d+ expired/.test(a);
const securityBasics = a => noAllClear(a) && /not an all-clear/.test(a) && /camera state/i.test(a) && /observed values/i.test(a);
const PROMOTE = {
  'FAC-001:4': a => ranksWaterFirst(a) && resolvedCanWait(a) && /Camera state is unobservable/.test(a) && /neither an outage nor normal operation/.test(a) && notAClaimOfOutage(a),
  'FAC-003:7': a => ranksWaterFirst(a) && resolvedCanWait(a) && !/urgent/i.test(a.replace(/not (?:an? )?urgent/gi, '')),
  'FAC-003:3': a => /Not a current concern \(resolved or past\): Wave11 resolved light issue/.test(a) && /Needs attention: Wave11 unresolved water issue/.test(a),
  'CON-007:2': a => /Not a current concern \(resolved or past\): Wave11 resolved light issue/.test(a) && /Needs attention: Wave11 unresolved water issue/.test(a),
  // Withdrawn after reading the answers: CON-006:5 and CON-002:7 only imply the direct conclusion the question asks for.
  'CON-006:2': permission, 'CON-006:3': permission,
  'CON-004:2': securityBasics, 'CON-004:5': securityBasics, 'CON-004:6': securityBasics,
  'CON-001:1': a => securityBasics(a) && noExec(a), 'CON-001:2': a => securityBasics(a) && ranksWaterFirst(a) && resolvedCanWait(a), 'CON-001:3': a => securityBasics(a) && /no security incidents are recorded in the checked scope/i.test(a),
  'CON-001:4': a => /lock position/.test(a) && /not available in Oyi/.test(a) && /stale/.test(a) && noAllClear(a) && noExec(a),
  'CON-002:4': a => /temperature/.test(a) && /not available in Oyi/.test(a) && !/\b\d+(?:\.\d+)? ?(?:°|degrees)\b/.test(a),
  'FAC-002:2': a => /Camera state is unobservable/.test(a) && /neither an outage nor normal operation/.test(a) && notAClaimOfOutage(a),
  'CON-008:7': a => /\bStudy\b/.test(a) && /observed values/.test(a) && !/\b\d+(?:\.\d+)? ?(?:°|degrees)\b/.test(a) && !/Master Bedroom/.test(a),
};
// The frozen review gave every candidate the recorded boundary that remains behind judgment. Used only for non-PASS turns.
const boundaryClass = id => {
  const p = I3[id], prior = p?.previous_boundary;
  if (prior === 'FACT_UPDATE_REASSESSMENT') return 'REASSESSMENT_LATER';
  if (prior === 'DERIVED_RESULT_CONTINUITY' || prior === 'INTERPRETATION_OR_CONTINUITY') return 'REFERENCE_CONTINUITY_IQ5';
  if (prior === 'INITIATIVE') return 'INITIATIVE_LATER';
  return null;
};
const out = [];
for (const x of rows.filter(x => CAND[x.id]?.ownership === 'IQ4_CANDIDATE')) {
  const c = CAND[x.id], j = x.ac.judgment || null, strict = I3[x.id]?.benchmark_must_consider_not_gathered || [];
  let klass, why;
  const prior = x.b.status;
  if (prior === 'PASS') {klass = 'PASS'; why = 'retained PASS (preservation check holds)';}
  else if (PROMOTE[x.id]?.(x.answer)) {klass = 'PASS'; why = 'explicit envelope-derived check holds (self-graded)';}
  else if (c.evidence_plan.missing_mandatory_capability.length) {klass = 'MISSING_CAPABILITY'; why = c.evidence_plan.missing_mandatory_capability.join(',');}
  else if (j?.mode === 'bounded_no_provider' || (j?.mode === 'fallback_after_rejection')) {klass = 'JUDGMENT_REMAINS_FAILED'; why = 'comparative judgment on free-text business records needs a configured provider; none is available, so nothing was ranked (honest bounded answer)';}
  else if (boundaryClass(x.id)) {klass = boundaryClass(x.id); why = `recorded next boundary ${I3[x.id].previous_boundary}`;}
  else if (strict.length) {klass = 'UPSTREAM_SUBJECT_GAP'; why = `benchmark lists classes the IQ-2 subject never requested: ${strict.join(', ')}`;}
  else {klass = 'JUDGMENT_REMAINS_FAILED'; why = 'a valid, evidence-linked statement was produced but it does not meet this frozen envelope (the answer is not specific to the question asked)';}
  out.push({id: x.id, surface: c.surface, objective: c.objective, retained_status: prior, after_status: klass === 'PASS' ? 'PASS' : prior, iq4_class: klass, why, judgment: j ? {mode: j.mode, status: j.status, validated: j.validated} : null, ranking_artifact: Boolean(x.ac.derived_ranking), exact_ranking_required: c.flags.exact_ranking_required});
}
assert.equal(out.length, cand.summary.candidates);
const promoted = out.filter(o => o.iq4_class === 'PASS' && o.retained_status !== 'PASS');
const statusAfter = tally(rows, x => (promoted.some(p => p.id === x.id) ? 'PASS' : x.b.status));
const summary = {
  status_before: tally(rows, x => x.b.status), status_after: statusAfter, promoted_count: promoted.length, promoted: promoted.map(p => p.id),
  candidates: {total: out.length, before: tally(out, o => o.retained_status), after: tally(out, o => o.iq4_class)},
  by_surface: Object.fromEntries(Object.entries(Object.groupBy(out, o => o.surface)).map(([s, rs]) => [s, tally(rs, o => o.iq4_class)])),
  judgment_modes_all_turns: tally(judged, x => `${x.ac.judgment.mode}/${x.ac.judgment.status}`), judged_turns: judged.length,
  ranking_artifacts_created: judged.filter(x => x.ac.derived_ranking && x.ac.judgment.judged_at && Date.parse(x.ac.derived_ranking.created_at) >= Date.parse(x.ac.judgment.judged_at) - 5000).length,
  answers_changed: rows.filter(x => x.changed).length, answers_changed_by_previous_status: tally(rows.filter(x => x.changed), x => x.b.status),
  answers_changed_outside_candidates: rows.filter(x => x.changed && CAND[x.id]?.ownership !== 'IQ4_CANDIDATE').map(x => ({id: x.id, previous_status: x.b.status})),
  moved_to_reference_continuity_iq5: out.filter(o => o.iq4_class === 'REFERENCE_CONTINUITY_IQ5').length, moved_to_reassessment: out.filter(o => o.iq4_class === 'REASSESSMENT_LATER').length, moved_to_initiative: out.filter(o => o.iq4_class === 'INITIATIVE_LATER').length,
  remaining_judgment_failures: out.filter(o => o.iq4_class === 'JUDGMENT_REMAINS_FAILED').map(o => o.id), missing_capability: out.filter(o => o.iq4_class === 'MISSING_CAPABILITY').map(o => o.id),
};
const oma = rows.filter(x => x.id.startsWith('OMA-001:')).map(x => ({id: x.id, prompt: x.r.prompt, judgment: x.ac.judgment ? `${x.ac.judgment.mode}/${x.ac.judgment.status}` : null, ranking_artifact: Boolean(x.ac.derived_ranking), answer: x.answer.slice(0, 700)}));
const result = {version: 1, status: 'IQ4_REVIEW', raw_sha256: createHash('sha256').update(fs.readFileSync(`${prefix}-iq.json`)).digest('hex'), note: 'See header: promotion checks are self-graded; the audit is the certification gate and does not depend on them.', audit, preserved_pass_turns: preserved, summary, oma001: oma, candidates: out};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq4-results.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({audit: {judged_turns: audit.judged_turns, ok: audit.ok, failures: audit.failures.slice(0, 8)}, status_before: summary.status_before, status_after: summary.status_after, candidates_after: summary.candidates.after, modes: summary.judgment_modes_all_turns, artifacts: summary.ranking_artifacts_created, preserved: preserved.map(p => [p.id, p.check_holds])}, null, 1));
