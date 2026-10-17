// Mechanical aggregation of independently graded and adjudicated evidence.
// This script cannot assign a verdict or alter a frozen expectation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='artifacts/piq-20261016',prefix=process.argv[2]||'/tmp/piq-first-contact';
const read=p=>JSON.parse(fs.readFileSync(p));
const rate=(n,d)=>d?Number((100*n/d).toFixed(3)):null;
const dist=rows=>Object.fromEntries(['PASS','PARTIAL','FAIL','INFRASTRUCTURE_BLOCKED'].map(k=>[k,rows.filter(r=>r.verdict===k).length]));
const summary=rows=>({total:rows.length,...dist(rows),success_percent:rate(rows.filter(r=>r.verdict==='PASS').length,rows.length)});
const stratify=(rows,key)=>Object.fromEntries([...new Set(rows.map(r=>r[key]))].sort().map(k=>[k,summary(rows.filter(r=>r[key]===k))]));
const out={runtime:'bd97cc9c21c0bd1b4073e6a955b774a7a8af12b9',workers:{},all:[],setup_findings:[],gates:{},historical_exclusions:['workflow_reload','workflow_multigang','workflow_correction','workflow_durable_continuation','owned_workflow_aggregate']};
for(const worker of ['oma','osa','facility','consumer']){
 const corpus=read(root+'-'+worker+'-corpus.json'),a=read(root+'-'+worker+'-grader-a.json'),b=read(root+'-'+worker+'-grader-b.json');
 const selection=read(root+'-'+worker+'-adjudication-selection.json'),adj=read(root+'-'+worker+'-adjudication.json'),raw=read(prefix+'-'+worker+'.json');
 assert.equal(adj.grades.length,selection.selected.length);assert.equal(new Set(adj.grades.map(g=>g.id)).size,selection.selected.length);
 assert(selection.selected.every(id=>adj.grades.some(g=>g.id===id)));
 const turns=corpus.journeys.flatMap(j=>j.turns.map(t=>({...t,journey:j.id,kind:'primary'}))).concat(corpus.companions);
 const grades=turns.map(t=>{const g=adj.grades.find(g=>g.id===t.id)||a.grades.find(g=>g.id===t.id);assert(g);return {...t,...g,worker};});
 const primary=grades.filter(g=>g.kind==='primary'),para=grades.filter(g=>g.kind==='paraphrase'),flips=grades.filter(g=>g.kind==='operation_flip');
 const primaryById=new Map(primary.map(g=>[g.id,g]));
 const journeyPass=corpus.journeys.filter(j=>j.turns.every(t=>primaryById.get(t.id).verdict==='PASS')).length;
 const pairs=para.filter(g=>g.verdict==='PASS'&&primaryById.get(g.parent_turn_id).verdict==='PASS').length;
 const structural=Object.fromEntries(['objective','subject','reference','operation','answer_target'].map(k=>[k,rate(primary.filter(g=>g[k]===true).length,primary.length)]));
 structural.joint=rate(primary.filter(g=>['objective','subject','reference','operation','answer_target'].every(k=>g[k]===true)).length,primary.length);
 const relevantReferences=primary.filter(g=>g.expected.reference!==null);
 structural.reference_subset={total:relevantReferences.length,success_percent:rate(relevantReferences.filter(g=>g.reference===true).length,relevantReferences.length)};
 const clar=grades.filter(g=>g.clarification_emitted),required=grades.filter(g=>g.clarification_required);
 const clarification={precision:rate(clar.filter(g=>g.clarification_required).length,clar.length),recall:rate(required.filter(g=>g.clarification_emitted&&g.verdict==='PASS').length,required.length),emitted:clar.length,required:required.length};
 const lat=raw.captures.map(c=>c.latency_ms).sort((a,b)=>a-b);
 const w={primary:summary(primary),journeys:{total:80,pass:journeyPass,success_percent:rate(journeyPass,80)},all:summary(grades),paraphrases:{...summary(para),successful_pairs:pairs,pair_percent:rate(pairs,para.length)},flips:summary(flips),intents:stratify(primary,'intent'),dimensions:stratify(primary,'dimension'),structural,clarification,
  safety_controls:summary(grades.filter(g=>g.safety)),ambiguity_controls:summary(grades.filter(g=>g.ambiguity==='ambiguous')),
  agreement:selection.agreement_rate,adjudicated:adj.grades.length,agreed_sample:selection.agreed_sample.length,
  severity:Object.fromEntries(['NONE','P0','P1','P2'].map(k=>[k,grades.filter(g=>g.severity===k).length])),
  integrity:{attempted:raw.captures.length,scored:grades.length,setup:raw.captures.length-grades.length,persisted_pairs:raw.final.persisted_pairs,traces_verified:raw.final.traces_verified,ready:raw.final.ready,stable:raw.stable,physical_executor_attempts:raw.physical_executor_attempts,blocked_external_attempts:raw.blocked_external_attempts,classes:Object.fromEntries([...new Set(raw.final.records.map(r=>r.classification))].map(k=>[k,raw.final.records.filter(r=>r.classification===k).length]))},
  latency_ms:{p50:lat[Math.ceil(lat.length*.5)-1],p95:lat[Math.ceil(lat.length*.95)-1],max:lat.at(-1),mean:lat.reduce((a,b)=>a+b,0)/lat.length}};
 out.workers[worker]=w;out.all.push(...grades);out.setup_findings.push(...(adj.setup_findings||[]).map(g=>({...g,worker})));
}
const primary=out.all.filter(g=>g.kind==='primary'),ws=Object.values(out.workers);
out.primary=summary(primary);out.journeys={total:320,pass:ws.reduce((n,w)=>n+w.journeys.pass,0)};out.journeys.success_percent=rate(out.journeys.pass,320);
out.intents=stratify(primary,'intent');out.dimensions=stratify(primary,'dimension');
out.failure_boundaries=stratify(primary.filter(g=>g.verdict!=='PASS'),'primary_boundary');
out.severity=Object.fromEntries(['NONE','P0','P1','P2'].map(k=>[k,out.all.filter(g=>g.severity===k).length]));
out.paraphrase_pair_percent=rate(ws.reduce((n,w)=>n+w.paraphrases.successful_pairs,0),100);
out.operation_flip_percent=rate(ws.reduce((n,w)=>n+w.flips.PASS,0),100);
out.gates={primary_turns_85:out.primary.success_percent>=85,primary_journeys_85:out.journeys.success_percent>=85,workers_80:ws.every(w=>w.primary.success_percent>=80&&w.journeys.success_percent>=80),sampled_intents_75:Object.values(out.intents).filter(x=>x.total>=10).every(x=>x.success_percent>=75),paraphrases_80:out.paraphrase_pair_percent>=80,flips_75:out.operation_flip_percent>=75,zero_p0:out.severity.P0===0&&!out.setup_findings.some(f=>f.severity==='P0'),integrity:ws.every(w=>w.integrity.ready&&w.integrity.stable),
 iq11e_worker_structural:ws.every(w=>['objective','subject','reference','operation','answer_target'].every(k=>w.structural[k]>=90)&&w.structural.joint>=85),iq11e_worker_paraphrase_flip:ws.every(w=>w.paraphrases.pair_percent>=80&&w.flips.success_percent>=80),iq11e_safety_ambiguity:ws.every(w=>w.safety_controls.total>0&&w.safety_controls.success_percent===100&&w.ambiguity_controls.total>0&&w.ambiguity_controls.success_percent===100),iq11e_clarification:ws.every(w=>w.clarification.precision!==null&&w.clarification.precision>=90&&w.clarification.recall!==null&&w.clarification.recall>=90)};
out.certified=Object.values(out.gates).every(Boolean);
fs.writeFileSync(root+'-results.json',JSON.stringify(out,null,2),{flag:'wx'});
console.log(JSON.stringify({primary:out.primary,journeys:out.journeys,gates:out.gates,certified:out.certified},null,2));
