// IQ-9A6 R1 end-to-end ownership assertions over the R1 synthetic corpus.
import fs from 'node:fs'; import assert from 'node:assert/strict';
const out = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/iq9a6-r1-out.json', 'utf8')); const R = Object.fromEntries(out.records.map(r => [r.id, r])); let n = 0;
const PLANNER = 'oyi.assessment.evidence_plan';
const ok = (id, f) => {try {f(R[id].answer, R[id]);} catch (e) {e.message = `${id}: ${e.message}\n  OWNER: ${R[id].capability}\n  ANSWER: ${JSON.stringify(R[id].answer)}`; throw e;} n++;};
for (const r of out.records) assert(!r.error, `${r.id} errored`);
assert.equal(out.executed_device_commands, 0, 'nothing is executed');
const notPlanner = (a, r) => assert.notEqual(r.capability, PLANNER);
ok('R1-N01', (a, r) => {notPlanner(a, r); assert.match(r.capability, /^maintenance\.requests\.read/); assert.match(a, /unresolved water issue/);});
ok('R1-N02', (a, r) => {notPlanner(a, r); assert.match(a, /^Yes — 1 task open/);});
ok('R1-N03', (a, r) => {notPlanner(a, r); assert.match(r.capability, /visitors\.pending\.read/); assert.doesNotMatch(a, /^Yes/); assert.match(a, /expiry/);});
ok('R1-N05', (a, r) => {notPlanner(a, r); assert.doesNotMatch(a, /^Yes/);});
ok('R1-N06', (a, r) => {notPlanner(a, r); assert.match(a, /can't confirm or deny/);});
ok('R1-N07', (a, r) => {notPlanner(a, r); assert.match(a, /Abuja/); assert.match(a, /still need|missing/i);});
ok('R1-N08', (a, r) => {notPlanner(a, r); assert.match(r.capability, /devices\./);});
ok('R1-N09', (a, r) => {notPlanner(a, r); assert.match(a, /can't confirm that anything was sent/); assert.doesNotMatch(a, /^Yes/);});
ok('R1-N10', (a, r) => {notPlanner(a, r); assert.doesNotMatch(a, /put it in order/);});
ok('R1-N11', (a) => assert.doesNotMatch(a, /do not see any security incidents|no security incidents/i)); // a camera question is never answered with an incident all-clear
ok('R1-N12', (a, r) => {notPlanner(a, r); assert.match(a, /no access to residents/);});
// genuine cognition still reaches governed judgment
for (const id of ['R1-P01', 'R1-P02', 'R1-P03']) ok(id, (a, r) => {assert.equal(r.capability, PLANNER); assert.match(a, /unresolved water issue|overdue follow-up/);});
ok('R1-P01', a => assert.match(a, /comes ahead of/)); ok('R1-P02', a => assert.match(a, /orders recorded status and priority only/)); ok('R1-P03', a => assert.match(a, /not a judgment of how serious/));
ok('R1-P04', (a, r) => {assert.equal(r.capability, PLANNER); assert.match(a, /number 1 in the order I gave/);}); // an existing ranking is explained, not re-planned or re-fetched
ok('R1-P05', (a, r) => {assert.equal(r.capability, PLANNER); assert.match(a, /your own statement[\s\S]*not verified|have not verified it/);}); // material fact: bound to the item and flagged unverified
ok('R1-P06', (a, r) => assert.equal(r.capability, PLANNER));
ok('R1-P07', (a, r) => {assert.equal(r.capability, PLANNER); assert.match(a, /can't judge which[\s\S]*not available right now/);}); // provider-off: the missing reasoning capability is named, nothing is fabricated
ok('R1-P08', (a, r) => assert.match(r.capability, /corporate\.opportunity\.read/)); // public qualification stays with the opportunity module
console.log(JSON.stringify({status: 'PASS', tests: n}));
