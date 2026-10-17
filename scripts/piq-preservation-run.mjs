// Existing targeted suites, unchanged assertions and isolated report destinations.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const prefix=process.env.WAVE11_HARNESS_OUT;
const suites=['iq11b-contracts','iq11b-safety-live','iq11b-additional-live','piq-reconciliation-repair',
 'iq10b-contract-smoke','iq10b-reliability-live','iq10b-trace-export-smoke',
 'iq10c-context-contracts','iq10c-context-live','iq10d-evidence-contracts','iq10d-additional-contracts','iq10d-evidence-live',
 'iq10e-contracts','iq10e-additional','iq10e-live','intelligence-trace-projection-contract-smoke','intelligence-authority-smoke',
 'conversation-foundation-smoke','oyi-core-convergence-smoke'];
const results=[];
for(const suite of suites){
 const out=prefix+'-'+suite,t=Date.now();
 const r=spawnSync(process.execPath,['--import','./scripts/iq10a-artifact-isolation.mjs','scripts/'+suite+'.mjs',out],{env:{...process.env,WAVE11_HARNESS_OUT:out},stdio:['ignore',fs.openSync(out+'.stdout','wx'),fs.openSync(out+'.stderr','wx')],timeout:240000});
 results.push({suite,status:r.status===0?'PASS':'FAIL',exit:r.status,signal:r.signal,elapsed_ms:Date.now()-t,stdout:out+'.stdout',stderr:out+'.stderr'});
 fs.writeFileSync(prefix+'.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));
}
process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
