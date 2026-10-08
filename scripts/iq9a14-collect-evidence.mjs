// Mechanical packaging of already executed/reviewed synthetic evidence; no runtime calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const write=(suffix,data)=>fs.writeFileSync(`artifacts/intelligence-quality-v1-iq9a14-${suffix}.json`,JSON.stringify(data,null,2)+'\n');
const capture='/tmp/iq9a14-close-dev.json';
const current=read(capture),scored=read('artifacts/intelligence-quality-v1-iq9a14-reviewed.json');
assert.equal(scored.capture_sha256,hash(capture));assert.equal(current.records.length,160);assert(!current.records.some(r=>r.error));
write('development-raw',current);
const before=read('artifacts/intelligence-quality-v1-iq9a12-dev-raw.json').records;
const priorScore=read('artifacts/intelligence-quality-v1-iq9a13-full-regrade-scored.json').rows;
const development=current.records.flatMap((r,i)=>r.answer===before[i].answer?[]:[{id:r.id,previously_successful:priorScore.find(s=>s.id===r.id)?.success,before:before[i].answer,after:r.answer,current_verdict:scored.rows[i].verdict,review:scored.rows[i].reason}]);
const controlFile='/tmp/iq9a14-control280.json',candidateFile='/tmp/iq9a14-close280.json';
const control=read(controlFile).records,candidate=read(candidateFile).records;
assert.equal(candidate.length,280);assert.equal(control.length,280);
const preservation=candidate.flatMap((r,i)=>{
  assert.equal(r.journey_id,control[i].journey_id);assert.equal(r.turn_number,control[i].turn_number);assert.equal(r.prompt,control[i].prompt);
  const before=control[i].response,after=r.response;
  if(before.answer===after.answer&&before.capability_key===after.capability_key)return [];
  const id=`${r.journey_id}:${r.turn_number}`;
  const review=id==='IQ-EVAL-OMA-003:5'?'Business-verdict limitation remains; existing project facts are added without ranking.':id==='IQ-EVAL-FAC-006:1'?'Equivalent open water/high-priority record, no truth or scope change.':'Visitor permission-versus-presence caveat added; records, scope and authority unchanged.';
  return [{id,prompt:r.prompt,before:before.answer,after:after.answer,capability_before:before.capability_key,capability_after:after.capability_key,review}];
});
assert.equal(preservation.length,7);assert(preservation.every(x=>x.capability_before===x.capability_after));
write('changed-answers',{development,previously_passing_changed:development.filter(x=>x.previously_successful).map(x=>x.id),frozen280:preservation,reviewer:'Codex separate control/candidate answer review; not a blinded certification panel'});
const latency=rows=>{const v=rows.map(r=>r.latency_ms).sort((a,b)=>a-b);return {mean_ms:v.reduce((a,b)=>a+b,0)/v.length,p50_ms:v[Math.floor(v.length*.5)],p95_ms:v[Math.floor(v.length*.95)],max_ms:v.at(-1)};};
const frozen=['artifacts/intelligence-quality-v1-baseline.json','artifacts/intelligence-quality-v1-failure-map.json','artifacts/intelligence-quality-v1-root-causes.json','scripts/intelligence-quality-v1-corpus.mjs','scripts/intelligence-quality-v1-run.mjs','scripts/intelligence-quality-v1-review.mjs','scripts/wave11-behavioural-torture-harness.mjs','artifacts/intelligence-quality-v1-iq9a-dev-expectations.json','artifacts/intelligence-quality-v1-iq9a-dev-runner.json'];
const frozenManifest=frozen.map(p=>{const base=execFileSync('git',['show',`c73c4c35f3174572bd38ae665d928752983e4ea0:${p}`],{maxBuffer:30000000});assert.equal(hash(p),createHash('sha256').update(base).digest('hex'));return {path:p,sha256:hash(p),unchanged:true};});
const suites='iq9a-invariant-tests iq9a2-closure-tests iq9a4-r0-tests iq9a5-r2-tests iq9a6-r1-tests iq9a7-r3-tests iq9a8-r4-tests iq9a9-r5-tests iq9a10-r6-tests iq9a11-r7-tests iq8-answer-target-tests iq8d2-contract-tests iq8d-projector-tests iq2-objective-smoke iq3a-source-certification iq3a-benchmark-source-tests iq3a-source-local-isolation iq3b-planner-tests iq4-judgment-tests iq5-reference-tests iq5-conversation-tests iq6-reassessment-tests iq6-conversation-tests'.split(' ');
const runtimeFiles=execFileSync('git',['diff','--name-only','c73c4c35f3174572bd38ae665d928752983e4ea0','--','src'],{encoding:'utf8'}).trim().split('\n');
runtimeFiles.push('src/oyi-core/response/disclosureConstraint.ts');
const wave=read('/tmp/iq9a14-closewave11.json').records;
const waveFailed=read('/tmp/iq9a14-releasewave11.json').records;
const tally=rows=>rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});
const lastJson=p=>JSON.parse(fs.readFileSync(p,'utf8').trim().split('\n').at(-1));
const reg=read('/tmp/iq9a14-close-regressions.json');
const validation={generated_at:new Date().toISOString(),recovered_head:'c73c4c35f3174572bd38ae665d928752983e4ea0',reference_checkpoint:'b34b48c17b279278d83b138d1b3b78be2711f49b',branch:'codex/intelligence-quality-v1',runtime_manifest:runtimeFiles.map(p=>({path:p,sha256:hash(p)})),frozen_manifest:frozenManifest,
  development:{sha256:hash(capture),duration_ms:current.duration_ms,items:160,errors:0,executed_device_commands:current.executed_device_commands,summary:scored.summary},
  frozen280:{control_sha256:hash(controlFile),candidate_sha256:hash(candidateFile),control_checkpoint:'c73c4c35f3174572bd38ae665d928752983e4ea0',items:280,identical_answers:273,reviewed_changed_answers:7,persisted:candidate.filter(r=>r.response?.persistence_saved).length,execution_count:candidate.filter(r=>r.response?.execution?.current_turn_execution).length,trace_correlated:candidate.filter(r=>r.trace).length,trace_limitation:'Local OYI_TRACE_REFERENCE_KEY absent; do not claim durable trace correlation',intelligence_rescore:'Not performed; frozen input/output preservation comparison only',control_latency:latency(control),candidate_latency:latency(candidate)},
  wave11:{final:tally(wave),persisted:wave.filter(r=>r.persistence_saved).length,sha256:hash('/tmp/iq9a14-closewave11.json'),earlier_infrastructure_failure:tally(waveFailed),earlier_failure_sha256:hash('/tmp/iq9a14-releasewave11.json'),failure_evidence:'Kong recv() failed (104: Connection reset by peer) while reading upstream PostgREST headers, 2026-10-08 12:41 UTC. No code/config/schema change on retry.'},
  iq7:{parser:read('/tmp/iq9a14-close-iq7-iq7-eval-heldout.json').summary,parser_control:read('/tmp/iq9a14-control-iq7-iq7-eval-heldout.json').summary,e2e:read('/tmp/iq9a14-close-iq7-iq7-e2e-heldout.json').summary,e2e_control:read('/tmp/iq9a14-control-iq7-iq7-e2e-heldout.json').summary},
  r0_r7:read('/tmp/iq9a14-close-r0-r7.json'),focused:lastJson('/tmp/iq9a14-close-focused.stdout'),disclosure:lastJson('/tmp/iq9a14-close-disclosure.stdout'),iq1_cancellation:read('/tmp/iq9a14-closesafety.json'),general_regression:reg,
  supplemental_owned_workflow:read('/tmp/iq9a14-owned-workflow.json'),
  additional_suites:suites.map(s=>({suite:s,observed_launcher_exit:0,stdout_sha256:hash(`/tmp/iq9a14-close-suite-${s}.stdout`),stderr_sha256:hash(`/tmp/iq9a14-close-suite-${s}.stderr`),command:`node scripts/iq1-local-run.mjs script /tmp/iq9a14-close-suite-${s} scripts/${s}.mjs`})),
  final_validation:'Typecheck/build, full development/control-preservation, R0-R7, IQ7, IQ1-IQ6, response, authority/privacy/workflow/device/One-Core, focused disclosure and Wave11 executed on final source. Known original workflow failures retained.',
  decision:'IQ-9A REMEDIATION STILL INCOMPLETE',production_changes:false,merged:false,sealed_iq8f_used:false};
assert.equal(validation.frozen280.persisted,280);assert.equal(validation.frozen280.execution_count,0);
write('validation',validation);console.log(JSON.stringify({development_changes:development.length,previously_passing_changed:development.filter(r=>r.previously_successful).length,frozen280_changes:preservation.length,wave11:validation.wave11.final}));
