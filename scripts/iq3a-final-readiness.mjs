// IQ-3A final readiness: recompute all 133 evidence-planning turns from
//  - the FROZEN blocker graph (mandatory/optional/excluded/downstream classes),
//  - the CURRENT source inventory (opt-in, certified scope classes),
//  - the test artifacts (a source is only credited with tests that actually passed).
// Pure: executes no collector and no query.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const start = '00daff730bb4bf188db4fa340779e6d591d21994';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const graph = read('artifacts/intelligence-quality-v1-iq3a-blocker-graph.json');
const inventory = read('artifacts/intelligence-quality-v1-evidence-source-inventory.json');
const families = read('artifacts/intelligence-quality-v1-evidence-families.json');
const certPath = 'artifacts/intelligence-quality-v1-evidence-certification.json';
const cert = read(certPath);
const bench = read('artifacts/intelligence-quality-v1-iq3a-benchmark-source-tests.json');
const startCert = JSON.parse(execFileSync('git', ['show', `${start}:${certPath}`], {maxBuffer: 1e9, encoding: 'utf8'}));
assert.equal(graph.starting_head, start);
assert.equal(bench.status, 'PASS');

const byKey = Object.fromEntries(inventory.records.map(r => [r.capability_key, r]));
const passed = new Set([...cert.results, ...bench.results].filter(r => r.status === 'PASS').map(r => r.id));
assert.equal([...cert.results, ...bench.results].filter(r => r.status !== 'PASS').length, 0, 'every recorded test passes');
const testsFor = key => [...passed].filter(id => id.startsWith(`${key}:`));
const SCOPE = {office_permissioned_snapshot: ['office_permissioned_snapshot'], public_public_corporate: ['public_corporate', 'public_thread'], consumer_home: ['consumer_home'], consumer_room: ['consumer_room'], facility_estate: ['facility_estate']};
// A source satisfies a class for a surface x scope only if it is opted in, certified for that scope
// class, and has passing tests bound to its key. Nothing is inherited from a family.
const satisfies = (key, scope) => {
  const r = byKey[key];
  return Boolean(r && r.planner_eligible && String(r.state).startsWith('CERTIFIED') && (r.certified_scopes || []).some(c => (SCOPE[scope] || []).includes(c)) && testsFor(key).length >= 3);
};

const absenceProof = (cls, scope) => {
  const need = id => assert(passed.has(id), `absence proof test missing: ${id}`);
  if (cls === 'device_observed_value') {need('device-observed-value:evidence-exposes-availability-and-freshness-only'); return 'Certified device records carry availability, freshness and registry attributes only; no read capability exposes a lock position, temperature or power state (test: device-observed-value:evidence-exposes-availability-and-freshness-only).';}
  if (cls === 'device_history' && scope === 'facility_estate') {need('devices.activity.read:facility-estate-device-history-has-no-safe-source'); return 'Device modules require a home scope; a Facility actor has none, so every device source is denied before collection (test: devices.activity.read:facility-estate-device-history-has-no-safe-source). No estate-wide device read exists.';}
  if (cls === 'cameras' && scope === 'consumer_home') {need('facility.cameras.read:consumer-not-admitted'); const cams = inventory.records.filter(r => r.domain === 'cameras'); assert(cams.every(r => r.surfaces.length === 1 && r.surfaces[0] === 'facility')); return `The only camera read capability (${cams.map(r => r.capability_key).join(', ')}) is Facility-only; Consumer is denied before collection (test: facility.cameras.read:consumer-not-admitted).`;}
  if (cls === 'utilities_usage') {const usage = inventory.records.filter(r => /^utilities\.(usage|meter|balance)\.read$/.test(r.capability_key)); assert.equal(usage.length, 3); assert(usage.every(r => !r.planner_eligible && /rollout is declared/i.test(r.planner_block_reason || ''))); return `Consumption/meter/balance reads (${usage.map(r => r.capability_key).join(', ')}) are declared, not enabled. Spending/purchases are money, not kWh (the frozen envelope: "Spending is not physical kWh usage").`;}
  throw Error(`no absence proof for ${cls}@${scope}`);
};

const rows = [];
// 64 turns that were already ready: re-verify their certified coverage still holds.
const ready64 = startCert.readiness.filter(r => r.status === 'PLANNER_READY_PARTIAL');
assert.equal(ready64.length, 64);
for (const r of ready64) {
  const unsatisfied = r.required_source_coverage.filter(c => !c.sources.some(k => byKey[k]?.planner_eligible && testsFor(k).length >= 3));
  assert.deepEqual(unsatisfied, [], `${r.id}: previously certified coverage regressed`);
  rows.push({id: r.id, status: 'PLANNER_READY_PARTIAL', basis: 'UNCHANGED_PRIOR_READY', required_source_coverage: r.required_source_coverage, note: 'Every required domain still has a certified partial source with bound tests.'});
}
// 69 turns from the frozen graph.
for (const g of graph.rows) {
  const classes = g.mandatory_evidence_classes.map(c => {
    const sources = c.sources.filter(k => satisfies(k, c.surface_scope));
    return {class: c.class, surface_scope: c.surface_scope, catalogue_sources: c.sources, satisfied_by: sources, no_safe_capability: c.sources.length === 0, tests_bound: sources.map(k => ({key: k, passing_tests: testsFor(k).length}))};
  });
  const missing = classes.filter(c => c.no_safe_capability);
  const unsatisfied = classes.filter(c => !c.no_safe_capability && !c.satisfied_by.length);
  let status, basis;
  if (g.downstream_reasoning_not_evidence) {status = 'DOWNSTREAM_NOT_IQ3'; basis = 'No mandatory evidence read; the turn is reference continuity, workflow policy or composition.';}
  else if (missing.length) {status = 'MISSING_CAPABILITY_PRODUCT_DEBT'; basis = 'A mandatory evidence class has no safe implemented source.';}
  else if (unsatisfied.length) {status = 'SOURCE_CONTRACT_BLOCKED'; basis = `Mandatory class(es) without a certified, tested source: ${unsatisfied.map(c => c.class).join(', ')}`;}
  else {status = 'PLANNER_READY_PARTIAL'; basis = 'Every mandatory class has a certified, tested source for its surface x scope.';}
  // The frozen graph's expectation and the live computation must agree.
  const expected = {PLANNER_READY_PARTIAL_NOW: 'PLANNER_READY_PARTIAL', PLANNER_READY_PARTIAL_AFTER_HARDENING: 'PLANNER_READY_PARTIAL', MISSING_CAPABILITY_PRODUCT_DEBT: 'MISSING_CAPABILITY_PRODUCT_DEBT', DOWNSTREAM_NOT_IQ3: 'DOWNSTREAM_NOT_IQ3'}[g.disposition_if_sources_hardened];
  assert.equal(status, expected, `${g.id}: live readiness ${status} disagrees with frozen graph ${g.disposition_if_sources_hardened}`);
  rows.push({
    id: g.id, status, basis, journey_id: g.journey_id, surface: g.surface, subject: g.subject.kind,
    mandatory_classes: classes, optional_classes: g.optional_evidence_classes, excluded_by_design: g.not_evidence_or_excluded.map(x => x.class),
    absence_proof: missing.map(c => ({class: c.class, surface_scope: c.surface_scope, proof: absenceProof(c.class, c.surface_scope)})),
    planning_constraint: g.subject.kind === 'unconfirmed_target' ? 'Target is unconfirmed: no exact-record read may be attempted; resolve the target first (clarification/IQ-3B).' : g.subject.kind === 'exact_object_in_estate_read' ? 'Exact object is selected from the certified estate read; an exact-record read is not issued.' : null,
  });
}
assert.equal(rows.length, 133);
assert.equal(new Set(rows.map(r => r.id)).size, 133);
const tally = (rs, f) => rs.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});
const counts = {PLANNER_READY_COMPLETE: 0, PLANNER_READY_PARTIAL: 0, MISSING_CAPABILITY_PRODUCT_DEBT: 0, SOURCE_CONTRACT_BLOCKED: 0, DOWNSTREAM_NOT_IQ3: 0, ...tally(rows, r => r.status)};

// Benchmark-required sources and what is bound to them.
const required = graph.summary.unique_mandatory_blocking_sources;
const benchmarkSources = required.map(key => ({capability_key: key, state: byKey[key].state, collector_family: byKey[key].collector_family, certified_scopes: byKey[key].certified_scopes, passing_tests: testsFor(key).length, mandatory_turns: graph.ranking.find(r => r.source === key).mandatory_turn_ids}));
assert(benchmarkSources.every(s => s.state === 'CERTIFIED_PARTIAL' && s.passing_tests >= 3));

// Non-benchmark debt: every read module that is not opted in. Never falsely certified.
const optionalImproves = Object.fromEntries(graph.optional_only_sources.map(s => [s.source, s.optional_turns_improved]));
const debt = inventory.records.filter(r => !r.planner_eligible).map(r => ({
  capability_key: r.capability_key, state: r.state, collector_family: r.collector_family || null,
  classification: r.state === 'NOT_ELIGIBLE_OTHER' ? 'DECLARED_NOT_ENABLED_PRODUCT_DEBT' : 'NON_BENCHMARK_EVIDENCE_DEBT',
  optional_turns_it_would_improve: optionalImproves[r.capability_key] || 0,
  reason: r.planner_block_reason,
}));

// Surface x scope summary + the matrix test evidence.
const scopeStates = tally(inventory.records.flatMap(r => r.surface_scope_certification || []), r => r.state);
const matrix = bench.surface_scope_matrix;
const matrixSummary = {rows: matrix.length, declared_and_admitted: matrix.filter(m => m.declared && m.admitted).length, not_declared_and_rejected: matrix.filter(m => !m.declared && !m.admitted).length, not_declared_but_admitted: matrix.filter(m => !m.declared && m.admitted).length};
assert.equal(matrixSummary.not_declared_but_admitted, 0);

Object.assign(cert, {
  readiness: rows, readiness_counts: counts,
  certification_counts: tally(inventory.records, r => r.state),
  benchmark_required_sources: benchmarkSources,
  blocker_resolution: {
    graph_rows: 69, resolved_to: tally(rows.filter(r => r.basis !== 'UNCHANGED_PRIOR_READY'), r => r.status),
    previously_ready_unchanged: 64,
    missing_capability_product_debt: Object.values(rows.filter(r => r.status === 'MISSING_CAPABILITY_PRODUCT_DEBT').reduce((a, r) => {for (const p of r.absence_proof) {const k = `${p.class}@${p.surface_scope}`; (a[k] ||= {class: p.class, surface_scope: p.surface_scope, proof: p.proof, turns: []}).turns.push(r.id);} return a;}, {})),
    downstream: rows.filter(r => r.status === 'DOWNSTREAM_NOT_IQ3').map(r => ({id: r.id, basis: r.basis})),
    ready_with_planning_constraint: rows.filter(r => r.planning_constraint).map(r => ({id: r.id, constraint: r.planning_constraint})),
  },
  non_benchmark_evidence_debt: {count: debt.length, by_classification: tally(debt, d => d.classification), sources: debt},
  surface_scope_summary: {states: scopeStates, matrix_tests: matrixSummary},
  benchmark_source_tests: {counts: bench.counts, total: bench.results.length},
});
fs.writeFileSync(certPath, JSON.stringify(cert, null, 2) + '\n');
console.log(JSON.stringify({readiness: counts, certification: cert.certification_counts, benchmark_required: benchmarkSources.length, non_benchmark_debt: debt.length, scope_states: scopeStates, matrix: matrixSummary}));
