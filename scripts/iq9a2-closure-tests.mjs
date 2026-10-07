// IQ-9A2 closure: pure tests (compound split, follow-up resolution, hazard vocabulary). Every negative has an authorized positive counterpart.
import assert from 'node:assert/strict';
const {splitCompoundWithdrawal, hasWithdrawalVerb, isHazardText} = await import('../dist/oyi-core/response/answerTarget.js');
const {parseFollowUpIntent, resolveFollowUpReference} = await import('../dist/oyi-core/interpretation/followUpResolver.js');
const {buildFieldAnswer} = await import('../dist/oyi-core/domains/explainAnswer.js');
let n = 0; const ok = (name, f) => {try {f();} catch (e) {e.message = `${name}: ${e.message}`; throw e;} n++;};
const ref = (id, label, status, extra = {}) => ({object_type: 'x', canonical_id: id, label, occurred_at: null, metric: null, metric_value: null, status, attributes: {}, ...extra});
const set = (refs, selected = null) => ({object_refs: refs, selected_object_ref: selected, result_count: refs.length});

ok('compound-withdrawal-splits', () => {
  for (const [t, kind] of [["Scrap the email, I'll phone them myself.", 'statement'], ["Hold on, don't send it, I'll draft it later.", 'statement'], ['no wait, don\'t mark anything. Is it still open?', 'request'], ['Actually forget the AC but do the kitchen one', 'request'], ["never mind the generators, switch them back on again later", 'statement']]) {
    const s = splitCompoundWithdrawal(t); assert(s, t); assert.equal(s.remainder_kind, kind, t); assert(hasWithdrawalVerb(s.withdrawal), t);
  }
});
ok('compound-withdrawal-positive-controls-not-split', () => {
  // corrections, single intents, constraints and questions about cancelling are NOT compound withdrawals
  for (const t of ['Actually, forget the leads. I mean the developments.', 'Cancel the pending device command', "Don't share the financial figures outside this chat.", 'Do not send me marketing emails', 'Can you cancel it and tell me why?', 'Turn off the kitchen light', 'Forget the small stuff. Which three things can actually move Ochiga forward?', 'Never mind the background, what is open now?', 'What is my wallet balance, and the open requests?']) assert.equal(splitCompoundWithdrawal(t), null, t);
});
ok('withdrawal-verbs', () => {
  for (const t of ["scrap the email", "don't mark anything", 'do not touch it', 'Scratch that']) assert(hasWithdrawalVerb(t), t);
  for (const t of ['Do not ask me the size again', 'Do not send me emails', 'I do not want to sell', 'show me the open requests']) assert(!hasWithdrawalVerb(t), t);
});
ok('hazard-vocabulary', () => { assert(isHazardText('AC is sparking, switch it off now')); assert(!isHazardText('Turn off the AC')); });
ok('other-one-resolution', () => {
  const a = ref('a', 'Alpha', 'open'), b = ref('b', 'Beta', 'resolved'), c = ref('c', 'Gamma', 'open');
  assert.deepEqual(parseFollowUpIntent('and the other one?'), {type: 'other'});
  assert.equal(resolveFollowUpReference(set([a, b], a), {type: 'other'}).ref.canonical_id, 'b'); // valid referent resolves
  assert.equal(resolveFollowUpReference(set([a, b]), {type: 'other'}).status, 'ambiguous'); // no selection: ask, never guess
  assert.equal(resolveFollowUpReference(set([a, b, c], a), {type: 'other'}).status, 'ambiguous'); // two others: ask, naming candidates
  assert.equal(resolveFollowUpReference(set([a]), {type: 'other'}).status, 'unresolved'); // nothing else exists
  assert.equal(resolveFollowUpReference(null, {type: 'other'}).status, 'unresolved'); // expired/absent set is never recovered
});
ok('state-attribute-resolution', () => {
  const a = ref('a', 'Expected Visitor', 'active'), b = ref('b', 'Historical Visitor', 'inactive');
  const i = parseFollowUpIntent('and which is the active one?'); assert.equal(i.attribute, 'active');
  assert.equal(resolveFollowUpReference(set([a, b]), i).ref.canonical_id, 'a');
  assert.equal(resolveFollowUpReference(set([a, b]), parseFollowUpIntent('which is the inactive one')).ref.canonical_id, 'b');
});
ok('field-answers-are-grounded', () => {
  const fact = v => ({value: v, object: {label: 'Item'}});
  assert.match(buildFieldAnswer(fact({priority: 'high'}), 'priority'), /priority is high/);
  assert.match(buildFieldAnswer(fact({}), 'priority'), /No priority is recorded/); // no invented urgency
  assert.match(buildFieldAnswer(fact({direction: 'credit'}), 'direction'), /money in/);
  assert.match(buildFieldAnswer(fact({}), 'direction'), /doesn't say/);
});
console.log(JSON.stringify({status: 'PASS', tests: n}));
