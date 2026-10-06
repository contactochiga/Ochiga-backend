import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const prefix=process.argv[2]||'/tmp/iq3a-closure';
const raw=read(`${prefix}-iq.json`),before=read('artifacts/intelligence-quality-v1-iq2c-results.json');
assert(raw.completed_at);assert.equal(raw.records.length,280);
for(const [i,r]of raw.records.entries()){assert.equal(r.prompt,before.records[i].prompt);assert.deepEqual(r.envelope,before.records[i].envelope);assert.equal(r.response.answer,before.records[i].answer);assert(r.response.persistence_saved);assert(r.trace?.trace_id);assert.notEqual(r.response.execution?.current_turn_execution,true);}
const tally=(rs,f)=>rs.reduce((a,r)=>(a[f(r)]=(a[f(r)]||0)+1,a),{});
const wave=read(`${prefix}-wave11.json`),safety=read(`${prefix}-safety.json`),objective=read(`${prefix}-objective.json`),regressions=read(`${prefix}-regressions.json`);
assert.deepEqual(tally(wave.records,r=>r.status),{PASS:131,FAIL:1});assert.equal(safety.execution_attempts,0);assert.equal(objective.status,'PASS');assert.equal(regressions.length,23);assert.deepEqual(tally(regressions,r=>r.status),{PASS:19,FAIL:4});
const controls=[];
// The four failures are compared with the pre-IQ1 control assertions stored (normalized) in the IQ-1 artifact.
const iq1=read('artifacts/intelligence-quality-v1-iq1-results.json').preexisting_controls;
const normalize=s=>s.slice(s.indexOf('AssertionError')).replace(/file:\/\/[^\s]+\/scripts\//g,'file://REPO/scripts/').trim();
for(const suite of ['oyi-workflow-action-phase-c-reload-smoke','oyi-workflow-action-phase-c-multigang-smoke','oyi-workflow-action-phase-c-correction-smoke','oyi-workflow-durable-continuation-smoke']){
 const r=regressions.find(x=>x.suite===suite);assert.equal(r.status,'FAIL');const stored=iq1[suite];assert(stored&&stored.status==='FAIL'&&stored.control_head==='45e89d299956fdd041f70f5937dbcc750a35aa6b');
 const current=normalize(fs.readFileSync(r.stderr,'utf8'));assert(current.startsWith('AssertionError'));
 const head=stored.assertion.trim().split('\n').slice(0,5).join('\n'),now=current.split('\n').slice(0,5).join('\n');assert.equal(now,head,`${suite}: assertion differs from the stored pre-IQ1 control`);
 controls.push({suite,identical_control:true,control_head:stored.control_head});
}
const path='artifacts/intelligence-quality-v1-evidence-certification.json',result=read(path),inventory=read('artifacts/intelligence-quality-v1-evidence-source-inventory.json');
const isolation=read(process.argv[3]||'/tmp/iq3a-iso.json');assert.equal(isolation.status,'PASS');assert.equal(isolation.synthetic_rows_removed,10);assert.equal(isolation.results.length,3);assert.equal(isolation.benchmark_required_sources.length,6);assert(isolation.benchmark_required_sources.every(r=>r.status==='PASS'));
result.starting_head=process.argv[4]||'00daff730bb4bf188db4fa340779e6d591d21994';
result.validation={iq:{counts:before.after,answer_changes:0,persisted:280,trace_correlated:280,grading:'Prior classifications retained after identical answers and frozen envelope comparison; no new seven-dimension grading.'},wave11:tally(wave.records,r=>r.status),safety,objective:{status:objective.status,parser_cases:objective.parser_cases,turns:objective.turns.length},regressions:{counts:tally(regressions,r=>r.status),controls},isolation};
const sourceFiles=['src/oyi-core/contracts/capability.ts','src/oyi-core/contracts/evidence.ts','src/oyi-core/capabilities/CapabilityService.ts','src/oyi-core/capabilities/ReadCapabilityModules.ts','src/oyi-core/capabilities/OfficeCorporateCapabilityModules.ts','src/oyi-core/capabilities/PublicOpportunityCapabilityModule.ts','src/oyi-core/capabilities/corporateKnowledgeAnswer.ts','src/oyi-core/evidence/EvidenceReadOutcome.ts','src/oyi-core/evidence/PureReadGuard.ts','src/oyi-core/evidence/sources/evidenceFromFact.ts','src/oyi-core/evidence/sources/deviceReads.ts','src/oyi-core/evidence/sources/cameraReads.ts','src/oyi-core/evidence/sources/publicReads.ts','src/oyi-core/domains/devices/deviceEvidence.ts','src/oyi-core/context/publicOpportunityObjective.ts','src/oyi-core/domains/knowledge/knowledgeRetrieval.ts','src/oyi-core/domains/roomHome/homeContributors.ts','src/oyi-core/domains/roomHome/roomContributors.ts','src/oyi-core/domains/roomHome/roomHomeCapabilities.ts'];
result.source_hashes=Object.fromEntries(sourceFiles.map(p=>[p,hash(p)]));
result.raw_hashes=Object.fromEntries(['iq','wave11','safety','objective','regressions'].map(n=>[`${prefix}-${n}.json`,hash(`${prefix}-${n}.json`)]));
result.certification_counts=tally(inventory.records,r=>r.state);result.readiness_counts={PLANNER_READY_COMPLETE:0,PLANNER_READY_PARTIAL:0,MISSING_CAPABILITY_PRODUCT_DEBT:0,SOURCE_CONTRACT_BLOCKED:0,DOWNSTREAM_NOT_IQ3:0,...tally(result.readiness,r=>r.status)};
assert.equal(result.readiness.length,133);
const bench=read('artifacts/intelligence-quality-v1-iq3a-benchmark-source-tests.json');assert.equal(bench.status,'PASS');
result.validation.benchmark_source_tests={counts:bench.counts,total:bench.results.length,matrix_rows:bench.surface_scope_matrix.length};
const gates={sourceContractBlocked:result.readiness_counts.SOURCE_CONTRACT_BLOCKED===0,sourceTestsPass:result.results.every(r=>r.status==='PASS'),benchTestsPass:bench.results.every(r=>r.status==='PASS'),iqAnswersAndEnvelopesIdentical280:true,wave11:JSON.stringify(result.validation.wave11)===JSON.stringify({PASS:131,FAIL:1}),regressions:JSON.stringify(result.validation.regressions.counts)===JSON.stringify({PASS:19,FAIL:4}),isolation:isolation.status==='PASS',benchmarkSources:result.benchmark_required_sources.length===9};
result.certification_gates=gates;
result.status=Object.values(gates).every(Boolean)?'IQ-3A EVIDENCE CONTRACT CERTIFIED — IQ-3B APPROVAL REQUIRED':'IQ-3A NOT YET CERTIFIED';
fs.writeFileSync(path,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,gates:result.certification_gates,tests:result.results.length,certification:result.certification_counts,readiness:result.readiness_counts,iq:result.validation.iq.counts,wave11:result.validation.wave11,regressions:result.validation.regressions.counts}));
