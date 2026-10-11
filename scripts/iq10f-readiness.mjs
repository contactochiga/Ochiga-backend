// Infrastructure gate only. No certification questions or runtime modifications.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const fixture=fs.readFileSync('scripts/iq8f-run.mjs','utf8');
const marker='// IQ-8F certification runner:';
if(!fixture.includes(marker))throw Error('Fixture boundary changed');
const setup=fixture.slice(0,fixture.indexOf(marker)).replaceAll("'../dist/",`'${process.cwd()}/dist/`);
const probe=String.raw`
process.env.OYI_TRACE_REFERENCE_KEY=randomUUID()+randomUUID();
process.env.OYI_CONVERSATION_TRACE_ENABLED='true';unscripted();
const schema=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceSchema.js');
const recorder=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceRecorder.js');
const preflight=await schema.preflightConversationTrace();
const out={runtime:'46efdbbae5ad3090c389cf9ddc799f15e00e68e3',preflight,fixture:'verified loopback 55421',provider:'off',probes:[],inventory:{}};
if(preflight.status==='compatible'){
 for(const [surface,role] of [['office_internal','ochiga_staff'],['public_corporate','public'],['facility','facility_manager'],['consumer','resident']]){
  const actor=actorFor(role,surface),request_id=randomUUID();
  const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,surface),input:{surface,message:'Infrastructure readiness check.',estate_id:actor.estate_id,home_id:actor.home_id,context:{request_id,...(surface==='office_internal'?{operational_snapshot:officeSnapshot()}:{})}}});
  await recorder.flushConversationTraceWrites();
  const q=await db.from('oyi_conversation_traces').select('trace_id,persistence_saved').eq('trace_id',r.execution?.durable_trace?.trace_id).single();
  out.probes.push({surface,request_id,thread_id:r.thread_id,persistence_saved:r.persistence_saved,trace:q.data,trace_error:Boolean(q.error)});
 }
 for(const [table,fields] of [
 ['homes','id,name,estate_id,resident_id'],['rooms','id,name,home_id'],
 ['devices','id,name,home_id,room_id,status,online,last_seen_at'],
 ['maintenance_requests','id,title,status,priority,category,home_id,created_at'],
 ['visitor_access','id,visitor_name,status,home_id,expires_at'],
 ['wallets','id,home_id,balance,currency'],
 ['wallet_transactions','id,home_id,direction,type,amount,status'],
 ['facility_cameras','id,name,location,home_id,status,last_seen_at']]){
   const q=await db.from(table).select(fields).limit(100);out.inventory[table]={records:q.data,error:q.error?.code??null};
 }
}
out.ready=preflight.status==='compatible'&&out.probes.length===4&&out.probes.every(p=>p.persistence_saved&&p.trace?.persistence_saved&&!p.trace_error)&&Object.values(out.inventory).every(x=>!x.error);
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify(out,null,2),{flag:'wx'});
console.log(JSON.stringify({ready:out.ready,preflight,probes:out.probes}));process.exitCode=out.ready?0:1;
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+'\n'+probe],{env:process.env,stdio:'inherit',timeout:60000});process.exitCode=p.status??1;
