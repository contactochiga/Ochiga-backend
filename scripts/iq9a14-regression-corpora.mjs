// Reuses the existing capture/assertion contracts. Only output locations change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const prefix=process.env.WAVE11_HARNESS_OUT;
const cases=[['iq9a2-closure','iq9a2'],['iq9a4-r0','iq9a4-r0'],['iq9a5-r2','iq9a5-r2'],['iq9a6-r1','iq9a6-r1'],['iq9a7-r3','iq9a7-r3'],['iq9a8-r4','iq9a8-r4'],['iq9a9-r5','iq9a9-r5'],['iq9a10-r6','iq9a10-r6'],['iq9a11-r7','iq9a11-r7'],['iq9a12-r7-closure','iq9a12-r7-closure']];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iq9a14-regressions-'));
const results=[];
for(const [name,test] of cases){
  const corpus=`artifacts/intelligence-quality-v1-${name}-corpus.json`,out=`${prefix}-${name}.json`,cfg=path.join(dir,`${name}.json`);
  assert(!fs.existsSync(out));fs.writeFileSync(cfg,JSON.stringify({corpus,out}));
  const run=spawnSync(process.execPath,['scripts/iq8f-run.mjs'],{env:{...process.env,IQ8F_CONFIG:cfg},stdio:['ignore',fs.openSync(`${out}.stdout`,'wx'),fs.openSync(`${out}.stderr`,'wx')],timeout:120000});
  const check=run.status===0?spawnSync(process.execPath,[`scripts/${test}-e2e-assert.mjs`,out],{encoding:'utf8',timeout:10000}):null;
  results.push({suite:name,run_exit:run.status,assert_exit:check?.status??null,assert_output:(check?.stdout||'')+(check?.stderr||'')});
}
fs.writeFileSync(`${prefix}.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(({assert_output,...r})=>r)));
process.exitCode=results.some(r=>r.run_exit!==0||r.assert_exit!==0)?1:0;
