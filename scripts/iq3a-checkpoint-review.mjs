import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const old=read('artifacts/intelligence-quality-v1-iq2c-results.json');
const raw=read('/tmp/iq3a-final-iq.json');
assert(raw.completed_at);assert.equal(raw.records.length,280);
for(const [i,r] of raw.records.entries()) {
 const b=old.records[i];assert.equal(r.prompt,b.prompt);assert.deepEqual(r.envelope,b.envelope);
 assert.equal(r.response.answer,b.answer);assert.equal(r.response.persistence_saved,true);assert(r.trace?.trace_id);
 assert.notEqual(r.response.execution?.current_turn_execution,true);
}
const tally=(rs,f)=>rs.reduce((a,r)=>(a[f(r)]=(a[f(r)]||0)+1,a),{});
const wave=read('/tmp/iq3a-final-wave11.json');
assert.deepEqual(tally(wave.records,r=>r.status),{PASS:131,FAIL:1});
const suites=read('/tmp/iq3a-final-regressions.json');assert.equal(suites.length,23);
const controls=[];
for(const [name,suite]of [['reload','oyi-workflow-action-phase-c-reload-smoke'],['multigang','oyi-workflow-action-phase-c-multigang-smoke'],['correction','oyi-workflow-action-phase-c-correction-smoke'],['durable','oyi-workflow-durable-continuation-smoke']]) {
 const r=suites.find(r=>r.suite===suite);assert.equal(r.status,'FAIL');
 const normalize=s=>s.slice(s.indexOf('AssertionError')).replace(/file:\/\/[^\s]+\/scripts\//g,'file://REPO/scripts/');
 const a=fs.readFileSync(`/tmp/iq1-control-${name}.stderr`,'utf8'),b=fs.readFileSync(r.stderr,'utf8');
 assert(a.includes('AssertionError'));assert(b.includes('AssertionError'));assert.equal(normalize(a),normalize(b));
 controls.push({suite,identical_control_assertion:true,control_head:'45e89d299956fdd041f70f5937dbcc750a35aa6b'});
}
const pre=read('artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json');
const readiness=pre.records.filter(r=>r.classification==='EVIDENCE_PLANNING').map(r=>({
 id:r.id,classification:'SOURCE_CONTRACT_BLOCKED',
 reason:'Collection-result primitive exists but this turn has no fully audited and connected source-outcome path. This is readiness accounting, not a new causal diagnosis or evidence-sufficiency claim.',
}));assert.equal(readiness.length,133);
const paths=['/tmp/iq3a-final-iq.json','/tmp/iq3a-final-wave11.json','/tmp/iq3a-final-safety.json','/tmp/iq3a-final-objective.json','/tmp/iq3a-final-regressions.json'];
const result={starting_head:'7526f09a77aa38c34b8fa5d025474e0fdda39803',status:'INCOMPLETE_CONTRACT_HARDENING_CHECKPOINT',
 iq:{turns:280,answer_changes:0,persisted:280,trace_correlated:280,retained_status_counts:old.after,retained_severity:old.severity,grading_note:'Frozen prompts/envelopes and answers matched. Prior whole-envelope classifications retained; no claim of new seven-dimension scoring.'},
 wave11:{counts:tally(wave.records,r=>r.status),failures:wave.records.filter(r=>r.status!=='PASS').map(r=>({journey_id:r.journey_id,turn_number:r.turn_number,status:r.status}))},
 regressions:{counts:tally(suites,r=>r.status),controls,suites},
 focused:read('/tmp/iq3a-final-objective.json'),safety:read('/tmp/iq3a-final-safety.json'),
 source_hashes:Object.fromEntries(paths.map(p=>[p,hash(p)])),readiness,
 readiness_note:'No source is certified planner-ready yet. Full collector inventory, integration and privacy fixture proof remain outstanding.',
 decision:'IQ-3A NOT YET CERTIFIED'};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq3a-checkpoint.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({iq:result.iq,wave11:result.wave11.counts,regressions:result.regressions.counts,readiness:133}));
