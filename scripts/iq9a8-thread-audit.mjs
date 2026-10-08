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

// ---- IQ-9A8 R4 multi-part persistence audit (read-only): what one multi-part message leaves in the canonical thread ----
const rows = [];
const dump = async (label, thread) => {
  const m = await db.from('oyi_conversation_messages').select('role,content,created_at').eq('thread_id', thread).order('created_at', {ascending: true});
  const th = await db.from('oyi_conversation_threads').select('metadata,title').eq('id', thread).single();
  rows.push({label, messages: (m.data || []).map(x => ({role: x.role, content: String(x.content).slice(0, 140)})), result_set_domain: th.data?.metadata?.result_set?.domain ?? th.data?.metadata?.result_sets ? Object.keys(th.data.metadata.result_sets || {}) : null, metadata_keys: Object.keys(th.data?.metadata || {}), title: th.data?.title});
};
const A = await converse('facility', 'facility_manager', ['Any security incidents logged, and is the camera working?']);
await dump('facility_multipart_one_message', A.thread);
const B = await converse('facility', 'facility_manager', ['Any security incidents logged, and is the camera working?', 'give me the short version']);
await dump('facility_multipart_then_followup', B.thread);
const C = await converse('consumer', 'resident', ['Show my maintenance requests, and turn off the Kitchen Light']);
await dump('consumer_read_plus_action', C.thread);
const D = await converse('consumer', 'resident', ['Show my maintenance requests, and turn off the Kitchen Light', 'cancel that']);
await dump('consumer_read_plus_action_then_cancel', D.thread);
console.log('R4_AUDIT ' + JSON.stringify({rows, followup_answer: B.turns[1].answer.slice(0, 300), cancel_answer: D.turns[1].answer.slice(0, 200), executed}));
process.exit(0);
