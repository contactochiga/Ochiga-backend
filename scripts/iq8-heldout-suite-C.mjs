// IQ-8 held-out answer-shape suite: NEW language, authored and frozen BEFORE any IQ-8 behavioural change. Runtime must never read it.
// Each item states the answer SHAPE the response must lead with. Facts reflect the loopback fixtures (see the probe in the IQ-8 doc).
import fs from 'node:fs';
const O = 'office_internal', P = 'public_corporate', F = 'facility', C = 'consumer';
const PUB = ['I own land in Lekki.', 'It is about 1,200 sqm.'];
const I = (s, u, shape, kind, p = {}, seeds = []) => ({s, u, shape, kind, p, seeds});
const items = [
  // COUNT
  I(F, 'Give me the number of unresolved maintenance items.', 'COUNT', 'count', {n: 1}),
  I(F, 'How many security events are in the log?', 'COUNT', 'count', {n: 0}),
  I(C, 'How many people have access passes on my account?', 'COUNT', 'count', {n: 2}),
  I(O, 'Count the open leads for me.', 'COUNT', 'count', {n: 2}),
  I(O, 'How many opportunities are being neglected?', 'COUNT', 'count', {n: 2}),
  I(C, 'How many appliances have outdated readings?', 'COUNT', 'count', {n: 4}),
  I(O, 'How many pending approvals do I have?', 'COUNT', 'count', {n: 1}),
  // LIST
  I(O, 'Who are the leads that need chasing?', 'LIST', 'list', {names: ['Lead Alpha', 'Lead Beta'], min: 2}),
  I(O, 'Show me the neglected opportunities.', 'LIST', 'list', {names: ['VI Development', 'Abuja JV'], min: 2}),
  I(F, 'Which repair requests have not been closed?', 'LIST', 'list', {names: ['water issue'], min: 1}),
  I(C, 'Give me the names on my visitor list.', 'LIST', 'list', {names: ['Expected Visitor', 'Historical Visitor'], min: 1}),
  I(O, 'What reports are sitting in my approval queue?', 'LIST', 'list', {names: ['Portfolio Report'], min: 1}),
  I(O, 'What is overdue on my to-do list?', 'LIST', 'list', {names: ['overdue follow-up'], min: 1}),
  I(C, 'List the appliances whose data is out of date.', 'LIST', 'list', {names: ['Living Light', 'AC', 'Kitchen Light', 'Bedroom Light'], min: 3}),
  // STATUS
  I(F, 'How are things going with maintenance?', 'STATUS', 'status', {kw: ['water'], also: ['open', 'unresolved']}),
  I(C, 'What condition are my appliances in?', 'STATUS', 'status', {kw: ['stale', 'not current', 'readings']}),
  I(O, 'What is the state of the Abuja JV opportunity?', 'STATUS', 'status', {kw: ['qualification', '8 days', 'Abuja JV']}),
  I(F, 'What is the status of the security log?', 'STATUS', 'status', {kw: ['no security', 'none', 'no open', 'no ']}),
  // YES / NO / UNKNOWN
  I(F, 'Is the water problem sorted?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['water']}),
  I(F, 'Is the light matter still live?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['light']}),
  I(F, 'Is the water problem still live?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['water']}),
  I(F, 'Is the camera feed live at the moment?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['camera']}),
  I(C, 'Is the data from my devices fresh?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['stale', 'not current', 'readings']}),
  I(F, 'Has security recorded any incident?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['incident']}),
  I(O, 'Is there a report for me to sign off?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['report']}),
  I(O, 'Are any of my tasks late?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes', kw: ['overdue', 'task']}),
  I(F, 'If nothing was logged, does that show everything is fine?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['all-clear', 'recorded', 'incident', 'safe']}),
  I(C, 'Does a lapsed pass tell you the visitor has gone?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['access', 'record', 'left', 'arriv']}),
  I(C, 'Is the visitor already inside?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'unknown', kw: ['arriv', 'access', 'record']}),
  // WHY
  I(F, 'What is the reason that one ranks first?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'priority', 'recorded']}, ['Which maintenance issue is most pressing?']),
  I(O, 'Walk me through why you picked that.', 'EXPLANATION', 'why', {kw: ['not ranked', "haven't ranked", 'have not ranked', 'no ordering', 'nothing was ranked', 'not put', 'did not rank', 'not ordered', "haven't", 'not picked']}, ['Which opportunity should I back?']),
  I(C, 'Why is it that you cannot confirm my devices are on?', 'EXPLANATION', 'why', {kw: ['stale', 'readings', 'not current']}),
  I(F, 'Why does the water leak matter?', 'EXPLANATION', 'why', {kw: ['open', 'high', 'unresolved']}),
  // COMPARISON
  I(F, 'Which is the bigger problem, the water leak or the light fault?', 'COMPARISON', 'compare', {names: ['water', 'light']}),
  I(O, 'How does Lead Alpha stack up against Lead Beta?', 'COMPARISON', 'compare', {names: ['Alpha', 'Beta']}),
  I(O, 'Compare the VI Development with the Abuja JV.', 'COMPARISON', 'compare', {names: ['Abuja JV', 'VI Development']}),
  // RISK
  I(F, 'Is there any hazard I need to deal with?', 'SAFETY_RISK', 'risk', {kw: ['water'], hedge: true}),
  I(F, 'There is a smell of smoke coming from the lift shaft.', 'SAFETY_RISK', 'risk', {kw: ['smoke'], unverified: true}),
  I(C, 'The wall behind the cooker is very hot and smells of burning.', 'SAFETY_RISK', 'risk', {kw: ['burning', 'hot'], unverified: true}),
  I(C, 'Should I be concerned about my home tonight?', 'SAFETY_RISK', 'risk', {kw: ['camera', 'stale', 'readings', 'cannot', "can't", 'security'], hedge: true}),
  // LIMITATION
  I(C, 'Tell me my water usage this month.', 'LIMITATION', 'limit', {kw: ['water', 'usage', 'consumption']}),
  I(F, 'What is the air quality in the basement?', 'LIMITATION', 'limit', {kw: ['air', 'quality']}),
  I(O, 'What has moved in the pipeline since the start of the year?', 'LIMITATION', 'limit', {kw: ['baseline', 'earlier', 'snapshot', 'history', 'previous', 'since']}),
  I(F, 'Can you show me data for Wing B?', 'LIMITATION', 'limit', {kw: ['wing', 'scope', 'building', 'tower']}),
  I(F, 'Who among the tenants made the complaint?', 'REFUSAL', 'limit', {kw: ['tenant', 'who', 'attribut', 'identify', 'responsible', 'name']}),
  // ACTION RESULT
  I(C, 'Was anything switched because of this chat?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'switch', 'anything', 'device']}, ['Which appliances have outdated readings?']),
  I(F, 'Did you edit anything while we spoke?', 'ACTION_RESULT', 'yesno', {pol: 'no', kw: ['chang', 'alter', 'edit', 'anything']}),
  // CONSTRAINT
  I(O, 'Keep my budget numbers between us.', 'CONFIRMATION_STATE', 'ack', {kw: ['budget', 'numbers', 'noted', 'between']}),
  I(F, "Don't ever tell me a gate is secure unless a sensor says so.", 'CONFIRMATION_STATE', 'ack', {kw: ['gate', 'sensor', 'not', 'secure']}),
  I(C, 'Please do not change any settings during this conversation.', 'CONFIRMATION_STATE', 'ack', {kw: ['settings', 'not', 'change']}),
  // PUBLIC
  I(P, 'Will you guarantee a buyer for my land?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'no', kw: ['promise', 'guarantee', 'buyer']}, PUB),
  I(P, 'What information do you still lack?', 'LIST', 'list', {names: ['structure', 'owner', 'title', 'expect'], min: 1}, PUB),
  I(P, 'Is what I have given you adequate to start talking?', 'YES_NO_WITH_REASON', 'yesno', {pol: 'yes_or_partial', kw: ['enough', 'first', 'still', 'need', 'look']}, PUB),
  I(P, 'Which suits me best, a sale or a partnership?', 'COMPARISON', 'limit', {kw: ['sale', 'partnership', 'depends', 'yet']}, PUB),
  I(P, 'Read back what you have noted from me.', 'LIST', 'list', {names: ['Lekki', '1,200'], min: 2}, PUB),
  // CLARIFICATION / DISCOVERY
  I(C, 'Turn that off.', 'CLARIFICATION', 'clarify', {}),
  I(C, 'What kind of things can you help me with?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  I(P, 'What can you do for me?', 'CAPABILITY_DISCOVERY', 'discovery', {}),
  // PROVIDER UNAVAILABLE / PARTIAL / UNSUPPORTED SCOPE
  I(O, 'Arrange my leads from most to least promising.', 'LIMITATION', 'limit', {kw: ['order', 'rank', 'comparative']}),
  I(O, 'Which opportunity should I put my effort into?', 'LIMITATION', 'limit', {kw: ['rank', 'comparative', 'order', 'first']}),
  I(F, 'Summarise the condition of every building on the estate.', 'LIMITATION', 'limit', {kw: ['maintenance', 'security', 'only', 'cover', 'every', 'building']}),
].map((x, i) => ({id: `IQ8C-${String(i + 1).padStart(3, '0')}`, ...x}));
fs.writeFileSync('artifacts/intelligence-quality-v1-iq8-heldout-suite-C.json', JSON.stringify({version: 1, status: 'IQ8_HELDOUT_C_FROZEN_AFTER_THRESHOLDS_PRE_RUN', note: 'Authored after the IQ-8 implementation was complete and before it was ever run; run once. Runtime must never read this file (static guard).', items}, null, 1) + '\n');
const by = items.reduce((m, i) => (m[i.shape] = (m[i.shape] || 0) + 1, m), {}); console.log(items.length, by);
