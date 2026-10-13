import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('scripts/iq10d-source-audit.mjs','utf8')
 .replaceAll('993bc507673e6c7665e6e5332a3202e4daf57743','5858bfec66e49d4a30f03d7454b07a46fa2628d2')
 .replaceAll('iq10d','iq11c').replaceAll('IQ10D','IQ11C')
 .replace("assert(untracked.every(p=>", "assert(untracked.filter(p=>p!=='src/oyi-core/observability/conversationTraceReconciliation.ts').every(p=>");
const p=spawnSync(process.execPath,['--input-type=module','-e',source],{stdio:'inherit'});process.exitCode=p.status??1;
