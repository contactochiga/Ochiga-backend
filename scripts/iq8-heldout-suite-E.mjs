// IQ-8 held-out answer-shape suite: NEW language, authored and frozen BEFORE any IQ-8 behavioural change. Runtime must never read it.
// Each item states the answer SHAPE the response must lead with. Facts reflect the loopback fixtures (see the probe in the IQ-8 doc).
import fs from 'node:fs';
const O = 'office_internal', P = 'public_corporate', F = 'facility', C = 'consumer';
const PUB = ['I own land in Lekki.', 'It is about 1,200 sqm.'];
const I = (s, u, shape, kind, p = {}, seeds = []) => ({s, u, shape, kind, p, seeds});
const items = [
  // COUNT
  I(F, 'Quick one: how many unresolved jobs are on the board?', 'COUNT', 'count', {n: 1}),
  I(F, 'Has security flagged anything? Give me the figure.', 'COUNT', 'count', {n: 0}),
  I(C, 'How many names are on my visitor pass list?', 'COUNT', 'count', {n: 2}),
  I(O, 'Total number of live leads please.', 'COUNT', 'count', {n: 2}),
  I(O, 'How many deals have gone cold?', 'COUNT', 'count', {n: 2}),
  I(C, 'How many gadgets are giving me stale readings?', 'COUNT', 'count', {n: 4}),
  I(O, 'How many of the reports need sign-off from me?', 'COUNT', 'count', {n: 1}),
  // LIST
  I(O, 'Which leads are overdue for a response?', 'LIST', 'list', {names: ['Lead Alpha', 'Lead Beta'], min: 2}),
  I(O, 'Name the deals that have gone cold.', 'LIST', 'list', {names: ['VI Development', 'Abuja JV'], min: 2}),
  I(F, 'Which jobs are still open on the maintenance board?', 'LIST', 'list', {names: ['water issue'], min: 1}),
  I(C, 'Who is on my pass list?', 'LIST', 'list', {names: ['Expected Visitor', 'Historical Visitor'], min: 1}),
  I(O, 'Which reports are waiting for sign-off?', 'LIST', 'list', {names: ['Portfolio Report'], min: 1}),
  I(O, 'Which of my tasks are behind schedule?', 'LIST', 'list', {names: ['overdue follow-up'], min: 1}),
  I(C, 'Which gadgets have gone stale on me?', 'LIST', 'list', {names: ['Living Light', 'AC', 'Kitchen Light', 'Bedroom Light'], min: 3}),
  // STATUS
  I(F, 'What is going on with maintenance?', 'STATUS', 'status', {kw: ['water'], also: ['open', 'unresolved']}),
  I(C, 'Where do my gadgets stand?', 'STATUS', 'status', {kw: ['stale', 'not current', 'readings']}),
  I(O, 'Where is the VI Development opportunity right now?', 'STATUS', 'status', {kw: ['review', '21 days', 'VI Development']}),
  I(F, 'What is the situation with security incidents?', 'STATUS', 'status', {kw: ['no security', 'none', 'no open', 'no ']}),
  // YES / NO / UNKNOWN
  I(F, 'Has the water problem been dealt with?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['water']}),
  I(F, 'Is the light thing finished with?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['light']}),
  I(F, 'Is the water problem still happening?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['water']}),
  I(F, 'Can you tell if the camera is capturing right now?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['camera']}),
  I(C, 'Are my gadgets sending fresh readings?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['stale', 'not current', 'readings']}),
  I(F, 'Any security incidents logged?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['incident']}),
  I(O, 'Is there something awaiting my approval?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['report']}),
  I(O, 'Am I behind on any task?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['overdue', 'task']}),
  I(F, 'No incidents on file, so we are fine, right?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['all-clear', 'recorded', 'incident', 'safe', 'clear']}),
  I(C, 'Does a used-up pass confirm the guest has gone home?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['access', 'record', 'left', 'arriv']}),
  I(C, 'Is my guest on the premises now?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['arriv', 'access', 'record']}),
  // WHY
  I(F, 'Why would that be the top one?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'priority', 'recorded']}, ['What is the most pressing maintenance issue?']),
  I(O, 'What led you to that choice?', 'EXPLANATION', 'why', {kw: ['not ranked', "haven't ranked", 'have not ranked', 'no ordering', 'nothing was ranked', 'not put', 'did not rank', 'not ordered', "haven't", 'not picked', 'no earlier']}, ['Which opportunity is the best bet?']),
  I(C, 'Why is it you cannot say if my lights are on?', 'EXPLANATION', 'why', {kw: ['stale', 'readings', 'not current']}),
  I(F, 'Why bother about the water problem?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'unresolved']}),
  // COMPARISON
  I(F, 'Water problem or light thing: which is more serious?', 'COMPARISON', 'compare', {names: ['water', 'light']}),
  I(O, 'Lead Alpha versus Lead Beta: who comes out ahead?', 'COMPARISON', 'compare', {names: ['Alpha', 'Beta']}),
  I(O, 'Abuja JV or VI Development: which one is better?', 'COMPARISON', 'compare', {names: ['Abuja JV', 'VI Development']}),
  // RISK
  I(F, 'Are we exposed to any safety problem at the moment?', 'SAFETY_RISK', 'risk', {kw: ['water'], hedge: true}),
  I(F, 'Somebody says there are sparks from the electrical panel.', 'SAFETY_RISK', 'risk', {kw: ['spark', 'panel'], unverified: true}),
  I(C, 'My bedroom smells strongly of gas.', 'SAFETY_RISK', 'risk', {kw: ['gas'], unverified: true}),
  I(C, 'Is my home at risk tonight?', 'SAFETY_RISK', 'risk', {kw: ['camera', 'stale', 'readings', 'cannot', "can't", 'security'], hedge: true}),
  // LIMITATION
  I(C, 'What did my energy consumption look like this week?', 'LIMITATION', 'limit', {kw: ['energy', 'consumption', 'usage']}),
  I(F, 'What is the pressure in the water tank?', 'LIMITATION', 'limit', {kw: ['pressure', 'tank']}),
  I(O, 'What is new in the pipeline compared with last quarter?', 'LIMITATION', 'limit', {kw: ['baseline', 'earlier', 'snapshot', 'history', 'previous', 'last quarter', 'compare']}),
  I(F, 'Have you got anything on the North Block?', 'LIMITATION', 'limit', {kw: ['block', 'scope', 'building', 'tower']}),
  I(F, 'Who is the resident that logged the leak?', 'REFUSAL', 'limit', {kw: ['resident', 'who', 'attribut', 'identify', 'responsible', 'name']}),
  // ACTION RESULT
  I(C, 'Did you press anything on my behalf?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'switch', 'anything', 'device', 'press']}, ['Which gadgets have gone stale on me?']),
  I(F, 'Have you altered anything in the records?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'alter', 'record', 'anything']}),
  // CONSTRAINT
  I(O, 'Please keep my deal terms confidential.', 'CONFIRMATION_STATE', 'ack', {kw: ['terms', 'confidential', 'noted']}),
  I(F, "Don't ever report a camera as working unless it is observed.", 'CONFIRMATION_STATE', 'ack', {kw: ['camera', 'not', 'observed']}),
  I(C, 'Do not touch my thermostat while we are talking.', 'CONFIRMATION_STATE', 'ack', {kw: ['thermostat', 'not', 'noted']}),
  // PUBLIC
  I(P, 'Are you able to promise me a good outcome?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['promise', 'guarantee', 'outcome']}, PUB),
  I(P, 'What do I still need to tell you?', 'LIST', 'list', {names: ['structure', 'owner', 'title', 'expect'], min: 1}, PUB),
  I(P, 'Do you have enough from me to begin?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes_or_partial', kw: ['enough', 'first', 'still', 'need', 'look']}, PUB),
  I(P, 'Lease or joint venture: which is better for me?', 'COMPARISON', 'limit', {kw: ['lease', 'venture', 'jv', 'depends', 'yet']}, PUB),
  I(P, 'Summarise what I have told you.', 'LIST', 'list', {names: ['Lekki', '1,200'], min: 2}, PUB),
  // CLARIFICATION / DISCOVERY
  I(C, 'Shut that off.', 'CLARIFICATION', 'clarify', {}),
  I(C, 'What sorts of requests can you handle?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  I(P, 'What kind of help can I get here?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  // PROVIDER UNAVAILABLE / UNSUPPORTED SCOPE
  I(O, 'Rank my deals from strongest to weakest.', 'LIMITATION', 'limit', {kw: ['order', 'rank', 'comparative', 'sort']}),
  I(O, 'Who is the best lead to chase today?', 'LIMITATION', 'limit', {kw: ['rank', 'comparative', 'order', 'first', 'best']}),
  I(F, 'Report on all systems in every building across the estate.', 'LIMITATION', 'limit', {kw: ['maintenance', 'security', 'only', 'cover', 'every', 'building', 'across']}),
].map((x, i) => ({id: `IQ8E-${String(i + 1).padStart(3, '0')}`, ...x}));
fs.writeFileSync('artifacts/intelligence-quality-v1-iq8-heldout-suite-E.json', JSON.stringify({version: 1, status: 'IQ8_HELDOUT_E_FROZEN_PRE_RUN', note: 'Authored after the IQ-8 implementation was complete and before it was ever run; run once. Runtime must never read this file (static guard).', items}, null, 1) + '\n');
const by = items.reduce((m, i) => (m[i.shape] = (m[i.shape] || 0) + 1, m), {}); console.log(items.length, by);
