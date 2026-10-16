import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ROOT, hash} from '../iq11e/contract.mjs';
import {candidate} from '../iq11e/fixtures.mjs';
import {GEMINI_COMPATIBILITY as binding} from './gemini-compatibility-policy.mjs';
import {GEMINI_SHADOW as policy, prepareGeminiShadow, geminiCompatibilityBlockers,
  geminiShadowBlockers, runGeminiShadow, runGeminiCompatibility, reconcileGeminiCompatibility} from './gemini-shadow.mjs';
import {sealPreparedCanary, preparedDispatchBlockers, dispatchPreparedCanary} from './gemini-approval-workflow.mjs';

// Mock-only. Never read environment credentials, call a provider, or write a real
// experiment receipt. Redirect the fixed ledger at the filesystem boundary ONLY
// inside this test process; production callers cannot choose another ledger.
globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/intelligence-quality-v1-iq11f-gemini-compatibility-canary.json'), 'utf8'));
const packet = () => structuredClone(manifest.packet);
const key = 'mock-compatibility-credential';
const fixedRoot = path.join(ROOT, 'artifacts/iq11f-gemini-compatibility-receipts');
assert(!fs.existsSync(fixedRoot), 'Do not run with a real compatibility ledger present');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq11f-compatibility-'));
let directory, index = 0, now = Date.parse(manifest.packet.now) + 1000;
const originalNow = Date.now;
Date.now = () => now;
const originals = {};
const redirect = p => typeof p === 'string' && (p === fixedRoot || p.startsWith(fixedRoot + path.sep)) ? directory + p.slice(fixedRoot.length) : p;
for (const name of ['mkdirSync', 'openSync', 'readFileSync', 'statSync', 'lstatSync']) {
  originals[name] = fs[name]; fs[name] = (p, ...args) => originals[name](redirect(p), ...args);
}
const checks = [];
const test = async (id, fn) => {
  directory = path.join(temp, String(++index)); now = Date.parse(manifest.packet.now) + 1000;
  try { await fn(); checks.push({id, status: 'PASS'}); }
  catch (e) { checks.push({id, status: 'FAIL', error: e.message}); }
};
const approval = () => ({
  live_canary_approved: false, compatibility_canary_approved: true, ...binding,
  owner_approval_evidence_hash: hash('MOCK human approval'), provider: 'gemini',
  project: policy.project, model: policy.model, response_version: policy.responseVersion,
  credential_sha256: hash(key), ownership_verified: true, ownership_evidence_hash: hash('MOCK ownership'),
  tier: 'FREE', billing_enabled: false, free_quota_verified: true, billing_quota_evidence_hash: hash('MOCK current billing'),
  input_usd_per_token: 0, output_usd_per_token: 0, authorized_usd: 0,
  synthetic_reviewed: true, data_processing_approved: true, verified_at_ms: now - 10, expires_at_ms: now + 60000,
  input_accounting: {body_hash: binding.body_hash, model: policy.model, full_request_verified: false, upper_bound: null, qualification_gate: 4096},
  accept_unverified_input_for_compatibility: true, counts_toward_certification: false,
  accept_google_free_tier_processing: true, accept_external_billing_enforcement: true, accept_remote_completion_uncertainty: true,
  max_inference_requests: 1, output_tokens: 1024, deadline_ms: 3000, allow_tools: false, allow_fallback: false, allow_retries: false,
});
const validCandidate = p => {
  const c = candidate(p); c.bindings[0].entity_token = p.entities[0].token;
  c.frame.answerTarget.requested_fields = ['power_state']; return c;
};
const body = (p = packet()) => ({modelVersion: policy.responseVersion,
  candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(validCandidate(p))}]}}],
  usageMetadata: {promptTokenCount: 496, candidatesTokenCount: 100, thoughtsTokenCount: 10, totalTokenCount: 606}});
const response = b => new Response(JSON.stringify(b));
const input = () => ({packet: packet(), baseline: {decision: 'deterministic'}, apiKey: key, approval: approval(), locks: {}});
async function run({value = input(), raw = body(), fetch: custom} = {}) {
  let calls = 0;
  const out = await runGeminiCompatibility(value, {fetchImpl: async (...args) => { calls++; return custom ? custom(...args) : response(raw); }});
  return {out, calls};
}
const journalPath = () => path.join(directory, 'gemini-canary.jsonl');

await test('manifest-is-exact-synthetic-unapproved-packet', () => {
  const d = prepareGeminiShadow(packet());
  for (const k of ['packet_hash', 'body_hash', 'schema_hash']) assert.equal(d[k], binding[k]);
  assert.equal(manifest.final_owner_approval, null); assert.equal(manifest.live_dispatch_enabled, false);
  assert.equal(manifest.qualification_gate, 4096); assert.equal(manifest.input_accounting_verified, false);
  assert.equal(manifest.packet.data_class, 'synthetic'); assert.equal(manifest.packet.surface, 'consumer');
});
await test('no-owner-approval-no-dispatch', async () => {
  const v = input(); v.approval = null; const r = await run({value: v});
  assert.equal(r.out.status, 'blocked'); assert.equal(r.calls, 0); assert(!fs.existsSync(directory));
});
await test('current-development-project-is-explicit', () => {
  assert.equal(policy.project, 'gen-lang-client-0414833380');
  assert.equal(policy.model, 'gemini-3.1-flash-lite');
  assert.equal(policy.authorizedUsd, 0);
});
await test('historical-project-approval-cannot-transfer', async () => {
  const v = input(); v.approval.project = 'gen-lang-client-0748205572';
  const r = await run({value: v}); assert.equal(r.out.status, 'blocked');
  assert(r.out.blockers.includes('recipient_or_model_mismatch')); assert.equal(r.calls, 0);
});
await test('verified-project-is-not-final-canary-approval', async () => {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/intelligence-quality-v1-iq11f-gemini-development-approval.json'), 'utf8'));
  assert.equal(a.project, policy.project); assert.equal(a.ownership_verified, true);
  assert.equal(a.credential_sha256, null); assert.equal(a.body_hash, null);
  assert.equal(a.compatibility_canary_approved, false); assert.equal(a.live_canary_approved, false);
  const v = input(); v.approval = a; const r = await run({value: v});
  assert.equal(r.out.status, 'blocked'); assert.equal(r.calls, 0); assert(!fs.existsSync(directory));
});
await test('default-and-explicit-ambient-fetch-blocked', async () => {
  for (const options of [undefined, {fetchImpl: globalThis.fetch}]) {
    const r = await runGeminiCompatibility(input(), options); assert.equal(r.status, 'blocked'); assert(r.blockers.includes('live_dispatch_not_enabled'));
  }
});
await test('no-custom-ledger-no-callback-no-mode-override', async () => {
  let called = false;
  for (const options of [{receiptDirectory: path.join(temp, 'escape')}, {onExecute: () => called = true}, {mode: 'ordinary'}]) {
    const r = await runGeminiCompatibility(input(), options); assert.equal(r.status, 'blocked');
  }
  const r = await runGeminiCompatibility({...input(), onExecute: () => called = true});
  assert.equal(r.status, 'blocked'); assert.equal(called, false); assert(!fs.existsSync(directory));
});
await test('malformed-call-options-fail-closed', async () => {
  for (const [value, options] of [[null, {}], [[], {}], [input(), null], [input(), []]]) {
    assert.equal((await runGeminiCompatibility(value, options)).status, 'blocked');
  }
  assert(!fs.existsSync(directory));
});
for (const [id, mutate] of [
  ['approval-id', a => a.approval_id += '-another'], ['experiment-id', a => a.experiment_id += '-another'],
  ['exception-type', a => a.exception_type = 'generic'], ['approval-evidence', a => a.owner_approval_evidence_hash = null],
  ['ordinary-approval', a => a.live_canary_approved = true], ['exception-not-approved', a => a.compatibility_canary_approved = false],
  ['project', a => a.project = 'other'], ['model', a => a.model = 'latest'], ['response-version', a => a.response_version = 'other'],
  ['credential-binding', a => a.credential_sha256 = hash('other')], ['ownership', a => a.ownership_verified = false],
  ['billing-enabled', a => a.billing_enabled = true], ['paid-tier', a => a.tier = 'PAID'],
  ['nonzero-price', a => a.input_usd_per_token = 0.01], ['quota-unverified', a => a.free_quota_verified = false],
  ['nonzero-budget', a => a.authorized_usd = 1], ['billing-evidence', a => a.billing_quota_evidence_hash = null],
  ['data-processing', a => a.data_processing_approved = false], ['synthetic-review', a => a.synthetic_reviewed = false],
  ['unpaid-processing', a => a.accept_google_free_tier_processing = false], ['external-billing-risk', a => a.accept_external_billing_enforcement = false],
  ['remote-completion-risk', a => a.accept_remote_completion_uncertainty = false],
  ['packet-hash', a => a.packet_hash = hash('other')], ['body-hash', a => a.body_hash = hash('other')], ['schema-hash', a => a.schema_hash = hash('other')],
  ['expired', a => a.expires_at_ms = now - 1], ['future-approval', a => a.verified_at_ms = now + 1],
  ['over-five-minutes', a => a.expires_at_ms = a.verified_at_ms + 300001],
  ['verified-input-claim', a => a.input_accounting.full_request_verified = true], ['496-as-proof', a => a.input_accounting.upper_bound = 496],
  ['raised-gate', a => a.input_accounting.qualification_gate = 8192], ['missing-accounting', a => a.input_accounting = null],
  ['no-exception-acceptance', a => a.accept_unverified_input_for_compatibility = false], ['certification-credit', a => a.counts_toward_certification = true],
  ['two-requests', a => a.max_inference_requests = 2], ['retries', a => a.allow_retries = true],
  ['tools', a => a.allow_tools = true], ['fallback', a => a.allow_fallback = true],
  ['larger-output', a => a.output_tokens = 1025], ['longer-deadline', a => a.deadline_ms = 3001],
]) await test(`blocks-${id}`, async () => {
  const v = input(); mutate(v.approval); const r = await run({value: v}); assert.equal(r.out.status, 'blocked'); assert.equal(r.calls, 0);
});
await test('ordinary-qualification-still-requires-real-token-proof', async () => {
  const v = input(); v.approval.live_canary_approved = true; v.approval.compatibility_canary_approved = false;
  const blockers = geminiShadowBlockers(prepareGeminiShadow(v.packet), key, v.approval);
  assert(blockers.includes('input_accounting_unverified')); let calls = 0;
  const r = await runGeminiShadow(v, {fetchImpl: async () => { calls++; return response(body()); }});
  assert.equal(r.status, 'blocked'); assert.equal(calls, 0);
});
await test('new-business-text-cannot-be-approved-through-new-hashes', async () => {
  const v = input(); v.packet.utterance = 'Synthetic label disguising unrelated business information';
  Object.assign(v.approval, prepareGeminiShadow(v.packet));
  const r = await run({value: v}); assert.equal(r.out.status, 'blocked'); assert.equal(r.calls, 0);
});
await test('private-or-cross-scope-input-rejected', async () => {
  for (const change of [p => p.data_class = 'production', p => p.entities[0].scope_token = 'other-home']) {
    const v = input(); change(v.packet); const r = await run({value: v}); assert.equal(r.out.status, 'invalid_input'); assert.equal(r.calls, 0);
  }
});
await test('pinned-context-expiry-not-waived', async () => {
  now = Date.parse(manifest.packet.now) + 300001;
  const r = await run(); assert.equal(r.out.status, 'blocked'); assert(r.out.blockers.includes('context_expired')); assert.equal(r.calls, 0);
});
await test('compatibility-is-never-intelligence-or-token-certification', async () => {
  const r = await run(); assert.equal(r.out.status, 'compatible_unqualified'); assert.equal(r.calls, 1);
  for (const value of [r.out, r.out.receipt]) { assert.equal(value.counts_toward_certification, false); assert.equal(value.input_accounting_verified, false); assert.equal(value.qualification_gate, 4096); }
  assert.equal(r.out.shadow_candidate, null); assert.equal(r.out.adopted, false); assert.equal(r.out.canonical_decision_changed, false);
  assert.equal(r.out.receipt.usage.input_total, 496); assert.equal(r.out.receipt.usage.output_total, 110);
  const reconciled = reconcileGeminiCompatibility(); assert.equal(reconciled.compatibility_observed, true); assert.equal(reconciled.successful_shadow, false);
  const raw = fs.readFileSync(journalPath(), 'utf8');
  for (const forbidden of [key, manifest.packet.utterance, manifest.packet.entities[0].alias, 'credential_sha256', 'owner_approval_evidence_hash']) assert(!raw.includes(forbidden));
  assert.equal(fs.statSync(journalPath()).mode & 0o777, 0o600);
});
await test('wire-request-unchanged-and-bounded', async () => {
  const r = await run({fetch: async (url, init) => {
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${policy.model}:generateContent`);
    assert.equal(hash(init.body), binding.body_hash); assert.equal(init.redirect, 'error'); assert(!url.includes(key));
    assert.equal(init.headers['x-goog-api-key'], key);
    const b = JSON.parse(init.body); assert.equal(b.generationConfig.maxOutputTokens, 1024); assert.equal(b.generationConfig.candidateCount, 1);
    assert.equal(hash(b.generationConfig.responseJsonSchema), binding.schema_hash); assert(!b.tools); assert(!b.cachedContent);
    return response(body());
  }}); assert.equal(r.out.status, 'compatible_unqualified');
});
for (const [id, change, expected] of [
  ['wrong-version', b => b.modelVersion = 'different', 'invalid_response'],
  ['missing-usage', b => delete b.usageMetadata, 'accounting_uncertain'],
  ['missing-thinking', b => delete b.usageMetadata.thoughtsTokenCount, 'accounting_uncertain'],
  ['negative-usage', b => b.usageMetadata.promptTokenCount = -1, 'accounting_uncertain'],
  ['usage-total-mismatch', b => b.usageMetadata.totalTokenCount = 7, 'accounting_uncertain'],
  ['reported-input-over-limit', b => b.usageMetadata.promptTokenCount = 4097, 'token_bound_violation'],
  ['combined-output-over-limit', b => b.usageMetadata.thoughtsTokenCount = 1000, 'token_bound_violation'],
  ['truncated', b => b.candidates[0].finishReason = 'MAX_TOKENS', 'incomplete'],
  ['refusal', b => b.candidates[0].finishReason = 'SAFETY', 'refused'],
  ['tool-output', b => b.candidates[0].content.parts.push({functionCall: {name: 'execute'}}), 'unexpected_output'],
  ['malformed-candidate', b => b.candidates[0].content.parts[0].text = '{}', 'invalid_candidate'],
  ['credential-echo', b => b.candidates[0].content.parts[0].text = key, 'invalid_response'],
]) await test(id, async () => { const raw = body(); change(raw); const r = await run({raw}); assert.equal(r.out.status, expected); assert.equal(r.calls, 1); assert.equal(r.out.shadow_candidate, null); assert.equal(r.out.counts_toward_certification, false); });
for (const lock of ['cancelled', 'hazard', 'denied']) await test(`preserves-${lock}-lock`, async () => {
  const v = input(); v.locks = {[lock]: true}; const c = validCandidate(v.packet);
  Object.assign(c.frame, {operation: 'device.power.off', mutationIntent: true}); const raw = body(); raw.candidates[0].content.parts[0].text = JSON.stringify(c);
  assert.equal((await run({value: v, raw})).out.status, 'invalid_candidate');
});
await test('scope-lock-preserved', async () => { const v = input(); v.locks = {subject_scope: 'other_person'}; assert.equal((await run({value: v})).out.status, 'invalid_candidate'); });
for (const [code, status] of [[400, 'provider_rejected'], [403, 'access_denied'], [429, 'quota_exhausted'], [503, 'provider_unavailable']]) await test(`provider-${code}-no-retry-safe-error`, async () => {
  const r = await run({fetch: async () => new Response(key, {status: code})}); assert.equal(r.out.status, status); assert.equal(r.calls, 1); assert(!JSON.stringify(r.out).includes(key));
  assert.equal((await run()).calls, 0);
});
for (const [id, mock] of [
  ['malformed-json', async () => new Response('{')], ['oversize', async () => new Response('x'.repeat(65537))],
  ['safe-thrown-error', async () => { throw Error(key); }],
]) await test(id, async () => { const r = await run({fetch: mock}); assert.equal(r.out.status, 'transport_or_response_error'); assert(!JSON.stringify(r.out).includes(key)); assert.equal(r.calls, 1); });
await test('concurrent-and-repeated-attempts-consume-one-fixed-slot', async () => {
  const results = await Promise.all([run(), run()]); assert.equal(results.reduce((n, r) => n + r.calls, 0), 1);
  assert.deepEqual(results.map(r => r.out.status).sort(), ['attempt_already_reserved', 'compatible_unqualified']);
  assert.equal((await run()).calls, 0);
});
await test('uncertain-pending-receipt-prevents-another-attempt', async () => {
  fs.mkdirSync(directory); fs.writeFileSync(journalPath(), JSON.stringify({event: 'pending'}) + '\n');
  assert.equal(reconcileGeminiCompatibility().status, 'uncertain_completion'); assert.equal((await run()).calls, 0);
});
await test('unwritable-ledger-prevents-dispatch', async () => { fs.writeFileSync(directory, 'fixture'); const r = await run(); assert.equal(r.out.status, 'receipt_unavailable'); assert.equal(r.calls, 0); });
await test('terminal-write-failure-not-success', async () => {
  const original = fs.fsyncSync; let count = 0; fs.fsyncSync = (...args) => { if (++count === 3) throw Error('mock disk failure'); return original(...args); };
  try { const r = await run(); assert.equal(r.out.status, 'receipt_write_failed'); assert.equal(r.out.shadow_candidate, null); assert.equal((await run()).calls, 0); }
  finally { fs.fsyncSync = original; }
});
await test('exact-receipt-binding-and-no-qualification-promotion', async () => {
  await run(); const rows = fs.readFileSync(journalPath(), 'utf8').trim().split('\n').map(JSON.parse);
  rows[1].approval_id = 'other'; fs.writeFileSync(journalPath(), rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  assert.equal(reconcileGeminiCompatibility().status, 'receipt_invalid');
});
await test('caller-mutation-cannot-change-captured-request', async () => {
  const v = input(); let finish;
  const promise = run({value: v, fetch: async () => new Promise(resolve => finish = resolve)});
  v.packet.utterance = 'changed'; v.approval.approval_id = 'changed'; finish(response(body()));
  assert.equal((await promise).out.status, 'compatible_unqualified');
});
await test('three-second-timeout-late-result-no-replay', async () => {
  let finish, signal; const r = await run({fetch: async (_url, init) => { signal = init.signal; return new Promise(resolve => finish = resolve); }});
  assert.equal(r.out.status, 'timed_out_uncertain'); assert(signal.aborted);
  assert(r.out.receipt.elapsed_ms >= 2990 && r.out.receipt.elapsed_ms < 4000);
  const before = fs.readFileSync(journalPath(), 'utf8'); finish(response(body())); await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(fs.readFileSync(journalPath(), 'utf8'), before); assert.equal((await run()).calls, 0);
  assert.equal(reconcileGeminiCompatibility().compatibility_observed, false);
});
const workflowInput = () => {
  const value = input();
  value.bundle = sealPreparedCanary(value.packet, hash('MOCK preparation review'), now - 100);
  delete value.packet;
  value.verification = {observed_at_ms: now, project: policy.project, model: policy.model,
    credential_match_verified: true, credential_sha256: hash(key), ownership_evidence_hash: value.approval.ownership_evidence_hash,
    tier: 'FREE', billing_account_linked: false, billing_enabled: false,
    billing_quota_evidence_hash: value.approval.billing_quota_evidence_hash,
    quota_remaining: {rpm: 15, tpm: 250000, rpd: 500}};
  return value;
};
const workflowRun = async (value, fetch = async () => response(body())) => {
  let calls = 0;
  const out = await dispatchPreparedCanary(value, {fetchImpl: async (...args) => {calls++; return fetch(...args);}});
  return {out, calls};
};
await test('workflow-preparation-does-not-authorize-or-reserve', () => {
  const v = workflowInput(); assert.equal(v.bundle.status, 'PREPARED_NOT_AUTHORIZED');
  assert(!fs.existsSync(directory)); assert.equal(v.bundle.approval_max_validity_ms, 300000);
  assert.equal(v.bundle.packet_deadline_ms, Date.parse(v.bundle.packet.now) + 300000);
  assert.deepEqual(preparedDispatchBlockers(v.bundle, v.approval, v.verification, key), []);
});
await test('workflow-byte-identical-dispatch-without-refresh', async () => {
  const v = workflowInput(), before = JSON.stringify(v.bundle);
  const r = await workflowRun(v, async (_url, init) => {
    assert.equal(init.body, v.bundle.wire_body); assert.equal(hash(init.body), binding.body_hash);
    return response(body());
  });
  assert.equal(r.calls, 1); assert.equal(r.out.status, 'compatible_unqualified');
  assert.equal(JSON.stringify(v.bundle), before);
});
for (const [id, change] of [
  ['expired-approval', v => v.approval.expires_at_ms = now],
  ['extended-approval', v => v.approval.expires_at_ms = now + 300001],
  ['preparation-time-is-not-owner-approval', v => v.approval.verified_at_ms = v.bundle.prepared_at_ms - 1],
  ['no-owner-approval', v => v.approval.compatibility_canary_approved = false],
  ['delayed-verification', () => now += 300001],
  ['old-billing-proof', v => v.verification.observed_at_ms = v.approval.verified_at_ms - 1],
  ['future-billing-proof', v => v.verification.observed_at_ms = now + 1],
  ['billing-now-linked', v => v.verification.billing_account_linked = true],
  ['quota-now-exhausted', v => v.verification.quota_remaining.rpm = 0],
  ['quota-unknown', v => delete v.verification.quota_remaining],
  ['credential-changed', v => v.apiKey = 'different-mock-key'],
  ['project-changed', v => v.verification.project = 'other'],
  ['credential-proof-missing', v => v.verification.credential_match_verified = false],
  ['body-changed', v => v.bundle.wire_body += ' '],
  ['packet-refreshed-after-approval', v => v.bundle.packet.now = new Date(now).toISOString()],
  ['code-changed-after-review', v => v.bundle.source_hash = hash('other')],
  ['packet-expiry-raised', v => v.bundle.packet_deadline_ms += 300000],
]) await test(`workflow-blocks-${id}`, async () => {
  const v = structuredClone(workflowInput()); change(v); const r = await workflowRun(v);
  assert.equal(r.out.status, 'blocked'); assert.equal(r.calls, 0); assert(!fs.existsSync(directory));
});
await test('workflow-delayed-owner-approval-does-not-refresh-packet', async () => {
  const v = workflowInput(); now = v.bundle.packet_deadline_ms;
  v.approval.verified_at_ms = now; v.approval.expires_at_ms = now + 300000; v.verification.observed_at_ms = now;
  const r = await workflowRun(v); assert.equal(r.calls, 0); assert(r.out.blockers.includes('packet_expired'));
});
await test('workflow-duplicate-attempt-stays-consumed', async () => {
  const v = workflowInput(); assert.equal((await workflowRun(v)).calls, 1);
  const r = await workflowRun(v); assert.equal(r.calls, 0); assert(r.out.blockers.includes('attempt_reserved_or_unverifiable'));
});
await test('workflow-uncertain-receipt-blocks-without-reset', async () => {
  const v = workflowInput(); fs.mkdirSync(directory); fs.writeFileSync(journalPath(), JSON.stringify({event: 'pending'}) + '\n');
  const before = fs.readFileSync(journalPath(), 'utf8'); const r = await workflowRun(v);
  assert.equal(r.calls, 0); assert.equal(r.out.status, 'blocked'); assert.equal(fs.readFileSync(journalPath(), 'utf8'), before);
});
await test('transport-prepared-wire-mismatch-blocks', async () => {
  const v = input(); v.wireBody = JSON.stringify(prepareGeminiShadow(v.packet).body) + ' ';
  const r = await run({value: v}); assert.equal(r.calls, 0); assert(r.out.blockers.includes('prepared_wire_mismatch'));
});
Date.now = originalNow;
for (const [name, fn] of Object.entries(originals)) fs[name] = fn;
assert(!fs.existsSync(fixedRoot), 'Mock tests must not reserve the real experiment slot');
console.log(JSON.stringify({pass: checks.filter(x => x.status === 'PASS').length, fail: checks.filter(x => x.status === 'FAIL').length,
  checks, provider_calls: 0, inference_calls: 0, spend_usd: 0, clock: 'MOCK_WALL_CLOCK_REAL_DEADLINE', proof_kind: 'OFFLINE_MOCK_ONLY'}));
process.exitCode = checks.some(x => x.status === 'FAIL') ? 1 : 0;
