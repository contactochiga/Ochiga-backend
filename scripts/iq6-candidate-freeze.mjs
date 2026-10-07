// IQ-6 candidate freeze. Diagnostic only: reads the certified post-IQ-5 corpus run, runs no runtime code, and fixes WHICH turns IQ-6 owns
// BEFORE any reassessment code exists. Not limited to IQ-5's 7: every turn is inspected. Fact-type and class heuristics here are
// freeze-time diagnostics (the runtime reuses the IQ-2 predicates); they are recorded, not graded.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const prefix = process.argv[2] || '/tmp/iq5-v3';
const raw = read(`${prefix}-iq.json`);
const before = read('artifacts/intelligence-quality-v1-iq2c-results.json');
const iq4 = read('artifacts/intelligence-quality-v1-iq4-results.json'), iq5 = read('artifacts/intelligence-quality-v1-iq5-results.json');
assert.equal(raw.records.length, 280);
const promoted = new Set([...iq4.summary.promoted, ...iq5.summary.promoted]);
const IQ5 = Object.fromEntries(iq5.candidates.map(c => [c.id, c]));
const IMPERATIVE = /^(?:do not|don't|ask me|just advise|never|please|show|list|open|compare|draft|tell|go back|ignore|pretend|cancel|make|give|offer|suggest|recommend|summarize|explain|now|then|turn|assume|who|what|which|how|why)\b/i;
const isStatement = t => !/\?\s*$/.test(t) && !IMPERATIVE.test(t.trim());
const CORRECTION = /\b(?:actually|i meant|i mean|sorry|i was wrong|not\s+\w+(?:\s+\w+)?[,;]?\s*(?:it'?s|but)|rather than|instead|that is not what i mean)\b/i;
const HYPO = /\b(?:if|suppose|what if|would it|could it)\b/i;
const CLASS_KEYWORDS = [['office_financial', /financ|fund|capital|payment|cash/i], ['office_development', /project|title|approval|survey|permit|development|blocker/i], ['crm', /lead|prospect|opportunit|deal|jv\b|return/i],
  ['maintenance', /leak|water|repair|plumb|maintenance|fixed|electrical panel/i], ['security', /incident|break-?in|alarm|intruder/i], ['cameras', /camera|cctv/i], ['visitors', /visitor|arriv|guest|expected/i],
  ['devices', /\bac\b|lock|door|light|device|sensor|temperature|hot|cold/i], ['corporate_opportunity', /sqm|land|title|family|sell|jv|lagos|abuja|lekki|epe/i]];
const classesOf = t => CLASS_KEYWORDS.filter(([, re]) => re.test(t)).map(([c]) => c);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
const by = {}; for (const r of raw.records) (by[r.journey_id] ||= {})[r.turn_number] = r;
const rows = raw.records.map((r, i) => {
  const id = `${r.journey_id.replace('IQ-EVAL-', '')}:${r.turn_number}`, b = before.records[i], ex = r.response.execution || {}, ac = ex.assessment_context || {};
  const prev = by[r.journey_id]?.[r.turn_number - 1], pex = prev?.response.execution || {}, pac = pex.assessment_context || null, art = pac?.derived_ranking || null;
  const objective = ex.cognitive_objective || b.cognitive_objective || null, text = r.prompt;
  const statement = isStatement(text), correction = statement && CORRECTION.test(text), reassessAsk = objective === 'reassess';
  const publicPrior = r.surface === 'public_corporate' && r.turn_number > 1;
  const type = reassessAsk ? 'REASSESSMENT_REQUEST' : correction ? 'CORRECTION' : HYPO.test(text) ? 'HYPOTHETICAL' : statement && (art || pac?.evidence_plan || publicPrior) ? 'MATERIAL_OR_UNVERIFIED_FACT' : statement ? 'FACT_WITHOUT_ACTIVE_ASSESSMENT' : null;
  const target = art ? art.items.filter(it => it.ref.label && norm(text).includes(norm(it.ref.label).trim())).map(it => it.ref.label) : [];
  const status = promoted.has(id) ? 'PASS' : b.status;
  const layer = !type ? null : !art && !publicPrior ? 'NO_PRIOR_DERIVED_ASSESSMENT' : art && ex.assessment_status === 'derived_reference' ? 'STALE_MARKED_NOT_REASSESSED' : art ? 'ARTIFACT_NOT_CONSULTED' : publicPrior ? 'PUBLIC_QUALIFICATION_FLOW_NO_CHANGE_STATEMENT' : 'OTHER';
  return {id, journey_id: r.journey_id, turn_number: r.turn_number, worker: r.worker, surface: r.surface, prompt: text, status_post_iq5: status, objective, update_type: type,
    previous: prev ? {assessment_id: pex.evidence_plan_id || null, derived_artifact: art ? {type: art.artifact_type ?? 'ranking', stale: Boolean(art.stale), items: art.items.map(it => ({rank: it.rank, group: it.group, label: it.ref.label}))} : null, answer_head: String(prev.response.answer).slice(0, 220)} : null,
    new_fact: type && type !== 'REASSESSMENT_REQUEST' ? {text, confidence: 'user_supplied_unverified'} : null, target_candidates: target, affected_evidence_classes: classesOf(text),
    expected: {must_notice: r.envelope?.expected?.must_notice || r.envelope?.must_notice || null}, actual: {capability: ex.capability_key || r.response.capability_key || null, assessment_status: ex.assessment_status || null, answer_head: String(r.response.answer).slice(0, 220)},
    failure_layer: status === 'PASS' ? null : layer, iq5_class: IQ5[id]?.class_after || null};
});
// Owned = a non-passing turn whose primary requirement is reassessment / a material update to an ACTIVE assessment (or a correction to one).
// A first-time fact that merely builds a public qualification, or a fact with no assessment behind it, is not a reassessment.
const owned = rows.filter(t => t.status_post_iq5 !== 'PASS' && (t.update_type === 'REASSESSMENT_REQUEST' || t.iq5_class === 'REASSESSMENT_LATER' || (['CORRECTION', 'MATERIAL_OR_UNVERIFIED_FACT'].includes(t.update_type) && (t.previous?.derived_artifact || (t.surface !== 'public_corporate' && t.previous?.assessment_id) || (t.surface === 'public_corporate' && t.update_type === 'CORRECTION')))));
for (const t of owned) t.ownership = 'IQ6_CANDIDATE';
const tally = (rs, f) => rs.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});
const out = {version: 1, status: 'IQ6_CANDIDATE_SET_FROZEN_PRE_RUNTIME', starting_head: '20f04f3f5711ddcb0e142102b4497b5fa0286c86', raw_sha256: createHash('sha256').update(fs.readFileSync(`${prefix}-iq.json`)).digest('hex'),
  rule: 'see scripts/iq6-candidate-freeze.mjs; heuristics are freeze-time diagnostics, expectations unchanged',
  summary: {turns: 280, update_turns_total: rows.filter(t => t.update_type).length, candidates: owned.length, by_surface: tally(owned, t => t.surface), by_type: tally(owned, t => t.update_type), by_failure_layer: tally(owned, t => t.failure_layer), by_status: tally(owned, t => t.status_post_iq5),
    iq5_stated_reassessment: rows.filter(t => t.iq5_class === 'REASSESSMENT_LATER').length, iq5_reassessment_in_candidates: owned.filter(t => t.iq5_class === 'REASSESSMENT_LATER').length, reassess_objective_turns: rows.filter(t => t.update_type === 'REASSESSMENT_REQUEST').length},
  turns: rows, candidates: owned.map(t => t.id)};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq6-candidates.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.summary, null, 1)); console.log(owned.map(t => `${t.id}|${t.update_type}|${t.failure_layer}|${t.prompt.slice(0, 50)}`).join('\n'));
