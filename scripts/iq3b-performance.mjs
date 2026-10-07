// IQ-3B planner performance, measured against the isolated local fixture (real queries, loopback only).
// Counts database queries per plan through a counting client injected into the read-only evidence dependency.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:55421');
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
const fetchOriginal = globalThis.fetch;
// Only the isolated loopback fixture is reachable; any other host fails loudly.
globalThis.fetch = (input, options) => {const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); assert.equal(u.hostname, '127.0.0.1'); assert.equal(u.port, '55421'); return fetchOriginal(input, options);};
const {ensureRegistered} = await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const {capabilityRegistry} = await import('../dist/oyi-core/capabilities/CapabilityRegistry.js');
const {supabaseAdmin: db} = await import('../dist/supabase/supabaseClient.js');
const {readOnlyEvidenceDb} = await import('../dist/oyi-core/evidence/ReadOnlyEvidenceDb.js');
const {planAndGatherEvidence} = await import('../dist/oyi-core/evidence/planner/planner.js');
const {defaultAssessmentSubject} = await import('../dist/oyi-core/context/conversationAssessmentContext.js');
ensureRegistered();
const src = fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs', 'utf8');
const {actorFor, oisContext} = new Function(`${src.slice(src.indexOf('const ids = '), src.indexOf('function expected(prompt)'))};return {actorFor,oisContext};`)();
const context = (surface, role, extra = {}) => {const actor = actorFor(role, surface), ois = oisContext(actor, surface); return {actor, oisContext: ois, input: {surface, message: 'Assess', estate_id: ois.estate_id, home_id: ois.home_id, context: {}, ...extra}, resolvedTurn: {request_id: 'perf', scope: {estate_id: ois.estate_id, home_id: ois.home_id, building_id: null, room_id: null}, semantic_frame: {normalizedText: 'assess'}, operation: 'list'}, legacyFallback: async () => {throw Error('NO_FALLBACK');}};};
const office = () => {const c = context('office_internal', 'ochiga_staff'); c.actor.permissions = [...new Set([...(c.actor.permissions || []), ...capabilityRegistry.all().filter(m => m.supported_surfaces?.includes('office_internal')).flatMap(m => m.permission_requirements || [])])];
  c.input.context = {operational_snapshot: {leads: {needing_attention: Array.from({length: 20}, (_, i) => ({id: `l${i}`, name: `Lead ${i}`, status: 'qualified', reason: 'x', last_activity_at: null})), total_open: 39}, opportunities: {stale: [{id: 'o1', name: 'O', stage: 'review', days_since_activity: 21, owner: null}]}, reports: {pending_approval: [{id: 'r1', title: 'R', submitted_by: null, submitted_at: null}]}, development: {projects: [{id: 'd1', name: 'D', status: 'planning'}]}, financial: {estates: [{estate_id: 'e', name: 'E'}]}, tasks: {open: [{id: 't1', title: 'T', status: 'open', overdue: false}]}, support: {items: [{id: 's1', title: 'S', status: 'open'}]}, meetings: {items: [{id: 'm1', title: 'M', status: 'scheduled'}]}}}; return c;};
const req = (ctx, o = {}) => ({actor: ctx.actor, oisContext: ctx.oisContext, input: ctx.input, resolvedTurn: ctx.resolvedTurn, objective: 'assess', subject_domains: defaultAssessmentSubject(ctx.input.surface), subject_label: null, target_id: null, broad: true, room: {status: 'none'}, building_label: null, raw_text: 'assess', material_text: null, previous: null, ...o});
const counting = () => {const counter = {queries: 0, tables: {}}; const client = {from: t => {counter.queries++; counter.tables[t] = (counter.tables[t] || 0) + 1; return db.from(t);}}; return {counter, db: readOnlyEvidenceDb(client)};};
const stats = a => {const s = [...a].sort((x, y) => x - y); return {n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: s[Math.floor(s.length * 0.5)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s.at(-1)};};
const N = 15;
const scenarios = [
  ['single_source (consumer maintenance)', () => [context('consumer', 'resident'), {subject_domains: ['maintenance'], broad: false}]],
  ['two_sources (consumer maintenance+visitors)', () => [context('consumer', 'resident'), {subject_domains: ['maintenance', 'visitors'], broad: false}]],
  ['three_sources (consumer devices+maintenance+visitors)', () => [context('consumer', 'resident'), {subject_domains: ['devices', 'maintenance', 'visitors'], broad: false}]],
  ['security_subject_with_companions (consumer security+visitors+devices)', () => [context('consumer', 'resident'), {subject_domains: ['security'], broad: false}]],
  ['facility_broad (maintenance+security+cameras+visitors)', () => [context('facility', 'facility_manager'), {}]],
  ['consumer_broad (devices+security+visitors+maintenance+scenes)', () => [context('consumer', 'resident'), {}]],
  ['largest_bounded_plan (office broad: 8 sources, snapshot)', () => [office(), {}]],
];
const report = [];
for (const [name, build] of scenarios) {
  const wall = [], seq = [], q = [], per = {}; let sources = 0, last = null;
  for (let i = 0; i < N + 2; i++) { // two warm-up runs are discarded
    const [ctx, o] = build(); const {counter, db: ro} = counting(); const t0 = performance.now();
    const r = await planAndGatherEvidence({...req(ctx, o), deps: {db: ro}}); const ms = performance.now() - t0; last = r;
    if (i < 2) continue;
    wall.push(+ms.toFixed(2)); q.push(counter.queries); sources = r.state.stats.sources_attempted; seq.push(r.state.contributions.reduce((s, c) => s + c.latency_ms, 0));
    for (const c of r.state.contributions) (per[c.source_key] ||= []).push(c.latency_ms);
  }
  // Reuse saving: the same plan again with the previous state.
  const [ctx, o] = build(); const first = counting(); const a = await planAndGatherEvidence({...req(ctx, o), deps: {db: first.db}}); const second = counting(); const t1 = performance.now(); const b = await planAndGatherEvidence({...req(ctx, o, ), previous: a.state, deps: {db: second.db}}); const reuseMs = performance.now() - t1;
  report.push({scenario: name, sources_attempted: sources, plan_status: last.state.status, queries_per_plan: stats(q), planner_wall_ms: stats(wall), sum_of_source_latencies_ms: stats(seq), per_source_latency_ms: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, stats(v)])),
    reuse: {queries_first: first.counter.queries, queries_reused: second.counter.queries, sources_reused: b.state.stats.sources_reused, reuse_wall_ms: +reuseMs.toFixed(2), first_wall_ms: a.state.stats.latency_ms}});
}
// Ordinary non-assessment turns never reach the planner: it is referenced only from the assessment terminal branch.
const referenced = fs.readFileSync('src/oyi-core/orchestration/ConversationOrchestrator.ts', 'utf8').split('\n').filter(l => /gatherAssessmentEvidence\(/.test(l)).length;
const result = {status: 'MEASURED', environment: 'isolated local loopback fixture; real queries; no network; Node single process', runs_per_scenario: N, limits: JSON.parse(JSON.stringify((await import('../dist/oyi-core/evidence/planner/limits.js')).PLANNER_LIMITS)), orchestrator_call_sites: referenced, scenarios: report};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq3b-performance.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({status: 'MEASURED', call_sites: referenced, scenarios: report.map(r => ({s: r.scenario, sources: r.sources_attempted, queries: r.queries_per_plan.mean, wall_p95: r.planner_wall_ms.p95, seq_mean: r.sum_of_source_latencies_ms.mean, reuse_q: r.reuse.queries_reused}))}, null, 1));
