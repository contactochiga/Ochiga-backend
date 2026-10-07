// IQ-8E routing trace (no database, no provider): for each prompt+surface print the semantic frame's routing facts and the ranked capability candidates
// exactly as CapabilityService.resolve ranks them (match score, surface eligibility). Diagnostic tool; changes nothing.
import {createRequire} from 'node:module';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
(await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js')).ensureRegistered();
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {capabilityRegistry} = await import('../dist/oyi-core/capabilities/CapabilityRegistry.js');
const cases = JSON.parse(process.argv[2]);
const score = (m, f) => !m.supports(f) ? 0 : (m.operations || []).includes(f.operation) ? 100 : m.domain === f.domain ? 25 : 10;
for (const [surface, prompt] of cases) {
  const f = parseSemanticFrame(prompt, {surface});
  const c = capabilityRegistry.all().map(m => ({k: m.key, s: score(m, f), ok: !m.supported_surfaces?.length || m.supported_surfaces.includes(surface), st: m.rolloutStatus})).filter(x => x.s > 0).sort((a, b) => (Number(b.ok) - Number(a.ok)) || (b.s - a.s)).slice(0, 4);
  console.log(JSON.stringify({surface, prompt, dom: f.domain, op: f.operation, mut: f.mutationIntent, obj: f.concepts?.object, facet: f.concepts?.facet, head: f.concepts?.head_domain, intent: f.answerTarget.response_intent, cands: c.map(x => `${x.k}:${x.s}${x.ok ? '' : '!surf'}${x.st !== 'enabled' ? '!' + x.st : ''}`)}));
}
