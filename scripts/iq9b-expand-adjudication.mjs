// Mechanical preregistered expansion; never supplies old grades to the reviewer.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const worker=process.argv[2],base='artifacts/intelligence-quality-v1-iq9b';
assert(['Oma','Osa','Facility','Consumer'].includes(worker));
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const lock=read(base+`-grading-lock-${worker}.json`);
for(const f of lock.graders)assert.equal(sha(f.path),f.sha256);
const a=read(lock.graders[0].path),adjPath=base+`-adjudicated-${worker}.json`,adj=read(adjPath);
const pass=g=>['MEETS_TARGET','CORRECT_LIMITATION','CORRECT_REFUSAL'].includes(g.verdict);
const reversals=lock.agreed_sample.filter(id=>{
 const g=adj.grades.find(g=>g.id===id);assert(g,id);
 return pass(g)!==pass(a.grades.find(g=>g.id===id));
});
const required=reversals.length/Math.max(lock.agreed_sample.length,1)>.1;
if(required){
 const packet=read(base+`-grading-${worker}.json`),ids=new Set(adj.grades.map(g=>g.id));
 const cases=packet.cases.filter(c=>!ids.has(c.id));
 assert(cases.length+ids.size===130);
 fs.writeFileSync(base+`-adjudication-${worker}-expanded.json`,JSON.stringify({worker,instruction:'Independently grade every remaining case against the frozen protocol. Prior verdicts and sample labels remain withheld.',raw_sha256:packet.raw_sha256,cases},null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({worker,required,sample:lock.agreed_sample.length,reversals:reversals.length,first_adjudication_sha256:sha(adjPath)}));
