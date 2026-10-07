// IQ-8D performance: target derivation, envelope mapping, projection. Pure functions; no provider call, no database query.
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
import fs from 'node:fs';
const {deriveAnswerTarget} = await import('../dist/oyi-core/response/answerTarget.js');
const {mapResultEnvelope} = await import('../dist/oyi-core/response/envelopeMappers.js');
const {projectResponse} = await import('../dist/oyi-core/response/projector.js');
const items = JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq8b-fresh-suite.json', 'utf8'));
const qs = (items.items || items).map(x => x.u || x.utterance).filter(Boolean);
const result = {status: 'answered', answer: '2 maintenance requests', presentation_policy: {primary: 'list'}, blocks: [{type: 'record_list', title: 'Maintenance', columns: [{key: 'title', label: 'T'}, {key: 'status', label: 'S'}], rows: [{title: 'Water', status: 'open'}, {title: 'Light', status: 'resolved'}], total_count: 2}]};
const time = (f, n) => {const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) f(i); return Number(process.hrtime.bigint() - t) / 1e6 / n;};
for (let i = 0; i < 200; i++) deriveAnswerTarget(qs[i % qs.length]);
const N = 2000, derive = time(i => deriveAnswerTarget(qs[i % qs.length]), N);
const tg = qs.map(q => deriveAnswerTarget(q));
const map = time(() => mapResultEnvelope('maintenance.requests.read', result, {capability_status: 'enabled'}), N);
const env = mapResultEnvelope('maintenance.requests.read', result, {capability_status: 'enabled'});
const proj = time(i => projectResponse(tg[i % tg.length], env, {asked: 'q'}), N);
console.log(JSON.stringify({utterances: qs.length, derive_ms: +derive.toFixed(3), map_ms: +map.toFixed(4), project_ms: +proj.toFixed(4), total_added_ms_per_turn: +(map + proj).toFixed(3), provider_calls: 0, db_queries: 0}));
