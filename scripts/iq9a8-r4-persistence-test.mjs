// IQ-7 end-to-end routing of held-out utterances (real orchestrator on the loopback fixture; no provider) on the loopback fixture: real orchestrator, real persistence, real planner. The only scripted part is
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


// ---- IQ-9A8 R4 multi-part persistence test: one user message leaves one exchange, with the answer the user saw; workflow and action state stay coherent ----
const msgs = async thread => (await db.from('oyi_conversation_messages').select('id,role,content,metadata').eq('thread_id', thread).order('created_at', {ascending: true})).data || [];
let checks = 0; const ok = (name, cond) => {assert(cond, name); checks++;};
// 1 cross-domain multi-part
const A = await converse('facility', 'facility_manager', ['Any security incidents logged, and is the camera working?']);
let m = await msgs(A.thread);
ok('cross-domain: one user message and one assistant message', m.length === 2 && m[0].role === 'user' && m[1].role === 'assistant');
ok('cross-domain: the typed message is the stored user message', m[0].content === 'Any security incidents logged, and is the camera working?');
ok('cross-domain: the stored answer is the combined answer the user saw', m[1].content === A.turns[0].answer && /On “is the camera working”/.test(m[1].content));
// 2 a later turn sees one coherent history (a consumer "short version" request shortens the answer the user actually saw)
const B = await converse('consumer', 'resident', ['What is my wallet balance, and what maintenance requests do I have?', 'give me the short version']);
m = await msgs(B.thread);
ok('consumer multi-part then follow-up: exactly two exchanges', m.length === 4 && m.map(x => x.role).join() === 'user,assistant,user,assistant');
ok('consumer multi-part: stored answer mentions both parts', /Wallet balance/.test(m[1].content) && /maintenance requests/i.test(m[1].content));
ok('short version works from the combined answer', B.turns[1].answer.length > 0 && B.turns[1].answer.length <= m[1].content.length);
// 3 read plus action: one exchange, one pending workflow, cancel is terminal, nothing executes
const C = await converse('consumer', 'resident', ['Show my maintenance requests, and turn off the Kitchen Light']);
m = await msgs(C.thread);
ok('read+action: one exchange', m.length === 2 && m[0].content === 'Show my maintenance requests, and turn off the Kitchen Light');
ok('read+action: the answer shows the read and the proposal', /unresolved water issue/.test(m[1].content) && /Please confirm/.test(m[1].content));
const wf = await db.from('oyi_conversation_workflows').select('workflow_id,status').eq('thread_id', C.thread);
ok('read+action: exactly one pending workflow', (wf.data || []).filter(w => !['cancelled', 'completed', 'failed', 'expired', 'superseded'].includes(w.status)).length === 1);
const D = await converse('consumer', 'resident', ['Show my maintenance requests, and turn off the Kitchen Light', 'cancel that']);
m = await msgs(D.thread);
ok('read+action then cancel: two exchanges', m.length === 4);
ok('cancel is terminal and nothing executed', /^Cancelled/.test(D.turns[1].answer) && executed === 0);
const wf2 = await db.from('oyi_conversation_workflows').select('status').eq('thread_id', D.thread);
ok('no workflow remains pending after cancel', (wf2.data || []).every(w => ['cancelled', 'completed', 'failed', 'expired', 'superseded'].includes(w.status)));
// 4 own-scope reset: the typed words are stored, the refused scope is not inherited
const E = await converse('consumer', 'resident', ["what about my neighbour's visitors?", 'ok then just mine']);
m = await msgs(E.thread);
ok('own-scope reset: two exchanges with the typed words', m.length === 4 && m[2].content === 'ok then just mine' && /own visitors/.test(m[3].content));
// 5 single questions are not touched
const F = await converse('consumer', 'resident', ['What maintenance requests do I have?']);
m = await msgs(F.thread);
ok('single question: untouched', m.length === 2 && !m[0].metadata?.multipart);
console.log(JSON.stringify({status: 'PASS', checks}));
process.exit(0);
