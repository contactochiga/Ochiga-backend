// IQ-8 held-out answer-shape suite: NEW language, authored and frozen BEFORE any IQ-8 behavioural change. Runtime must never read it.
// Each item states the answer SHAPE the response must lead with. Facts reflect the loopback fixtures (see the probe in the IQ-8 doc).
import fs from 'node:fs';
const O = 'office_internal', P = 'public_corporate', F = 'facility', C = 'consumer';
const PUB = ['I own land in Lekki.', 'It is about 1,200 sqm.'];
const I = (s, u, shape, kind, p = {}, seeds = []) => ({s, u, shape, kind, p, seeds});
const items = [
  // COUNT
  I(F, 'Roughly how many repair jobs are still pending?', 'COUNT', 'count', {n: 1}),
  I(F, 'Can you count the security events logged so far?', 'COUNT', 'count', {n: 0}),
  I(C, 'How many people can currently get in with a pass from me?', 'COUNT', 'count', {n: 2}),
  I(O, 'How many leads have I got going at the moment?', 'COUNT', 'count', {n: 2}),
  I(O, 'What number of opportunities have been left untouched?', 'COUNT', 'count', {n: 2}),
  I(C, 'How many of my sensors have not updated recently?', 'COUNT', 'count', {n: 4}),
  I(O, 'How many reports are in my queue for approval?', 'COUNT', 'count', {n: 1}),
  // LIST
  I(O, 'Which leads need me to follow up?', 'LIST', 'list', {names: ['Lead Alpha', 'Lead Beta'], min: 2}),
  I(O, 'Which deals have I neglected?', 'LIST', 'list', {names: ['VI Development', 'Abuja JV'], min: 2}),
  I(F, 'List every repair job that is still open.', 'LIST', 'list', {names: ['water issue'], min: 1}),
  I(C, 'Who have I given passes to?', 'LIST', 'list', {names: ['Expected Visitor', 'Historical Visitor'], min: 1}),
  I(O, 'Which reports are in my approval queue?', 'LIST', 'list', {names: ['Portfolio Report'], min: 1}),
  I(O, 'Which of my tasks are late?', 'LIST', 'list', {names: ['overdue follow-up'], min: 1}),
  I(C, 'Which sensors have stopped updating?', 'LIST', 'list', {names: ['Living Light', 'AC', 'Kitchen Light', 'Bedroom Light'], min: 3}),
  // STATUS
  I(F, 'How are repairs going?', 'STATUS', 'status', {kw: ['water'], also: ['open', 'unresolved']}),
  I(C, 'What is the condition of my sensors?', 'STATUS', 'status', {kw: ['stale', 'not current', 'readings']}),
  I(O, 'What is the latest on the Abuja JV?', 'STATUS', 'status', {kw: ['qualification', '8 days', 'Abuja JV']}),
  I(F, 'How does the security record look?', 'STATUS', 'status', {kw: ['no security', 'none', 'no open', 'no ']}),
  // YES / NO / UNKNOWN
  I(F, 'Has anyone resolved the water problem?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['water']}),
  I(F, 'Is the light issue sorted?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['light']}),
  I(F, 'Is the water problem ongoing?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['water']}),
  I(F, 'Is the camera working properly at present?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['camera']}),
  I(C, 'Are my sensors up to date?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['stale', 'not current', 'readings']}),
  I(F, 'Is there any security issue on record?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['incident', 'security']}),
  I(O, 'Is there a report for me to approve?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['report']}),
  I(O, 'Have I got any overdue tasks?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['overdue', 'task']}),
  I(F, 'Since nothing is logged, can I take it that nothing is wrong?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['all-clear', 'recorded', 'incident', 'safe', 'clear', 'nothing']}),
  I(C, 'Does a stale pass tell you the guest has left?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['access', 'record', 'left', 'arriv']}),
  I(C, 'Has my visitor got here yet?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['arriv', 'access', 'record']}),
  // WHY
  I(F, 'What makes that one come first?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'priority', 'recorded']}, ['Which maintenance issue is the most urgent?']),
  I(O, 'What is behind that recommendation?', 'EXPLANATION', 'why', {kw: ['not ranked', "haven't ranked", 'have not ranked', 'no ordering', 'nothing was ranked', 'not put', 'did not rank', 'not ordered', "haven't", 'not picked', 'no earlier', 'not recommended']}, ['Which opportunity is the most promising?']),
  I(C, 'Why can I not get a straight answer on whether my lights are on?', 'EXPLANATION', 'why', {kw: ['stale', 'readings', 'not current']}),
  I(F, 'Why is the water leak a worry?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'unresolved']}),
  // COMPARISON
  I(F, 'Which is the more urgent job, the water leak or the light fix?', 'COMPARISON', 'compare', {names: ['water', 'light']}),
  I(O, 'Is Lead Alpha hotter than Lead Beta?', 'COMPARISON', 'compare', {names: ['Alpha', 'Beta']}),
  I(O, 'Which looks better: VI Development or Abuja JV?', 'COMPARISON', 'compare', {names: ['Abuja JV', 'VI Development']}),
  // RISK
  I(F, 'Is there anything on the estate that could hurt someone right now?', 'SAFETY_RISK', 'risk', {kw: ['water'], hedge: true}),
  I(F, 'A cleaner told me the generator room is full of fumes.', 'SAFETY_RISK', 'risk', {kw: ['fume', 'generator'], unverified: true}),
  I(C, 'There are sparks coming from the kitchen socket.', 'SAFETY_RISK', 'risk', {kw: ['spark', 'socket'], unverified: true}),
  I(C, 'Is my home safe tonight?', 'SAFETY_RISK', 'risk', {kw: ['camera', 'stale', 'readings', 'cannot', "can't", 'security'], hedge: true}),
  // LIMITATION
  I(C, 'What is my gas usage this month?', 'LIMITATION', 'limit', {kw: ['gas', 'usage', 'consumption']}),
  I(F, 'What is the temperature inside the server room?', 'LIMITATION', 'limit', {kw: ['temperature']}),
  I(O, 'How have the leads changed compared with last year?', 'LIMITATION', 'limit', {kw: ['baseline', 'earlier', 'snapshot', 'history', 'previous', 'last year', 'compare', 'changed']}),
  I(F, 'Is there anything you can tell me about the South Tower?', 'LIMITATION', 'limit', {kw: ['tower', 'scope', 'building']}),
  I(F, 'Which tenant raised the complaint about the lift?', 'REFUSAL', 'limit', {kw: ['tenant', 'who', 'attribut', 'identify', 'responsible', 'name']}),
  // ACTION RESULT
  I(C, 'Have you done anything to my devices?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'switch', 'anything', 'device']}, ['Which sensors have stopped updating?']),
  I(F, 'Did you update any record during this chat?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'alter', 'update', 'record', 'anything']}),
  // CONSTRAINT
  I(O, 'Please do not share my numbers with the team.', 'CONFIRMATION_STATE', 'ack', {kw: ['numbers', 'not', 'noted']}),
  I(F, 'Never say the lift is safe without a record to support it.', 'CONFIRMATION_STATE', 'ack', {kw: ['lift', 'never', 'noted']}),
  I(C, 'Do not adjust my lights during this chat.', 'CONFIRMATION_STATE', 'ack', {kw: ['lights', 'not', 'noted']}),
  // PUBLIC
  I(P, 'Can you assure me that the project will go ahead?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['promise', 'guarantee', 'project']}, PUB),
  I(P, 'What more do you want to know?', 'LIST', 'list', {names: ['structure', 'owner', 'title', 'expect'], min: 1}, PUB),
  I(P, 'Is this enough for you to get going?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes_or_partial', kw: ['enough', 'first', 'still', 'need', 'look']}, PUB),
  I(P, 'A joint venture or a lease: which is the wiser choice?', 'COMPARISON', 'limit', {kw: ['lease', 'venture', 'jv', 'depends', 'yet']}, PUB),
  I(P, 'Recap what I have given you.', 'LIST', 'list', {names: ['Lekki', '1,200'], min: 2}, PUB),
  // CLARIFICATION / DISCOVERY
  I(C, 'Power that down.', 'CLARIFICATION', 'clarify', {}),
  I(C, 'What are you good for?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  I(P, 'What do you cover?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  // PROVIDER UNAVAILABLE / UNSUPPORTED SCOPE
  I(O, 'Line up my leads with the best first.', 'LIMITATION', 'limit', {kw: ['order', 'rank', 'comparative', 'sort']}),
  I(O, 'Who is the most promising lead?', 'LIMITATION', 'limit', {kw: ['rank', 'comparative', 'order', 'first', 'promising']}),
  I(F, 'Give me the status of every system in every building across the estate.', 'LIMITATION', 'limit', {kw: ['maintenance', 'security', 'only', 'cover', 'every', 'building', 'across']}),
].map((x, i) => ({id: `IQ8F-${String(i + 1).padStart(3, '0')}`, ...x}));
fs.writeFileSync('artifacts/intelligence-quality-v1-iq8-heldout-suite-F.json', JSON.stringify({version: 1, status: 'IQ8_HELDOUT_F_FROZEN_PRE_RUN', note: 'Authored after the IQ-8 implementation was complete and before it was ever run; run once. Runtime must never read this file (static guard).', items}, null, 1) + '\n');
const by = items.reduce((m, i) => (m[i.shape] = (m[i.shape] || 0) + 1, m), {}); console.log(items.length, by);
