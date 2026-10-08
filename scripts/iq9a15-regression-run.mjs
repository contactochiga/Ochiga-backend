// Re-run existing assertions unchanged, with outputs isolated from frozen evidence.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const prefix=process.argv[2];
if(!prefix || !prefix.startsWith('/tmp/'))throw new Error('Use a unique /tmp output prefix');
const suites=['iq9a-invariant-tests','iq9a2-closure-tests','iq9a4-r0-tests','iq9a5-r2-tests','iq9a6-r1-tests','iq9a7-r3-tests','iq9a8-r4-tests','iq9a9-r5-tests','iq9a10-r6-tests','iq9a11-r7-tests','iq8-answer-target-tests','iq8b-bridge-tests','iq8b-metamorphic-tests','iq8d2-contract-tests','iq8d-projector-tests','iq8e-routing-tests','iq2-objective-smoke','iq3a-source-certification','iq3a-benchmark-source-tests','iq3a-source-local-isolation','iq3b-planner-tests','iq4-judgment-tests','iq5-reference-tests','iq5-conversation-tests','iq6-reassessment-tests','iq6-conversation-tests'];
const results=[];
for(const suite of suites){
 const t=Date.now(),out=`${prefix}-${suite}`;
 const p=spawnSync(process.execPath,['scripts/iq1-local-run.mjs','script',out,`scripts/${suite}.mjs`],{encoding:'utf8',timeout:320000});
 results.push({suite,status:p.status===0?'PASS':'FAIL',exit:p.status,signal:p.signal,latency_ms:Date.now()-t,stdout:`${out}.stdout`,stderr:`${out}.stderr`});
 fs.writeFileSync(`${prefix}.json`,JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(results.at(-1)));
}
process.exitCode=results.some(r=>r.status!=='PASS')?1:0;
