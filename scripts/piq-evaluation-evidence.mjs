// Mechanical evidence packaging/adjudication selection only. No automated grading.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [mode,worker,prefix='/tmp/piq-first-contact']=process.argv.slice(2);
assert(['oma','osa','facility','consumer'].includes(worker));
const root='artifacts/piq-20261016',corpus=JSON.parse(fs.readFileSync(root+'-'+worker+'-corpus.json'));
const turns=[...corpus.journeys.flatMap(j=>j.turns),...corpus.companions];
const sha=x=>createHash('sha256').update(x).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2),{flag:'wx'});
if(mode==='package'){
 const run=read(prefix+'-'+worker+'.json');
 const byAttempt=new Map(run.final.records.map(r=>[r.attempt_id,r]));
 const cases=[...corpus.journeys,...corpus.companions];
 const packed=cases.map(c=>({case:c,captures:run.captures.filter(r=>r.case_id===c.id).map(r=>{
  const response=r.response||{};
  return {...r,response,thread_metadata:undefined,reconciliation:byAttempt.get(r.attempt.attempt_id),context_evidence_available_in_raw:true};
 })}));
 // Each batch contains whole journeys/companion setups. All complete responses,
 // structured traces and reconciliation included; full metadata remains in raw.
 const paths=[];for(let i=0;i<packed.length;i+=10){const path=prefix+'-'+worker+'-grading-'+String(i/10+1).padStart(2,'0')+'.json';write(path,{worker,raw_path:prefix+'-'+worker+'.json',cases:packed.slice(i,i+10)});paths.push({path,sha256:sha(fs.readFileSync(path))});}
 write(prefix+'-'+worker+'-grading-index.json',{worker,runtime:run.runtime,raw_sha256:sha(fs.readFileSync(prefix+'-'+worker+'.json')),scored:run.captures.filter(c=>c.scored).length,setup:run.captures.filter(c=>!c.scored).length,paths});
 console.log(JSON.stringify({worker,batches:paths.length}));
}else if(mode==='select'){
 const a=read(root+'-'+worker+'-grader-a.json'),b=read(root+'-'+worker+'-grader-b.json');
 const run=read(prefix+'-'+worker+'.json');
 for(const g of [a,b]){
  assert.equal(g.grades.length,turns.length);assert.equal(new Set(g.grades.map(x=>x.id)).size,turns.length);
  assert(turns.every(t=>g.grades.some(x=>x.id===t.id)));
  const setup=run.captures.filter(c=>!c.scored).map(c=>c.attempt.attempt_id);
  assert.equal(new Set(g.reviewed_setup_attempts).size,setup.length);assert(setup.every(id=>g.reviewed_setup_attempts.includes(id)));
  for(const row of g.grades){assert(['PASS','PARTIAL','FAIL','INFRASTRUCTURE_BLOCKED'].includes(row.verdict));assert(['NONE','P0','P1','P2'].includes(row.severity));for(const k of ['objective','subject','reference','operation','answer_target','clarification_emitted','clarification_required'])assert(typeof row[k]==='boolean',row.id+' '+k);}
 }
 const fields=['verdict','severity','objective','subject','reference','operation','answer_target','clarification_emitted','clarification_required','primary_boundary'];
 const disagreements=[],agreed=[];
 for(const t of turns){const aa=a.grades.find(g=>g.id===t.id),bb=b.grades.find(g=>g.id===t.id);(fields.some(k=>aa[k]!==bb[k])?disagreements:agreed).push(t.id);}
 const sample=new Set();
 for(const group of ['intent','dimension','safety'])for(const value of new Set(turns.map(t=>String(t[group])))){
  const eligible=turns.filter(t=>String(t[group])===value&&agreed.includes(t.id)).map(t=>t.id).sort((x,y)=>sha(x).localeCompare(sha(y)));
  eligible.slice(0,Math.ceil(eligible.length*.2)).forEach(id=>sample.add(id));
 }
 const selected=[...new Set([...disagreements,...sample])];
 write(root+'-'+worker+'-adjudication-selection.json',{worker,all:turns.length,disagreements,agreed_count:agreed.length,agreed_sample:[...sample],selected,fields,
  setup_findings:[...(a.setup_findings||[]),...(b.setup_findings||[])],agreement_rate:(turns.length-disagreements.length)/turns.length});
 console.log(JSON.stringify({worker,disagreements:disagreements.length,sample:sample.size,selected:selected.length}));
}else throw Error('Expected package or select');
