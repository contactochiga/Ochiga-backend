// Diagnostic assertions over executions from the unchanged IQ runner.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [path]=process.argv.slice(2),raw=JSON.parse(fs.readFileSync(path));
const before=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq2b-results.json'));
const frozen=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq2c-closure-corpus.json'));
const includes=(a,v)=>Array.isArray(a)&&a.includes(v);
const checks={
 'OMA-003:6':(s,r)=>s.objective==='assess'&&s.requirement_purpose==='counterfactual'&&/could change|could.*change|which evidence/.test(r.answer),
 'OMA-006:4':s=>s.requirement_purpose==='ownership',
 'OMA-006:5':s=>s.requirement_purpose==='ownership',
 'OMA-008:5':s=>includes(s.subject_domains,'crm')&&!includes(s.subject_domains,'office_financial'),
 'OMA-009:4':s=>includes(s.subject_domains,'office_financial')&&s.subject_domains.length===1,
 'OMA-009:5':s=>includes(s.subject_domains,'office_financial')&&s.subject_domains.length===1,
 'OSA-003:6':(s,r)=>s.requirement_purpose==='privacy'&&/consent\/ownership/.test(r.answer)&&/Do not send/.test(r.answer),
 'OSA-004:7':(s,r)=>/location: Abuja/.test(r.answer)&&!/location: Lagos/.test(r.answer),
 'FAC-005:5':(s,r)=>includes(s.subject_domains,'visitors')&&includes(s.subject_domains,'maintenance')&&/Which items/.test(r.answer),
 'FAC-007:6':(s,r)=>s.requirement_purpose==='safety'&&/authorized operating procedure/.test(r.answer),
 'FAC-008:7':(s,r)=>s.requirement_purpose==='privacy'&&/private contents/.test(r.answer),
 'FAC-010:5':s=>s.subject_label===null,
 'FAC-010:7':s=>s.subject_label===null,
 'CON-003:5':s=>includes(s.subject_domains,'utilities')&&s.pending_information==='The AC was off yesterday.',
 'CON-003:7':s=>includes(s.subject_domains,'utilities'),
 'CON-008:6':(s,r)=>s.subject_label?.toLowerCase()==='study'&&/study/i.test(r.answer)&&!/rooms on record/.test(r.answer),
 'CON-008:7':s=>s.subject_label?.toLowerCase()==='study'&&includes(s.subject_domains,'rooms'),
 'CON-009:7':(s,r)=>s.requirement_purpose==='handoff'&&/submission or follow-up is not confirmed/.test(r.answer),
};
assert.equal(raw.records.length,280);assert(raw.completed_at);
for(let i=0;i<280;i++){const r=raw.records[i],b=before.records[i];assert.equal(r.prompt,b.prompt);assert.deepEqual(r.envelope,b.envelope);assert(r.response.persistence_saved);assert(r.trace?.trace_id);assert.notEqual(r.response.execution?.current_turn_execution,true);}
const closure=frozen.records.map(b=>{
 const r=raw.records.find(r=>r.journey_id===b.journey_id&&r.turn_number===b.turn_number),s=r.response.execution?.assessment_context||{};
 const pass=Boolean(checks[b.id](s,r.response));
 return {...b,after:{status:pass?'PASS':'FAIL',objective:r.response.execution?.cognitive_objective||s.objective,assessment:s,answer:r.response.answer,trace:r.trace,persisted:r.response.persistence_saved}};
});
const tally=(rs,f)=>rs.reduce((a,r)=>(a[f(r)]=(a[f(r)]||0)+1,a),{});
const output={candidate_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 raw_sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex'),raw_path:path,
 totals:tally(closure,r=>r.after.status),closure,
 persisted:280,trace_correlated:280,
 remaining:closure.filter(r=>r.after.status==='FAIL').map(r=>r.id)};
fs.writeFileSync(path.replace(/\.json$/,'-closure.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({totals:output.totals,remaining:output.remaining},null,2));
const [focusedPath,safetyPath,wavePath,regressionPath]=process.argv.slice(3);
if(focusedPath){
 const read=p=>JSON.parse(fs.readFileSync(p)),hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 const focused=read(focusedPath),safety=read(safetyPath),wave=read(wavePath),regressions=read(regressionPath);
 assert.equal(focused.status,'PASS');assert.equal(safety.execution_attempts,0);assert.equal(regressions.length,23);
 const controls={};
 for(const [short,suite]of [['reload','oyi-workflow-action-phase-c-reload-smoke'],['multigang','oyi-workflow-action-phase-c-multigang-smoke'],['correction','oyi-workflow-action-phase-c-correction-smoke'],['durable','oyi-workflow-durable-continuation-smoke']]){
  const run=regressions.find(r=>r.suite===suite);assert.equal(run.status,'FAIL');
  const normalize=s=>s.slice(s.indexOf('AssertionError')).replace(/file:\/\/[^\s]+\/scripts\//g,'file://REPO/scripts/');
  const a=fs.readFileSync(`/tmp/iq1-control-${short}.stderr`,'utf8'),b=fs.readFileSync(run.stderr,'utf8');
  assert(a.includes('AssertionError'));assert(b.includes('AssertionError'));assert.equal(normalize(a),normalize(b));
  controls[suite]={status:'FAIL',identical_to_control:true,control_head:'45e89d299956fdd041f70f5937dbcc750a35aa6b'};
 }
 const promoted={
  'OSA-004:2':'The supplied location correction replaces Lagos with Abuja; it is explicitly unverified and no market eligibility is promised.',
  'OSA-004:7':'Summary contains the corrected Abuja location and supplied 1,800 sqm, with preliminary/non-commitment qualification.',
  'CON-008:5':'The explicit return restores the corrected Study subject, not wallet evidence; additional physical observations are not claimed.',
  'CON-008:6':'The room reference correctly identifies Study from conversation, rather than a raw room list or stale wallet result.',
 };
 const records=raw.records.map((r,i)=>{
  const p=before.records[i],id=r.journey_id.slice(8)+':'+r.turn_number,e=r.response.execution||{},frame=e.orchestrator_v2?.semantic_frame;
  const promotion=promoted[id];
  if(promotion){assert.equal(p.status,'FAIL');assert.match(r.response.answer,id.startsWith('OSA')?/Abuja/:/study/i);}
  return {...p,status:promotion?'PASS':p.status,severity:promotion?null:p.severity,
   review_reason:promotion|| (r.response.answer===p.answer?p.review_reason:'Changed answer manually reviewed. Objective-layer improvement alone is not full-envelope PASS; evidence, judgment or initiative remains incomplete.'),
   answer:r.response.answer,answer_changed:r.response.answer!==p.answer,assessment_context:e.assessment_context||null,
   cognitive_objective:e.cognitive_objective||frame?.cognitiveObjective||null,semantic_frame:frame,
   capability:r.response.capability_key,trace:r.trace,persistence_saved:r.response.persistence_saved,
   workflow:e.workflow||null,current_turn_execution:e.current_turn_execution||false,latency_ms:r.latency_ms};
 });
 // Preserve prior whole-envelope PASS only after checking changed answers.
 assert(records.filter(r=>r.status==='PASS'&&r.answer_changed&&!promoted[r.journey_id.slice(8)+':'+r.turn_number]).length===0,'Review a changed prior PASS before publishing');
 const gaps=before.gaps.map(g=>{
  const r=records.find(r=>r.journey_id.slice(8)+':'+r.turn_number===g.id),closed=closure.find(c=>c.id===g.id);
  const objectivePassed=closed?closed.after.status==='PASS':!g.objective_layer_failure;
  assert(r.cognitive_objective||g.id==='CON-009:6',g.id);
  return {...g,category:objectivePassed?'F':g.category,objective_layer_failure:!objectivePassed,
   reason:closed?`Closure assertion ${closed.after.status}: ${closed.root_cause_description}`:g.reason,
   objective:r.cognitive_objective,assessment:r.assessment_context,answer:r.answer,trace_id:r.trace.trace_id,
   whole_envelope_status:r.status,downstream_only:objectivePassed&&r.status==='FAIL'};
 });
 const rootStats=Object.fromEntries(['IQRC-004','IQRC-006'].map(root=>{const rs=gaps.filter(g=>g.root_cause===root);return[root,{total:rs.length,objective_handled:rs.filter(g=>!g.objective_layer_failure).length,downstream_only:rs.filter(g=>g.downstream_only).length,whole_envelope:tally(rs,r=>r.whole_envelope_status)}];}));
 const catalogue=records.filter(r=>['assess','advise','prioritize','compare','explain','reassess'].includes(r.cognitive_objective)&&/Ask me about any of these|Here is what I can safely help with|office_tasks query read/.test(r.answer));assert.equal(catalogue.length,0);
 const paths=execFileSync('git',['diff','aeed6f6','--name-only','--','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const result={...output,starting_head:'aeed6f69643792b1553b5ac6fd7030dd8ebafd4e',runtime_sources:Object.fromEntries(paths.map(p=>[p,hash(p)])),
  source_artifacts:Object.fromEntries([path,focusedPath,safetyPath,wavePath,regressionPath].map(p=>[p,hash(p)])),
  before:before.after,after:tally(records,r=>r.status),severity:tally(records.filter(r=>r.status==='FAIL'),r=>r.severity),
  by_worker:Object.fromEntries(['OMA','OSA','FAC','CON'].map(w=>[w,tally(records.filter(r=>r.worker===w),r=>r.status)])),
  objective_roots:rootStats,downstream_only:gaps.filter(g=>g.downstream_only).length,assessment_catalogues:catalogue.length,
  focused,safety,wave11:{totals:tally(wave.records,r=>r.status),failures:wave.records.filter(r=>r.status!=='PASS')},
  regressions,regression_totals:tally(regressions,r=>r.status),preexisting_controls:controls,
  oma001:records.filter(r=>r.journey_id==='IQ-EVAL-OMA-001'),gaps,records,
  decision:output.remaining.length?'IQ-2 NOT YET CERTIFIED':'IQ-2 CONVERSATIONAL OBJECTIVE CERTIFIED — IQ-3 APPROVAL REQUIRED',
  grading_note:'Seven-dimension prior_scores are retained historical values, not rescored. Four full-envelope improvements were individually reviewed; objective-layer closure does not claim full intelligence certification.'};
 assert.deepEqual(result.wave11.totals,{PASS:131,FAIL:1});assert.deepEqual(result.regression_totals,{PASS:19,FAIL:4});
 fs.writeFileSync('artifacts/intelligence-quality-v1-iq2c-results.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({after:result.after,severity:result.severity,roots:rootStats,downstream:result.downstream_only,by_worker:result.by_worker,wave11:result.wave11.totals,regressions:result.regression_totals},null,2));
}
process.exit(output.remaining.length?1:0);
