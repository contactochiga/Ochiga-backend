// IQ-4 judgment performance. Pure compute (judgment performs no I/O): measures deterministic judgment at several candidate-set
// sizes, and provider-backed judgment against a STUB with controlled latency so Core's own overhead (request building,
// adoption, validation, composition) is separated from provider latency. No live model was available or measured.
import fs from 'node:fs';
const {judgeAssessment, JUDGMENT_PROVIDER_TIMEOUT_MS} = await import('../dist/oyi-core/evidence/judgment/judge.js');
const {buildEvidenceIndex} = await import('../dist/oyi-core/evidence/judgment/evidenceIndex.js');
const {buildProviderRequest} = await import('../dist/oyi-core/evidence/judgment/provider.js');
const iso = ms => new Date(ms).toISOString(); const NOW = Date.now();
const contrib = (key, cls, material, o = {}) => ({source_key: key, evidence_class: cls, necessity: 'mandatory', status: 'available_partial', availability: 'available', completeness: 'partial', freshness: 'current', scope_class: 'facility_estate', lifecycle: {active: 0, historical: 0, unknown: 0}, record_count: material.length, unobserved: 0, source_total: null, truncated: false, degraded: [], refs: material.map((m, i) => ({t: cls, id: `${cls}-${i}`, l: m.label})), material, provenance: [], gathered_at: iso(NOW), fresh_until: iso(NOW + 600000), latency_ms: 1, ...o});
const state = cs => ({v: 1, plan_id: 'perf-plan', gathered_at: iso(NOW), expires_at: iso(NOW + 600000), scope_key: 's', subject_key: 'k', input_fingerprint: null, material_hash: null, objective: 'prioritize', surface: 'facility', status: 'MANDATORY_PARTIAL', classes: cs.map(c => ({class: c.evidence_class, necessity: 'mandatory', status: 'MANDATORY_PARTIAL', sources: [c.source_key], reason: null})), contributions: cs, missing_mandatory: [], optional_unavailable: [], cannot_conclude: [], requested_not_honoured: [], limits: {}, stats: {}, invalidation: []});
const prios = ['high', 'medium', 'low', 'critical'];
const issues = n => Array.from({length: n}, (_, i) => ({label: `Issue ${i + 1}`, title: `Issue ${i + 1}`, status: i % 5 === 4 ? 'resolved' : 'open', priority: prios[i % 4]}));
const leads = n => Array.from({length: n}, (_, i) => ({label: `Lead ${i + 1}`, status: i % 3 ? 'new' : 'qualified', reason: `Recorded note number ${i + 1} about viability and documents`}));
const stats = a => {const s = [...a].sort((x, y) => x - y); return {n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3), p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], max: s.at(-1)};};
const time = async fn => {const t = performance.now(); const r = await fn(); return [performance.now() - t, r];};
const N = 200, report = {deterministic: [], provider_backed: []};
for (const [name, n] of [['2_candidates', 2], ['3_candidates', 3], ['largest_bounded_typed_set (8 sources x 8 items = 64)', 64]]) {
  const st = state(n <= 3 ? [contrib('maintenance.requests.read', 'maintenance', issues(n))] : Array.from({length: 8}, (_, i) => contrib(['maintenance.requests.read', 'security.incidents.read', 'office_tasks.query.read', 'office_support.query.read', 'office_meetings.query.read', 'maintenance.requests.read', 'security.incidents.read', 'office_tasks.query.read'][i], ['maintenance', 'security', 'office_tasks', 'office_support', 'office_meetings', 'maintenance', 'security', 'office_tasks'][i], issues(8))));
  for (let i = 0; i < 20; i++) await judgeAssessment({state: st, objective: 'prioritize', question: 'Which three first?', surface: 'facility', previous: null, provider: null});
  const ms = [], bytes = []; for (let i = 0; i < N; i++) {const [t, o] = await time(() => judgeAssessment({state: st, objective: 'prioritize', question: 'Which three first?', surface: 'facility', previous: null, provider: null})); ms.push(+t.toFixed(3)); bytes.push(o.text.length);}
  report.deterministic.push({scenario: name, candidates: buildEvidenceIndex(st).candidates.length, judgment_ms: stats(ms), response_chars: stats(bytes)});
}
const bizState = n => state([contrib('crm.leads.read', 'crm', leads(n), {scope_class: 'office_permissioned_snapshot'})]);
for (const [name, n] of [['2_candidates', 2], ['3_candidates', 3], ['largest_bounded_candidate_set (8 items per source)', 8]]) for (const providerMs of [0, 50, 250]) {
  const st = bizState(n); const idx = buildEvidenceIndex(st, NOW); const labels = idx.candidates.slice(0, Math.min(3, n)).map(c => c.ref.label);
  const proposal = () => ({status: 'ranked', ranking: idx.candidates.slice(0, Math.min(3, n)).map((c, i) => ({cid: c.cid, rank: i + 1, rationale: `${c.ref.label} is supported by its recorded notes`, supporting: [], counter: [], uncertainties: []})), conclusion: 'the order reflects what is recorded', uncertainties: ['not independently verified'], clarification: null});
  const provider = {name: `stub+${providerMs}ms`, judge: async () => {if (providerMs) await new Promise(r => setTimeout(r, providerMs)); return proposal();}};
  const total = [], overhead = [], reqBytes = []; const runs = providerMs ? 25 : N;
  for (let i = 0; i < runs; i++) {const [t, o] = await time(() => judgeAssessment({state: st, objective: 'prioritize', question: 'Which three first?', surface: 'office_internal', previous: null, provider})); if (o.result.mode !== 'provider') throw Error(`stub proposal rejected: ${JSON.stringify(o.validation.failures)}`); total.push(+t.toFixed(3)); overhead.push(+(t - (o.provider.latency_ms ?? 0)).toFixed(3));}
  reqBytes.push(JSON.stringify(buildProviderRequest({index: idx, candidates: idx.candidates, objective: 'prioritize', surface: 'office_internal', question: 'Which three first?', topN: 3, limits: ['bounded']})).length);
  report.provider_backed.push({scenario: name, stub_provider_latency_ms: providerMs, candidates: idx.candidates.length, total_judgment_ms: stats(total), core_overhead_ms_excluding_provider: stats(overhead), provider_request_bytes: reqBytes[0], labels_ranked: labels.length});
}
const out = {status: 'MEASURED', environment: 'pure compute in one Node process; provider is a latency-controlled stub (no live model was available)', runs_deterministic: N, configured_provider_timeout_ms: JUDGMENT_PROVIDER_TIMEOUT_MS, ...report};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq4-performance.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({det: report.deterministic.map(r => [r.scenario.slice(0, 22), r.candidates, r.judgment_ms.p95]), prov: report.provider_backed.map(r => [r.scenario.slice(0, 22), r.stub_provider_latency_ms, r.core_overhead_ms_excluding_provider.p95, r.provider_request_bytes])}));
