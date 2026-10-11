// Reuse the established sequential validation chain; frozen scripts are unchanged.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const prefix=process.argv[2];if(!prefix?.startsWith('/tmp/iq10e-'))throw Error('Fresh IQ10E prefix required');
let code=fs.readFileSync('scripts/iq10d-validation.mjs','utf8')
 .replaceAll('iq10d-','iq10e-')
 .replace('993bc507673e6c7665e6e5332a3202e4daf57743','6ed093ed914121275c3c89a80c2a20d3a1128622')
 .replace("['pure','iq10e-evidence-contracts']","['pure','iq10e-contracts'],['evidence-pure','iq10d-evidence-contracts']")
 .replace("['additional','iq10e-additional-contracts']","['additional','iq10d-additional-contracts'],['judgment-additional','iq10e-additional']")
 .replace("['dev','iq10e-evidence-live']","['dev','iq10e-live'],['evidence-live','iq10d-evidence-live']")
 .replace('process.argv[2]','process.argv[1]');
const p=spawnSync(process.execPath,['--input-type=module','-e',code,prefix],{env:process.env,stdio:'inherit',timeout:3600000});process.exitCode=p.status??1;
