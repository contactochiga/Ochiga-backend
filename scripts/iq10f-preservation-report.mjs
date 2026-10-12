import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
const prefix='/tmp/iq10e-iq10f-preservation',runtime='46efdbbae5ad3090c389cf9ddc799f15e00e68e3';
const read=s=>JSON.parse(fs.readFileSync(prefix+'-'+s+'.json'));
const expectedFailures=['oyi-workflow-action-phase-c-reload-smoke','oyi-workflow-action-phase-c-multigang-smoke','oyi-workflow-action-phase-c-correction-smoke','oyi-workflow-durable-continuation-smoke','iq9a15-owned-workflow-smoke'].sort();
const validation=read('validation'),regressions=read('reg'),wave=read('wave'),links=read('candidate-links');
assert(validation.source_unchanged);assert(validation.results.every(x=>x.exit===0||x.id==='reg'));
assert.deepEqual(regressions.filter(x=>x.status!=='PASS').map(x=>x.suite).sort(),expectedFailures);
assert.equal(wave.records.length,132);assert(wave.records.every(x=>x.status==='PASS'));
assert.equal(links.persisted_turns,280);assert.equal(links.durably_correlated,280);assert.equal(links.paired_messages,560);
const baseline=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-baseline.json')).records;
const prior=JSON.parse(fs.readFileSync('/tmp/iq10e-release-candidate280.json')).records,current=read('candidate280').records;
assert.equal(current.length,280);
const deltas=current.flatMap((r,i)=>r.response.answer===prior[i].response.answer?[]:[{journey_id:r.journey_id,turn:r.turn_number,before:prior[i].response.answer,after:r.response.answer}]);
assert.equal(deltas.length,2);assert(deltas.every(x=>x.before.replace(/\(as of [^)]+\)/g,'(as of TIMESTAMP)')===x.after.replace(/\(as of [^)]+\)/g,'(as of TIMESTAMP)')));
const originalPass=baseline.flatMap((r,i)=>r.status==='PASS'?[i]:[]);assert.equal(originalPass.length,40);assert(originalPass.every(i=>current[i].response.answer===prior[i].response.answer));
const tracked=execFileSync('git',['ls-tree','-r','--name-only',runtime],{encoding:'utf8'}).trim().split('\n');
const altered=execFileSync('git',['diff','--name-only',runtime,'--',...['src','supabase','migrations','package.json','package-lock.json']],{encoding:'utf8'}).trim();assert.equal(altered,'');
// Compare every file tracked at runtime HEAD, including existing reports/tests.
const changed=execFileSync('git',['diff','--name-only',runtime],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
assert(changed.every(x=>!tracked.includes(x)),'Previously tracked file changed');
const packageHashes={};
for(const suffix of ['candidate280','wave','reg','validation','reliability','context-live','evidence-live','dev','candidate-links','live-review']){
 const source=prefix+'-'+suffix+'.json',dest='artifacts/intelligence-quality-v1-iq10f-preservation-'+suffix+'.json.gz';
 const data=fs.readFileSync(source);fs.writeFileSync(dest,gzipSync(data),{flag:'wx'});packageHashes[dest]=createHash('sha256').update(data).digest('hex');
}
const suiteEvidence=regressions.map(r=>({...r,stdout_text:fs.readFileSync(r.stdout,'utf8'),stderr_text:fs.readFileSync(r.stderr,'utf8')}));
const evidence=Buffer.from(JSON.stringify(suiteEvidence));const ep='artifacts/intelligence-quality-v1-iq10f-preservation-suite-logs.json.gz';fs.writeFileSync(ep,gzipSync(evidence),{flag:'wx'});packageHashes[ep]=createHash('sha256').update(evidence).digest('hex');
const out={runtime,validation,regression_suites:regressions,regressions:{total:58,pass:53,fail:5,historical_failures:expectedFailures},wave11:{pass:132,fail:0,blocked:0},frozen280:{attempted:280,persisted:280,traced:280,message_rows:560,identical:278,fixture_timestamp_deltas:deltas,original_pass_preserved:40},focused:{IQ10B:read('reliability').pass,IQ10C:read('context-live').pass,IQ10D:read('evidence-live').pass,IQ10E:read('dev').pass,IQ10E_review:read('live-review').pass},previously_tracked_files_preserved:tracked.length,runtime_diff_zero:true,raw_artifact_sha256:packageHashes};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq10f-preservation.json',JSON.stringify(out,null,2),{flag:'wx'});console.log(JSON.stringify({...out,validation:undefined,regression_suites:undefined,raw_artifact_sha256:undefined},null,2));
