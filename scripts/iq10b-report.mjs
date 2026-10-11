import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const prefix=process.argv[2]||'/tmp/iq10b-certified';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const control=read('/tmp/iq10b-control.json').records,candidate=read(prefix+'280.json').records;
const safety=read(prefix+'-safety.json'),schema=read(prefix+'-schema.json'),links=read(prefix+'-links.json');
const regressions=read(prefix+'-reg.json'),wave=read(prefix+'-wave.json').records;
const iq1=read(prefix+'-reg-iq1-cancellation-live-smoke.json');
const iq7=read(prefix+'-reg-iq9a14-iq7-regression-iq7-eval-heldout.json');
const iq7e2e=read(prefix+'-reg-iq9a14-iq7-regression-iq7-e2e-heldout.json');
const iq10a=read(prefix+'-reg-iq10a-safety-live.json');
const workflow=read(prefix+'-reg-iq9a15-owned-workflow-smoke.json');
const changed=candidate.flatMap((r,i)=>r.response?.answer===control[i].response?.answer?[]:[{id:r.journey_id+':'+r.turn_number,before:control[i].response?.answer,after:r.response?.answer}]);
const expectedFailures=['oyi-workflow-action-phase-c-reload-smoke','oyi-workflow-action-phase-c-multigang-smoke','oyi-workflow-action-phase-c-correction-smoke','oyi-workflow-durable-continuation-smoke','iq9a15-owned-workflow-smoke'];
assert.equal(candidate.length,280);assert.equal(changed.length,0);assert(candidate.every(r=>r.response?.persistence_saved===true&&r.trace?.trace_id));
assert.equal(safety.fail,0);assert.equal(iq10a.fail,0);assert.equal(wave.length,132);assert(wave.every(r=>r.status==='PASS'));
assert.deepEqual(regressions.filter(r=>r.status==='FAIL').map(r=>r.suite).sort(),expectedFailures.sort());
const stats=rows=>{const n=rows.map(r=>r.latency_ms).sort((a,b)=>a-b);return {n:n.length,mean_ms:Math.round(n.reduce((a,b)=>a+b,0)/n.length),p50_ms:n[Math.floor(n.length*.5)],p95_ms:n[Math.floor(n.length*.95)]};};
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:50e6}).trim();
const frozen=git('ls-tree','-r','--name-only','9dd062e8fea069afb40e5c99c0946318c16fd71b','--','docs','artifacts','scripts').split('\n');
assert(frozen.every(p=>fs.readFileSync(p).equals(execFileSync('git',['show','9dd062e8fea069afb40e5c99c0946318c16fd71b:'+p],{maxBuffer:50e6}))));
const files=[...new Set([...git('diff','--name-only').split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')])].filter(Boolean);
const sourceManifest=files.filter(p=>p.startsWith('src/')||p.startsWith('supabase/')).map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')}));
const exporter=fs.readFileSync(prefix+'-export.stdout','utf8').split('\n').filter(l=>l.startsWith('PASS ')||l.startsWith('PERF ')||l.startsWith('==='));
assert(exporter.some(l=>l.includes('11 checks passed')));
const artifact={programme:'IQ-10B',starting_head:'9dd062e8fea069afb40e5c99c0946318c16fd71b',baseline_commit:'bf58119',schema,
 safety:{checks:safety.checks,turns:safety.captures.length,pass:safety.pass,fail:safety.fail,physical_execution_attempts:safety.executed,
  captures:safety.captures.map(c=>({request_id:c.id,prompt:c.message,answer:c.response.answer,persistence_saved:c.response.persistence_saved,
   persistence_warning:c.response.persistence_warning||null,receipt:c.response.execution?.durable_trace,trace:c.trace,trace_error:c.trace_error}))},
 correlation:links,frozen280:{turns:280,persisted:280,traced:280,identical_answers:280,changed_answers:changed,latency:{control:stats(control),candidate:stats(candidate),caveat:'Local observation; cache/host load uncontrolled; runner includes trace flush.'}},
 wave11:{turns:132,pass:132,fail:0},regressions,iq1,iq7:iq7.summary,iq7e2e:iq7e2e.summary,iq10a:{pass:iq10a.pass,fail:iq10a.fail,physical_execution_attempts:iq10a.executed},workflow,
 trace_export_checks:exporter,frozen_files:{count:frozen.length,unchanged:true},sourceManifest,
 intermediate_failures:[{run:'/tmp/iq10b-regressions',suite:'iq2-objective-smoke',reason:'Socket closure during context load/save; correctly unsaved; retained, rerun without changing assertions.'},{run:'/tmp/iq10b-finalreg',suite:'iq3a-source-local-isolation',reason:'Synthetic cleanup transport failure; nine exact synthetic rows removed through local SQL; full rerun clean.'}],
 legacy_guard_adaptations:{original_files_unchanged:true,projection:'Old source-layout regex already mismatched at starting HEAD; new wrapper preserves all projection/privacy cases and tests actual finally boundary.',export:'Hard-coded 12 stage count predates existing planner_admission (13); wrapper derives count from canonical inventory, all other assertions unchanged.'},
 limitations:['No production migration applied; deploy requires additive migration and successful preflight.','Async pending trace receipt is not a saved promise; forced process death before delivery remains possible (no outbox introduced).','Both lost save acknowledgments remain unconfirmed even when database committed; retries never rerun capabilities/actions.','No whole-HTTP-request or physical-action exactly-once claim. Database save idempotence uses thread/request identity.','Historical partial/duplicate rows are not rewritten; conflicting identity is rejected.','Concurrent saves preserve complete pairs; this is not a new conversational scheduling engine.','Historical workflow/multi-gang exclusions remain.','Overall intelligence quality and IQ9B independent certification remain uncertified.'],
 production_changes:false,sealed_iq9b_replayed:false,decision:'IQ-10B TRACE & PERSISTENCE CERTIFIED — IQ-10C APPROVAL REQUIRED'};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq10b-certification.json',JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({decision:artifact.decision,safety:safety.pass,correlated:links.durably_correlated,identical:280,regressions_pass:regressions.filter(r=>r.status==='PASS').length,known_failures:5,latency:artifact.frozen280.latency,files}));
