// IQ-9A9 R5 end-to-end assertions over the R5 synthetic corpus.
import fs from 'node:fs'; import assert from 'node:assert/strict';
const out = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/iq9a9-r5-out.json', 'utf8')); const R = Object.fromEntries(out.records.map(r => [r.id, r])); let n = 0;
const ok = (id, f) => {try {f(R[id].answer, R[id]);} catch (e) {e.message = `${id}: ${e.message}\n  OWNER: ${R[id].capability}\n  ANSWER: ${JSON.stringify(R[id].answer)}`; throw e;} n++;};
for (const r of out.records) assert(!r.error, `${r.id} errored`);
assert.equal(out.executed_device_commands, 0, 'nothing is executed');
const proposal = (a, r, dev) => {assert.equal(r.requires_confirmation, true); assert.match(a, new RegExp(`Please confirm: turn (?:on|off) on Wave11 ${dev}\\. No command was sent yet`));};
// short names and named subjects
for (const id of ['R5-D01', 'R5-D02', 'R5-D03', 'R5-D09', 'R5-P04']) ok(id, (a, r) => proposal(a, r, 'AC'));
ok('R5-D03', a => assert.match(a, /turn on on Wave11 AC/)); ok('R5-D01', a => assert.match(a, /turn off on Wave11 AC/)); // direction is the stated one
ok('R5-D07', (a, r) => proposal(a, r, 'Kitchen Light')); ok('R5-P01', (a, r) => proposal(a, r, 'Bedroom Light')); ok('R5-P03', (a, r) => proposal(a, r, 'Kitchen Light'));
ok('R5-P02', (a, r) => {assert.match(a, /possible hazard[\s\S]*nothing I do will make it safe/); assert.match(a, /Please confirm: turn off on Wave11 AC/); assert.equal(r.requires_confirmation, true);});
ok('R5-P05', (a, r) => {assert.equal(r.requires_confirmation, false); assert.match(a, /exact device/); assert.doesNotMatch(a, /Please confirm/);}); // a bare pronoun after a record list guesses no device
// home scope
ok('R5-D08', (a, r) => {assert.match(a, /not authorised/); assert.equal(r.requires_confirmation, false); assert.doesNotMatch(a, /Please confirm/);});
// state and history are never commands
for (const id of ['R5-D04', 'R5-D05', 'R5-D10']) ok(id, (a, r) => {assert.equal(r.requires_confirmation, false); assert.doesNotMatch(a, /Please confirm/);});
for (const id of ['R5-D06', 'R5-D11', 'R5-D12']) ok(id, (a, r) => {assert.equal(r.requires_confirmation, false); assert.match(a, /^No — nothing has been sent or changed/);});
// finance by surface
for (const id of ['R5-F01', 'R5-F03', 'R5-F08']) ok(id, a => assert.match(a, /NGN 12,500/));
ok('R5-F02', a => assert.match(a, /NGN 15,000/)); ok('R5-F09', a => assert.match(a, /Portfolio entries/));
for (const id of ['R5-F04', 'R5-F10']) ok(id, a => {assert.match(a, /not authorised[\s\S]*your own home/); assert.doesNotMatch(a, /12,500/);}); // estate finance is never answered from the resident's wallet
ok('R5-F05', a => assert.match(a, /Wallet balance: NGN 12,500/));
ok('R5-F06', a => {assert.match(a, /not authorised/); assert.doesNotMatch(a, /12,500/);});
ok('R5-F07', a => {assert.match(a, /no access/); assert.doesNotMatch(a, /12,500|15,000/);});
// measurements and wallet positives
ok('R5-M01', a => assert.match(a, /don't have humidity data/)); ok('R5-M02', a => assert.match(a, /don't have temperature data/)); ok('R5-M03', a => assert.match(a, /Electricity purchase/));
// public facts
ok('R5-O01', a => assert.match(a, /5 acres/)); ok('R5-O02', a => assert.match(a, /Kano/)); ok('R5-O03', a => assert.match(a, /sale/));
console.log(JSON.stringify({status: 'PASS', tests: n}));
