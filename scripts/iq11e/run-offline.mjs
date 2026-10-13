// CLI accepts synthetic JSON and already recorded replies only. No provider imports.
import fs from 'node:fs';import assert from 'node:assert/strict';import {hash,checkPacket} from './contract.mjs';
import {deterministicBaseline,sourceManifest,reconcileRecorded,gradeProjection} from './harness.mjs';
const [fixturePath,receiptPath,prefix]=process.argv.slice(2);
assert(fixturePath&&receiptPath&&prefix,'Usage: node scripts/iq11e/run-offline.mjs synthetic-fixture.json recorded-replies.json output-prefix');
assert(![fixturePath,receiptPath].some(p=>/iq9b|iq10f/i.test(p)),'Sealed corpus prohibited');
const read=p=>{assert(fs.statSync(p).size<=24*1024*1024,'input_file_bound');return JSON.parse(fs.readFileSync(p,'utf8'));};
const fixture=read(fixturePath),receipts=read(receiptPath);
assert.equal(fixture.version,1);assert.equal(fixture.synthetic_only,true);assert.equal(fixture.reviewed_for_minimization,true);
assert(Array.isArray(fixture.cases)&&fixture.cases.length>0&&fixture.cases.length<=2000);assert(Array.isArray(receipts)&&receipts.length<=4000);
assert(fixture.cases.every(c=>checkPacket(c.packet).length===0));
assert.equal(new Set(fixture.cases.map(c=>c.packet.request_id)).size,fixture.cases.length);
const manifest=sourceManifest(),before=hash(manifest),baselines={},grades=[];
// Refuse overwrite before any processing; a failed run retains its attempted journal.
const out=fs.openSync(prefix+'.json','wx'),journal=fs.openSync(prefix+'-journal.jsonl','wx');
const event=x=>{fs.writeSync(journal,JSON.stringify(x)+'\n');fs.fsyncSync(journal);};
try{
 for(const c of fixture.cases){event({event:'attempted',request_id:c.packet.request_id,input_hash:hash(c.packet),context_epoch:c.packet.context_epoch});
  const b=deterministicBaseline(c.packet);baselines[c.packet.request_id]=b;
  if(c.expectation)grades.push({request_id:c.packet.request_id,baseline:gradeProjection(b,c.expectation)});
  event({event:'baseline_completed',request_id:c.packet.request_id,baseline_hash:hash(b)});
 }
 const locks=Object.fromEntries(fixture.cases.map(c=>[c.packet.request_id,c.locks??{}]));
 const reconciliation=reconcileRecorded(fixture.cases.map(c=>c.packet),baselines,receipts,locks);
 for(const record of reconciliation.records){event({event:'final',...record});const c=fixture.cases.find(c=>c.packet.request_id===record.request_id);if(c.expectation&&record.state==='valid_shadow'){const r=receipts.find(r=>r.request_id===record.request_id);grades.find(g=>g.request_id===record.request_id).shadow=gradeProjection(r.candidate.frame,c.expectation);}}
 assert.equal(hash(sourceManifest()),before,'source_changed');
 fs.writeSync(out,JSON.stringify({offline_only:true,synthetic_only:true,fixture_sha256:hash(fs.readFileSync(fixturePath,'utf8')),receipts_sha256:hash(fs.readFileSync(receiptPath,'utf8')),source_manifest:manifest,reconciliation,grades,provider_calls:0,runtime_adoption:false,certification:false,context_limitation:'Parser sees current utterance and active objective only. Authorized context is validated for shadow bindings; no orchestrator restoration is simulated.'},null,2));fs.fsyncSync(out);
 console.log(JSON.stringify({attempted:reconciliation.attempted,accounted:reconciliation.accounted,ready:reconciliation.ready,certification:false}));
 process.exitCode=reconciliation.ready?0:2;
}catch(e){event({event:'harness_failed',error_class:'offline_processing_error'});throw e;}finally{fs.closeSync(journal);fs.closeSync(out);}
