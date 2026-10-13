// Structural interpretation score only, not end-to-end answer certification.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const corpusPath='artifacts/intelligence-quality-v1-iq11d-independent-cases.json';
const corpus=JSON.parse(fs.readFileSync(corpusPath)),output=process.argv[2];assert(output?.startsWith('/tmp/iq11d-'));
const {parseSemanticFrame:parse}=await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const subjects={leads:['crm'],opportunities:['crm','corporate_opportunity'],development_projects:['office_development','corporate_development'],tasks:['office_tasks'],financial:['office_financial'],public_opportunity:['corporate_opportunity'],devices:['devices'],rooms:['rooms'],wallet:['wallet'],utilities:['utilities'],visitors:['visitors'],maintenance:['maintenance'],security:['security','incidents'],cameras:['cameras'],context:[null],unknown:[null]};
const shape={DETAIL:['DIRECT_ANSWER','STATUS'],VALUE:['DIRECT_ANSWER','STATUS'],HISTORY:['LIST','DIRECT_ANSWER','COMPARISON'],REASSESSMENT:['ASSESSMENT','COMPARISON','YES_NO_WITH_REASON'],ADVICE:['ADVICE','NEXT_STEP'],REFUSAL:['REFUSAL'],CLARIFICATION:['CLARIFICATION']};
assert.equal(corpus.cases.length,64);assert.equal(new Set(corpus.cases.map(c=>c.id)).size,64);
const rows=corpus.cases.map(c=>{const f=parse(c.text,{surface:c.surface,activeAssessment:Boolean(c.prior_context)}),e=c.expected;
 assert(e.subject in subjects,'Author subject needs pre-runtime schema validation');
 const objective=f.cognitiveObjective===e.objective;
 const subject=subjects[e.subject].includes(f.domain);
 const target=(shape[e.intent]||[e.intent]).includes(f.answerTarget.response_intent)
  && (e.intent!=='VALUE'||f.answerTarget.quantity==='value'||f.answerTarget.facet==='balance')
  && (e.intent!=='HISTORY'||f.operation==='wallet.history'||['history','recent'].includes(f.temporalScope?.mode)||f.answerTarget.facet==='history')
  && (e.intent!=='REASSESSMENT'||f.cognitiveObjective==='reassess');
 const operation=f.mutationIntent===e.mutation&&(e.mutation||!f.operation.startsWith('device.power.'));
 return {...c,frame:f,metrics:{objective,subject,operation,target},pass:objective&&subject&&operation&&target};});
const summary={};for(const worker of [...new Set(rows.map(c=>c.worker))]){const r=rows.filter(c=>c.worker===worker),p=r.filter(c=>c.kind==='primary'),para=r.filter(c=>c.kind==='paraphrase'),flip=r.filter(c=>c.kind==='flip');
 assert.equal(p.length,8);assert.equal(para.length,4);assert.equal(flip.length,4);
 summary[worker]={primary:{pass:p.filter(c=>c.pass).length,total:p.length},metrics:Object.fromEntries(['objective','subject','operation','target'].map(k=>[k,{pass:r.filter(c=>c.metrics[k]).length,total:r.length}])),paraphrase:{pass:para.filter(c=>c.pass&&rows.find(x=>x.id===c.parent_id)?.pass).length,total:para.length},flip:{pass:flip.filter(c=>c.pass).length,total:flip.length}};
}
const ready=Object.values(summary).every(s=>s.primary.pass/s.primary.total>=.85&&Object.values(s.metrics).every(m=>m.pass/m.total>=.9)&&s.paraphrase.pass/s.paraphrase.total>=.8&&s.flip.pass/s.flip.total>=.8);
const result={corpus_sha256:createHash('sha256').update(fs.readFileSync(corpusPath)).digest('hex'),summary,ready,rows,limitations:'Exact structural scoring under frozen enum mapping; not independent human grading or evidence/action execution certification.'};
fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({summary,ready}));process.exitCode=ready?0:1;
