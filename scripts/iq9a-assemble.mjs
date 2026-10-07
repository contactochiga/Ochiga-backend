// IQ-9A: validate and freeze the independently authored safety development suite. No content is edited.
import fs from 'node:fs'; import {createHash} from 'node:crypto';
const CATS = ['CROSS_RESIDENT_SCOPE','HOME_VS_ESTATE_AUTHORITY','VISITOR_PERMISSION_VS_PRESENCE','ACTION_PROPOSED_VS_COMPLETED','EMAIL_REQUESTED_SENT_DELIVERED','CALLBACK_PROPOSED_ACKNOWLEDGED_COMPLETED','JUDGMENT_DETERMINISTIC_VS_PROVIDER','UNVERIFIED_SAFETY_REPORTS','CANCELLATIONS_WITH_COMPETING_SIGNALS','MULTITURN_REFERENT_AND_AUTHORITY'];
const SURF = ['office_internal', 'public_corporate', 'facility', 'consumer'], OUTC = ['ANSWER','LIMITATION','REFUSAL','CLARIFICATION','NOT_EXECUTED'];
const problems = []; const items = []; let n = 0;
for (const f of ['dev-author-1', 'dev-author-2']) {
  let j; try { j = JSON.parse(fs.readFileSync(`/tmp/iq8f/${f}.json`, 'utf8')); } catch (e) { problems.push(`${f}: ${e.message}`); continue; }
  for (const x of j.items || []) {
    if (!CATS.includes(x.category)) problems.push(`${f}/${x.local_id}: bad category ${x.category}`);
    if (!SURF.includes(x.surface)) problems.push(`${f}/${x.local_id}: bad surface ${x.surface}`);
    if (!x.utterance || !x.expected || !OUTC.includes(x.expected.outcome)) problems.push(`${f}/${x.local_id}: bad item`);
    items.push({id: `IQ9A-${String(++n).padStart(3, '0')}`, category: x.category, positive_control: Boolean(x.positive_control), surface: x.surface, seeds: x.seeds || [], utterance: x.utterance, register: x.register || null, expected: x.expected, author_file: f, local_id: x.local_id});
  }
}
const by = c => items.filter(i => i.category === c);
for (const c of CATS) { if (by(c).length !== 16) problems.push(`${c}: ${by(c).length} items (need 16)`); const pc = by(c).filter(i => i.positive_control).length; if (pc < 7) problems.push(`${c}: ${pc} positive controls (<7)`); }
const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const prior = new Set();
for (const p of fs.readdirSync('artifacts').filter(x => x.endsWith('.json') && /iq8/.test(x))) { try { const j = JSON.parse(fs.readFileSync('artifacts/' + p, 'utf8')); for (const x of (j.items || j.utterances || [])) { for (const k of ['u', 'utterance']) if (x[k]) prior.add(norm(x[k])); for (const s of (x.seeds || [])) prior.add(norm(s)); } } catch {} }
const exact = items.filter(i => prior.has(norm(i.utterance))).length;
const rep = {problems, items: items.length, per_category: Object.fromEntries(CATS.map(c => [c, by(c).length])), positive_controls: items.filter(i => i.positive_control).length, per_surface: Object.fromEntries(SURF.map(s => [s, items.filter(i => i.surface === s).length])), exact_overlap_with_prior_suites: exact, prior_compared: prior.size};
console.log(JSON.stringify(rep, null, 1));
if (process.argv[2] === 'freeze' && !problems.length && exact / items.length <= 0.02) {
  fs.writeFileSync('artifacts/intelligence-quality-v1-iq9a-dev-runner.json', JSON.stringify({version: 1, items: items.map(i => ({id: i.id, surface: i.surface, seeds: i.seeds, utterance: i.utterance}))}, null, 1) + '\n');
  fs.writeFileSync('artifacts/intelligence-quality-v1-iq9a-dev-expectations.json', JSON.stringify({version: 1, status: 'IQ9A_DEV_SUITE_FROZEN_BEFORE_IMPLEMENTATION_RUN', items}, null, 1) + '\n');
  const h = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  fs.copyFileSync('/tmp/iq8f/dev-spec.md', 'artifacts/intelligence-quality-v1-iq9a-dev-author-spec.md');
  for (const f of ['dev-author-1', 'dev-author-2']) fs.copyFileSync(`/tmp/iq8f/${f}.json`, `artifacts/intelligence-quality-v1-iq9a-${f}.json`);
  fs.writeFileSync('artifacts/intelligence-quality-v1-iq9a-dev-hashes.json', JSON.stringify({runner_sha256: h('artifacts/intelligence-quality-v1-iq9a-dev-runner.json'), expectations_sha256: h('artifacts/intelligence-quality-v1-iq9a-dev-expectations.json'), spec_sha256: h('artifacts/intelligence-quality-v1-iq9a-dev-author-spec.md'), overlap: rep}, null, 1) + '\n');
  console.log('FROZEN');
}
