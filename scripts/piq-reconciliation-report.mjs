// Mechanical evidence packaging. No runtime imports, database or network.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const sha=b=>createHash('sha256').update(b).digest('hex');
const original='/tmp/iq11c-piq-20261016-readiness-02';
assert.equal(sha(fs.readFileSync(original+'.json')),'524f76f9000b76e16a6d14dd5c507a04ff09173d83a163e6807a7f4e7aec4637');
assert.equal(sha(fs.readFileSync(original+'-attempts.jsonl')),'f29445da9b0c7d06f0098e835917cc1833be5595e3dce64dfbbf4fd3f2dedd58');
const jsonNames=['baseline-01','candidate-01','full-01','full-02','persistence-01','safety-live-01','safety-additional-01','legacy-baseline-01'];
const files=[original+'.json',original+'-attempts.jsonl',original+'-manifest.json',
 ...jsonNames.map(n=>'/tmp/iq11c-piq-repair-'+n+'.json'),
 ...['full-01','full-02'].flatMap(n=>['-manifest.json','-attempts.jsonl'].map(s=>'/tmp/iq11c-piq-repair-'+n+s))];
const payload=files.map(path=>{const content=fs.readFileSync(path,'utf8');return{path,sha256:sha(content),content};});
const raw=JSON.stringify(payload);
for(const pattern of [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/AIza[0-9A-Za-z_-]{30,}/,/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/,/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/])assert(!pattern.test(raw),'Possible credential in archive; values withheld');
const read=n=>JSON.parse(fs.readFileSync('/tmp/iq11c-piq-repair-'+n+'.json'));
const full=n=>{const r=read(n);return {pass:r.pass,fail:r.fail,preflight:r.preflight,attempted:r.final.attempted,persisted_pairs:r.final.persisted_pairs,traces_verified:r.final.traces_verified,final_ready:r.final.ready,executed:r.executed,fixture_hash:r.fixture_hash,manifest_sha256:r.manifest_sha256,classifications:r.final.records.reduce((out,x)=>(out[x.classification]=(out[x.classification]||0)+1,out),{})};};
const count=n=>{const r=read(n);return{pass:r.pass,fail:r.fail,executed:r.executed};};
const smokes=['safety-structural','authority','foundation','trace-contract','trace-export','privacy','onecore'].map(n=>{
 const prefix='/tmp/iq11c-piq-repair-'+n+'-01';const out=fs.readFileSync(prefix+'.stdout','utf8'),err=fs.readFileSync(prefix+'.stderr','utf8');
 return {suite:n,stdout_sha256:sha(out),stderr_sha256:sha(err),pass_lines:(out.match(/^PASS\b/gm)||[]).length,failures:err.split('\n').filter(l=>l.startsWith('FAIL '))};
});
const result={kind:'targeted_trace_preflight_repair_not_intelligence_certification',starting_head:'1d10c992566169d48b30158df2cc681d27abf3eb',
 original:{pass:31,fail:1,ready:false,unchanged_sha256:payload[0].sha256},
 demonstrated_defects:['failed re-poll overwrites completed negative evidence','deadline abort flattened by client classified unknown'],
 original_per_poll_cause:'Not captured; no claim of demonstrated original infrastructure outage or exact abort sequence.',
 baseline_controls:count('baseline-01'),candidate_controls:count('candidate-01'),preflights:[full('full-01'),full('full-02')],
 persistence:count('persistence-01'),safety_live:count('safety-live-01'),safety_additional_including_original:count('safety-additional-01'),
 safety_structural:{pass:22,fail:0},smokes,legacy_baseline:read('legacy-baseline-01'),
 build:'PASS',typecheck:'PASS',syntax:'PASS',provider_calls:0,independent_corpus_executed:false,
 source_files_changed:['src/oyi-core/observability/conversationTraceReconciliation.ts'],
 qualification_readiness:'preflight_ready; fresh authorship, fixture/corpus seal and run-time preflight still required',
 evidence:{encoding:'gzip+base64',uncompressed_sha256:sha(raw),files:payload.map(({path,sha256})=>({path,sha256})),data:gzipSync(raw).toString('base64')}};
assert(result.preflights.every(r=>r.preflight.ready&&r.pass===32&&r.fail===0));
const target='artifacts/oyi-provider-independent-trace-preflight-repair.json';
fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({target,sha256:sha(fs.readFileSync(target)),archived_files:payload.length,bytes:fs.statSync(target).size}));
