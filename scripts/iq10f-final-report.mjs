// Final mechanical evidence index; does not grade or execute conversations.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const prefix='artifacts/intelligence-quality-v1-iq10f-';
const read=p=>JSON.parse(fs.readFileSync(prefix+p+'.json'));
const scores=read('scores'),preservation=read('preservation'),review=read('review-integrity');
assert.equal(scores.primary.total,320);assert.equal(scores.rows.length,520);
assert.equal(Object.keys(review.workers).length,4);
const setup=[];
for(const w of ['OMA','OSA','FACILITY','CONSUMER']){
 const a=read('adjudicated-'+w);
 const findings=Array.isArray(a.safety_findings)?a.safety_findings:(a.safety_findings?.findings??[]);
 for(const x of findings)if(x.severity==='P0'&&x.scope==='additional_setup_P0')setup.push({worker:w,...x});
}
assert.equal(setup.length,2);
const hygiene=JSON.parse(execFileSync(process.execPath,['scripts/iq10f-evidence-hygiene.mjs'],{encoding:'utf8'}));
const out={decision:'IQ-10F CERTIFICATION INTEGRITY BLOCKED',runtime:scores.runtime,
 evidence_parent_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),
 independent_quality_results_are_diagnostic:true,primary:scores.primary,workers:scores.by_worker,
 quality_gates:scores.quality_gates,scored_severity:scores.severity,
 additional_setup_P0:setup,total_observed_P0_occurrences:scores.severity.P0+setup.length,
 integrity:{...scores.integrity,
  proven_failed_trace_writes:1,uncorrelated_ownership_rejections:2,
  failed_authorized_conversation_saves_observed:0,
  note:'Two ownership rejections are correctly unsaved and their traces are uncorrelated, not proven absent. One Facility returned/saved turn has a proven failed trace write. No replay/backfill.'},
 preservation:{regressions:preservation.regressions,wave11:preservation.wave11,frozen280:preservation.frozen280,focused:preservation.focused},
 no_runtime_changes:hygiene.runtime_and_existing_files_unchanged,
 frozen_hashes_verified:hygiene.corpus_and_raw_hashes_valid,
 checks:{diff:hygiene.diff_check,secret_patterns:hygiene.changed_artifact_secret_patterns},
 release_allowed:false,production_readiness_assessment_allowed:false,
 recommended_next_action:'Seek separate approval for safety/authority and trace/error-correlation remediation using new development scenarios, followed by a newly authored independent corpus. Do not replay this corpus as fresh certification.',
 files:hygiene.files,
 final_report_sha256:createHash('sha256').update(fs.readFileSync('docs/INTELLIGENCE_QUALITY_V1_IQ10F_CERTIFICATION.md')).digest('hex')};
fs.writeFileSync(prefix+'certification.json',JSON.stringify(out,null,2),{flag:'wx'});
console.log(JSON.stringify({decision:out.decision,primary:out.primary,scored_severity:out.scored_severity,total_observed_P0_occurrences:out.total_observed_P0_occurrences,checks:out.checks,files:out.files.length},null,2));
