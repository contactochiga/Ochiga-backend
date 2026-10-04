import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const prefix=process.argv[2]||'/tmp/iq1-regressions';
const suites=[
  'iq1-truth-safety-smoke',
  'oyi-workflow-action-phase-c-smoke','oyi-workflow-action-phase-c-runtime-smoke',
  'oyi-workflow-action-phase-c-reload-smoke','oyi-workflow-action-phase-c-multigang-smoke',
  'oyi-workflow-action-phase-c-correction-smoke','oyi-workflow-durable-continuation-smoke',
  'device-command-truth-smoke','oyi-security-adversarial-smoke','oyi-security-closure-smoke',
  'oyi-programme4-authority-privacy-closure-smoke','consumer-context-resolution-smoke',
  'wave9-context-authority-smoke','wave9-memory-context-smoke','wave9-conversation-ownership-smoke',
  'wave11-intent-capability-contract-smoke','wave11-terminal-persistence-guard-smoke',
  'wave11-public-opportunity-generalization-smoke',
  'wave10-canonical-fallback-retirement-smoke','wave10-legacy-command-router-guard',
  'wave10-automation-authority-smoke','wave9-slice1-canonical-knowledge-authority-smoke',
  'wave9-capability-inventory',
];
const results=[];
for(const suite of suites){
  const t=Date.now(),out=`${prefix}-${suite}`;
  const p=spawnSync(process.execPath,['scripts/iq1-local-run.mjs','script',out,`scripts/${suite}.mjs`],{encoding:'utf8',timeout:320000});
  const result={suite,status:p.status===0?'PASS':'FAIL',exit:p.status,signal:p.signal,latency_ms:Date.now()-t,stdout:`${out}.stdout`,stderr:`${out}.stderr`};
  results.push(result);fs.writeFileSync(`${prefix}.json`,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(result));
}
process.exit(results.some(r=>r.status!=='PASS')?1:0);
