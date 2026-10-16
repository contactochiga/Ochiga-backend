import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync, sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ROOT, hash} from '../iq11e/contract.mjs';
import {candidate} from '../iq11e/fixtures.mjs';
import {GEMINI_SHADOW as policy} from './gemini-request.mjs';
import {ownerConstraints, ownerAuthorizationMessage} from './gemini-owner-authorization.mjs';
import {prepareLiveCanary, dispatchLiveCanary, compareCredentialLocally, collectGoogleObservations} from './gemini-live-runner.mjs';

// No real credentials, Keychain access, Google requests or authorization writes.
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
const base = path.join(ROOT, 'artifacts'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq11f-live-runner-tests-'));
const roots = ['iq11f-gemini-execution-authorization', 'iq11f-gemini-compatibility-receipts', 'iq11f-gemini-shadow-receipts'];
const trustFile = path.join(base, 'intelligence-quality-v1-iq11f-gemini-owner-trust.json');
const constraintsFile = path.join(base, 'intelligence-quality-v1-iq11f-gemini-owner-constraints.json');
const trustBytes = fs.readFileSync(trustFile), constraintBytes = fs.readFileSync(constraintsFile);
const original = {}, clock = Date.now, epoch = Date.now(); let now = epoch, dir, calls, responseMode, checks = [];
const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const key = 'OFFLINE-SYNTHETIC-KEY';
const map = p => {
  if (p === trustFile) return path.join(dir, 'trust.json');
  if (p === constraintsFile) return path.join(dir, 'constraints.json');
  for (const r of roots) { const from = path.join(base, r); if (typeof p === 'string' && (p === from || p.startsWith(from + path.sep))) return path.join(dir, r) + p.slice(from.length); }
  return p;
};
for (const n of ['lstatSync', 'statSync', 'readFileSync', 'mkdirSync', 'openSync']) {
  original[n] = fs[n]; fs[n] = (p, ...a) => original[n](map(p), ...a);
}
Date.now = () => now;
const execution = () => path.join(dir, roots[0], 'execution.json');
const ledger = () => path.join(dir, roots[1], 'gemini-canary.jsonl');
const signed = (changes = {}) => {
  const claims = {version: 1, purpose: 'synthetic_schema_compatibility_only', authorization_id: 'offline-live-runner-001',
    key_id: 'offline-owner', issued_at_ms: now - 1000, expires_at_ms: now + 86400000,
    constraint_sha256: hash(ownerConstraints()), approval_id: 'IQ11F-GEMINI-COMPATIBILITY-001', ...changes};
  return {claims, signature: sign(null, Buffer.from(ownerAuthorizationMessage(claims)), privateKey).toString('base64')};
};
const observation = () => ({observed_at_ms: now, project: policy.project, model: policy.model, tier: 'FREE',
  billing_account_linked: false, billing_enabled: false, quota_remaining: {rpm: 15, tpm: 250000, rpd: 500},
  provenance: 'owner_read_only_google_ui_observation', current_remaining_verified: true});
const prepare = (owner = signed(), v = observation(), match = true) => prepareLiveCanary({owner, apiKey: key}, {
  compareCredential: async () => match, observeGoogle: async () => v,
});
function mockResponse(body) {
  const packet = JSON.parse(body.contents[0].parts[0].text).packet;
  const c = candidate(packet); c.bindings[0].entity_token = packet.entities[0].token;
  c.frame.answerTarget.requested_fields = ['power_state'];
  const raw = {modelVersion: policy.responseVersion,
    candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(c)}]}}],
    usageMetadata: {promptTokenCount: 496, candidatesTokenCount: 100, thoughtsTokenCount: 10, totalTokenCount: 606}};
  if (responseMode === 'wrong-model') raw.modelVersion = 'other';
  if (responseMode === 'no-usage') delete raw.usageMetadata;
  if (responseMode === 'too-many-tokens') { raw.usageMetadata.thoughtsTokenCount = 2000; raw.usageMetadata.totalTokenCount = 2596; }
  return new Response(responseMode === 'malformed' ? 'not JSON' : JSON.stringify(raw), {status: responseMode === 'provider-error' ? 503 : 200});
}
async function test(id, fn) {
  dir = path.join(temp, String(checks.length)); fs.mkdirSync(dir); now = epoch; calls = 0; responseMode = 'ok';
  fs.writeFileSync(path.join(dir, 'trust.json'), JSON.stringify({version: 1, enrolled: true, key_id: 'offline-owner', public_key_pem: publicKey.export({type: 'spki', format: 'pem'})}));
  fs.writeFileSync(path.join(dir, 'constraints.json'), constraintBytes);
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${policy.model}:generateContent`);
    assert.equal(init.redirect, 'error'); assert.equal(init.headers['x-goog-api-key'], key);
    const body = JSON.parse(init.body); assert.equal(body.generationConfig.maxOutputTokens, 1024);
    assert(!body.tools); assert.equal(body.generationConfig.thinkingConfig.includeThoughts, false);
    if (responseMode === 'timeout') return new Promise(() => {});
    return mockResponse(body);
  };
  try { await fn(); checks.push({id, status: 'PASS'}); }
  catch (e) { checks.push({id, status: 'FAIL', error: e.message}); }
}
await test('preflight-does-not-issue-or-dispatch', async () => {
  const p = await prepare(); assert.equal(p.status, 'prepared'); assert.equal(calls, 0); assert(!fs.existsSync(execution()));
  assert(!JSON.stringify(p).includes(key)); assert(!JSON.stringify(p).includes(hash(key)));
});
await test('single-controlled-compatibility-result-and-receipt', async () => {
  const p = await prepare(), r = await dispatchLiveCanary(p.handle);
  assert.equal(r.status, 'compatible_unqualified'); assert.equal(calls, 1); assert.equal(r.counts_toward_certification, false);
  assert.equal(r.input_accounting_verified, false); assert.equal(r.adopted, false);
  const bytes = fs.readFileSync(ledger(), 'utf8'); assert(!bytes.includes(key)); assert(!bytes.includes(hash(key)));
  assert.equal(bytes.trim().split('\n').length, 2);
});
for (const [id, change] of [
  ['wrong-project', v => v.project = 'other'], ['wrong-model', v => v.model = 'other'],
  ['billing-unknown', v => delete v.billing_enabled], ['linked-billing', v => v.billing_account_linked = true],
  ['paid-tier', v => v.tier = 'PAID'], ['quota-missing', v => delete v.quota_remaining],
  ['quota-zero', v => v.quota_remaining.rpd = 0], ['quota-delayed', v => v.current_remaining_verified = false],
  ['old-observation', v => v.observed_at_ms -= 300001], ['future-observation', v => v.observed_at_ms += 1],
  ['untrusted-provenance', v => v.provenance = 'environment_flags'],
]) await test(id, async () => { const v = observation(); change(v); assert.equal((await prepare(signed(), v)).status, 'blocked'); assert.equal(calls, 0); assert(!fs.existsSync(execution())); });
await test('wrong-credential', async () => assert.equal((await prepare(signed(), observation(), false)).status, 'blocked'));
await test('missing-comparator', async () => assert.equal((await prepareLiveCanary({owner: signed(), apiKey: key}, {})).status, 'blocked'));
await test('missing-credential', async () => assert.equal((await prepareLiveCanary({owner: signed(), apiKey: ''}, {})).status, 'blocked'));
await test('expired-owner', async () => assert.equal((await prepare(signed({expires_at_ms: now}))).status, 'blocked'));
await test('invalid-signature', async () => { const o = signed(); o.signature = 'A'.repeat(86) + '=='; assert.equal((await prepare(o)).status, 'blocked'); });
await test('boolean-approval-no-handle', async () => { assert.equal((await dispatchLiveCanary({approved: true})).status, 'blocked'); assert.equal(calls, 0); });
await test('prepared-output-cannot-be-serialized-into-authority', async () => { const p = await prepare(); assert.equal((await dispatchLiveCanary(JSON.parse(JSON.stringify(p)).handle)).status, 'blocked'); });
await test('duplicate-and-concurrent-handle', async () => {
  const p = await prepare(); const results = await Promise.all([dispatchLiveCanary(p.handle), dispatchLiveCanary(p.handle)]);
  assert.equal(calls, 1); assert.equal(results.filter(r => r.status === 'blocked').length, 1);
});
await test('independently-prepared-concurrent-handles', async () => {
  const a = await prepare(), b = await prepare(); await Promise.all([dispatchLiveCanary(a.handle), dispatchLiveCanary(b.handle)]); assert.equal(calls, 1);
});
await test('existing-reservation', async () => {
  fs.mkdirSync(path.dirname(ledger()), {recursive: true}); fs.writeFileSync(ledger(), '{"event":"pending"}\n');
  assert.equal((await prepare()).status, 'blocked'); assert.equal(calls, 0);
});
await test('late-evidence-does-not-issue-window', async () => {
  const p = await prepare(); now += 300001; assert.equal((await dispatchLiveCanary(p.handle)).status, 'blocked'); assert(!fs.existsSync(execution()));
});
await test('owner-revoked-after-preflight', async () => {
  const p = await prepare(); fs.writeFileSync(path.join(dir, 'trust.json'), '{}'); assert.equal((await dispatchLiveCanary(p.handle)).status, 'blocked'); assert.equal(calls, 0);
});
await test('scenario-drift-after-preflight', async () => {
  const p = await prepare(), c = ownerConstraints(); c.template_packet.utterance = 'Changed';
  fs.writeFileSync(path.join(dir, 'constraints.json'), JSON.stringify(c)); assert.equal((await dispatchLiveCanary(p.handle)).status, 'blocked');
});
for (const [mode, expected] of [['malformed', 'transport_or_response_error'], ['wrong-model', 'invalid_response'],
  ['no-usage', 'accounting_uncertain'], ['too-many-tokens', 'token_bound_violation'], ['provider-error', 'provider_unavailable'], ['timeout', 'timed_out_uncertain']]) {
  await test(mode, async () => {
    responseMode = mode; const p = await prepare(), r = await dispatchLiveCanary(p.handle);
    assert.equal(r.status, expected); assert.equal(calls, 1); assert.equal((await prepare()).status, 'blocked');
  });
}
await test('receipt-write-failure-remains-consumed', async () => {
  const p = await prepare(), write = fs.writeSync; let writes = 0;
  fs.writeSync = (...a) => { if (++writes === 3) throw Error('OFFLINE disk failure'); return write(...a); };
  try { assert.equal((await dispatchLiveCanary(p.handle)).status, 'receipt_write_failed'); }
  finally { fs.writeSync = write; }
  assert.equal(calls, 1); assert.equal((await prepare()).status, 'blocked');
});
await test('masked-comparison-refuses-noninteractive', () => assert.equal(compareCredentialLocally(key), false));
await test('unknown-ui-observation-blocks', async () => assert.equal(await collectGoogleObservations(async () => 'UNKNOWN'), null));
await test('complete-owner-ui-observation', async () => {
  const answers = [policy.project, policy.model, 'FREE', 'NO_LINKED_ACCOUNT', 'CURRENT_REMAINING_VERIFIED', '15', '250000', '500'];
  assert.deepEqual((await collectGoogleObservations(async () => answers.shift())).quota_remaining, {rpm: 15, tpm: 250000, rpd: 500});
});
await test('cli-cannot-dispatch-with-flags-or-noninteractive-input', () => {
  const r = spawnSync(process.execPath, ['scripts/iq11f-gateway/gemini-live-runner.mjs', 'execute'], {cwd: ROOT, env: {PATH: process.env.PATH}, encoding: 'utf8'});
  assert.equal(JSON.parse(r.stdout).status, 'blocked');
});
Date.now = clock; globalThis.fetch = realFetch;
for (const [n, f] of Object.entries(original)) fs[n] = f;
assert.deepEqual(fs.readFileSync(trustFile), trustBytes);
assert.deepEqual(fs.readFileSync(constraintsFile), constraintBytes);
console.log(JSON.stringify({pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length,
  checks, live_provider_calls: 0, real_execution_windows_issued: 0, real_reservations_created: 0}));
process.exitCode = checks.some(c => c.status === 'FAIL') ? 1 : 0;
