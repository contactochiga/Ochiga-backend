// Run only after all four first-contact captures. Existing tests are unchanged.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
const runtime='46efdbbae5ad3090c389cf9ddc799f15e00e68e3';
assert(fs.existsSync('artifacts/intelligence-quality-v1-iq10f-first-contact-hashes.json'));
assert.equal(execFileSync('git',['diff',runtime,'--','src','supabase','package.json','package-lock.json'],{encoding:'utf8'}),'');
const p=spawnSync(process.execPath,['scripts/iq10e-validation.mjs','/tmp/iq10e-iq10f-preservation'],{env:process.env,stdio:'inherit',timeout:3600000});
assert.equal(execFileSync('git',['diff',runtime,'--','src','supabase','package.json','package-lock.json'],{encoding:'utf8'}),'');
process.exitCode=p.status??1;
