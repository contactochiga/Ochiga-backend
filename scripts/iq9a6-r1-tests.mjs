// IQ-9A6 R1 planner-admission tests (pure). Reducing planner takeover must not disable legitimate cognition: every decline has an admit counterpart.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
(await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js')).ensureRegistered();
const {plannerAdmission} = await import('../dist/oyi-core/orchestration/plannerAdmission.js');
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {TRACE_PLANNER_ADMISSION_REASONS} = await import('../dist/oyi-core/observability/conversationTraceProjection.js');
let n = 0; const ok = (name, f) => {try {f();} catch (e) {e.message = `${name}: ${e.message}`; throw e;} n++;};
const base = {headDomainSupportedOnSurface: false, surface: 'consumer', target: undefined, objective: 'assess', continuing: false, mutationOrAction: false, subjectDomains: ['maintenance'], eligibleReadDomains: ['maintenance', 'visitors', 'devices'], headDomain: 'maintenance', conceptDomains: ['maintenance'], hasPublicObjective: false, specificCapability: null};
const A = (s, t, over = {}) => plannerAdmission({...base, surface: s, target: parseSemanticFrame(t, {surface: s}).answerTarget, ...over});
const cap = {key: 'maintenance.requests.read', domain: 'maintenance'};

ok('retrieval-and-status-stay-with-their-capability', () => {
  const r = A('consumer', 'which of my maintenance requests are still open', {specificCapability: cap}); assert.equal(r.admit, false); assert.equal(r.reason, 'specific_governed_capability_owns_retrieval');
  const v = A('consumer', "Is the Historical Visitor's pass still valid?", {subjectDomains: ['visitors'], headDomain: 'visitors', conceptDomains: ['visitors'], specificCapability: {key: 'visitors.pending.read', domain: 'visitors'}}); assert.equal(v.admit, false);
});
ok('genuine-assessments-are-admitted', () => {
  for (const [s, t] of [['facility', 'Which issue should I deal with first?'], ['consumer', 'rank my maintenance requests by what needs doing'], ['office_internal', 'Which task is the priority on my list?'], ['facility', 'Compare the water issue with the light issue']]) {
    const r = A(s, t, {specificCapability: cap}); assert.equal(r.admit, true, t); // a more specific read never takes a ranking or comparison away from governed judgment
  }
});
ok('specialised-truth-paths-are-not-assessments', () => {
  for (const t of ['Did the bedroom light get turned off?', 'Did the owner get my message? Check delivery.']) { const r = A('consumer', t); assert.equal(r.admit, false, t); assert.match(r.reason, /specialised_answer_shape_action_result/); }
  assert.equal(A('consumer', 'turn off the kitchen light', {mutationOrAction: true}).admit, false);
});
ok('continuation-is-admitted', () => {
  assert.equal(A('office_internal', 'Why did you rank that first?', {continuing: true}).reason, 'continuation_of_existing_assessment');
  assert.equal(A('consumer', 'which of my maintenance requests are still open', {continuing: true, specificCapability: cap}).admit, true); // an established assessment is not hijacked from, but also not forced onto a lookup when none exists
});
ok('public-needs-an-objective-and-an-evidence-class', () => {
  const d = A('public_corporate', 'Is it safe to buy into your estates? I heard about break-ins.', {subjectDomains: [], headDomain: null, conceptDomains: []}); assert.equal(d.admit, false); assert.equal(d.reason, 'no_established_public_objective');
  const a = A('public_corporate', 'Given what I told you, how strong is my opportunity?', {hasPublicObjective: true, subjectDomains: ['corporate_opportunity'], headDomain: null, conceptDomains: []}); assert.equal(a.admit, true);
});
ok('subject-owned-by-another-surface-declines-only-without-an-owner', () => {
  const o = {surface: 'office_internal', subjectDomains: ['office_development'], eligibleReadDomains: ['crm'], headDomain: 'visitors', conceptDomains: ['visitors']};
  assert.equal(A('office_internal', 'Can you confirm whether any visitors are on the estate at the moment?', o).reason, 'subject_not_available_on_surface');
  assert.equal(A('facility', 'Which devices need attention?', {headDomain: 'devices', conceptDomains: ['devices'], subjectDomains: ['devices'], eligibleReadDomains: ['maintenance'], headDomainSupportedOnSurface: true}).admit, true); // a domain whose read exists here but is scope-limited keeps the planner's evidence-limit statement
  assert.equal(A('consumer', 'Can you check if my front door camera caught anyone?', {headDomain: 'cameras', conceptDomains: ['cameras'], subjectDomains: ['devices'], specificCapability: {key: 'security.incidents.read', domain: 'security'}}).admit, true); // a mis-matched owner never turns a camera question into "no incidents"
});
ok('wallet-has-no-planner-class', () => {
  const r = A('consumer', 'Which was bigger, the electricity purchase or the wallet funding?', {subjectDomains: ['wallet'], headDomain: 'wallet', conceptDomains: ['wallet'], eligibleReadDomains: ['wallet', 'maintenance']}); assert.equal(r.admit, false); assert.equal(r.reason, 'no_applicable_evidence_class');
});
ok('reasons-are-a-closed-structural-set', () => {
  const reasons = new Set(); for (const o of [{continuing: true}, {mutationOrAction: true}, {surface: 'public_corporate'}, {specificCapability: cap}, {subjectDomains: ['wallet'], headDomain: 'wallet'}, {}]) reasons.add(A('consumer', 'which of my maintenance requests are still open', o).reason);
  for (const r of reasons) assert(TRACE_PLANNER_ADMISSION_REASONS.includes(r), r); // every reason is trace-projectable; no prompt or evidence text is ever part of it
});
console.log(JSON.stringify({status: 'PASS', tests: n}));
