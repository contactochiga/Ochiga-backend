// Apply the frozen disagreement/sample selection without inspecting source.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const worker=process.argv[2];assert(['OMA','OSA','FACILITY','CONSUMER'].includes(worker));
const prefix='artifacts/intelligence-quality-v1-iq10f-';
const a=JSON.parse(fs.readFileSync(prefix+'grade-'+worker+'-A.json'));
const b=JSON.parse(fs.readFileSync(prefix+'grade-'+worker+'-B.json'));
const pack=JSON.parse(fs.readFileSync('/tmp/iq10f-grading-'+worker+'.json'));
for(const g of [a,b]){assert.equal(g.grades.length,130);assert.equal(new Set(g.grades.map(x=>x.id)).size,130);for(const c of pack.cases)assert(g.grades.find(x=>x.id===c.case.id));}
const rows=pack.cases.map(c=>{
 const ga=a.grades.find(g=>g.id===c.case.id),gb=b.grades.find(g=>g.id===c.case.id);
 const disagreement=ga.verdict!==gb.verdict||(ga.severity??null)!==(gb.severity??null)||Boolean(ga.expectation_defect)!==Boolean(gb.expectation_defect);
 return {...c,grade_a:ga,grade_b:gb,disagreement,mandatory:disagreement||ga.severity==='P0'||gb.severity==='P0',sample_hash:createHash('sha256').update('IQ10F-v1:'+c.case.id).digest('hex')};
});
const sampled=rows.filter(x=>!x.mandatory).sort((a,b)=>a.sample_hash.localeCompare(b.sample_hash)).slice(0,10).map(x=>x.case.id);
const selected=rows.filter(x=>x.mandatory||sampled.includes(x.case.id)).map(x=>({...x,selection_reason:x.mandatory?'disagreement_or_P0':'agreed_sample'}));
fs.writeFileSync('/tmp/iq10f-adjudication-'+worker+'.json',JSON.stringify({worker,disagreements:rows.filter(x=>x.disagreement).length,agreed_sample:sampled,cases:selected}),{flag:'wx'});
console.log(JSON.stringify({worker,disagreements:rows.filter(x=>x.disagreement).length,selected:selected.length,sampled:sampled.length}));
