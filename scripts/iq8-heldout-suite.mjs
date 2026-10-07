// IQ-8 held-out answer-shape suite: NEW language, authored and frozen BEFORE any IQ-8 behavioural change. Runtime must never read it.
// Each item states the answer SHAPE the response must lead with. Facts reflect the loopback fixtures (see the probe in the IQ-8 doc).
import fs from 'node:fs';
const O = 'office_internal', P = 'public_corporate', F = 'facility', C = 'consumer';
const PUB = ['I own land in Lekki.', 'It is about 1,200 sqm.'];
const I = (s, u, shape, kind, p = {}, seeds = []) => ({s, u, shape, kind, p, seeds});
const items = [
  // ---- COUNT
  I(F, 'How many maintenance tickets does the estate have on record?', 'COUNT', 'count', {n: 2}),
  I(F, 'What is the number of security incidents logged?', 'COUNT', 'count', {n: 0}),
  I(C, 'How many visitors are on file for me?', 'COUNT', 'count', {n: 2}),
  I(C, 'How many of my devices have stale readings?', 'COUNT', 'count', {n: 4}),
  I(O, 'How many leads are open at the moment?', 'COUNT', 'count', {n: 2}),
  I(O, 'How many opportunities have gone stale?', 'COUNT', 'count', {n: 2}),
  I(C, 'How many wallet transactions have I made?', 'COUNT', 'count', {n: 2}),
  // ---- LIST
  I(O, 'Which leads need attention?', 'LIST', 'list', {names: ['Lead Alpha', 'Lead Beta'], min: 2}),
  I(O, 'Give me the names of the stale opportunities.', 'LIST', 'list', {names: ['VI Development', 'Abuja JV'], min: 2}),
  I(F, 'Which maintenance requests are open?', 'LIST', 'list', {names: ['water issue'], min: 1}),
  I(C, 'Which of my devices have stale readings?', 'LIST', 'list', {names: ['Living Light', 'AC', 'Kitchen Light', 'Bedroom Light'], min: 3}),
  I(C, 'Name the visitors on my access list.', 'LIST', 'list', {names: ['Expected Visitor', 'Historical Visitor'], min: 2}),
  I(O, 'Tell me which reports I have to approve.', 'LIST', 'list', {names: ['Portfolio Report'], min: 1}),
  I(O, 'What tasks are overdue?', 'LIST', 'list', {names: ['overdue follow-up'], min: 1}),
  I(O, 'Display the development projects.', 'LIST', 'list', {names: ['VI Development'], min: 1}),
  // ---- STATUS
  I(F, "What's the current state of maintenance?", 'STATUS', 'status', {kw: ['water'], also: ['open', 'unresolved']}),
  I(C, 'How are my devices doing?', 'STATUS', 'status', {kw: ['stale', 'not current', 'readings']}),
  I(F, 'Where do security incidents stand?', 'STATUS', 'status', {kw: ['no security incident', 'none', '0 ', 'no open']}),
  I(O, 'Where does the Abuja JV opportunity stand?', 'STATUS', 'status', {kw: ['qualification', '8 days', 'Abuja JV']}),
  I(C, 'What is the status of my visitor access?', 'STATUS', 'status', {kw: ['2 ', 'two', 'expired', 'inactive', 'visitor']}),
  // ---- ASSESSMENT (judgment first, not a status dump)
  I(F, 'Should I be worried about maintenance?', 'ASSESSMENT', 'judgment', {kw: ['water']}),
  // ---- YES / NO / UNKNOWN
  I(F, 'Is the water issue still open?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['water']}),
  I(F, 'Has the light issue been resolved?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['light']}),
  I(F, 'Is the water issue resolved?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['water']}),
  I(F, 'Is the east camera online?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['camera']}),
  I(C, 'Are my device readings up to date?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['stale', 'not current', 'readings']}),
  I(F, 'Are there any open security incidents?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['incident']}),
  I(C, 'Did somebody just arrive at the gate?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['arriv', 'access', 'record']}),
  I(O, 'Is any report waiting for my approval?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['report']}),
  I(O, 'Do I have any overdue tasks?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['overdue', 'task']}),
  I(F, 'Does having no security incidents mean the estate is safe?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['incident', 'safe', 'all-clear']}),
  I(C, 'Does an expired access code prove the guest has left?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['expired', 'access', 'left']}),
  I(F, 'Is it safe to ignore the water issue?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['water']}),
  // ---- WHY
  I(F, 'Why is that one first?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'priority', 'recorded']}, ['Which maintenance issue should come first?']),
  I(O, 'What makes you say that?', 'EXPLANATION', 'why', {kw: ['not ranked', "haven't ranked", 'have not ranked', 'no ordering', 'nothing was ranked', 'not put', 'did not rank', 'not ordered']}, ['Which opportunity needs me most?']),
  I(C, "Why can't you tell me whether the lights are on?", 'EXPLANATION', 'why', {kw: ['stale', 'readings', 'not current']}),
  I(F, 'Why is the water issue a concern?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'unresolved']}),
  // ---- COMPARISON
  I(F, 'Which is more urgent, the water issue or the light issue?', 'COMPARISON', 'compare', {names: ['water', 'light']}),
  I(O, 'Compare the Abuja JV with the VI Development.', 'COMPARISON', 'compare', {names: ['Abuja JV', 'VI Development']}),
  I(F, 'How does the light issue differ from the water issue?', 'COMPARISON', 'compare', {names: ['water', 'light']}),
  I(O, 'Is Lead Alpha a stronger prospect than Lead Beta?', 'COMPARISON', 'compare', {names: ['Alpha', 'Beta']}),
  // ---- RISK / SAFETY
  I(F, 'Is there anything hazardous I should know about?', 'SAFETY_RISK', 'risk', {kw: ['water'], hedge: true}),
  I(F, 'There is a strong smell of gas near the boiler.', 'SAFETY_RISK', 'risk', {kw: ['gas'], unverified: true}),
  I(C, 'My kitchen is full of smoke.', 'SAFETY_RISK', 'risk', {kw: ['smoke'], unverified: true}),
  I(C, 'Is the house secure tonight?', 'SAFETY_RISK', 'risk', {kw: ['camera', 'stale', 'readings', 'cannot confirm', "can't confirm"], hedge: true}),
  // ---- LIMITATION
  I(C, "What's my electricity consumption this week?", 'LIMITATION', 'limit', {kw: ['consumption', 'electricity', 'usage']}),
  I(F, 'What is the exact temperature in the boiler room?', 'LIMITATION', 'limit', {kw: ['temperature']}),
  I(O, 'What has changed in the pipeline since last month?', 'LIMITATION', 'limit', {kw: ['baseline', 'earlier', 'snapshot', 'history', 'previous', 'since']}),
  I(C, 'Can you show me the live camera feed?', 'LIMITATION', 'limit', {kw: ['camera', 'feed', 'live']}),
  I(F, 'Do you have any data for Tower C?', 'LIMITATION', 'limit', {kw: ['tower', 'scope', 'building']}),
  I(C, 'What was my energy use last month?', 'LIMITATION', 'limit', {kw: ['energy', 'usage', 'consumption', 'electricity']}),
  I(F, 'Which resident reported the leak?', 'REFUSAL', 'limit', {kw: ['resident', 'report', 'who', 'attribut', 'identify']}),
  // ---- ACTION RESULT
  I(C, 'Did you switch anything off just now?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'switch', 'anything', 'device']}, ['Which of my devices have stale readings?']),
  I(F, 'Have you altered any setting during this chat?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'alter', 'setting', 'anything']}),
  // ---- CONSTRAINT ACKNOWLEDGEMENT
  I(O, "Please don't share the figures I gave you with anyone.", 'CONFIRMATION_STATE', 'ack', {kw: ['figures', 'share', 'not']}),
  I(F, "From now on, don't claim a camera is working unless you can see it.", 'CONFIRMATION_STATE', 'ack', {kw: ['camera', 'not', "won't"]}),
  I(C, 'Do not turn anything on or off while we talk.', 'CONFIRMATION_STATE', 'ack', {kw: ['not', "won't", 'anything', 'turn']}),
  // ---- PUBLIC (Osa)
  I(P, "Can you promise I'll get a good price?", 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['promise', 'guarantee', 'price']}, PUB),
  I(P, 'What do you still need from me?', 'LIST', 'list', {names: ['structure', 'owner', 'title', 'expect'], min: 1}, PUB),
  I(P, 'Have I told you enough for a first conversation?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes_or_partial', kw: ['enough', 'first', 'conversation', 'still']}, PUB),
  I(P, 'Would a partnership or an outright sale suit me better?', 'COMPARISON', 'limit', {kw: ['sale', 'partnership', 'depends', 'yet']}, PUB),
  I(P, 'What have I told you so far?', 'LIST', 'list', {names: ['Lekki', '1,200'], min: 2}, PUB),
  // ---- CLARIFICATION / DISCOVERY
  I(C, 'Turn it off.', 'CLARIFICATION', 'clarify', {}),
  I(C, 'What can you do?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  I(P, 'What kinds of things can I ask you?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  // ---- PROVIDER UNAVAILABLE / PARTIAL / UNSUPPORTED SCOPE
  I(O, 'Rank my leads by importance.', 'LIMITATION', 'limit', {kw: ['rank', 'comparative', 'order']}),
  I(O, 'Which lead should I call first?', 'LIMITATION', 'limit', {kw: ['rank', 'comparative', 'order', 'first']}),
  I(F, 'Give me a full risk picture of every estate system.', 'LIMITATION', 'limit', {kw: ['maintenance', 'security', 'only', 'cover']}),
].map((x, i) => ({id: `IQ8H-${String(i + 1).padStart(3, '0')}`, ...x}));
fs.writeFileSync('artifacts/intelligence-quality-v1-iq8-heldout-suite.json', JSON.stringify({version: 1, status: 'IQ8_HELDOUT_FROZEN_PRE_IMPLEMENTATION', note: 'Frozen before any IQ-8 behavioural change. Runtime must never read this file (static guard).', items}, null, 1) + '\n');
const by = items.reduce((m, i) => (m[i.shape] = (m[i.shape] || 0) + 1, m), {}); console.log(items.length, by);
