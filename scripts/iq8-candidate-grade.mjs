// IQ-8: does the LEAD of each frozen candidate turn now deliver the expected answer target? Subtype-level predicates over the first ~220 characters.
// SELF-GRADED by the author of this slice (independent review recommended). It never changes a frozen status or expectation and claims no promotion.
import fs from 'node:fs';
const R = new URL('..', import.meta.url).pathname;
const prefix = process.argv[2] || '/tmp/iq8-final', out = process.argv[3] || '/tmp/iq8-candidate-grade.json';
const cand = JSON.parse(fs.readFileSync(R + 'artifacts/intelligence-quality-v1-iq8-candidates.json', 'utf8')).candidates;
const run = JSON.parse(fs.readFileSync(`${prefix}-iq.json`, 'utf8'));
const BOILER = /^(?:Based on the evidence available, (?:I can tell you what is recorded|this is what is known|\d+ items? needs?|nothing active|I found no active)|Based on what you've told me, not independent verification: Here's what I have so far|I can (?:tell you about|help with)|I understand (?:the|this as)|Thanks for sharing|Understood\. Is there anything else|Got it -- )/;
const NEG = /(?:can(?:'|no)t|cannot|do not have|don't have|not available|isn't|is not|no [a-z ]{0,24}(?:evidence|source|baseline|record|snapshot|data|scope|capability|reading)|unable|won't|will not|haven't|have not|could not|not authori[sz]ed|no earlier|nothing)/i;
const POLAR = /^(?:yes|no\b|not yet|it could be|i can(?:'|no)t (?:tell|confirm|say|judge|verify|do)|i don't have|nothing\b|there (?:is|are) no\b|that is not)/i;
const LISTY = lead => /^[A-Za-z][^.]{2,60}:\s/.test(lead) || /^(?:Still open|Stale|What I (?:cannot confirm|still need)|So far|Maintenance requests|Visitor access)/.test(lead) || /^There (?:is|are) \d/.test(lead);
const SUB = {
  COUNT_FOR_LIST: l => LISTY(l) && !/^\d+ [a-z ]+ out of \d+/.test(l), UNRESOLVED_ITEMS: l => LISTY(l) || NEG.test(l), HISTORICAL_LIST: l => LISTY(l), WHICH_OPEN: l => LISTY(l), WHICH_STALE: l => LISTY(l) || /stale/i.test(l),
  DETAILS_LIST: l => /^So far you have told me/.test(l), WHAT_IS_MISSING: l => LISTY(l), WHAT_IS_UNKNOWN: l => LISTY(l), WHAT_NEEDS_CONFIRMATION: l => LISTY(l), EVIDENCE_HELD: l => /^I have read/.test(l), PASSED_ON_VS_UNVERIFIED: l => LISTY(l), FACTS_VS_UNCERTAINTY: l => LISTY(l) || /^No security|^\w.*unverified/i.test(l),
  PROVIDER_OFF_LIMITATION: l => NEG.test(l) && /comparative|judge|judgment/i.test(l), NAMED_PAIR_LIMITATION: l => NEG.test(l) && /compar/i.test(l), IMPLICIT_PAIR_LIMITATION: l => NEG.test(l) && /compar/i.test(l),
  MISSING_BASELINE: l => NEG.test(l) && /snapshot|earlier|baseline/i.test(l), MISSING_OWNERSHIP_DATA: l => NEG.test(l) && /own/i.test(l),
  INFERENCE_PROBE: l => /^No\b/.test(l), AUTHORITY_YES_NO: l => /^No\b/.test(l), CAUSAL_PROBE: l => POLAR.test(l), CAUSE_POSSIBLE: l => POLAR.test(l), STILL_FIRST: l => /^(?:Yes|No)\b|^I can't say whether/.test(l),
  STATE_QUESTION: l => POLAR.test(l), CHANGE_QUESTION: l => /^(?:Yes|No)\b|^I can't say whether/.test(l), CONFIRMATION_STATE_QUESTION: l => POLAR.test(l) || /not confirmed|unverified/i.test(l), ACTION_BENEFIT: l => POLAR.test(l) || /can't tell/.test(l),
  COMMITMENT_LIMIT: l => /^No\b/.test(l) || /can't (?:promise|commit)/.test(l), ENOUGH_INFORMATION: l => /^(?:Yes|Not yet)/.test(l), ADVICE_LIMIT: l => /^No\b/.test(l), PROMISE: l => /^No\b/.test(l), GUARANTEE: l => /^No\b/.test(l),
  NOTHING_TO_EXPLAIN: l => /haven't ranked|no ordering|nothing to explain|no (?:earlier )?ordering/i.test(l), NOTHING_CHANGED: l => /haven't ranked|nothing was ranked|no ordering/i.test(l), WHY_FIRST: l => !BOILER.test(l) && /because|matters|recorded|open|priority/i.test(l), WHY_NOT: l => !BOILER.test(l) && /because|link|nothing|no evidence|can't/i.test(l),
  CONSTRAINT_ACKNOWLEDGEMENT: l => /^Understood/.test(l), COMPARE_NOT_RELIST: l => /comes ahead|equal on|ahead of|more urgent|can't compare|can't judge/i.test(l), WHY_RATHER_THAN: l => !BOILER.test(l) && /because|ahead|rather|than/i.test(l), LEASE_VS_JV: l => /can't say which/.test(l), APPROACH_DIFFERENCE: l => /can't say yet whether|differ/.test(l), KNOWN_VS_TO_CHECK: l => /^What I know/.test(l),
  MOST_IMPORTANT: l => /^The most important/.test(l), CHECK_FIRST: l => !BOILER.test(l) && /first|open item|Still open|could matter/i.test(l), RISK_TARGETING: l => /unverified|cannot rule out|could matter for safety|no security incident|No security incident/i.test(l), CONDITIONAL_CHANGE: l => /can't say what would change|would change/i.test(l),
  ATTRIBUTION_DECLINE: l => /can't say who/.test(l), WHAT_CAN_YOU_TELL: l => !BOILER.test(l) && l.length > 20, BUILDING_STATUS: l => !BOILER.test(l), ESTATE_WIDE: l => !BOILER.test(l), SAFE_CONCLUSION: l => !BOILER.test(l) && /cannot|can't|what I|conclude|known/i.test(l),
  ACTION_TRUTH: l => /^No — nothing was changed/.test(l), MISSING_SCOPE: l => /^No\b/.test(l), CANNOT_VERIFY: l => /^No\b/.test(l), MISSING_TEMPERATURE: l => /^No\b|can't/i.test(l), MISSING_CONSUMPTION: l => NEG.test(l) && !BOILER.test(l), WRONG_NOUN_CAPABILITY: l => /^Wallet balance|^Wallet transactions/.test(l), STATE_FIRST: l => !BOILER.test(l), UNCERTAINTY_SUMMARY: l => !BOILER.test(l), BUILDING_SCOPE: l => /^No\b/.test(l),
};
const rows = cand.map(c => {
  const rec = run.records.find(r => r.journey_id.endsWith(c.journey) && r.turn_number === c.turn), lead = rec.response.answer.replace(/\s+/g, ' ').trim().slice(0, 220);
  const f = SUB[c.failure_subtype]; const met = f ? Boolean(f(lead)) && !/^I can help with|^I can tell you about|^I understand the request/.test(lead) : null;
  return {id: c.id, worker: c.worker, intent: c.requested_answer_shape, subtype: c.failure_subtype, lead: lead.slice(0, 160), target_met: met, graded: Boolean(f)};
});
const g = rows.filter(r => r.graded);
const tally = k => Object.fromEntries([...new Set(rows.map(r => r[k]))].map(v => [v, {n: rows.filter(r => r[k] === v).length, met: rows.filter(r => r[k] === v && r.target_met).length}]));
const summary = {candidates: rows.length, graded: g.length, target_met: g.filter(r => r.target_met).length, rate: +(g.filter(r => r.target_met).length / g.length).toFixed(3), by_worker: tally('worker'), by_intent: tally('intent'), ungraded: rows.filter(r => !r.graded).map(r => r.id), not_met: g.filter(r => !r.target_met).map(r => ({id: r.id, subtype: r.subtype, lead: r.lead}))};
fs.writeFileSync(out, JSON.stringify({summary, rows}, null, 1)); console.log(JSON.stringify({candidates: summary.candidates, graded: summary.graded, target_met: summary.target_met, rate: summary.rate, by_worker: summary.by_worker}));
