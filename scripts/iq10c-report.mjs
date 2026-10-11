import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const start='a80779256d40594539e5300124b6ea7a06561bf7';
const prefix=process.argv[2]||'/tmp/iq10c-final';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:80e6}).trim();
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control=read('/tmp/iq10c-control.json').records,candidate=read(prefix+'-candidate280.json').records;
const frozen=read('artifacts/intelligence-quality-v1-baseline.json').records;
const pure=read(prefix+'-pure.json'),dev=read(prefix+'-dev.json'),reg=read(prefix+'-reg.json');
const reliability=read(prefix+'-reliability.json'),links=read(prefix+'-candidate-links.json');
const wave=read(prefix+'-wave.json').records;
const expectedFailures=['oyi-workflow-action-phase-c-reload-smoke','oyi-workflow-action-phase-c-multigang-smoke','oyi-workflow-action-phase-c-correction-smoke','oyi-workflow-durable-continuation-smoke','iq9a15-owned-workflow-smoke'];
assert.equal(pure.fail,0);assert.equal(dev.fail,0);assert.equal(dev.executed,0);assert.equal(reliability.fail,0);
assert.equal(pure.pass,57);assert.equal(dev.pass,62);assert.equal(dev.journeys.length,6);
assert.equal(dev.journeys.reduce((n,j)=>n+j.turns.length,0),37);assert.equal(dev.extra.length,14);
assert.equal(candidate.length,280);assert.equal(wave.length,132);assert(wave.every(r=>r.status==='PASS'));
assert.equal(reg.length,58);
assert.deepEqual(reg.filter(r=>r.status==='FAIL').map(r=>r.suite).sort(),expectedFailures.sort());
assert(candidate.every((r,i)=>r.prompt===control[i].prompt&&r.prompt===frozen[i].prompt&&r.response.persistence_saved===true&&r.trace?.trace_id));
// Maintainer review of every changed answer, separate from invariant assertions.
// These are preservation judgements, NOT blind grades or overall PASS promotions.
const reviewed=new Map([
 ...[4,5,6,7].map(n=>['IQ-EVAL-OSA-001:'+n,'Preserves the supplied land type instead of inventing an existing building from the generic word property. Retains family ownership with explicit lack of verification. Existing commercial limitation remains.']),
 ...[2,4,6].map(n=>['IQ-EVAL-OSA-004:'+n,'Adds only the caller-supplied personal ownership assertion with unverified provenance. Location correction and missing-evidence boundaries remain intact.']),
 ['IQ-EVAL-OSA-004:7','Corrected Abuja remains current; replaced Lagos is explicitly historical rather than simultaneously active. Personal ownership is caller-supplied, not verified.'],
 ['IQ-EVAL-OSA-005:5','Answers the requested held-details lookup with the current location, corrected area and sale structure instead of a generic acknowledgement. Does not assert an external update or independent verification.'],
 ...[2,5,6,7].map(n=>['IQ-EVAL-OSA-006:'+n,'Preserves stated family ownership, without inferring authority. Missing location/area and absence of a commercial guarantee are unchanged.']),
 ...[5,7].map(n=>['IQ-EVAL-OSA-010:'+n,'Adds the original caller ownership assertion with unverified provenance. Existing missing qualification and handoff limitations remain; no successful callback is claimed.'])
]);
const changed=candidate.flatMap((r,i)=>r.response.answer===control[i].response.answer?[]:[{id:r.journey_id+':'+r.turn_number,worker:r.worker,prompt:r.prompt,frozen_status:frozen[i].status,before:control[i].response.answer,after:r.response.answer,review:reviewed.get(r.journey_id+':'+r.turn_number)}]);
assert.equal(changed.length,15);assert(changed.every(c=>c.review&&c.frozen_status!=='PASS'));
assert.equal(frozen.filter(r=>r.status==='PASS').length,40);
const historic=git('ls-tree','-r','--name-only',start,'--','docs','artifacts','scripts').split('\n');
assert(historic.every(p=>fs.readFileSync(p).equals(execFileSync('git',['show',start+':'+p],{maxBuffer:80e6}))));
const contractFiles=['docs/INTELLIGENCE_QUALITY_V1_IQ10C_DEVELOPMENT_CONTRACT.md','artifacts/intelligence-quality-v1-iq10c-development-contract.json'];
assert(contractFiles.every(p=>fs.readFileSync(p).equals(execFileSync('git',['show','c292eaa:'+p]))));
const iq10a=read(prefix+'-reg-iq10a-safety-live.json'),iq1=read(prefix+'-reg-iq1-cancellation-live-smoke.json');
const iq7=read(prefix+'-reg-iq9a14-iq7-regression-iq7-eval-heldout.json').summary;
const iq7e2e=read(prefix+'-reg-iq9a14-iq7-regression-iq7-e2e-heldout.json').summary;
assert.equal(iq10a.fail,0);assert.equal(iq10a.executed,0);
assert.deepEqual(iq7,read('artifacts/intelligence-quality-v1-iq10b-certification.json').iq7);
assert.deepEqual(iq7e2e,read('artifacts/intelligence-quality-v1-iq10b-certification.json').iq7e2e);
const stats=rs=>{const n=rs.map(r=>r.latency_ms).sort((a,b)=>a-b);return {n:n.length,mean_ms:Math.round(n.reduce((a,b)=>a+b,0)/n.length),p50_ms:n[Math.floor(n.length*.5)],p95_ms:n[Math.floor(n.length*.95)]};};
const changedFiles=git('diff',start,'--name-only').split('\n').filter(Boolean);
const sourceManifest=changedFiles.filter(p=>p.startsWith('src/')).map(path=>({path,sha256:sha(path)}));
const exporter=fs.readFileSync(prefix+'-export.stdout','utf8').split('\n').filter(l=>l.startsWith('PASS ')||l.startsWith('PERF ')||l.startsWith('==='));
assert(exporter.some(l=>l.includes('11 checks passed')));
const artifact={programme:'IQ-10C',starting_head:start,contract_commit:'c292eaa23c26f280bde34e3a813792320e62e3ef',
 authorship:'Pre-implementation maintainer-authored scenarios and paraphrase partition; not independently authored or blinded certification. No sealed IQ9B tuning/replay.',
 contract_hashes:contractFiles.map(path=>({path,sha256:sha(path)})),pure,
 development:{pass:dev.pass,fail:dev.fail,physical_execution_attempts:dev.executed,checks:dev.checks,
  primary_journeys:dev.journeys.length,primary_turns:dev.journeys.reduce((n,j)=>n+j.turns.length,0),
  journeys:dev.journeys.map(j=>({id:j.id,worker:j.worker,surface:j.surface,thread:j.thread,
   turns:j.turns.map((t,i)=>({turn:i+1,prompt:t.prompt,answer:t.response.answer,capability:t.response.execution?.capability_key,
    persistence_saved:t.response.persistence_saved,trace:t.trace,latency_ms:t.latency_ms,
    entity_context:t.metadata.public_opportunity_objective||null,confirmation:t.response.requiresConfirmation||false}))})),
  extra:dev.extra.map(t=>({id:t.id,answer:t.response.answer,persistence_saved:t.response.persistence_saved,confirmation:t.response.requiresConfirmation||false}))},
 frozen280:{executed:280,identical_answers:280-changed.length,changed_answers:changed,frozen_pass_preserved:40,
  no_new_overall_score:true,correlation:links,latency:{control:stats(control),candidate:stats(candidate),caveat:'Local isolated fixture; host/cache uncontrolled, no causal speedup claim.'}},
 regression_suites:reg,iq10a:{pass:iq10a.pass,fail:iq10a.fail,executed:iq10a.executed},iq1,iq7,iq7e2e,
 iq10b:{pass:reliability.pass,fail:reliability.fail,checks:reliability.checks,turns:reliability.captures.length,executed:reliability.executed,trace_export:exporter},
 wave11:{turns:132,pass:132,fail:0},workflow:read(prefix+'-reg-iq9a15-owned-workflow-smoke.json'),historical_files_preserved:{count:historic.length,byte_identical:true},sourceManifest,
 intermediate_findings:[
 'First new harness attempt had a duplicate check binding; harness-only repair.',
 'First pure run exposed targeted correction and candidate-attention objective classification gaps; general rules corrected.',
 'Live review found dropped replacement location, omitted held-fact details and over-restrictive Facility home comparison; corrected in existing owners.',
 'New callback assertion initially misread the negative no callback is confirmed as a positive promise; assertion corrected with rationale; no frozen expectation changed.',
 'First frozen comparison exposed a comparative right operand replacing the current subject; new synthetic regression preserved and corrected.',
 'Broad regressions exposed optional semantic-frame compatibility and legacy object-identity preservation on failed callbacks. Defensive access and no entity-state migration for a failed legacy callback restore the unchanged IQ1 assertions.',
 'A transitional build lacked the final imperative withdrawal guard and failed two new checks; final complete rerun required.',
 'Pending ambiguous correction could override newer explicit facts; latest explicit facts now supersede the pending patch.',
 'Final public-context review found a direct contact-preference path still using the active slot; it now uses shared explicit-entity resolution. A withdrawn first slot cannot become the fallback update target when a live sibling exists.'
 ],
 limitations:[
 'Not overall intelligence or independent certification. No sealed IQ9B improvement score claimed.',
 'Context is limited to eight public entities and fifty result references, with 30-minute expiry. Ambiguous previous/other references clarify rather than invent visit history.',
 'Public entity data is caller-supplied and unverified, not canonical Office data. Property withdrawal is not cancellation of an already submitted external handoff.',
 'Consumer ordinal action continuation may still ask for exact target; it does not assume a read selection is action authority.',
 'Historical workflow/multi-gang failures remain excluded from release claims.',
 'Existing IQ10B forced-process-death trace delivery and whole-HTTP exactly-once limitations remain.',
 'Independent authorship and human review are not manufactured by this maintainer-run development exercise.'
 ],
 production_changes:false,provider_changes:false,schema_changes:false,sealed_iq9b_replayed:false,
 decision:'IQ-10C COMPOSITIONAL CONTEXT CERTIFIED — IQ-10D APPROVAL REQUIRED'};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq10c-certification.json',JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({decision:artifact.decision,pure:pure.pass,development:dev.pass,changed_answers:changed.length,iq10b:reliability.pass,regressions:reg.filter(x=>x.status==='PASS').length,historical_failures:expectedFailures.length,frozen_files:historic.length,latency:artifact.frozen280.latency}));
