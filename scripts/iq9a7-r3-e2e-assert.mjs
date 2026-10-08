// IQ-9A7 R3 end-to-end assertions over the R3 synthetic corpus.
import fs from 'node:fs'; import assert from 'node:assert/strict';
const out = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/iq9a7-r3-out.json', 'utf8')); const R = Object.fromEntries(out.records.map(r => [r.id, r])); let n = 0;
const ok = (id, f) => {try {f(R[id].answer, R[id]);} catch (e) {e.message = `${id}: ${e.message}\n  ANSWER: ${JSON.stringify(R[id].answer)}`; throw e;} n++;};
for (const r of out.records) assert(!r.error, `${r.id} errored`);
assert.equal(out.executed_device_commands, 0, 'nothing is executed by any R3 turn');
const MENU = /^I can (?:help with|tell you about) |Here is what I can safely help with/;
// two authorized reads in different domains: both answered, in order
ok('R3-M01', a => {assert.match(a, /security incidents/); assert.match(a, /On “is the camera working”[\s\S]*camera/); assert(a.indexOf('security incidents') < a.indexOf('camera'));});
ok('R3-M02', a => {assert.match(a, /Yes — 1 report awaiting approval/); assert.match(a, /VI Development: planning/);});
ok('R3-M13', a => {assert.match(a, /VI Development: planning/); assert.match(a, /whether any report[\s\S]*Portfolio Report/);}); // operation flip: same two answers, order follows the user
ok('R3-M14', a => {assert.match(a, /camera/i); assert.match(a, /no security incidents|No — I found no security incidents/i);});
// one read, several clauses: count plus list, total plus entries, list plus count
ok('R3-M03', a => {assert.match(a, /2 visitor access records/); assert.match(a, /expiry/); assert.doesNotMatch(a, /not sure what/);});
ok('R3-M04', a => {assert.match(a, /2,500 went out/); assert.match(a, /Wallet funding/);});
ok('R3-M05', a => {assert.match(a, /Maintenance requests:/); assert.match(a, /1 open maintenance request/);});
// two domains with different permissions: each decided independently
ok('R3-M06', a => {assert.match(a, /Wallet balance: NGN 12,500/); assert.match(a, /unresolved water issue/);});
ok('R3-M08', a => {assert.match(a, /devices/i); assert.match(a, /not authorised[\s\S]*your own home/); assert.doesNotMatch(a, /Expected Visitor/);}); // a denied clause is stated, never widened or omitted
// public Osa
ok('R3-M07', a => {assert.match(a, /Ochiga develops/); assert.match(a, /On “how I would begin[\s\S]*tell me about your land/); assert.doesNotMatch(a, /received your callback request|will call/i);});
ok('R3-M15', a => {assert.match(a, /So far you have told me[\s\S]*Kano/); assert.match(a, /What I still need from you/);});
// read plus action: the read is answered, the action is only proposed, nothing executes
ok('R3-M09', (a, r) => {assert.match(a, /unresolved water issue/); assert.match(a, /Separately — Please confirm[\s\S]*No command was sent yet/); assert.equal(r.requires_confirmation, true);});
ok('R3-M10', (a, r) => {assert.match(a, /Please confirm/); assert.match(a, /On “tell me what maintenance requests I have”[\s\S]*unresolved water issue/); assert.equal(r.requires_confirmation, true);});
// unavailable second clause and ambiguous second clause are represented, not omitted or invented
ok('R3-M11', a => {assert.match(a, /camera/); assert.match(a, /On “is there anything about the generators”[\s\S]*can't tell/);});
ok('R3-M12', a => assert.match(a, /unresolved water issue/));
// single-question behaviour is preserved
ok('R3-S01', (a, r) => {assert.match(r.capability, /maintenance\.requests\.read/); assert.doesNotMatch(a, /On “/);});
ok('R3-S02', a => assert.doesNotMatch(a, /On “/));
ok('R3-S03', a => {assert.match(a, /VI Development has gone longer[\s\S]*21 days/); assert.doesNotMatch(a, /On “/);});
ok('R3-S04', a => {assert.match(a, /don't have temperature data/); assert.doesNotMatch(a, /On “/);});
ok('R3-S05', a => {assert.match(a, /^Cancelled/); assert.match(a, /new proposal awaiting your approval/);});
for (const id of Object.keys(R)) assert.doesNotMatch(R[id].answer.split('\n')[0], MENU, `${id} leads with a capability menu`);
console.log(JSON.stringify({status: 'PASS', tests: n}));
