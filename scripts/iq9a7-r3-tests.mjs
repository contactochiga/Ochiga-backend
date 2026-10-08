// IQ-9A7 R3 multi-part tests (pure): clause splitting and multipart planning. Every split has a single-question counterpart that must NOT split.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
const orch = await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js'); orch.ensureRegistered();
const {splitInformationalClauses, deriveAnswerTarget} = await import('../dist/oyi-core/response/answerTarget.js');
const {projectResponse} = await import('../dist/oyi-core/response/projector.js');
let n = 0; const ok = (name, f) => {try {f();} catch (e) {e.message = `${name}: ${e.message}`; throw e;} n++;};

ok('splits-independent-questions-in-order', () => {
  assert.deepEqual(splitInformationalClauses('Any security incidents logged, and is the camera working?'), ['Any security incidents logged?', 'is the camera working?']);
  assert.deepEqual(splitInformationalClauses('How many visitor passes do I have and which are active?'), ['How many visitor passes do I have?', 'which are active?']);
  assert.deepEqual(splitInformationalClauses('Tell me the status of VI Development and whether any report is awaiting sign-off.').length, 2);
  assert.deepEqual(splitInformationalClauses('Is the camera working? Also, are there any security incidents logged?'), ['Is the camera working?', 'are there any security incidents logged?']);
  assert.equal(splitInformationalClauses('A? B? C? D?'.replace(/[A-D]/g, 'is it open')).length, 3); // bounded to three clauses
});
ok('single-questions-never-split', () => {
  for (const t of ["What's the temperature and humidity in my bedroom?", 'Which was bigger, the electricity purchase or the wallet funding?', 'If the camera comes back online, what changes?', 'Show leads and opportunities', 'Between VI Development and Abuja JV, which has gone longer without activity?', 'I own land in Abuja, about 3 acres, and want to lease it. What have you got from me so far?', 'What maintenance requests do I have?', 'Hi, how are you?']) assert.deepEqual(splitInformationalClauses(t), [], t);
});
ok('clause-contract-keeps-order-and-shares-the-subject-of-an-elliptical-clause', () => {
  const t = deriveAnswerTarget('How many visitor passes do I have and which are active?', {surface: 'consumer'});
  assert.equal(t.clauses.length, 2); assert.equal(t.clauses[0].text, 'How many visitor passes do I have?'); assert.equal(t.clauses[0].target.response_intent, 'COUNT');
  assert.equal(t.clauses[1].target.object, t.clauses[0].target.object); // "which are active" is about the same records, never another turn's list
  assert.equal(deriveAnswerTarget('What maintenance requests do I have?', {surface: 'consumer'}).clauses, undefined); // single questions carry no clause list
});
ok('same-domain-clauses-stay-one-governed-read', () => {
  assert.equal(orch.planMultipart('How many visitor passes do I have and which are active?', 'consumer'), null);
  assert.equal(orch.planMultipart('How much have I spent on utilities, and what were my two wallet entries?', 'consumer'), null);
});
ok('different-domains-are-separate-governed-turns', () => {
  const p = orch.planMultipart('Any security incidents logged, and is the camera working?', 'facility'); assert.equal(p.mode, 'info'); assert.equal(p.fragments.length, 2); assert.notEqual(p.fragments[0].key, p.fragments[1].key);
  const q = orch.planMultipart('Is there a report waiting for approval, and what is the status of VI Development?', 'office_internal'); assert.equal(q.fragments.length, 2);
});
ok('an-unresolved-subject-is-never-folded-into-the-previous-clause', () => {
  const p = orch.planMultipart('Is the camera working, and is there anything about the generators?', 'facility');
  assert(p === null || new Set(p.fragments.map(f => f.key)).size === 2, 'the generators clause must be its own group or the turn is not split');
});
ok('read-plus-action-is-planned-as-mixed-and-keeps-the-action-last-in-execution', () => {
  const p = orch.planMultipart('Show my maintenance requests, and turn off the Kitchen Light', 'consumer'); assert.equal(p.mode, 'mixed'); assert.equal(p.fragments.filter(f => f.mutation).length, 1);
  assert.equal(orch.planMultipart('Turn off the Kitchen Light and turn off the AC', 'consumer'), null); // two actions are not a read path
  assert.equal(orch.planMultipart('Turn off the Kitchen Light', 'consumer'), null);
});
ok('judgment-and-single-domain-questions-are-not-multipart', () => {
  assert.equal(orch.planMultipart('Which task is the priority, and which one should I do first?', 'office_internal'), null);
  assert.equal(orch.planMultipart('Should we put more money into VI Development? Is it a good project?', 'office_internal'), null);
});
ok('projection-per-clause-reports-an-unanswerable-clause-instead-of-dropping-it', () => {
  const env = {v: 1, capability_key: 'visitors.pending.read', availability: 'answered', capability_status: 'enabled', subject: {domain: 'visitors', object_class: 'visitor', noun: 'visitor access records', singular: 'visitor access record', facets: ['status', 'list']}, records: [{label: 'Expected Visitor', status: 'active', state: 'open'}, {label: 'Historical Visitor', status: 'inactive', state: 'stale'}], count: 2, hints: {permission_only: true}, legacy_prose: 'LEGACY'};
  const t = deriveAnswerTarget('How many visitor passes do I have and which are active?', {surface: 'consumer'});
  const a = projectResponse(t.clauses[0].target, env, {asked: 'q', raw: t.clauses[0].text}), b = projectResponse(t.clauses[1].target, env, {asked: 'q', raw: t.clauses[1].text});
  assert.match(a.primary, /2 visitor access records/); assert.match(b.primary, /Expected Visitor/); assert.notEqual(a.primary, b.primary); // two different answers from one envelope
});
console.log(JSON.stringify({status: 'PASS', tests: n}));
