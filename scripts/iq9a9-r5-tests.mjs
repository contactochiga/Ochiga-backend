// IQ-9A9 R5 routing-precision tests (pure; the device registry is a stub, nothing reaches a database or a device).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.SUPABASE_ANON_KEY ||= 'x';
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
(await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js')).ensureRegistered();
const {namedDevicePhraseFromControlMessage, resolveNamedDeviceForRead} = await import('../dist/oyi-core/runtime/conversationTargetResolver.js');
const {isControlRequest} = await import('../dist/oyi-core/context/currentTurnAuthority.js');
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {supabaseAdmin} = await import('../dist/supabase/supabaseClient.js');
let n = 0; const ok = async (name, f) => {try {await f();} catch (e) {e.message = `${name}: ${e.message}`; throw e;} n++;};
const opts = {isControlRequest: m => /\b(turn|switch|power|set|shut|kill|cut)\b/i.test(m)};
const P = m => namedDevicePhraseFromControlMessage(m, opts);

await ok('short-and-long-names-extract-the-named-device', () => {
  assert.equal(P('Switch off the AC'), 'AC'); assert.equal(P('Could you turn the AC off please?'), 'AC'); assert.equal(P('turn on the AC'), 'AC'); assert.equal(P('Shut the AC down'), 'AC');
  assert.equal(P('Switch off the Kitchen Light'), 'Kitchen Light'); // positive control: long names unchanged
  assert.equal(P('Turn off the light in the living room'), 'light in living room');
});
await ok('a-named-subject-binds-the-pronoun-in-the-same-turn', () => {
  assert.equal(P('The Bedroom Light looks stuck, turn it off'), 'Bedroom Light');
  assert.equal(P('My AC keeps tripping, please switch it off'), 'AC');
  assert.equal(P('The AC is making a burning smell, switch it off now'), 'AC');
});
await ok('a-bare-pronoun-names-nothing-and-is-not-bound-to-an-earlier-object', () => {
  for (const t of ['turn it off', 'switch that off', 'turn this one on']) assert.equal(P(t), null, t);
});
await ok('the-control-verb-set-includes-shut-down', () => { assert(isControlRequest('Shut the AC down')); });

// registry-backed resolution with a stubbed device table
const devices = rows => { supabaseAdmin.from = table => { const q = {select: () => q, eq: () => q, in: () => q, limit: () => Promise.resolve({data: table === 'devices' ? rows : [], error: null}), then: undefined}; q.in = () => Promise.resolve({data: [], error: null}); return q; }; };
const input = {message: 'Switch off the AC', surface: 'consumer', home_id: 'home-1', estate_id: 'estate-1'};
const R = (phrase, message = phrase) => resolveNamedDeviceForRead(null, {home_id: 'home-1', estate_id: 'estate-1'}, {...input, message}, phrase);
await ok('a-short-name-resolves-by-whole-word-to-one-authorised-device', async () => {
  devices([{id: 'd1', name: 'Wave11 AC', home_id: 'home-1', room_id: null, category: 'ac', type: 'ac', capabilities: [], metadata: {}}, {id: 'd2', name: 'Kitchen Light', home_id: 'home-1', room_id: null, category: 'light', type: 'light', capabilities: [], metadata: {}}, {id: 'd3', name: 'Back Door Lock', home_id: 'home-1', room_id: null, category: 'lock', type: 'lock', capabilities: [], metadata: {}}]);
  const r = await R('AC'); assert.equal(r.status, 'resolved'); assert.equal(r.device_id, 'd1'); // "ac" is not a substring hit on "Back Door Lock" or "Kitchen"
});
await ok('duplicate-short-names-are-ambiguous-never-guessed', async () => {
  devices([{id: 'd1', name: 'AC', home_id: 'home-1', room_id: 'r1', category: 'ac', type: 'ac', capabilities: [], metadata: {}}, {id: 'd2', name: 'AC', home_id: 'home-1', room_id: 'r2', category: 'ac', type: 'ac', capabilities: [], metadata: {}}]);
  const r = await R('AC'); assert.equal(r.status, 'ambiguous'); assert.equal(r.candidates.length, 2);
});
await ok('an-unknown-short-name-is-not-found-and-no-home-means-no-device', async () => {
  devices([{id: 'd2', name: 'Kitchen Light', home_id: 'home-1', room_id: null, category: 'light', type: 'light', capabilities: [], metadata: {}}]);
  assert.equal((await R('TV')).status, 'not_found');
  assert.equal((await resolveNamedDeviceForRead(null, {}, {...input, home_id: undefined}, 'AC')).status, 'not_found'); // no home scope: nothing is widened to find a device
});
await ok('financial-wording-routes-by-surface', () => {
  const dom = (s, t) => parseSemanticFrame(t, {surface: s}).domain;
  assert.equal(dom('office_internal', 'Give me the portfolio financial position'), 'office_financial');
  assert.equal(dom('office_internal', 'Show the portfolio entries'), 'office_portfolio'); // positive control: the entries list stays the entries list
  assert.notEqual(dom('consumer', 'What is my balance?'), 'office_financial'); // a resident's balance is the wallet, never the Office summary
});
await ok('state-and-history-questions-never-become-commands', () => {
  for (const t of ['Is the AC on?', 'What is the status of the AC?', 'Is the AC off now?', 'Did you switch off the AC?', 'Did the AC get switched off?']) { const f = parseSemanticFrame(t, {surface: 'consumer'}); assert.equal(f.mutationIntent, false, t); assert.doesNotMatch(f.operation, /^device\.power\./, t); }
  assert.match(parseSemanticFrame('Switch off the AC', {surface: 'consumer'}).operation, /^device\.power\.off$/); // positive control: the command is still a command
});
console.log(JSON.stringify({status: 'PASS', tests: n}));
