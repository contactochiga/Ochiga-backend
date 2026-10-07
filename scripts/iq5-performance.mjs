// IQ-5 performance. Reference resolution is pure compute (no I/O, no provider): measured at several artifact sizes and reference forms.
// The conversation-level latency comparison uses the corpus run's own per-turn latency (derived-reference turns vs. turns that re-plan).
import fs from 'node:fs';
const ref = await import('../dist/oyi-core/evidence/reference/derivedReference.js');
const turn = await import('../dist/oyi-core/evidence/reference/derivedReferenceTurn.js');
const NOW = Date.now(), iso = ms => new Date(ms).toISOString();
const mkArt = (n, type = 'ranking') => ({v: 1, ranking_id: 'rk-perf', artifact_type: type, ordered: type === 'ranking', assessment_id: 'plan', objective: 'prioritize', basis: 'deterministic', scope_key: 's', subject_key: 'k', surface: 'facility', scope_binding: 'B', source_keys: ['maintenance.requests.read'],
  created_at: iso(NOW), updated_at: iso(NOW), expires_at: iso(NOW + 1800000), tied_groups: 0, limitations: ['Office evidence is a bounded, supplied view.'], uncertainties: ['Camera state is unobservable for 1 camera.'], focus: null, parked: false, stale: null,
  items: Array.from({length: n}, (_, i) => ({rank: i + 1, tier: i, ref: {t: 'maintenance_request', id: `id-${i}`, label: `Issue number ${i + 1} label`}, rationale: `Issue number ${i + 1} label: open/active, recorded priority ${['high', 'medium', 'low'][i % 3]}`, factors: [{dimension: 'lifecycle', level: 'active'}, {dimension: 'importance', level: ['high', 'medium', 'low'][i % 3]}], group: 'ranked', kind: 'issue', source_key: 'maintenance.requests.read', evidence: ['e1', 's1']}))});
const stats = a => {const s = [...a].sort((x, y) => x - y); return {n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(4), p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], max: s.at(-1)};};
const forms = ['Why the second one?', 'Why not the third?', 'Compare the top two.', 'Which of those can wait?', 'What about the other one?', 'Go back to those priorities.', 'Why #2?', 'Can the last one wait?', 'Why?', 'Is that dangerous?'];
const N = 2000, report = {pure_resolution: []};
for (const n of [3, 10, 64]) {
  const art = mkArt(n), prev = {objective: 'prioritize', surface: 'facility', domain: null, question: 'q', status: 'assessment_pending', created_at: iso(NOW), updated_at: iso(NOW), expires_at: iso(NOW + 1800000), derived_ranking: art};
  for (const f of forms) turn.handleDerivedReferenceTurn({text: f, previous: prev, surface: 'facility', now: NOW + 1, raw: null, scopeBinding: 'B', authorised: () => true});
  const ms = [], sizes = []; for (let i = 0; i < N; i++) { const text = forms[i % forms.length]; const t = performance.now(); const r = turn.handleDerivedReferenceTurn({text, previous: prev, surface: 'facility', now: NOW + 1, raw: null, scopeBinding: 'B', authorised: () => true}); ms.push(performance.now() - t); if (r.handled) sizes.push(r.answer.length);}
  report.pure_resolution.push({artifact_items: n, artifact_bytes: JSON.stringify(art).length, resolution_ms: stats(ms.map(x => +x.toFixed(4))), answer_chars: stats(sizes)});
}
const parse = []; for (let i = 0; i < N; i++) { const t = performance.now(); ref.parseDerivedReference(forms[i % forms.length]); parse.push(performance.now() - t); } report.parse_ms = stats(parse.map(x => +x.toFixed(4)));
const records = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/iq5-v3-iq.json', 'utf8')).records;
const lat = f => records.filter(f).map(r => r.latency_ms).filter(Number.isFinite);
report.corpus_latency_ms = {derived_reference_turns: stats(lat(r => r.response.execution?.assessment_status === 'derived_reference') .concat([0]).slice(0, -1) || [0]), assessment_turns_that_replan: stats(lat(r => r.response.execution?.assessment_status === 'evidence_gathered')), all_turns: stats(lat(() => true))};
const out = {status: 'MEASURED', environment: 'pure compute in one Node process; corpus latency from the local loopback fixture run (no live model, no network)', iterations: N, ...report};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq5-performance.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({pure: report.pure_resolution.map(r => [r.artifact_items, r.resolution_ms.p95]), parse_p95: report.parse_ms.p95, corpus: Object.fromEntries(Object.entries(report.corpus_latency_ms).map(([k, v]) => [k, [v.n, v.p50, v.p95]]))}));
