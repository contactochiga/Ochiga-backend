// IQ-9A5 R2 end-to-end assertions over the R2 synthetic corpus (scripts/iq8f-run.mjs with a config swap).
import fs from 'node:fs'; import assert from 'node:assert/strict';
const out = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/iq9a5-r2-out.json', 'utf8')); const R = Object.fromEntries(out.records.map(r => [r.id, r])); let n = 0;
const MENU = /^I can (?:help with|tell you about) |Here is what I can safely help with|no enabled evidence source/;
const ok = (id, f) => {try {f(R[id].answer, R[id]);} catch (e) {e.message = `${id}: ${e.message}\n  ANSWER: ${JSON.stringify(R[id].answer)}`; throw e;} n++;};
for (const r of out.records) assert(!r.error, `${r.id} errored`);
assert.equal(out.executed_device_commands, 0, 'nothing is executed');
const notMenu = a => assert.doesNotMatch(a, MENU);
ok('R2-N01', a => {notMenu(a); assert.match(a, /^No — nothing has been sent or changed[\s\S]*waiting for your approval/);});
ok('R2-N02', a => {notMenu(a); assert.match(a, /can't promise or confirm/);});
ok('R2-N03', a => {notMenu(a); assert.match(a, /not sure what .* refers to/);});
ok('R2-N04', a => {assert.match(a, /can't say anyone is at the door/); assert.doesNotMatch(a, /^Yes/);});
ok('R2-N05', (a, r) => {notMenu(a); assert.match(a, /not authorised[\s\S]*your own home/);});
ok('R2-N06', a => {notMenu(a); assert.match(a, /can't email anything[\s\S]*Kano/); assert.doesNotMatch(a, /callback request/);}); // an email ask never becomes a handoff
ok('R2-N07', a => {notMenu(a); assert.match(a, /handoff receipt|nothing has been handed/i); assert.doesNotMatch(a, /^Yes/);});
ok('R2-N08', a => {notMenu(a); assert.match(a, /stays in this conversation only/); assert.match(a, /nothing is pending to cancel|nothing was sent/);});
ok('R2-N09', a => {notMenu(a); assert.match(a, /callback request[\s\S]*not the same as a call being booked/);});
ok('R2-N11', a => {notMenu(a); assert.match(a, /can't share how Ochiga assesses/);});
ok('R2-N12', a => {notMenu(a); assert.match(a, /can't arrange or book a call/);});
ok('R2-N13', a => assert.match(a, /VI Development has gone longer[\s\S]*21 days[\s\S]*8 days/));
ok('R2-N14', a => assert.match(a, /NGN 12,500/));
ok('R2-N15', a => {notMenu(a); assert.match(a, /can't tell you that[\s\S]*no evidence it is true/);});
// positive counterparts: discovery keeps its menu, supported reads are answered, limits and denials stay specific, the real callback request still reaches the handoff
ok('R2-P01', a => assert.match(a, /Here is what I can safely help with/)); ok('R2-P02', a => assert.match(a, /Here is what I can safely help with/));
ok('R2-P03', a => assert.match(a, /unresolved water issue/)); ok('R2-P04', a => assert.match(a, /Expected Visitor/));
ok('R2-P05', a => assert.match(a, /So far you have told me[\s\S]*Kano/));
ok('R2-P06', a => {assert.match(a, /callback request/); assert.match(a, /no callback is confirmed|received your callback request/);});
ok('R2-P07', a => assert.match(a, /NGN 12,500/)); ok('R2-P08', a => assert.match(a, /VI Development/));
ok('R2-P10', a => assert.match(a, /can't answer that: there is no enabled evidence source/)); // a genuinely unsupported ask keeps its specific limitation
ok('R2-P11', a => assert.match(a, /confirmed offline|stale|not authorised/)); // never estate-wide devices for a resident
ok('R2-P12', a => assert.match(a, /Ochiga develops/)); ok('R2-P13', a => assert.match(a, /^Cancelled/));
console.log(JSON.stringify({status: 'PASS', tests: n}));
