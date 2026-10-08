import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// Reuse the already compiled committed control; no checkout or source mutation.
const last=fs.readFileSync('/tmp/iq9a14-control280.stdout','utf8').trim().split('\n').at(-1);
const control=JSON.parse(last);
assert.equal(control.checkpoint,'c73c4c35f3174572bd38ae665d928752983e4ea0');
assert.equal(control.exit,0);assert(control.temporary.startsWith('/tmp/iq9a14-control-'));
const source=fs.readFileSync('scripts/iq9a14-iq7-regression.mjs','utf8').replace("${process.cwd()}/dist/",`${control.temporary}/dist/`);
const p=spawnSync(process.execPath,['--input-type=module','-e',source],{env:process.env,stdio:'inherit',timeout:180000});
process.exitCode=p.status??1;
