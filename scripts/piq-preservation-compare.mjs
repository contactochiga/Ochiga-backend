// Exact answer comparison against archived preservation evidence, not regrading.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const archive=JSON.parse(gunzipSync(fs.readFileSync('artifacts/intelligence-quality-v1-iq11c-candidate-evidence.json.gz')));
const previous=JSON.parse(archive.files.find(f=>f.name==='iq10e-iq11c-complete-candidate280.json').content).records;
const current=JSON.parse(fs.readFileSync('/tmp/piq-preservation-candidate280.json')).records;
const frozen=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-baseline.json')).records;
assert.equal(current.length,280);assert.equal(previous.length,280);
const changed=current.flatMap((r,i)=>{
 assert.equal(r.prompt,previous[i].prompt);assert.equal(r.prompt,frozen[i].prompt);
 return r.response.answer===previous[i].response.answer?[]:[{id:r.journey_id+':'+r.turn_number,original_status:frozen[i].status,prompt:r.prompt,before:previous[i].response.answer,after:r.response.answer}];
});
const passIndices=frozen.flatMap((r,i)=>r.status==='PASS'?[i]:[]);
const out={turns:280,comparison:'IQ-11C archived 280 preservation answers; no historical independent sealed corpus replay',unchanged:280-changed.length,changed,frozen_pass_total:passIndices.length,frozen_pass_unchanged:passIndices.filter(i=>current[i].response.answer===previous[i].response.answer).length,changed_frozen_pass_ids:changed.filter(c=>c.original_status==='PASS').map(c=>c.id),saved:current.filter(r=>r.response.persistence_saved).length,original_frozen_status_counts:frozen.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),score_policy:'Preservation only. No promotion of old failure cases and no new 280 score claimed.'};
fs.writeFileSync('artifacts/piq-20261016-preservation-comparison.json',JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...out,changed:changed.map(c=>({id:c.id,original_status:c.original_status}))}));
