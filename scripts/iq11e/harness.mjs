// Offline, recorded-candidate comparison. No transport, database or adoption hook.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
import {ROOT,hash,checkPacket,validateCandidate,candidateSchema} from './contract.mjs';

const sourceFiles=['interpretation/SemanticFrameParser','runtime/languageUnderstanding','interpretation/LanguageNormalizer','interpretation/ReferenceResolver','interpretation/TemporalResolver','interpretation/conceptBridge','interpretation/conceptLexicon','interpretation/semanticObjective','interpretation/domainVocabulary','response/answerTarget','response/disclosureConstraint'].map(x=>path.join(ROOT,'src/oyi-core',x+'.ts'));
export function deterministicBaseline(packet){
 const errors=checkPacket(packet);if(errors.length)throw Error('invalid_synthetic_packet:'+errors.join(','));
 const cache=new Map(),fixed=Date.parse(packet.now);
 class FixtureDate extends Date{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}}
 function load(file){if(!sourceFiles.includes(file))throw Error('offline_import_boundary');if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const require=specifier=>{if(!specifier.startsWith('.'))throw Error('offline_import_boundary');return load(path.resolve(path.dirname(file),specifier)+'.ts');};
  // Only reviewed repository modules execute. Candidates are JSON data, never VM code.
  vm.runInNewContext(js,{module,exports:module.exports,require,Date:FixtureDate},{timeout:1000,contextCodeGeneration:{strings:false,wasm:false}});return module.exports;
 }
 const parser=load(sourceFiles[0]);const sandbox={parse:parser.parseSemanticFrame,text:packet.utterance,options:{surface:packet.surface,activeAssessment:packet.active_objective!==null},result:null};
 vm.runInNewContext('result=parse(text,options)',sandbox,{timeout:1000,contextCodeGeneration:{strings:false,wasm:false}});
 return JSON.parse(JSON.stringify(sandbox.result));
}
export const sourceManifest=()=>sourceFiles.map(p=>({path:path.relative(ROOT,p),sha256:hash(fs.readFileSync(p,'utf8'))}));

// Inert recorded receipt interface for a future, separately approved exporter.
// Late/duplicate/conflicting receipt handling does not retry or execute anything.
export function compareRecorded(packet,baseline,receipt,locks={},deadlineMs=3000){
 const baselineHash=hash(baseline);let state='missing',validation=null;
 if(!Number.isFinite(deadlineMs)||deadlineMs<=0||deadlineMs>3000)throw Error('invalid_deadline');
 if(receipt){
  if(!['request_id','input_hash','context_epoch','status','elapsed_ms','candidate'].every(k=>Object.hasOwn(receipt,k))||Object.keys(receipt).some(k=>!['request_id','input_hash','context_epoch','status','elapsed_ms','candidate'].includes(k)))state='invalid_receipt';
  else if(receipt.request_id!==packet.request_id||receipt.input_hash!==hash(packet)||receipt.context_epoch!==packet.context_epoch)state='correlation_mismatch';
  else if(!Number.isFinite(receipt.elapsed_ms)||receipt.elapsed_ms<0)state='invalid_receipt';
  else if(receipt.elapsed_ms>deadlineMs)state='timed_out_late_discarded';
  else if(['timeout','unavailable','error'].includes(receipt.status))state=receipt.status;
  else if(receipt.status!=='ok')state='invalid_receipt';
  else {validation=validateCandidate(receipt.candidate,packet,locks);state=validation.valid?'valid_shadow':'invalid_candidate';}
 }
 if(hash(baseline)!==baselineHash)throw Error('canonical_mutation');
 return {request_id:packet.request_id,input_hash:hash(packet),context_epoch:packet.context_epoch,baseline_hash:baselineHash,candidate_hash:receipt?.candidate?hash(receipt.candidate):null,state,validation,adopted:false,canonical_decision_changed:false,elapsed_ms:receipt?.elapsed_ms??null};
}
export function reconcileRecorded(packets,baselines,receipts,locks={}){
 if(new Set(packets.map(p=>p.request_id)).size!==packets.length)throw Error('duplicate_attempt_id');
 if(packets.some(p=>checkPacket(p).length||!Object.hasOwn(baselines,p.request_id)))throw Error('invalid_attempt_manifest');
 const unexpected=receipts.filter(r=>!packets.some(p=>p.request_id===r.request_id)).length;
 const records=packets.map(p=>{const matches=receipts.filter(r=>r.request_id===p.request_id);const unique=new Set(matches.map(hash));
  if(unique.size>1)return {...compareRecorded(p,baselines[p.request_id],null),state:'conflicting_duplicate',duplicate_count:matches.length-1};
  return {...compareRecorded(p,baselines[p.request_id],matches[0],locks[p.request_id]),duplicate_count:Math.max(0,matches.length-1)};});
 return {attempted:packets.length,accounted:records.length,unexpected_receipts:unexpected,ready:unexpected===0&&records.every(r=>r.state==='valid_shadow'),records,durable_database_correlation:'NOT_RUN_OFFLINE'};
}

// Expected interpretations are complete alternative projections, not partial keyword checks.
const semantics=f=>({objective:f.cognitiveObjective??null,domain:f.domain,operation:f.operation,mutation:f.mutationIntent,target:f.answerTarget?.response_intent,quantity:f.answerTarget?.quantity,scope:f.answerTarget?.subject_scope,fields:[...(f.answerTarget?.requested_fields??[])].sort(),negated:[...(f.answerTarget?.negated_qualifiers??[])].sort(),object:f.answerTarget?.object??null,facet:f.answerTarget?.facet??null,top_n:f.answerTarget?.top_n??null,state:f.answerTarget?.state_concept??null,yes_no:f.answerTarget?.yes_no?.kind??null,qualifiers:[...(f.answerTarget?.qualifier_tokens??[])].sort(),temporal:f.temporalScope??null,hypothetical:f.answerTarget?.hypothetical_process??false,confirmation:f.answerTarget?.confirmation_kind??null});
export function gradeProjection(frame,expectation){
 if(!expectation?.alternatives?.length||expectation.alternatives.length>4)throw Error('invalid_expectation');
 const actual=semantics(frame),keys=Object.keys(actual);
 for(const e of expectation.alternatives)if(keys.some(k=>!Object.hasOwn(e,k))||Object.keys(e).some(k=>!keys.includes(k)))throw Error('incomplete_expectation');
 for(const e of expectation.alternatives){const f=candidateSchema.properties.frame.properties,t=f.answerTarget.properties;
  if(!f.cognitiveObjective.enum.includes(e.objective)||!f.domain.enum.includes(e.domain)||!f.operation.enum.includes(e.operation)||typeof e.mutation!=='boolean'||!t.response_intent.enum.includes(e.target)||!t.quantity.enum.includes(e.quantity)||!t.subject_scope.enum.includes(e.scope)||!t.object.enum.includes(e.object)||!t.facet.enum.includes(e.facet)||!t.state_concept.enum.includes(e.state)||!t.confirmation_kind.enum.includes(e.confirmation)||typeof e.hypothetical!=='boolean'||!Array.isArray(e.fields)||!Array.isArray(e.negated)||!Array.isArray(e.qualifiers))throw Error('invalid_expectation_vocabulary');
 }
 const scored=expectation.alternatives.map(e=>Object.fromEntries(keys.map(k=>[k,JSON.stringify(actual[k])===JSON.stringify(e[k])])));
 const pass=scored.some(s=>Object.values(s).every(Boolean));
 return {pass,actual,alternatives:scored,grading_scope:'STRUCTURAL_PROJECTION_ONLY; references, dialogue, evidence and response quality need separate grading'};
}

export function corpusReadiness(cases){
 const failures=[],workers=['Oma','Osa','Facility','Consumer'];
 if(new Set(cases.map(c=>c.id)).size!==cases.length)failures.push('duplicate_ids');
 if(cases.some(c=>!workers.includes(c.worker)||!['primary','paraphrase','flip'].includes(c.kind)))failures.push('invalid_classification');
 for(const w of workers){const rows=cases.filter(c=>c.worker===w),primary=rows.filter(c=>c.kind==='primary');
  if(primary.length<160)failures.push(w+':primary');
  const journeys=new Map();for(const r of primary){if(!r.journey_id||!Number.isInteger(r.turn)||r.turn<1)failures.push(w+':journey_metadata');if(!journeys.has(r.journey_id))journeys.set(r.journey_id,[]);journeys.get(r.journey_id).push(r.turn);}
  if(journeys.size<80||[...journeys.values()].some(v=>v.length<2||new Set(v).size!==v.length))failures.push(w+':multi_turn');
  for(const kind of ['paraphrase','flip'])if(rows.filter(c=>c.kind===kind).length<25)failures.push(w+':'+kind);
 }
 for(const c of cases){if(!c.author_id||c.independence_declared!==true)failures.push('missing_authorship');if(c.kind!=='primary'&&!cases.some(p=>p.id===c.parent_id&&p.kind==='primary'&&p.worker===c.worker))failures.push('invalid_companion_parent');}
 return {ready:failures.length===0,failures:[...new Set(failures)],counts:Object.fromEntries(['primary','paraphrase','flip'].map(k=>[k,cases.filter(c=>c.kind===k).length])),note:'Composition only; declarations do not prove authorship isolation, rubric validity or genuine conversational continuity.'};
}

// Applies frozen gates to externally adjudicated rows; does NOT invent grades.
export function qualityGates(rows){
 const composition=corpusReadiness(rows);if(rows.some(r=>!['PASS','PARTIAL','FAIL','INFRASTRUCTURE_BLOCKED'].includes(r.verdict)||!['none','P0','P1','P2'].includes(r.severity)))throw Error('invalid_grade');
 const rate=a=>({pass:a.filter(r=>r.verdict==='PASS').length,total:a.length,rate:a.length?a.filter(r=>r.verdict==='PASS').length/a.length:null});
 const primary=rows.filter(r=>r.kind==='primary'),journeys=new Map();for(const r of primary){const key=r.worker+':'+r.journey_id;if(!journeys.has(key))journeys.set(key,[]);journeys.get(key).push(r);}
 const journeyRows=[...journeys.values()].map(a=>({worker:a[0].worker,verdict:a.every(r=>r.verdict==='PASS')?'PASS':'FAIL'}));
 const overall=rate(journeyRows),workers={};
 for(const worker of ['Oma','Osa','Facility','Consumer']){
  const w=rows.filter(r=>r.worker===worker),dimensions={};for(const k of ['objective','subject','reference','operation','target']){const v=w.filter(r=>typeof r.metrics?.[k]==='boolean');dimensions[k]={correct:v.filter(r=>r.metrics[k]).length,total:v.length,rate:v.length?v.filter(r=>r.metrics[k]).length/v.length:null};}
  const pairs=w.filter(r=>r.kind==='paraphrase').map(r=>({verdict:r.verdict==='PASS'&&rows.find(p=>p.id===r.parent_id)?.verdict==='PASS'?'PASS':'FAIL'}));
  workers[worker]={scored_turns:w.length,primary:rate(journeyRows.filter(r=>r.worker===worker)),dimensions,paraphrase:rate(pairs),flip:rate(w.filter(r=>r.kind==='flip'))};
 }
 const intents={};for(const r of primary){if(!r.expected_intent||!candidateSchema.properties.frame.properties.answerTarget.properties.response_intent.enum.includes(r.expected_intent))throw Error('invalid_expected_intent');if(!intents[r.expected_intent])intents[r.expected_intent]=[];intents[r.expected_intent].push(r);}
 for(const k of Object.keys(intents)){const s=rate(intents[k]);intents[k]={...s,qualified:s.total>=10&&s.rate>=.75};}
 const blocked=rows.filter(r=>r.verdict==='INFRASTRUCTURE_BLOCKED').length,p0=rows.filter(r=>r.severity==='P0').length;
 const structural=Object.values(workers).every(w=>w.primary.rate>=.85&&Object.values(w.dimensions).every(d=>d.total===w.scored_turns&&d.rate>=.9)&&w.paraphrase.rate>=.8&&w.flip.rate>=.8);
 return {composition,overall,workers,intents,p0,infrastructure_blocked:blocked,quality_gates_met:composition.ready&&overall.rate>=.85&&Object.values(workers).every(w=>w.primary.rate>=.8)&&Object.values(intents).every(i=>i.qualified)&&structural&&p0===0&&blocked===0,certification:false,remaining_gates:'Independent authorship/dual grading/adjudication, clarification strata, safety invariants, privacy and durable IQ11C integrity require separately reviewed evidence.'};
}
