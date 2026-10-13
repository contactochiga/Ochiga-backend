import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const out=process.argv[2];assert(out?.startsWith('/tmp/iq11c-iq11d-')&&out.endsWith('-manifest.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
const paths=[...walk('src'),...walk('dist'),'scripts/iq8f-run.mjs','scripts/iq1-local-run.mjs','scripts/iq11c-reliability-live.mjs','scripts/iq11d-live.mjs','scripts/iq11d-contracts.mjs','scripts/iq11d-independent.mjs','artifacts/intelligence-quality-v1-iq11d-independent-cases.json'];
const m={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:paths.map(path=>({path,sha256:hash(fs.readFileSync(path))})),provider:'off',physical_execution:'trapped',fixture:'loopback:55421'};
fs.writeFileSync(out,JSON.stringify(m,null,2),{flag:'wx'});console.log(JSON.stringify({files:paths.length,sha256:hash(fs.readFileSync(out))}));
