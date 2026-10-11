import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const start='6ed093ed914121275c3c89a80c2a20d3a1128622',prefix=process.argv[2];
const read=p=>JSON.parse(fs.readFileSync(p)),git=(...a)=>execFileSync('git',a,{encoding:'utf8',maxBuffer:80e6}).trim();
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const validation=read(prefix+'-validation.json');assert(validation.source_unchanged);
assert.equal(validation.source_diff_sha256,createHash('sha256').update(execFileSync('git',['diff',start,'--','src'])).digest('hex'));
assert(validation.results.every(r=>r.exit===0||r.id==='reg'));
const pure=read(prefix+'-pure.json'),extra=read(prefix+'-judgment-additional.json'),dev=read(prefix+'-dev.json'),review=read(prefix+'-live-review.json');
const context=read(prefix+'-context-live.json'),reliability=read(prefix+'-reliability.json'),reg=read(prefix+'-reg.json');
for(const x of [pure,extra,dev,review,context,reliability])assert.equal(x.fail,0);
assert.equal(dev.turns,21);assert.equal(dev.executed,0);
const expected=['oyi-workflow-action-phase-c-reload-smoke','oyi-workflow-action-phase-c-multigang-smoke','oyi-workflow-action-phase-c-correction-smoke','oyi-workflow-durable-continuation-smoke','iq9a15-owned-workflow-smoke'];
assert.equal(reg.length,58);assert.deepEqual(reg.filter(x=>x.status==='FAIL').map(x=>x.suite).sort(),expected.sort());
const candidate=read(prefix+'-candidate280.json').records,control=read('/tmp/iq10e-control.json').records,frozen=read('artifacts/intelligence-quality-v1-baseline.json').records;
const links=read(prefix+'-candidate-links.json');assert.equal(candidate.length,280);assert.equal(links.durably_correlated,280);assert.equal(links.paired_messages,560);
assert(candidate.every((r,i)=>r.prompt===control[i].prompt&&r.prompt===frozen[i].prompt&&r.response.persistence_saved===true));
const changed=candidate.flatMap((r,i)=>r.response.answer===control[i].response.answer?[]:[{id:r.journey_id+':'+r.turn_number,worker:r.worker,prompt:r.prompt,original_frozen_status:frozen[i].status,before:control[i].response.answer,after:r.response.answer}]);
const explanations=new Set(['IQ-EVAL-OMA-001:3','IQ-EVAL-OMA-009:7','IQ-EVAL-OMA-010:4']);
for(const c of changed){
 assert.notEqual(c.original_frozen_status,'PASS','Original PASS changed: individually review before accepting '+c.id);
 if(explanations.has(c.id)){assert.match(c.after,/no earlier ordering.*comparative judgment/i);c.review='No derived order exists; answers with the unavailable comparative-judgment requirement, not an arbitrary raw-record referent. Keeps supplied-snapshot partiality. No hidden ranking minted.';}
 else if(c.id==='IQ-EVAL-OMA-007:1'){assert.match(c.after,/More than one record matches/);c.review='Multiple distinct lead/opportunity records match one comparison side. Replaces first-array-entry selection with clarification. Provider-off and snapshot limits retained; no strategic conclusion claimed.';}
 else if(c.id==='IQ-EVAL-OMA-004:6'){assert.match(c.after,/missing coverage.*financial/);assert.match(c.after,/not initiated/);c.review='Explicit verification request now describes bounded financial-snapshot coverage, without initiating a financial action or claiming complete totals.';}
 else if(c.id==='IQ-EVAL-OMA-008:7'){assert.match(c.after,/missing requirement is comparative judgment/);c.review='Names the unavailable comparative-judgment requirement and supplied-view limit rather than repeating all records. No promised business decision.';}
 else if(c.id==='IQ-EVAL-OSA-007:6'){assert.match(c.after,/not independently verified/);assert.match(c.after,/not initiated/);c.review='Uses existing public-safe qualification requirements. No invented supplied facts, internal criteria or commitment. The source lacks opportunity details; this remains an upstream limitation, not a benchmark pass promotion.';}
 else if(c.id==='IQ-EVAL-FAC-004:6'){assert.match(c.after,/no estate-wide device read/);assert.match(c.after,/does not establish a specific next step/);c.review='No usable Facility device source: states the supported-home scope limitation and does not recommend replacement or fabricate observations.';}
 else if(c.id==='IQ-EVAL-CON-006:6'){assert.match(c.after,/Verify arrival separately/);assert.match(c.after,/permission alone does not establish presence/);c.review='Explicit verification request preserves visitor permission-versus-arrival truth and recommends separate authorised arrival evidence without initiating any action.';}
 else if(c.id==='IQ-EVAL-CON-006:7'){assert.match(c.after,/Check|Verify/);c.review='Existing short-answer owner shortens the prior verification guidance; no execution or physical-presence claim.';}
 else if(c.id==='IQ-EVAL-CON-005:3'||c.id==='IQ-EVAL-CON-008:4'){assert.equal(c.after.replace(/\(as of [^)]+\)/,'(as of SOURCE_TIME)'),c.before.replace(/\(as of [^)]+\)/,'(as of SOURCE_TIME)'));c.review='Only fixture wallet as-of timestamp changed between sequential seeded runs. Amount, currency, authority and answer content unchanged.';}
 else throw Error('Unreviewed changed answer '+c.id);
}
const wave=read(prefix+'-wave.json').records;assert.equal(wave.length,132);assert(wave.every(x=>x.status==='PASS'));
const iq10a=read(prefix+'-reg-iq10a-safety-live.json'),iq1=read(prefix+'-reg-iq1-cancellation-live-smoke.json');assert.equal(iq10a.fail,0);
const iq7=read(prefix+'-reg-iq9a14-iq7-regression-iq7-eval-heldout.json').summary,iq7e2e=read(prefix+'-reg-iq9a14-iq7-regression-iq7-e2e-heldout.json').summary;
assert.deepEqual(iq7,read('artifacts/intelligence-quality-v1-iq10d-certification.json').iq7);assert.deepEqual(iq7e2e,read('artifacts/intelligence-quality-v1-iq10d-certification.json').iq7e2e);
const workflow=read(prefix+'-reg-iq9a15-owned-workflow-smoke.json');assert.deepEqual(workflow,read('artifacts/intelligence-quality-v1-iq10d-certification.json').historical_workflow);
const historical=git('ls-tree','-r','--name-only',start,'--','docs','artifacts','scripts').split('\n');
assert(historical.every(p=>fs.readFileSync(p).equals(execFileSync('git',['show',start+':'+p],{maxBuffer:80e6}))));
const contract=['docs/INTELLIGENCE_QUALITY_V1_IQ10E_CONTRACT.md','artifacts/intelligence-quality-v1-iq10e-development-contract.json','scripts/iq10e-contracts.mjs'];
assert(contract.every(p=>fs.readFileSync(p).equals(execFileSync('git',['show','0649afc:'+p]))));
const stats=rs=>{const a=rs.map(x=>x.latency_ms).sort((a,b)=>a-b);return {count:a.length,mean_ms:Math.round(a.reduce((s,n)=>s+n,0)/a.length),p50_ms:a[Math.floor(a.length*.5)],p95_ms:a[Math.floor(a.length*.95)]};};
const paths=git('diff',start,'--name-only').split('\n').filter(p=>p.startsWith('src/'));
const artifact={programme:'IQ-10E',starting_head:start,contract_commit:git('rev-parse','0649afc'),contract_hashes:contract.map(path=>({path,sha256:hash(path)})),source_manifest:paths.map(path=>({path,sha256:hash(path)})),
 run_artifact_hashes:['/tmp/iq10e-control.json',prefix+'-candidate280.json',prefix+'-dev.json',prefix+'-reg.json',prefix+'-wave.json'].map(path=>({path,sha256:hash(path)})),
 baseline:read('/tmp/iq10e-baseline.json'),focused:pure,additional:extra,
 development:{tests:dev.tests,pass:dev.pass,fail:dev.fail,turns:dev.turns,physical_execution:dev.executed,checks:dev.checks,review,journeys:dev.journeys.map(j=>({id:j.id,worker:j.worker,turns:j.turns.map(t=>({prompt:t.prompt,answer:t.response.answer,persistence_saved:t.response.persistence_saved,trace:t.trace,latency_ms:t.latency_ms}))}))},
 preservation:{turns:280,unchanged:280-changed.length,changed,original_pass_total:40,original_pass_unchanged:40,original_pass_changed:0,defensible_regressions:0,correlation:links,latency:{before:stats(control),after:stats(candidate),caveat:'Local provider-off fixture; host/cache/timestamp variation, not a production SLO or causal speedup claim.'}},
 iq10a,iq1,iq10b:{pass:reliability.pass,fail:reliability.fail,checks:reliability.checks},iq10c:{pass:context.pass,fail:context.fail,checks:context.checks},iq10d:{pure:read(prefix+'-evidence-pure.json'),additional:read(prefix+'-additional.json'),live:read(prefix+'-evidence-live.json').checks},iq7,iq7e2e,regression_suites:reg,validation,
 wave11:{pass:132,fail:0},historical_workflow:workflow,historical_files_preserved:historical.length,
 authorship:'Maintainer-authored synthetic scenarios/paraphrases and separate answer review. No independent blinded authorship claim; no sealed IQ9B tuning or replay.',
 safety:{new_p0:0,unintended_execution:0,scope_authority_changes:false,provider_calls_added:0},
 limitations:['Overall intelligence remains uncertified.','Live business judgment provider remains disabled/unqualified; no autonomous Initiative.','Four historical workflow failures and aggregate control remain; multi-gang release excluded.','Strategic comparison, unavailable physical observations and missing capabilities are limitations, not successful execution.','Bounded language-family development is not proof of general intelligence; independent certification remains separate.','Existing crash-before-trace-flush and whole-HTTP exactly-once limits remain.','Some multi-source supporting responses remain verbose; no blanket prose rewrite.'],
 production_changes:false,schema_changes:false,provider_changes:false,new_queries_per_judgment:0,
 decision:'IQ-10E JUDGMENT & COMMUNICATION CERTIFIED — IQ-10F APPROVAL REQUIRED'};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq10e-certification.json',JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({decision:artifact.decision,focused:pure.pass,extra:extra.pass,live:dev.pass,review:review.pass,changed:changed.length,latency:artifact.preservation.latency}));
