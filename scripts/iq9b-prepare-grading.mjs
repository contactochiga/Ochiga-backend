// Mechanical, lossless-answer grading packets. No verdicts or prior grades.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base='artifacts/intelligence-quality-v1-iq9b';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const expectations=JSON.parse(fs.readFileSync(base+'-expectations.json')).items;
const raw=JSON.parse(fs.readFileSync(base+'-first-contact-raw.json'));
assert.equal(raw.records.length,520);
const inputs=[];
for(const worker of ['Oma','Osa','Facility','Consumer']){
 const cases=raw.records.filter(r=>r.worker===worker).map(record=>{
  const expected=expectations.find(e=>e.id===record.id);assert(expected);assert.equal(record.turns.length,expected.seeds.length+1);
  return {id:record.id,kind:record.kind,worker,expectation:expected,companion_primary:expected.companion_of?expectations.find(e=>e.id===expected.companion_of):null,
   dialogue:record.turns.map(t=>{const r=t.response||{};return {index:t.index,scored:t.scored,prompt:t.prompt,answer:r.answer??r.message??null,error:t.error??null,capability:r.capability_key??r.execution?.capability_key??null,truth:r.truth??null,requires_confirmation:r.requiresConfirmation??null,execution:r.execution??null,confirmations:r.confirmations??null,evidence:{sources:r.sources??null,facts:r.facts??null,cards:r.cards??null},persistence_saved:r.persistence_saved??null,trace:t.trace??null,trace_error:t.trace_error??null,latency_ms:t.latency_ms,execution_attempts:t.execution_attempts};})};
 });
 const path=base+'-grading-'+worker+'.json';fs.writeFileSync(path,JSON.stringify({worker,raw_sha256:sha(base+'-first-contact-raw.json'),cases},null,2)+'\n',{flag:'wx'});inputs.push({path,sha256:sha(path),cases:cases.length});
}
fs.writeFileSync(base+'-first-contact-hashes.json',JSON.stringify({sealed_at:new Date().toISOString(),raw_sha256:sha(base+'-first-contact-raw.json'),journal_sha256:sha(base+'-first-contact.jsonl'),start_sha256:sha(base+'-first-contact-start.json'),grading_inputs:inputs},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(inputs));
