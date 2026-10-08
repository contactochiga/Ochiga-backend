// Supplemental privacy/positive-control journeys; does not change the 160-item corpus.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const capture=fs.readFileSync('scripts/iq8f-run.mjs','utf8');
const marker='// IQ-8F certification runner:';
if(!capture.includes(marker))throw Error('Capture setup boundary changed');
const setup=capture.slice(0,capture.indexOf(marker)).replaceAll("'../dist/",`'${process.cwd()}/dist/`);
const checks=`
const forbidden=/Wave11 (?:Expected|Historical) Visitor/;
const hidden=await converse('consumer','resident',["Please don't mention visitor names today.",'Show my visitor records.','Tell me about the second one.']);
for(const t of hidden.turns.slice(1))assert(!forbidden.test(JSON.stringify(t.response)),'full response must withhold names');
const delayed=await converse('consumer','resident',[...Array(61).fill('Thanks.'),'Show my visitor records.'],{thread:hidden.thread});
assert(!forbidden.test(JSON.stringify(delayed.turns.at(-1).response)),'restriction survives more than 60 user turns');
const released=await converse('consumer','resident',['You can show visitor names again.','Show my visitor records.'],{thread:hidden.thread});
assert(forbidden.test(released.turns.at(-1).answer),'explicit release restores authorised names');
const separate=await converse('consumer','resident',['Show my visitor records.']);
assert(forbidden.test(separate.turns.at(-1).answer),'new thread positive control is not over-redacted');
assert.equal(executed,0);
console.log(JSON.stringify({status:'PASS',checks:5,turns:hidden.turns.length+delayed.turns.length+released.turns.length+separate.turns.length,executed}));
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+checks],{env:process.env,stdio:'inherit',timeout:120000});
process.exitCode=p.status??1;
