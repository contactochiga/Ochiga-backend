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

import {performance as perf} from 'node:perf_hooks';
const mkProvider = () => {process.env.OYI_JUDGMENT_TEST_SEAM = '1'; prov.judgmentProviderTestSeam.provider = {name: 'scripted', judge: async req => {const claimed = req.candidates.find(c => c.signals.some(s => /^user_supplied_unverified/.test(s.text))); const q = c => c === claimed ? -1 : c.factors.some(f => f.dimension === 'readiness' && f.level === 'qualified') ? 0 : 1; const sorted = [...req.candidates].sort((a, b) => q(a) - q(b)); const n = req.requested_top_n || 3;
  return {status: 'ranked', ranking: sorted.slice(0, n).map((c, i) => ({cid: c.cid, rank: i + 1, rationale: 'it is supported by its recorded stage and notes', supporting: [], counter: [], uncertainties: []})), conclusion: 'the order reflects recorded stage', uncertainties: [], clarification: null};}};};
const stats = a => {const s = [...a].sort((x, y) => x - y); return {n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], max: s.at(-1)};};
const timed = async (surface, role, prompts) => {const actor = actorFor(role, surface); let t = null; const snap = surface === 'office_internal' ? officeSnapshot() : null; const out = [];
  for (const prompt of prompts) {const input = {message: prompt, surface, thread_id: t, estate_id: actor?.estate_id, home_id: actor?.home_id, context: {request_id: randomUUID(), ...(snap ? {operational_snapshot: snap} : {})}}; const t0 = perf.now(); const r = await conversationOrchestrator.run({actor, oisContext: oisContext(actor, surface), input}); const ms = perf.now() - t0; t = r.thread_id;
    const q = await db.from('oyi_conversation_threads').select('metadata').eq('id', t).single(); out.push({ms, rec: q.data.metadata?.conversation_assessment?.reassessment || null, plan: q.data.metadata?.conversation_assessment?.evidence_plan?.stats || null});} return out;};
const N = 8, report = {};
const scenarios = {
  office_multi_source_refresh: ['office_internal', 'ochiga_staff', ['Which three things can actually move Ochiga forward?', 'The Chairman says financing for Wave11 Abuja JV is secured.', 'Does that change your priority?'], 'scripted'],
  office_crm_only_refresh: ['office_internal', 'ochiga_staff', ['Which three things can actually move Ochiga forward?', 'The Chairman says Wave11 Abuja JV is promising.', 'Does that change your priority?'], 'scripted'],
  facility_one_source_refresh: ['facility', 'facility_manager', ['Does the water problem still come first?', 'The water issue has been resolved now.', 'Does that change your priority?'], null],
  consumer_one_source_refresh: ['consumer', 'resident', ['I am leaving home. Anything I should deal with?', 'The water leak is repaired now.', 'Does that change your priority?'], null],
};
for (const [name, [surface, role, prompts, seam]] of Object.entries(scenarios)) {
  const base = [], fact = [], re = [], refreshed = [], reused = [], cls = {};
  for (let i = 0; i < N; i++) {if (seam) mkProvider(); else {prov.judgmentProviderTestSeam.provider = null; delete process.env.OYI_JUDGMENT_TEST_SEAM;} const o = await timed(surface, role, prompts); base.push(o[0].ms); fact.push(o[1].ms); re.push(o[2].ms); if (o[2].rec) {refreshed.push(o[2].rec.sources_refreshed); reused.push(o[2].rec.sources_reused); cls[o[2].rec.change_class] = (cls[o[2].rec.change_class] || 0) + 1;}}
  const planned = base.length; report[name] = {surface, runs: N, initial_assessment_ms: stats(base), fact_attachment_turn_ms: stats(fact), reassessment_turn_ms: stats(re), sources_refreshed: stats(refreshed.length ? refreshed : [0]), sources_reused: stats(reused.length ? reused : [0]), change_classes: cls,
    reassessment_overhead_vs_initial_p50_ms: +(stats(re).p50 - stats(base).p50).toFixed(1)};
}
process.env.OYI_JUDGMENT_TEST_SEAM = ''; prov.judgmentProviderTestSeam.provider = null;
// Pure fact attachment cost (no I/O).
const F = await import('../dist/oyi-core/evidence/reassessment/facts.js'); const art = {items: Array.from({length: 8}, (_, i) => ({rank: i + 1, tier: i, ref: {t: 'x', id: `id${i}`, label: `Item ${String.fromCharCode(65 + i)} project`}, rationale: 'r', factors: [], group: 'ranked', kind: 'business', source_key: 'crm.leads.read'})), artifact_type: 'ranking', focus: null};
const pure = []; for (let i = 0; i < 3000; i++) {const t0 = perf.now(); const b = F.bindFact('The Chairman says financing for Item C project is secured.', art); F.classifyUpdate('The Chairman says financing for Item C project is secured.', []); F.affectedClasses('The Chairman says financing for Item C project is secured.'); pure.push(perf.now() - t0);} report.pure_fact_attachment_ms = stats(pure.map(x => +x.toFixed(4)));
fs.writeFileSync('artifacts/intelligence-quality-v1-iq6-performance.json', JSON.stringify({status: 'MEASURED', environment: 'real orchestrator, planner, judgment and persistence on the loopback fixture (no network, no live model; the provider is a scripted stub with no latency)', ...report}, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.reassessment_turn_ms ? {init: v.initial_assessment_ms.p50, fact: v.fact_attachment_turn_ms.p50, re: v.reassessment_turn_ms.p50, refreshed: v.sources_refreshed.p50, reused: v.sources_reused.p50, cls: v.change_classes} : v.p95]))));
process.exit(0);
