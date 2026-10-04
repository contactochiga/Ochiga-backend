import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const prefix='/tmp/iq3a-source-final';
const raw=read(`${prefix}-iq.json`),before=read('artifacts/intelligence-quality-v1-iq2c-results.json');
assert(raw.completed_at);assert.equal(raw.records.length,280);
for(const [i,r]of raw.records.entries()){assert.equal(r.prompt,before.records[i].prompt);assert.deepEqual(r.envelope,before.records[i].envelope);assert.equal(r.response.answer,before.records[i].answer);assert(r.response.persistence_saved);assert(r.trace?.trace_id);assert.notEqual(r.response.execution?.current_turn_execution,true);}
const tally=(rs,f)=>rs.reduce((a,r)=>(a[f(r)]=(a[f(r)]||0)+1,a),{});
const wave=read(`${prefix}-wave11.json`),safety=read(`${prefix}-safety.json`),objective=read(`${prefix}-objective.json`),regressions=read(`${prefix}-regressions.json`);
assert.deepEqual(tally(wave.records,r=>r.status),{PASS:131,FAIL:1});assert.equal(safety.execution_attempts,0);assert.equal(objective.status,'PASS');assert.equal(regressions.length,23);assert.deepEqual(tally(regressions,r=>r.status),{PASS:19,FAIL:4});
const controls=[];
for(const [name,suite]of [['reload','oyi-workflow-action-phase-c-reload-smoke'],['multigang','oyi-workflow-action-phase-c-multigang-smoke'],['correction','oyi-workflow-action-phase-c-correction-smoke'],['durable','oyi-workflow-durable-continuation-smoke']]){
 const r=regressions.find(x=>x.suite===suite);assert.equal(r.status,'FAIL');const normalize=s=>s.slice(s.indexOf('AssertionError')).replace(/file:\/\/[^\s]+\/scripts\//g,'file://REPO/scripts/');
 const a=fs.readFileSync(`/tmp/iq1-control-${name}.stderr`,'utf8'),b=fs.readFileSync(r.stderr,'utf8');assert(a.includes('AssertionError'));assert(b.includes('AssertionError'));assert.equal(normalize(a),normalize(b));controls.push({suite,identical_control:true});
}
const path='artifacts/intelligence-quality-v1-evidence-certification.json',result=read(path),inventory=read('artifacts/intelligence-quality-v1-evidence-source-inventory.json');
const isolation=read('/tmp/iq3a-source-isolation-final.json');assert.equal(isolation.status,'PASS');assert.equal(isolation.synthetic_rows_removed,3);
result.starting_head='321db68813d8b5585ff5837ecdfff3185b6faec9';
result.validation={iq:{counts:before.after,answer_changes:0,persisted:280,trace_correlated:280,grading:'Prior classifications retained after identical answers and frozen envelope comparison; no new seven-dimension grading.'},wave11:tally(wave.records,r=>r.status),safety,objective:{status:objective.status,parser_cases:objective.parser_cases,turns:objective.turns.length},regressions:{counts:tally(regressions,r=>r.status),controls},isolation};
result.source_hashes=Object.fromEntries(['src/oyi-core/contracts/capability.ts','src/oyi-core/capabilities/CapabilityService.ts','src/oyi-core/capabilities/ReadCapabilityModules.ts','src/oyi-core/capabilities/OfficeCorporateCapabilityModules.ts'].map(p=>[p,hash(p)]));
result.raw_hashes=Object.fromEntries(['iq','wave11','safety','objective','regressions'].map(n=>[`${prefix}-${n}.json`,hash(`${prefix}-${n}.json`)]));
result.certification_counts=tally(inventory.records,r=>r.state);result.readiness_counts=tally(result.readiness,r=>r.status);
fs.writeFileSync(path,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({tests:result.results.length,certification:result.certification_counts,readiness:result.readiness_counts,iq:result.validation.iq.counts,wave11:result.validation.wave11,regressions:result.validation.regressions.counts}));
