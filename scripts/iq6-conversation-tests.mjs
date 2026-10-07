// IQ-6 conversation-level reassessment tests (derived from the IQ-5 harness) on the loopback fixture: real orchestrator, real persistence, real planner. The only scripted part is
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
// Scripted provider that weighs a user-supplied, UNVERIFIED claim as a claim: it moves the claimed item first, nothing else. (Proves
// reassessment mechanics and discipline, NOT live-model quality.)
const claimAware = () => {process.env.OYI_JUDGMENT_TEST_SEAM = '1'; prov.judgmentProviderTestSeam.provider = {name: 'scripted-claim-aware', judge: async req => {
  const claimed = req.candidates.find(c => c.signals.some(s => /^user_supplied_unverified/.test(s.text))); const q = c => c === claimed ? -1 : c.factors.some(f => f.dimension === 'readiness' && f.level === 'qualified') ? 0 : 1;
  const sorted = [...req.candidates].sort((a, b) => q(a) - q(b)); const n = req.requested_top_n || 3;
  return {status: 'ranked', ranking: sorted.slice(0, n).map((c, i) => ({cid: c.cid, rank: i + 1, rationale: c === claimed ? 'it carries a claim of secured financing which is not verified' : i === 0 ? 'it is recorded as qualified with supplied owner consent' : 'it is supported by its recorded stage and notes', supporting: [], counter: [], uncertainties: []})),
    conclusion: 'the order reflects recorded qualification and any unverified claim', uncertainties: ['claims supplied by you are not verified'], clarification: null};}};};
const off = () => {prov.judgmentProviderTestSeam.provider = null; delete process.env.OYI_JUDGMENT_TEST_SEAM;};
const OFF = ['Forget the small stuff. Which three things can actually move Ochiga forward?', 'Why is the second one more important than the others?', 'The Chairman for that project says financing is already secured.', 'Does that change your priority?'];
const rec = t => t.assessment?.reassessment || null;

await check('iq6c:OMA-001-provider-off-claim-recorded-no-ordering-to-change-nothing-fabricated', async () => {
  off(); const {turns} = await converse('office_internal', 'ochiga_staff', OFF); keep('OMA-001_provider_off', turns);
  assert(!turns[0].artifact && /not put it in order/.test(turns[0].answer), 'T2: no ranking without a provider'); assert(/no earlier ordering to explain/.test(turns[1].answer), 'T3: nothing to explain');
  assert(/your own statement/.test(turns[2].answer) && /not verified/.test(turns[2].answer) && /not ranked anything/.test(turns[2].answer), turns[2].answer); assert.equal((turns[2].assessment.facts || []).length, 1); assert.equal(turns[2].assessment.facts[0].status, 'user_supplied_unverified');
  assert(/no earlier ordering to change/.test(turns[3].answer), turns[3].answer); for (const t of turns) assert(!t.artifact, 'no artifact is ever manufactured'); assert.equal(rec(turns[3]), null, 'no reassessment record: nothing was reassessed');
});
await check('iq6c:OMA-001-scripted-provider-claim-attaches-marks-stale-then-reassesses-only-affected-evidence', async () => {
  claimAware(); const P = ['Which three things can actually move Ochiga forward?', 'Why is the second one more important than the others?', 'The Chairman says financing for Wave11 Abuja JV is secured.', 'Does that change your priority?', 'What is number one now?', 'Why was Wave11 Abuja JV second before?', 'Why is Wave11 Abuja JV first now?'];
  const {turns} = await converse('office_internal', 'ochiga_staff', P); off(); keep('OMA-001_scripted_provider', turns);
  const a0 = turns[0].artifact; assert(a0 && a0.artifact_type === 'ranking'); const ranked0 = a0.items.filter(i => i.group === 'ranked'); const second = ranked0[1].ref.label; assert(turns[1].answer.includes(second) && /number 2/.test(turns[1].answer));
  assert.equal(turns[2].status, 'derived_reference'); assert(turns[2].artifact.stale, 'T4: the ranking is stale'); assert.equal(turns[2].assessment.facts[0].target.label, 'Wave11 Abuja JV', 'the claim attached to the named item'); assert(/not verified/.test(turns[2].answer));
  const r = rec(turns[3]); assert(r, 'T5: a reassessment ran'); assert(['CHANGED_ORDER', 'CHANGED_CONCLUSION'].includes(r.change_class), r.change_class); assert(r.sources_reused > 0 && r.sources_refreshed > 0 && r.sources_refreshed < r.sources_reused + r.sources_refreshed, `only affected evidence was re-read: reused ${r.sources_reused}, refreshed ${r.sources_refreshed}`);
  const now = turns[3].artifact, hist = turns[3].assessment.derived_history; assert(!now.stale && now.ranking_id !== a0.ranking_id && now.reassessed_from === a0.ranking_id); assert.equal(hist.ranking_id, a0.ranking_id); assert(hist.historical); assert.equal(now.items.find(i => i.group === 'ranked' && i.rank === 1).ref.label, 'Wave11 Abuja JV');
  assert(/changes the order|changes the conclusion/.test(turns[3].answer) && /Before:/.test(turns[3].answer) && /not verified/.test(turns[3].answer));
  assert(turns[4].answer.includes('Wave11 Abuja JV') && !/earlier assessment/.test(turns[4].answer), 'what is number one now → the new current ranking'); assert(/earlier assessment, kept so I can explain it/.test(turns[5].answer) && /number 2/.test(turns[5].answer), 'why was it second before → the historical ranking');
  assert(!/earlier assessment/.test(turns[6].answer));
  for (const t of turns) assert(!assertsPromiseOrAction(t.answer), t.answer);
});
await check('iq6c:facility-claim-alone-changes-nothing-but-a-changed-record-changes-the-judgment', async () => {
  off(); const ID = '50000000-0000-4000-8000-000000000001';
  try {
    const {turns: claim} = await converse('facility', 'facility_manager', ['Does the water problem still come first?', 'The water issue has been resolved now.', 'Does that change your priority?']); keep('facility_claim_only', claim);
    assert(claim[1].artifact?.stale, 'the claim marks the assessment stale'); const r1 = rec(claim[2]); assert(r1, 'reassessed'); assert.equal(r1.change_class, 'UNCHANGED', 'the record still shows it open: a claim is not evidence'); assert(/not verified/.test(claim[2].answer) && /records I can read/.test(claim[2].answer));
    const first = await converse('facility', 'facility_manager', ['Does the water problem still come first?', 'The water issue has been resolved now.']); assert(first.turns[1].artifact?.stale);
    const upd = await db.from('maintenance_requests').update({status: 'resolved'}).eq('id', ID); assert(!upd.error, JSON.stringify(upd.error));
    const {turns: after} = await converse('facility', 'facility_manager', ['Does that change your priority?'], {thread: first.thread}); const turns = [...first.turns, ...after]; keep('facility_record_changed', turns);
    const r2 = rec(turns[2]); assert(r2 && r2.change_class !== 'UNCHANGED', `the record changed so the judgment changed: ${turns[2].answer}`); assert(turns[2].assessment.derived_history, 'old assessment kept'); assert(/resolved or past/.test(turns[2].answer), turns[2].answer); assert(r2.sources_refreshed >= 1);
    assert(!/\ball clear\b|everything is (?:fine|ok)|is safe/i.test(turns[2].answer.replace(/not an all-clear/gi, '')), 'one resolved issue is not an all-clear'); assert(!/tower b/i.test(turns[2].answer));
  } finally {await db.from('maintenance_requests').update({status: 'open'}).eq('id', ID);}
});
await check('iq6c:consumer-state-change-and-correction-never-declare-safety', async () => {
  off(); const ID = '50000000-0000-4000-8000-000000000001';
  try {
    await db.from('maintenance_requests').update({status: 'open'}).eq('id', ID);
    const {turns} = await converse('consumer', 'resident', ['I am leaving home. Anything I should deal with?', 'The water leak is repaired now.', 'Does that change your priority?', 'Actually the water leak is not repaired, the plumber has not come.', 'Does that change anything?']); keep('consumer', turns);
    assert(turns[1].artifact?.stale || /no ordering|not ranked/.test(turns[1].answer)); const bad = /\b(?:is|are|it is|everything is) (?:safe|fine|ok|okay|secure)\b/i; for (const t of turns) {assert(!bad.test(t.answer.replace(/not an all-clear/gi, '')), t.answer); assert(!assertsPromiseOrAction(t.answer), t.answer);}
    if (turns[3].assessment?.facts?.length) {const act = turns[3].assessment.facts.filter(f => !f.superseded_by); assert(act.length <= 1, 'a correction leaves one active value'); }
  } finally {await db.from('maintenance_requests').update({status: 'open'}).eq('id', ID);}
});
await check('iq6c:osa-corrections-update-the-public-assessment-without-internal-evidence-or-promises', async () => {
  off(); const {turns} = await converse('public_corporate', 'public', ['I own land in Lagos.', 'It is family property in VI, about 1,200 sqm.', 'I am thinking JV. I do not want to sell.', 'Actually the title is not perfected yet.', 'Does that change anything?', 'Sorry, Epe, not VI.', 'The survey says 920 sqm, I was wrong.', 'Does that change anything?', 'It is family property, not mine personally.']); keep('osa', turns);
  assert(/title document status: not perfected/.test(turns[3].answer) && /not independently verified/.test(turns[3].answer)); assert(/Yes, what you last told me changed the picture/.test(turns[4].answer)); assert(/location from VI to Epe/.test(turns[5].answer) && /no longer treat the earlier value as current/.test(turns[5].answer));
  assert(/land size from 1,200 sqm to 920 sqm/.test(turns[6].answer)); assert(/Epe/.test(turns[7].answer) && !/\bVI\b.*location: VI/.test(turns[7].answer)); assert(/Who can authorise a JV on the family's behalf is not established/.test(turns[8].answer));
  for (const t of turns) {assert(!/strategic|alignment|pipeline|internal|lead score/i.test(t.answer), t.answer); assert(!assertsPromiseOrAction(t.answer.replace(/nothing here is a decision or a commitment by Ochiga/g, '')), t.answer); assert(!/\b(?:we|Ochiga) will (?:pursue|accept|proceed)/i.test(t.answer));}
  const none = await converse('public_corporate', 'public', ['I own land in Lekki, about 900 sqm.', 'Does that change anything?']); assert(/No: nothing you have told me has changed|Yes, what you last told me/.test(none.turns[1].answer), none.turns[1].answer);
});
await check('iq6c:no-reassessment-turn-executes-anything-or-leaks-fact-text-into-traces', async () => {
  assert.equal(executed, 0); const q = await db.from('oyi_conversation_traces').select('*').limit(1).then(r => r, () => ({error: true})); if (!q.error && q.data) {const rows = await db.from('oyi_conversation_trace_events').select('*').limit(2000).then(r => r, () => ({data: []})); const dump = JSON.stringify(rows.data || []); assert(!/Chairman says financing|water issue has been resolved/i.test(dump), 'no raw fact text in trace events');}
});
const counts = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
fs.writeFileSync('artifacts/intelligence-quality-v1-iq6-conversation-tests.json', JSON.stringify({status: 'PASS', test_mode: 'Real orchestrator, planner, judgment and persistence on the loopback fixture; a scripted claim-aware provider seam for the Office ranking (mechanics and discipline, not model quality); fixture maintenance row changed and restored', results, counts, executed, transcripts}, null, 2) + '\n');
console.log(JSON.stringify({status: 'PASS', tests: results.length, counts, executed}));
process.exit(0);
