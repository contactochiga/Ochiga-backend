// IQ-9A10 R6 operation-selection tests (pure; nothing reaches a database or a device).
import assert from 'node:assert/strict';
const {deriveAnswerTarget, normalizeIndirectCommand} = await import('../dist/oyi-core/response/answerTarget.js');
const {projectResponse} = await import('../dist/oyi-core/response/projector.js');
let n = 0; const ok = (name, f) => {try {f();} catch (e) {e.message = `${name}: ${e.message}`; throw e;} n++;};
const T = (m, surface = 'consumer') => deriveAnswerTarget(m, {surface});
// indirect device commands become the imperative form
const N = normalizeIndirectCommand;
ok('mind', () => assert.equal(N('Would you mind turning the Bedroom Light off?'), 'Turn the Bedroom Light off'));
ok('like', () => assert.equal(N("I'd like the Kitchen Light off"), 'Turn the Kitchen Light off'));
ok('could', () => assert.equal(N('Could you switch the AC on please'), 'Turn the AC on'));
ok('turn-off-first', () => assert.equal(N('Could you turn off the AC?'), 'Turn off the AC'));
ok('keep imperative', () => assert.equal(N('Switch off the Living Light'), 'Switch off the Living Light'));
// positive counterparts: not a device command -> untouched
ok('not device', () => assert.equal(N("I'd like the report on"), "I'd like the report on"));
ok('question state', () => assert.equal(N('Is the Living Light on?'), 'Is the Living Light on?'));
ok('past', () => assert.equal(N('Did you turn off the AC?'), 'Did you turn off the AC?'));
// polite requests for non-device mutations are action requests, never reads
for (const m of ['Can you mark Lead Alpha as contacted?', 'Could you update the status of Lead Beta to qualified?', 'Can you notify my expected visitor that the gate code changed?', 'Could you tell my expected visitor I will be late?', 'Would you mind sending the report to the team'])
  ok(m, () => { const t = T(m); assert.equal(t.response_intent, 'CONFIRMATION_STATE'); assert.equal(t.confirmation_kind, 'action'); });
// positive counterparts: reads and "me" requests stay reads
for (const m of ['What is the status of Lead Alpha?', 'Can you tell me the status of Lead Alpha?', 'Could you show me my visitors?', 'Can you send me the summary?'])
  ok(m, () => assert.notEqual(T(m).confirmation_kind, 'action'));
ok('public polite unchanged', () => assert.notEqual(T('Can you update me on this?', 'public_corporate').confirmation_kind, 'action'));
// "which X did you <act>" asks what was done
ok('which did you', () => assert.equal(T('Which light did you turn off?').response_intent, 'ACTION_RESULT'));
ok('what did you send', () => { const t = T('What did you send to the team?'); assert.equal(t.response_intent, 'ACTION_RESULT'); assert.equal(t.action_domain, 'communication'); });
ok('did you (positive)', () => assert.equal(T('Did you turn off the AC?').response_intent, 'ACTION_RESULT'));
ok('what did you find stays a read', () => assert.notEqual(T('What did you find about my wallet?').response_intent, 'ACTION_RESULT'));
// choice questions are answered with the alternative, never a bare Yes
const held = known => ({subject: {domain: 'corporate', object_class: 'opportunity', noun: 'x', singular: 'x', facets: []}, held_facts: {known, missing: []}, legacy_prose: 'l'});
const ask = (q, known) => projectResponse(T(q, 'public_corporate'), held(known), {asked: q, raw: q});
ok('choice hit', () => { const p = ask('Is it for sale or lease?', {structure_offered: 'sale'}); assert.match(p.primary, /^Sale, as you told me/); assert.doesNotMatch(p.primary, /^Yes/); });
ok('choice neither', () => { const p = ask('Is it a sale or a lease?', {structure_offered: 'JV'}); assert.match(p.primary, /haven't told me it is sale or lease/); assert.doesNotMatch(p.primary, /^Yes/); });
ok('single fact still yes', () => assert.match(ask('Is it for sale?', {structure_offered: 'sale'}).primary, /^Yes/));
console.log(JSON.stringify({status: 'PASS', tests: n}));
