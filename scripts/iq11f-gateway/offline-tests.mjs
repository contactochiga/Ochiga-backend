import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync, execFileSync} from 'node:child_process';
import {ROOT, hash, candidateSchema} from '../iq11e/contract.mjs';
import {packet, candidate} from '../iq11e/fixtures.mjs';
import {deterministicBaseline, sourceManifest} from '../iq11e/harness.mjs';
import {defaultRegistry, AdapterRegistry} from './registry.mjs';
import {OfflineGateway} from './gateway.mjs';
import {schemaFor, instruction} from './adapters/common.mjs';
import {mockModel, mockProfile, mockReply, mockBody, mockTransfer} from './mocks.mjs';

globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
const checks = [], ids = ['openai', 'anthropic', 'gemini'], registry = defaultRegistry();
const test = (id, fn) => { try { fn(); checks.push({id, status: 'PASS'}); } catch (e) { checks.push({id, status: 'FAIL', error: e.message}); } };
const base = {canonical: 'unchanged', action_allowed: false};
const route = id => ({provider: id, model: mockModel(id)});
const request = (p, providers = ['openai'], extra = {}) => ({packet: p, baseline: base, route: providers.map(route), inputTokens: Object.fromEntries(providers.map(id => [`${id}/${mockModel(id)}`, 500])), ...extra});
const gateway = (p, providers = ids, opts = {}) => new OfflineGateway({profiles: providers.map(id => mockProfile(id, p)), replies: providers.map(id => mockReply(id, p)), mockBudgetMicroUsd: 1000000, ...opts});

test('registry-has-three-independent-adapters', () => assert.deepEqual(registry.ids(), ['anthropic', 'gemini', 'openai']));
test('duplicate-registry-entry-rejected', () => assert.throws(() => registry.register(registry.get('openai')), /duplicate/));
test('unknown-provider-no-discovery', () => assert.throws(() => registry.get('https://unapproved.invalid')));
test('live-adapter-registration-rejected', () => assert.throws(() => new AdapterRegistry().register({...registry.get('openai'), mode: 'live'})));
test('future-compatible-adapter-explicit-registration', () => { const r = new AdapterRegistry().register({...registry.get('openai'), id: 'future'}); assert.deepEqual(r.ids(), ['future']); });

for (const id of ids) {
  test(`${id}:same-canonical-output`, () => { const p = packet(), r = gateway(p).run(request(p, [id])); assert.equal(r.state, 'valid_shadow'); assert.deepEqual(r.shadow_candidate, candidate(p)); assert.equal(r.adopted, false); assert.equal(r.canonical_decision_changed, false); assert.equal(r.accounting.actual_provider_spend, 0); });
  for (const surface of ['office_internal', 'public_corporate', 'facility', 'consumer']) test(`${id}:surface-${surface}`, () => { const p = packet(surface); assert.equal(gateway(p).run(request(p, [id])).state, 'valid_shadow'); });
  test(`${id}:description-no-execution`, () => { const p = packet(), d = registry.get(id).describe(p, mockModel(id), {input: 4096, output: 1024}); assert.equal(d.sendable, false); assert.equal(d.api_compatibility, 'UNQUALIFIED'); assert(JSON.stringify(d).includes(instruction)); assert(!JSON.stringify(d).includes('api_key')); });
  test(`${id}:wrong-model-rejected`, () => { const b = mockBody(id, candidate()); if (id === 'gemini') b.modelVersion = 'unexpected'; else b.model = 'unexpected'; assert.equal(registry.get(id).normalize(b, mockModel(id)).status, 'invalid_response'); });
  test(`${id}:truncated-never-parsed-as-success`, () => { const p = packet(), r = mockReply(id, p); if (id === 'openai') r.body.status = 'incomplete'; if (id === 'anthropic') r.body.stop_reason = 'max_tokens'; if (id === 'gemini') r.body.candidates[0].finishReason = 'MAX_TOKENS'; assert.equal(gateway(p, [id], {replies: [r]}).run(request(p, [id])).state, 'incomplete'); });
  test(`${id}:refusal-not-shopped`, () => { const p = packet(), r = mockReply(id, p); if (id === 'openai') r.body.output[0].content = [{type: 'refusal', refusal: 'mock refusal'}]; if (id === 'anthropic') r.body.stop_reason = 'refusal'; if (id === 'gemini') r.body.candidates[0].finishReason = 'SAFETY'; const other = ids.find(x => x !== id); const result = gateway(p, ids, {replies: [r, mockReply(other, p)], transfers: [mockTransfer(id, other, p)]}).run(request(p, [id, other])); assert.equal(result.state, 'refused'); assert.equal(result.records.length, 1); });
  test(`${id}:tool-output-rejected`, () => { const p = packet(), r = mockReply(id, p); if (id === 'openai') r.body.output.push({type: 'function_call'}); if (id === 'anthropic') r.body.content.push({type: 'tool_use'}); if (id === 'gemini') r.body.candidates[0].content.parts.push({functionCall: {name: 'arbitrary'}}); assert.equal(gateway(p, [id], {replies: [r]}).run(request(p, [id])).state, 'unexpected_output'); });
  test(`${id}:invalid-candidate-no-repair`, () => { const p = packet(), c = candidate(p); c.frame.operation = 'arbitrary_tool'; const r = gateway(p, [id], {replies: [mockReply(id, p, c)]}).run(request(p, [id])); assert.equal(r.state, 'invalid_candidate'); assert.equal(r.shadow_candidate, null); });
  test(`${id}:unknown-usage-reservation-retained`, () => { const p = packet(), r = mockReply(id, p); delete r.body.usage; delete r.body.usageMetadata; const result = gateway(p, [id], {replies: [r]}).run(request(p, [id])); assert.equal(result.state, 'accounting_uncertain'); assert(result.accounting.mock_held_micro_usd > 0); assert.equal(result.accounting.mock_spent_micro_usd, 0); });
  for (const lock of ['denied', 'cancelled', 'hazard']) test(`${id}:core-${lock}-lock`, () => { const p = packet(), c = candidate(p); Object.assign(c.frame, {operation: 'device.power.off', mutationIntent: true, cognitiveObjective: null}); Object.assign(c.frame.answerTarget, {response_intent: 'CONFIRMATION_STATE', confirmation_kind: 'action'}); const r = gateway(p, [id], {replies: [mockReply(id, p, c)]}).run(request(p, [id], {locks: {[lock]: true}})); assert.equal(r.state, 'invalid_candidate'); });
  test(`${id}:requested-scope-not-substituted`, () => { const p = packet(); assert.equal(gateway(p, [id]).run(request(p, [id], {locks: {subject_scope: 'other_person'}})).state, 'invalid_candidate'); });
  test(`${id}:wire-fields-preserved`, () => { const visit = (s, w) => { if (s.properties) { assert.deepEqual(Object.keys(w.properties), Object.keys(s.properties)); assert.deepEqual(w.required, s.required); assert.equal(w.additionalProperties, false); for (const k of Object.keys(s.properties)) visit(s.properties[k], w.properties[k]); } if (s.enum) assert.deepEqual(w.enum, s.enum); if (s.items) visit(s.items, w.items); if (s.anyOf) s.anyOf.forEach((v, i) => visit(v, w.anyOf[i])); }; visit(candidateSchema, schemaFor(id)); });
}

test('anthropic-cache-input-not-lost', () => { const b = mockBody('anthropic', candidate()); b.usage.cache_read_input_tokens = 20; b.usage.cache_creation_input_tokens = 5; assert.equal(registry.get('anthropic').normalize(b, mockModel('anthropic')).usage.input_total, 125); });
test('gemini-reasoning-not-free', () => { const b = mockBody('gemini', candidate()); b.usageMetadata.thoughtsTokenCount = 30; assert.equal(registry.get('gemini').normalize(b, mockModel('gemini')).usage.output_total, 130); });
test('openai-reasoning-not-double-counted', () => { const b = mockBody('openai', candidate()); b.usage.output_tokens_details.reasoning_tokens = 30; assert.equal(registry.get('openai').normalize(b, mockModel('openai')).usage.output_total, 100); });
test('no-production-packet-or-receipt', () => { const p = packet(); p.data_class = 'production'; assert.equal(gateway(p).run(request(p)).state, 'invalid_packet'); });
test('cross-home-packet-rejected', () => { const p = packet(); p.entities[0].scope_token = 'other'; assert.equal(gateway(p).run(request(p)).state, 'invalid_packet'); });
test('public-office-leak-rejected', () => { const p = packet('public_corporate'); p.entities[0].visibility = 'authorized_synthetic'; assert.equal(gateway(p).run(request(p)).state, 'invalid_packet'); });
test('unapproved-recipient-rejected-before-attempt', () => { const p = packet(); const r = new OfflineGateway().run(request(p)); assert.equal(r.state, 'recipient_not_approved'); assert.equal(r.records.length, 0); });
test('provider-approval-does-not-grant-other-scope', () => { const p = packet(), profile = mockProfile('openai', p); profile.scope_tokens = ['different']; assert.equal(gateway(p, [], {profiles: [profile]}).run(request(p)).state, 'recipient_not_approved'); });
test('expired-recipient-policy-rejected', () => { const p = packet(), profile = mockProfile('openai', p); profile.expires_at = '2000-01-01'; assert.equal(gateway(p, [], {profiles: [profile]}).run(request(p)).state, 'recipient_not_approved'); });
test('provider-off-needs-no-approval-or-receipt', () => { const p = packet(); const b = deterministicBaseline(p); const r = new OfflineGateway().run({packet: p, baseline: b}); assert.equal(r.state, 'provider_off_baseline'); assert.equal(r.baseline_hash, hash(b)); assert.equal(r.records.length, 0); });
test('no-unapproved-fallback-even-with-provider-approvals', () => { const p = packet(), r = mockReply('openai', p); r.transport_status = 'unavailable'; r.billing_status = 'not_accepted'; const out = gateway(p, ids, {replies: [r, mockReply('anthropic', p)]}).run(request(p, ['openai', 'anthropic'])); assert.equal(out.state, 'transfer_not_approved'); assert.equal(out.records.length, 1); });
test('explicit-packet-bound-fallback', () => { const p = packet(), r = mockReply('openai', p); r.transport_status = 'unavailable'; r.billing_status = 'not_accepted'; const out = gateway(p, ids, {replies: [r, mockReply('anthropic', p)], transfers: [mockTransfer('openai', 'anthropic', p)]}).run(request(p, ['openai', 'anthropic'])); assert.equal(out.state, 'valid_shadow'); assert.equal(out.records.length, 2); assert.equal(out.accounting.mock_held_micro_usd, 0); assert(out.records.every(r => r.packet_hash === hash(p))); });
test('transfer-not-reusable-for-different-packet', () => { const p = packet(), t = mockTransfer('openai', 'anthropic', p); p.utterance += ' please'; const r = mockReply('openai', p); r.transport_status = 'unavailable'; r.billing_status = 'not_accepted'; assert.equal(gateway(p, ids, {replies: [r], transfers: [t]}).run(request(p, ['openai', 'anthropic'])).state, 'transfer_not_approved'); });
test('invalid-candidate-never-falls-back', () => { const p = packet(), c = candidate(p); c.tool = 'private_read'; const out = gateway(p, ids, {replies: [mockReply('openai', p, c)], transfers: [mockTransfer('openai', 'anthropic', p)]}).run(request(p, ['openai', 'anthropic'])); assert.equal(out.state, 'invalid_candidate'); assert.equal(out.records.length, 1); });
test('three-recipient-route-rejected', () => { const p = packet(); assert.equal(gateway(p).run(request(p, ids)).state, 'invalid_route'); });
test('unknown-price-blocks', () => { const p = packet(), profile = mockProfile('openai', p); profile.price = null; assert.equal(gateway(p, [], {profiles: [profile]}).run(request(p)).state, 'price_unknown'); });
test('zero-budget-blocks-before-attempt', () => { const p = packet(); const out = gateway(p, ids, {mockBudgetMicroUsd: 0}).run(request(p)); assert.equal(out.state, 'budget_blocked'); assert.equal(out.records.length, 0); });
test('unmeasured-tokens-block', () => { const p = packet(); assert.equal(gateway(p).run(request(p, ['openai'], {inputTokens: {}})).state, 'token_limit_or_unknown'); });
test('oversized-tokens-block', () => { const p = packet(); assert.equal(gateway(p).run(request(p, ['openai'], {inputTokens: {[`openai/${mockModel('openai')}`]: 4097}})).state, 'token_limit_or_unknown'); });
test('missing-and-conflicting-receipts-accounted', () => { const p = packet(), r = mockReply('openai', p); assert.equal(gateway(p, ids, {replies: []}).run(request(p)).state, 'missing_receipt'); assert.equal(gateway(p, ids, {replies: [r, r]}).run(request(p)).state, 'conflicting_receipts'); });
test('wrong-epoch-cannot-return-valid-candidate', () => { const p = packet(), r = mockReply('openai', p); r.context_epoch = 'wrong'; assert.equal(gateway(p, ids, {replies: [r]}).run(request(p)).state, 'correlation_mismatch'); });
test('late-completion-discarded-and-does-not-rewrite-result', () => { const p = packet(), r = mockReply('openai', p); r.elapsed_ms = 3001; const g = gateway(p, ids, {replies: [r]}), out = g.run(request(p)); const before = JSON.stringify(out); r.elapsed_ms = 1; assert.equal(out.state, 'timeout'); assert.equal(out.shadow_candidate, null); assert(Object.isFrozen(out)); assert.equal(JSON.stringify(out), before); });
test('overall-deadline-cannot-reset-on-fallback', () => { const p = packet(), r = mockReply('openai', p); r.elapsed_ms = 3000; r.transport_status = 'unavailable'; r.billing_status = 'not_accepted'; const out = gateway(p, ids, {replies: [r, mockReply('anthropic', p)], transfers: [mockTransfer('openai', 'anthropic', p)]}).run(request(p, ['openai', 'anthropic'])); assert.equal(out.state, 'overall_timeout'); assert.equal(out.records.length, 1); });
test('unknown-billing-stops-fallback-and-new-attempts', () => { const p = packet(), r = mockReply('openai', p); r.transport_status = 'timeout'; const g = gateway(p, ids, {replies: [r], transfers: [mockTransfer('openai', 'anthropic', p)]}); const out = g.run(request(p, ['openai', 'anthropic'])); assert.equal(out.state, 'timeout'); assert.equal(out.records.length, 1); const next = {...p, request_id: 'next-call'}; assert.equal(g.run(request(next)).state, 'accounting_reconciliation_required'); });
test('duplicate-delivery-no-extra-cost-or-attempt', () => { const p = packet(), g = gateway(p); const a = g.run(request(p)), b = g.run(request(p)); assert(b.duplicate_delivery); assert.deepEqual(a.accounting, b.accounting); });
test('changed-safety-lock-retry-rejected', () => { const p = packet(), g = gateway(p); g.run(request(p)); assert.equal(g.run(request(p, ['openai'], {locks: {cancelled: true}})).state, 'conflicting_retry'); });
test('revoked-policy-no-cached-shadow', () => { const p = packet(), g = gateway(p); g.run(request(p)); g.setMockProfiles([]); assert.equal(g.run(request(p)).state, 'recipient_not_approved'); });
test('circuit-opens-and-bounded-half-open-probe', () => {
  const ps = Array.from({length: 5}, (_, i) => ({...packet(), request_id: `circuit-${i}`}));
  const replies = ps.map((p, i) => ({...mockReply('openai', p), billing_status: 'not_accepted', transport_status: i < 3 ? 'unavailable' : 'ok'}));
  const g = gateway(ps[0], ['openai'], {replies});
  for (let i = 0; i < 3; i++) assert.equal(g.run(request(ps[i]), 0).state, 'unavailable');
  assert.equal(g.run(request(ps[3]), 100).state, 'circuit_open');
  assert.equal(g.run(request(ps[4]), 31000).state, 'valid_shadow');
});
test('no-private-payload-in-structural-records', () => { const p = packet(), out = gateway(p).run(request(p)); const s = JSON.stringify(out.records); assert(!s.includes(p.utterance)); assert(!s.includes(p.entities[0].alias)); assert(!s.includes('body')); });
test('unexpected-output-is-not-logged', () => { const p = packet(), r = mockReply('openai', p); r.body.output = [{type: 'function_call', arguments: 'synthetic-private-marker'}]; const s = JSON.stringify(gateway(p, ids, {replies: [r]}).run(request(p))); assert(!s.includes('synthetic-private-marker')); });

const historicalHead = 'e8c74aed00e613270a393aa633aa410253d9962e';
const historicalFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', historicalHead], {cwd: ROOT, encoding: 'utf8'}).trim().split('\n').filter(p => /scripts\/iq11[ef]\/|IQ11[EF]_|iq11[ef]-/.test(p));
const original = historicalFiles.map(p => ({path: p, hash: hash(fs.readFileSync(path.join(ROOT, p), 'utf8'))}));
let inherited;
test('historical-iq11f-and-iq11e-tests-in-isolated-output', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq11f-gateway-'));
  const redirects = ['access-check', 'wire.schema', 'offline-results'].map(s => path.join(ROOT, `artifacts/intelligence-quality-v1-iq11f-${s}.json`));
  const code = `import fs from 'node:fs';import path from 'node:path';const files=${JSON.stringify(redirects)},temp=${JSON.stringify(temp)};const write=fs.writeFileSync;fs.writeFileSync=(p,...args)=>write(files.includes(String(p))?path.join(temp,path.basename(String(p))):p,...args);await import('./scripts/iq11f/offline-tests.mjs');`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {cwd: ROOT, encoding: 'utf8', timeout: 60000});
  assert.equal(run.status, 0, run.stderr); inherited = JSON.parse(run.stdout.trim()); assert.equal(inherited.pass, 25); assert.equal(inherited.inherited.pass, 91);
});
test('all-historical-preparation-files-byte-identical', () => { for (const f of original) { assert.equal(hash(fs.readFileSync(path.join(ROOT, f.path), 'utf8')), f.hash); assert.equal(hash(execFileSync('git', ['show', `${historicalHead}:${f.path}`], {cwd: ROOT, encoding: 'utf8'})), f.hash); } });
test('new-metadata-never-grants-live-approval', () => { const a = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/intelligence-quality-v1-iq11f-gateway-approvals.json'))); assert.equal(a.paid_inference_enabled, false); assert.equal(a.currently_authorized_spend_usd, 0); assert(a.providers.every(p => p.live_approval === null && p.qualified_model === null)); assert.deepEqual(a.approved_cross_provider_transfers, []); });

const schemas = Object.fromEntries(ids.map(id => [id, schemaFor(id)]));
fs.writeFileSync(path.join(ROOT, 'artifacts/intelligence-quality-v1-iq11f-gateway-schemas.json'), JSON.stringify(schemas, null, 2) + '\n');
const files = ['docs/INTELLIGENCE_QUALITY_V1_IQ11F_PROVIDER_NEUTRAL_GATEWAY.md', 'artifacts/intelligence-quality-v1-iq11f-gateway-approvals.json', ...fs.readdirSync(path.join(ROOT, 'scripts/iq11f-gateway')).filter(n => /\.(mjs|ts)$/.test(n)).map(n => `scripts/iq11f-gateway/${n}`), ...fs.readdirSync(path.join(ROOT, 'scripts/iq11f-gateway/adapters')).map(n => `scripts/iq11f-gateway/adapters/${n}`)];
const report = {programme: 'IQ-11F provider-neutral architecture preparation', starting_head: historicalHead, pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, checks, inherited, historical_files_preserved: original, source_manifest: sourceManifest(), preparation_hashes: files.map(p => ({path: p, sha256: hash(fs.readFileSync(path.join(ROOT, p), 'utf8'))})), schema_hashes: Object.fromEntries(ids.map(id => [id, hash(schemas[id])])), instruction_hash: hash(instruction), paid_calls: 0, provider_api_calls: 0, actual_provider_cost: 0, runtime_adoption: false, credentials_changed: false, clock: 'VIRTUAL_MOCK', durability: 'NOT_TESTED', independent_intelligence_cases: 0};
fs.writeFileSync(path.join(ROOT, 'artifacts/intelligence-quality-v1-iq11f-gateway-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({pass: report.pass, fail: report.fail, inherited: inherited ? {iq11f: inherited.pass, iq11e: inherited.inherited.pass} : null, failures: checks.filter(c => c.status === 'FAIL')}));
process.exitCode = report.fail ? 1 : 0;
