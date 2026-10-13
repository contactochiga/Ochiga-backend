// Verify and preserve grading/adjudication provenance; no runtime calls or grading.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const prefix='artifacts/intelligence-quality-v1-iq10f-';
const workers=['OMA','OSA','FACILITY','CONSUMER'];
const dimensions='understanding context_memory evidence reasoning_judgment initiative communication action_judgment'.split(' ');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const result={workers:{},hashes:{}};
for(const w of workers){
 const corpus=read(prefix+'author-'+w+'.json');
 const cases=[...corpus.journeys.flatMap(j=>j.turns),...corpus.companions];
 const reviews=['A','B'].map(g=>{
  const p=prefix+'grade-'+w+'-'+g+'.json',r=read(p);
  assert.equal(r.worker,w);assert.equal(r.grader,g);assert.equal(r.independence.prohibited_inputs_accessed,false);
  assert(r.independence.statement.length>40);assert.equal(r.grades.length,130);assert.equal(new Set(r.grades.map(x=>x.id)).size,130);
  for(const c of cases){const x=r.grades.find(y=>y.id===c.id);assert(x,c.id);validate(x);}
  result.hashes[p]=sha(fs.readFileSync(p));return r;
 });
 const selected=read('/tmp/iq10f-adjudication-'+w+'.json');
 const aa=read(prefix+'adjudicated-'+w+'.json');
 assert.equal(aa.worker,w);assert.equal(aa.independence.prohibited_inputs_accessed,false);
 const mapped=cases.map(c=>{const a=reviews[0].grades.find(x=>x.id===c.id),b=reviews[1].grades.find(x=>x.id===c.id);return{c,a,b,mandatory:a.verdict!==b.verdict||(a.severity??null)!==(b.severity??null)||Boolean(a.expectation_defect)!==Boolean(b.expectation_defect)||a.severity==='P0'||b.severity==='P0'};});
 const sample=mapped.filter(x=>!x.mandatory).sort((a,b)=>sha('IQ10F-v1:'+a.c.id).localeCompare(sha('IQ10F-v1:'+b.c.id))).slice(0,10).map(x=>x.c.id);
 const expected=mapped.filter(x=>x.mandatory||sample.includes(x.c.id)).map(x=>x.c.id).sort();
 assert.deepEqual(selected.cases.map(x=>x.case.id).sort(),expected);assert.deepEqual(aa.grades.map(x=>x.id).sort(),expected);
 for(const x of selected.cases){const m=mapped.find(y=>y.c.id===x.case.id);assert.deepEqual(x.grade_a,m.a);assert.deepEqual(x.grade_b,m.b);}
 for(const x of aa.grades)validate(x);
 const ap=prefix+'adjudicated-'+w+'.json';result.hashes[ap]=sha(fs.readFileSync(ap));
 const dest=prefix+'adjudication-packet-'+w+'.json.gz';
 const raw=fs.readFileSync('/tmp/iq10f-adjudication-'+w+'.json');
 const compressed=gzipSync(raw,{level:9});fs.writeFileSync(dest,compressed,{flag:'wx'});result.hashes[dest]=sha(compressed);
 result.workers[w]={selected:expected,agreed_sample:sample,
  dimension_only_differences:mapped.filter(x=>!x.mandatory&&dimensions.some(d=>x.a.dimensions[d]!==x.b.dimensions[d])).map(x=>x.c.id),
  adjudicated_changes:aa.grades.map(g=>{const m=mapped.find(x=>x.c.id===g.id);return{id:g.id,verdict_a:m.a.verdict,verdict_b:m.b.verdict,final:g.verdict,severity_a:m.a.severity,severity_b:m.b.severity,severity_final:g.severity};}),
  reviewer_safety_notes:reviews.map(r=>r.safety_findings??null),adjudicator_safety_notes:aa.safety_findings??null};
}
fs.writeFileSync(prefix+'review-integrity.json',JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({reviewers:8,adjudicators:4,validated:true,selected:Object.fromEntries(workers.map(w=>[w,result.workers[w].selected.length]))}));
function validate(x){
 assert(['PASS','PARTIAL','FAIL','INFRASTRUCTURE_BLOCKED'].includes(x.verdict),x.id);
 assert([null,'P0','P1','P2'].includes(x.severity),x.id);assert.equal(typeof x.expectation_defect,'boolean',x.id);
 assert(x.rationale?.length>10&&x.outcome?.length>0,x.id);if(x.verdict==='PASS')assert.equal(x.severity,null,x.id);
 for(const d of dimensions){assert(Object.hasOwn(x.dimensions,d),x.id+' '+d);const v=x.dimensions[d];assert(v===null||Number.isFinite(v)&&v>=0&&v<=5,x.id+' '+d);}
}
