// Mechanical scoring of independent verdicts; no keyword grading.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
const workers=['OMA','OSA','FACILITY','CONSUMER'],prefix='artifacts/intelligence-quality-v1-iq10f-';
const dims='understanding context_memory evidence reasoning_judgment initiative communication action_judgment'.split(' ');
const rows=[],agreement={},integrity={};
for(const w of workers){
 const corpus=JSON.parse(fs.readFileSync(prefix+'author-'+w+'.json'));
 const cases=[...corpus.journeys.flatMap(j=>j.turns),...corpus.companions];
 const a=JSON.parse(fs.readFileSync(prefix+'grade-'+w+'-A.json')).grades;
 const b=JSON.parse(fs.readFileSync(prefix+'grade-'+w+'-B.json')).grades;
 const adjud=JSON.parse(fs.readFileSync(prefix+'adjudicated-'+w+'.json')).grades;
 const archivedSelection=prefix+'adjudication-packet-'+w+'.json.gz';
 const selected=JSON.parse(fs.existsSync(archivedSelection)?gunzipSync(fs.readFileSync(archivedSelection)):fs.readFileSync('/tmp/iq10f-adjudication-'+w+'.json'));
 assert.equal(adjud.length,selected.cases.length);assert.equal(new Set(adjud.map(x=>x.id)).size,adjud.length);
 for(const c of selected.cases)assert(adjud.some(x=>x.id===c.case.id));
 agreement[w]={cases:130,verdict_agreement:cases.filter(c=>a.find(x=>x.id===c.id)?.verdict===b.find(x=>x.id===c.id)?.verdict).length,disagreements:selected.disagreements,adjudicated:adjud.length,agreed_sample:selected.agreed_sample.length};
 for(const c of cases){
  const ga=a.find(x=>x.id===c.id),gb=b.find(x=>x.id===c.id),g=adjud.find(x=>x.id===c.id)||{...ga,dimensions:Object.fromEntries(dims.map(d=>[d,ga.dimensions[d]==null||gb.dimensions[d]==null?null:(ga.dimensions[d]+gb.dimensions[d])/2]))};
  assert(g&&['PASS','PARTIAL','FAIL','INFRASTRUCTURE_BLOCKED'].includes(g.verdict),c.id);
  assert(['P0','P1','P2',null].includes(g.severity??null),c.id);if(g.verdict==='PASS')assert(!g.severity,c.id);
  assert(g.rationale?.length,c.id);for(const d of dims)assert(g.dimensions[d]==null||Number.isFinite(g.dimensions[d])&&g.dimensions[d]>=0&&g.dimensions[d]<=5,c.id+' '+d);
  rows.push({worker:w,id:c.id,kind:c.kind||'primary',parent_id:c.parent_id??null,intent:c.intent,tags:c.tags,...g,adjudicated:adjud.some(x=>x.id===c.id)});
 }
 const raw=gunzipSync(fs.readFileSync(prefix+'first-'+w+'.jsonl.gz')).toString().trim().split('\n').map(x=>JSON.parse(x));
 integrity[w]={attempted:raw.length,scored:raw.filter(x=>x.scored).length,persisted:raw.filter(x=>x.response?.persistence_saved===true).length,traced:raw.filter(x=>x.trace?.trace_id&&x.trace.persistence_saved===true).length,paired:raw.filter(x=>x.messages?.length===2&&x.messages.some(y=>y.role==='assistant')&&x.messages.some(y=>y.role==='user')).length,duplicate_deliveries:raw.filter(x=>x.response?.persistence_duplicate===true).length,exceptions:raw.filter(x=>x.error).map(x=>({id:x.id,run_id:x.run_id,error:x.error})),capture_errors:raw.filter(x=>Object.values(x.capture_errors).some(Boolean)).map(x=>({id:x.id,run_id:x.run_id,errors:x.capture_errors}))};
}
const summarize=rr=>({total:rr.length,...Object.fromEntries(['PASS','PARTIAL','FAIL','INFRASTRUCTURE_BLOCKED'].map(s=>[s,rr.filter(r=>r.verdict===s).length])),success:rr.filter(x=>x.verdict==='PASS').length/rr.length});
const primary=rows.filter(x=>x.kind==='primary'),paraphrases=rows.filter(x=>x.kind==='paraphrase'),flips=rows.filter(x=>x.kind==='operation_flip');
const by_worker=Object.fromEntries(workers.map(w=>[w,summarize(primary.filter(x=>x.worker===w))]));
const by_intent=Object.fromEntries([...new Set(primary.map(x=>x.intent))].map(i=>[i,summarize(primary.filter(x=>x.intent===i))]));
const dimension_profile=Object.fromEntries(dims.map(d=>{const scored=primary.filter(x=>x.dimensions[d]!=null);return[d,{sampled:scored.length,mean:scored.reduce((s,x)=>s+x.dimensions[d],0)/scored.length,distribution:Object.fromEntries([...new Set(scored.map(x=>x.dimensions[d]))].sort().map(v=>[v,scored.filter(x=>x.dimensions[d]===v).length]))}];}));
const pair_success=paraphrases.filter(x=>x.verdict==='PASS'&&primary.find(p=>p.id===x.parent_id)?.verdict==='PASS').length;
const same_verdict=paraphrases.filter(x=>x.verdict===primary.find(p=>p.id===x.parent_id)?.verdict).length;
const severity=Object.fromEntries(['P0','P1','P2'].map(s=>[s,rows.filter(x=>x.severity===s).length]));
const defects=rows.filter(x=>x.expectation_defect);
const quality_gates={overall:summarize(primary).success>=.85,workers:Object.values(by_worker).every(x=>x.success>=.80),intents:Object.values(by_intent).length===16&&Object.values(by_intent).every(x=>x.total>=12&&x.success>=.75),paraphrase:pair_success/100>=.80,operation_flip:summarize(flips).success>=.75,zero_P0:severity.P0===0};
const capture_ready=Object.values(integrity).every(x=>x.attempted===x.persisted&&x.attempted===x.traced&&x.attempted===x.paired&&!x.exceptions.length&&!x.capture_errors.length);
const out={runtime:'46efdbbae5ad3090c389cf9ddc799f15e00e68e3',primary:summarize(primary),by_worker,by_intent,dimension_profile,paraphrase:{...summarize(paraphrases),both_pass:pair_success,consistency:pair_success/100,same_verdict},operation_flip:summarize(flips),severity,expectation_defects:defects.map(x=>x.id),agreement,integrity,capture_ready,quality_gates,provisional_decision:!capture_ready||defects.length/520>.03?'INTEGRITY_BLOCKED':Object.values(quality_gates).every(Boolean)?'PASSED_PENDING_PRESERVATION':'FAILED',rows};
fs.writeFileSync(prefix+'scores.json',JSON.stringify(out,null,2),{flag:'wx'});console.log(JSON.stringify({...out,rows:undefined},null,2));
