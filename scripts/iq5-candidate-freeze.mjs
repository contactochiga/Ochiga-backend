// IQ-5 candidate freeze. Diagnostic only: reads the certified post-IQ-4 corpus run and results, runs no runtime code, and fixes
// WHICH turns IQ-5 owns BEFORE any reference-continuity code changes. It does not assume IQ-4's "20" is complete: all 280 turns are
// inspected for a reference form and for the mechanism by which the post-IQ-4 answer picked its referent.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const prefix = process.argv[2] || '/tmp/iq4-v4';
const raw = read(`${prefix}-iq.json`);
const before = read('artifacts/intelligence-quality-v1-iq2c-results.json');
const iq4 = read('artifacts/intelligence-quality-v1-iq4-results.json');
const iq4c = read('artifacts/intelligence-quality-v1-iq4-candidates.json');
assert.equal(raw.records.length, 280);
const promoted = new Set(iq4.summary?.promoted || iq4.promoted || []);
const IQ4 = Object.fromEntries(Object.values(iq4.candidates).filter(c => c && c.id).map(c => [c.id, c]));
const OWN = Object.fromEntries(iq4c.turns.map(t => [t.id, t.ownership]));

// Reference forms, by kind. These describe how the USER refers; they do not decide correctness.
const FORMS = [
  ['ordinal', /\b(?:the\s+)?(?:first|second|third|fourth|fifth|last|top|bottom)\s+(?:one|priority|item|issue|concern|thing|lead|project|opportunity)\b|\bthe\s+(?:first|second|third|fourth|fifth|last)\b|\b(?:number|no\.?|#)\s*\d\b|\b\d(?:st|nd|rd|th)\b/i],
  ['other_one', /\b(?:the\s+)?other\s+(?:one|two|ones)\b|\bthe\s+others\b|\banother\s+one\b/i],
  ['demonstrative', /\b(?:that|this)\s+(?:one|project|opportunity|issue|problem|concern|ownership issue|item)\b|\bthose\b|\bthese\b|\bwhy\s+that\b|\bis\s+that\b/i],
  ['return', /\bgo back\b|\breturn to\b/i],
  ['comparison_referent', /\b(?:compare|versus|vs\.?|which\s+of\s+those|of\s+those|between\s+(?:them|those|the))\b/i],
  ['implicit_why', /^\s*(?:and\s+)?why(?:\s+(?:so|is that))?\s*\??\s*$/i],
  ['pronoun', /\b(?:it|them|they)\b/i],
];
const formsOf = text => FORMS.filter(([, re]) => re.test(text)).map(([k]) => k);
const kind = ac => ac?.derived_ranking ? 'ranking' : ac?.evidence_plan ? 'assessment_set' : ac ? 'assessment_no_evidence' : null;

const by = {};
for (const r of raw.records) (by[r.journey_id] ||= {})[r.turn_number] = r;
const rows = raw.records.map((r, i) => {
  const id = `${r.journey_id.replace('IQ-EVAL-', '')}:${r.turn_number}`, b = before.records[i];
  const status = promoted.has(id) ? 'PASS' : b.status;
  const ex = r.response.execution || {}, ac = ex.assessment_context || null;
  const prev = by[r.journey_id]?.[r.turn_number - 1];
  const pex = prev?.response?.execution || {}, pac = pex.assessment_context || null;
  const forms = formsOf(r.prompt);
  const cap = ex.capability_key || r.response.capability_key || null;
  const resultSetNow = ac?.result_set_id || ex.result_set_id || ex.result_set?.result_set_id || null;
  const prevResultSet = pac?.result_set_id || pex.result_set_id || null;
  const i4 = IQ4[id];
  const primary = i4?.iq4_class === 'REFERENCE_CONTINUITY_IQ5' || OWN[id] === 'REFERENCE_CONTINUITY_IQ5';
  // Mechanism: how did the post-IQ-4 answer choose (or fail to choose) its referent?
  const genuine = forms.some(f => f !== 'pronoun');
  const mechanism = !(genuine || primary) ? null
    : cap === 'oyi.assessment.evidence_plan' ? (pac?.derived_ranking ? 'assessment branch re-planned; the carried ranking artifact was not consulted for the reference'
        : pac ? 'assessment branch re-planned with no derived artifact to resolve against (reference not resolved to a candidate)' : 'assessment branch entered fresh; no prior derived artifact')
    : /result_set|raw/.test(String(cap)) || resultSetNow ? 'a raw result set answered the reference'
    : cap ? `a domain capability (${cap}) answered; reference not resolved against the assessment`
    : 'no capability; generic clarification or fallback';
  return {id, journey_id: r.journey_id, turn_number: r.turn_number, worker: r.worker, surface: r.surface, prompt: r.prompt, status_post_iq4: status,
    objective: ex.cognitive_objective || ac?.objective || b.cognitive_objective || null, reference_forms: forms, genuine_reference_form: genuine,
    previous_turn: prev ? {capability_key: pex.capability_key || prev.response.capability_key || null, assessment_id: pex.evidence_plan_id || null, derived_artifact_type: kind(pac),
      derived_candidates: (pac?.derived_ranking?.items || []).map(x => ({rank: x.rank, label: x.ref?.label || null})), raw_result_set_id: prevResultSet,
      selected_object: pac?.target_ref ? {type: pac.target_ref.object_type, label: pac.target_ref.label} : null,
      candidate_count: (pac?.evidence_plan?.contributions || []).reduce((n, c) => n + (c.record_count || 0), 0)} : null,
    actual: {capability_key: cap, assessment_id: ex.evidence_plan_id || null, result_set_id: resultSetNow, judgment_mode: ac?.judgment?.mode || null},
    iq4_class: i4?.iq4_class || null, iq4_ownership: OWN[id] || null, primary_reference_failure: primary,
    failure_mechanism: mechanism,
    expected_referent: prev ? (pac?.derived_ranking ? 'the active derived ranking (priority N), not a raw row' : pac ? 'the active assessment\'s candidate set / comparison pair from the previous turn' : prevResultSet ? 'the previous raw result set (existing result-set continuity)' : 'none established by the previous turn: honest clarification') : 'none (first turn)',
    envelope: {must_notice: r.envelope?.expected?.must_notice || r.envelope?.must_notice || null, acceptable_conclusions: r.envelope?.expected?.acceptable_conclusions || r.envelope?.acceptable_conclusions || null}};
});
// Candidate = a failing/blocked turn that IQ-4 or the freeze assigned to reference continuity, PLUS any non-passing turn that
// carries a reference form AND follows a turn that established an assessment (so a derived referent could exist). Others are recorded
// as reference-form turns with another dominant boundary, not owned.
// Candidate = any non-passing turn that carries a GENUINE reference form (ordinal, other-one, demonstrative, return, comparison
// referent, bare "why") OR that IQ-4 handed over as reference continuity. A bare pronoun is not enough. IQ-4's hand-over is recorded
// separately: some of its 20 carry no reference form at all and are NOT reference-continuity failures (they stay with their real boundary).
const candidates = rows.filter(t => t.status_post_iq4 !== 'PASS' && (t.genuine_reference_form || t.primary_reference_failure));
for (const t of candidates) t.ownership = t.genuine_reference_form ? 'IQ5_GENUINE_REFERENCE' : 'IQ4_HANDED_OVER_NO_REFERENCE_FORM';
const tally = (rs, f) => rs.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});
const out = {version: 1, status: 'IQ5_CANDIDATE_SET_FROZEN_PRE_RUNTIME', starting_head: 'cfd7074f84b7b0e35dd5d6b4c40fb50de7662c91',
  raw_sha256: createHash('sha256').update(fs.readFileSync(`${prefix}-iq.json`)).digest('hex'),
  rule: 'see scripts/iq5-candidate-freeze.mjs; expected_referent is derived from the conversation structure (previous turn artifacts), it is not a graded expectation and no benchmark expectation was changed',
  summary: {turns: rows.length, reference_form_turns: rows.filter(t => t.reference_forms.length).length, candidates: candidates.length, by_ownership: tally(candidates, t => t.ownership),
    by_surface: tally(candidates, t => t.surface), by_status: tally(candidates, t => t.status_post_iq4), genuine_reference_failures: candidates.filter(t => t.genuine_reference_form).length, by_mechanism: tally(candidates, t => t.failure_mechanism),
    by_previous_artifact: tally(candidates, t => t.previous_turn?.derived_artifact_type || 'none'),
    iq4_stated_20: {from_candidates: rows.filter(t => t.iq4_class === 'REFERENCE_CONTINUITY_IQ5').length, outside: rows.filter(t => OWN[t.id] === 'REFERENCE_CONTINUITY_IQ5' && t.iq4_class !== 'REFERENCE_CONTINUITY_IQ5').length}},
  turns: rows, candidates: candidates.map(t => t.id)};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq5-candidates.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.summary, null, 1));
