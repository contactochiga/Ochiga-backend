// IQ-8 step 1: recompute the post-IQ7 Answer Targeting candidate set from the frozen 280 run (no runtime change, no regrading).
// Usage: node scripts/iq8-candidates.mjs <iq-run-prefix>  (default /tmp/iq7-v11). Writes artifacts/intelligence-quality-v1-iq8-candidates.json.
// A turn is a candidate when: the understanding is right (objective/subject/fact is what the question needs), the current state is sufficient to
// answer the shape (or to state the specific limitation), and the answer leads with the wrong thing (a state/count/boilerplate paragraph).
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const R = new URL('..', import.meta.url).pathname;
const prefix = process.argv[2] || '/tmp/iq7-v11';
const rd = p => JSON.parse(fs.readFileSync(R + p, 'utf8'));
const raw = JSON.parse(fs.readFileSync(`${prefix}-iq.json`, 'utf8'));
const iq2c = rd('artifacts/intelligence-quality-v1-iq2c-results.json');
const promo = new Set([...rd('artifacts/intelligence-quality-v1-iq4-results.json').summary.promoted, ...rd('artifacts/intelligence-quality-v1-iq5-results.json').summary.promoted, ...rd('artifacts/intelligence-quality-v1-iq6-results.json').summary.promoted]);
// id | response intent | failure subtype | expected answer target (what the response must lead with)
const SPEC = `
OMA-001:1|LIST|COUNT_FOR_LIST|lead with the items that need attention (the leads/opportunities/reports named), counts as support
OMA-002:2|YES_NO_WITH_REASON|PROVIDER_OFF_LIMITATION|say plainly it cannot judge whether it is merely the biggest deal without comparative judgment, then the recorded facts
OMA-002:3|COMPARISON|NAMED_PAIR_LIMITATION|state that the two items cannot be compared on judgment grounds without comparative judgment, naming the pair and the recorded facts of each
OMA-004:1|LIMITATION|MISSING_BASELINE|say directly that no earlier snapshot exists to compare against
OMA-004:2|YES_NO_WITH_REASON|MISSING_BASELINE|No: there is no yesterday baseline, then why
OMA-004:5|YES_NO_WITH_REASON|INFERENCE_PROBE|No (not on its own): a reported statement is not verification; say what would verify
OMA-004:7|EXPLANATION|NOTHING_TO_EXPLAIN|say first that no conditional recommendation was made, so there is nothing to explain
OMA-006:4|LIMITATION|MISSING_OWNERSHIP_DATA|say that ownership of the work is not recorded in available evidence
OMA-006:5|CONFIRMATION_STATE|CONSTRAINT_ACKNOWLEDGEMENT|acknowledge the constraint (will not invent a staff member) in one sentence
OMA-007:1|COMPARISON|NAMED_PAIR_LIMITATION|name the pair and state the comparison limit and recorded facts of each
OMA-007:2|COMPARISON|IMPLICIT_PAIR_LIMITATION|state that evidence of viability cannot be compared on judgment grounds without comparative judgment; give recorded viability facts
OMA-008:1|LIST|COUNT_FOR_LIST|list the qualified JV lead(s) by name and status
OMA-008:7|LIST|UNRESOLVED_ITEMS|lead with what remains unresolved/missing
OMA-009:2|YES_NO_WITH_REASON|AUTHORITY_YES_NO|No: nothing here authorises promising funding; then why
OMA-010:4|EXPLANATION|NOTHING_TO_EXPLAIN|say first that no ordering was made, so there is no reasoning to explain
OMA-010:6|EXPLANATION|NOTHING_CHANGED|say first that nothing was ranked, so no reasoning has changed
OSA-001:5|RANKING|MOST_IMPORTANT|lead with the single most important point (what matters most) from what is known/missing
OSA-001:6|YES_NO_WITH_REASON|COMMITMENT_LIMIT|say it cannot commit Ochiga; the team reviews opportunities; then what is known
OSA-002:5|YES_NO_WITH_REASON|ENOUGH_INFORMATION|answer yes/not yet to 'enough for an initial discussion' first, then what is still missing
OSA-002:7|CONFIRMATION_STATE|CONSTRAINT_ACKNOWLEDGEMENT|state that no call is booked
OSA-003:4|YES_NO_WITH_REASON|ADVICE_LIMIT|say it cannot advise signing from what is known; explain what is open
OSA-004:4|COMPARISON|APPROACH_DIFFERENCE|answer whether the approach differs, first
OSA-004:6|COMPARISON|KNOWN_VS_TO_CHECK|two clearly separated parts: what is known, what needs checking
OSA-005:5|LIST|DETAILS_LIST|list the details held, first
OSA-006:2|COMPARISON|LEASE_VS_JV|say which cannot be recommended yet and why, naming both options
OSA-006:6|YES_NO_WITH_REASON|GUARANTEE|No: no return or outcome can be guaranteed
OSA-008:2|YES_NO_WITH_REASON|COMMITMENT_LIMIT|say it cannot say whether Ochiga would enter a JV; the team decides
OSA-008:6|YES_NO_WITH_REASON|PROMISE|No: a decision today cannot be promised
OSA-010:7|LIST|PASSED_ON_VS_UNVERIFIED|two parts: what would be passed on, what is unverified
FAC-001:3|COMPARISON|WHY_RATHER_THAN|answer why the first item rather than the camera
FAC-001:5|SAFETY_RISK|RISK_TARGETING|lead with what is known to be dangerous (nothing recorded as a security incident; the open high-priority maintenance item) and what cannot be ruled out
FAC-001:7|LIST|FACTS_VS_UNCERTAINTY|two parts: observed facts, uncertainty
FAC-002:3|DIRECT_ANSWER|CONDITIONAL_CHANGE|say what would change if the camera became observable
FAC-002:4|YES_NO_WITH_REASON|STILL_FIRST|Yes/No first on whether the water problem still comes first
FAC-002:5|EXPLANATION|WHY_FIRST|give the reason the first item is first
FAC-002:7|CONFIRMATION_STATE|CONSTRAINT_ACKNOWLEDGEMENT|acknowledge that the camera will not be reported as recovered
FAC-003:2|LIST|WHICH_OPEN|list which are still open
FAC-003:4|COMPARISON|COMPARE_NOT_RELIST|compare the two directly with a comparative conclusion
FAC-004:2|LIST|WHICH_STALE|name which information is stale
FAC-004:3|YES_NO_WITH_REASON|INFERENCE_PROBE|No: stale means not recently observed, not broken
FAC-004:5|YES_NO_WITH_REASON|CAUSE_POSSIBLE|say it is possible but not established, first
FAC-004:7|CONFIRMATION_STATE|CONSTRAINT_ACKNOWLEDGEMENT|acknowledge that hardware inspection will not be claimed
FAC-005:1|LIST|COUNT_FOR_LIST|list who is expected today
FAC-005:2|YES_NO_WITH_REASON|STATE_QUESTION|answer whether that is a security incident, first
FAC-005:3|LIST|HISTORICAL_LIST|list who visited previously
FAC-005:4|YES_NO_WITH_REASON|STATE_QUESTION|answer whether the historical visitor needs action, first
FAC-005:5|COMPARISON|COMPARE_NOT_RELIST|compare the two directly
FAC-007:2|SAFETY_RISK|RISK_TARGETING|lead with the unverified but safety-relevant report (water near an electrical panel) and that it cannot be confirmed
FAC-007:3|YES_NO_WITH_REASON|CHANGE_QUESTION|yes/no/insufficient first on whether it changes the priority
FAC-007:4|YES_NO_WITH_REASON|CONFIRMATION_STATE_QUESTION|say first that the report is not confirmed by Oyi's evidence
FAC-007:7|SUMMARY|UNCERTAINTY_SUMMARY|lead with the uncertainty and the escalation point
FAC-008:2|REFUSAL|ATTRIBUTION_DECLINE|decline to attribute cause to a resident, then what can be said
FAC-008:5|LIMITATION|WHAT_CAN_YOU_TELL|lead with what is actually known, then limits
FAC-008:6|LIST|WHAT_IS_MISSING|lead with the missing evidence
FAC-009:1|YES_NO_WITH_REASON|CAUSAL_PROBE|No evidence that it would: state first
FAC-009:2|EXPLANATION|WHY_NOT|reason first
FAC-009:7|ACTION_RESULT|ACTION_TRUTH|No: nothing physical changed in this conversation
FAC-010:1|STATUS|BUILDING_STATUS|lead with the status of the building from available records
FAC-010:3|LIMITATION|MISSING_SCOPE|No: building scope is not available as an evidence scope
FAC-010:4|DIRECT_ANSWER|ESTATE_WIDE|say what can be said estate-wide and its limits
FAC-010:5|LIST|WHAT_IS_UNKNOWN|lead with what remains unknown
CON-001:4|LIMITATION|CANNOT_VERIFY|No: lock state cannot be verified from available evidence
CON-001:5|LIST|COUNT_FOR_LIST|list who is expected today
CON-002:2|RANKING|CHECK_FIRST|lead with the one thing to check first
CON-002:4|LIMITATION|MISSING_TEMPERATURE|No: current temperature is not available
CON-002:7|DIRECT_ANSWER|SAFE_CONCLUSION|lead with what can be concluded safely
CON-003:1|LIMITATION|MISSING_CONSUMPTION|say usage cannot be explained: consumption evidence is not available
CON-003:2|LIST|EVIDENCE_HELD|list the evidence held
CON-003:3|STATUS|WRONG_NOUN_CAPABILITY|show the spending/transactions
CON-003:4|YES_NO_WITH_REASON|INFERENCE_PROBE|No: that does not establish the AC caused it
CON-003:6|YES_NO_WITH_REASON|CHANGE_QUESTION|yes/no/insufficient first on whether it changes the explanation
CON-004:4|YES_NO_WITH_REASON|INFERENCE_PROBE|No: no alert is not an all-clear
CON-005:3|STATUS|WRONG_NOUN_CAPABILITY|lead with the wallet balance (or state it is unavailable)
CON-005:6|YES_NO_WITH_REASON|ACTION_BENEFIT|say whether turning it off would help, first (no evidence it would)
CON-006:1|LIST|COUNT_FOR_LIST|list who is coming today
CON-006:4|LIST|HISTORICAL_LIST|list who visited yesterday
CON-006:5|YES_NO_WITH_REASON|INFERENCE_PROBE|No: expired access does not show they left
CON-007:6|YES_NO_WITH_REASON|INFERENCE_PROBE|No: it cannot be marked verified from a statement
CON-008:3|DIRECT_ANSWER|RECALL_CORRECTION|state what was just corrected
CON-008:4|STATUS|WRONG_NOUN_CAPABILITY|lead with the wallet balance (or state it is unavailable)
CON-010:1|YES_NO_WITH_REASON|ACTION_BENEFIT|say whether it would save energy, first (cannot tell: no energy evidence)
CON-010:2|STATUS|STATE_FIRST|lead with the actual state
CON-010:5|LIST|WHAT_NEEDS_CONFIRMATION|lead with what needs confirmation
CON-010:7|ACTION_RESULT|ACTION_TRUTH|No: nothing was changed, it was only discussed
`.trim().split('\n').map(l => {const [id, intent, subtype, expected] = l.split('|'); return {id, intent, subtype, expected};});
const byId = Object.fromEntries(SPEC.map(s => [s.id, s]));
const ids = []; const recs = raw.records.map((r, i) => {
  const id = `${r.journey_id.replace('IQ-EVAL-', '')}:${r.turn_number}`, status = promo.has(id) ? 'PASS' : iq2c.records[i].status, sp = byId[id]; if (sp) ids.push(id);
  const ex = r.response.execution || {}, fr = ex.orchestrator_v2?.semantic_frame || {};
  return {id, status, r, sp, fr, ex};
});
const missing = SPEC.filter(s => !recs.some(x => x.id === s.id)); if (missing.length) throw new Error('unknown ids ' + missing.map(m => m.id));
const bad = SPEC.filter(s => recs.find(x => x.id === s.id).status === 'PASS'); if (bad.length) throw new Error('already PASS: ' + bad.map(m => m.id));
const lead = a => a.replace(/\s+/g, ' ').trim().slice(0, 160);
const candidates = recs.filter(x => x.sp).map(x => ({journey: x.r.journey_id.replace('IQ-EVAL-', ''), turn: x.r.turn_number, id: x.id, worker: {office_internal: 'Oma', public_corporate: 'Osa', facility: 'Facility', consumer: 'Consumer'}[x.r.surface] || x.r.surface,
  ask: x.r.prompt, cognitive_objective: x.fr.cognitiveObjective ?? null, subject: x.ex.assessment_context?.subject_domains ?? x.fr.domain ?? null, requested_answer_shape: x.sp.intent,
  available_state: {assessment_status: x.ex.assessment_status ?? null, capability: x.ex.capability_key ?? x.r.response.capability_key ?? null, judgment_mode: x.ex.assessment_context?.judgment?.mode ?? null},
  actual_lead: lead(x.r.response.answer), expected_answer_target: x.sp.expected, failure_subtype: x.sp.subtype, upstream_state_correct: true, status_before: x.status}));
const out = {version: 1, status: 'IQ8_CANDIDATES_FROZEN_PRE_IMPLEMENTATION', source_run_sha256: createHash('sha256').update(fs.readFileSync(`${prefix}-iq.json`)).digest('hex'), head: '6f793fd',
  method: 'every FAIL turn of the post-IQ7 frozen-280 run was read against its question; a candidate has right understanding, sufficient state (or a specific limitation to state) and a wrong lead. Statuses are the accepted post-IQ6/IQ7 statuses; none are regraded.',
  count: candidates.length, by_worker: candidates.reduce((m, c) => (m[c.worker] = (m[c.worker] || 0) + 1, m), {}), by_intent: candidates.reduce((m, c) => (m[c.requested_answer_shape] = (m[c.requested_answer_shape] || 0) + 1, m), {}),
  by_subtype: candidates.reduce((m, c) => (m[c.failure_subtype] = (m[c.failure_subtype] || 0) + 1, m), {}), not_candidates_note: 'INITIATIVE, LIVE_PROVIDER, DRAFTING, CONTEXT (state lost), UNDERSTANDING (statement acknowledgements) and evaluator-envelope turns are excluded and re-classified after IQ-8.', candidates};
fs.writeFileSync(R + 'artifacts/intelligence-quality-v1-iq8-candidates.json', JSON.stringify(out, null, 1) + '\n');
console.log(out.count, JSON.stringify(out.by_worker), JSON.stringify(out.by_intent));
