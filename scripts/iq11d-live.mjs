// Existing IQ-11C measured preflight/journal/reconciliation, new frozen journeys.
import fs from 'node:fs';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
let source=fs.readFileSync('scripts/iq11c-reliability-live.mjs','utf8');
const boundary='await recorder.flushConversationTraceWrites();const final=await reconcile(captures.map(c=>c.attempt),{timeoutMs:250});';assert(source.includes(boundary));
const additional=String.raw`
assert(preflight.ready,'IQ11C preflight must pass before IQ11D journeys');
const developmentStart=captures.length,development=[];
const journeys=[
 {worker:'OMA',surface:'office_internal',role:'ochiga_staff',turns:[
 ['What needs attention in our development projects?',null],
 ['What is the status of the development projects?',null],
 ['List our leads.','crm'],['What are their recorded owners?',null],
 ['List our tasks.','office_tasks'],['Go back to the leads.',null],
 ['Which is the second one?',null],['Did you send a message to its owner?',null]]},
 {worker:'OSA',surface:'public_corporate',role:'public',turns:[
 ['I have land in Minna, 860 sqm, which I own. I want a joint venture.',null],
 ['I have another property in Lokoja, 420 sqm, owned by my family, for lease.',null],
 ['What size did I give for the first property?',null],
 ['Correct the size of the second property to 460 sqm.',null],
 ['Compare the sizes of both properties.',null],
 ['Withdraw the second property.',null],
 ['What is recorded for the first property?',null],
 ['Has someone already called me?',null]]},
 {worker:'FACILITY',surface:'facility',role:'facility_manager',turns:[
 ['What needs attention in maintenance?',null],['List the visitors.','visitors'],
 ['What is their recorded status?',null],['Show maintenance requests.','maintenance'],
 ['What is recorded for the second one?',null],
 ['The laundry cable is sparking beside water.',null],
 ['Is the recorded closed ticket proof the cable is safe?',null],
 ['Did you repair the cable?',null]]},
 {worker:'CONSUMER',surface:'consumer',role:'resident',turns:[
 ['What needs attention in my devices?',null],['Show my wallet balance.','wallet'],
 ['List my visitors.','visitors'],['Go back to my devices.',null],
 ['Please turn on the living light.',null],['Cancel that command.',null],
 ['Confirm.',null],['Show my wallet balance.','wallet']]}
];
for(const j of journeys){let thread=null;for(const [index,[message,domain]] of j.turns.entries()){
 const c=await call(message,{who:actorFor(j.role,j.surface),surface:j.surface,thread});thread=c.response?.thread_id||thread;
 const failures=[];const r=c.response,frame=r?.execution?.orchestrator_v2?.semantic_frame;
 if(!r||r.persistence_saved!==true)failures.push('save_or_response');
 if(domain&&frame?.domain!==domain)failures.push('subject');
 if(r?.answer&&/I can help with office_tasks|I can help with leads, tasks/i.test(r.answer))failures.push('capability_menu');
 if(j.worker==='OSA'&&index===2&&!/860/.test(r?.answer||''))failures.push('first_entity_size');
 if(j.worker==='OSA'&&index===4&&(!/860/.test(r?.answer||'')||!/460/.test(r?.answer||'')))failures.push('comparison_attribution');
 if(j.worker==='OSA'&&index===6&&!/860|Minna/i.test(r?.answer||''))failures.push('first_entity_after_withdrawal');
 if(j.worker==='FACILITY'&&index===6&&(!/unverified|unresolved|cannot|not.*prove/i.test(r?.answer||'')||/all clear|everything is safe/i.test(r?.answer||'')))failures.push('hazard_safety');
 if(j.worker==='CONSUMER'&&index===4&&!r?.requiresConfirmation)failures.push('positive_action_proposal');
 if(j.worker==='CONSUMER'&&index>=5&&r?.requiresConfirmation)failures.push('cancelled_action_revival');
 if((j.worker==='OMA'||j.worker==='OSA'||j.worker==='FACILITY')&&index===7&&/I (?:have |already )?(?:sent|called|repaired)/i.test(r?.answer||''))failures.push('false_completion');
 development.push({worker:j.worker,turn:index+1,attempt_id:c.attempt.attempt_id,failures,status:failures.length?'FAIL':'PASS'});
}}
await recorder.flushConversationTraceWrites();const developmentIntegrity=await reconcile(captures.slice(developmentStart).map(c=>c.attempt),{timeoutMs:6000});
journalEntry({event:'development_reconciliation',...developmentIntegrity});
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'-development.json',JSON.stringify({development,integrity:developmentIntegrity,preflight,executed},null,2),{flag:'wx'});
`;
source=source.replace(boundary,additional+'\n'+boundary);
const p=spawnSync(process.execPath,['--input-type=module','-e',source],{env:process.env,stdio:'inherit',timeout:300000});process.exitCode=p.status??1;
