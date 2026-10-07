// IQ-5 certification record. Pure assembly: reads test/review/validation artifacts and run outputs, enforces every gate, writes
// artifacts/intelligence-quality-v1-iq5-certification.json. It executes nothing itself.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const [prefix = '/tmp/iq5-v3'] = process.argv.slice(2); const r = prefix;
const START = 'cfd7074f84b7b0e35dd5d6b4c40fb50de7662c91';
const tally = (rs, f) => rs.reduce((a, x) => (a[f(x)] = (a[f(x)] || 0) + 1, a), {});
const last = p => JSON.parse(fs.readFileSync(p, 'utf8').split('\n').filter(l => /^\{"status":/.test(l)).pop());

const reference = read('artifacts/intelligence-quality-v1-iq5-reference-tests.json'), conversation = read('artifacts/intelligence-quality-v1-iq5-conversation-tests.json'), review = read('artifacts/intelligence-quality-v1-iq5-results.json'), perf = read('artifacts/intelligence-quality-v1-iq5-performance.json');
const judgment = last(`${r}-judgment.stdout`), planner = last(`${r}-planner.stdout`);
const cert = last(`${r}-cert.stdout`), bench = last(`${r}-bench.stdout`), iso = read(`${r}-iso.json`);
const wave = read(`${prefix}-wave11.json`), safety = read(`${prefix}-safety.json`), objective = read(`${prefix}-objective.json`), regressions = read(`${prefix}-regressions.json`), iqRaw = read(`${prefix}-iq.json`);
const iq1 = read('artifacts/intelligence-quality-v1-iq1-results.json').preexisting_controls;
const normalize = s => s.slice(s.indexOf('AssertionError')).replace(/file:\/\/[^\s]+\/scripts\//g, 'file://REPO/scripts/').trim();
const controls = [];
for (const suite of ['oyi-workflow-action-phase-c-reload-smoke', 'oyi-workflow-action-phase-c-multigang-smoke', 'oyi-workflow-action-phase-c-correction-smoke', 'oyi-workflow-durable-continuation-smoke']) {
  const x = regressions.find(y => y.suite === suite); assert.equal(x.status, 'FAIL'); const stored = iq1[suite];
  assert.equal(normalize(fs.readFileSync(x.stderr, 'utf8')).split('\n').slice(0, 5).join('\n'), stored.assertion.trim().split('\n').slice(0, 5).join('\n'), `${suite} differs from the stored pre-IQ1 control`); controls.push({suite, identical_control: true, control_head: stored.control_head});
}
const frozenChanged = execFileSync('git', ['diff', START, '--name-only', '--', 'artifacts/intelligence-quality-v1-iq4-candidates.json', 'artifacts/intelligence-quality-v1-iq4-results.json', 'artifacts/intelligence-quality-v1-iq4-certification.json', 'artifacts/intelligence-quality-v1-iq4-performance.json', 'artifacts/intelligence-quality-v1-iq4-judgment-tests.json', 'artifacts/intelligence-quality-v1-baseline.json', 'artifacts/intelligence-quality-v1-failure-map.json', 'artifacts/intelligence-quality-v1-iq1-results.json', 'artifacts/intelligence-quality-v1-iq2c-results.json', 'artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json', 'artifacts/intelligence-quality-v1-iq3a-blocker-graph.json', 'artifacts/intelligence-quality-v1-iq3b-results.json', 'artifacts/intelligence-quality-v1-iq3b-certification.json', 'artifacts/intelligence-quality-v1-evidence-certification.json', 'artifacts/intelligence-quality-v1-evidence-source-inventory.json', 'scripts/intelligence-quality-v1-corpus.mjs'], {encoding: 'utf8'}).trim();
// The candidate set must have been frozen exactly once, BEFORE the first runtime (src) change of this slice.
const freezeCommits = execFileSync('git', ['log', '--format=%H', `${START}..HEAD`, '--', 'artifacts/intelligence-quality-v1-iq5-candidates.json'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
const firstSrc = execFileSync('git', ['log', '--reverse', '--format=%H', `${START}..HEAD`, '--', 'src'], {encoding: 'utf8'}).trim().split('\n')[0];
let frozenBeforeRuntime = false; try {execFileSync('git', ['merge-base', '--is-ancestor', freezeCommits[0], firstSrc]); frozenBeforeRuntime = freezeCommits.length === 1 && freezeCommits[0] !== firstSrc;} catch {}
const s = review.summary;
const src = execFileSync('git', ['diff', START, '--name-only', '--', 'src'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
const has = (suite, id) => suite.results.some(x => x.id === id && x.status === 'PASS');
const tr = conversation.transcripts;
const gates = {
  referenceTestsAllPass: reference.status === 'PASS' && reference.results.length >= 42 && reference.results.every(x => x.status === 'PASS'),
  conversationTestsAllPass: conversation.status === 'PASS' && conversation.results.length >= 10 && conversation.results.every(x => x.status === 'PASS') && conversation.executed === 0,
  iq4JudgmentTestsStillPass: judgment.status === 'PASS' && judgment.tests >= 57, plannerTestsStillPass: planner.status === 'PASS' && planner.tests >= 48,
  iq3aSourceTests: cert.status === 'PASS' && cert.tests >= 255, iq3aBenchmarkTests: bench.status === 'PASS' && bench.tests >= 129, iq3aLiveIsolation: iso.status === 'PASS',
  derivedReferencesAreCanonicalAndCoverAllThreeArtifactTypes: ['iq5:ranking-artifact-is-typed-ordered-and-has-no-raw-result-set', 'iq5:comparison-artifact-is-a-distinct-unordered-pair-not-a-ranking', 'iq5:assessment-set-artifact-records-what-was-named-in-order-named'].every(id => has(reference, id)),
  noStaleRawResultSetStealsAnAssessmentReference: ['iq5:newer-raw-set-owns-a-bare-ordinal', 'iq5:ranking-then-older-raw-set-the-ranking-owns-the-bare-ordinal', 'iq5:second-priority-is-the-ranking-but-second-lead-is-the-lead-list', 'iq5c:explicit-priority-wording-wins-the-ranking-back-over-a-newer-raw-list'].every(id => has(reference, id) || has(conversation, id)),
  rawResultContinuityIntact: has(conversation, 'iq5c:raw-result-set-ordinals-still-use-the-result-set') && has(conversation, 'iq5c:raw-list-presented-after-a-ranking-owns-a-bare-ordinal'),
  staleExpiredScopeAuthorityDoNotLeak: ['iq5:expired-artifact-is-never-silently-used-and-is-dropped', 'iq5:scope-changed-artifact-is-not-reused-across-scope', 'iq5:authority-revoked-artifact-does-not-expose-its-items', 'iq5:cross-surface-artifact-is-not-used', 'iq5:material-fact-marks-stale-keeps-history-and-refuses-current'].every(id => has(reference, id)) && has(conversation, 'iq5c:artifact-is-not-readable-from-another-actor-or-surface-on-the-same-thread'),
  noReferenceResolutionWidensAuthorityOrCallsAProvider: has(reference, 'iq5:reference-resolution-imports-no-provider-database-or-network') && has(conversation, 'iq5c:no-reference-turn-calls-the-provider'),
  oma001ProviderOffNoOrderingClaimed: has(conversation, 'iq5c:OMA-001-provider-off-no-ranking-so-no-ordering-is-claimed-or-explained') && tr['OMA-001_provider_off'].every(t => t.artifact_type !== 'ranking'),
  oma001ScriptedProviderResolvesPriorityTwo: has(conversation, 'iq5c:OMA-001-scripted-provider-T3-resolves-priority-two-not-lead-row-two') && tr['OMA-001_scripted_provider'][1].assessment_status === 'derived_reference' && /number 2/.test(tr['OMA-001_scripted_provider'][1].answer) && tr['OMA-001_scripted_provider'][2].stale,
  noDerivedReferenceAuditFailures: review.audit.ok && review.audit.derived_reference_turns >= 1,
  noPassRegressed: review.summary.status_after.PASS >= review.summary.status_before.PASS && review.summary.answers_changed_ids.every(x => x.previous_status !== 'PASS'),
  statusAccounting: review.summary.status_after.PASS + review.summary.status_after.FAIL + review.summary.status_after.BLOCKED === 280 && review.summary.status_after.BLOCKED === 5 && review.summary.status_after.PASS === 65 + review.summary.promoted.length,
  persistedAndTraced280: iqRaw.records.every(x => x.response.persistence_saved && x.trace?.trace_id),
  wave11: JSON.stringify(tally(wave.records, x => x.status)) === JSON.stringify({PASS: 131, FAIL: 1}),
  iq1Adversarial: safety.execution_attempts === 0 && safety.results.every(x => x.status === 'PASS'),
  iq2Objective: objective.status === 'PASS',
  regressionMatrix: JSON.stringify(tally(regressions, x => x.status)) === JSON.stringify({PASS: 19, FAIL: 4}) && controls.length === 4,
  frozenAndPriorCertificationsUntouched: frozenChanged === '',
  candidateSetFrozenOnceBeforeRuntimeChanges: frozenBeforeRuntime,
  performanceMeasured: perf.status === 'MEASURED' && perf.pure_resolution.every(d => d.resolution_ms.p95 < 5),
};
const result = {
  version: 1, starting_head: START, status: Object.values(gates).every(Boolean) ? 'IQ-5 DERIVED REFERENCE CONTINUITY CERTIFIED — REASSESSMENT APPROVAL REQUIRED' : 'IQ-5 NOT YET CERTIFIED', gates,
  reference_tests: {total: reference.results.length, counts: reference.counts}, conversation_tests: {total: conversation.results.length, counts: conversation.counts, executed: conversation.executed}, iq4_judgment_tests: judgment, planner_tests: planner,
  iq3a_regression: {source_tests: cert.tests, benchmark_tests: bench.tests, isolation: iso.status}, audit: review.audit, summary: review.summary, candidates: review.candidates, transcripts: conversation.transcripts, performance: perf,
  provider: {configured_in_corpus: false, note: 'No provider key or model is configured in the benchmark environment; the OMA-001 scripted-provider mode uses a scripted test seam and proves reference handling and discipline only. Live-model ranking quality is unmeasured.'},
  validation: {wave11: tally(wave.records, x => x.status), safety: {execution_attempts: safety.execution_attempts, results: tally(safety.results, x => x.status)}, objective: {status: objective.status}, regressions: {counts: tally(regressions, x => x.status), preexisting_controls: controls}},
  source_files_changed: src, source_hashes: Object.fromEntries(src.filter(f => fs.existsSync(f)).map(f => [f, hash(f)])),
  raw_hashes: Object.fromEntries(['iq', 'wave11', 'safety', 'objective', 'regressions'].map(n => [`${prefix}-${n}.json`, hash(`${prefix}-${n}.json`)])),
};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq5-certification.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({status: result.status, gates, src: src.length}, null, 1));
