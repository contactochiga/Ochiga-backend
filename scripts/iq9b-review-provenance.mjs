// Retain completed review roles and the exact independent inputs/outputs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base='artifacts/intelligence-quality-v1-iq9b',hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const roles=[];
for(const worker of ['Oma','Osa','Facility','Consumer']){
 for(const suffix of ['A','B','adjudicator']){
  const output=suffix==='adjudicator'?`${base}-adjudicated-${worker}.json`:`${base}-grade-${worker}-${suffix}.json`;
  const g=JSON.parse(fs.readFileSync(output));
  assert.equal(g.exposure.prior_source_or_results_exposure,false);
  const agent=suffix==='adjudicator'?`/root/iq9b_adjudicate_${worker.toLowerCase()}`:`/root/iq9b_grade_${worker.toLowerCase()}_${suffix.toLowerCase()}`;
  const outputFiles=[{path:output,sha256:hash(output)}];
  const expansion=`${base}-adjudicated-${worker}-expanded.json`;
  if(suffix==='adjudicator'&&fs.existsSync(expansion))outputFiles.push({path:expansion,sha256:hash(expansion)});
  roles.push({worker,role:suffix,agent,fork_turns:'none',output_files:outputFiles,reviewed:outputFiles.reduce((n,f)=>n+JSON.parse(fs.readFileSync(f.path)).grades.length,0),exposure:g.exposure});
 }
}
fs.writeFileSync(`${base}-review-provenance.json`,JSON.stringify({roles,coordinator_graded:false,blinding:'Fresh role contexts and explicit read allowlists; shared filesystem and model family. Not OS-sandbox, cross-model or human-panel independence.',diagnostic_supplement:{path:`${base}-capture-diagnostics.json`,sha256:hash(`${base}-capture-diagnostics.json`)},previous_verdicts_supplied_to_adjudicators:false},null,2)+'\n');
console.log('Recorded 8 independent graders and 4 independent adjudicators.');
