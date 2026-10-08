// IQ-9A6 diagnostic (read-only): parsed objective, answer shape and subject for dev-suite utterances (single-turn parse; no data, no provider).
import fs from 'node:fs'; import {createRequire} from 'node:module';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
(await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js')).ensureRegistered();
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {assessmentSubjectDomains} = await import('../dist/oyi-core/context/conversationAssessmentContext.js');
const E = Object.fromEntries(JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq9a-dev-expectations.json', 'utf8')).items.map(x => [x.id, x]));
const out = {};
for (const id of JSON.parse(process.argv[2])) {const e = E[id]; const f = parseSemanticFrame(e.utterance, {surface: e.surface}); const t = f.answerTarget;
  out[id] = {objective: f.cognitiveObjective || null, shape: t.response_intent, yes_no_kind: t.yes_no?.kind || null, confirmation_kind: t.confirmation_kind || null, head_domain: f.concepts?.head_domain ?? null, concept_domains: (f.concepts?.domains || []).map(d => d.domain), subject_domains: assessmentSubjectDomains(f, e.surface)};}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
