// IQ-9A4 R0 truth and state consistency tests. Pure (no database, no network, nothing sent). Every corrected failure has an authorized positive counterpart.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
// no real Office call may leave this process: every axios call is intercepted
const axios = require('axios'); const calls = []; let nextHttp = null;
axios.post = async (url, body) => {calls.push({url, body}); if (nextHttp instanceof Error) throw nextHttp; return nextHttp ?? {status: 200, data: {}};};
process.env.OFFICE_SYNC_API_KEY = 'test-key-not-real';
(await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js')).ensureRegistered();
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {isCancellationUtterance} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {projectResponse} = await import('../dist/oyi-core/response/projector.js');
const {visitorPassState} = await import('../dist/oyi-core/domains/visitors/visitorPassState.js');
const {contextStatements} = await import('../dist/oyi-core/evidence/judgment/deterministic.js');
const {acknowledgeConstraint} = await import('../dist/oyi-core/response/constraintAck.js');
const {classifyHandoff, composeCallbackAnswer} = await import('../dist/oyi-core/capabilities/PublicOpportunityCapabilityModule.js');
const {requestOfficeHandoff} = await import('../dist/oyi-core/ingress/officeHandoffBridge.js');
const T = (s, t) => parseSemanticFrame(t, {surface: s}).answerTarget;
let n = 0; const ok = async (name, f) => {try {await f();} catch (e) {e.message = `${name}: ${e.message}`; throw e;} n++;};
const NOW = Date.parse('2026-10-07T12:00:00Z'), past = '2026-10-02T00:00:00Z', future = '2026-10-20T00:00:00Z';
const env = (records, hints = {permission_only: true}, noun = 'visitor access records', singular = 'visitor access record', key = 'visitors.pending.read', domain = 'visitors', object_class = 'visitor') => ({v: 1, capability_key: key, availability: 'answered', capability_status: 'enabled', subject: {domain, object_class, noun, singular, facets: ['status', 'list']}, records, count: records.length, hints, legacy_prose: 'LEGACY'});

// 1 canonical visitor activity
await ok('pass-state-matrix', () => {
  const S = (status, expires_at) => visitorPassState({status, expires_at}, NOW);
  assert.equal(S('active', future), 'active'); assert.equal(S('active', null), 'active'); assert.equal(S('active', 'not a date'), 'active'); // incomplete expiry evidence: status stands, nothing is invented
  assert.equal(S('active', past), 'active_past_expiry'); // never "active", never "expired" on status alone
  assert.equal(S('expired', future), 'inactive'); assert.equal(S('inactive', null), 'inactive'); assert.equal(S('revoked', null), 'inactive');
  assert.equal(S('pending', future), 'pending'); assert.equal(S('weird', null), 'unknown');
});
await ok('judgment-never-asserts-false-zero', () => {
  const k = material => ({availability: 'available', evidence_class: 'visitors', source_key: 'visitors.pending.read', record_count: material.length, material, degraded: [], unobserved: 0});
  const run = material => contextStatements({}, {contributions: [k(material)], classes: []}).facts.join(' ');
  const conflict = run([{status: 'active', expires_at: past}, {status: 'expired', expires_at: past}]);
  assert.match(conflict, /0 currently active, 1 recorded active but past its recorded expiry \(validity not confirmed\), 1 expired/); assert.doesNotMatch(conflict, /^visitor access: 0 currently active, 0 /);
  assert.match(run([{status: 'active', expires_at: future}, {status: 'expired', expires_at: past}]), /1 currently active, 1 expired/); // positive control: a valid pass is counted active
});
await ok('projection-never-confirms-expired-as-valid', () => {
  const conflict = env([{label: 'Expected Visitor', status: 'active, past its recorded expiry', state: 'open'}, {label: 'Historical Visitor', status: 'inactive', state: 'stale'}]);
  for (const q of ['Do I have any visitor pass that is currently active?', 'how many of my passes are valid right now', 'which of my visitor passes are active']) {
    const p = projectResponse(T('consumer', q), conflict, {asked: q, raw: q}); assert(p, q);
    assert.doesNotMatch(p.primary, /^Yes|^There (?:is|are) \d+ (?:active|valid)|none active|0 active/i, q); assert.match(p.primary, /past (?:its|their) recorded expiry|isn't confirmed/, q);
  }
  const valid = env([{label: 'Expected Visitor', status: 'active', state: 'open'}, {label: 'Historical Visitor', status: 'inactive', state: 'stale'}]);
  const pos = projectResponse(T('consumer', 'Do I have any visitor pass that is currently active?'), valid, {asked: 'q', raw: 'Do I have any visitor pass that is currently active?'}); assert.match(pos.primary, /^Yes/); // a genuinely active pass is still affirmed
  const list = projectResponse(T('consumer', 'Which visitor passes are on my account?'), conflict, {asked: 'q', raw: 'Which visitor passes are on my account?'}); assert.match(list.primary, /Expected Visitor/); // permission-status listing is preserved
});
// 2 affirmative-answer licensing
await ok('attention-yes-needs-a-record', () => {
  const open = env([{label: 'Water issue', status: 'open', state: 'open', detail: 'high priority'}], {}, 'maintenance requests', 'maintenance request', 'maintenance.requests.read', 'maintenance', 'maintenance_request');
  for (const q of ['Is there a record of my water issue being looked at?', 'Has anyone been assigned to my water issue?', 'Is somebody dealing with the water issue?']) {
    const p = projectResponse(T('consumer', q), open, {asked: q, raw: q}); if (!p) continue; assert.doesNotMatch(p.primary, /^Yes/, q); assert.match(p.primary, /can't confirm that anyone/, q);
  }
  const progress = env([{label: 'Water issue', status: 'in progress', state: null}], {}, 'maintenance requests', 'maintenance request', 'maintenance.requests.read', 'maintenance', 'maintenance_request');
  const yes = projectResponse(T('consumer', 'Is somebody dealing with the water issue?'), progress, {asked: 'q', raw: 'Is somebody dealing with the water issue?'}); assert.match(yes.primary, /^Yes — recorded as in progress or assigned/); // a recorded progress status licenses the YES
  const st = projectResponse(T('consumer', 'Is my water issue still open?'), open, {asked: 'q', raw: 'Is my water issue still open?'}); assert.match(st.primary, /^Yes/); // ordinary state questions are unchanged
});
// 5 financial disclosure and constraints
await ok('disclosure-constraint-is-not-a-cancellation', () => {
  for (const [s, q] of [['office_internal', 'Do not share the financial figures outside this conversation.'], ['office_internal', "Don't disclose the portfolio revenue to anyone outside this chat."], ['consumer', 'never reveal my wallet balance to anyone else']]) {
    assert.equal(isCancellationUtterance(q), false, q); const t = T(s, q); assert.equal(t.confirmation_kind, 'constraint', q); assert.notEqual(parseSemanticFrame(q, {surface: s}).operation, 'cancel', q);
  }
  for (const q of ["Don't share it", "don't send it", 'scrap that']) assert.equal(isCancellationUtterance(q), true, q); // genuine withdrawals still cancel
  for (const q of ['Share the financial figures with me', 'What are the portfolio totals for balance and revenue?']) assert.notEqual(T('office_internal', q).confirmation_kind, 'constraint', q); // authorized questions are not constraints
});
await ok('constraint-ack-has-no-values-and-no-enforcement-claim', () => {
  const a = acknowledgeConstraint('Do not share the financial figures outside this conversation.');
  assert.doesNotMatch(a, /\d|NGN|₦/); assert.match(a, /this conversation only/); assert.doesNotMatch(a, /permanently|always|from now on|forever|durabl/i); // conversation-scoped, no durable-enforcement claim, no values
  assert.match(acknowledgeConstraint("Don't ask me the size again"), /Understood/); // other constraint wording is unchanged
});
// 6 public handoff receipt, end to end through the module with an isolated requester
const ctx = {input: {thread_id: 'thread-1'}, resolvedTurn: {request_id: 'req-1'}};
const objective = {objective_type: 'land', known_facts: {location: 'Abuja', structure_offered: 'lease'}, constraints: []};
const R = async (result, obj = objective) => {let seen = 0; const out = await composeCallbackAnswer(ctx, obj, async () => {seen++; return result;}); assert.equal(seen, 1, 'exactly one handoff attempt'); return out;};
await ok('handoff-stages', async () => {
  const acc = await R({ok: true, handoff_id: 'h-1', status: 'open', created: true, routing_status: 'routed'});
  assert.equal(acc.metadata.handoff_stage, 'accepted_receipt_recorded'); assert.equal(acc.metadata.contact_completed, false); assert.equal(acc.metadata.office_handoff_id, 'h-1'); assert.match(acc.answer, /received your callback request/); assert.match(acc.answer, /not been booked or confirmed, and no one has contacted you yet/); assert.doesNotMatch(acc.answer, /\b(?:will call|has been scheduled|is booked|completed)\b/i);
  const rej = await R({ok: false, reason: 'office_rejected'}); assert.equal(rej.metadata.handoff_stage, 'rejected'); assert.equal(rej.status, 'unavailable'); assert.match(rej.answer, /did not accept/); assert.equal(rej.metadata.office_handoff_retryable, true);
  const rej2 = await R({ok: true, handoff_id: 'h-2', status: 'rejected', created: false, routing_status: ''}); assert.equal(rej2.metadata.handoff_stage, 'rejected');
  const un = await R({ok: false, reason: 'not_configured'}); assert.equal(un.metadata.handoff_stage, 'unavailable'); assert.match(un.answer, /couldn't pass/);
  const un2 = await R({ok: false, reason: 'connect ECONNREFUSED'}); assert.equal(un2.metadata.handoff_stage, 'unavailable');
  const nor = await R({ok: true, handoff_id: '', status: 'open', created: true, routing_status: ''}); assert.equal(nor.metadata.handoff_stage, 'attempted_no_receipt'); assert.match(nor.answer, /did not get a receipt/); assert.equal(nor.metadata.office_handoff_ok, false);
  for (const x of [rej, rej2, un, un2, nor]) assert.equal(x.metadata.contact_completed, false);
  const done = await R({ok: true, handoff_id: 'h-3', status: 'completed', created: false, routing_status: 'routed'}); // only the Office receipt itself can evidence completion
  assert.equal(done.metadata.handoff_stage, 'contact_completed'); assert.equal(done.metadata.contact_completed, true); assert.match(done.answer, /team's record shows/);
  assert.equal(classifyHandoff({ok: true, handoff_id: 'h-4', status: 'accepted', created: true, routing_status: 'routed'}), 'accepted_receipt_recorded'); // acceptance alone never means contact happened
  const bare = await R({ok: true, handoff_id: 'h-5', status: 'open', created: true, routing_status: ''}, null); assert.equal(bare.metadata.handoff_stage, 'accepted_receipt_recorded'); // authorized request with no qualification yet is still processed truthfully
});
await ok('bridge-transport-outcomes-without-network', async () => {
  const before = calls.length;
  nextHttp = {status: 200, data: {ok: true, handoff: {handoff_id: 'h-9', status: 'open'}, created: true, routing_status: 'routed'}}; assert.equal(classifyHandoff(await requestOfficeHandoff({lead_id: 'l', business_unit: 'general', requested_capability: 'callback_request', reason: 'r'})), 'accepted_receipt_recorded');
  nextHttp = {status: 200, data: {ok: false, error: 'office_rejected'}}; assert.equal(classifyHandoff(await requestOfficeHandoff({lead_id: 'l', business_unit: 'general', requested_capability: 'callback_request', reason: 'r'})), 'rejected');
  nextHttp = {status: 422, data: {}}; assert.equal(classifyHandoff(await requestOfficeHandoff({lead_id: 'l', business_unit: 'general', requested_capability: 'callback_request', reason: 'r'})), 'rejected');
  nextHttp = {status: 503, data: {}}; assert.equal(classifyHandoff(await requestOfficeHandoff({lead_id: 'l', business_unit: 'general', requested_capability: 'callback_request', reason: 'r'})), 'unavailable');
  nextHttp = new Error('socket hang up'); assert.equal(classifyHandoff(await requestOfficeHandoff({lead_id: 'l', business_unit: 'general', requested_capability: 'callback_request', reason: 'r'})), 'unavailable');
  assert.equal(calls.length - before, 5); assert(calls.every(c => /handoff-request$/.test(c.url))); nextHttp = null;
  const key = process.env.OFFICE_SYNC_API_KEY; delete process.env.OFFICE_SYNC_API_KEY; delete process.env.OFFICE_EXPORT_API_KEY;
  assert.equal((await requestOfficeHandoff({lead_id: 'l', business_unit: 'general', requested_capability: 'callback_request', reason: 'r'})).reason, 'not_configured'); process.env.OFFICE_SYNC_API_KEY = key;
});
console.log(JSON.stringify({status: 'PASS', tests: n, intercepted_http_calls: calls.length}));
