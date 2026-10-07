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

// IQ-8 answer-shape evaluation: real orchestrator on the loopback fixture, no live provider. Config: /tmp/iq8-shape-config.json {suite, out}
// IQ-8C ANALYSIS harness (no runtime change): re-runs the frozen independent suite on the unchanged build and records, per item, the parse, the
// concept view, the derived answer target, the capability that answered and the FULL final answer, so the pipeline can be audited.
const cfg = JSON.parse(fs.readFileSync('/tmp/iq8c-config.json', 'utf8'));
const suite = JSON.parse(fs.readFileSync(cfg.suite, 'utf8'));
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {deriveAnswerTarget} = await import('../dist/oyi-core/response/answerTarget.js');
const ROLE = {office_internal: 'ochiga_staff', public_corporate: 'public', facility: 'facility_manager', consumer: 'resident'};
const out = [];
for (const it of suite.items) {
  const {turns} = await converse(it.s, ROLE[it.s], [...(it.seeds || []), it.u]); const t = turns[turns.length - 1];
  const f = parseSemanticFrame(it.u, {activeAssessment: (it.seeds || []).length > 0}), tg = deriveAnswerTarget(it.u, {objective: f.cognitiveObjective, activeAssessment: (it.seeds || []).length > 0});
  out.push({id: it.id, worker: it.worker, s: it.s, u: it.u, seeds: it.seeds || [], shape: it.shape, kind: it.kind, p: it.p, capability_target: it.capability_target, concepts_expected: it.concepts, must_answer: it.must_answer,
    actual: {objective: f.cognitiveObjective, domain: f.domain, operation: f.operation, mutation: f.mutationIntent, object: f.concepts?.object ?? null, facet: f.concepts?.facet ?? null, quantity: f.concepts?.quantity ?? null, state: f.concepts?.state ?? null, head_domain: f.concepts?.head_domain ?? null, response_intent: tg.response_intent, yes_no: tg.yes_no?.kind ?? null},
    capability: String(t.capability || ''), assessment_status: t.status, answer: t.answer});
}
fs.writeFileSync(cfg.out, JSON.stringify(out, null, 1)); console.log('TRACE_DONE', out.length); process.exit(0);
