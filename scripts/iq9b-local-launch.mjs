// Reuse the existing fixture/secret/production guards unchanged. Only the
// certification process deadline is longer; no case retry is possible.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
let source=fs.readFileSync('scripts/iq1-local-run.mjs','utf8');
const args="const [mode,output='/tmp/iq1-candidate',...rest]=process.argv.slice(2);";
assert(source.includes(args)&&source.includes('timeout:300000'));
source=source.replace(args,"const [mode,output,...rest]=['script','/tmp/iq9b-first-contact','scripts/iq9b-first-contact.mjs'];").replace('timeout:300000','timeout:1800000');
const p=spawnSync(process.execPath,['--input-type=module','-e',source],{env:process.env,stdio:'inherit',timeout:1810000});
process.exitCode=p.status??1;
