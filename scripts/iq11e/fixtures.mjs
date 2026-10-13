// Hand-authored harness controls only, NOT the future independent corpus.
import {hash} from './contract.mjs';
export function packet(surface='consumer'){
 return {version:1,data_class:'synthetic',request_id:'req-control',context_epoch:'epoch-one',surface,scope_token:'scope-one',now:'2026-10-13T10:00:00Z',utterance:'Show the recorded status of this device.',active_objective:null,prior:[],allowed_fields:['status','location'],entities:[{token:'entity-one',alias:'Synthetic lamp',surface,scope_token:'scope-one',visibility:surface==='public_corporate'?'public_supplied':'authorized_synthetic',expires_at:'2026-10-13T10:30:00Z',withdrawn:false,facts:[{key:'status',value:'unknown',provenance:'recorded_synthetic',expires_at:'2026-10-13T10:30:00Z'}]}]};
}
export function candidate(p=packet()){
 return {version:1,request_id:p.request_id,context_epoch:p.context_epoch,input_hash:hash(p),outcome:'interpreted',uncertainty:{reason:'none',fields:[]},
 frame:{cognitiveObjective:'retrieve',domain:'devices',operation:'device.status',mutationIntent:false,temporalScope:null,answerTarget:{response_intent:'STATUS',quantity:null,subject_scope:'own',object:'device',facet:'status',top_n:null,state_concept:null,yes_no:null,requested_fields:['status'],qualifier_tokens:[],negated_qualifiers:[],hypothetical_process:false,confirmation_kind:null}},discourse:'selection',bindings:[{entity_token:'entity-one',kind:'same_target'}],basis_spans:[{field:'subject',start:0,end:p.utterance.length}]};
}
export const receipt=(p,c=candidate(p),status='ok',elapsed_ms=20)=>({request_id:p.request_id,input_hash:hash(p),context_epoch:p.context_epoch,status,elapsed_ms,candidate:status==='ok'?c:null});

export const dialogueFixtures=[
 {worker:'Oma',surface:'office_internal',turns:['List the leads.','What is their recorded status?']},
 {worker:'Osa',surface:'public_corporate',turns:['I have a synthetic property for lease.','What information have I supplied?']},
 {worker:'Facility',surface:'facility',turns:['List the maintenance requests.','What is their recorded status?']},
 {worker:'Consumer',surface:'consumer',turns:['Show my devices.','What is their recorded status?']}
];
