// Candidate evidence review, not a new behavioural harness. Never edits the
// frozen corpus, envelopes, baseline, diagnostics, or IQ-1 result.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [rawPath,focusedPath,safetyPath,wavePath,regressionPath]=process.argv.slice(2);
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const tally=(a,key)=>a.reduce((s,r)=>(s[key(r)]=(s[key(r)]||0)+1,s),{});
const old=read('artifacts/intelligence-quality-v1-iq1-results.json');
const frozen=read('artifacts/intelligence-quality-v1-baseline.json');
const map=read('artifacts/intelligence-quality-v1-failure-map.json').records;
const raw=read(rawPath),focused=read(focusedPath),safety=read(safetyPath),wave=read(wavePath),regressions=read(regressionPath);
assert.equal(hash('artifacts/intelligence-quality-v1-baseline.json'),'edd8914212a3661691ebb0046153f8d65b6081c7f5c1e63a4f36e45c0dba667d');
assert.equal(raw.records.length,280);assert(raw.completed_at);
const records=raw.records.map((r,i)=>{
  const before=old.records[i],baseline=frozen.records[i];
  assert.equal(r.prompt,baseline.prompt);assert.equal(r.journey_id,baseline.journey_id);assert.equal(r.turn_number,baseline.turn_number);
  assert.deepEqual(r.envelope,baseline.envelope);assert(r.trace?.trace_id);assert(r.response.persistence_saved);
  assert.notEqual(r.response.execution?.current_turn_execution,true);
  const frame=r.response.execution?.orchestrator_v2?.semantic_frame;
  const objective=r.response.execution?.cognitive_objective||frame?.cognitiveObjective||null;
  const changed=r.response.answer!==before.answer;
  const primary=map.find(m=>m.journey_id===r.journey_id&&m.turn_number===r.turn_number)?.shared_root_cause_id||null;
  const pending=r.response.execution?.assessment_status==='evidence_needed';
  const unresolved=before.status!=='FAIL'?null:!objective?'INTERPRETATION_OR_CONTINUITY':
    objective==='reassess'?'FACT_UPDATE_REASSESSMENT':
    /ranked assessment to identify|Which item should I attach/.test(r.response.answer)?'DERIVED_RESULT_CONTINUITY':
    ['prioritize','compare','explain'].includes(objective)?'JUDGMENT':
    objective==='advise'?'INITIATIVE':'EVIDENCE_SELECTION_OR_COVERAGE';
  // No blanket upgrade from assessment metadata or a polite limitation to
  // full-envelope PASS. The changed FAIL answers still do not supply the
  // requested evidence-specific judgment, context, or next move.
  let reason=changed?(pending?'Objective is recognized, but the generic pending response does not complete the frozen evidence-specific cognitive envelope.':
    'Changed bounded answer reviewed; original evidence selection, judgment, or continuity requirement remains unmet.'):before.review_reason;
  if(before.status==='PASS'&&changed){
    assert.equal(r.journey_id,'IQ-EVAL-OMA-005');assert([3,5].includes(r.turn_number));
    assert.match(r.response.answer,/Which item|more than one match/);
    reason='Safe clarification retained as PASS under the frozen ambiguity allowance: no two-item recommendation was established on turn 2, so an ordinal must not silently bind to the older unranked list. No complete ranking/continuity success is claimed.';
  }
  if(before.status==='BLOCKED')reason='Same frozen fixture limitation; a different reply does not supply the missing fixture evidence.';
  return {journey_id:r.journey_id,turn_number:r.turn_number,worker:r.worker,surface:r.surface,prompt:r.prompt,envelope:r.envelope,
    status:before.status,severity:before.severity,review_reason:reason,prior_scores:before.scores,
    score_note:'Prior evaluator scores retained for provenance, not represented as a new seven-dimension calibration.',
    primary_frozen_root_cause:primary,remaining_primary_boundary:unresolved,
    cognitive_objective:objective,semantic_frame:frame||null,assessment_pending:pending,
    answer:r.response.answer,answer_changed:changed,capability:r.response.capability_key,
    trace:r.trace,persistence_saved:r.response.persistence_saved,workflow:r.response.execution?.workflow,
    current_turn_execution:r.response.execution?.current_turn_execution,latency_ms:r.latency_ms};
});
assert.equal(focused.status,'PASS');assert(safety.results.every(r=>r.status==='PASS'));assert.equal(safety.execution_attempts,0);
const controls={};
for(const [short,suite]of [['reload','oyi-workflow-action-phase-c-reload-smoke'],['multigang','oyi-workflow-action-phase-c-multigang-smoke'],['correction','oyi-workflow-action-phase-c-correction-smoke'],['durable','oyi-workflow-durable-continuation-smoke']]){
 const c=fs.readFileSync(`/tmp/iq1-control-${short}.stderr`,'utf8');
 const run=regressions.find(r=>r.suite===suite);const n=fs.readFileSync(run.stderr,'utf8');
 const normalize=s=>s.slice(s.indexOf('AssertionError')).replace(/file:\/\/[^\s]+\/scripts\//g,'file://REPO/scripts/');
 assert(c.includes('AssertionError'));assert(n.includes('AssertionError'));assert.equal(normalize(c),normalize(n));
 controls[suite]={status:'FAIL',identical_to_control:true,control_head:'45e89d299956fdd041f70f5937dbcc750a35aa6b',assertion:normalize(n)};
}
const groups=Object.fromEntries(['IQRC-004','IQRC-006'].map(id=>{
 const rs=records.filter(r=>r.primary_frozen_root_cause===id);
 return [id,{total:rs.length,whole_envelope:tally(rs,r=>r.status),objective_recorded:rs.filter(r=>r.cognitive_objective).length,
 remaining_boundaries:tally(rs,r=>r.remaining_primary_boundary),members:rs.map(r=>`${r.journey_id}:${r.turn_number}`)}];
}));
assert.equal(groups['IQRC-004'].total,38);assert.equal(groups['IQRC-006'].total,74);
const sources=execFileSync('git',['diff','50151a2','--name-only','--','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const output={version:1,scope:'IQ-2 only',starting_head:'50151a2f6706bc9aebf99513b09f406d48ee8401',
 candidate_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtime_sources:Object.fromEntries(sources.map(p=>[p,hash(p)])),
 raw_sha256:hash(rawPath),raw_path:rawPath,frozen_baseline_sha256:hash('artifacts/intelligence-quality-v1-baseline.json'),
 before:old.after,after:tally(records,r=>r.status),severity:tally(records.filter(r=>r.status==='FAIL'),r=>r.severity),
 by_worker:Object.fromEntries(['OMA','OSA','FAC','CON'].map(w=>[w,tally(records.filter(r=>r.worker===w),r=>r.status)])),
 root_cause_review:groups,changed_answers:records.filter(r=>r.answer_changed).length,
 persisted:records.filter(r=>r.persistence_saved).length,trace_correlated:records.filter(r=>r.trace?.trace_id).length,
 focused,safety,wave11:{totals:tally(wave.records,r=>r.status),failures:wave.records.filter(r=>r.status!=='PASS'),sha256:hash(wavePath)},
 regressions,regression_totals:tally(regressions,r=>r.status),preexisting_controls:controls,
 oma001:records.filter(r=>r.journey_id==='IQ-EVAL-OMA-001'),records,
 decision:'IQ-2 NOT YET CERTIFIED',
 limitations:['Recognition metadata is diagnostic evidence, not proof the objective or answer is correct.',
 'No full-envelope FAIL was promoted merely because the reply became an honest generic limitation.',
 'Remaining-boundary labels are a triage decomposition; they do not prove that adding evidence alone resolves judgment.',
 'Current bounded Facility/Public workers can still supply topic-inadequate answers; objective-specific dispatch requires further IQ-2 review.',
 'No IQ-3 fanout, IQ-4 reasoning provider, production changes, merge, deployment, or frozen expectation edits.']};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq2-results.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({after:output.after,severity:output.severity,by_worker:output.by_worker,roots:groups,changed:output.changed_answers,wave11:output.wave11.totals,regressions:output.regression_totals},null,2));
