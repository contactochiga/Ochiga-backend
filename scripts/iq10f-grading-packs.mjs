// Lossless evidence packaging; no scoring or answer/expectation edits.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const hashes={};
for(const worker of ['OMA','OSA','FACILITY','CONSUMER']){
 const path='/tmp/iq10f-first-'+worker+'.jsonl',bytes=fs.readFileSync(path);
 const raw=bytes.toString().trim().split('\n').map(x=>JSON.parse(x));
 const c=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq10f-author-'+worker+'.json'));
 const primary=c.journeys.flatMap(j=>j.turns),cases=[...primary,...c.companions];
 const scored=raw.filter(r=>r.scored);assert.equal(scored.length,130);assert.equal(new Set(scored.map(r=>r.id)).size,130);
 const entries=scored.map(r=>{
  const expectation=cases.find(c=>c.id===r.id);assert(expectation);
  const context=raw.slice(0,raw.indexOf(r)).filter(x=>x.run_id===r.run_id).map(x=>({id:x.id,prompt:x.prompt,answer:x.response?.answer,error:x.error,actor_mode:x.actor_mode}));
  return {case:expectation,prior_turns:context,evidence:r};
 });
 const out='artifacts/intelligence-quality-v1-iq10f-first-'+worker+'.jsonl.gz';
 fs.writeFileSync(out,gzipSync(bytes),{flag:'wx'});
 hashes[worker]={raw_sha256:createHash('sha256').update(bytes).digest('hex'),gzip_sha256:createHash('sha256').update(fs.readFileSync(out)).digest('hex'),raw_bytes:bytes.length,artifact:out,attempted:raw.length,scored:scored.length};
 fs.writeFileSync('/tmp/iq10f-grading-'+worker+'.json',JSON.stringify({worker,raw_hash:hashes[worker].raw_sha256,cases:entries}),{flag:'wx'});
 fs.writeFileSync('artifacts/intelligence-quality-v1-iq10f-execution-'+worker+'.json',fs.readFileSync('/tmp/iq10f-first-'+worker+'.json'),{flag:'wx'});
}
fs.writeFileSync('artifacts/intelligence-quality-v1-iq10f-first-contact-hashes.json',JSON.stringify(hashes,null,2),{flag:'wx'});
console.log(JSON.stringify(hashes,null,2));
