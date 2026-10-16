import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync, sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ROOT, hash} from '../iq11e/contract.mjs';
import {candidate} from '../iq11e/fixtures.mjs';
import {GEMINI_SHADOW as policy, prepareGeminiShadow, runGeminiCompatibility} from './gemini-shadow.mjs';
import {ownerConstraints, ownerAuthorizationMessage, verifyOwnerAuthorization,
  issueGeminiExecution, loadGeminiExecution} from './gemini-owner-authorization.mjs';

// Offline only: never load credentials. All provider calls are local mocks.
globalThis.fetch = () => { throw Error('LIVE_NETWORK_FORBIDDEN'); };
const base = path.join(ROOT, 'artifacts');
const trust = path.join(base, 'intelligence-quality-v1-iq11f-gemini-owner-trust.json');
const constraints = path.join(base, 'intelligence-quality-v1-iq11f-gemini-owner-constraints.json');
const roots = ['iq11f-gemini-execution-authorization', 'iq11f-gemini-compatibility-receipts', 'iq11f-gemini-shadow-receipts'];
for (const r of roots) assert(!fs.existsSync(path.join(base, r)), 'Never touch a real reservation');
const originals = {}, oldNow = Date.now, fixedNow = Date.parse('2026-10-16T18:00:00Z');
const constraintBytes = fs.readFileSync(constraints, 'utf8');
const trustBytes = fs.readFileSync(trust, 'utf8');
assert.equal(JSON.parse(trustBytes).enrolled, false, 'Actual owner enrollment requires a new review');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq11f-owner-auth-'));
const keypair = generateKeyPairSync('ed25519'), key = 'OFFLINE-MOCK-NOT-A-PROVIDER-KEY';
const mockTrust = {version: 1, enrolled: true, key_id: 'OFFLINE-OWNER', public_key_pem: keypair.publicKey.export({type: 'spki', format: 'pem'})};
let dir, now = fixedNow, calls = 0, count = 0;
Date.now = () => now;
const map = p => {
  if (p === trust) return path.join(dir, 'trust.json');
  if (p === constraints) return path.join(dir, 'constraints.json');
  for (const r of roots) { const from = path.join(base, r); if (typeof p === 'string' && (p === from || p.startsWith(from + path.sep))) return path.join(dir, r) + p.slice(from.length); }
  return p;
};
for (const name of ['lstatSync', 'statSync', 'readFileSync', 'mkdirSync', 'openSync']) {
  originals[name] = fs[name]; fs[name] = (p, ...args) => originals[name](map(p), ...args);
}
const checks = [];
const test = async (id, fn) => {
  dir = path.join(temp, String(++count)); fs.mkdirSync(dir); now = fixedNow; calls = 0;
  fs.writeFileSync(path.join(dir, 'trust.json'), JSON.stringify(mockTrust));
  fs.writeFileSync(path.join(dir, 'constraints.json'), constraintBytes);
  try { await fn(); checks.push({id, status: 'PASS'}); }
  catch (e) { checks.push({id, status: 'FAIL', error: e.message}); }
};
const signed = (change = {}, signer = keypair.privateKey) => {
  const claims = {version: 1, purpose: 'synthetic_schema_compatibility_only', authorization_id: 'offline-owner-consent-001',
    key_id: 'OFFLINE-OWNER', issued_at_ms: now - 60000, expires_at_ms: now + 86400000,
    constraint_sha256: hash(ownerConstraints()), approval_id: 'IQ11F-GEMINI-COMPATIBILITY-001', ...change};
  return {claims, signature: sign(null, Buffer.from(ownerAuthorizationMessage(claims)), signer).toString('base64')};
};
const evidence = () => ({observed_at_ms: now, project: policy.project, model: policy.model,
  credential_match_verified: true, credential_sha256: hash(key), ownership_evidence_hash: hash('MOCK full key match'),
  tier: 'FREE', billing_account_linked: false, billing_enabled: false,
  billing_quota_evidence_hash: hash('MOCK current billing/quota'), quota_remaining: {rpm: 15, tpm: 250000, rpd: 500}});
const file = () => path.join(dir, roots[0], 'execution.json');
const receipt = () => path.join(dir, roots[1], 'gemini-canary.jsonl');
const issue = (owner = signed(), v = evidence(), credential = key) => issueGeminiExecution(owner, v, credential);
const load = () => loadGeminiExecution(evidence(), key);
function response(packet) {
  const c = candidate(packet); c.bindings[0].entity_token = packet.entities[0].token;
  c.frame.answerTarget.requested_fields = ['power_state'];
  return new Response(JSON.stringify({modelVersion: policy.responseVersion,
    candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(c)}]}}],
    usageMetadata: {promptTokenCount: 496, candidatesTokenCount: 100, thoughtsTokenCount: 10, totalTokenCount: 606}}));
}
async function dispatch(ready = load(), fetchImpl) {
  assert.equal(ready.status, 'ready');
  return runGeminiCompatibility({packet: ready.packet, wireBody: ready.wireBody, approval: ready.approval, apiKey: key,
    baseline: {decision: 'deterministic_unchanged'}, locks: {}}, {fetchImpl: async (...args) => {calls++; return fetchImpl ? fetchImpl(...args) : response(ready.packet);}});
}
await test('owner-trust-is-unenrolled-in-real-artifact', () => { assert.equal(JSON.parse(trustBytes).enrolled, false); });
await test('signed-purpose-bound-owner-positive-control', () => { assert.equal(verifyOwnerAuthorization(signed()).valid, true); });
await test('owner-approval-does-not-start-five-minute-clock', () => {
  const owner = signed(); now += 3600000; assert.equal(verifyOwnerAuthorization(owner).valid, true);
  const r = issue(owner); assert.equal(r.status, 'issued'); assert.equal(r.expires_at_ms, now + 300000);
});
for (const [id, mutate] of [
  ['signature-tampered', o => o.signature = 'A'.repeat(86) + '=='],
  ['payload-tampered', o => o.claims.authorization_id += '-changed'],
  ['extra-owner-field', o => o.approved = true],
  ['extra-claim-field', o => o.claims.approved = true],
  ['missing-signature', o => delete o.signature],
  ['arbitrary-key-in-approval', o => o.public_key_pem = mockTrust.public_key_pem],
]) await test(`owner-rejects-${id}`, () => { const o = signed(); mutate(o); assert.equal(issue(o).status, 'blocked'); assert(!fs.existsSync(file())); });
for (const [id, changes] of [
  ['wrong-purpose', {purpose: 'production'}], ['wrong-key-id', {key_id: 'other'}],
  ['wrong-experiment', {approval_id: 'OTHER'}], ['wrong-constraint-hash', {constraint_sha256: hash('other')}],
  ['future-issue', {issued_at_ms: fixedNow + 1}], ['expired-owner', {expires_at_ms: fixedNow}],
  ['overlong-owner-validity', {expires_at_ms: fixedNow + 2592000001}], ['invalid-id', {authorization_id: null}],
]) await test(`owner-rejects-${id}`, () => { assert.equal(issue(signed(changes)).status, 'blocked'); assert(!fs.existsSync(file())); });
await test('untrusted-self-signed-owner-rejected', () => {
  const other = generateKeyPairSync('ed25519'); assert.equal(issue(signed({}, other.privateKey)).status, 'blocked');
});
await test('missing-owner-and-configuration-flags-rejected', () => {
  for (const o of [null, {}, {approved: true, owner_approval_evidence_hash: hash('fake')}]) assert.equal(issue(o).status, 'blocked');
});
await test('unenrolled-trust-cannot-be-overridden-by-caller', () => {
  const owner = signed(); fs.writeFileSync(path.join(dir, 'trust.json'), trustBytes);
  assert.equal(issue(owner).status, 'blocked');
});
for (const [id, mutate] of [
  ['wrong-project', v => v.project = 'other'], ['wrong-model', v => v.model = 'other'],
  ['credential-mismatch', v => v.credential_sha256 = hash('other')], ['unproven-key', v => v.credential_match_verified = false],
  ['billing-unknown', v => delete v.billing_enabled], ['billing-enabled', v => v.billing_enabled = true],
  ['billing-linked', v => v.billing_account_linked = true], ['tier-paid', v => v.tier = 'PAID'],
  ['quota-unknown', v => delete v.quota_remaining], ['quota-exhausted', v => v.quota_remaining.rpd = 0],
  ['stale-evidence', v => v.observed_at_ms -= 300000], ['future-evidence', v => v.observed_at_ms += 1],
]) await test(`fresh-check-${id}`, () => {
  const v = evidence(); mutate(v); assert.equal(issue(signed(), v).status, 'blocked'); assert(!fs.existsSync(file()));
});
await test('permitted-refresh-is-exactly-four-timestamps', () => {
  const c = ownerConstraints(); assert.equal(issue().status, 'issued'); const r = load(); assert.equal(r.status, 'ready');
  const p = structuredClone(r.packet); p.now = c.template_packet.now;
  p.entities[0].expires_at = c.template_packet.entities[0].expires_at;
  p.entities[0].facts.forEach((f, i) => f.expires_at = c.template_packet.entities[0].facts[i].expires_at);
  assert.deepEqual(p, c.template_packet); assert.equal(r.packet.now, new Date(now).toISOString());
  assert.equal(hash(r.wireBody), r.approval.body_hash); assert.equal(r.approval.input_accounting.full_request_verified, false);
  assert.equal(r.approval.input_accounting.upper_bound, null);
});
await test('current-fresh-checks-required-again-at-dispatch', async () => {
  issue(); const r = load(); r.approval.fresh_verification.billing_enabled = true;
  assert.equal((await dispatch(r)).status, 'blocked'); assert.equal(calls, 0);
});
await test('other-attempt-after-issuance-blocks-cached-ready-input', async () => {
  issue(); const r = load(), p = path.join(dir, roots[2]); fs.mkdirSync(p);
  fs.writeFileSync(path.join(p, 'gemini-canary.jsonl'), '{"event":"pending"}\n');
  assert.equal((await dispatch(r)).status, 'blocked'); assert.equal(calls, 0);
});
await test('receipt-correlates-owner-and-execution-authorization', async () => {
  issue(); const r = load(), out = await dispatch(r);
  assert.equal(out.status, 'compatible_unqualified');
  assert.equal(out.receipt.execution_authorization_hash, r.approval.execution_authorization_hash);
  assert.equal(out.receipt.owner_authorization_hash, r.approval.owner_approval_evidence_hash);
  assert.equal(out.receipt.counts_toward_certification, false);
});
for (const [id, change] of [
  ['scenario', p => p.utterance = 'Different synthetic scenario'], ['timestamp', p => p.now = new Date(now + 1).toISOString()],
  ['fact-expiry', p => p.entities[0].facts[0].expires_at = new Date(now + 1800001).toISOString()],
]) await test(`dispatch-blocks-changed-${id}`, async () => {
  issue(); const r = load(); change(r.packet); r.wireBody = JSON.stringify(prepareGeminiShadow(r.packet).body);
  Object.assign(r.approval, {body_hash: hash(r.wireBody), packet_hash: hash(r.packet)});
  assert.equal((await dispatch(r)).status, 'blocked'); assert.equal(calls, 0);
});
for (const [id, change] of [
  ['body-hash', a => a.body_hash = hash('other')], ['schema', a => a.schema_hash = hash('other')],
  ['project', a => a.project = 'other'], ['model', a => a.model = 'other'],
  ['output-cap', a => a.output_tokens = 2048], ['deadline', a => a.deadline_ms = 6000],
  ['execution-hash', a => a.execution_authorization_hash = hash('other')],
  ['extended-window', a => a.expires_at_ms += 1],
]) await test(`dispatch-rejects-${id}`, async () => {
  issue(); const r = load(); change(r.approval); assert.equal((await dispatch(r)).status, 'blocked'); assert.equal(calls, 0);
});
await test('legacy-operator-flags-without-execution-proof-cannot-dispatch', async () => {
  issue(); const r = load(); delete r.approval.execution_authorization_hash;
  assert.equal((await dispatch(r)).status, 'blocked'); assert.equal(calls, 0);
});
await test('expired-window-cannot-load-or-dispatch-or-renew', async () => {
  const owner = signed(); issue(owner); const r = load(), bytes = fs.readFileSync(file(), 'utf8'); now += 300000;
  assert.equal(load().status, 'blocked'); assert.equal((await dispatch(r)).status, 'blocked');
  assert.equal(issue(owner).status, 'blocked'); assert.equal(fs.readFileSync(file(), 'utf8'), bytes); assert.equal(calls, 0);
});
await test('repeated-owner-or-different-owner-id-cannot-issue-another-window', () => {
  const o = signed(); assert.equal(issue(o).status, 'issued'); assert.equal(issue(o).status, 'blocked');
  assert.equal(issue(signed({authorization_id: 'offline-another-authorization'})).status, 'blocked');
});
await test('concurrent-issuance-and-dispatch-remain-single-use', async () => {
  const o = signed(); const attempts = await Promise.all([Promise.resolve().then(() => issue(o)), Promise.resolve().then(() => issue(o))]);
  assert.equal(attempts.filter(r => r.status === 'issued').length, 1);
  const r = load(); const out = await Promise.all([dispatch(r), dispatch(r)]);
  assert.equal(calls, 1); assert.equal(out.filter(x => x.status === 'compatible_unqualified').length, 1);
  assert.equal(load().status, 'blocked'); assert.equal(issue(o).status, 'blocked');
});
for (const ledger of [roots[1], roots[2]]) await test(`existing-uncertain-${ledger}-prevents-issuance`, () => {
  const p = path.join(dir, ledger); fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'gemini-canary.jsonl'), '{"event":"pending"}\n');
  assert.equal(issue().status, 'blocked'); assert(!fs.existsSync(file()));
});
await test('uncertain-execution-write-never-reissued', () => {
  fs.mkdirSync(path.dirname(file())); fs.writeFileSync(file(), '{');
  assert.equal(issue().status, 'blocked'); assert.equal(load().status, 'blocked');
});
await test('tampered-stored-owner-blocks-dispatch', async () => {
  issue(); const r = load(), saved = JSON.parse(fs.readFileSync(file(), 'utf8')); saved.owner.claims.purpose = 'production';
  fs.writeFileSync(file(), JSON.stringify(saved)); assert.equal((await dispatch(r)).status, 'blocked'); assert.equal(calls, 0);
});
await test('tampered-stored-request-blocks-load', () => {
  issue(); const saved = JSON.parse(fs.readFileSync(file(), 'utf8')); saved.packet.utterance = 'other';
  fs.writeFileSync(file(), JSON.stringify(saved)); assert.equal(load().status, 'blocked');
});
await test('changed-canonical-schema-or-instructions-require-new-review', () => {
  const owner = signed(), c = ownerConstraints(); c.normalized_body_hash = hash('changed instruction/configuration');
  fs.writeFileSync(path.join(dir, 'constraints.json'), JSON.stringify(c)); assert.equal(issue(owner).status, 'blocked');
});
await test('changed-constraint-limits-not-accepted', () => {
  const owner = signed(), c = ownerConstraints(); c.policy.outputTokens = 2048;
  fs.writeFileSync(path.join(dir, 'constraints.json'), JSON.stringify(c)); assert.equal(issue(owner).status, 'blocked');
});
await test('owner-expiry-caps-execution-expiry', () => {
  const r = issue(signed({expires_at_ms: now + 10000})); assert.equal(r.expires_at_ms, now + 10000);
});
await test('execution-storage-contains-no-credential-or-credential-digest', () => {
  issue(); const bytes = fs.readFileSync(file(), 'utf8'); assert(!bytes.includes(key)); assert(!bytes.includes(hash(key)));
  assert.equal(fs.statSync(file()).mode & 0o777, 0o600); assert(!fs.existsSync(receipt()));
});
await test('ambient-network-never-enabled-by-signed-approval', async () => {
  issue(); const r = load(); const input = {packet: r.packet, wireBody: r.wireBody, approval: r.approval, apiKey: key, baseline: {}};
  for (const options of [undefined, {fetchImpl: globalThis.fetch}]) assert.equal((await runGeminiCompatibility(input, options)).status, 'blocked');
  assert(!fs.existsSync(receipt()));
});
await test('timeout-consumes-slot-and-late-result-cannot-rewrite-receipt', async () => {
  issue(); const r = load(); let finish;
  const out = await dispatch(r, async () => new Promise(resolve => finish = resolve));
  assert.equal(out.status, 'timed_out_uncertain'); assert.equal(calls, 1);
  const bytes = fs.readFileSync(receipt(), 'utf8'); finish(response(r.packet)); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fs.readFileSync(receipt(), 'utf8'), bytes); assert.equal(load().status, 'blocked');
  assert.equal((await dispatch(r)).status, 'attempt_already_reserved'); assert.equal(calls, 1);
});
await test('process-restart-reuses-exact-window-not-new-approval', () => {
  const owner = signed(); issue(owner); const expected = load();
  const code = `import fs from 'node:fs';import path from 'node:path';const base=${JSON.stringify(base)},dir=${JSON.stringify(dir)},roots=${JSON.stringify(roots)},trust=${JSON.stringify(trust)},constraints=${JSON.stringify(constraints)};
    globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};Date.now=()=>${now};
    const map=p=>{if(p===trust)return path.join(dir,'trust.json');if(p===constraints)return path.join(dir,'constraints.json');for(const r of roots){const f=path.join(base,r);if(typeof p==='string'&&(p===f||p.startsWith(f+path.sep)))return path.join(dir,r)+p.slice(f.length);}return p;};
    for(const n of ['lstatSync','statSync','readFileSync','mkdirSync','openSync']){const original=fs[n];fs[n]=(p,...args)=>original(map(p),...args);}
    const m=await import('./scripts/iq11f-gateway/gemini-owner-authorization.mjs');
    const v=${JSON.stringify(evidence())},key=${JSON.stringify(key)},owner=${JSON.stringify(owner)};
    const r=m.loadGeminiExecution(v,key);console.log(JSON.stringify({status:r.status,hash:r.approval?.body_hash,reissue:m.issueGeminiExecution(owner,v,key).status}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {cwd: ROOT, encoding: 'utf8', timeout: 10000});
  assert.equal(child.status, 0, child.stderr); const out = JSON.parse(child.stdout);
  assert.equal(out.status, 'ready'); assert.equal(out.hash, expected.approval.body_hash); assert.equal(out.reissue, 'blocked');
});
Date.now = oldNow;
for (const [name, original] of Object.entries(originals)) fs[name] = original;
assert.equal(fs.readFileSync(trust, 'utf8'), trustBytes);
for (const r of roots) assert(!fs.existsSync(path.join(base, r)), 'Real state untouched');
console.log(JSON.stringify({pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length,
  checks, provider_calls: 0, inference_calls: 0, real_owner_keys_generated: 0, real_authorizations_issued: 0, real_reservations_created: 0, proof: 'OFFLINE_MOCK_ONLY'}));
process.exitCode = checks.some(c => c.status === 'FAIL') ? 1 : 0;
