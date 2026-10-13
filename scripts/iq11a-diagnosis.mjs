// Analysis of frozen evidence only. Manual causal labels, not a new evaluator.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const input='artifacts/intelligence-quality-v1-iq10f-';
const output='artifacts/intelligence-quality-v1-iq11a-';
const taxonomy={
 O:{boundary:'OBJECTIVE_RECOGNITION',owner:'SemanticFrameParser / languageUnderstanding / answerTarget',source:'src/oyi-core/interpretation/SemanticFrameParser.ts',mechanism:'Requested speech act/operation is replaced before governed handling.'},
 S:{boundary:'SUBJECT_SCOPE_BINDING',owner:'conceptBridge / scopeProvenance / conversationAssessmentContext',source:'src/oyi-core/response/scopeProvenance.ts',mechanism:'Lexical domain, negated noun or incomplete subject tuple displaces the requested subject/scope.'},
 C:{boundary:'MULTITURN_REFERENCE_CONTINUITY',owner:'followUpResolver / resultSetContext / publicOpportunityObjective / conversationAssessmentContext',source:'src/oyi-core/interpretation/followUpResolver.ts',mechanism:'An available prior entity/fact/operation is not carried to this follow-up, or stale context steals a new request.'},
 R:{boundary:'CAPABILITY_ROUTING',owner:'CapabilityService / capability supports and registry precedence',source:'src/oyi-core/capabilities/CapabilityService.ts',mechanism:'Recognized domain reaches a selected-object/other capability instead of an available governed collection/operation.'},
 E:{boundary:'EVIDENCE_SELECTION',owner:'ResultEnvelope normalization / projector filtering / evidence planner',source:'src/oyi-core/response/projector.ts',mechanism:'Available governed records are incorrectly filtered or a requested evidence population is incompletely selected.'},
 J:{boundary:'JUDGMENT_ADMISSION',owner:'planner admission / deterministic judgment / targetedJudgment',source:'src/oyi-core/response/targetedJudgment.ts',mechanism:'A narrow factual, safety or explanatory job is admitted to an inappropriate assessment/ranking policy.'},
 T:{boundary:'ANSWER_TARGETING',owner:'answerTarget / followUpResolver facet extraction',source:'src/oyi-core/response/answerTarget.ts',mechanism:'Correct or recoverable subject is paired with an incorrect/incomplete requested facet or predicate.'},
 P:{boundary:'RESPONSE_COMPOSITION',owner:'envelopeMappers / canonical projector / targetedJudgment',source:'src/oyi-core/response/projector.ts',mechanism:'The governed subject/evidence reaches presentation but material answer fields/limitations are not communicated.'},
 A:{boundary:'ACTION_CANCELLATION_GOVERNANCE',owner:'ConversationOrchestrator / workflow and action services',source:'src/oyi-core/orchestration/ConversationOrchestrator.ts',mechanism:'An action lifecycle invariant demonstrably fails after correct intent/target admission.'},
 L:{boundary:'GENUINE_CAPABILITY_LIMITATION',owner:'Existing governed capability/product contract',source:'src/oyi-core/capabilities/CapabilityRegistry.ts',mechanism:'The expected outcome genuinely requires absent functionality, rather than an available explanation or honest limitation.'},
 I:{boundary:'EVALUATION_INFRASTRUCTURE_DEFECT',owner:'Certification fixture authority specification / foundation permissions',source:'src/core/foundation/permissions.ts',mechanism:'The restricted actor fixture leaves a role with implicit grants; the frozen revocation premise is not exercised.'}
};
// Indices are one-based positions in each author's frozen 80-primary sequence.
// PASS positions deliberately omitted. Labels are independently inspectable;
// no utterance rules are added to runtime or used to change frozen grades.
const labels={
 OMA:'1E 2C 3C 4C 6J 7C 8C 9T 11P 12S 13J 14T 16T 17E 18C 19C 20O 21T 22O 23J 24T 25P 26C 27O 28J 29O 30O 31S 32S 35T 36J 37C 40S 42S 45O 46C 47S 48P 49R 50S 51C 52S 53C 54C 55O 56S 57S 58R 60O 63S 64J 68T 69T 70T 71S 72C 73S 74S 75O 76S 77O 78T 79T 80C',
 OSA:'1S 2C 3C 4C 5C 6S 7C 8C 9S 10J 11C 12C 13C 14O 16S 17S 18C 19C 20C 21C 22C 23C 24C 28P 29C 30O 31S 32C 33S 34C 35S 36S 37C 38S 39J 40O 41P 43S 45S 46S 47C 48C 49S 50S 51S 52C 53C 54P 55J 56S 57S 58P 59C 60C 63C 64T 65S 66C 67C 68C 69C 70C 71O 72C 73S 75S 76C 77C 78J 79C 80C',
 FACILITY:'1S 2C 3T 4C 5S 7S 8C 9J 11S 13O 15P 16C 17P 18C 19P 20C 21T 22C 23C 24C 25P 27J 28O 29O 30O 31C 32S 33P 34C 35C 36C 40S 41T 43O 44C 45P 47E 48C 49S 52O 53T 55O 56S 57S 59O 60C 61C 62O 63P 64C 65S 68C 70S 71J 72S 73S 75S 76C 77P 79C 80O',
 CONSUMER:'1S 3P 4C 5C 6C 7J 8C 9P 10S 12O 13P 14C 16C 19C 21S 22C 23T 24E 25O 26S 27O 29O 30C 32C 34C 36C 38C 39T 40T 41P 42O 45S 46C 47C 48S 50C 51C 52T 53C 55T 56C 57P 58O 60O 61C 62O 63I 64S 65E 66S 67C 68J 69C 70S 71C 72C 73O 76O 77C 80C'
};
const frozen=JSON.parse(fs.readFileSync(input+'scores.json'));
const records=[];
for(const worker of Object.keys(labels)){
 const corpus=JSON.parse(fs.readFileSync(input+'author-'+worker+'.json'));
 const raw=gunzipSync(fs.readFileSync(input+'first-'+worker+'.jsonl.gz')).toString().trim().split('\n').map(JSON.parse);
 const cases=corpus.journeys.flatMap(j=>j.turns);
 const mapping=new Map(labels[worker].split(/\s+/).filter(Boolean).map(t=>{const m=t.match(/^(\d+)([A-Z])$/);assert(m);return[Number(m[1]),m[2]];}));
 for(const [index,c]of cases.entries()){
  const g=frozen.rows.find(r=>r.worker===worker&&r.id===c.id);assert(g);
  if(g.verdict==='PASS'){assert(!mapping.has(index+1));continue;}
  const code=mapping.get(index+1);assert(code,worker+' '+(index+1)+' '+c.id);const def=taxonomy[code];assert(def);
  const r=raw.find(x=>x.scored&&x.id===c.id),e=r.response?.execution||{},v=e.orchestrator_v2||{},f=v.semantic_frame||{};
  const prior=raw.filter(x=>x.run_id===r.run_id&&raw.indexOf(x)<raw.indexOf(r));
  records.push({id:c.id,worker,primary_sequence:index+1,frozen_verdict:g.verdict,frozen_severity:g.severity,
   expected:c.expected,actual_answer:r.response?.answer??null,frozen_grading_rationale:g.rationale,
   primary_boundary:def.boundary,mechanism:def.mechanism,canonical_owner:def.owner,source_owner:def.source,
   confidence:code==='I'?'demonstrated_fixture_contract_mismatch':'observed_boundary_divergence_source_supported_diagnosis_not_counterfactual_proof',
   qualification:'Primary denotes the earliest supported divergence selected from this captured path, after any downstream recovery; not proof that every contributing internal step is observable. Scores remain frozen.',
   frame:f,selected_capability:r.response?.capability_key??null,authority:v.capability_authority??v.resolved_turn?.authority??null,
   assessment:{objective:e.assessment_context?.objective??null,subject:e.assessment_context?.subject_domains??null,status:e.assessment_status??null,plan:e.assessment_context?.evidence_plan??null},
   secondary_observations:[
    ...(['O','S','C'].includes(code)&&['business_surface.fallback','business_surface.out_of_scope','canonical.conversation.unsupported'].includes(r.response?.capability_key)?['Upstream interpretation/context reaches fallback rather than evidence for the requested subject.']:[]),
    ...(e.assessment_context?.evidence_plan&&['O','S','C','T'].includes(code)?['Assessment evidence is present, but its availability alone does not establish relevance to this request.']:[]),
    ...(g.rationale?.includes('no action')||g.rationale?.includes('no mutation')?['No action observed is safety evidence only; it does not establish correct action understanding.']:[])
   ],
   available_authorized_evidence:{response_facts:r.response?.facts??[],context_prior_case_ids:prior.map(x=>x.id),fixture_spec:'docs/INTELLIGENCE_QUALITY_V1_IQ10F_AUTHOR_SPEC.md',note:'Snapshot/public supplied facts are distinct from actually retrieved evidence. A declared unavailable source caused by misrouting is not classified as genuine capability debt.'},
   trace_id:r.trace?.trace_id??r.response?.execution?.durable_trace?.trace_id??null,request_id:r.request_id,run_id:r.run_id,
   evidence_reference:{file:input+'first-'+worker+'.jsonl.gz',id:r.id,run_id:r.run_id,scored:true}});
 }
 assert.equal(mapping.size,records.filter(x=>x.worker===worker).length);
}
assert.equal(records.length,256);assert.equal(records.filter(x=>x.frozen_verdict==='FAIL').length,188);assert.equal(records.filter(x=>x.frozen_verdict==='PARTIAL').length,68);
const count=rr=>Object.fromEntries(Object.values(taxonomy).map(t=>[t.boundary,rr.filter(r=>r.primary_boundary===t.boundary).length]));
const out={starting_head:'fcb6df6b08b11e81b324eea5e33a844cde104115',runtime:'46efdbbae5ad3090c389cf9ddc799f15e00e68e3',frozen_score_sha256:createHash('sha256').update(fs.readFileSync(input+'scores.json')).digest('hex'),denominator:{primary:320,pass:64,partial:68,fail:188,nonpass:256},taxonomy,primary_counts:count(records),workers:Object.fromEntries(Object.keys(labels).map(w=>[w,count(records.filter(r=>r.worker===w))])),records};
const serialized=JSON.stringify(out,null,2);
if(process.argv.includes('--verify')) assert.equal(fs.readFileSync(output+'primary-failure-map.json','utf8'),serialized);
else fs.writeFileSync(output+'primary-failure-map.json',serialized);
console.log(JSON.stringify({counts:out.primary_counts,workers:out.workers},null,2));
