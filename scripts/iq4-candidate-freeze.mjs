// IQ-4 candidate freeze. Diagnostic only: reads the certified IQ-3B corpus run and the frozen envelopes, runs no runtime code,
// and fixes WHICH turns IQ-4 owns BEFORE any judgment code exists. It is not limited to IQ-3B's 32 secondary classifications:
// every turn is inspected for its current post-IQ-3B behaviour and its envelope.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const prefix = process.argv[2] || '/tmp/iq3b-v3';
const raw = read(`${prefix}-iq.json`);
const before = read('artifacts/intelligence-quality-v1-iq2c-results.json');
const pre = read('artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json');
const iq3b = read('artifacts/intelligence-quality-v1-iq3b-results.json');
const P = Object.fromEntries(pre.records.map(r => [r.id, r]));
const I3 = Object.fromEntries(iq3b.turns.map(t => [t.id, t]));
assert.equal(raw.records.length, 280);

const ORDINAL = /\b(?:second|third|first one|other one|others|that one|that project|that opportunity|those|the one)\b/i;
const NUMBERED = /\b(?:top\s+(?:two|three|\d)|which\s+(?:two|three|\d)|two\s+things|three\s+things)\b/i;
const RANKING_PROMPT = /\b(?:which first|most important|best option|what matters most|what can wait|priority|prioriti[sz]e|top|worth pursuing|first)\b/i;
const COMMUNICATION = /\b(?:draft|reply|send|brief|write|message)\b/i;
const tally = (rs, f) => rs.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});

const rows = raw.records.map((r, i) => {
  const id = `${r.journey_id.replace('IQ-EVAL-', '')}:${r.turn_number}`, p = P[id], b = before.records[i];
  const ex = r.envelope?.expected || r.envelope || {};
  const exec = r.response.execution || {}, ac = exec.assessment_context || {}, plan = exec.assessment_status === 'evidence_gathered' ? ac.evidence_plan : null;
  const objective = exec.cognitive_objective || ac.objective || b.cognitive_objective || null;
  const mandatory = (plan?.classes || []).filter(c => c.necessity === 'mandatory');
  const usable = plan ? mandatory.some(c => ['MANDATORY_COMPLETE_ENOUGH', 'MANDATORY_PARTIAL'].includes(c.status)) : false;
  const missing = mandatory.filter(c => c.status === 'MANDATORY_MISSING_CAPABILITY').map(c => c.class);
  const candidates = (plan?.contributions || []).filter(c => c.availability === 'available').map(c => ({source: c.source_key, class: c.evidence_class, necessity: c.necessity, count: c.record_count, completeness: c.completeness, freshness: c.freshness, unobserved: c.unobserved}));
  const text = r.prompt;
  return {id, journey_id: r.journey_id, turn_number: r.turn_number, worker: r.worker, surface: r.surface, prompt: text, retained_status: b.status, objective,
    subject: {domains: ac.subject_domains || null, label: ac.subject_label || null}, iq3b: I3[id] ? {evidence_outcome: I3[id].evidence_outcome, final_class: I3[id].final_class} : null,
    evidence_plan: plan ? {plan_id: plan.plan_id, status: plan.status, gathered_at: plan.gathered_at, classes: plan.classes.map(c => ({class: c.class, necessity: c.necessity, status: c.status})), candidate_sources: candidates, missing_mandatory_capability: missing, cannot_conclude_count: plan.cannot_conclude.length} : null,
    candidate_record_count: candidates.reduce((n, c) => n + c.count, 0),
    envelope: {must_notice: ex.must_notice, must_not_invent: ex.must_not_invent, must_consider_domains: ex.must_consider_domains, acceptable_conclusions: ex.acceptable_conclusions, unacceptable_conclusions: ex.unacceptable_conclusions, uncertainty_to_disclose: ex.uncertainty_to_disclose, clarification_required: ex.clarification_required},
    flags: {ordinal_reference: ORDINAL.test(text), exact_ranking_required: objective === 'prioritize' || NUMBERED.test(text) || (RANKING_PROMPT.test(text) && ['prioritize', 'compare'].includes(objective)), explanation_required: objective === 'explain' || /^\s*why\b/i.test(text), communication: COMMUNICATION.test(text), has_usable_mandatory_evidence: usable, evidence_limitation_is_acceptable: (ex.acceptable_conclusions || []).some(a => /evidence limitation/i.test(a))}};
});

// Ownership rules, applied in this order, each recorded per turn. Nothing here is graded; it only fixes scope.
const rule = t => {
  if (!t.evidence_plan) return ['EXCLUDED_NO_PLANNER_EVIDENCE', 'no governed evidence plan was produced (an existing certified path answered, or not an assessment)'];
  if (t.evidence_plan.missing_mandatory_capability.length && !t.flags.has_usable_mandatory_evidence) return ['MISSING_CAPABILITY', `mandatory evidence has no safe source: ${t.evidence_plan.missing_mandatory_capability.join(', ')}`];
  if (t.objective === 'reassess') return ['REASSESSMENT_LATER', 'objective is reassess (material-fact reassessment is a later slice)'];
  if (t.flags.ordinal_reference) return ['REFERENCE_CONTINUITY_IQ5', 'the turn refers to an earlier derived set by ordinal or pronoun (IQ-5)'];
  if (t.flags.communication) return ['COMMUNICATION_LATER', 'the turn asks for a draft or message'];
  if (!t.flags.has_usable_mandatory_evidence) return ['UPSTREAM_SUBJECT_GAP_OR_UNAVAILABLE', 'no mandatory class was usable'];
  if (['assess', 'prioritize', 'compare', 'explain'].includes(t.objective)) return ['IQ4_CANDIDATE', `${t.objective} with usable authorised evidence`];
  if (t.objective === 'advise' && t.iq3b?.final_class === 'NOW_SUFFICIENT_EVIDENCE_BUT_JUDGMENT_FAILS') return ['IQ4_CANDIDATE', 'advise whose recorded next boundary is judgment'];
  if (t.objective === 'advise') return ['INITIATIVE_LATER', 'advise/next-move is the initiative slice unless judgment was its recorded boundary'];
  return ['EXCLUDED_OTHER', `objective ${t.objective}`];
};
for (const t of rows) {[t.ownership, t.ownership_reason] = rule(t);}
const candidates = rows.filter(t => t.ownership === 'IQ4_CANDIDATE');
const out = {version: 1, status: 'IQ4_CANDIDATE_SET_FROZEN_PRE_RUNTIME', starting_head: '7c74c71006f0ba6e46e7798844d9d65454a2bce7', raw_sha256: createHash('sha256').update(fs.readFileSync(`${prefix}-iq.json`)).digest('hex'),
  rules: 'see scripts/iq4-candidate-freeze.mjs: ownership is decided in order: no plan, missing capability, reassess, ordinal reference, communication, no usable mandatory evidence, then objective',
  summary: {turns: rows.length, ownership: tally(rows, t => t.ownership), candidates: candidates.length, candidates_by_surface: tally(candidates, t => t.surface), candidates_by_objective: tally(candidates, t => t.objective), candidates_by_status: tally(candidates, t => t.retained_status),
    exact_ranking_required: candidates.filter(t => t.flags.exact_ranking_required).length, explanation_required: candidates.filter(t => t.flags.explanation_required).length,
    candidates_where_an_evidence_limitation_is_an_acceptable_conclusion: candidates.filter(t => t.flags.evidence_limitation_is_acceptable).length,
    candidates_that_were_in_iq3b_judgment_32: candidates.filter(t => t.iq3b?.final_class === 'NOW_SUFFICIENT_EVIDENCE_BUT_JUDGMENT_FAILS').length,
    iq3b_judgment_32_not_owned_by_iq4: rows.filter(t => t.iq3b?.final_class === 'NOW_SUFFICIENT_EVIDENCE_BUT_JUDGMENT_FAILS' && t.ownership !== 'IQ4_CANDIDATE').map(t => ({id: t.id, ownership: t.ownership}))},
  turns: rows};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq4-candidates.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.summary, null, 1));
