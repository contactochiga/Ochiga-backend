// Offline test infrastructure tests; never loads Core or opens a socket.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('scripts/piq-qualification-run.mjs','utf8');
const isolation=source.match(/const isolation=String.raw`([\s\S]*?)`;/)[1];
let allowed=0;class Socket {connect(){allowed++;return this;}}
const modules={'node:net':{Socket},'node:dgram':{},'node:child_process':{}};
vm.runInNewContext(isolation,{require:n=>modules[n]});
const checks=[];
function test(id,fn){try{fn();checks.push({id,status:'PASS'});}catch(e){checks.push({id,status:'FAIL',error:e.message});}}
test('loopback-db-permitted',()=>new Socket().connect({host:'127.0.0.1',port:55421}));
test('node-normalized-args-permitted',()=>new Socket().connect([{host:'localhost',port:'55421'},()=>{}]));
test('numeric-local-port-permitted',()=>new Socket().connect(55421,'localhost'));
for(const host of ['api.openai.com','generativelanguage.googleapis.com','api.anthropic.com','example.test','192.168.1.2'])test('outbound-denied-'+host,()=>assert.throws(()=>new Socket().connect({host,port:443}),/BLOCKED/));
test('wrong-local-port-denied',()=>assert.throws(()=>new Socket().connect({host:'localhost',port:5432}),/BLOCKED/));
test('unix-socket-denied',()=>assert.throws(()=>new Socket().connect({path:'/tmp/example.sock'}),/BLOCKED/));
test('udp-denied',()=>assert.throws(()=>modules['node:dgram'].createSocket('udp4'),/BLOCKED/));
for(const method of ['spawn','exec','execFile','fork'])test('subprocess-denied-'+method,()=>assert.throws(()=>modules['node:child_process'][method]('anything'),/BLOCKED/));
test('only-three-mock-connections',()=>assert.equal(allowed,3));
const pre=fs.readFileSync('scripts/iq8f-run.mjs','utf8').split('// IQ-8F certification runner:')[0].replaceAll("'../dist/",`'${process.cwd()}/dist/`);
const body=source.match(/const test=String.raw`([\s\S]*?)`\.replace\('WORKER'/)[1].replace('WORKER','"oma"');
test('assembled-child-syntax',()=>{const r=spawnSync(process.execPath,['--input-type=module','--check'],{input:pre.replace('let executed = 0;',isolation+'\nlet executed = 0;')+body,encoding:'utf8'});assert.equal(r.status,0,r.stderr);});
test('exclusive-attempt-journal',()=>assert(source.includes("'-attempts.jsonl','wx'")));
test('journal-fsync-before-run',()=>assert(source.indexOf("entry({event:'started'")<source.indexOf('try{response=await conversationOrchestrator.run')));
test('no-automatic-turn-retry',()=>assert.equal((source.match(/conversationOrchestrator\.run\(/g)||[]).length,1));
test('no-sealed-corpus-execution',()=>assert(source.includes('source.slice(0,source.indexOf(boundary))')));
test('exact-id-final-reconciliation',()=>assert(source.includes('reconcile(captures.map(c=>c.attempt)')));
test('immutable-raw-output',()=>assert(source.includes("flag:'wx',mode:0o600")));
console.log(JSON.stringify({checks,pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length},null,2));
process.exitCode=checks.some(c=>c.status==='FAIL')?1:0;
