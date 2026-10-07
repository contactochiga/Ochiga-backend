// IQ-8D2 contract tests: one test per frozen contract class (artifacts/intelligence-quality-v1-iq8d2-contract-matrix.json). Pure; no database/provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {projectResponse, projectionRequired} = await import('../dist/oyi-core/response/projector.js');
const {heldFactsEnvelope, mapResultEnvelope} = await import('../dist/oyi-core/response/envelopeMappers.js');
const matrix = JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq8d2-contract-matrix.json', 'utf8'));
const T = q => parseSemanticFrame(q).answerTarget;
const P = (q, e) => projectResponse(T(q), e, {asked: q, raw: q});
const env = o => ({v: 1, capability_key: 'x', availability: 'answered', capability_status: 'enabled', subject: {domain: 'wallet', object_class: 'wallet', noun: 'wallet transactions', singular: 'wallet transaction', facets: ['transactions', 'list']}, legacy_prose: 'LEGACY-SENTENCE', ...o});
const txRecs = [{label: 'Electricity purchase', status: 'completed'}, {label: 'Wallet funding', status: 'completed'}];
const wallet = env({records: txRecs, count: 2, measures: [{key: 'o', label: 'money out (debits)', amount: 2500, currency: 'NGN', direction: 'out', n: 1}, {key: 'i', label: 'money in (credits)', amount: 15000, currency: 'NGN', direction: 'in', n: 1}]});
let n = 0; const ok = (name, f) => {try {f();} catch (e) {e.message = `${name}: ${e.message}`; throw e;} n++;};

// every class in the frozen matrix has a test below
const covered = new Set();
const cls = (c, name, f) => {assert(matrix.classes[c], `unknown class ${c}`); covered.add(c); ok(`${c}/${name}`, f);};

// SUM vs COUNT vs VALUE vs LIST vs HISTORY: same capability truth, different targets, different shapes
cls('COUNT', 'transactions', () => assert.match(P('How many transactions are there?', wallet).primary, /^There are 2 wallet transactions/));
cls('AGGREGATE_VALUE', 'out', () => {const p = P('How much money went out of my wallet?', wallet); assert.equal(p.shape, 'AGGREGATE_VALUE'); assert.match(p.primary, /NGN 2,500 went out across 1 wallet transaction/); assert.doesNotMatch(p.primary, /There are/);});
cls('AGGREGATE_VALUE', 'in', () => assert.match(P('How much money has come into my wallet?', wallet).primary, /NGN 15,000 came in/));
cls('AGGREGATE_VALUE', 'partial-truthful', () => assert.match(P('How much did I spend?', env({...wallet, measures: [{key: 'o', label: 'money out (debits)', amount: 9, currency: 'NGN', direction: 'out', n: 3, partial: true}]})).primary, /hit its limit/));
cls('AGGREGATE_VALUE', 'no-total-no-guess', () => {const p = P('How much money went out of my wallet?', env({records: txRecs, count: 2})); assert.equal(p.shape, 'LIMITATION'); assert.match(p.primary, /no total/);});
cls('LIST', 'transactions', () => assert.match(P('Show the transactions.', wallet).primary, /Electricity purchase/));
cls('VALUE', 'balance', () => {const e = env({subject: {domain: 'wallet', object_class: 'wallet', noun: 'wallet balance', singular: 'wallet balance', facets: ['balance']}, value: {amount: 12500, currency: 'NGN', label: 'Wallet balance'}}); assert.equal(T("What's my balance?").quantity, 'value'); assert.match(P("What's my balance?", e).primary, /NGN 12,500/); assert.match(P('How much is in my wallet?', e).primary, /NGN 12,500/);});
cls('HISTORY', 'current-only', () => assert.match(P('What was my balance last week?', env({subject: {domain: 'wallet', object_class: 'wallet', noun: 'wallet balance', singular: 'wallet balance', facets: ['balance']}, value: {amount: 1, currency: 'NGN'}})).primary, /earlier|current/));
// financial / portfolio: totals survive an empty record list
const fin = env({capability_key: 'financial.summary.read', subject: {domain: 'office_financial', object_class: null, noun: 'estate financial summaries', singular: 'estate financial summary', facets: ['status']}, records: [], count: 0, measures: [{key: 'r', label: 'period revenue', amount: 900000, currency: 'NGN'}, {key: 'u', label: 'utility sales', amount: 400000, currency: 'NGN'}, {key: 'b', label: 'current balance', amount: 5, currency: 'NGN'}]});
cls('VALUE', 'empty-records-keep-totals', () => {const p = P('revenue this period?', fin); assert.match(p.primary, /Period revenue: NGN 900,000/); assert.doesNotMatch(p.primary, /Current balance/);});
cls('VALUE', 'named-measure', () => assert.match(P('What did utility sales come to?', fin).primary, /Utility sales: NGN 400,000/));
// status / detail / explanation / age
const opps = env({subject: {domain: 'crm', object_class: 'opportunity', noun: 'opportunities', singular: 'opportunity', facets: ['status', 'list']}, records: [{id: 'a', label: 'VI Development', status: 'qualified', age_days: 21}, {id: 'b', label: 'Abuja JV', status: 'qualified', age_days: 8}], count: 2});
cls('DETAIL', 'age-preserved', () => assert.match(P('How is VI Development doing?', opps).primary, /21 days since its last recorded activity/));
cls('EXPLANATION', 'named-with-age', () => assert.match(P('Why is VI Development stale?', opps).primary, /21 days/));
cls('EXPLANATION', 'no-reason-targeted-limit', () => {const p = P('Why are these opportunities like that?', opps); assert.equal(p.shape, 'LIMITATION');});
cls('STATUS', 'records', () => assert.equal(P('What is the status of my opportunities?', opps).shape, 'STATUS'));
// fact recall / confirmation / submission (public)
const held = heldFactsEnvelope({known: {opportunity_type: 'land', location: 'Lekki'}, missing: ['land_size'], constraints: []});
cls('FACT_RECALL', 'what-told', () => {const p = P('What did I tell you about the location?', held); assert.match(p.primary, /Location: Lekki/);});
cls('FACT_CONFIRMATION', 'did-i-say', () => {const t = T('Did I say the location was Lekki?'); assert.equal(t.response_intent, 'YES_NO_WITH_REASON'); const p = projectResponse(t, held, {asked: ''}); assert.match(p.primary, /^Yes —/);});
cls('FACT_CONFIRMATION', 'never-said', () => assert.match(P('Did I tell you the land size?', held).primary, /^No — you haven't told me land size/));
cls('SUBMISSION_STATE', 'unknown-not-submitted-claim', () => {const t = T('Have you submitted my details to your team?'); assert.equal(t.ask_facet, 'submission'); const p = projectResponse(t, held, {asked: ''}); assert.equal(p.shape, 'SUBMISSION_STATE'); assert.match(p.primary, /can't confirm/); assert.doesNotMatch(p.primary, /^Yes/);});
cls('SUBMISSION_STATE', 'submitted', () => assert.match(projectResponse(T('Have you submitted my details to your team?'), heldFactsEnvelope({known: {}, missing: [], constraints: [], submission: 'submitted'}), {asked: ''}).primary, /^Yes/));
// constraints are their own class: not cancellation, advice, recall or action
cls('CONSTRAINT_ACKNOWLEDGEMENT', 'disclosure', () => {const t = T("Don't share my number."); assert.equal(t.confirmation_kind, 'constraint'); assert.equal(t.constraint_kind, 'disclosure'); assert.match(projectResponse(t, held, {asked: '', raw: "Don't share my number."}).primary, /won't share your number.*this conversation only/);});
cls('CONSTRAINT_ACKNOWLEDGEMENT', 'channel', () => {const t = T('Only contact me by email.'); assert.equal(t.constraint_kind, 'channel'); assert.match(projectResponse(t, held, {asked: '', raw: 'Only contact me by email.'}).primary, /only contact you by email/);});
cls('CONSTRAINT_ACKNOWLEDGEMENT', 'commitment', () => assert.equal(T('Do not promise financing.').constraint_kind, 'commitment'));
cls('CONSTRAINT_ACKNOWLEDGEMENT', 'tag-close-not-cancel', () => assert.equal(T('Do not pass my details on to anyone else, ok?').confirmation_kind, 'constraint'));
cls('CONSTRAINT_ACKNOWLEDGEMENT', 'no-durable-claim', () => assert.doesNotMatch(projectResponse(T("Don't share my number."), held, {asked: '', raw: "Don't share my number."}).primary, /always|forever|permanently|saved your preference/i));
// clarification
cls('CLARIFICATION_REQUIRED', 'pronoun-only', () => {const f = parseSemanticFrame('do it again'); assert.equal(f.answerTarget.response_intent, 'CLARIFICATION'); assert.equal(f.answerTarget.clarify_reason, 'unresolved_reference'); const p = projectResponse(f.answerTarget, env({}), {asked: ''}); assert.match(p.primary, /^Which one do you mean/); assert.doesNotMatch(p.primary, /nothing pending|I can do|menu/i);});
cls('CLARIFICATION_REQUIRED', 'not-for-resolvable-content', () => assert.notEqual(T('turn off the kitchen light').response_intent, 'CLARIFICATION'));
// limitation by kind
cls('LIMITATION', 'denied-declared-unavailable', () => {assert.match(P('List my leads', env({availability: 'denied', limitations: [{kind: 'AUTHORITY_DENIED'}]})).primary, /not authorised/); assert.match(P('How much electricity did I use?', env({availability: 'unsupported', capability_status: 'declared', limitations: [{kind: 'MISSING_CAPABILITY', label: 'consumption (usage) readings'}]})).primary, /not available/);});
cls('YES_NO', 'state-on-records', () => assert.match(P('Is the water issue still open?', env({subject: {domain: 'facility', object_class: 'maintenance_request', noun: 'maintenance requests', singular: 'maintenance request', facets: ['status']}, records: [{label: 'Water issue', status: 'open', state: 'open'}], count: 1})).primary, /^Yes — Water issue is still open/));
cls('COMPARISON', 'held-sides', () => assert.equal(P('How does a lease compare with a JV for me?', held).shape, 'LIMITATION'));
// legacy prose never replaces a projected primary; it only follows as supporting detail
ok('legacy-never-primary', () => {for (const q of ['Show the transactions.', 'How many transactions are there?', 'How much money went out of my wallet?']) {const p = P(q, wallet); assert.notEqual(p.primary, 'LEGACY-SENTENCE'); assert.doesNotMatch(p.primary, /LEGACY-SENTENCE/);}});
// target-application guarantee: required => answered; specialised => exempt
ok('guarantee', () => {const qs = ['List my open requests', 'How many are open?', 'Show everything', 'What is the status?', 'Tell me about it', 'Give me an overview', 'which are resolved?', 'how many resolved ones are there', 'is anything outstanding?', 'status of the water issue'];
  const recs = [{label: 'Water issue', status: 'open', state: 'open'}, {label: 'Light issue', status: 'resolved', state: 'resolved'}];
  for (const e of [env({subject: {domain: 'x', object_class: null, noun: 'items', singular: 'item', facets: ['list']}, records: recs, count: 2}), env({subject: {domain: 'x', object_class: null, noun: 'items', singular: 'item', facets: ['list']}, records: [], count: 0, availability: 'empty'})])
    for (const q of qs) {const t = T(q); if (projectionRequired(t, e)) assert.ok(projectResponse(t, e, {asked: q, raw: q}), `required but not projected: ${q}`);}});
ok('specialised-exempt', () => {for (const q of ['What can you do?', 'Did you switch the AC off for me earlier?']) assert.equal(projectionRequired(T(q), env({records: [], count: 0})), false, q); assert.equal(projectionRequired(T('turn off the kitchen light'), env({})), false);});
// regression guards found by the wave 11 diff: a cancellation of a pending thing is not a constraint; judgment-required rankings without records stay limitations
ok('cancel-not-constraint', () => {assert.equal(T("Actually, don't send it.").confirmation_kind, 'cancel'); assert.equal(T('Actually do not send it.').confirmation_kind, 'cancel'); assert.equal(T('Actually do not send anything.').confirmation_kind, 'cancel'); assert.equal(T("Please don't share my wallet balance with any visitor.").confirmation_kind, 'constraint');});
ok('ranking-needs-judgment-no-records', () => {const e = env({capability_key: 'crm.leads.read', hints: {requires_judgment: true}, legacy_prose: 'start with A'}); const p = P('Which ones need attention first?', e); assert.equal(p.shape, 'LIMITATION'); assert.match(p.primary, /can't put them in order/);});
// every frozen class is covered
ok('matrix-coverage', () => {const missing = Object.keys(matrix.classes).filter(c => !covered.has(c)); assert.deepEqual(missing, []);});
console.log(JSON.stringify({status: 'PASS', tests: n}));
