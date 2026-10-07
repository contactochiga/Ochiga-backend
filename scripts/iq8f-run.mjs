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
const scripted = () => {process.env.OYI_JUDGMENT_TEST_SEAM = '1'; prov.judgmentProviderTestSeam.provider = {name: 'scripted-test-provider', judge: async req => {const q = c => c.factors.some(f => f.dimension === 'readiness' && f.level === 'qualified') ? 0 : 1; const sorted = [...req.candidates].sort((a, b) => q(a) - q(b)); const n = req.requested_top_n || 3;
  return {status: 'ranked', ranking: sorted.slice(0, n).map((c, i) => ({cid: c.cid, rank: i + 1, rationale: i === 0 ? 'it is recorded as qualified with supplied owner consent' : 'it is supported by its recorded stage and notes', supporting: [], counter: [], uncertainties: []})), conclusion: 'the order reflects recorded qualification and stage', uncertainties: ['feasibility is not independently verified'], clarification: null};}};};
const unscripted = () => {prov.judgmentProviderTestSeam.provider = null; delete process.env.OYI_JUDGMENT_TEST_SEAM;};

// IQ-8F certification runner: first-contact execution of a frozen corpus. Captures per item the structured facts a grader needs. No grading here.
const cfg = JSON.parse(fs.readFileSync(process.env.IQ8F_CONFIG || '/tmp/iq8f-config.json', 'utf8'));
const corpus = JSON.parse(fs.readFileSync(cfg.corpus, 'utf8'));
const ROLE = {office_internal: 'ochiga_staff', public_corporate: 'public', facility: 'facility_manager', consumer: 'resident'};
const out = [];
const started = Date.now();
for (const it of corpus.items) {
  let rec;
  try {
    const {turns} = await converse(it.surface, ROLE[it.surface], [...(it.seeds || []), it.utterance]);
    const t = turns[turns.length - 1], r = t.response, ex = r.execution || {}, cr = ex.capability_result || {}, md = cr.metadata || ex.metadata || r.metadata || {};
    const sf = ex.orchestrator_v2?.semantic_frame || r.orchestrator_v2?.semantic_frame || null;
    rec = {id: it.id, answer: t.answer, capability: String(t.capability || ''), assessment_status: t.status || null,
      response_status: ex.status ?? null, capability_result_status: cr.status ?? null, requires_confirmation: r.requiresConfirmation ?? null, workflow_id: ex.workflow_id ?? null, action_id: ex.action_id ?? null, current_turn_execution: ex.current_turn_execution ?? null, truth_state: r.truth?.truth_state || null,
      target_intent: sf?.answerTarget?.response_intent ?? md.answer_target ?? null, target_confirmation: sf?.answerTarget?.confirmation_kind ?? null, target_refusal: sf?.answerTarget?.refusal_kind ?? null,
      projection_shape: md.projection_shape ?? null, response_contract: md.response_contract ?? null, projection_contract_violation: md.projection_contract_violation ?? null,
      authority: ex.authority_decision ?? ex.authority ?? null, resolution_outcome: ex.resolution_outcome ?? ex.orchestrator_v2?.resolution_outcome ?? null,
      turns: turns.map(x => ({prompt: x.prompt, answer: x.answer.slice(0, 1500), capability: String(x.capability || '')})), executed_so_far: executed, debug_keys: out.length === 0 ? {r: Object.keys(r), ex: Object.keys(ex), md: Object.keys(md)} : undefined};
  } catch (error) { rec = {id: it.id, error: String(error.message || error).slice(0, 300), executed_so_far: executed}; }
  out.push(rec);
}
fs.writeFileSync(cfg.out, JSON.stringify({generated_at: new Date().toISOString(), corpus: cfg.corpus, duration_ms: Date.now() - started, executed_device_commands: executed, records: out}, null, 1));
console.log(JSON.stringify({items: out.length, errors: out.filter(r => r.error).length, executed_device_commands: executed, duration_ms: Date.now() - started}));
