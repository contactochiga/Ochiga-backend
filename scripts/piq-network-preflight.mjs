// Actual loopback connectivity under qualification guards, before first contact.
// No conversation, provider request, message send or physical execution.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const runner=fs.readFileSync('scripts/piq-qualification-run.mjs','utf8');
const isolation=runner.match(/const isolation=String.raw`([\s\S]*?)`;/)[1];
const fixture=fs.readFileSync('scripts/iq8f-run.mjs','utf8');
const setup=fixture.slice(0,fixture.indexOf('// IQ-8F certification runner:')).replaceAll("'../dist/",`'${process.cwd()}/dist/`).replace('let executed = 0;',isolation+'\nlet executed = 0;');
const code=String.raw`
unscripted();const q=await db.from('estates').select('name').limit(2);assert(!q.error);assert.deepEqual(q.data,[{name:'Wave 11 Test Estate'}]);
const p=await require(process.cwd()+'/dist/oyi-core/observability/conversationTraceSchema.js').preflightConversationTrace();assert.equal(p.status,'compatible');
assert.equal(executed,0);assert.equal(blockedNetwork,0);
console.log(JSON.stringify({loopback:true,schema:p.status,core_turns:0,physical_executor_attempts:executed,external_attempts:blockedNetwork}));
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+code],{env:process.env,stdio:'inherit',timeout:30000});process.exitCode=p.status??1;
