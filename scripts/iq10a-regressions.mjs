// Sequential fixture use. Existing assertions unchanged; old report writes redirected.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const prefix=process.env.WAVE11_HARNESS_OUT;
const suiteNames=file=>[...fs.readFileSync(file,'utf8').match(/const suites=\[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
const suites=[...new Set([...suiteNames('scripts/iq9a15-regression-run.mjs'),...suiteNames('scripts/iq1-regression-run.mjs'),
 'iq10a-invariants','iq10a-safety-live','iq9a14-remediation-tests','iq9a14-disclosure-live','iq9a15-focused-tests','iq9a15-boundary-live','iq9a15-owned-workflow-smoke','iq9a14-iq7-regression','iq1-cancellation-live-smoke'])];
const results=[];
for(const suite of suites){
 const out=`${prefix}-${suite}`,t=Date.now();
 const p=spawnSync(process.execPath,['--import','./scripts/iq10a-artifact-isolation.mjs',`scripts/${suite}.mjs`,out],{env:{...process.env,WAVE11_HARNESS_OUT:out},stdio:['ignore',fs.openSync(out+'.stdout','wx'),fs.openSync(out+'.stderr','wx')],timeout:240000});
 results.push({suite,status:p.status===0?'PASS':'FAIL',exit:p.status,signal:p.signal,latency_ms:Date.now()-t,stdout:out+'.stdout',stderr:out+'.stderr'});
 fs.writeFileSync(prefix+'.json',JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(results.at(-1)));
}
process.exitCode=results.some(x=>x.status!=='PASS')?1:0;
