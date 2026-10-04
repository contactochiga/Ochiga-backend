// Post-run evidence review only. Uses the unchanged canonical IQ/Wave 11
// runners and frozen envelopes; this is neither a second harness nor a grader
// that promotes a turn merely because objective metadata exists.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [rawPath,focusedPath,safetyPath,wavePath,regressionPath]=process.argv.slice(2);
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const tally=(rs,f)=>rs.reduce((a,r)=>(a[f(r)]=(a[f(r)]||0)+1,a),{});
const prior=read('artifacts/intelligence-quality-v1-iq2-results.json');
const frozen=read('artifacts/intelligence-quality-v1-baseline.json');
const before=read('artifacts/intelligence-quality-v1-iq2b-prefixed-gap-map.json');
const raw=read(rawPath),focused=read(focusedPath),safety=read(safetyPath),wave=read(wavePath),regressions=read(regressionPath);
assert.equal(hash('artifacts/intelligence-quality-v1-baseline.json'),'edd8914212a3661691ebb0046153f8d65b6081c7f5c1e63a4f36e45c0dba667d');
assert.equal(raw.records.length,280);assert(raw.completed_at);
// Manual semantic review of the complete observed 112-turn subset. Retain
// genuine objective/subject failures, even when a non-null objective exists.
const remaining={
 'OMA-003:6':['B','A counterfactual evidence question is represented as current reassessment; the missing-evidence answer does not retain what would change the view.'],
 'OMA-008:5':['C','The financing constraint displaces the reply/draft subject; send-advice concerns financial position rather than the current reply.'],
 'FAC-005:5':['C','Comparison names maintenance but loses its visitor operand. A one-sided subject is not a complete comparison requirement.'],
 'FAC-010:5':['C','The earlier Tower B label remains after an explicit estate-wide switch. Scope label and actual estate scope disagree.'],
 'FAC-010:7':['C','Handover retains the obsolete Tower B label rather than the explicitly restored estate-wide subject.'],
 'OMA-009:4':['D','The intervening attempted commitment cleared the read-only funding assessment; authority follow-up broadens to generic business scope.'],
 'OMA-009:5':['D','The safe-next-step follow-up inherits the broadened scope rather than the funding assessment.'],
 'OSA-004:7':['D','Summary uses the opportunity context but the supplied Lagos-to-Abuja correction is still absent; correction continuity is not complete.'],
 'CON-003:5':['D','After wallet retrieval, the user AC assertion is attached to devices without restoring the utility-causality question.'],
 'CON-003:7':['D','Measurement advice inherits device scope, losing the utility-usage assessment after the domain switch.'],
 'CON-008:6':['D','Safe clarification now prevents a stale room-list answer, but the corrected Study reference was not recovered after wallet retrieval.'],
 'CON-008:7':['D','The sensor question has room/device requirements but the previously supplied corrected room subject is still missing.'],
 'OMA-006:4':['E','Business domains are named, but the requirement does not identify authoritative work-assignment/ownership evidence.'],
 'OMA-006:5':['E','The epistemic constraint is recognized, but its evidence need remains generic business evidence instead of verified ownership.'],
 'OSA-003:6':['E','Opportunity evidence does not answer the specific third-party document-consent/privacy requirement.'],
 'FAC-007:6':['E','Prohibited-attempt advice is recognized, but generic operational evidence does not express the relevant safety/procedure requirement.'],
 'FAC-008:7':['E','Privacy-preserving next-step advice lists operational evidence without the privacy-specific requirement.'],
 'CON-009:7':['E','Raising a safe concern is recognized as advice, but generic home evidence does not identify the reporting/handoff requirement.'],
};
const records=raw.records.map((r,i)=>{
 const p=prior.records[i],f=frozen.records[i];
 assert.equal(r.prompt,f.prompt);assert.equal(r.journey_id,f.journey_id);assert.equal(r.turn_number,f.turn_number);assert.deepEqual(r.envelope,f.envelope);
 assert(r.response.persistence_saved);assert(r.trace?.trace_id);assert.notEqual(r.response.execution?.current_turn_execution,true);
 const e=r.response.execution||{},frame=e.orchestrator_v2?.semantic_frame||null;
 const id=r.journey_id.slice(8)+':'+r.turn_number;
 let status=p.status,reason=r.response.answer===p.answer?p.review_reason:'Reviewed changed answer: the frozen evidence/judgment/context envelope is still unmet; recognition alone is not PASS.';
 // Explicit capability discovery is not an assessment or an advertising leak.
 if(id==='CON-009:6'){
  assert.equal(r.response.capability_key,'global.capabilities.read');
  assert.match(r.response.answer,/authorised for your home/);
  status='PASS';reason='The user explicitly asks what can be accessed in their own home. Scoped capability discovery is responsive and does not disclose another resident’s records.';
 } else if(status==='PASS') reason='Existing PASS reviewed and preserved; no authority or action-execution regression observed.';
 else if(status==='BLOCKED') reason='Frozen fixture limitation remains; a changed response does not provide missing fixture evidence.';
 return {...p,status,severity:status==='FAIL'?p.severity:null,review_reason:reason,
  cognitive_objective:e.cognitive_objective||frame?.cognitiveObjective||null,semantic_frame:frame,
  assessment_context:e.assessment_context||null,answer:r.response.answer,answer_changed:r.response.answer!==p.answer,
  capability:r.response.capability_key,trace:r.trace,persistence_saved:r.response.persistence_saved,
  workflow:e.workflow||null,current_turn_execution:e.current_turn_execution||false,latency_ms:r.latency_ms};
});
const gaps=before.records.map(b=>{
 const r=records.find(r=>r.journey_id===b.journey_id&&r.turn_number===b.turn_number);
 const exception=remaining[b.id];
 const category=exception?.[0]||'F';
 const reason=exception?.[1]|| (r.cognitive_objective==='retrieve'
  ?'The retrieval job and domain are now correct; result filtering/composition still fails the full envelope, not objective recognition.'
  :!r.cognitive_objective
   ?'Explicit own-scope capability discovery is correctly handled, not an assessment question.'
   :'Job and subject are recognized; current scoped evidence/limitations or unestablished-target clarification are honest. The remaining envelope needs evidence execution/selection, judgment, derived results, or reassessment, not a capability catalogue.');
 assert(r.cognitive_objective||b.id==='CON-009:6',b.id);
 return {id:b.id,root_cause:b.root_cause,worker:r.worker,prompt:r.prompt,envelope:r.envelope,
  before_category:b.category,category,reason,objective_layer_failure:category!=='F',
  whole_envelope_status:r.status,objective:r.cognitive_objective,subject:r.assessment_context?.subject_domains||r.semantic_frame?.domain,
  assessment:r.assessment_context,answer:r.answer,trace_id:r.trace.trace_id,
  downstream_only:category==='F'&&r.status==='FAIL'};
});
const controls={};
for(const [short,suite]of [['reload','oyi-workflow-action-phase-c-reload-smoke'],['multigang','oyi-workflow-action-phase-c-multigang-smoke'],['correction','oyi-workflow-action-phase-c-correction-smoke'],['durable','oyi-workflow-durable-continuation-smoke']]){
 const run=regressions.find(r=>r.suite===suite);assert.equal(run.status,'FAIL');
 const normalize=s=>s.slice(s.indexOf('AssertionError')).replace(/file:\/\/[^\s]+\/scripts\//g,'file://REPO/scripts/');
 const a=fs.readFileSync(`/tmp/iq1-control-${short}.stderr`,'utf8'),b=fs.readFileSync(run.stderr,'utf8');
 assert(a.includes('AssertionError'));assert(b.includes('AssertionError'));assert.equal(normalize(a),normalize(b));
 controls[suite]={status:'FAIL',identical_to_control:true,control_head:'45e89d299956fdd041f70f5937dbcc750a35aa6b',assertion:normalize(b)};
}
const roots=Object.fromEntries(['IQRC-004','IQRC-006'].map(root=>{
 const rs=gaps.filter(r=>r.root_cause===root);
 return [root,{total:rs.length,before:before.by_root[root],after:tally(rs,r=>r.category),
  objective_recorded:rs.filter(r=>r.objective).length,objective_layer_handled:rs.filter(r=>r.category==='F').length,
  downstream_only:rs.filter(r=>r.downstream_only).length,whole_envelope:tally(rs,r=>r.whole_envelope_status)}];
}));
const paths=execFileSync('git',['diff','74b892f','--name-only','--','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const output={version:1,starting_head:'74b892f73a4dacf6332900462994c1cac38b09a8',
 candidate_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtime_sources:Object.fromEntries(paths.map(p=>[p,hash(p)])),
 source_artifacts:Object.fromEntries([rawPath,focusedPath,safetyPath,wavePath,regressionPath].map(p=>[p,hash(p)])),
 frozen_baseline_sha256:hash('artifacts/intelligence-quality-v1-baseline.json'),before:prior.after,after:tally(records,r=>r.status),
 severity:tally(records.filter(r=>r.status==='FAIL'),r=>r.severity),
 by_worker:Object.fromEntries(['OMA','OSA','FAC','CON'].map(w=>[w,tally(records.filter(r=>r.worker===w),r=>r.status)])),
 gap_before:before.counts,gap_after:tally(gaps,r=>r.category),root_cause_review:roots,
 downstream_only:gaps.filter(r=>r.downstream_only).length,objective_layer_failures:gaps.filter(r=>r.objective_layer_failure).length,
 persisted:records.filter(r=>r.persistence_saved).length,trace_correlated:records.filter(r=>r.trace?.trace_id).length,
 focused,safety,wave11:{totals:tally(wave.records,r=>r.status),failures:wave.records.filter(r=>r.status!=='PASS')},
 regressions,regression_totals:tally(regressions,r=>r.status),preexisting_controls:controls,
 oma001:records.filter(r=>r.journey_id==='IQ-EVAL-OMA-001'),gaps,records,
 decision:'IQ-2 NOT YET CERTIFIED',
 limitations:['18 objective-layer deficiencies remain under conservative per-turn semantic review; they are not relabelled as IQ-3 failures.',
 'Original evaluator dimension scores are retained as prior_scores only, not claimed to have been rescored.',
 'Whole-envelope FAIL is not promoted for recognizing a job or naming evidence requirements.',
 'No new evidence fanout, ranking, provider calls, production changes, merge or deployment.']};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq2b-results.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({candidate:output.candidate_head,after:output.after,severity:output.severity,roots,gaps:output.gap_after,downstream:output.downstream_only,workers:output.by_worker,wave11:output.wave11.totals,regressions:output.regression_totals},null,2));
