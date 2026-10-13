// Pure restored-runtime checks; dummy loopback client, no database credentials.
import fs from 'node:fs';import assert from 'node:assert/strict';import {spawnSync,execFileSync} from 'node:child_process';
assert.equal(execFileSync('git',['diff','2984e9205708ab0e4d109377ac6877b6b2ef7855','--','src'],{encoding:'utf8'}),'');
const p=spawnSync(process.execPath,['scripts/iq11b-contracts.mjs'],{env:{...process.env,SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-unusable-key',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''},encoding:'utf8'});
assert.equal(p.status,0,p.stderr);const result=JSON.parse(p.stdout);assert.equal(result.fail,0);fs.writeFileSync('/tmp/iq11d-iq11b-structural.json',JSON.stringify(result,null,2),{flag:'wx'});
const q=spawnSync(process.execPath,['scripts/iq11d-contracts.mjs','/tmp/iq11d-restored-contracts.json'],{encoding:'utf8'});console.log(q.stdout);assert.equal(q.status,1,'Restored baseline must still expose unfixed IQ11D contract gaps');
console.log(JSON.stringify({restored_runtime:true,iq11b:result.pass,iq11d_gaps_preserved:true}));
