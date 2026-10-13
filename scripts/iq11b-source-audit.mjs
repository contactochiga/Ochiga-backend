// Reuse the established changed-diff hygiene checks with this slice's boundary.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('scripts/iq10d-source-audit.mjs','utf8')
 .replaceAll('993bc507673e6c7665e6e5332a3202e4daf57743','a06004b53c875228fefc9a2424cf5a6ffe5d6439')
 .replaceAll('iq10d','iq11b').replaceAll('IQ10D','IQ11B');
const p=spawnSync(process.execPath,['--input-type=module','-e',source],{stdio:'inherit'});
process.exitCode=p.status??1;
