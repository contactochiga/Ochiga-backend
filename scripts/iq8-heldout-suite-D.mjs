// IQ-8 held-out answer-shape suite: NEW language, authored and frozen BEFORE any IQ-8 behavioural change. Runtime must never read it.
// Each item states the answer SHAPE the response must lead with. Facts reflect the loopback fixtures (see the probe in the IQ-8 doc).
import fs from 'node:fs';
const O = 'office_internal', P = 'public_corporate', F = 'facility', C = 'consumer';
const PUB = ['I own land in Lekki.', 'It is about 1,200 sqm.'];
const I = (s, u, shape, kind, p = {}, seeds = []) => ({s, u, shape, kind, p, seeds});
const items = [
  // COUNT
  I(F, 'What is the count of outstanding repair tickets?', 'COUNT', 'count', {n: 1}),
  I(F, 'How many alerts has the security team recorded?', 'COUNT', 'count', {n: 0}),
  I(C, 'How many invitations do I have out to guests?', 'COUNT', 'count', {n: 2}),
  I(O, 'How many prospects are on my open list?', 'COUNT', 'count', {n: 2}),
  I(O, 'How many opportunities have not been touched lately?', 'COUNT', 'count', {n: 2}),
  I(C, 'How many of my smart devices are showing old data?', 'COUNT', 'count', {n: 4}),
  I(O, 'How many reports are awaiting my decision?', 'COUNT', 'count', {n: 1}),
  // LIST
  I(O, 'Which prospects are waiting on a follow-up from me?', 'LIST', 'list', {names: ['Lead Alpha', 'Lead Beta'], min: 2}),
  I(O, 'Tell me which opportunities have been left alone too long.', 'LIST', 'list', {names: ['VI Development', 'Abuja JV'], min: 2}),
  I(F, 'What repair tickets are still unresolved?', 'LIST', 'list', {names: ['water issue'], min: 1}),
  I(C, 'Who is on the guest list?', 'LIST', 'list', {names: ['Expected Visitor', 'Historical Visitor'], min: 1}),
  I(O, 'What documents need my approval?', 'LIST', 'list', {names: ['Portfolio Report'], min: 1}),
  I(O, 'Which tasks have slipped past their due date?', 'LIST', 'list', {names: ['overdue follow-up'], min: 1}),
  I(C, 'Which of my smart devices are reporting old information?', 'LIST', 'list', {names: ['Living Light', 'AC', 'Kitchen Light', 'Bedroom Light'], min: 3}),
  // STATUS
  I(F, 'Give me the lowdown on maintenance.', 'STATUS', 'status', {kw: ['water'], also: ['open', 'unresolved']}),
  I(C, 'What state are my smart devices in?', 'STATUS', 'status', {kw: ['stale', 'not current', 'readings']}),
  I(O, 'How is the Abuja JV opportunity progressing?', 'STATUS', 'status', {kw: ['qualification', '8 days', 'Abuja JV']}),
  I(F, 'What does the security log show?', 'STATUS', 'status', {kw: ['no security', 'none', 'no open', 'no ']}),
  // YES / NO / UNKNOWN
  I(F, 'Is the leak fixed yet?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['water']}),
  I(F, 'Is the lighting fault resolved?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['light']}),
  I(F, 'Is the water fault still unresolved?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['water']}),
  I(F, 'Is the camera currently streaming?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['camera']}),
  I(C, 'Is the information from my smart devices up to date?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['stale', 'not current', 'readings']}),
  I(F, 'Is there a security alert on record?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['incident', 'alert', 'security']}),
  I(O, 'Do I have a report to approve?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['report']}),
  I(O, 'Is any of my work late?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['overdue', 'task']}),
  I(F, 'Because nothing is logged, can we assume all is well?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['all-clear', 'recorded', 'incident', 'safe', 'clear']}),
  I(C, 'Does an expired invitation mean the guest left?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['access', 'record', 'left', 'arriv']}),
  I(C, 'Did my guest get here?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['arriv', 'access', 'record']}),
  // WHY
  I(F, 'Why is that ranked above the rest?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'priority', 'recorded']}, ['Which maintenance issue is the most serious?']),
  I(O, 'Explain how you chose that.', 'EXPLANATION', 'why', {kw: ['not ranked', "haven't ranked", 'have not ranked', 'no ordering', 'nothing was ranked', 'not put', 'did not rank', 'not ordered', "haven't", 'not picked', 'no earlier']}, ['Which opportunity looks strongest?']),
  I(C, 'Why can you not tell if my lights are on?', 'EXPLANATION', 'why', {kw: ['stale', 'readings', 'not current']}),
  I(F, 'Why is the water leak important?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'unresolved']}),
  // COMPARISON
  I(F, 'Which of these is worse: the water leak or the lighting fault?', 'COMPARISON', 'compare', {names: ['water', 'light']}),
  I(O, 'Put Lead Beta next to Lead Alpha.', 'COMPARISON', 'compare', {names: ['Alpha', 'Beta']}),
  I(O, 'Weigh the Abuja JV against the VI Development.', 'COMPARISON', 'compare', {names: ['Abuja JV', 'VI Development']}),
  // RISK
  I(F, 'Is anything unsafe on the estate at the moment?', 'SAFETY_RISK', 'risk', {kw: ['water'], hedge: true}),
  I(F, 'I can smell gas in the stairwell.', 'SAFETY_RISK', 'risk', {kw: ['gas'], unverified: true}),
  I(C, 'The bathroom floor is flooded and the wall socket is wet.', 'SAFETY_RISK', 'risk', {kw: ['flooded', 'socket', 'wet'], unverified: true}),
  I(C, 'Is there any danger at my house right now?', 'SAFETY_RISK', 'risk', {kw: ['camera', 'stale', 'readings', 'cannot', "can't", 'security'], hedge: true}),
  // LIMITATION
  I(C, 'How much electricity did I burn through last week?', 'LIMITATION', 'limit', {kw: ['electricity', 'usage', 'consumption']}),
  I(F, 'What is the noise level in the car park?', 'LIMITATION', 'limit', {kw: ['noise', 'level']}),
  I(O, 'What is different about the pipeline compared with last month?', 'LIMITATION', 'limit', {kw: ['baseline', 'earlier', 'snapshot', 'history', 'previous', 'last month', 'compare']}),
  I(F, 'Do you hold records for the East Wing?', 'LIMITATION', 'limit', {kw: ['wing', 'scope', 'building', 'tower']}),
  I(F, 'Which resident reported the burst pipe?', 'REFUSAL', 'limit', {kw: ['resident', 'who', 'attribut', 'identify', 'responsible', 'name']}),
  // ACTION RESULT
  I(C, 'Have you turned anything on or off during this talk?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'switch', 'anything', 'device']}, ['Which of my smart devices are reporting old information?']),
  I(F, 'Did you change a setting at any point?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'alter', 'setting', 'anything']}),
  // CONSTRAINT
  I(O, 'Do not pass my pricing on to anyone.', 'CONFIRMATION_STATE', 'ack', {kw: ['pricing', 'not', 'noted']}),
  I(F, 'Do not describe any lift as safe unless a record says it is.', 'CONFIRMATION_STATE', 'ack', {kw: ['lift', 'not', 'safe']}),
  I(C, 'Leave my heating alone for the rest of this conversation.', 'CONFIRMATION_STATE', 'ack', {kw: ['heating', 'alone', 'noted']}),
  // PUBLIC
  I(P, 'Can you give me a firm assurance that a deal will happen?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['promise', 'guarantee', 'deal']}, PUB),
  I(P, 'What details are you lacking?', 'LIST', 'list', {names: ['structure', 'owner', 'title', 'expect'], min: 1}, PUB),
  I(P, 'Have I said enough to get started?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes_or_partial', kw: ['enough', 'first', 'still', 'need', 'look']}, PUB),
  I(P, 'Between a lease and a sale, which is wiser?', 'COMPARISON', 'limit', {kw: ['sale', 'lease', 'depends', 'yet']}, PUB),
  I(P, 'What have you recorded about my land?', 'LIST', 'list', {names: ['Lekki', '1,200'], min: 2}, PUB),
  // CLARIFICATION / DISCOVERY
  I(C, 'Switch those on.', 'CLARIFICATION', 'clarify', {}),
  I(C, 'What things can I ask you to do?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  I(P, 'What are the topics you can cover?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  // PROVIDER UNAVAILABLE / PARTIAL / UNSUPPORTED SCOPE
  I(O, 'Sort my opportunities from best to worst.', 'LIMITATION', 'limit', {kw: ['order', 'rank', 'comparative', 'sort']}),
  I(O, 'Which lead deserves a call first?', 'LIMITATION', 'limit', {kw: ['rank', 'comparative', 'order', 'first']}),
  I(F, 'Give me the health of everything across all the buildings.', 'LIMITATION', 'limit', {kw: ['maintenance', 'security', 'only', 'cover', 'every', 'building', 'across']}),
].map((x, i) => ({id: `IQ8D-${String(i + 1).padStart(3, '0')}`, ...x}));
fs.writeFileSync('artifacts/intelligence-quality-v1-iq8-heldout-suite-D.json', JSON.stringify({version: 1, status: 'IQ8_HELDOUT_D_FROZEN_PRE_RUN_AFTER_C_FAILED_GATE', note: 'Authored after the IQ-8 implementation was complete and before it was ever run; run once. Runtime must never read this file (static guard).', items}, null, 1) + '\n');
const by = items.reduce((m, i) => (m[i.shape] = (m[i.shape] || 0) + 1, m), {}); console.log(items.length, by);
