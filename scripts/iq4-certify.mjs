// IQ-4 certification record. Pure assembly: reads test/review/validation artifacts and run outputs, enforces every gate, writes
// artifacts/intelligence-quality-v1-iq4-certification.json. It executes nothing itself.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const [prefix = '/tmp/iq4-v2', r = '/tmp/iq4-r2'] = process.argv.slice(2);
const START = '7c74c71006f0ba6e46e7798844d9d65454a2bce7';
const tally = (rs, f) => rs.reduce((a, x) => (a[f(x)] = (a[f(x)] || 0) + 1, a), {});
const last = p => JSON.parse(fs.readFileSync(p, 'utf8').split('\n').filter(l => /^\{"status":/.test(l)).pop());

const judgment = read('artifacts/intelligence-quality-v1-iq4-judgment-tests.json'), review = read('artifacts/intelligence-quality-v1-iq4-results.json'), perf = read('artifacts/intelligence-quality-v1-iq4-performance.json');
const planner = read('artifacts/intelligence-quality-v1-iq3b-planner-tests.json');
const cert = last(`${r}-cert.stdout`), bench = last(`${r}-bench.stdout`), iso = read(`${r}-iso.json`);
const wave = read(`${prefix}-wave11.json`), safety = read(`${prefix}-safety.json`), objective = read(`${prefix}-objective.json`), regressions = read(`${prefix}-regressions.json`), iqRaw = read(`${prefix}-iq.json`);
const iq1 = read('artifacts/intelligence-quality-v1-iq1-results.json').preexisting_controls;
const normalize = s => s.slice(s.indexOf('AssertionError')).replace(/file:\/\/[^\s]+\/scripts\//g, 'file://REPO/scripts/').trim();
const controls = [];
for (const suite of ['oyi-workflow-action-phase-c-reload-smoke', 'oyi-workflow-action-phase-c-multigang-smoke', 'oyi-workflow-action-phase-c-correction-smoke', 'oyi-workflow-durable-continuation-smoke']) {
  const x = regressions.find(y => y.suite === suite); assert.equal(x.status, 'FAIL'); const stored = iq1[suite];
  assert.equal(normalize(fs.readFileSync(x.stderr, 'utf8')).split('\n').slice(0, 5).join('\n'), stored.assertion.trim().split('\n').slice(0, 5).join('\n'), `${suite} differs from the stored pre-IQ1 control`); controls.push({suite, identical_control: true, control_head: stored.control_head});
}
const frozenChanged = execFileSync('git', ['diff', START, '--name-only', '--', 'artifacts/intelligence-quality-v1-baseline.json', 'artifacts/intelligence-quality-v1-failure-map.json', 'artifacts/intelligence-quality-v1-iq1-results.json', 'artifacts/intelligence-quality-v1-iq2c-results.json', 'artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json', 'artifacts/intelligence-quality-v1-iq3a-blocker-graph.json', 'artifacts/intelligence-quality-v1-iq3b-results.json', 'artifacts/intelligence-quality-v1-iq3b-certification.json', 'artifacts/intelligence-quality-v1-evidence-certification.json', 'artifacts/intelligence-quality-v1-evidence-source-inventory.json', 'scripts/intelligence-quality-v1-corpus.mjs'], {encoding: 'utf8'}).trim();
// The candidate set must have been frozen exactly once, BEFORE the first runtime (src) change of this slice.
const freezeCommits = execFileSync('git', ['log', '--format=%H', `${START}..HEAD`, '--', 'artifacts/intelligence-quality-v1-iq4-candidates.json'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
const firstSrc = execFileSync('git', ['log', '--reverse', '--format=%H', `${START}..HEAD`, '--', 'src'], {encoding: 'utf8'}).trim().split('\n')[0];
let frozenBeforeRuntime = false; try {execFileSync('git', ['merge-base', '--is-ancestor', freezeCommits[0], firstSrc]); frozenBeforeRuntime = freezeCommits.length === 1 && freezeCommits[0] !== firstSrc;} catch {}
const s = review.summary;
const src = execFileSync('git', ['diff', START, '--name-only', '--', 'src'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
const gates = {
  judgmentTestsAllPass: judgment.status === 'PASS' && judgment.results.every(x => x.status === 'PASS') && judgment.results.length >= 57,
  plannerTestsAllPass: planner.status === 'PASS' && planner.results.length >= 48 && planner.results.every(x => x.status === 'PASS'),
  iq3aSourceTests: cert.status === 'PASS' && cert.tests >= 255, iq3aBenchmarkTests: bench.status === 'PASS' && bench.tests >= 129, iq3aLiveIsolation: iso.status === 'PASS',
  noUnsupportedJudgmentAnywhere: review.audit.ok && review.audit.judged_turns >= 100,
  noPassRegressed: review.preserved_pass_turns.every(p => p.check_holds),
  statusAccounting: s.status_after.PASS + s.status_after.FAIL + s.status_after.BLOCKED === 280 && s.status_after.BLOCKED === 5 && s.status_after.PASS === 51 + s.promoted_count,
  persistedAndTraced280: iqRaw.records.every(x => x.response.persistence_saved && x.trace?.trace_id),
  wave11: JSON.stringify(tally(wave.records, x => x.status)) === JSON.stringify({PASS: 131, FAIL: 1}),
  iq1Adversarial: safety.execution_attempts === 0 && safety.results.every(x => x.status === 'PASS'),
  iq2Objective: objective.status === 'PASS',
  regressionMatrix: JSON.stringify(tally(regressions, x => x.status)) === JSON.stringify({PASS: 19, FAIL: 4}) && controls.length === 4,
  frozenAndPriorCertificationsUntouched: frozenChanged === '',
  candidateSetFrozenOnceBeforeRuntimeChanges: frozenBeforeRuntime,
  performanceMeasured: perf.status === 'MEASURED' && perf.deterministic.every(d => d.judgment_ms.p95 < 50),
};
const result = {
  version: 1, starting_head: START, status: Object.values(gates).every(Boolean) ? 'IQ-4 BOUNDED JUDGMENT CERTIFIED — IQ-5 APPROVAL REQUIRED' : 'IQ-4 NOT YET CERTIFIED', gates,
  judgment_tests: {total: judgment.results.length, counts: judgment.counts}, planner_tests: {total: planner.results.length}, iq3a_regression: {source_tests: cert.tests, benchmark_tests: bench.tests, isolation: iso.status, synthetic_rows_removed: iso.synthetic_rows_removed},
  audit: review.audit, preserved_pass_turns: review.preserved_pass_turns, summary: s, oma001: review.oma001, performance: perf,
  provider: {configured_in_corpus: false, note: 'No provider key or model is configured in the benchmark environment; provider-backed judgment is exercised only with a scripted stub. Model quality on a live provider is unmeasured.'},
  validation: {wave11: tally(wave.records, x => x.status), safety: {execution_attempts: safety.execution_attempts, results: tally(safety.results, x => x.status)}, objective: {status: objective.status, parser_cases: objective.parser_cases}, regressions: {counts: tally(regressions, x => x.status), controls}},
  source_files_changed: src, source_hashes: Object.fromEntries(src.filter(f => fs.existsSync(f)).map(f => [f, hash(f)])),
  raw_hashes: Object.fromEntries(['iq', 'wave11', 'safety', 'objective', 'regressions'].map(n => [`${prefix}-${n}.json`, hash(`${prefix}-${n}.json`)])),
};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq4-certification.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({status: result.status, gates, src: src.length}, null, 1));
