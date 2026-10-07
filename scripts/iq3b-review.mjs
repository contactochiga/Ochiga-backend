// IQ-3B review of the unchanged IQ runner output. Diagnostic only: it changes no benchmark expectation, grades nothing
// by prose heuristics and promotes no turn to PASS. PASS/FAIL/BLOCKED are retained from the accepted IQ-2C run; a turn is
// promoted only if an explicit per-turn check is added here (none is, by design: the planner states evidence readiness,
// it does not judge).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const prefix = process.argv[2] || '/tmp/iq3b-final';
const raw = read(`${prefix}-iq.json`);
const before = read('artifacts/intelligence-quality-v1-iq2c-results.json');
const pre = read('artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json');
const graph = read('artifacts/intelligence-quality-v1-iq3a-blocker-graph.json');
const startCert = JSON.parse(execFileSync('git', ['show', '00daff730bb4bf188db4fa340779e6d591d21994:artifacts/intelligence-quality-v1-evidence-certification.json'], {maxBuffer: 1e9, encoding: 'utf8'}));
assert(raw.completed_at); assert.equal(raw.records.length, 280);
const tally = (rs, f) => rs.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});

// ---- invariants --------------------------------------------------------------------------
const rows = raw.records.map((r, i) => {
  const b = before.records[i];
  assert.equal(r.prompt, b.prompt); assert.deepEqual(r.envelope, b.envelope, 'frozen envelope unchanged');
  assert(r.response.persistence_saved, `persisted ${i}`); assert(r.trace?.trace_id, `trace ${i}`); assert.notEqual(r.response.execution?.current_turn_execution, true, 'no turn executed anything');
  return {i, id: `${r.journey_id.replace('IQ-EVAL-', '')}:${r.turn_number}`, r, b, changed: r.response.answer !== b.answer,
    // gathered THIS turn (assessment_status evidence_gathered); a plan merely carried in the context on another path is not counted
    plan: r.response.execution?.assessment_status === 'evidence_gathered' ? r.response.execution?.assessment_context?.evidence_plan || null : null,
    carried: r.response.execution?.assessment_status !== 'evidence_gathered' && Boolean(r.response.execution?.assessment_context?.evidence_plan)};
});
const changed = rows.filter(x => x.changed);
const changedPass = changed.filter(x => x.b.status === 'PASS');
// A previously-PASS answer may change only with an explicit per-turn preservation check that encodes WHY it passed
// (its frozen review reason), and that check must still hold. No check, or a failed check, fails the review.
const noExecutionClaim = a => !/\b(?:i (?:have )?(?:turned|switched|set|changed|executed|sent|sold|booked)|has been (?:turned|switched|set|changed|executed|sent))\b/i.test(a);
const PRESERVED = {
  'OMA-005:3': a => /Which item do you mean\?/.test(a) && /No assessed or ranked target has been established/.test(a) && !/financ/i.test(a) && !/\b(?:first|second|third)\b[^.]*\bis\b/i.test(a.replace(/Tell me about the second one\.?/i, '')),
  'CON-002:6': a => noExecutionClaim(a) && !/\bI will (?:switch|turn|change|control)\b/i.test(a),
  'CON-008:5': a => /\bStudy\b/.test(a) && !/\b\d+(?:\.\d+)? ?(?:°|degrees)\b/.test(a) && /observed values|not available in Oyi/i.test(a) && !/wallet/i.test(a),
  'CON-008:6': a => /\bStudy\b/.test(a) && !/wallet/i.test(a) && !/rooms on record/i.test(a),
};
const preserved = changedPass.map(x => ({id: x.id, previous_review_reason: x.b.review_reason, check_holds: Boolean(PRESERVED[x.id]?.(x.r.response.answer))}));
for (const p of preserved) assert(p.check_holds, `previously PASS turn ${p.id} changed and its preservation check ${PRESERVED[p.id] ? 'FAILED' : 'does not exist'}`);
const evidenceIds = new Set(pre.records.filter(r => r.classification === 'EVIDENCE_PLANNING').map(r => r.id));
assert.equal(evidenceIds.size, 133);
const planned = rows.filter(x => x.plan);
assert(planned.every(x => x.plan.v === 1));
// A planner answer never claims it still needs to check, nor the old "not loaded" line, after the planner has checked.
const STILL_CHECKING = /\b(?:i (?:need|have|am going|will|'ll) (?:to )?(?:check|load|look up|gather|fetch)|let me (?:check|look)|not loaded additional sources|i have not loaded)\b/i;
const stillChecking = planned.filter(x => STILL_CHECKING.test(x.r.response.answer));
assert.equal(stillChecking.length, 0, `planner answers that claim to still need to check: ${stillChecking.map(x => x.id).join(',')}`);

// ---- benchmark-required classes per turn --------------------------------------------------
const MCD_CLASS = {crm: 'crm', office_development: 'office_development', office_financial: 'office_financial', office_reports: 'office_reports', office_documents: 'office_documents', corporate_opportunity: 'corporate_opportunity', corporate_partnerships: 'corporate_partnerships', corporate_development: 'corporate_development', maintenance: 'maintenance', security: 'security', visitors: 'visitors', cameras: 'cameras', devices: 'device_availability', scenes: 'scenes', utilities: 'utilities_usage'};
const graphRow = Object.fromEntries(graph.rows.map(g => [g.id, g]));
const preRow = Object.fromEntries(pre.records.map(r => [r.id, r]));
const GATHERED = new Set(['MANDATORY_COMPLETE_ENOUGH', 'MANDATORY_PARTIAL', 'OPTIONAL_GATHERED']);
const out = [];
for (const x of rows.filter(x => evidenceIds.has(x.id))) {
  const p = preRow[x.id]; const g = graphRow[x.id]; const plan = x.plan;
  // Rows with a frozen IQ-3A mandatory judgment (the 69) are scored against it. The other 64 were marked ready by coverage only (no
  // mandatory/optional judgment was recorded), so they are scored against what IQ-2 recorded as required for the subject; the stricter
  // "every benchmark must-consider class" measure is reported separately and never conflated.
  const required = g ? g.mandatory_evidence_classes.map(c => c.class) : [...new Set((p.required_evidence_domains || []).map(d => MCD_CLASS[d]).filter(Boolean))];
  const mustConsider = [...new Set((p.expected.must_consider_domains || []).map(d => MCD_CLASS[d]).filter(Boolean))];
  const debtRequired = g ? g.no_safe_capability.map(c => c.class) : [];
  const byClass = Object.fromEntries((plan?.classes || []).map(c => [c.class, c]));
  const strictNotGathered = mustConsider.filter(cls => !(byClass[cls] && (GATHERED.has(byClass[cls].status) || (byClass[cls].reason || '').startsWith('known_product_debt'))));
  const detail = required.map(cls => {
    const c = byClass[cls]; let state;
    if (!c) state = 'not_requested';
    else if (GATHERED.has(c.status)) state = 'gathered';
    else if (c.status === 'MANDATORY_MISSING_CAPABILITY' || (c.status === 'OPTIONAL_UNAVAILABLE' && /known_product_debt/.test(c.reason || ''))) state = 'debt_disclosed';
    else state = 'unavailable';
    return {class: cls, state, planner_status: c?.status || null};
  });
  const disposition = g ? g.disposition_if_sources_hardened : 'PLANNER_READY_PARTIAL_PRIOR';
  let outcome, finalClass, gap = null;
  if (!plan) {outcome = 'NO_PLAN'; finalClass = 'OTHER'; gap = 'no evidence plan was produced for this turn (an existing certified path answered it)';}
  else if (disposition === 'MISSING_CAPABILITY_PRODUCT_DEBT') {
    const undisclosed = detail.filter(d => debtRequired.includes(d.class) && d.state !== 'debt_disclosed');
    if (!undisclosed.length) {outcome = 'MISSING_CAPABILITY_PRODUCT_DEBT'; finalClass = 'MISSING_CAPABILITY_PRODUCT_DEBT';}
    else {outcome = 'EVIDENCE_GAP'; finalClass = 'OTHER'; gap = `proven product debt not surfaced by the plan: ${undisclosed.map(d => d.class).join(', ')} (the IQ-2 subject did not request it)`;}
  } else {
    const wanted = detail.filter(d => g ? !debtRequired.includes(d.class) : true);
    const bad = wanted.filter(d => d.state !== 'gathered');
    if (disposition === 'DOWNSTREAM_NOT_IQ3') outcome = 'NO_EVIDENCE_REQUIRED_BY_TURN';
    else if (bad.length) {outcome = 'EVIDENCE_GAP'; gap = bad.map(d => `${d.class}:${d.state}${d.planner_status ? `(${d.planner_status})` : ''}`).join(', ');}
    else outcome = wanted.every(d => d.planner_status === 'MANDATORY_COMPLETE_ENOUGH') && wanted.length ? 'PLANNER_SUCCESS' : 'PLANNER_PARTIAL_SUCCESS';
    if (outcome === 'EVIDENCE_GAP') finalClass = 'OTHER';
    else {
      // What the turn now fails at, from the boundary the frozen review recorded BEHIND evidence planning.
      const next = p.previous_boundary;
      finalClass = p.objective === 'reassess' || next === 'FACT_UPDATE_REASSESSMENT' ? 'REASSESSMENT'
        : next === 'INITIATIVE' ? 'INITIATIVE'
        : next === 'DERIVED_RESULT_CONTINUITY' || next === 'INTERPRETATION_OR_CONTINUITY' ? 'REFERENCE_CONTINUITY'
        : 'NOW_SUFFICIENT_EVIDENCE_BUT_JUDGMENT_FAILS';
    }
  }
  out.push({id: x.id, surface: p.surface, objective: p.objective, previous_boundary: p.previous_boundary, evidence_outcome: outcome, final_class: finalClass, gap, benchmark_must_consider_not_gathered: strictNotGathered, iq2_required_classes: required,
    required_classes: detail, plan_status: plan?.status || null, sources_attempted: plan?.stats.sources_attempted ?? 0, sources_reused: plan?.stats.sources_reused ?? 0,
    planner_latency_ms: plan?.stats.latency_ms ?? 0, turn_latency_ms: x.r.latency_ms ?? null, baseline_turn_latency_ms: x.b.latency_ms ?? null, status_retained: x.b.status, answer_changed: x.changed});
}
assert.equal(out.length, 133);

// ---- performance, from the corpus run -------------------------------------------------------
const stats = a => a.length ? {n: a.length, mean: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1), max: Math.max(...a), p95: [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))]} : {n: 0};
const group = r => r.sources_attempted === 0 ? 'reused_only' : r.sources_attempted === 1 ? '1_source' : r.sources_attempted === 2 ? '2_sources' : r.sources_attempted === 3 ? '3_sources' : r.sources_attempted <= 5 ? '4_5_sources' : '6_8_sources';
const perf = {};
for (const [g, rs] of Object.entries(Object.groupBy(out.filter(r => r.evidence_outcome !== 'NO_PLAN'), group))) perf[g] = {turns: rs.length, planner_latency_ms: stats(rs.map(r => r.planner_latency_ms)), turn_latency_ms: stats(rs.map(r => r.turn_latency_ms).filter(Number.isFinite))};
const attempted = out.reduce((s, r) => s + r.sources_attempted, 0), reused = out.reduce((s, r) => s + r.sources_reused, 0);
const reuse = {sources_attempted: attempted, sources_reused: reused, reads_avoided_pct: attempted + reused ? +(100 * reused / (attempted + reused)).toFixed(1) : 0};

// ---- summary --------------------------------------------------------------------------------
const summary = {
  turns_total: 280, status_retained: tally(rows, x => x.b.status), answers_changed: changed.length, answers_changed_by_previous_status: tally(changed, x => x.b.status),
  answers_changed_outside_the_133: changed.filter(x => !evidenceIds.has(x.id)).map(x => ({id: x.id, previous_status: x.b.status, previous_class: preRow[x.id]?.classification || null})),
  evidence_planning_133: {
    evidence_outcome: tally(out, r => r.evidence_outcome), final_class: tally(out, r => r.final_class),
    moved_out_of_evidence_planning: out.filter(r => r.final_class !== 'OTHER').length,
    moved_to_judgment_iq4: out.filter(r => r.final_class === 'NOW_SUFFICIENT_EVIDENCE_BUT_JUDGMENT_FAILS').length,
    strict_measure: {turns_with_every_benchmark_must_consider_class_gathered_or_disclosed: out.filter(r => r.evidence_outcome !== 'NO_PLAN' && !r.benchmark_must_consider_not_gathered.length).length, turns_with_benchmark_must_consider_classes_not_gathered: out.filter(r => r.benchmark_must_consider_not_gathered.length).length, by_class: tally(out.flatMap(r => r.benchmark_must_consider_not_gathered.map(c => ({c}))), x => x.c)},
    remaining_evidence_planning_failures: out.filter(r => r.final_class === 'OTHER').map(r => ({id: r.id, evidence_outcome: r.evidence_outcome, gap: r.gap})),
    by_surface: Object.fromEntries(Object.entries(Object.groupBy(out, r => r.surface)).map(([s, rs]) => [s, tally(rs, r => r.final_class)])),
  },
  plan_status: tally(out.filter(r => r.plan_status), r => r.plan_status), performance: perf, reuse,
};
const result = {
  version: 1, status: 'IQ3B_REVIEW', raw_sha256: hash(`${prefix}-iq.json`), note: 'PASS/FAIL/BLOCKED retained from the accepted IQ-2C run; no turn promoted. The planner states evidence readiness and does not judge.',
  preserved_pass_turns: preserved, summary, oma001: rows.filter(x => x.id.startsWith('OMA-001:')).map(x => ({id: x.id, prompt: x.r.prompt, answer: x.r.response.answer.slice(0, 900), plan_status: x.plan?.status || null, attempted: x.plan?.stats.sources_attempted ?? null, reused: x.plan?.stats.sources_reused ?? null, invalidation: x.plan?.invalidation || null})),
  turns: out,
};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq3b-results.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({status_retained: summary.status_retained, answers_changed: summary.answers_changed, outside_133: summary.answers_changed_outside_the_133.length, evidence_outcome: summary.evidence_planning_133.evidence_outcome, final_class: summary.evidence_planning_133.final_class, moved_to_judgment: summary.evidence_planning_133.moved_to_judgment_iq4, remaining: summary.evidence_planning_133.remaining_evidence_planning_failures.length, reuse}, null, 1));
