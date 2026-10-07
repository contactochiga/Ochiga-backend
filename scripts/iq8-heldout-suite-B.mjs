// IQ-8 held-out answer-shape suite: NEW language, authored and frozen BEFORE any IQ-8 behavioural change. Runtime must never read it.
// Each item states the answer SHAPE the response must lead with. Facts reflect the loopback fixtures (see the probe in the IQ-8 doc).
import fs from 'node:fs';
const O = 'office_internal', P = 'public_corporate', F = 'facility', C = 'consumer';
const PUB = ['I own land in Lekki.', 'It is about 1,200 sqm.'];
const I = (s, u, shape, kind, p = {}, seeds = []) => ({s, u, shape, kind, p, seeds});
const items = [
  // COUNT
  I(F, 'Tell me how many open tickets there are right now.', 'COUNT', 'count', {n: 1}),
  I(F, 'How many incidents has security logged?', 'COUNT', 'count', {n: 0}),
  I(C, 'How many guests are registered on my list?', 'COUNT', 'count', {n: 2}),
  I(O, 'What is the total number of leads we have open?', 'COUNT', 'count', {n: 2}),
  I(O, 'How many opportunities are overdue for follow-up?', 'COUNT', 'count', {n: 2}),
  I(C, 'How many devices am I looking at with out-of-date readings?', 'COUNT', 'count', {n: 4}),
  // LIST
  I(O, 'List the leads I should be paying attention to.', 'LIST', 'list', {names: ['Lead Alpha', 'Lead Beta'], min: 2}),
  I(O, 'Which opportunities have gone quiet?', 'LIST', 'list', {names: ['VI Development', 'Abuja JV'], min: 2}),
  I(F, 'Show me the maintenance requests that are unresolved.', 'LIST', 'list', {names: ['water issue'], min: 1}),
  I(C, 'Name my guests, please.', 'LIST', 'list', {names: ['Expected Visitor', 'Historical Visitor'], min: 1}),
  I(O, 'Which report needs my sign-off?', 'LIST', 'list', {names: ['Portfolio Report'], min: 1}),
  I(O, 'Pull up the tasks that are past due.', 'LIST', 'list', {names: ['overdue follow-up'], min: 1}),
  I(C, 'Which of my gadgets have readings I should not trust?', 'LIST', 'list', {names: ['Living Light', 'AC', 'Kitchen Light', 'Bedroom Light'], min: 3}),
  // STATUS
  I(F, 'Where are we on the maintenance side?', 'STATUS', 'status', {kw: ['water'], also: ['open', 'unresolved']}),
  I(C, 'What is the status of my gadgets?', 'STATUS', 'status', {kw: ['stale', 'not current', 'readings']}),
  I(F, 'What is the current position on security incidents?', 'STATUS', 'status', {kw: ['no security incident', 'none', 'no open', 'no ']}),
  I(O, 'What stage is the VI Development opportunity at?', 'STATUS', 'status', {kw: ['review', '21 days', 'VI Development']}),
  // YES / NO / UNKNOWN
  I(F, 'Is the light problem closed?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['light']}),
  I(F, 'Is the water leak still outstanding?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['water']}),
  I(F, 'Has the water issue been fixed?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['water']}),
  I(F, 'Can you tell me if the camera is recording?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['camera']}),
  I(C, 'Are my sensors reporting recently?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['stale', 'not current', 'readings']}),
  I(F, 'Is there an active security incident?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['incident']}),
  I(O, 'Are there any reports for me to approve?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['report']}),
  I(O, 'Is anything overdue on my task list?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['overdue', 'task']}),
  I(F, 'Does a clean incident log prove the estate is safe?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['incident', 'safe', 'all-clear', 'clear']}),
  I(C, 'Does an inactive access record show the guest has departed?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['access', 'record', 'left', 'arriv']}),
  I(C, 'Has my guest turned up?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['arriv', 'access', 'record']}),
  // WHY
  I(F, 'Why does that one come first?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'priority', 'recorded']}, ['Which maintenance issue deserves attention first?']),
  I(O, 'How did you arrive at that order?', 'EXPLANATION', 'why', {kw: ['not ranked', "haven't ranked", 'have not ranked', 'no ordering', 'nothing was ranked', 'not put', 'did not rank', 'not ordered']}, ['Which opportunity should I spend time on?']),
  I(C, 'Why are you unable to say if my devices are working?', 'EXPLANATION', 'why', {kw: ['stale', 'readings', 'not current']}),
  I(F, 'Why should I care about the water leak?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'unresolved']}),
  // COMPARISON
  I(F, 'Which of the two matters more, the leak or the light?', 'COMPARISON', 'compare', {names: ['water', 'light']}),
  I(O, 'Set Lead Alpha against Lead Beta.', 'COMPARISON', 'compare', {names: ['Alpha', 'Beta']}),
  I(O, 'Would you back the Abuja JV or the VI Development?', 'COMPARISON', 'compare', {names: ['Abuja JV', 'VI Development']}),
  // RISK
  I(F, 'Are there any safety concerns right now?', 'SAFETY_RISK', 'risk', {kw: ['water'], hedge: true}),
  I(F, 'I can smell burning from the generator room.', 'SAFETY_RISK', 'risk', {kw: ['burning'], unverified: true}),
  I(C, 'There is water coming out of the socket in the hallway.', 'SAFETY_RISK', 'risk', {kw: ['water', 'socket'], unverified: true}),
  I(C, 'Is anything dangerous going on at home?', 'SAFETY_RISK', 'risk', {kw: ['camera', 'stale', 'readings', 'cannot', "can't"], hedge: true}),
  // LIMITATION
  I(C, 'How much power did I use yesterday?', 'LIMITATION', 'limit', {kw: ['power', 'electricity', 'usage', 'consumption', 'how much']}),
  I(F, 'What is the humidity in the plant room right now?', 'LIMITATION', 'limit', {kw: ['humidity']}),
  I(O, 'How does this week compare with last quarter?', 'LIMITATION', 'limit', {kw: ['baseline', 'earlier', 'snapshot', 'history', 'previous', 'last quarter', 'compare']}),
  I(F, 'Is there any information on Block D?', 'LIMITATION', 'limit', {kw: ['block', 'scope', 'building', 'tower']}),
  I(F, 'Which tenant complained about the noise?', 'REFUSAL', 'limit', {kw: ['tenant', 'who', 'attribut', 'identify', 'responsible', 'name']}),
  // ACTION RESULT
  I(C, 'Did anything get switched on or off because of what I said?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'switch', 'anything', 'device']}, ['Which of my gadgets have readings I should not trust?']),
  I(F, 'Have you modified any record in this session?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'alter', 'record', 'anything']}),
  // CONSTRAINT
  I(O, "Don't tell anyone about my financing figures.", 'CONFIRMATION_STATE', 'ack', {kw: ['figures', 'financing', 'not', 'noted']}),
  I(F, 'Never say the cameras are fine unless you can actually see them.', 'CONFIRMATION_STATE', 'ack', {kw: ['camera', 'never', 'not']}),
  I(C, 'No switching anything while we chat.', 'CONFIRMATION_STATE', 'ack', {kw: ['switching', 'anything', 'not', 'no']}),
  // PUBLIC
  I(P, 'Can you assure me of a quick sale?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['promise', 'guarantee', 'sale']}, PUB),
  I(P, 'What else is missing on your side?', 'LIST', 'list', {names: ['structure', 'owner', 'title', 'expect'], min: 1}, PUB),
  I(P, 'Do I have enough detail for an opening chat?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes_or_partial', kw: ['enough', 'first', 'chat', 'still', 'need']}, PUB),
  I(P, 'Is a lease or a joint venture the smarter route?', 'COMPARISON', 'limit', {kw: ['lease', 'venture', 'jv', 'depends', 'yet']}, PUB),
  I(P, 'Remind me what I have shared.', 'LIST', 'list', {names: ['Lekki', '1,200'], min: 2}, PUB),
  // CLARIFICATION / DISCOVERY
  I(C, 'Switch it on.', 'CLARIFICATION', 'clarify', {}),
  I(C, 'What are you able to do for me?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  I(P, 'What are you able to help with?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  // PROVIDER UNAVAILABLE / PARTIAL / UNSUPPORTED SCOPE
  I(O, 'Put my opportunities in priority order.', 'LIMITATION', 'limit', {kw: ['order', 'rank', 'comparative']}),
  I(O, 'Who should I phone first?', 'LIMITATION', 'limit', {kw: ['rank', 'comparative', 'order', 'first']}),
  I(F, 'Report on the health of every system across the estate.', 'LIMITATION', 'limit', {kw: ['maintenance', 'security', 'only', 'cover', 'every', 'system']}),
].map((x, i) => ({id: `IQ8B-${String(i + 1).padStart(3, '0')}`, ...x}));
fs.writeFileSync('artifacts/intelligence-quality-v1-iq8-heldout-suite-B.json', JSON.stringify({version: 1, status: 'IQ8_HELDOUT_B_FROZEN_POST_IMPLEMENTATION_PRE_RUN', note: 'Authored after the IQ-8 implementation was complete and before it was ever run; run once. Runtime must never read this file (static guard).', items}, null, 1) + '\n');
const by = items.reduce((m, i) => (m[i.shape] = (m[i.shape] || 0) + 1, m), {}); console.log(items.length, by);
