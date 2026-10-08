// Mechanical packaging only. No runtime calls, grading heuristics or baseline edits.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root='02ceeeec7bb3e496b2b4ff002ab41ac4180fef58';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const write=(name,data)=>fs.writeFileSync(`artifacts/intelligence-quality-v1-iq9a15-${name}.json`,JSON.stringify(data,null,2)+'\n');
const scored=read('artifacts/intelligence-quality-v1-iq9a15-reviewed.json'),capture='/tmp/iq9a15-safe-dev.json',raw=read(capture);
assert.equal(scored.capture_sha256,hash(capture));assert.equal(raw.records.length,160);assert(!raw.records.some(r=>r.error));
assert.equal(raw.executed_device_commands,0);assert.equal(raw.records[11].truth_state,'permission_restricted');
write('development-raw',raw);
const old=read('artifacts/intelligence-quality-v1-iq9a14-reviewed.json').rows;
const development=scored.rows.flatMap((r,i)=>r.answer===old[i].answer?[]:[{id:r.id,previously_successful:old[i].success,success:r.success,before:old[i].answer,after:r.answer,review:r.reason}]);
assert.equal(development.length,19);assert.equal(development.filter(r=>r.previously_successful).length,3);
assert(development.filter(r=>r.previously_successful).every(r=>r.success));
const before='/tmp/iq9a15-control280.json',after='/tmp/iq9a15-safe280.json',A=read(before).records,B=read(after).records;
assert.equal(A.length,280);assert.equal(B.length,280);
const preservation=A.flatMap((a,i)=>{
 const b=B[i];assert.equal(a.journey_id,b.journey_id);assert.equal(a.turn_number,b.turn_number);assert.equal(a.prompt,b.prompt);
 if(a.response?.answer===b.response?.answer)return [];
 const id=a.journey_id+':'+a.turn_number;
 const review=a.worker==='OSA'?'Canonical title-status requirement now visible; existing supplied facts/corrections and non-binding/no-commitment boundary retained. No document upload or title verification claimed.':id==='IQ-EVAL-OMA-003:5'?'Only recorded progress/sales fields added from the authorized project snapshot; no strategic verdict/ranking. The 280 fixture contains these exact values.':id==='IQ-EVAL-OMA-009:6'||id==='IQ-EVAL-FAC-008:3'?'Explicit private-wallet authority explanation; no private evidence read. Facility terminal result is now permission_restricted.':a.worker==='FAC'?'Existing high-priority detail retained beside recorded open maintenance; scope and unknown-camera caveats unchanged.':'Authorized lead reasons no longer dropped for exceeding 60 characters. Bound/truncation retained; no invented ranking.';
 return [{id,prompt:a.prompt,before:a.response.answer,after:b.response.answer,capability_before:a.response.capability_key,capability_after:b.response.capability_key,review}];
});
assert.equal(preservation.length,35);
write('changed-answers',{review_method:'All 160 final answers freshly reviewed by source-aware maintainer; changed previously passing answers separately checked against frozen expectation. Not blinded independent certification.',development,previously_passing_changed:development.filter(r=>r.previously_successful).map(r=>r.id),frozen280:preservation});
const latency=rows=>{const v=rows.map(r=>r.latency_ms).sort((a,b)=>a-b);return {mean_ms:v.reduce((a,b)=>a+b,0)/v.length,p50_ms:v[Math.floor(v.length*.5)],p95_ms:v[Math.floor(v.length*.95)],max_ms:v.at(-1)};};
const paths=['artifacts/intelligence-quality-v1-baseline.json','artifacts/intelligence-quality-v1-failure-map.json','artifacts/intelligence-quality-v1-root-causes.json','docs/INTELLIGENCE_QUALITY_V1_ROOT_CAUSE_ANALYSIS.md','scripts/intelligence-quality-v1-corpus.mjs','scripts/intelligence-quality-v1-run.mjs','scripts/intelligence-quality-v1-review.mjs','scripts/wave11-behavioural-torture-harness.mjs','artifacts/intelligence-quality-v1-iq9a-dev-expectations.json','artifacts/intelligence-quality-v1-iq9a-dev-runner.json','artifacts/intelligence-quality-v1-iq9a14-reviewed.json','artifacts/intelligence-quality-v1-evidence-source-inventory.json','artifacts/intelligence-quality-v1-iq5-conversation-tests.json','artifacts/intelligence-quality-v1-iq6-conversation-tests.json'];
const frozen=paths.map(path=>{const prior=execFileSync('git',['show',`${root}:${path}`],{maxBuffer:30000000});assert.equal(hash(path),createHash('sha256').update(prior).digest('hex'),path);return {path,sha256:hash(path),unchanged:true};});
const runtimeFiles=execFileSync('git',['diff','--name-only',root,'--','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const wave=read('/tmp/iq9a15-safe-wave11.json').records;
const tally=rows=>rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});
const lastJson=p=>JSON.parse(fs.readFileSync(p,'utf8').trim().split('\n').at(-1));
const reg=read('/tmp/iq9a15-safe-canonical.json'),contracts=read('/tmp/iq9a15-safe-contracts.json');
const r0=read('/tmp/iq9a15-safe-r0-r7.json');assert(r0.every(r=>r.run_exit===0&&r.assert_exit===0));
const cancellation=read('/tmp/iq9a15-safe-cancellation.json');
const iq7parser=read('/tmp/iq9a15-safe-iq7-iq7-eval-heldout.json');
const priorValidation=read('artifacts/intelligence-quality-v1-iq9a14-validation.json');
assert.deepEqual(iq7parser.summary,priorValidation.iq7.parser);
const inventory=read('artifacts/intelligence-quality-v1-iq9a15-failure-inventory.json');
const closure=inventory.groups.map(g=>({...g,fixed:g.ids.filter(id=>scored.rows.find(r=>r.id===id).success),remaining:g.ids.filter(id=>!scored.rows.find(r=>r.id===id).success)}));
const validation={generated_at:new Date().toISOString(),starting_head:root,analysis_commit:'30127dea1628e0b4699c36639497d5673511f8fa',branch:'codex/intelligence-quality-v1',runtime_manifest:runtimeFiles.map(path=>({path,sha256:hash(path)})),frozen_manifest:frozen,
 development:{capture_sha256:hash(capture),items:160,errors:0,executed_device_commands:0,duration_ms:raw.duration_ms,summary:scored.summary,prior_summary:priorValidation.development.summary,original_failure_closure:closure,independent_certification:false},
 frozen280:{control_checkpoint:root,control_sha256:hash(before),candidate_sha256:hash(after),items:280,identical_answers:245,changed_answers:35,changed_capabilities:preservation.filter(r=>r.capability_before!==r.capability_after).map(r=>r.id),persisted:B.filter(r=>r.response?.persistence_saved).length,execution_count:B.filter(r=>r.response?.execution?.current_turn_execution).length,durable_trace_count:B.filter(r=>r.trace).length,trace_limitation:'Local trace reference key absent; no durable-trace certification claimed.',intelligence_rescore:'Not performed. Independent committed-runtime control execution and source-aware answer-preservation review, not a new intelligence score or blinded review.',control_latency:latency(A),candidate_latency:latency(B),performance_note:'Local runs are not a controlled benchmark; descriptive timings only, not a controlled performance benchmark. No added provider calls or source query fan-out.'},
 wave11:{result:tally(wave),persisted:wave.filter(r=>r.persistence_saved).length,sha256:hash('/tmp/iq9a15-safe-wave11.json')},
 iq7:{parser:iq7parser.summary,parser_failures:iq7parser.failures,e2e:read('/tmp/iq9a15-safe-iq7-iq7-e2e-heldout.json').summary,parser_unchanged_from_iq9a14:true},
 boundary:lastJson('/tmp/iq9a15-safe-boundary.stdout'),focused:lastJson('/tmp/iq9a15-safe-focused.stdout'),disclosure:lastJson('/tmp/iq9a15-safe-disclosure.stdout'),cancellation,
 r0_r7:r0,r0_r7_earlier_attempt:read('/tmp/iq9a15-release-r0-r7.json'),infrastructure_note:'R3-S05 and R5-P05 failed persistence thread_summary_update during concurrent load. Kong logs at 2026-10-08 13:24:42 and 13:25:00 UTC show upstream prematurely closed connection. Full unchanged sequential replay passed; no schema, fixture or expectation change to obtain the passing retry. Final safety-precedence guards were separately added and the complete suite passed again.',
 general_regression:reg,contract_regression:contracts,supplemental_owned_workflows:read('/tmp/iq9a15-safe-owned-workflows.json'),multi_gang_release_claim:false,
 decision:'Development score gates met; independent certification approval required. IQ-9A is not certified and multi-gang remains release-excluded.',production_changes:false,merged:false,deployed:false,sealed_iq8f_used:false};
assert.equal(validation.frozen280.persisted,280);assert.equal(validation.frozen280.execution_count,0);assert.equal(validation.wave11.result.PASS,132);
write('validation',validation);
console.log(JSON.stringify({development:scored.summary.overall,closure:closure.map(g=>({id:g.id,fixed:g.fixed.length,remaining:g.remaining.length})),frozen280_changed:preservation.length,wave11:validation.wave11.result}));
