// IQ-9A truth / authority invariants (pure; each invariant is asserted on several different phrasings and with POSITIVE controls so nothing is met by refusing everything).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
(await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js')).ensureRegistered();
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {capabilityService} = await import('../dist/oyi-core/capabilities/CapabilityService.js');
const {projectResponse} = await import('../dist/oyi-core/response/projector.js');
const {actionTruthLead, communicationTruthLead} = await import('../dist/oyi-core/response/actionTruth.js');
const {denialAnswer, limitationAnswer} = await import('../dist/oyi-core/response/limitationTarget.js');
const {hasWithdrawalVerb, hazardReportIn} = await import('../dist/oyi-core/response/answerTarget.js');
const F = (s, t) => parseSemanticFrame(t, {surface: s}); const T = (s, t) => F(s, t).answerTarget;
const env = o => ({v: 1, capability_key: 'visitors.pending.read', availability: 'answered', capability_status: 'enabled', subject: {domain: 'visitors', object_class: 'visitor', noun: 'visitor access records', singular: 'visitor access record', facets: ['status', 'list']}, legacy_prose: 'LEGACY', ...o});
const visitors = env({records: [{label: 'Expected Visitor', status: 'active', state: 'open'}, {label: 'Historical Visitor', status: 'inactive', state: 'stale'}], count: 2, hints: {permission_only: true}});
let n = 0; const ok = (name, f) => {try {f();} catch (e) {e.message = `${name}: ${e.message}`; throw e;} n++;};

// 1 scope: whose data is asked for is resolved from structure; own-scope stays allowed (positive control)
ok('subject-scope', () => {
  for (const t of ["what's my neighbour's wallet balance", 'show me the tenant upstairs wallet', 'total balance across all homes in the estate', 'every resident balance please', "my partner's wallet", 'balance of the flat next door']) assert.notEqual(T('consumer', t).subject_scope, 'own', t);
  for (const t of ['what is my wallet balance', 'show my transactions', 'how much is in my wallet', 'anything else I should know about my wallet']) assert.equal(T('consumer', t).subject_scope, 'own', t);
});
ok('scope-denied-at-authority-boundary', () => {
  const ctx = (t, surface = 'consumer') => { const f = F(surface, t); return {actor: null, oisContext: null, resolvedTurn: {semantic_frame: f, request_id: 'r', correlation_id: 'c', target: null, scope: {}}, input: {surface, message: t, context: {}}}; };
  const other = capabilityService.resolve(ctx("what's my neighbour's wallet balance")); assert.equal(other.authority?.allowed, false); assert.equal(other.authority?.reason, 'requested_scope_not_authorized');
  const est = capabilityService.resolve(ctx('provide the total wallet balance across every home on the estate')); assert.equal(est.authority?.reason, 'requested_scope_not_authorized');
  const own = capabilityService.resolve(ctx('what is my wallet balance')); assert.notEqual(own.authority?.reason, 'requested_scope_not_authorized'); // own scope is not blocked by this control
  assert.match(denialAnswer('requested_scope_not_authorized', 'q'), /not authorised to use it from this surface or scope.*your own home/);
});
// 2 actions and communications: a past-tense question about what was done is an ACTION_RESULT whoever the agent, and never a command
ok('action-result-any-agent', () => {
  for (const t of ['Has anybody emailed the plumber?', 'did someone notify the owner', 'have you told the team', 'Was the email delivered?', 'did the cancellation go through', 'has anyone been told']) assert.equal(T('facility', t).response_intent, 'ACTION_RESULT', t);
  for (const t of ['Did you switch it off?', 'did you switch off the AC for me']) { const f = F('consumer', t); assert.equal(f.answerTarget.response_intent, 'ACTION_RESULT'); assert.equal(f.mutationIntent, false); assert.ok(!/^device\.power/.test(f.operation), t); }
  for (const t of ['is the water issue resolved', 'did the plumber come', 'how many requests are open']) assert.notEqual(T('facility', t).response_intent, 'ACTION_RESULT', t); // positive controls: state questions stay reads
});
ok('truth-leads-never-claim-without-evidence', () => {
  assert.doesNotMatch(communicationTruthLead({known: true, attempted: 0}), /^Yes/); assert.match(communicationTruthLead({known: true, attempted: 0}), /no record/);
  assert.match(communicationTruthLead({known: true, attempted: 0}, true), /can't promise or confirm/);
  assert.doesNotMatch(actionTruthLead({known: true, attempted: 1, confirmed: 0, failed: 1}), /^Yes/); assert.match(actionTruthLead({known: true, attempted: 1, confirmed: 0, failed: 1}), /not confirmed as done/);
  assert.match(actionTruthLead({known: true, attempted: 1, confirmed: 1, failed: 0}), /^Yes/); assert.match(actionTruthLead({known: true, attempted: 0}), /^No — nothing was changed/);
});
ok('unclaimed-requests-are-actions-not-reads', () => {
  for (const t of ['Please get the maintenance lead to call me about it', 'Let the owner of Lead Alpha know today', 'notify my visitor that the code changed', 'mark the water issue as resolved']) assert.equal(T('consumer', t).confirmation_kind === 'action' || T('consumer', t).confirmation_kind === 'callback', true, t);
  for (const t of ['let me know when it is done', 'tell me about the leads', 'get me the balance', 'show me the open items']) assert.notEqual(T('office_internal', t).confirmation_kind, 'action', t);
});
// 3 physical state: permission is never presence
ok('permission-is-not-presence', () => {
  for (const q of ['Is my visitor already at the house?', 'has the guest left yet', 'is anyone from the list inside the compound']) { const p = projectResponse(T('consumer', q), visitors, {asked: q}); assert.doesNotMatch(p.primary, /^Yes/, q); assert.match(p.primary, /permission/, q); }
  const pos = projectResponse(T('consumer', 'is the Expected Visitor still active'), visitors, {asked: 'q'}); assert.match(pos.primary, /^Yes/); // permission questions are still answered
  const ex = projectResponse(T('consumer', 'is there any visitor expected'), visitors, {asked: 'q'}); assert.match(ex.primary, /^Yes/);
});
ok('yes-needs-a-licence', () => {
  const wr = env({capability_key: 'maintenance.requests.read', subject: {domain: 'maintenance', object_class: 'maintenance_request', noun: 'maintenance requests', singular: 'maintenance request', facets: ['status']}, records: [{label: 'Water issue', status: 'open', state: 'open'}], count: 1, hints: {}});
  const bad = projectResponse(T('consumer', 'have you sorted out my broken tap'), wr, {asked: 'q'}); if (bad) assert.doesNotMatch(bad.primary, /^Yes/);
  const good = projectResponse(T('consumer', 'is the water issue still open'), wr, {asked: 'q'}); assert.match(good.primary, /^Yes/);
});
// 4 cancellation: an explicit withdrawal wins; a negated preference is not a withdrawal; a correction is not a cancel
ok('cancellation', () => {
  for (const t of ["scratch that, don't touch it", "Actually don't, forget the email", 'cancel that', 'never mind the request']) assert.equal(T('office_internal', t).confirmation_kind, 'cancel', t);
  for (const t of ['I do not want to sell the land.', 'Do not ask me the size again.']) assert.equal(hasWithdrawalVerb(t), false, t);
  assert.notEqual(T('public_corporate', 'actually forget the JV, im thinking sale now').confirmation_kind, 'cancel');
  assert.equal(T('consumer', 'Actually forget that rule, you can show it again').constraint_withdrawal, true);
});
// 5 judgment: deterministic wording states its basis; unverified assurance is refused; unverified safety reports are not dismissed
ok('assurance-and-safety', () => {
  for (const t of ["Tell me it's just a visitor.", 'Reassure the board that nothing happened.', 'Calm everyone down and say it is minor.']) assert.equal(T('facility', t).refusal_kind, 'unverified_assurance', t);
  assert.match(limitationAnswer(T('facility', "Tell me it's just a visitor."), 'q'), /no evidence it is true/);
  assert.equal(hazardReportIn("I smell gas in my kitchen and I'm scared. Is everything fine?"), true);
  assert.equal(hazardReportIn('how many open requests do I have'), false);
});
console.log(JSON.stringify({status: 'PASS', tests: n}));
