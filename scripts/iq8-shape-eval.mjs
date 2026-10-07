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
const cfg = JSON.parse(fs.readFileSync('/tmp/iq8-shape-config.json', 'utf8'));
const suite = JSON.parse(fs.readFileSync(cfg.suite, 'utf8'));
const ROLE = {office_internal: 'ochiga_staff', public_corporate: 'public', facility: 'facility_manager', consumer: 'resident'};
const BOILER = /^(?:Based on the evidence available, (?:I can tell you what is recorded|this is what is known|\d+ items? needs?|nothing active|I found no active)|Based on what you've told me, not independent verification: Here's what I have so far|I can (?:tell you about|help with)|I understand (?:the|this as)|Thanks for sharing|Understood\. Is there anything else|Got it -- )/;
const lc = s => s.toLowerCase();
const within = (a, n) => lc(a.slice(0, n));
const hasAny = (a, kws, n) => kws.some(k => within(a, n).includes(lc(k)));
const NEG = /(?:can(?:'|no)t|cannot|do not have|don't have|not available|isn't|is not|no [a-z ]{0,24}(?:evidence|source|baseline|record|snapshot|data|scope|capability|reading)|unable|not able|won't|will not|haven't|have not|could not|couldn't|not (?:yet )?(?:ranked|connected|implemented))/i;
const POL = {
  yes: a => /^(?:yes|yep|correct|that is right|it is)\b/i.test(a.trim()),
  no: a => /^(?:no\b|not\b|nothing\b|none\b|there (?:is|are) no\b|i (?:have|see) no\b|i do not see\b|no,)/i.test(a.trim()),
  unknown: a => /^(?:i (?:can(?:'|no)t|cannot|do not|don't) (?:tell|confirm|say|verify|determine|know|see)|not (?:sure|known|confirmed|observable)|unknown|i have no way|that is not something i can|i (?:am|'m) not able)/i.test(a.trim()) || (NEG.test(within(a, 140)) && !/^(?:yes|no)\b/i.test(a.trim())),
};
const shapeCheck = (it, a, cap, status) => {
  const c = {}, p = it.p, head = a.slice(0, 340);
  c.not_boilerplate = it.kind === 'discovery' || !BOILER.test(a.trim());
  switch (it.kind) {
    case 'count': c.count = new RegExp(`\\b${p.n}\\b|\\b${['zero', 'one', 'two', 'three', 'four'][p.n] || 'x'}\\b${p.n === 0 ? '|\\bno\\b|\\bnone\\b' : ''}`, 'i').test(a.slice(0, 90)); break;
    case 'list': c.list = p.names.filter(n => lc(head).includes(lc(n))).length >= p.min; break;
    case 'status': c.status = hasAny(a, p.kw, 260) && (!p.also || hasAny(a, p.also, 260)); break;
    case 'judgment': c.judgment = hasAny(a, p.kw, 220); break;
    case 'yesno': {
      const ok = p.pol === 'yes_or_partial' ? (POL.yes(a) || /^(?:yes|nearly|almost|partly|not quite|for a first)/i.test(a.trim()) || /\b(?:enough|still need|not yet)\b/i.test(a.slice(0, 160))) : POL[p.pol](a);
      c.polarity = ok; c.reason_kw = hasAny(a, p.kw, 300); break;
    }
    case 'why': c.reason = hasAny(a, p.kw, 300); break;
    case 'compare': c.compare = p.names.every(n => lc(head).includes(lc(n))); break;
    case 'risk': c.risk = hasAny(a, p.kw, 260) && (!p.unverified || /\b(?:unverified|not (?:been )?(?:verified|confirmed)|cannot confirm|can't confirm|have not verified|your own statement|not independently)/i.test(a.slice(0, 320)))
      && (!p.hedge || /\b(?:cannot|can't|could not|not (?:confirmed|available|observ)|unverified|only)/i.test(a.slice(0, 340))) && /^(?!Based on the evidence available, (?:1 item|this is what))/.test(a.trim()); break;
    case 'limit': c.limitation = NEG.test(a.slice(0, 220)) && hasAny(a, p.kw, 300); break;
    case 'ack': c.ack = /^(?:understood|noted|okay|ok|will do|got it|i will not|i won't|i'll not|of course|sure)/i.test(a.trim()) && hasAny(a, p.kw, 200); break;
    case 'clarify': c.clarify = /\?|\bwhich\b/i.test(a.slice(0, 200)) && !/^I can (?:tell you|help)/.test(a); break;
    case 'discovery': c.discovery = /^Here is what I can safely help with|^I can tell you about what Ochiga does/.test(a.trim()) || cap === 'global.capabilities.read'; break;
  }
  // IQ-8 harness definition (corrected before the final measurement): a menu is judged by its TEXT, not by the capability key that carried a targeted limitation.
  if (it.kind !== 'discovery') c.not_menu = !(/^I understand the request, but Oyi does not have an enabled|^I can (?:tell you about|help with)/.test(a.trim()) || cap === 'business_surface.fallback');
  return c;
};
const out = [];
for (const it of suite.items) {
  const {turns} = await converse(it.s, ROLE[it.s], [...(it.seeds || []), it.u]); const t = turns[turns.length - 1];
  const a = t.answer, cap = String(t.capability || ''), checks = shapeCheck(it, a, cap, t.status);
  out.push({id: it.id, s: it.s, shape: it.shape, kind: it.kind, u: it.u, capability: cap, status: t.status, lead: a.replace(/\s+/g, ' ').slice(0, 200), checks, pass: Object.values(checks).every(Boolean)});
}
const rate = rs => ({n: rs.length, pass: rs.filter(r => r.pass).length, rate: rs.length ? +(rs.filter(r => r.pass).length / rs.length).toFixed(3) : null});
const byShape = Object.fromEntries([...new Set(out.map(o => o.shape))].map(s => [s, rate(out.filter(o => o.shape === s))]));
const bySurface = Object.fromEntries([...new Set(out.map(o => o.s))].map(s => [s, rate(out.filter(o => o.s === s))]));
const summary = {overall: rate(out), by_shape: byShape, by_surface: bySurface, boilerplate_lead: {n: out.filter(o => !o.checks.not_boilerplate).length, rate: +(out.filter(o => !o.checks.not_boilerplate).length / out.length).toFixed(3)}, menu_fallback: out.filter(o => o.checks.not_menu === false).length, executed};
fs.writeFileSync(cfg.out, JSON.stringify({summary, items: out}, null, 1)); console.log(JSON.stringify(summary)); process.exit(0);
