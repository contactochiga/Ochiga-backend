// IQ-8D projector / envelope / carried-target tests. Pure: synthetic envelopes, no database, no provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {projectResponse} = await import('../dist/oyi-core/response/projector.js');
const {mapResultEnvelope, heldFactsEnvelope} = await import('../dist/oyi-core/response/envelopeMappers.js');
const {responseContract} = await import('../dist/oyi-core/response/resultEnvelope.js');
const {refineAnswerTarget} = await import('../dist/oyi-core/response/answerTarget.js');
const T = q => parseSemanticFrame(q).answerTarget;
const proj = (q, env) => projectResponse(T(q), env, {asked: q});
const env = over => ({v: 1, capability_key: 'x', availability: 'answered', capability_status: 'enabled', subject: {domain: 'facility', object_class: 'maintenance', noun: 'maintenance requests', singular: 'maintenance request', facets: ['list', 'status']}, legacy_prose: 'LEGACY', ...over});
const recs = [{label: 'Water issue', status: 'open', state: 'open', detail: 'high'}, {label: 'Light issue', status: 'resolved', state: 'resolved', detail: 'low'}];
let n = 0; const ok = (name, f) => {f(); n++;};

// same capability truth + different targets -> different correct shapes
ok('count', () => assert.match(proj('How many maintenance requests are open?', env({records: recs, count: 2}))?.primary, /^There is 1 open maintenance request/));
ok('list', () => assert.match(proj('List my open maintenance requests', env({records: recs, count: 2}))?.primary, /Water issue/));
ok('list-excludes-resolved', () => assert.doesNotMatch(proj('List my open maintenance requests', env({records: recs, count: 2}))?.primary, /Light issue/));
ok('resolved-list', () => assert.match(proj('Which maintenance requests are resolved?', env({records: recs, count: 2}))?.primary, /Light issue/));
ok('negation', () => assert.doesNotMatch(proj('Which maintenance requests are not resolved?', env({records: recs, count: 2}))?.primary || '', /Light issue/));
// truncation and unknown totals stay truthful
ok('truncated', () => assert.match(proj('List my maintenance requests', env({records: recs, count: 2, total_count: 9, truncated: true}))?.primary, /truncated view \(9 in total\)/));
ok('unknown-total-not-invented', () => assert.doesNotMatch(proj('List my maintenance requests', env({records: recs, count: 2, truncated: true}))?.primary, /\d+ in total/));
ok('count-truncated', () => assert.match(proj('How many maintenance requests are there?', env({records: recs, count: 2, truncated: true}))?.primary, /at least 2/));
// empty
ok('empty', () => assert.match(proj('How many maintenance requests are open?', env({records: [], count: 0, availability: 'empty'}))?.primary, /no open maintenance requests/));
// value
const wallet = env({subject: {domain: 'wallet', object_class: 'wallet', noun: 'wallet', singular: 'wallet', facets: ['balance']}, value: {amount: 12500, currency: 'NGN', label: 'Wallet balance'}});
ok('value', () => assert.match(proj('How much is in my wallet?', wallet)?.primary, /NGN 12,500/));
ok('value-frozen', () => assert.match(proj('What is my balance?', {...wallet, value: {...wallet.value, frozen: true}})?.primary, /frozen/));
ok('value-history-limited', () => assert.match(proj('What was my wallet balance last week?', wallet)?.primary || '', /earlier|current/));
// limitations by kind
ok('unsupported', () => assert.match(proj('How much electricity did I use?', env({availability: 'unsupported', capability_status: 'declared', limitations: [{kind: 'MISSING_CAPABILITY', label: 'consumption (usage) readings'}], subject: {domain: 'utilities', object_class: null, noun: 'usage', singular: 'usage', facets: ['usage']}}))?.primary, /not available/));
ok('usage-from-spending', () => assert.match(proj('How much electricity did I use?', env({subject: {domain: 'utilities', object_class: null, noun: 'spending', singular: 'spending', facets: ['spending']}, records: []}))?.primary || '', /consumption|usage/));
ok('denied', () => assert.match(proj('List my leads', env({availability: 'denied', limitations: [{kind: 'AUTHORITY_DENIED'}]}))?.primary, /not authorised/));
// contract: limitation vs success independent of wording
ok('contract-success', () => assert.equal(responseContract(env({records: recs})).outcome, 'CAPABILITY_SUCCESS'));
ok('contract-limitation', () => assert.equal(responseContract(env({availability: 'unsupported', capability_status: 'declared'})).outcome, 'HONEST_LIMITATION'));
ok('contract-denied', () => assert.equal(responseContract(env({availability: 'denied'})).outcome, 'AUTHORITY_DENIED'));
// held (Osa/public) facts
const held = heldFactsEnvelope({known: {opportunity_type: 'land', location: 'Lekki'}, missing: ['land_size'], constraints: []});
ok('recall', () => assert.match(proj('What have I told you so far?', held)?.primary, /Lekki/));
ok('missing', () => assert.match(proj('What else do you still need from me?', held)?.primary, /land size/));
ok('commitment', () => assert.match(proj('Can I sign a deal with you today?', held)?.primary, /can't promise|can't commit|No —/));
// specialised intents are not captured by the projector
ok('discovery-specialised', () => assert.equal(proj('What can you do?', env({records: recs, count: 2})), null));
// the target is carried, derived once, refined only through a typed operation
const t = T('Which leads need attention?');
ok('carried-immutable', () => {const r = refineAnswerTarget(t, 'test', {response_intent: 'COUNT'}); assert.equal(t.response_intent === 'COUNT', false); assert.deepEqual(r.refinements, ['test']);});
// mappers do not parse prose: prose-only record data produces no records
ok('no-prose-parsing', () => {const e = mapResultEnvelope('crm.leads.read', {status: 'answered', answer: '3 leads: A, B, C', presentation_policy: {primary: 'text'}}, {capability_status: 'enabled'}); assert.equal(e.records, undefined);});
// structural guard: one derivation site
const srcs = []; const walk = d => {for (const f of fs.readdirSync(d, {withFileTypes: true})) {const p = `${d}/${f.name}`; f.isDirectory() ? walk(p) : p.endsWith('.ts') && srcs.push(p);}}; walk('src');
const sites = srcs.filter(p => /deriveAnswerTarget\(/.test(fs.readFileSync(p, 'utf8')) && !p.endsWith('response/answerTarget.ts'));
ok('single-derivation-site', () => assert.deepEqual(sites, ['src/oyi-core/interpretation/SemanticFrameParser.ts']));
console.log(JSON.stringify({status: 'PASS', tests: n}));
