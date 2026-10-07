// IQ-6 certification record. Pure assembly: reads test/review/validation artifacts and run outputs, enforces every gate, writes
// artifacts/intelligence-quality-v1-iq6-certification.json. It executes nothing itself.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const [prefix = '/tmp/iq6-v1'] = process.argv.slice(2); const r = prefix;
const START = '20f04f3f5711ddcb0e142102b4497b5fa0286c86';
const tally = (rs, f) => rs.reduce((a, x) => (a[f(x)] = (a[f(x)] || 0) + 1, a), {});
const last = p => JSON.parse(fs.readFileSync(p, 'utf8').split('\n').filter(l => /^\{"status":/.test(l)).pop());

const reassess = read('artifacts/intelligence-quality-v1-iq6-reassessment-tests.json'), conv6 = read('artifacts/intelligence-quality-v1-iq6-conversation-tests.json'), review = read('artifacts/intelligence-quality-v1-iq6-results.json'), perf = read('artifacts/intelligence-quality-v1-iq6-performance.json');
const reference = last(`${r}-reference.stdout`), conversation = last(`${r}-conversation.stdout`), judgment = last(`${r}-judgment.stdout`), planner = last(`${r}-planner.stdout`);
const cert = last(`${r}-cert.stdout`), bench = last(`${r}-bench.stdout`), iso = read(`${r}-iso.json`);
const wave = read(`${prefix}-wave11.json`), safety = read(`${prefix}-safety.json`), objective = read(`${prefix}-objective.json`), regressions = read(`${prefix}-regressions.json`), iqRaw = read(`${prefix}-iq.json`);
const iq1 = read('artifacts/intelligence-quality-v1-iq1-results.json').preexisting_controls;
const normalize = s => s.slice(s.indexOf('AssertionError')).replace(/file:\/\/[^\s]+\/scripts\//g, 'file://REPO/scripts/').trim();
const controls = [];
for (const suite of ['oyi-workflow-action-phase-c-reload-smoke', 'oyi-workflow-action-phase-c-multigang-smoke', 'oyi-workflow-action-phase-c-correction-smoke', 'oyi-workflow-durable-continuation-smoke']) {
  const x = regressions.find(y => y.suite === suite); assert.equal(x.status, 'FAIL'); const stored = iq1[suite];
  assert.equal(normalize(fs.readFileSync(x.stderr, 'utf8')).split('\n').slice(0, 5).join('\n'), stored.assertion.trim().split('\n').slice(0, 5).join('\n'), `${suite} differs from the stored pre-IQ1 control`); controls.push({suite, identical_control: true, control_head: stored.control_head});
}
const frozenChanged = execFileSync('git', ['diff', START, '--name-only', '--', 'artifacts/intelligence-quality-v1-iq5-candidates.json', 'artifacts/intelligence-quality-v1-iq5-results.json', 'artifacts/intelligence-quality-v1-iq5-certification.json', 'artifacts/intelligence-quality-v1-iq5-performance.json', 'artifacts/intelligence-quality-v1-iq5-reference-tests.json', 'artifacts/intelligence-quality-v1-iq5-conversation-tests.json', 'artifacts/intelligence-quality-v1-iq4-candidates.json', 'artifacts/intelligence-quality-v1-iq4-results.json', 'artifacts/intelligence-quality-v1-iq4-certification.json', 'artifacts/intelligence-quality-v1-iq4-performance.json', 'artifacts/intelligence-quality-v1-iq4-judgment-tests.json', 'artifacts/intelligence-quality-v1-baseline.json', 'artifacts/intelligence-quality-v1-failure-map.json', 'artifacts/intelligence-quality-v1-iq1-results.json', 'artifacts/intelligence-quality-v1-iq2c-results.json', 'artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json', 'artifacts/intelligence-quality-v1-iq3a-blocker-graph.json', 'artifacts/intelligence-quality-v1-iq3b-results.json', 'artifacts/intelligence-quality-v1-iq3b-certification.json', 'artifacts/intelligence-quality-v1-evidence-certification.json', 'artifacts/intelligence-quality-v1-evidence-source-inventory.json', 'scripts/intelligence-quality-v1-corpus.mjs'], {encoding: 'utf8'}).trim();
// The candidate set must have been frozen exactly once, BEFORE the first runtime (src) change of this slice.
const freezeCommits = execFileSync('git', ['log', '--format=%H', `${START}..HEAD`, '--', 'artifacts/intelligence-quality-v1-iq6-candidates.json'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
const firstSrc = execFileSync('git', ['log', '--reverse', '--format=%H', `${START}..HEAD`, '--', 'src'], {encoding: 'utf8'}).trim().split('\n')[0];
let frozenBeforeRuntime = false; try {execFileSync('git', ['merge-base', '--is-ancestor', freezeCommits[0], firstSrc]); frozenBeforeRuntime = freezeCommits.length === 1 && freezeCommits[0] !== firstSrc;} catch {}
const s = review.summary;
const src = execFileSync('git', ['diff', START, '--name-only', '--', 'src'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
const has = (suite, id) => suite.results.some(x => x.id === id && x.status === 'PASS');
const tr = conv6.transcripts, hasAll = (suite, ids) => ids.every(id => has(suite, id));
const gates = {
  reassessmentTestsAllPass: reassess.status === 'PASS' && reassess.results.length >= 23 && reassess.results.every(x => x.status === 'PASS'),
  conversationTestsAllPass: conv6.status === 'PASS' && conv6.results.length >= 6 && conv6.results.every(x => x.status === 'PASS') && conv6.executed === 0,
  iq5TestsStillPass: reference.status === 'PASS' && reference.tests >= 42 && conversation.status === 'PASS' && conversation.tests >= 10,
  iq4JudgmentTestsStillPass: judgment.status === 'PASS' && judgment.tests >= 57, plannerTestsStillPass: planner.status === 'PASS' && planner.tests >= 48,
  iq3aSourceTests: cert.status === 'PASS' && cert.tests >= 255, iq3aBenchmarkTests: bench.status === 'PASS' && bench.tests >= 129, iq3aLiveIsolation: iso.status === 'PASS',
  materialFactsAttachToTheCorrectTarget: hasAll(reassess, ['iq6:fact-attaches-to-the-named-project-not-to-rank-one', 'iq6:single-salient-project-binds-and-several-clarify']),
  correctionsSupersedeAndUnverifiedClaimsStayMarked: hasAll(reassess, ['iq6:correction-supersedes-the-old-fact-and-keeps-provenance', 'iq6:unverified-claim-is-never-presented-as-verified', 'iq6:every-fact-stays-user-supplied-and-unverified']),
  onlyAffectedJudgmentsBecomeStale: hasAll(reassess, ['iq6:non-material-hypothetical-and-opinion-do-not-invalidate', 'iq6:a-fact-about-an-unrelated-domain-does-not-invalidate-the-ranking', 'iq6:parked-artifact-is-not-touched-by-new-facts']),
  reassessmentReusesUnaffectedEvidence: has(reassess, 'iq6:planner-reuses-unaffected-classes-and-refreshes-only-affected') && tr['OMA-001_scripted_provider'] && conv6.results.some(x => x.id.startsWith('iq6c:OMA-001-scripted') && x.status === 'PASS'),
  newJudgmentReplacesCurrentWithoutDeletingHistory: hasAll(reassess, ['iq6:material-fact-changes-the-ranking-and-history-is-kept', 'iq6:old-ranking-is-historical-and-new-is-current-through-reference-resolution', 'iq6:history-is-bounded-to-one-prior-artifact']),
  failedReassessmentCannotCorruptPriorState: hasAll(reassess, ['iq6:failed-reassessment-never-corrupts-the-previous-state', 'iq6:authority-revoked-drops-the-artifact-and-exposes-nothing']),
  noAuthorityOrPrivacyWidening: hasAll(reassess, ['iq6:reassessment-record-is-structural-only', 'iq6:reassessment-modules-add-no-tool-or-write-path', 'iq6:provider-request-labels-the-claim-as-unverified-and-redacts-it']) && has(conv6, 'iq6c:no-reassessment-turn-executes-anything-or-leaks-fact-text-into-traces'),
  oma001ProviderOffHonest: has(conv6, 'iq6c:OMA-001-provider-off-claim-recorded-no-ordering-to-change-nothing-fabricated') && tr['OMA-001_provider_off'].every(t => t.artifact_type !== 'ranking'),
  oma001ScriptedProviderReassessmentEndToEnd: has(conv6, 'iq6c:OMA-001-scripted-provider-claim-attaches-marks-stale-then-reassesses-only-affected-evidence'),
  osaFacilityConsumer: hasAll(conv6, ['iq6c:osa-corrections-update-the-public-assessment-without-internal-evidence-or-promises', 'iq6c:facility-claim-alone-changes-nothing-but-a-changed-record-changes-the-judgment', 'iq6c:consumer-state-change-and-correction-never-declare-safety']),
  noReassessmentAuditFailures: review.audit.ok,
  noPassRegressed: review.summary.status_after.PASS >= review.summary.status_before.PASS && review.summary.preserved_pass_turns.every(p => p.has_check && p.check_holds),
  statusAccounting: review.summary.status_after.PASS + review.summary.status_after.FAIL + review.summary.status_after.BLOCKED === 280 && review.summary.status_after.BLOCKED === 5 && review.summary.status_after.PASS === 66 + review.summary.promoted.length,
  persistedAndTraced280: iqRaw.records.every(x => x.response.persistence_saved && x.trace?.trace_id),
  wave11: JSON.stringify(tally(wave.records, x => x.status)) === JSON.stringify({PASS: 131, FAIL: 1}),
  iq1Adversarial: safety.execution_attempts === 0 && safety.results.every(x => x.status === 'PASS'),
  iq2Objective: objective.status === 'PASS',
  regressionMatrix: JSON.stringify(tally(regressions, x => x.status)) === JSON.stringify({PASS: 19, FAIL: 4}) && controls.length === 4,
  frozenAndPriorCertificationsUntouched: frozenChanged === '',
  candidateSetFrozenOnceBeforeRuntimeChanges: frozenBeforeRuntime,
  performanceMeasured: perf.status === 'MEASURED' && perf.pure_fact_attachment_ms.p95 < 5,
};
const result = {
  version: 1, starting_head: START, status: Object.values(gates).every(Boolean) ? 'IQ-6 MATERIAL REASSESSMENT CERTIFIED — INITIATIVE APPROVAL REQUIRED' : 'IQ-6 NOT YET CERTIFIED', gates,
  reassessment_tests: {total: reassess.results.length, counts: reassess.counts}, conversation_tests: {total: conv6.results.length, counts: conv6.counts, executed: conv6.executed}, iq5_tests: {reference, conversation}, iq4_judgment_tests: judgment, planner_tests: planner,
  iq3a_regression: {source_tests: cert.tests, benchmark_tests: bench.tests, isolation: iso.status}, audit: review.audit, summary: review.summary, candidates: review.candidates, transcripts: conv6.transcripts, performance: perf,
  provider: {configured_in_corpus: false, note: 'No provider key or model is configured in the benchmark environment; the OMA-001 scripted-provider mode uses a scripted claim-aware provider seam and proves reassessment mechanics and discipline only. Live-model ranking quality is unmeasured.'},
  validation: {wave11: tally(wave.records, x => x.status), safety: {execution_attempts: safety.execution_attempts, results: tally(safety.results, x => x.status)}, objective: {status: objective.status}, regressions: {counts: tally(regressions, x => x.status), preexisting_controls: controls}},
  source_files_changed: src, source_hashes: Object.fromEntries(src.filter(f => fs.existsSync(f)).map(f => [f, hash(f)])),
  raw_hashes: Object.fromEntries(['iq', 'wave11', 'safety', 'objective', 'regressions'].map(n => [`${prefix}-${n}.json`, hash(`${prefix}-${n}.json`)])),
};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq6-certification.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({status: result.status, gates, src: src.length}, null, 1));
