// IQ-9A8 R4 reference-precedence and context tests (pure).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
(await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js')).ensureRegistered();
const {parseFollowUpIntent, resolveFollowUpReference, namedFieldAnswer} = await import('../dist/oyi-core/interpretation/followUpResolver.js');
const {contactConstraintsIn} = await import('../dist/oyi-core/capabilities/PublicOpportunityCapabilityModule.js');
const {plannerAdmission} = await import('../dist/oyi-core/orchestration/plannerAdmission.js');
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
let n = 0; const ok = (name, f) => {try {f();} catch (e) {e.message = `${name}: ${e.message}`; throw e;} n++;};
const ref = (id, label, status = 'open', extra = {}) => ({object_type: 'x', canonical_id: id, label, occurred_at: null, metric: null, metric_value: null, status, attributes: {}, ...extra});
const set = (refs, over = {}) => ({object_refs: refs, selected_object_ref: null, result_count: refs.length, source_message: '', ...over});

ok('explicit-selection-beats-everything', () => {
  const a = ref('a', 'Wave11 Expected Visitor'), b = ref('b', 'Wave11 Historical Visitor');
  assert.equal(resolveFollowUpReference(set([a, b], {selected_object_ref: a, source_message: 'is the Historical Visitor still valid'}), {type: 'other'}).ref.canonical_id, 'b'); // a selected object is the subject; "other" is the remaining one
});
ok('subject-named-by-the-producing-turn-is-the-previous-subject', () => {
  const a = ref('a', 'Wave11 Expected Visitor'), b = ref('b', 'Wave11 Historical Visitor');
  assert.equal(resolveFollowUpReference(set([a, b], {source_message: 'And is the Expected Visitor here yet?'}), {type: 'other'}).ref.canonical_id, 'b');
  assert.equal(resolveFollowUpReference(set([a, b], {source_message: 'is the Expected Visitor still valid'}), {type: 'pronoun'}).ref.canonical_id, 'a');
});
ok('nothing-is-inferred-from-a-list-question-or-an-unrelated-list', () => {
  const a = ref('a', 'Wave11 Expected Visitor'), b = ref('b', 'Wave11 Historical Visitor');
  assert.equal(resolveFollowUpReference(set([a, b], {source_message: 'Who are my expected visitors?'}), {type: 'other'}).status, 'ambiguous'); // the plural in a list question does not name one record
  assert.equal(resolveFollowUpReference(set([a, b], {source_message: 'Show me the maintenance requests.'}), {type: 'other'}).status, 'ambiguous');
  assert.equal(resolveFollowUpReference(set([a, b], {source_message: 'the Expected Visitor and the Historical Visitor'}), {type: 'pronoun'}).status, 'ambiguous'); // two named: still a question to the user
  assert.equal(resolveFollowUpReference(null, {type: 'other'}).status, 'unresolved'); // an expired or absent set is never recovered
});
ok('valid-ordinals-and-states-still-resolve', () => {
  const a = ref('a', 'Water issue', 'open'), b = ref('b', 'Light issue', 'resolved');
  assert.equal(resolveFollowUpReference(set([a, b]), {type: 'ordinal', ordinal: 'second'}).ref.canonical_id, 'b');
  assert.equal(resolveFollowUpReference(set([a, b]), parseFollowUpIntent('which is the resolved one')).ref.canonical_id, 'b');
});
ok('natural-follow-ups-parse', () => {
  assert.equal(parseFollowUpIntent('Is that one still open?').type, 'status_check');
  assert.equal(parseFollowUpIntent('What happened to that request?').type, 'status_check');
  assert.equal(parseFollowUpIntent('and the other one?').type, 'other');
  assert.deepEqual(parseFollowUpIntent('and units sold for that?'), {type: 'named_field', phrase: 'units sold'});
});
ok('named-field-is-read-from-the-record-or-stated-absent', () => {
  assert.match(namedFieldAnswer('VI Development', 'units sold', {status: 'planning', units_sold: '0', units_total: '40'}), /units sold 0 of 40 units/);
  const absent = namedFieldAnswer('Water issue', 'units sold', {status: 'open', priority: 'high'}, 'open'); assert.match(absent, /doesn't include a “units sold” figure/); assert.doesNotMatch(absent, /\d/);
});
ok('contact-preferences-are-recognised-and-narrow', () => {
  assert.deepEqual(contactConstraintsIn('Please never contact me by phone.'), ['no_phone_contact']);
  assert.deepEqual(contactConstraintsIn("On second thought don't call me. Keep what I told you though."), ['no_phone_contact']);
  assert.deepEqual(contactConstraintsIn('Only contact me on WhatsApp'), ['only_whatsapp']);
  for (const t of ['Land in Abuja, lease, no title papers yet. Call me back.', 'Please call me back.', 'I have no phone number to share but email works', 'Do not sell my land']) assert.deepEqual(contactConstraintsIn(t), [], t);
});
ok('planner-yields-to-a-reference-to-the-held-result-set', () => {
  const base = {surface: 'consumer', target: parseSemanticFrame('and the other one?', {surface: 'consumer'}).answerTarget, objective: 'assess', continuing: true, mutationOrAction: false, subjectDomains: ['maintenance'], eligibleReadDomains: ['maintenance'], headDomain: null, headDomainSupportedOnSurface: false, conceptDomains: [], hasPublicObjective: false, specificCapability: null, referencesStoredResultSet: true};
  assert.equal(plannerAdmission(base).admit, false); assert.equal(plannerAdmission(base).reason, 'reference_to_stored_result_set');
  assert.equal(plannerAdmission({...base, referencesStoredResultSet: false}).admit, true); // without the reference, an established assessment still continues
});
console.log(JSON.stringify({status: 'PASS', tests: n}));
