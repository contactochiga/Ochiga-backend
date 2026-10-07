// IQ-3B certification record. Pure assembly: reads the artifacts/run outputs produced by the tests and validation runs,
// enforces every gate, and writes artifacts/intelligence-quality-v1-iq3b-certification.json. It runs nothing itself.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const [prefix = '/tmp/iq3b-v2', iq3aRegression = '/tmp/iq3b-iq3a-regression.json'] = process.argv.slice(2);
const START = 'e00efb499a651a9746a53407e2c8803cab8ad44b';
const tally = (rs, f) => rs.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});

const planner = read('artifacts/intelligence-quality-v1-iq3b-planner-tests.json');
const review = read('artifacts/intelligence-quality-v1-iq3b-results.json');
const perf = read('artifacts/intelligence-quality-v1-iq3b-performance.json');
const wave = read(`${prefix}-wave11.json`), safety = read(`${prefix}-safety.json`), objective = read(`${prefix}-objective.json`), regressions = read(`${prefix}-regressions.json`);
const iq3a = read(iq3aRegression);
const iq1 = read('artifacts/intelligence-quality-v1-iq1-results.json').preexisting_controls;
const iqRaw = read(`${prefix}-iq.json`);
assert.equal(iqRaw.records.length, 280); assert(iqRaw.completed_at);

// ---- known control failures stay honestly reported (compared with the stored pre-IQ1 control assertions) ----
const normalize = s => s.slice(s.indexOf('AssertionError')).replace(/file:\/\/[^\s]+\/scripts\//g, 'file://REPO/scripts/').trim();
const controls = [];
for (const suite of ['oyi-workflow-action-phase-c-reload-smoke', 'oyi-workflow-action-phase-c-multigang-smoke', 'oyi-workflow-action-phase-c-correction-smoke', 'oyi-workflow-durable-continuation-smoke']) {
  const r = regressions.find(x => x.suite === suite); assert.equal(r.status, 'FAIL'); const stored = iq1[suite]; assert(stored && stored.status === 'FAIL');
  const now = normalize(fs.readFileSync(r.stderr, 'utf8')).split('\n').slice(0, 5).join('\n'), then = stored.assertion.trim().split('\n').slice(0, 5).join('\n');
  assert.equal(now, then, `${suite} differs from the stored pre-IQ1 control`); controls.push({suite, identical_control: true, control_head: stored.control_head});
}
const frozenChanged = execFileSync('git', ['diff', START, '--name-only', '--', 'artifacts/intelligence-quality-v1-baseline.json', 'artifacts/intelligence-quality-v1-failure-map.json', 'artifacts/intelligence-quality-v1-root-causes.json', 'artifacts/intelligence-quality-v1-iq1-results.json', 'artifacts/intelligence-quality-v1-iq2-results.json', 'artifacts/intelligence-quality-v1-iq2b-results.json', 'artifacts/intelligence-quality-v1-iq2c-results.json', 'artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json', 'artifacts/intelligence-quality-v1-iq3a-blocker-graph.json', 'scripts/intelligence-quality-v1-corpus.mjs'], {encoding: 'utf8'}).trim();

const s = review.summary;
const unexplained = s.evidence_planning_133.remaining_evidence_planning_failures.filter(r => !/not requested|not surfaced|no evidence plan|:not_requested|existing certified path/.test(r.gap || ''));
const gates = {
  plannerTestsAllPass: planner.status === 'PASS' && planner.results.every(r => r.status === 'PASS') && planner.results.length >= 48,
  iq3aSourceTests: iq3a.source_tests.status === 'PASS' && iq3a.source_tests.tests >= 255,
  iq3aBenchmarkTests: iq3a.benchmark_tests.status === 'PASS' && iq3a.benchmark_tests.tests >= 129,
  iq3aLiveIsolation: iq3a.isolation.status === 'PASS',
  iq280Retained: JSON.stringify(s.status_retained) === JSON.stringify({PASS: 51, FAIL: 224, BLOCKED: 5}) || (s.status_retained.PASS === 51 && s.status_retained.FAIL === 224 && s.status_retained.BLOCKED === 5),
  noPassRegressed: review.preserved_pass_turns.every(p => p.check_holds),
  persistedAndTraced280: iqRaw.records.every(r => r.response.persistence_saved && r.trace?.trace_id),
  wave11: JSON.stringify(tally(wave.records, r => r.status)) === JSON.stringify({PASS: 131, FAIL: 1}),
  iq1Adversarial: safety.execution_attempts === 0 && safety.results.every(r => r.status === 'PASS'),
  iq2Objective: objective.status === 'PASS',
  regressionMatrix: JSON.stringify(tally(regressions, r => r.status)) === JSON.stringify({PASS: 19, FAIL: 4}) && controls.length === 4,
  frozenArtifactsUntouched: frozenChanged === '',
  noPlannerExecutionDefectInCorpus: unexplained.length === 0,
  performanceWithinLimits: perf.scenarios.every(sc => sc.planner_wall_ms.p95 <= perf.limits.overall_ms && sc.sources_attempted <= perf.limits.max_sources),
  evidencePlannerOnlyOnAssessmentBranch: perf.orchestrator_call_sites === 1,
};
const files = execFileSync('git', ['diff', START, '--name-only'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
const sourceFiles = files.filter(f => f.startsWith('src/'));
const result = {
  version: 1, starting_head: START, status: Object.values(gates).every(Boolean) ? 'IQ-3B GOVERNED EVIDENCE PLANNER CERTIFIED — IQ-4 APPROVAL REQUIRED' : 'IQ-3B NOT YET CERTIFIED',
  gates, limits: perf.limits,
  planner_tests: {total: planner.results.length, counts: planner.counts},
  iq3a_regression: iq3a,
  corpus: {status_retained: s.status_retained, answers_changed: s.answers_changed, answers_changed_by_previous_status: s.answers_changed_by_previous_status, preserved_pass_turns: review.preserved_pass_turns, answers_changed_outside_the_133: s.answers_changed_outside_the_133},
  evidence_planning_133: s.evidence_planning_133, plan_status: s.plan_status, reuse: s.reuse, performance_summary: s.performance, oma001: review.oma001,
  validation: {wave11: tally(wave.records, r => r.status), safety: {execution_attempts: safety.execution_attempts, results: tally(safety.results, r => r.status)}, objective: {status: objective.status, parser_cases: objective.parser_cases, turns: objective.turns.length}, regressions: {counts: tally(regressions, r => r.status), controls}},
  files_changed: files, source_files_changed: sourceFiles,
  source_hashes: Object.fromEntries(sourceFiles.filter(f => fs.existsSync(f)).map(f => [f, hash(f)])),
  raw_hashes: Object.fromEntries(['iq', 'wave11', 'safety', 'objective', 'regressions'].map(n => [`${prefix}-${n}.json`, hash(`${prefix}-${n}.json`)])),
};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq3b-certification.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({status: result.status, gates, files: files.length, src: sourceFiles.length}, null, 1));
