// IQ-7B deterministic parser tests: frozen-objective parity for the five audited prompts, hold/callback/status structure, false-positive controls.
import assert from 'node:assert/strict';
const {parseSemanticFrame: P} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const o = (t, a) => P(t, a === undefined ? {} : {activeAssessment: a}).cognitiveObjective;
// parity (previously objective-bearing frozen prompts keep their objective)
assert.equal(o('What else would make this worth reviewing?'), 'advise');
assert.equal(o('I do not know the planning designation.'), 'assess');
assert.equal(o('What should we verify before replacing anything?'), 'advise');
assert.equal(o('What should security check rather than assume?'), 'compare');
assert.equal(o('What can you say estate-wide?'), 'assess');
assert.equal(o('Why?'), 'explain'); assert.equal(o('Why?', true), 'explain'); assert.equal(o('Why?', false), null);
// status vs assessment vs advice vs prioritisation
assert.equal(o('What is the status of the generator?'), 'retrieve');
assert.equal(o('Is the generator okay?'), 'assess');
assert.equal(o('What should I do about the generator?'), 'advise');
assert.equal(o('Which generator fault matters most?'), 'prioritize');
// hold / callback never carry executable intent and never become advice
for (const t of ['Keep the schedule as it is.', 'Freeze the budget where it is.', 'Please ring me tomorrow.', 'Abeg make person call me.']) {const f = P(t); assert.equal(f.mutationIntent, false, t); assert.equal(f.cognitiveObjective, null, t);}
assert.equal(P('Should I leave it as it is?').mutationIntent, false);
assert.equal(o('Should I ask them to call me?'), 'advise');
// cancellation stays a cancellation
for (const t of ['Cancel the transfer you proposed.', 'Forget it.', 'Hold off.', 'No, no, no, forget am.']) assert.equal(P(t).operation, 'cancel', t);
// neutral statements/questions create no objective
for (const t of ['The meeting finished early.', 'Good evening.', 'What time is it?', 'How is your day going?', 'The generator is loud.']) assert.equal(o(t, false), null, t);
console.log('IQ7B_SEMANTIC_TESTS_PASS');
