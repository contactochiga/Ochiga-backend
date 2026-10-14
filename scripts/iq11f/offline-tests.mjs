import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync, execFileSync} from 'node:child_process';
import {ROOT, hash, candidateSchema} from '../iq11e/contract.mjs';
import {sourceManifest} from '../iq11e/harness.mjs';
import {packet, candidate} from '../iq11e/fixtures.mjs';
import {plan, prompt, wireSchema, describeRequest, estimateBudget, inspectRecordedCandidate, preparationBlockers} from './prepare.mjs';
import {inspectAccess} from './access-check.mjs';

globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
const checks = [];
const test = (id, fn) => { try { fn(); checks.push({id, status: 'PASS'}); } catch (e) { checks.push({id, status: 'FAIL', error: e.message}); } };
const before = hash(sourceManifest());
test('snapshot-identifiers-not-aliases', () => assert.deepEqual(plan.models.map(m => m.id), ['gpt-5.4-mini-2026-03-17', 'gpt-5.4-2026-03-05']));
test('approval-is-provider-only', () => { assert(plan.provider_choice_approved); assert.equal(plan.paid_inference_enabled, false); assert.equal(plan.budget.currently_authorized_spend, 0); assert.equal(plan.budget.approval_reference, null); assert.equal(plan.data_processing_proposal.policy_approval_reference, null); });
test('exact-both-arm-budget', () => { const e = estimateBudget(); assert.equal(e.total_usd, 27.9552); assert.equal(e.arms[0].total_micro_usd, 6451200); assert.equal(e.arms[1].total_micro_usd, 21504000); assert.equal(e.spend_authorized, false); });
test('budget-overrun-not-approved', () => assert.equal(estimateBudget(2000).within_proposed_budget, false));
test('invalid-budget-counts-rejected', () => { for (const n of [-1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => estimateBudget(n)); });
test('frozen-token-deadline-concurrency-limits', () => { assert.equal(plan.limits.total_input_tokens, 4096); assert.equal(plan.limits.max_output_tokens, 1024); assert.equal(plan.limits.deadline_ms, 3000); assert.equal(plan.limits.p95_latency_ms, 1500); assert.equal(plan.limits.concurrency, 1); assert.equal(plan.limits.automatic_retries, 0); });
test('paired-inputs-and-schema-identical', () => { const p = packet(), a = describeRequest(p, plan.models[0].id), b = describeRequest(p, plan.models[1].id); a.body.model = b.body.model; assert.deepEqual(a, b); assert.equal(a.sendable, false); assert.equal(a.body.store, false); assert.equal(a.body.background, false); assert.equal(a.body.reasoning.effort, 'none'); assert.deepEqual(a.body.tools, []); assert(!('previous_response_id' in a.body)); });
test('moving-alias-rejected', () => assert.throws(() => describeRequest(packet(), 'gpt-5.4'), /model_identity/));
test('non-synthetic-rejected', () => { const p = packet(); p.data_class = 'production'; assert.throws(() => describeRequest(p, plan.models[0].id)); });
test('cross-scope-rejected', () => { const p = packet(); p.entities[0].scope_token = 'other-home'; assert.throws(() => describeRequest(p, plan.models[0].id)); });
test('osa-private-context-rejected', () => { const p = packet(); p.surface = 'public_corporate'; p.entities[0].surface = 'public_corporate'; assert.throws(() => describeRequest(p, plan.models[0].id)); });
test('credentials-in-packet-rejected', () => { const p = packet(); p.utterance = 'password=synthetic-only'; assert.throws(() => describeRequest(p, plan.models[0].id)); });
test('schema-source-unchanged', () => { const before = hash(candidateSchema); wireSchema(); assert.equal(hash(candidateSchema), before); assert.deepEqual(candidateSchema, JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/intelligence-quality-v1-iq11e-candidate.schema.json'), 'utf8'))); });
test('wire-closed-and-typed-with-identical-fields', () => {
  const visit = (s, w) => { if (s.enum) assert.deepEqual(w.enum, s.enum); if (s.const !== undefined) assert.deepEqual(w.enum, [s.const]); if (s.properties) { assert.equal(w.additionalProperties, false); assert.deepEqual(w.required, s.required); assert.deepEqual(Object.keys(w.properties), Object.keys(s.properties)); for (const k of Object.keys(s.properties)) visit(s.properties[k], w.properties[k]); } if (s.items) visit(s.items, w.items); if (s.anyOf) s.anyOf.forEach((x, i) => visit(x, w.anyOf[i])); if (w.enum) assert(w.type); assert(!('uniqueItems' in w)); };
  visit(candidateSchema, wireSchema());
});
test('unknown-schema-keyword-fails-closed', () => assert.throws(() => wireSchema({unreviewed: true})));
test('local-validator-retains-wire-omitted-bounds', () => { const c = candidate(); c.request_id = 'a'.repeat(81); assert.equal(inspectRecordedCandidate(c, packet()).valid, false); });
test('local-validator-retains-uniqueness', () => { const c = candidate(); c.bindings.push({...c.bindings[0]}); assert.equal(inspectRecordedCandidate(c, packet()).valid, false); });
test('safety-locks-unchanged', () => { const p = packet(), c = candidate(p); c.frame.operation = 'device.power.off'; c.frame.mutationIntent = true; c.frame.cognitiveObjective = null; c.frame.answerTarget.response_intent = 'CONFIRMATION_STATE'; c.frame.answerTarget.confirmation_kind = 'action'; assert(inspectRecordedCandidate(c, p).valid); for (const flag of ['hazard', 'cancelled', 'denied']) assert(!inspectRecordedCandidate(c, p, {[flag]: true}).valid); });
test('candidate-never-adopted', () => { const r = inspectRecordedCandidate(candidate(), packet()); assert(r.valid); assert.equal(r.adopted, false); assert.equal(r.runtime_adoption, false); });
test('access-report-contains-no-value', () => { const secret = 'synthetic-credential-marker'; const r = inspectAccess({OPENAI_API_KEY: secret, OPENAI_PROJECT_ID: 'synthetic-project'}, []); assert(!JSON.stringify(r).includes(secret)); assert(!JSON.stringify(r).includes('synthetic-project')); assert.equal(r.credential_status, 'PRESENT_NOT_AUTHENTICATED'); assert.equal(r.billing_status, 'NOT_VERIFIED'); assert.equal(r.authenticated_api_requests, 0); });
test('absent-credentials-not-valid', () => { const r = inspectAccess({}, ['.env.example']); assert.equal(r.credential_status, 'UNAVAILABLE_IN_CHECKED_SCOPE'); assert.equal(r.local_credential_file_present, false); });
test('all-live-blockers-remain', () => { assert(preparationBlockers().includes('PAID_INFERENCE_DISABLED')); assert(preparationBlockers().includes('DATA_PROCESSING_APPROVAL_REQUIRED')); assert(preparationBlockers().includes('SPEND_APPROVAL_REQUIRED')); });
test('no-transport-or-runtime-import-added', () => { for (const name of ['prepare.mjs', 'access-check.mjs']) { const text = fs.readFileSync(path.join(ROOT, 'scripts/iq11f', name), 'utf8'); assert(!/fetch\s*\(|node:https|node:http|from ['"]openai|ConversationOrchestrator/.test(text)); } });

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq11f-offline-'));
let inherited;
test('full-iq11e-regression-without-overwriting-evidence', () => {
  const files = ['candidate.schema', 'packet.schema', 'offline-results'].map(s => path.join(ROOT, `artifacts/intelligence-quality-v1-iq11e-${s}.json`));
  const old = files.map(p => hash(fs.readFileSync(p, 'utf8')));
  const code = `import fs from 'node:fs';import path from 'node:path';const files=${JSON.stringify(files)},temp=${JSON.stringify(temp)};const write=fs.writeFileSync;fs.writeFileSync=(p,...args)=>write(files.includes(String(p))?path.join(temp,path.basename(String(p))):p,...args);await import('./scripts/iq11e/offline-tests.mjs');`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {cwd: ROOT, encoding: 'utf8', timeout: 60000});
  assert.equal(run.status, 0, run.stderr); inherited = JSON.parse(run.stdout.trim()); assert.equal(inherited.pass, 91); assert.equal(inherited.fail, 0);
  assert.deepEqual(files.map(p => hash(fs.readFileSync(p, 'utf8'))), old);
});
test('runtime-fingerprint-unchanged', () => assert.equal(hash(sourceManifest()), before));
const artifact = n => path.join(ROOT, `artifacts/intelligence-quality-v1-iq11f-${n}.json`);
const access = inspectAccess();
fs.writeFileSync(artifact('access-check'), JSON.stringify(access, null, 2) + '\n');
fs.writeFileSync(artifact('wire.schema'), JSON.stringify(wireSchema(), null, 2) + '\n');
const hashedFiles = [
  'docs/INTELLIGENCE_QUALITY_V1_IQ11F_PREPARATION.md', 'artifacts/intelligence-quality-v1-iq11f-plan.json',
  'artifacts/intelligence-quality-v1-iq11f-wire.schema.json', 'artifacts/intelligence-quality-v1-iq11e-candidate.schema.json',
  'artifacts/intelligence-quality-v1-iq11e-packet.schema.json', 'docs/INTELLIGENCE_QUALITY_V1_IQ11E_PROTOCOL.md',
  'scripts/iq11f/prepare.mjs', 'scripts/iq11f/access-check.mjs', 'scripts/iq11f/offline-tests.mjs'
];
const report = {
  programme: 'IQ-11F preparation', head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  pass: checks.filter(x => x.status === 'PASS').length, fail: checks.filter(x => x.status === 'FAIL').length, checks,
  inherited_iq11e: inherited, budget_estimate: estimateBudget(), source_manifest: sourceManifest(),
  preparation_hashes: hashedFiles.map(p => ({path: p, sha256: hash(fs.readFileSync(path.join(ROOT, p), 'utf8'))})),
  prompt_sha256: hash(prompt), provider_calls: 0, paid_inference_calls: 0, actual_inference_cost_usd: 0,
  independent_corpus_authored: false, runtime_adoption: false, durable_trace_tested: false,
  model_comparison_results: 'NOT_RUN_PENDING_APPROVAL_AND_ACCESS', blockers: preparationBlockers()
};
fs.writeFileSync(artifact('offline-results'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({pass: report.pass, fail: report.fail, inherited, estimate: report.budget_estimate.total_usd, failures: checks.filter(x => x.status === 'FAIL')}));
process.exitCode = report.fail ? 1 : 0;
