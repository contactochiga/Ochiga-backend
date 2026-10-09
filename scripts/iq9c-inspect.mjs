// Read-only projection of the sealed capture for source-aware diagnosis, not regrading.
import fs from 'node:fs';
const base='artifacts/intelligence-quality-v1-iq9b';
const result=JSON.parse(fs.readFileSync(base+'-result.json'));
const raw=JSON.parse(fs.readFileSync(base+'-first-contact-raw.json')).records;
const expected=JSON.parse(fs.readFileSync(base+'-expectations.json')).items;
const worker=process.argv[2],id=process.argv[3];
if(id==='compact'){
 for(const g of result.final_grades.filter(g=>g.worker===worker&&g.kind==='primary'&&!['MEETS_TARGET','CORRECT_LIMITATION','CORRECT_REFUSAL'].includes(g.verdict))){
  const n=Number(g.id.slice(-3));if(n<Number(process.argv[4]||0)||n>Number(process.argv[5]||999))continue;
  const r=raw.find(x=>x.id===g.id),t=r.turns.at(-1),v=t.response?.execution?.orchestrator_v2||{},s=v.semantic_frame||{},a=s.answerTarget||{};
  console.log(`${g.id} [${r.turns.length-1} prior] ${t.prompt}\nPATH ${s.domain}/${s.operation}/${s.cognitiveObjective}; ${a.response_intent}:${a.object}:${a.facet}:${a.subject_scope}; ${v.capability_key}/${v.resolution_outcome}\nANSWER ${t.response?.answer?.slice(0,180)}\nREVIEW ${g.reason}\n`);
 }
 process.exit(0);
}
for(const g of result.final_grades.filter(g=>g.worker===worker&&(id?g.id.endsWith(id):g.kind==='primary'&&!['MEETS_TARGET','CORRECT_LIMITATION','CORRECT_REFUSAL'].includes(g.verdict)))){
 const r=raw.find(x=>x.id===g.id),e=expected.find(x=>x.id===g.id);
 console.log('\n'+g.id+' '+g.intent+' '+g.severity);
 for(const t of r.turns){const v=t.response?.execution?.orchestrator_v2||{},s=v.semantic_frame||{},a=s.answerTarget||{};
  if(!id&&!t.scored)continue;
  console.log(JSON.stringify({i:t.index,q:t.prompt,answer:id?t.response?.answer:t.response?.answer?.slice(0,450),domain:s.domain,op:s.operation,objective:s.cognitiveObjective,concepts:s.concepts,answerTarget:id?a:{intent:a.response_intent,object:a.object,facet:a.facet,scope:a.subject_scope},cap:v.capability_key,resolution:v.resolution_outcome,authority:v.capability_authority,evidence:t.response?.context?.module_facts,workflow:id?t.response?.execution:null}));
  if(id)console.log('THREAD',JSON.stringify(t.thread_metadata));
 }
 console.log('REVIEW',g.reason);if(id)console.log('EXPECTED',JSON.stringify(e.expected));
}
