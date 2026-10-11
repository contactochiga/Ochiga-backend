import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const code=fs.readFileSync('scripts/iq10d-source-audit.mjs','utf8').replaceAll('993bc507673e6c7665e6e5332a3202e4daf57743','6ed093ed914121275c3c89a80c2a20d3a1128622').replaceAll('iq10d-','iq10e-').replaceAll('IQ10D','IQ10E');
const p=spawnSync(process.execPath,['--input-type=module','-e',code],{stdio:'inherit'});process.exitCode=p.status??1;
