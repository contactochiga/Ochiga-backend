// Read-only inspection of frozen IQ-10F evidence. Never calls the runtime.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const prefix='artifacts/intelligence-quality-v1-iq10f-';
const worker=process.argv[2],start=Number(process.argv[3]||0),end=Number(process.argv[4]||80);
const scores=JSON.parse(fs.readFileSync(prefix+'scores.json'));
const corpus=JSON.parse(fs.readFileSync(prefix+'author-'+worker+'.json'));
const raw=gunzipSync(fs.readFileSync(prefix+'first-'+worker+'.jsonl.gz')).toString().trim().split('\n').map(JSON.parse);
const cases=corpus.journeys.flatMap(j=>j.turns);
for(const [n,c]of cases.entries()){
 if(n<start||n>=end)continue;
 const g=scores.rows.find(x=>x.worker===worker&&x.id===c.id);
 if(g.verdict==='PASS'&&!process.env.IQ11A_INCLUDE_PASS)continue;
 const r=raw.find(x=>x.scored&&x.id===c.id),e=r.response?.execution||{},f=e.orchestrator_v2?.semantic_frame||{};
 console.log(JSON.stringify({n:n+1,id:c.id,verdict:g.verdict,prompt:c.prompt,expected:c.expected.must_include,
 frame:{domain:f.domain,operation:f.operation,objective:f.cognitiveObjective,target:f.answerTarget?{intent:f.answerTarget.response_intent,object:f.answerTarget.object,facet:f.answerTarget.facet,state:f.answerTarget.state_concept,scope:f.answerTarget.subject_scope,compare:f.answerTarget.compare_terms}:null,entity:f.primaryEntity,references:f.references},
 capability:r.response?.capability_key,authority:e.orchestrator_v2?.capability_authority,scope:e.orchestrator_v2?.resolved_turn?.scope,
 assessment:e.assessment_context?{objective:e.assessment_context.objective,subject:e.assessment_context.subject_domains,label:e.assessment_context.subject_label,status:e.assessment_status,material:e.assessment_context.material_information,plan:e.assessment_context.evidence_plan?.classes}:null,
 evidence_count:r.response?.facts?.length,trace:r.trace?{domain:r.trace.domain,operation:r.trace.operation,terminal:r.trace.terminal_outcome,admission:r.trace.planner_admission_reason}:null,
 answer:r.response?.answer?.startsWith('I can help with leads that need attention')?'[Office capability menu]':r.response?.answer,error:r.error,rationale:g.rationale}));
}
