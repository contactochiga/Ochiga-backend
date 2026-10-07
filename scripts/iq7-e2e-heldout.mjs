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

const cfg = JSON.parse(fs.readFileSync('/tmp/iq7-e2e-config.json', 'utf8'));
const suite = JSON.parse(fs.readFileSync(cfg.suite, 'utf8'));
const ROLE = {office_internal: 'ochiga_staff', public_corporate: 'public', facility: 'facility_manager', consumer: 'resident'};
const MENU = /^(?:I can (?:tell you about|help with)|I understand the request, but Oyi does not have an enabled)/;
const DISCOVERY = /^Here is what I can safely help with/;
const items = suite.items.filter(i => i.e2e && (cfg.split === 'all' || i.split === cfg.split));
const out = [];
for (const it of items) {
  const ctx = suite.contexts[it.c]; const seeds = ctx?.seed || [];
  const {turns} = await converse(it.s, ROLE[it.s], [...seeds, it.u]); const t = turns[turns.length - 1];
  const cap = String(t.capability || ''), a = t.answer;
  const menu = MENU.test(a) || cap === 'business_surface.fallback' || cap === 'canonical.conversation.unsupported';
  const discovery = DISCOVERY.test(a) || cap === 'global.capabilities.read';
  const ack = /^(?:Thanks|Understood|Got it|Based on what you've told me)/.test(a) && cap.startsWith('corporate.opportunity');
  const checks = {};
  if (it.nr?.includes('menu')) checks.not_menu = !menu;
  if (it.nr?.includes('capability_discovery')) checks.not_discovery = !discovery;
  if (it.nr?.includes('opportunity_ack')) checks.not_opportunity_ack = !ack;
  if (it.route === 'opportunity') checks.route = cap.startsWith('corporate.opportunity') || t.status === 'evidence_gathered';
  if (it.route === 'capability_discovery') checks.route = discovery;
  if (it.route === 'public_knowledge') checks.route = cap.startsWith('corporate.') && !menu;
  if (it.route === 'refuse_private') checks.route = !ack && !/^Thanks/.test(a);
  out.push({id: it.id, split: it.split, s: it.s, u: it.u, route: it.route || null, capability: cap, assessment_status: t.status, menu, discovery, answer_head: a.slice(0, 110), checks, pass: Object.values(checks).every(Boolean)});
}
const inScope = out.filter(o => 'not_menu' in o.checks), leak = inScope.filter(o => !o.checks.not_menu);
const summary = {items: out.length, pass: out.filter(o => o.pass).length, menu_leakage: {in_scope: inScope.length, leaked: leak.length, rate: inScope.length ? +(leak.length / inScope.length).toFixed(3) : null, ids: leak.map(o => o.id)},
  private_ack_leaks: out.filter(o => o.checks.not_opportunity_ack === false).map(o => o.id), discovery_routing: {n: out.filter(o => o.route === 'capability_discovery').length, correct: out.filter(o => o.route === 'capability_discovery' && o.checks.route).length},
  route_failures: out.filter(o => o.checks.route === false).map(o => o.id), executed};
fs.writeFileSync(cfg.out, JSON.stringify({summary, items: out}, null, 1)); console.log(JSON.stringify(summary)); process.exit(0);
