import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
let source=fs.readFileSync('scripts/iq9a15-control280.mjs','utf8');
const old="const checkpoint='02ceeeec7bb3e496b2b4ff002ab41ac4180fef58';";
assert(source.includes(old));
source=source.replace(old,"const checkpoint='9dd062e8fea069afb40e5c99c0946318c16fd71b';");
const p=spawnSync(process.execPath,['--input-type=module','-e',source],{env:process.env,stdio:'inherit',timeout:240000});
process.exitCode=p.status??1;
