// Post-run mechanical integrity checks only. Never runs Core or assigns grades.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root='artifacts/piq-20261016',sha=b=>createHash('sha256').update(b).digest('hex');
const seal=JSON.parse(fs.readFileSync(root+'-seal.json'));
assert(seal.files.every(f=>sha(fs.readFileSync(f.path))===f.sha256));
const workers={};let attempted=0,persisted=0,traces=0;
const privateMarkers=['ade.coker@example.test','musa.bello@example.test','Wave11 Living Light','Wave11 Expected Visitor'];
for(const worker of ['oma','osa','facility','consumer']){
 const source='/tmp/piq-first-contact-'+worker+'.json',bytes=fs.readFileSync(source),run=JSON.parse(bytes);
 const journal=fs.readFileSync('/tmp/piq-first-contact-'+worker+'-attempts.jsonl','utf8').trim().split('\n').map(JSON.parse);
 const starts=journal.filter(x=>x.event==='started'),returns=journal.filter(x=>x.event==='returned'),captures=journal.filter(x=>x.event==='captured');
 assert.equal(starts.length,run.captures.length);assert.equal(returns.length,starts.length);assert.equal(captures.length,starts.length);
 assert.equal(new Set(starts.map(x=>x.attempt_id)).size,starts.length);
 assert.equal(new Set(starts.map(x=>x.request_id)).size,starts.length);
 assert(run.captures.every(c=>starts.some(s=>s.attempt_id===c.attempt.attempt_id)));
 assert.equal(run.final.records.length,starts.length);assert(run.final.ready&&run.stable);
 assert.equal(run.physical_executor_attempts,0);assert.equal(run.blocked_external_attempts,0);assert.equal(run.provider_enabled,false);
 const denied=run.final.records.filter(r=>r.classification==='rejected_correlated').length;
 assert.equal(run.final.persisted_pairs+denied,starts.length);assert.equal(run.final.traces_verified,starts.length);
 const durableTraces=run.captures.map(c=>c.trace).filter(Boolean);
 // This supplements, not replaces, the canonical privacy contract suites.
 const traceText=JSON.stringify(durableTraces);
 assert(!privateMarkers.some(m=>traceText.includes(m)));
 assert(durableTraces.every(t=>!['answer','prompt','operational_snapshot','provider_payload','api_key','facts'].some(k=>k in t)));
 const archive=root+'-raw/'+source.split('/').at(-1)+'.gz';
 assert(gunzipSync(fs.readFileSync(archive)).equals(bytes));
 const latency=run.captures.map(c=>c.latency_ms).sort((a,b)=>a-b);
 workers[worker]={attempted:starts.length,scored:run.captures.filter(c=>c.scored).length,setup:run.captures.filter(c=>!c.scored).length,persisted_pairs:run.final.persisted_pairs,correlated_traces:run.final.traces_verified,rejected_correlated:denied,raw_sha256:sha(bytes),journal_sha256:sha(fs.readFileSync('/tmp/piq-first-contact-'+worker+'-attempts.jsonl')),duplicate_request_ids:0,journal_complete:true,fixture_and_runtime_stable:true,external_network_attempts:0,physical_executor_attempts:0,trace_payload_marker_check:'PASS',latency_ms:{p50:latency[Math.ceil(latency.length*.5)-1],p95:latency[Math.ceil(latency.length*.95)-1],max:latency.at(-1)}};
 attempted+=starts.length;persisted+=run.final.persisted_pairs;traces+=run.final.traces_verified;
}
const out={runtime:seal.runtime_head,seal_sha256:sha(fs.readFileSync(root+'-seal.json')),attempted,persisted_pairs:persisted,correlated_traces:traces,correctly_rejected_without_conversation_save:attempted-persisted,workers,all_sealed_file_hashes_match:true,privacy_scope:'Structural trace field/known-fixture marker checks plus separate canonical privacy suites; full synthetic Core responses are retained for independent safety review. No claim about HTTP-layer serialization.',performance_scope:'Sequential local synthetic provider-off run; response latency excludes final reconciliation and is not a production SLO.'};
fs.writeFileSync(root+'-capture-integrity.json',JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({attempted,persisted,traces,workers:Object.keys(workers)}));
