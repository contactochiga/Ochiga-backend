import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { journeys } from './intelligence-quality-v1-corpus.mjs';
const a=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-baseline.json'));
assert.equal(journeys.length,40); assert.equal(a.records.length,280);
assert.equal(new Set(a.records.map(r=>`${r.journey_id}:${r.turn_number}`)).size,280);
for(const j of journeys){
 const rows=a.records.filter(r=>r.journey_id===j.id);
 assert.equal(rows.length,7);
 assert.deepEqual(rows.map(r=>r.prompt),j.turns.map(t=>t.prompt));
 assert.equal(new Set(rows.map(r=>r.thread_id)).size,1);
}
assert.equal(new Set(a.records.map(r=>r.thread_id)).size,40);
assert.equal(new Set(a.records.map(r=>r.trace.trace_id)).size,280);
assert(a.records.every(r=>r.response.persistence_saved===true));
assert(a.records.every(r=>r.response.execution?.current_turn_execution!==true));
assert.equal(createHash('sha256').update(JSON.stringify(a.records.map(r=>({request_id:r.request_id,response:r.response,trace:r.trace})))).digest('hex'),a.review.raw_response_trace_sha256);
for(const r of a.records){
 assert.deepEqual(r.envelope,journeys.find(j=>j.id===r.journey_id).turns[r.turn_number-1].envelope);
 for(const field of ['prompt','answer','message','credentials','context','memory']) assert(!(field in r.trace),`Raw field in durable trace: ${field}`);
}
for(const target of ['https://zcpgtdakqxyvjkmiibei.supabase.co','https://example.invalid','http://127.0.0.1:54321']){
 const p=spawnSync(process.execPath,['scripts/intelligence-quality-v1-run.mjs'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,SUPABASE_URL:target},encoding:'utf8'});
 assert.notEqual(p.status,0);assert.match(p.stderr,/requires the isolated local/);
}
console.log('PASS 40 journeys / 280 immutable prompts, unique threads/traces, persistence, no reported execution, raw-response integrity and nonlocal-target refusal');
