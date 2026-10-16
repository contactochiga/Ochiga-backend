import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {packet as fixture, candidate} from '../iq11e/fixtures.mjs';
import {hash} from '../iq11e/contract.mjs';
import {GEMINI_SHADOW as policy, prepareGeminiShadow, runGeminiShadow, reconcileGeminiShadow} from './gemini-shadow.mjs';
import {prepareGeminiTokenPreflight} from './gemini-token-preflight.mjs';

// No environment credentials and no network. Proofs below are deliberately MOCK ONLY.
globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
const key = 'synthetic-test-credential-not-a-real-key';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iq11f-gemini-shadow-'));
const checks = []; let index = 0;
const test = async (id, fn) => { try { await fn(); checks.push({id, status: 'PASS'}); } catch (e) { checks.push({id, status: 'FAIL', error: e.message}); } };
const fresh = (surface = 'consumer') => {
  const p = fixture(surface), now = Date.now(); p.now = new Date(now).toISOString();
  p.entities.forEach(e => { e.expires_at = new Date(now + 60000).toISOString(); e.facts.forEach(f => f.expires_at = e.expires_at); });
  return p;
};
const approveMock = p => {
  const d = prepareGeminiShadow(p), now = Date.now();
  return {live_canary_approved: true, provider: 'gemini', project: policy.project, model: policy.model,
    response_version: policy.responseVersion, credential_sha256: hash(key), ownership_verified: true,
    ownership_evidence_hash: hash('MOCK ownership'), tier: 'FREE', billing_enabled: false,
    free_quota_verified: true, billing_quota_evidence_hash: hash('MOCK billing'),
    input_usd_per_token: 0, output_usd_per_token: 0, authorized_usd: 0,
    synthetic_reviewed: true, data_processing_approved: true, packet_hash: d.packet_hash,
    body_hash: d.body_hash, schema_hash: d.schema_hash, verified_at_ms: now - 10, expires_at_ms: now + 60000,
    input_accounting: {body_hash: d.body_hash, model: policy.model, full_request_verified: true, evidence_hash: hash('MOCK tokenizer'), upper_bound: 2000},
    max_inference_requests: 1, output_tokens: 1024, deadline_ms: 3000, allow_tools: false, allow_fallback: false};
};
const body = p => ({modelVersion: policy.responseVersion,
  candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(candidate(p))}]}}],
  usageMetadata: {promptTokenCount: 900, candidatesTokenCount: 100, thoughtsTokenCount: 10, totalTokenCount: 1010}});
const response = b => new Response(JSON.stringify(b), {status: 200});
async function run(p = fresh(), options = {}) {
  const directory = options.directory ?? path.join(root, String(++index)); let calls = 0;
  const a = options.approval === undefined ? approveMock(p) : options.approval;
  const out = await runGeminiShadow({packet: p, baseline: {decision: 'unchanged'}, apiKey: key, approval: a, locks: options.locks},
    {receiptDirectory: directory, fetchImpl: async (...args) => { calls++; return options.fetch ? options.fetch(...args) : response(options.body ?? body(p)); }});
  return {out, calls, directory};
}

await test('no-approval-no-network-no-receipt', async () => { const r = await run(fresh(), {approval: null}); assert.equal(r.out.status, 'blocked'); assert.equal(r.calls, 0); assert(!fs.existsSync(r.directory)); });
await test('mock-approval-cannot-activate-ambient-network', async () => {
  const p = fresh();
  const r = await runGeminiShadow({packet: p, baseline: {}, apiKey: key, approval: approveMock(p)});
  assert.equal(r.status, 'blocked'); assert(r.blockers.includes('live_dispatch_not_enabled'));
});
await test('ambient-fetch-cannot-be-explicitly-selected', async () => {
  const p = fresh();
  const r = await runGeminiShadow({packet: p, baseline: {}, apiKey: key, approval: approveMock(p)}, {fetchImpl: globalThis.fetch});
  assert.equal(r.status, 'blocked'); assert(r.blockers.includes('live_dispatch_not_enabled'));
});
await test('token-preflight-covers-entire-wire-request', () => {
  const p = fresh(), d = prepareGeminiShadow(p), t = prepareGeminiTokenPreflight(p);
  assert.deepEqual(t.count_request, {generateContentRequest: {model: 'models/' + policy.model, ...d.body}});
  assert.equal(t.evidence.body_hash, d.body_hash); assert.equal(t.evidence.schema_hash, d.schema_hash);
  assert.equal(t.evidence.count_request_hash, hash(t.count_request));
  assert(!Object.hasOwn(t.count_request, 'contents'));
});
await test('wire-byte-accounting-reconciles-without-token-estimates', () => {
  const t = prepareGeminiTokenPreflight(fresh()).evidence;
  assert.equal(Object.values(t.component_json_bytes).reduce((a, b) => a + b, 0) + t.body_json_framing_bytes, t.body_bytes);
  assert(t.schema_json_bytes > 0 && t.instruction_text_bytes > 0 && t.user_payload_text_bytes > 0);
  assert.equal(t.measured_input_tokens, null); assert.equal(t.full_input_upper_bound, null);
  assert.equal(t.full_request_verified, false); assert.equal(t.can_dispatch_inference, false);
});
await test('token-proof-invalidated-by-packet-change', () => {
  const p = fresh(), before = prepareGeminiTokenPreflight(p); p.utterance += ' Please.';
  const after = prepareGeminiTokenPreflight(p); assert.notEqual(before.evidence.count_request_hash, after.evidence.count_request_hash);
});
await test('token-preflight-rejects-private-and-out-of-scope-input', () => {
  const p = fresh(); p.data_class = 'customer'; assert.throws(() => prepareGeminiTokenPreflight(p));
  const q = fresh(); q.entities[0].scope_token = 'another-home'; assert.throws(() => prepareGeminiTokenPreflight(q));
});
for (const [name, change] of [
  ['ownership', a => a.ownership_verified = false], ['credential-binding', a => a.credential_sha256 = hash('wrong')],
  ['wrong-project', a => a.project = 'another-project'], ['billing-enabled', a => a.billing_enabled = true],
  ['paid-tier', a => a.tier = 'PAID'], ['positive-price', a => a.output_usd_per_token = 0.01],
  ['unknown-quota', a => a.free_quota_verified = false], ['wrong-model', a => a.model = 'latest'],
  ['processing-unapproved', a => a.data_processing_approved = false], ['synthetic-unreviewed', a => a.synthetic_reviewed = false],
  ['changed-packet', a => a.packet_hash = hash('different')], ['changed-schema', a => a.schema_hash = hash('different')],
  ['expired', a => a.expires_at_ms = 1], ['long-approval', a => a.expires_at_ms += 900000],
  ['missing-token-proof', a => a.input_accounting = null], ['content-only-count', a => a.input_accounting.full_request_verified = false],
  ['oversize-input', a => a.input_accounting.upper_bound = 4097], ['tools', a => a.allow_tools = true],
  ['fallback', a => a.allow_fallback = true], ['multiple-requests', a => a.max_inference_requests = 2],
]) await test(`blocks-${name}`, async () => { const p = fresh(), a = approveMock(p); change(a); const r = await run(p, {approval: a}); assert.equal(r.out.status, 'blocked'); assert.equal(r.calls, 0); });

for (const surface of ['consumer', 'facility', 'office_internal', 'public_corporate']) await test(`valid-shadow-${surface}`, async () => {
  const p = fresh(surface), r = await run(p);
  assert.equal(r.out.status, 'valid_shadow'); assert.equal(r.calls, 1); assert.equal(r.out.adopted, false);
  assert.equal(r.out.canonical_decision_changed, false); assert.equal(r.out.receipt.usage.output_total, 110);
  assert.equal(r.out.receipt.usage.reasoning_output, 10); assert.deepEqual(r.out.shadow_candidate, candidate(p));
  assert(reconcileGeminiShadow(r.directory).successful_shadow);
  const journal = fs.readFileSync(path.join(r.directory, 'gemini-canary.jsonl'), 'utf8');
  for (const secret of [key, p.utterance, p.entities[0].alias, 'ownership_evidence_hash']) assert(!journal.includes(secret));
  assert.equal(fs.statSync(path.join(r.directory, 'gemini-canary.jsonl')).mode & 0o777, 0o600);
});
await test('fixed-endpoint-minimal-thinking-no-tools', async () => {
  const p = fresh(); const r = await run(p, {fetch: async (url, init) => {
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${policy.model}:generateContent`);
    assert(!url.includes(key)); assert.equal(init.headers['x-goog-api-key'], key); assert.equal(init.redirect, 'error');
    const b = JSON.parse(init.body); assert.deepEqual(Object.keys(b).sort(), ['contents', 'generationConfig', 'systemInstruction']);
    assert.deepEqual(b.generationConfig.thinkingConfig, {thinkingLevel: 'minimal', includeThoughts: false});
    assert.equal(b.generationConfig.maxOutputTokens, 1024); assert.equal(b.generationConfig.candidateCount, 1);
    return response(body(p));
  }}); assert.equal(r.out.status, 'valid_shadow');
});
for (const [name, mutate, expected] of [
  ['wrong-response-model', b => b.modelVersion = 'other-model', 'invalid_response'],
  ['missing-thought-count', b => delete b.usageMetadata.thoughtsTokenCount, 'accounting_uncertain'],
  ['missing-usage', b => delete b.usageMetadata, 'accounting_uncertain'],
  ['token-overrun', b => b.usageMetadata.thoughtsTokenCount = 1024, 'token_bound_violation'],
  ['input-overrun', b => b.usageMetadata.promptTokenCount = 5000, 'token_bound_violation'],
  ['total-mismatch', b => b.usageMetadata.totalTokenCount = 0, 'accounting_uncertain'],
  ['tools-output', b => b.candidates[0].content.parts.push({functionCall: {name: 'execute'}}), 'unexpected_output'],
  ['unexpected-signature', b => b.candidates[0].content.parts[0].thoughtSignature = 'opaque', 'unexpected_output'],
  ['truncation', b => b.candidates[0].finishReason = 'MAX_TOKENS', 'incomplete'],
  ['refusal', b => b.candidates[0].finishReason = 'SAFETY', 'refused'],
  ['credential-echo', b => b.candidates[0].content.parts[0].text = key, 'invalid_response'],
]) await test(name, async () => { const p = fresh(), b = body(p); mutate(b); const r = await run(p, {body: b}); assert.equal(r.out.status, expected); assert.equal(r.out.shadow_candidate, null); assert.equal(r.calls, 1); });
await test('canonical-validation-unknown-entity', async () => { const p = fresh(), b = body(p), c = candidate(p); c.bindings[0].entity_token = 'other-home'; b.candidates[0].content.parts[0].text = JSON.stringify(c); assert.equal((await run(p, {body: b})).out.status, 'invalid_candidate'); });
for (const lock of ['cancelled', 'hazard', 'denied']) await test(`core-${lock}-lock`, async () => { const p = fresh(), b = body(p), c = candidate(p); Object.assign(c.frame, {operation: 'device.power.off', mutationIntent: true}); b.candidates[0].content.parts[0].text = JSON.stringify(c); assert.equal((await run(p, {body: b, locks: {[lock]: true}})).out.status, 'invalid_candidate'); });
await test('scope-lock', async () => assert.equal((await run(fresh(), {locks: {subject_scope: 'other_person'}})).out.status, 'invalid_candidate'));
await test('expired-context', async () => { const p = fixture(); assert.equal((await run(p)).out.status, 'blocked'); });
await test('production-packet', async () => { const p = fresh(); p.data_class = 'production'; const r = await run(p, {approval: null}); assert.equal(r.out.status, 'invalid_input'); assert.equal(r.calls, 0); });
await test('public-private-packet', async () => { const p = fresh('public_corporate'); p.entities[0].visibility = 'authorized_synthetic'; assert.throws(() => prepareGeminiShadow(p)); });
await test('embedded-credential', async () => { const p = fresh(); p.utterance = 'Read AIza' + 'a'.repeat(30); assert.throws(() => prepareGeminiShadow(p)); });
for (const [status, expected] of [[403, 'access_denied'], [429, 'quota_exhausted'], [503, 'provider_unavailable'], [400, 'provider_rejected']]) await test(`http-${status}-safe-no-retry`, async () => { const r = await run(fresh(), {fetch: async () => new Response(key, {status})}); assert.equal(r.out.status, expected); assert.equal(r.calls, 1); assert(!JSON.stringify(r.out).includes(key)); });
await test('thrown-provider-error-redacted', async () => { const r = await run(fresh(), {fetch: async () => { throw Error(key); }}); assert.equal(r.out.status, 'transport_or_response_error'); assert(!JSON.stringify(r.out).includes(key)); });
await test('oversized-stream', async () => { const r = await run(fresh(), {fetch: async () => new Response('x'.repeat(65537))}); assert.equal(r.out.status, 'transport_or_response_error'); });
await test('duplicate-and-concurrent-delivery-reserved-once', async () => {
  const p = fresh(), directory = path.join(root, 'concurrency');
  const runs = await Promise.all([run(p, {directory}), run(p, {directory})]);
  assert.equal(runs.reduce((n, r) => n + r.calls, 0), 1);
  assert.deepEqual(runs.map(r => r.out.status).sort(), ['attempt_already_reserved', 'valid_shadow']);
  assert.equal((await run(p, {directory})).calls, 0);
});
await test('missing-terminal-receipt-blocks-replay', async () => {
  const directory = path.join(root, 'interrupted'); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'gemini-canary.jsonl'), JSON.stringify({event: 'pending'}) + '\n');
  assert.equal(reconcileGeminiShadow(directory).status, 'uncertain_completion');
  assert.equal((await run(fresh(), {directory})).calls, 0);
});
await test('receipt-failure-prevents-dispatch', async () => {
  const directory = path.join(root, 'not-directory'); fs.writeFileSync(directory, 'fixture');
  const r = await run(fresh(), {directory}); assert.equal(r.out.status, 'receipt_unavailable'); assert.equal(r.calls, 0);
});
await test('terminal-receipt-fsync-failure-not-success', async () => {
  const original = fs.fsyncSync; let syncs = 0;
  fs.fsyncSync = (...args) => { if (++syncs === 3) throw Error('synthetic disk failure'); return original(...args); };
  try { const r = await run(); assert.equal(r.calls, 1); assert.equal(r.out.status, 'receipt_write_failed'); assert.equal(r.out.shadow_candidate, null); }
  finally { fs.fsyncSync = original; }
});
await test('exact-id-reconciliation-no-text-matching', async () => {
  const r = await run(); const file = path.join(r.directory, 'gemini-canary.jsonl');
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  rows[1].request_id = 'unrelated-request'; fs.writeFileSync(file, rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  assert.equal(reconcileGeminiShadow(r.directory).status, 'receipt_invalid');
});
await test('caller-mutation-cannot-change-inflight-packet', async () => {
  const p = fresh(), a = approveMock(p); let finish;
  const promise = run(p, {approval: a, fetch: async (_url, init) => {
    const captured = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text).packet;
    return new Promise(resolve => finish = () => resolve(response(body(captured))));
  }});
  p.utterance = 'changed after dispatch'; a.packet_hash = hash('different'); finish();
  assert.equal((await promise).out.status, 'valid_shadow');
});
await test('three-second-deadline-and-late-completion-immutable', async () => {
  const p = fresh(); let finish, signal;
  const r = await run(p, {fetch: async (_url, init) => { signal = init.signal; return new Promise(resolve => finish = resolve); }});
  assert.equal(r.out.status, 'timed_out_uncertain'); assert(signal.aborted);
  assert(r.out.receipt.elapsed_ms >= 2990 && r.out.receipt.elapsed_ms < 4000);
  const before = fs.readFileSync(path.join(r.directory, 'gemini-canary.jsonl'), 'utf8');
  finish(response(body(p))); await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(fs.readFileSync(path.join(r.directory, 'gemini-canary.jsonl'), 'utf8'), before);
  assert(Object.isFrozen(r.out)); assert.equal(r.out.shadow_candidate, null);
  assert.equal(reconcileGeminiShadow(r.directory).successful_shadow, false);
});
console.log(JSON.stringify({pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length,
  checks, network_calls: 0, inference_calls: 0, spend_usd: 0, proof_kind: 'OFFLINE_MOCK_ONLY'}));
process.exitCode = checks.some(c => c.status === 'FAIL') ? 1 : 0;
