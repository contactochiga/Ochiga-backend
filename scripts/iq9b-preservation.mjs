// Mechanical regression packaging, separate from blinded certification scores.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const candidate='872fb7bf264d30865e1aadb5dfa44ae46a9579d6';
assert.equal(execFileSync('git',['diff',candidate,'--','src','supabase','migrations','package.json','package-lock.json','tsconfig.json'],{encoding:'utf8'}),'');
const previous=read('artifacts/intelligence-quality-v1-iq9a15-validation.json');
assert.equal(sha('/tmp/iq9a15-safe280.json'),previous.frozen280.candidate_sha256);
const A=read('/tmp/iq9a15-safe280.json').records,B=read('/tmp/iq9b-preserve280.json').records;
assert.equal(A.length,280);assert.equal(B.length,280);
const changed=B.flatMap((r,i)=>r.response?.answer===A[i].response?.answer?[]:[{id:r.journey_id+':'+r.turn_number,before:A[i].response?.answer,after:r.response?.answer}]);
const wave=read('/tmp/iq9b-wave11.json').records;
const parser=read('/tmp/iq9b-iq7-iq7-eval-heldout.json');assert.deepEqual(parser.summary,previous.iq7.parser);
const last=p=>JSON.parse(fs.readFileSync(p,'utf8').trim().split('\n').at(-1));
const files=['/tmp/iq9b-contracts.json','/tmp/iq9b-canonical.json','/tmp/iq9b-r0-r7.json','/tmp/iq9b-iq7-iq7-eval-heldout.json','/tmp/iq9b-iq7-iq7-e2e-heldout.json','/tmp/iq9b-preserve280.json','/tmp/iq9b-wave11.json','/tmp/iq9b-cancellation.json'];
const frozenPaths=['artifacts/intelligence-quality-v1-baseline.json','artifacts/intelligence-quality-v1-failure-map.json','artifacts/intelligence-quality-v1-root-causes.json','artifacts/intelligence-quality-v1-iq9a-dev-expectations.json','artifacts/intelligence-quality-v1-iq9a-dev-runner.json','scripts/intelligence-quality-v1-corpus.mjs','scripts/wave11-behavioural-torture-harness.mjs','artifacts/intelligence-quality-v1-evidence-source-inventory.json','artifacts/intelligence-quality-v1-iq5-conversation-tests.json','artifacts/intelligence-quality-v1-iq6-conversation-tests.json'];
for(const p of frozenPaths)assert.equal(sha(p),createHash('sha256').update(execFileSync('git',['show',candidate+':'+p],{maxBuffer:30000000})).digest('hex'),p);
const out={candidate,generated_at:new Date().toISOString(),runtime_diff_zero:true,inputs:files.map(path=>({path,sha256:sha(path)})),frozen_files:frozenPaths.map(path=>({path,sha256:sha(path)})),
 contracts:read(files[0]),canonical:read(files[1]),r0_r7:read(files[2]),iq7:{parser:parser.summary,known_parser_misses:parser.failures,e2e:read(files[4]).summary,parser_unchanged:true},
 frozen280:{items:280,identical_answers:280-changed.length,changed,persisted:B.filter(r=>r.response?.persistence_saved).length,execution:B.filter(r=>r.response?.execution?.current_turn_execution).length,control_sha256:sha('/tmp/iq9a15-safe280.json'),candidate_sha256:sha(files[5]),new_intelligence_score:false},
 wave11:{items:wave.length,result:wave.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),persisted:wave.filter(r=>r.persistence_saved).length},cancellation:read(files[7]),disclosure:last('/tmp/iq9b-disclosure.stdout'),a15_focused:last('/tmp/iq9b-a15-focused.stdout'),a15_boundary:last('/tmp/iq9b-a15-boundary.stdout'),
 development_separate:{source:'artifacts/intelligence-quality-v1-iq9a15-reviewed.json',sha256:sha('artifacts/intelligence-quality-v1-iq9a15-reviewed.json'),prior_summary:previous.development.summary,regraded:false,note:'Unchanged candidate; maintainer development grades not pooled with independent certification.'},
 workflow_exclusion:'All four historical original fixtures remain failing; multi-gang is not release-certified. IQ9A15 ownership-corrected replay proved three but not target-correction. No assertions changed.',typecheck_build:'Passed prior to sealed run',production_changes:false};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq9b-preservation.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({contracts:out.contracts.filter(r=>r.status==='PASS').length,canonical:out.canonical.filter(r=>r.status==='PASS').length,frozen280:out.frozen280.identical_answers,wave11:out.wave11.result}));
