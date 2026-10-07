// IQ-8F: validate, de-duplicate-check, assign ids and freeze the independently authored corpus. No content is edited.
import fs from 'node:fs'; import {createHash} from 'node:crypto';
const W = ['Oma', 'Osa', 'Facility', 'Consumer'], SURF = {Oma: 'office_internal', Osa: 'public_corporate', Facility: 'facility', Consumer: 'consumer'};
const INTENTS = ['LIST','COUNT','STATUS','DETAIL','VALUE_SUM','YES_NO','EXPLANATION','COMPARISON_RANKING','LIMITATION','REFUSAL','CONSTRAINT','CLARIFICATION','ACTION_CONFIRMATION','SAFETY_RISK','DISCOVERY','FOLLOWUP_CONTEXT'];
const BOUND = ['PRIVACY','AUTHORITY','ACTION_SAFETY','CANCELLATION','HONEST_LIMITATION','SUBMISSION','JUDGMENT_NO_PROVIDER','CONTEXT_REFERENT'];
const OUTC = ['ANSWER','LIMITATION','REFUSAL','CLARIFICATION','NOT_EXECUTED'];
const report = {problems: [], counts: {}}; const items = []; const pr = (m) => report.problems.push(m);
for (const w of W) {
  let f; try { f = JSON.parse(fs.readFileSync(`/tmp/iq8f/author-${w}.json`, 'utf8')); } catch (e) { pr(`${w}: unparseable (${e.message})`); continue; }
  const sets = {primary: f.items || [], paraphrase: f.paraphrases || [], flip: f.flips || []};
  report.counts[w] = {primary: sets.primary.length, paraphrase: sets.paraphrase.length, flip: sets.flip.length};
  if (sets.primary.length !== 80) pr(`${w}: ${sets.primary.length} primary (need 80)`);
  if (sets.paraphrase.length !== 25) pr(`${w}: ${sets.paraphrase.length} paraphrases (need 25)`);
  if (sets.flip.length !== 25) pr(`${w}: ${sets.flip.length} flips (need 25)`);
  const perIntent = Object.fromEntries(INTENTS.map(i => [i, sets.primary.filter(x => x.intent === i).length]));
  for (const i of INTENTS) if (perIntent[i] < 4) pr(`${w}: intent ${i} has ${perIntent[i]} (<4)`);
  for (const b of BOUND) { const n = sets.primary.filter(x => x.boundary === b).length; if (n < 2) pr(`${w}: boundary ${b} has ${n} (<2)`); }
  const seen = new Set(); let k = 0;
  for (const [setName, arr] of Object.entries(sets)) for (const x of arr) {
    if (!x.utterance || typeof x.utterance !== 'string') pr(`${w}/${x.local_id}: no utterance`);
    if (!INTENTS.includes(x.intent)) pr(`${w}/${x.local_id}: bad intent ${x.intent}`);
    if (!x.expected || !OUTC.includes(x.expected.outcome) || !x.expected.must_convey) pr(`${w}/${x.local_id}: bad expectation`);
    if (seen.has(x.local_id)) pr(`${w}: duplicate local_id ${x.local_id}`); seen.add(x.local_id);
    items.push({set: setName, worker: w, surface: SURF[w], local_id: x.local_id, intent: x.intent, boundary: x.boundary || null, register: x.register || null, seeds: x.seeds || [], utterance: x.utterance, companion_of: x.companion_of || null, expected: x.expected});
  }
}
const idOf = new Map(); let n = 0;
for (const it of items) { it.id = `IQ8F-${it.worker.toUpperCase()}-${it.set === 'primary' ? 'P' : it.set === 'paraphrase' ? 'R' : 'F'}${String(++n).padStart(4, '0')}`; idOf.set(`${it.worker}/${it.local_id}`, it.id); }
for (const it of items) if (it.companion_of) { it.companion_of_id = idOf.get(`${it.worker}/${it.companion_of}`) || null; if (!it.companion_of_id) pr(`${it.id}: companion_of ${it.companion_of} not found`); }
// overlap with every earlier suite (exact normalised duplicates + word-4-gram Jaccard)
const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const prior = [];
for (const p of fs.readdirSync('artifacts').filter(x => /iq8.*(suite|heldout)/.test(x) && x.endsWith('.json') && !x.includes('iq8f'))) { try { const j = JSON.parse(fs.readFileSync('artifacts/' + p, 'utf8')); for (const x of (j.items || j.utterances || [])) { if (x.u) prior.push(norm(x.u)); if (x.utterance) prior.push(norm(x.utterance)); for (const s of (x.seeds || [])) prior.push(norm(s)); } } catch {} }
const grams = s => { const w = s.split(' '); const g = new Set(); for (let i = 0; i + 4 <= w.length; i++) g.add(w.slice(i, i + 4).join(' ')); return g; };
const priorSet = new Set(prior), priorG = prior.map(grams);
let exact = 0, near = 0; const nearIds = [];
for (const it of items) { const u = norm(it.utterance); if (priorSet.has(u)) { exact++; it.overlap = 'exact'; continue; } const g = grams(u); if (g.size >= 2) { let best = 0; for (const pg of priorG) { if (!pg.size) continue; let inter = 0; for (const x of g) if (pg.has(x)) inter++; best = Math.max(best, inter / (g.size + pg.size - inter)); } if (best >= 0.6) { near++; nearIds.push(it.id); it.overlap = 'near'; } } }
report.overlap = {prior_utterances_compared: prior.length, exact_duplicates: exact, near_duplicates: near, items: items.length, exact_rate: +(exact / items.length).toFixed(4), near_ids: nearIds};
report.totals = {items: items.length, primary: items.filter(i => i.set === 'primary').length, paraphrase: items.filter(i => i.set === 'paraphrase').length, flip: items.filter(i => i.set === 'flip').length};
report.primary_by_intent = Object.fromEntries(INTENTS.map(i => [i, items.filter(x => x.set === 'primary' && x.intent === i).length]));
report.primary_by_worker = Object.fromEntries(W.map(w => [w, items.filter(x => x.set === 'primary' && x.worker === w).length]));
report.primary_by_boundary = Object.fromEntries(BOUND.map(b => [b, items.filter(x => x.set === 'primary' && x.boundary === b).length]));
report.registers = items.reduce((m, x) => (m[x.register || 'none'] = (m[x.register || 'none'] || 0) + 1, m), {});
console.log(JSON.stringify(report, null, 1));
if (process.argv[2] === 'freeze' && !report.problems.length && exact / items.length <= 0.02) {
  const runner = items.map(i => ({id: i.id, surface: i.surface, seeds: i.seeds, utterance: i.utterance}));
  const expect = items.map(({overlap, ...i}) => i);
  fs.writeFileSync('artifacts/intelligence-quality-v1-iq8f-corpus-runner.json', JSON.stringify({version: 1, items: runner}, null, 1) + '\n');
  fs.writeFileSync('artifacts/intelligence-quality-v1-iq8f-corpus-expectations.json', JSON.stringify({version: 1, status: 'IQ8F_CORPUS_FROZEN_BEFORE_FIRST_EXECUTION', items: expect}, null, 1) + '\n');
  const h = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  fs.writeFileSync('artifacts/intelligence-quality-v1-iq8f-corpus-hashes.json', JSON.stringify({runner_sha256: h('artifacts/intelligence-quality-v1-iq8f-corpus-runner.json'), expectations_sha256: h('artifacts/intelligence-quality-v1-iq8f-corpus-expectations.json'), protocol_sha256: h('docs/INTELLIGENCE_QUALITY_V1_IQ8F_CERTIFICATION_PROTOCOL.md'), spec_sha256: createHash('sha256').update(fs.readFileSync('/tmp/iq8f/spec.md')).digest('hex'), authors: W.map(w => ({worker: w, file: `author-${w}.json`, sha256: createHash('sha256').update(fs.readFileSync(`/tmp/iq8f/author-${w}.json`)).digest('hex')})), overlap: report.overlap, frozen_at: new Date().toISOString(), head: 'e62a772+'}, null, 1) + '\n');
  fs.copyFileSync('/tmp/iq8f/spec.md', 'artifacts/intelligence-quality-v1-iq8f-author-spec.md');
  for (const w of W) fs.copyFileSync(`/tmp/iq8f/author-${w}.json`, `artifacts/intelligence-quality-v1-iq8f-author-${w}.json`);
  console.log('FROZEN');
}
