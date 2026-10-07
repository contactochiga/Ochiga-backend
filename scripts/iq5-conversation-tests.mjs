// IQ-5 conversation-level tests on the loopback fixture: real orchestrator, real persistence, real planner. The only scripted part is
// the optional judgment provider (test seam), used for the OMA-001 scripted-provider mode: it proves reference handling and
// discipline, NOT live-model quality.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:55421');
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (input, options) => {const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); assert(['127.0.0.1', 'localhost'].includes(u.hostname) && u.port === '55421'); return fetchOriginal(input, options);};
let executed = 0;
require('../dist/controllers/deviceCommandController.js').executeDeviceCommandForActor = async () => {executed++; throw Error('IQ5_EXECUTION_FORBIDDEN');};
const {conversationOrchestrator} = await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const {supabaseAdmin: db} = await import('../dist/supabase/supabaseClient.js');
const prov = await import('../dist/oyi-core/evidence/judgment/provider.js');
const {assertsPromiseOrAction} = await import('../dist/oyi-core/evidence/judgment/validator.js');
const source = fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs', 'utf8');
const {actorFor, oisContext, officeSnapshot} = new Function(`${source.slice(source.indexOf('const ids = '), source.indexOf('function expected(prompt)'))};return {actorFor,oisContext,officeSnapshot};`)();
const results = [];
const transcripts = {};
const keep = (name, turns) => {transcripts[name] = turns.map(t => ({prompt: t.prompt, assessment_status: t.status, artifact_type: t.artifact?.artifact_type ?? null, stale: Boolean(t.artifact?.stale), answer: t.answer.slice(0, 700)}));};
const check = async (id, fn) => {try {await fn(); results.push({id, status: 'PASS'});} catch (error) {error.message = `${id}: ${error.message}`; throw error;}};

const converse = async (surface, role, prompts, {thread = null, actorOverride = null} = {}) => {
  const actor = actorOverride || actorFor(role, surface); let t = thread; const turns = []; const snap = surface === 'office_internal' ? officeSnapshot() : null;
  for (const prompt of prompts) {
    const input = {message: prompt, surface, thread_id: t, estate_id: actor?.estate_id, home_id: actor?.home_id, context: {request_id: randomUUID(), ...(surface === 'office_internal' ? {operational_snapshot: snap} : {})}};
    const r = await conversationOrchestrator.run({actor, oisContext: oisContext(actor, surface), input}); t = r.thread_id;
    assert.equal(r.persistence_saved, true); assert.notEqual(r.execution.current_turn_execution, true, 'no reference turn executes anything');
    const q = await db.from('oyi_conversation_threads').select('metadata').eq('id', t).single(); assert(!q.error);
    turns.push({prompt, answer: String(r.answer), status: r.execution?.assessment_status, capability: r.capability_key || r.execution?.capability_key, artifact: q.data.metadata?.conversation_assessment?.derived_ranking || null, assessment: q.data.metadata?.conversation_assessment || null, response: r});
  }
  return {thread: t, turns, actor};
};
const scripted = () => {process.env.OYI_JUDGMENT_TEST_SEAM = '1'; prov.judgmentProviderTestSeam.provider = {name: 'scripted-test-provider', judge: async req => {const q = c => c.factors.some(f => f.dimension === 'readiness' && f.level === 'qualified') ? 0 : 1; const sorted = [...req.candidates].sort((a, b) => q(a) - q(b)); const n = req.requested_top_n || 3;
  return {status: 'ranked', ranking: sorted.slice(0, n).map((c, i) => ({cid: c.cid, rank: i + 1, rationale: i === 0 ? 'it is recorded as qualified with supplied owner consent' : 'it is supported by its recorded stage and notes', supporting: [], counter: [], uncertainties: []})), conclusion: 'the order reflects recorded qualification and stage', uncertainties: ['feasibility is not independently verified'], clarification: null};}};};
const unscripted = () => {prov.judgmentProviderTestSeam.provider = null; delete process.env.OYI_JUDGMENT_TEST_SEAM;};
const OMA1 = ['Forget the small stuff. Which three things can actually move Ochiga forward?', 'Why is the second one more important than the others?', 'The Chairman for that project says financing is already secured.', "What's number one now?", 'Why was number two there?'];

// ---- OMA-001, provider off (the real environment) --------------------------------------------
await check('iq5c:OMA-001-provider-off-no-ranking-so-no-ordering-is-claimed-or-explained', async () => {
  unscripted(); const {turns} = await converse('office_internal', 'ochiga_staff', OMA1); keep('OMA-001_provider_off', turns);
  assert(!/In order:/.test(turns[0].answer) && !turns[0].artifact, 'T2: nothing ranked, no artifact');
  assert(/no earlier ordering to explain|not ranking|not put it in order/.test(turns[1].answer), 'T3 says no ordering exists'); assert.notEqual(turns[1].status, 'derived_reference'); assert(!/number 2 in the order/.test(turns[1].answer));
  for (const t of turns) assert(!t.artifact || (t.artifact.artifact_type ?? 'ranking') !== 'ranking', 'no ranking artifact is ever created without a validated ranking');
  for (const t of turns) assert(!assertsPromiseOrAction(t.answer), t.answer);
});
// ---- OMA-001, scripted provider ----------------------------------------------------------------
await check('iq5c:OMA-001-scripted-provider-T3-resolves-priority-two-not-lead-row-two', async () => {
  scripted(); const lists = await converse('office_internal', 'ochiga_staff', ['Show me the leads.']); const rawSecond = lists.turns[0].assessment?.target_ref?.label;
  const {turns, thread} = await converse('office_internal', 'ochiga_staff', OMA1); unscripted(); keep('OMA-001_scripted_provider', turns);
  const a = turns[0].artifact; assert(a && a.artifact_type === 'ranking' && a.ordered === true, `T2 minted a ranking artifact: ${turns[0].answer}`); const ranked = a.items.filter(i => i.group === 'ranked'); assert.equal(ranked.length, 3); assert.equal(a.result_set_id, undefined); assert.equal(turns[0].assessment.result_set_id, null);
  assert.equal(turns[1].status, 'derived_reference', turns[1].answer); assert(turns[1].answer.includes(ranked[1].ref.label) && /number 2/.test(turns[1].answer), turns[1].answer); assert(/comparative judgment/.test(turns[1].answer));
  assert(!turns[1].answer.includes(ranked[0].ref.label + ' was') && !/number 1 in the order/.test(turns[1].answer));
  assert.equal(turns[2].status, 'derived_reference'); assert(turns[2].artifact?.stale, 'T4: the financing fact marks the ranking stale for reassessment'); assert.equal(turns[2].artifact.items.length, a.items.length, 'and preserves it'); assert(/not verified|not reassessed/.test(turns[2].answer));
  assert(/cannot say what comes first now/.test(turns[3].answer) && !ranked.some(i => turns[3].answer.includes(i.ref.label)), 'T5: a stale ranking is not presented as current');
  assert(turns[4].answer.includes(ranked[1].ref.label) && /produced before you told me something that may change it/.test(turns[4].answer), 'T6: the historical explanation is still available');
  for (const t of turns) assert(!assertsPromiseOrAction(t.answer), t.answer);
  scripted(); const back = await converse('office_internal', 'ochiga_staff', ['Show me the leads.'], {thread}); unscripted(); assert.equal(executed, 0);
});
// ---- raw result continuity is unchanged ----------------------------------------------------------
await check('iq5c:raw-result-set-ordinals-still-use-the-result-set', async () => {
  unscripted(); const first = await converse('office_internal', 'ochiga_staff', ["Show me today's leads."]);
  const refs = (await db.from('oyi_conversation_threads').select('metadata').eq('id', first.thread).single()).data.metadata.result_sets?.crm?.object_refs || []; assert(refs.length >= 2, 'a real CRM list existed');
  const {turns} = await converse('office_internal', 'ochiga_staff', ['Open the second one.'], {thread: first.thread});
  assert.notEqual(turns[0].status, 'derived_reference'); assert.notEqual(turns[0].status, 'evidence_gathered'); assert(!/in the order I gave/.test(turns[0].answer), turns[0].answer);
  assert(turns[0].answer.includes(refs[1].label), `the second lead of the raw list was opened: ${turns[0].answer}`);
});
await check('iq5c:raw-list-presented-after-a-ranking-owns-a-bare-ordinal', async () => {
  scripted(); const {turns} = await converse('office_internal', 'ochiga_staff', ['Which three things can actually move Ochiga forward?', "Show me today's leads.", 'Open the second one.']); unscripted();
  assert(turns[0].artifact, 'a ranking existed'); assert.notEqual(turns[2].status, 'derived_reference', 'the newer raw list owns a bare ordinal'); assert(!/in the order I gave/.test(turns[2].answer), turns[2].answer);
});
await check('iq5c:explicit-priority-wording-wins-the-ranking-back-over-a-newer-raw-list', async () => {
  scripted(); const {turns} = await converse('office_internal', 'ochiga_staff', ['Which three things can actually move Ochiga forward?', "Show me today's leads.", 'Why the second priority?']); unscripted();
  assert.equal(turns[2].status, 'derived_reference', turns[2].answer); assert(/number 2 in the order I gave/.test(turns[2].answer));
});
// ---- authority: another actor, another surface, never sees the artifact --------------------------
await check('iq5c:artifact-is-not-readable-from-another-actor-or-surface-on-the-same-thread', async () => {
  scripted(); const first = await converse('office_internal', 'ochiga_staff', ['Which three things can actually move Ochiga forward?']); unscripted(); const labels = first.turns[0].artifact.items.map(i => i.ref.label);
  await assert.rejects(() => converse('consumer', 'resident', ['Why is the second one more important?'], {thread: first.thread}), /conversation_access_denied/, 'another actor on another surface cannot even enter the thread');
  const sameActorWrongSurface = await converse('facility', 'facility_manager', ['Why is the second one more important?']).catch(e => ({turns: [{answer: String(e.message), status: 'denied'}]}));
  for (const l of labels) assert(!sameActorWrongSurface.turns[0].answer.includes(l)); assert.notEqual(sameActorWrongSurface.turns[0].status, 'derived_reference');
});
// ---- surfaces ----------------------------------------------------------------------------------------
await check('iq5c:facility-references-resolve-against-what-was-named-and-no-scope-is-invented', async () => {
  unscripted(); const {turns} = await converse('facility', 'facility_manager', ['Does the water problem still come first?', 'Why the first one?', 'Can the other one wait?', 'Why the fifth one?', 'Is there a Tower B scope for that?']);
  keep('facility', turns); const first = turns[0].artifact; assert(first, `an assessment set was recorded: ${turns[0].answer}`); const r = turns[1];
  assert.equal(r.status, 'derived_reference', r.answer); assert(!/tower b/i.test(turns.slice(0, 4).map(t => t.answer).join(' ')), 'no building scope is invented'); assert(/only has \d+ item/.test(turns[3].answer), turns[3].answer);
  for (const t of turns) assert(!assertsPromiseOrAction(t.answer), t.answer);
});
await check('iq5c:consumer-references-never-turn-unknown-into-safe', async () => {
  unscripted(); const {turns} = await converse('consumer', 'resident', ['Is everything okay at home?', 'What about the second one?', 'Is that dangerous?', 'Can the last one wait?']); keep('consumer', turns);
  for (const t of turns) assert(!/\b(?:is|are|it is|that is|everything is) (?:safe|fine|ok|okay)\b/i.test(t.answer.replace(/not an all-clear/gi, '')), t.answer); for (const t of turns) assert(!assertsPromiseOrAction(t.answer), t.answer);
  if (turns[2].status === 'derived_reference') assert(/does not establish whether this is dangerous or safe/.test(turns[2].answer));
});
await check('iq5c:osa-references-stay-inside-public-evidence', async () => {
  unscripted(); const {turns} = await converse('public_corporate', 'public', ['I own land in Lekki and want to explore a joint venture.', 'Is this a strong opportunity?', 'Why is that a problem?', 'Which concern matters more?', 'What about the ownership issue?']); keep('osa', turns);
  for (const t of turns) {assert(!/strategic|alignment|internal|pipeline|Ochiga will pursue|we will pursue/i.test(t.answer.replace(/(?:does not|do not|cannot|not) (?:commit )?Ochiga to pursue anything/gi, '').replace(/nothing here commits Ochiga to pursue anything/gi, '')), t.answer); assert(!assertsPromiseOrAction(t.answer), t.answer);}
});
await check('iq5c:no-reference-turn-calls-the-provider', async () => {
  let calls = 0; process.env.OYI_JUDGMENT_TEST_SEAM = '1'; prov.judgmentProviderTestSeam.provider = {name: 'counting', judge: async req => {calls++; const n = req.requested_top_n || 3; return {status: 'ranked', ranking: req.candidates.slice(0, n).map((c, i) => ({cid: c.cid, rank: i + 1, rationale: 'it is supported by its recorded stage and notes', supporting: [], counter: [], uncertainties: []})), conclusion: 'the order reflects recorded stage', uncertainties: [], clarification: null};}};
  const {turns} = await converse('office_internal', 'ochiga_staff', ['Which three things can actually move Ochiga forward?', 'Why the second one?', 'Why not the third?', 'Compare the top two.', 'Why #1?']); unscripted();
  assert.equal(calls, 1, 'only the ranking itself used the provider'); assert(turns.slice(1).every(t => t.status === 'derived_reference'), turns.map(t => t.status).join());
});
const counts = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
fs.writeFileSync('artifacts/intelligence-quality-v1-iq5-conversation-tests.json', JSON.stringify({status: 'PASS', test_mode: 'Real orchestrator on the loopback fixture; scripted provider test seam for the ranking (reference/discipline, not model quality)', results, counts, executed, transcripts}, null, 2) + '\n');
console.log(JSON.stringify({status: 'PASS', tests: results.length, counts, executed}));
process.exit(0);
