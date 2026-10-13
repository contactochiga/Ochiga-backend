// Offline qualification contract only. Never imported by src or connected to a provider.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {createHash} from 'node:crypto';

export const ROOT=path.resolve(import.meta.dirname,'../..');
export const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const files={frame:'src/oyi-core/contracts/semanticFrame.ts',target:'src/oyi-core/response/answerTarget.ts',concept:'src/oyi-core/interpretation/conceptBridge.ts',domain:'src/oyi-core/runtime/languageUnderstanding.ts',state:'src/oyi-core/interpretation/conceptLexicon.ts'};
const ast=Object.fromEntries(Object.entries(files).map(([k,p])=>[k,ts.createSourceFile(p,fs.readFileSync(path.join(ROOT,p),'utf8'),ts.ScriptTarget.Latest,true)]));
const alias=(file,name)=>{const n=ast[file].statements.find(x=>ts.isTypeAliasDeclaration(x)&&x.name.text===name);if(!n)throw Error('canonical_type_missing');return n.type;};
const prop=(file,name,key)=>{const n=alias(file,name).members?.find(x=>x.name?.getText(ast[file])===key);if(!n)throw Error('canonical_property_missing');return n.type;};
const literals=n=>{if(ts.isUnionTypeNode(n))return n.types.flatMap(literals);if(ts.isLiteralTypeNode(n)){if(ts.isStringLiteral(n.literal))return [n.literal.text];if(n.literal.kind===ts.SyntaxKind.NullKeyword)return [null];}throw Error('non_literal_canonical_enum');};
const enumeration=(values,nullable=false)=>({enum:[...new Set([...values,...(nullable?[null]:[])])]});
const text=(max=80)=>({type:'string',minLength:1,maxLength:max});
const bool={type:'boolean'};
const timestamp={type:'string',maxLength:32,pattern:'^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2}))?$'};
const array=(items,max=8)=>({type:'array',items,maxItems:max,uniqueItems:true});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const en=(file,name,nullable=false)=>enumeration(literals(alias(file,name)),nullable);
const ep=(file,name,key,nullable=false)=>enumeration(literals(prop(file,name,key)),nullable);
const nullable=s=>({anyOf:[s,{type:'null'}]});
export const canonicalSources=Object.values(files).map(p=>({path:p,sha256:hash(fs.readFileSync(path.join(ROOT,p),'utf8'))}));
export const candidateSchema={
 $schema:'https://json-schema.org/draft/2020-12/schema',title:'IQ11E offline non-authoritative SemanticFrame/AnswerTarget projection',
 ...object({
  version:{const:1},request_id:text(),context_epoch:text(),input_hash:{type:'string',pattern:'^[0-9a-f]{64}$'},
  outcome:enumeration(['interpreted','clarify','unsupported']),
  uncertainty:object({reason:enumeration(['none','ambiguous_target','missing_context','unsupported_contract','uncertain_meaning']),fields:array(enumeration(['objective','subject','operation','reference','scope','time','answerTarget']))}),
  frame:object({cognitiveObjective:en('frame','CognitiveObjective',true),domain:en('domain','OyiDomain',true),operation:en('frame','SemanticOperation'),mutationIntent:bool,
   temporalScope:nullable(object({mode:enumeration(['current','recent','today','yesterday','current_month','range','history']),from:nullable(timestamp),to:nullable(timestamp)})),
   answerTarget:object({response_intent:en('target','ResponseIntent'),quantity:ep('target','AnswerTarget','quantity'),subject_scope:ep('target','AnswerTarget','subject_scope'),object:en('concept','ObjectClass',true),facet:en('concept','Facet'),top_n:nullable({type:'integer',minimum:1,maximum:50}),state_concept:en('state','StateConcept',true),yes_no:nullable(object({kind:en('target','YesNoKind')})),requested_fields:array(text(40)),qualifier_tokens:array(text(40)),negated_qualifiers:array(text(40)),hypothetical_process:bool,confirmation_kind:ep('target','AnswerTarget','confirmation_kind',true)})}),
  discourse:enumeration(['new_subject','same_subject_facet','entity_correction','operation_correction','material_fact','return','selection','comparison','unknown']),
  bindings:array(object({entity_token:text(),kind:enumeration(['pronoun','same_target','other_candidate','candidate_reply'])})),
  basis_spans:array(object({field:enumeration(['objective','subject','operation','reference','scope','time','answerTarget']),start:{type:'integer',minimum:0,maximum:2000},end:{type:'integer',minimum:1,maximum:2000}}))
 })
};

// Small validator for exactly the JSON-Schema keywords emitted above and packet schema below.
// No code evaluation, coercion, silent stripping or default injection.
export function schemaErrors(schema,value,at='$'){
 const errors=[],err=code=>errors.push(at+':'+code);
 if(schema.anyOf){if(!schema.anyOf.some(s=>schemaErrors(s,value,at).length===0))err('anyOf');return errors;}
 if('const' in schema&&value!==schema.const)err('const');
 if(schema.enum&&!schema.enum.includes(value))err('enum');
 if(schema.type){const match=schema.type==='null'?value===null:schema.type==='array'?Array.isArray(value):schema.type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):schema.type==='integer'?Number.isSafeInteger(value):typeof value===schema.type;
  if(!match){err('type');return errors;}}
 if(typeof value==='string'){if(schema.maxLength!==undefined&&value.length>schema.maxLength)err('maxLength');if(schema.minLength!==undefined&&value.length<schema.minLength)err('minLength');if(schema.pattern&&!new RegExp(schema.pattern).test(value))err('pattern');}
 if(typeof value==='number'&&(!Number.isFinite(value)||(schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))err('numberBounds');
 if(Array.isArray(value)){if(value.length>schema.maxItems)err('maxItems');if(schema.uniqueItems&&new Set(value.map(x=>JSON.stringify(x))).size!==value.length)err('duplicate');for(let i=0;i<Math.min(value.length,32);i++)errors.push(...schemaErrors(schema.items,value[i],at+'['+i+']'));}
 if(schema.properties&&value&&typeof value==='object'){for(const key of Object.keys(value))if(!Object.hasOwn(schema.properties,key))err('unknownField');for(const key of schema.required)if(!Object.hasOwn(value,key))err('missingField');for(const [key,s] of Object.entries(schema.properties))if(Object.hasOwn(value,key))errors.push(...schemaErrors(s,value[key],at+'.'+key));}
 return errors;
}
const surface=enumeration(['office_internal','public_corporate','facility','consumer']);
const token={type:'string',pattern:'^[a-z][a-z0-9_-]{0,63}$'};
const fact=object({key:text(40),value:text(160),provenance:enumeration(['caller_supplied_unverified','recorded_synthetic']),expires_at:timestamp});
export const packetSchema=object({version:{const:1},data_class:{const:'synthetic'},request_id:token,context_epoch:token,surface,scope_token:token,now:timestamp,utterance:text(2000),active_objective:en('frame','CognitiveObjective',true),
 prior:array(object({speaker:enumeration(['user','assistant']),text:text(500)}),4),
 allowed_fields:array(text(40),16),
 entities:array(object({token,alias:text(80),surface,scope_token:token,visibility:enumeration(['public_supplied','authorized_synthetic']),expires_at:timestamp,withdrawn:bool,facts:array(fact,4)}))});
const patterns=[/-----BEGIN .*PRIVATE KEY-----/,/\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{12,}/,/\bBearer\s+\S+/i,/\beyJ[\w-]{10,}\.[\w-]+\.[\w-]+/,/\b(?:password|secret|api[_ -]?key)\s*[:=]/i,/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/,/https?:\/\/[^\s/:]+:[^\s/@]+@/];
export function checkPacket(packet){
 const raw=JSON.stringify(packet);if(Buffer.byteLength(raw)>12288)return ['packet_byte_limit'];
 const errors=schemaErrors(packetSchema,packet);if(errors.length)return errors;
 if(patterns.some(p=>p.test(raw)))errors.push('sensitive_material');
 if(!Number.isFinite(Date.parse(packet.now)))errors.push('invalid_time');
 const seen=new Set();for(const e of packet.entities){if(seen.has(e.token))errors.push('duplicate_entity');seen.add(e.token);
  if(e.surface!==packet.surface||e.scope_token!==packet.scope_token)errors.push('scope_mismatch');
  if(packet.surface==='public_corporate'&&e.visibility!=='public_supplied')errors.push('public_private_boundary');
  if(e.withdrawn||!(Date.parse(e.expires_at)>Date.parse(packet.now)))errors.push('inactive_entity');
  for(const f of e.facts)if(!(Date.parse(f.expires_at)>Date.parse(packet.now))||!packet.allowed_fields.includes(f.key))errors.push('inactive_or_unapproved_fact');
 }
 return [...new Set(errors)];
}
export function validateCandidate(candidate,packet,locks={}){
 let raw;try{raw=JSON.stringify(candidate);}catch{return {valid:false,errors:['non_json_candidate']};}
 if(!raw||Buffer.byteLength(raw)>8192)return {valid:false,errors:['candidate_byte_limit']};
 const errors=[...checkPacket(packet),...schemaErrors(candidateSchema,candidate)];if(errors.length)return {valid:false,errors};
 if(candidate.request_id!==packet.request_id||candidate.context_epoch!==packet.context_epoch||candidate.input_hash!==hash(packet))errors.push('correlation_mismatch');
 const f=candidate.frame,t=f.answerTarget;
 if(candidate.outcome==='interpreted'&&(candidate.uncertainty.reason!=='none'||candidate.uncertainty.fields.length))errors.push('uncertain_interpretation');
 if(candidate.outcome!=='interpreted'&&(candidate.uncertainty.reason==='none'||!candidate.uncertainty.fields.length))errors.push('missing_uncertainty');
 if(candidate.outcome==='clarify'&&(t.response_intent!=='CLARIFICATION'||f.operation!=='clarify'))errors.push('clarification_contract');
 if(candidate.outcome==='unsupported'&&t.response_intent!=='LIMITATION')errors.push('unsupported_contract');
 if(f.mutationIntent&&(candidate.outcome!=='interpreted'||t.hypothetical_process||['ACTION_RESULT','ADVICE','NEXT_STEP','REFUSAL','CLARIFICATION','LIMITATION'].includes(t.response_intent)||['approve','reject','cancel'].includes(f.operation)))errors.push('speech_act_conflict');
 if(f.mutationIntent&&!['compose','device.power.on','device.power.off'].includes(f.operation))errors.push('mutation_operation_conflict');
 if(f.operation.startsWith('device.power.')&&(!f.mutationIntent||f.domain!=='devices'))errors.push('device_operation_conflict');
 if(t.response_intent==='ACTION_RESULT'&&['approve','reject','cancel','compose'].includes(f.operation))errors.push('result_command_conflict');
 if(t.confirmation_kind==='cancel'&&f.operation!=='cancel')errors.push('cancel_conflict');
 if(locks.cancelled&&(f.mutationIntent||f.operation==='approve'))errors.push('terminal_cancellation_lock');
 if(locks.hazard&&(f.mutationIntent||f.operation==='approve'))errors.push('hazard_admission_lock');
 if(locks.denied&&(f.mutationIntent||f.operation==='approve'))errors.push('authority_lock');
 if(locks.subject_scope&&t.subject_scope!==locks.subject_scope)errors.push('requested_scope_substitution');
 const objectiveTargets={summarize:['SUMMARY','DIRECT_ANSWER'],assess:['ASSESSMENT','YES_NO_WITH_REASON','SAFETY_RISK'],prioritize:['RANKING','LIMITATION'],compare:['COMPARISON','LIMITATION'],explain:['EXPLANATION','CONFIRMATION_STATE','ACTION_RESULT'],advise:['ADVICE','NEXT_STEP','YES_NO_WITH_REASON'],reassess:['ASSESSMENT','COMPARISON','YES_NO_WITH_REASON']};
 if(candidate.outcome==='interpreted'&&objectiveTargets[f.cognitiveObjective]&&!objectiveTargets[f.cognitiveObjective].includes(t.response_intent))errors.push('objective_target_conflict');
 if(!t.requested_fields.every(x=>packet.allowed_fields.includes(x)))errors.push('unknown_facet');
 if(![...t.qualifier_tokens,...t.negated_qualifiers].every(x=>packet.utterance.toLowerCase().includes(x.toLowerCase())))errors.push('ungrounded_qualifier');
 const seen=new Set();for(const b of candidate.bindings){if(seen.has(b.entity_token))errors.push('duplicate_binding');seen.add(b.entity_token);if(!packet.entities.some(e=>e.token===b.entity_token))errors.push('unknown_reference');}
 if(candidate.outcome==='interpreted'&&['same_subject_facet','entity_correction','return','selection','comparison'].includes(candidate.discourse)&&!candidate.bindings.length)errors.push('missing_binding');
 if(candidate.discourse==='comparison'&&candidate.bindings.length<2)errors.push('missing_comparison_side');
 if(candidate.outcome==='interpreted'&&!candidate.basis_spans.length)errors.push('missing_grounding');
 if(candidate.outcome==='interpreted'&&candidate.discourse==='unknown')errors.push('unknown_discourse');
 for(const s of candidate.basis_spans)if(s.start>=s.end||s.end>packet.utterance.length)errors.push('invalid_span');
 if(f.temporalScope){for(const k of ['from','to'])if(f.temporalScope[k]!==null&&!Number.isFinite(Date.parse(f.temporalScope[k])))errors.push('invalid_temporal_value');if(f.temporalScope.mode==='range'&&(!f.temporalScope.from||!f.temporalScope.to||Date.parse(f.temporalScope.from)>Date.parse(f.temporalScope.to)))errors.push('invalid_range');}
 return {valid:errors.length===0,errors:[...new Set(errors)],adopted:false};
}
