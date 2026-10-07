// IQ-9A4 R0 end-to-end assertions over the R0 synthetic corpus run (scripts/iq8f-run.mjs, IQ8F_CONFIG-style config swap).
import fs from 'node:fs'; import assert from 'node:assert/strict';
const out = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/iq9a4-r0-out.json', 'utf8')); const R = Object.fromEntries(out.records.map(r => [r.id, r])); let n = 0;
const ok = (id, f) => {try {f(R[id].answer, R[id]);} catch (e) {e.message = `${id}: ${e.message}\n  ANSWER: ${JSON.stringify(R[id].answer)}`; throw e;} n++;};
for (const r of out.records) assert(!r.error, `${r.id} errored`);
assert.equal(out.executed_device_commands, 0, 'nothing is executed by any R0 turn');
// 1 visitor semantics: one definition across read, judgment and projection
for (const id of ['R0-01', 'R0-02', 'R0-21']) ok(id, a => {assert.doesNotMatch(a, /^Yes|\b0 currently active, 0 recorded|\b0 active\b(?!.*past)/i); assert.match(a, /(?:past (?:its|their) recorded expiry|recorded expiry time has passed)/);});
ok('R0-03', a => assert.match(a, /Expected Visitor[\s\S]*Historical Visitor/)); // permission-status listing preserved
ok('R0-20', a => assert.doesNotMatch(a, /\b(?:has|have) arrived|is here/i)); // permission is still not presence
// 2 affirmative licence
ok('R0-22', a => {assert.doesNotMatch(a, /^Yes/); assert.match(a, /can't confirm that anyone is working on it/);});
ok('R0-05', a => assert.doesNotMatch(a, /^Yes/));
ok('R0-06', a => assert.match(a, /^Yes — .*open/)); ok('R0-07', a => assert.match(a, /unresolved water issue/));
// 3 compound consistency
ok('R0-08', (a, r) => {assert.equal(r.requires_confirmation, true); assert.match(a, /awaiting your approval/); assert.match(a, /not been done|has not been done/); assert.doesNotMatch(a, /not started/); assert.match(a, /Cancelled\. I did not send that device command/);});
ok('R0-09', (a, r) => {assert.equal(r.requires_confirmation, true); assert.match(a, /Please confirm/);});
ok('R0-10', (a, r) => {assert.equal(r.requires_confirmation, false); assert.match(a, /Cancelled/); assert.match(a, /Nothing else has been started/);});
// 4 confirmation continuation
ok('R0-11', a => {assert.match(a, /waiting for your approval/); assert.match(a, /nothing has been sent or changed/); assert.match(a, /just “yes” or “confirm”/);});
ok('R0-12', a => {assert.match(a, /Nothing is waiting for your confirmation/); assert.match(a, /can't be revived/);});
ok('R0-13', a => assert.match(a, /^Cancelled/));
// 5 constraints
for (const id of ['R0-14', 'R0-15', 'R0-18']) ok(id, (a, r) => {assert.doesNotMatch(a, /\d|NGN|₦/); assert.match(r.capability, /constraint_acknowledged/); assert.match(a, /this conversation only/); assert.doesNotMatch(a, /permanently|always|from now on|forever/i);});
for (const id of ['R0-16', 'R0-17']) ok(id, a => assert.match(a, /NGN 12,500/)); // authorized financial questions still answered
// 6 handoff (fixture has no Office service: the unavailable branch is the truthful one reachable end to end; stages are covered by the module tests)
ok('R0-19', a => {assert.match(a, /no callback is confirmed/); assert.doesNotMatch(a, /received your callback|booked|will call/i);});
console.log(JSON.stringify({status: 'PASS', tests: n}));
