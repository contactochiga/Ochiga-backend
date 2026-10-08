// IQ-9A8 R4 end-to-end assertions over the R4 synthetic corpus (references, scope, corrections, Osa continuity). Every refusal/clarification case has an authorized counterpart.
import fs from 'node:fs'; import assert from 'node:assert/strict';
const out = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/iq9a8-r4-out.json', 'utf8')); const R = Object.fromEntries(out.records.map(r => [r.id, r])); let n = 0;
const ok = (id, f) => {try {f(R[id].answer, R[id]);} catch (e) {e.message = `${id}: ${e.message}\n  OWNER: ${R[id].capability}\n  ANSWER: ${JSON.stringify(R[id].answer)}`; throw e;} n++;};
for (const r of out.records) assert(!r.error, `${r.id} errored`);
assert.equal(out.executed_device_commands, 0, 'nothing is executed');
// references: the named subject wins; several plausible referents are asked about, never guessed; a valid ordinal resolves
ok('R4-N01', a => {assert.match(a, /Historical Visitor/); assert.doesNotMatch(a, /Expected Visitor/);});
ok('R4-N02', a => {assert.match(a, /more than one match/); assert.match(a, /unresolved water issue/); assert.match(a, /resolved light issue/);});
ok('R4-N03', a => assert.match(a, /resolved light issue/));
ok('R4-N09', a => assert.match(a, /resolved light issue/)); // an ordinal after a multi-part answer refers to the last list presented
ok('R4-N04', a => {assert.match(a, /doesn't include a “units sold” figure/); assert.match(a, /status planning/); assert.doesNotMatch(a, /^Development projects:/); assert.doesNotMatch(a, /\b\d+ of \d+ units\b/);}); // a figure the listed record did not carry is stated absent, never supplied
ok('R4-N18', a => {assert.doesNotMatch(a, /nothing was changed in this conversation/); assert.match(a, /unresolved water issue|light issue|recorded as/i);});
// scope: a refused scope is never inherited; "mine" is a fresh own-scope governed read; a cross-scope reference is refused even after an own-scope read
ok('R4-N05', a => {assert.match(a, /^Taking “just mine” to mean your own visitors/); assert.match(a, /Expected Visitor/);});
ok('R4-N06', a => {assert.match(a, /your own wallet balance/); assert.match(a, /NGN 12,500/);});
ok('R4-N07', a => assert.doesNotMatch(a, /^Taking/)); // nothing was refused, so nothing is "reset"
ok('R4-N10', a => assert.match(a, /not authorised[\s\S]*your own home/));
ok('R4-N08', a => {assert.match(a, /NGN 12,500/); assert.doesNotMatch(a, /maintenance/i);}); // an unrelated topic switch is not bound to the earlier list
ok('R4-N19', a => assert.match(a, /Wallet balance: NGN 12,500/)); // returning to a domain re-reads it with current authority
// Osa continuity and corrections
ok('R4-N11', a => {assert.match(a, /location: Asaba/); assert.match(a, /existing building/); assert.match(a, /Earlier you mentioned location Port Harcourt[\s\S]*no longer treat that as current/); assert.doesNotMatch(a.split('Earlier you mentioned')[0], /Port Harcourt/);});
ok('R4-N12', a => assert.match(a, /Kano[\s\S]*5 acres/));
ok('R4-N13', a => {assert.match(a, /not to contact you by phone/); assert.match(a, /nothing has been booked/); assert.match(a, /not a standing rule/);});
ok('R4-N14', (a, r) => {assert.match(a, /haven't passed a callback request/); assert.doesNotMatch(a, /received your callback|no callback is confirmed/);});
ok('R4-N15', a => assert.match(a, /no phone contact/));
ok('R4-N16', a => {assert.match(a, /won't ask the team to contact you/); assert.match(a, /Kano[\s\S]*5 acres/);});
ok('R4-N17', a => {assert.match(a, /callback request/); assert.match(a, /no callback is confirmed|received your callback/);}); // an authorized callback request still reaches the handoff
console.log(JSON.stringify({status: 'PASS', tests: n}));
