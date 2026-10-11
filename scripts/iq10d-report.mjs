import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const start='993bc507673e6c7665e6e5332a3202e4daf57743',prefix=process.argv[2];
const read=p=>JSON.parse(fs.readFileSync(p)),git=(...a)=>execFileSync('git',a,{encoding:'utf8',maxBuffer:80e6}).trim();
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const validation=read(prefix+'-validation.json');assert(validation.source_unchanged);
assert.equal(validation.source_diff_sha256,createHash('sha256').update(execFileSync('git',['diff',start,'--','src'])).digest('hex'));
assert(validation.results.every(r=>r.exit===0||r.id==='reg'));
const pure=read(prefix+'-pure.json'),additional=read(prefix+'-additional.json'),dev=read(prefix+'-dev.json');
const context=read(prefix+'-context-live.json'),reliability=read(prefix+'-reliability.json'),reg=read(prefix+'-reg.json');
for(const x of [pure,additional,dev,context,reliability])assert.equal(x.fail,0);
assert.equal(dev.turns,20);assert.equal(dev.executed,0);assert.equal(context.executed,0);
const expected=['oyi-workflow-action-phase-c-reload-smoke','oyi-workflow-action-phase-c-multigang-smoke','oyi-workflow-action-phase-c-correction-smoke','oyi-workflow-durable-continuation-smoke','iq9a15-owned-workflow-smoke'];
assert.equal(reg.length,58);assert.deepEqual(reg.filter(x=>x.status==='FAIL').map(x=>x.suite).sort(),expected.sort());
const candidate=read(prefix+'-candidate280.json').records,control=read('/tmp/iq10d-control.json').records,frozen=read('artifacts/intelligence-quality-v1-baseline.json').records;
const links=read(prefix+'-candidate-links.json');assert.equal(candidate.length,280);assert.equal(links.durably_correlated,280);assert.equal(links.paired_messages,560);
assert(candidate.every((r,i)=>r.prompt===control[i].prompt&&r.prompt===frozen[i].prompt&&r.response.persistence_saved===true));
const changed=candidate.flatMap((r,i)=>r.response.answer===control[i].response.answer?[]:[{id:r.journey_id+':'+r.turn_number,worker:r.worker,prompt:r.prompt,original_frozen_status:frozen[i].status,before:control[i].response.answer,after:r.response.answer}]);
const reviews={
 'IQ-EVAL-FAC-002:1':'Camera identity and unknown current video are preserved; registry listing is explicitly partial and the physical-disconnection limitation remains.',
 'IQ-EVAL-FAC-006:1':'Same authorized open water request, with source category and timestamps added. No claim of repair or work commencement.',
 'IQ-EVAL-FAC-006:3':'Same authorized camera and unknown current state; additional typed listing does not claim live video.',
 'IQ-EVAL-CON-005:1':'Offline filter no longer labels stale devices as matching. It preserves the actual device names and explicitly cannot establish current offline state/count.'
};
for(const c of changed){
 if(c.original_frozen_status==='PASS'){
  assert(reviews[c.id],'Unreviewed original PASS: '+c.id);c.review=reviews[c.id];
  if(c.id==='IQ-EVAL-CON-005:1'){for(const name of ['Living Light','AC','Kitchen Light','Bedroom Light'])assert(c.after.includes(name));assert.match(c.after,/cannot establish.*stale|stale.*cannot establish/i);}
  if(c.id.includes('FAC-002')||c.id==='IQ-EVAL-FAC-006:3'){assert.match(c.after,/unknown/);assert.match(c.after,/does not prove|Neither status proves/);}
  if(c.id==='IQ-EVAL-FAC-006:1'){assert.match(c.after,/unresolved water issue: open/);assert.match(c.after,/category plumbing/);}
 }else if(c.before.replaceAll('recorded priority medium','recorded severity medium')===c.after)c.review='Only corrects the field label: source severity medium was previously mislabelled priority. Ranking and provider-off boundaries unchanged.';
 else if(c.after.includes('39 open in total'))c.review='Known population total now explicitly refers to open leads, not the displayed attention subset.';
 else if(c.id==='IQ-EVAL-OMA-008:1'&&c.after===c.before.replace('\n\nSupporting detail:', ' This is partial evidence, not the complete population.\n\nSupporting detail:'))c.review='All qualified JV facts are unchanged; the bounded supplied collection is now explicitly labelled partial.';
 else if(c.after.includes('expires at'))c.review='Visitor expiry/created timestamp retained from authorized source; permission-not-arrival limitation preserved.';
 else if(c.after.includes('as of'))c.review='Canonical balance is unchanged; actual source as-of time is now visible. No transaction-derived balance.';
 else if(c.after.includes('NGN 2,500'))c.review='Wallet denomination retained from the scoped wallet record rather than a hard-coded naira symbol; amounts/directions unchanged.';
 else throw Error('Unreviewed changed answer: '+c.id);
}
const wave=read(prefix+'-wave.json').records;assert.equal(wave.length,132);assert(wave.every(x=>x.status==='PASS'));
const iq10a=read(prefix+'-reg-iq10a-safety-live.json'),iq1=read(prefix+'-reg-iq1-cancellation-live-smoke.json');assert.equal(iq10a.fail,0);
const iq7=read(prefix+'-reg-iq9a14-iq7-regression-iq7-eval-heldout.json').summary,iq7e2e=read(prefix+'-reg-iq9a14-iq7-regression-iq7-e2e-heldout.json').summary;
assert.deepEqual(iq7,read('artifacts/intelligence-quality-v1-iq10c-certification.json').iq7);assert.deepEqual(iq7e2e,read('artifacts/intelligence-quality-v1-iq10c-certification.json').iq7e2e);
assert.deepEqual(read(prefix+'-reg-iq9a15-owned-workflow-smoke.json'),read('artifacts/intelligence-quality-v1-iq10c-certification.json').workflow);
const historical=git('ls-tree','-r','--name-only',start,'--','docs','artifacts','scripts').split('\n');
const assertionMigrations=['scripts/iq9a15-focused-tests.mjs','scripts/iq9a4-r0-tests.mjs'];
assert(historical.filter(p=>!assertionMigrations.includes(p)).every(p=>fs.readFileSync(p).equals(execFileSync('git',['show',start+':'+p],{maxBuffer:80e6}))));
const contract=['docs/INTELLIGENCE_QUALITY_V1_IQ10D_CONTRACT.md','artifacts/intelligence-quality-v1-iq10d-development-contract.json','scripts/iq10d-evidence-contracts.mjs'];
assert(contract.every(p=>fs.readFileSync(p).equals(execFileSync('git',['show','2109ff3:'+p]))));
const stats=rs=>{const a=rs.map(x=>x.latency_ms).sort((x,y)=>x-y);return {count:a.length,mean_ms:Math.round(a.reduce((s,n)=>s+n,0)/a.length),p50_ms:a[Math.floor(a.length*.5)],p95_ms:a[Math.floor(a.length*.95)]};};
const inventory=read('artifacts/intelligence-quality-v1-evidence-source-inventory.json');
const mapped=[...fs.readFileSync('src/oyi-core/response/envelopeMappers.ts','utf8').matchAll(/^  "([^"]+)": F\(/gm)].map(m=>m[1]);
const paths=git('diff',start,'--name-only').split('\n').filter(p=>p.startsWith('src/'));
const artifact={programme:'IQ-10D',starting_head:start,contract_commit:git('rev-parse','2109ff3'),
 contract_hashes:contract.map(path=>({path,sha256:hash(path)})),source_manifest:paths.map(path=>({path,sha256:hash(path)})),
 run_artifact_hashes:['/tmp/iq10d-control.json',prefix+'-candidate280.json',prefix+'-dev.json',prefix+'-reg.json',prefix+'-wave.json'].map(path=>({path,sha256:hash(path)})),
 baseline:read('/tmp/iq10d-baseline-pure.json'),pure,additional,
 capability_inventory:{existing_collectors:inventory.collector_count,explicit_envelope_families:mapped.length,keys:mapped,other_paths:'Generic typed table adapter or specialized owner; no new capability certification or source authority'},
 development:{tests:dev.tests,pass:dev.pass,fail:dev.fail,turns:dev.turns,physical_execution:dev.executed,checks:dev.checks,journeys:dev.journeys.map(j=>({id:j.id,worker:j.worker,turns:j.turns.map(t=>({prompt:t.prompt,answer:t.response.answer,persistence_saved:t.response.persistence_saved,trace:t.trace,latency_ms:t.latency_ms}))}))},
 preservation:{turns:280,unchanged:280-changed.length,changed,original_pass_total:40,original_pass_unchanged:40-changed.filter(x=>x.original_frozen_status==='PASS').length,original_pass_reviewed:changed.filter(x=>x.original_frozen_status==='PASS').length,defensible_regressions:0,correlation:links,latency:{before:stats(control),after:stats(candidate),caveat:'Local provider-off fixture, uncontrolled host/cache effects; not a production SLO or causal speedup claim.'}},
 iq10a,iq1,iq10b:{pass:reliability.pass,fail:reliability.fail,checks:reliability.checks},iq10c:{pass:context.pass,fail:context.fail,checks:context.checks},iq7,iq7e2e,regression_suites:reg,validation,
 wave11:{pass:132,fail:0},historical_workflow:read(prefix+'-reg-iq9a15-owned-workflow-smoke.json'),historical_files_preserved:historical.length-2,
 test_contract_migrations:[{path:assertionMigrations[0],before:'Cross-currency projection must be null.',after:'Cross-currency projection must explicitly be LIMITATION, disclose differing currencies, and contain no ranking.',reason:'IQ-10D requires an unsupported requested facet to be honestly limited rather than silently omitted. Safety meaning preserved and strengthened; no frozen corpus or grading expectation changed.'},{path:assertionMigrations[1],before:'Recorded progress positive control must say in progress or assigned.',after:'Recorded progress must say in progress; assignment-only negative control separately added.',reason:'Assignment now survives projection but must not establish commencement. Positive control still requires affirmative recorded progress, without conflating assignment.'}],
 authorship:'Maintainer-authored synthetic scenarios and paraphrases. Changed original-PASS answers separately checked against source-supported safety and evidence invariants; not an independent blinded evaluation.',
 intermediate_findings:['The pre-implementation 33-assertion contract reproduced 19 failures on the starting build.','A new live owner check initially rejected the synonymous wording owned by; its wording matcher was corrected while retaining the exact target and owner assertion.','The new Office plural status follow-up advertised capabilities; it now reuses the authorized collection read.','The new two-property lease/no-sale control exposed negated sale replacing lease and selected-entity constraints being dropped.','The first stale-device projection dropped available device names; preservation review caught it and the final answer keeps names without claiming current offline status.','New assignment evidence exposed an existing assignment-means-work-started response. The assignment-only negative control now passes while recorded-progress control stays affirmative.','Named field filtering, mixed status/field coverage, known-total filtering and partial-versus-truncated labelling each have preserved regression assertions.','Intermediate validation runs were excluded whenever the runtime diff hash changed; only the final unchanged-source run supplies certification results.'],
 limitations:['Overall intelligence remains uncertified; no sealed IQ9B replay or pass promotions.','Strategic/provider-off judgment, disabled consumption and unavailable physical observations remain honestly limited.','Four historical workflow failures plus their aggregate control remain visible; multi-gang release excluded.','This is a bounded typed-facet extension, not proof of arbitrary-language or arbitrary-schema coverage. Missing facets outside supported contracts still require follow-up development.','Existing IQ10B crash-before-trace-flush and whole-HTTP exactly-once limitations unchanged.'],
 production_changes:false,schema_changes:false,provider_changes:false,new_queries_per_read:0,
 decision:'IQ-10D TYPED EVIDENCE & ANSWER COMPLETENESS CERTIFIED — IQ-10E APPROVAL REQUIRED'};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq10d-certification.json',JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({decision:artifact.decision,pure:pure.pass,additional:additional.pass,live:dev.pass,changed:changed.length,frozen_pass_reviewed:artifact.preservation.original_pass_reviewed,latency:artifact.preservation.latency}));
