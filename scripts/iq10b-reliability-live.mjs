// Isolated synthetic cases only. Reuse fixture setup, never sealed test items.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const fixture=fs.readFileSync('scripts/iq8f-run.mjs','utf8');
const marker='// IQ-8F certification runner:';
if(!fixture.includes(marker))throw Error('Fixture boundary changed');
const setup=fixture.slice(0,fixture.indexOf(marker)).replaceAll("'../dist/",`'${process.cwd()}/dist/`);
const checks=String.raw`
process.env.OYI_TRACE_REFERENCE_KEY=randomUUID()+randomUUID();
process.env.OYI_CONVERSATION_TRACE_ENABLED='true';
const recorder=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceRecorder.js');
const schema=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceSchema.js');
const projection=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceProjection.js');
const {createClient}=require('@supabase/supabase-js');
const {execFileSync}=require('node:child_process');
const checks=[],captures=[];
async function test(id,fn){try{await fn();checks.push({id,status:'PASS'});}catch(e){checks.push({id,status:'FAIL',error:e.message});}console.log(checks.at(-1));}
const rpc=db.rpc.bind(db);
const actor=actorFor('resident','consumer');
const context=(message,thread=null,id=randomUUID())=>({actor,oisContext:oisContext(actor,'consumer'),input:{message,surface:'consumer',thread_id:thread,home_id:actor.home_id,estate_id:actor.estate_id,context:{request_id:id}}});
async function run(message,thread=null,id=randomUUID()){
 const r=await conversationOrchestrator.run(context(message,thread,id));
 await recorder.flushConversationTraceWrites();
 const trace=await db.from('oyi_conversation_traces').select('*').eq('trace_id',r.execution.durable_trace.trace_id).single();
 captures.push({id,message,response:r,trace:trace.data,trace_error:trace.error?.code||null});return r;
}
await test('schema-write-read-canary',async()=>assert.equal((await schema.preflightConversationTrace()).status,'compatible'));
await test('schema-missing-column',async()=>{
 const client={from:()=>({select:()=>db.from('oyi_conversation_traces').select('iq10b_missing_column')})};
 assert.equal((await schema.preflightConversationTrace({client})).status,'missing_migration');
});
await test('preflight-permission-denied',async()=>{
 const q={limit(){return this;},abortSignal:async()=>({error:{code:'42501'}})};
 assert.equal((await schema.preflightConversationTrace({client:{from:()=>({select:()=>q})}})).status,'permission_denied');
});
await test('anonymous-real-trace-and-persistence-denial',async()=>{
 let config;try{config=JSON.parse(execFileSync('npx',['--no-install','supabase','status','--workdir','/tmp/oyi-wave11-supabase-fixture','-o','json'],{stdio:['ignore','pipe','pipe']}));}catch{throw Error('Local anonymous fixture credential unavailable');}
 assert(config.ANON_KEY);
 const anonymous=createClient('http://127.0.0.1:55421',config.ANON_KEY);
 assert.equal((await schema.preflightConversationTrace({client:anonymous})).status,'permission_denied');
 const denied=await anonymous.rpc('oyi_persist_canonical_turn',{p_thread:{},p_user:{},p_assistant:{},p_request_id:null});assert.equal(denied.error?.code,'42501');
});
await test('preflight-database-unavailable',async()=>{
 const client=createClient('http://127.0.0.1:55421',process.env.SUPABASE_SERVICE_ROLE_KEY,{global:{fetch:async()=>{throw Object.assign(Error('isolated outage'),{code:'ECONNRESET'});}}});
 assert.equal((await schema.preflightConversationTrace({client,timeoutMs:150})).status,'database_unavailable');
});
await test('preflight-contract-classification',async()=>assert.equal(schema.classifyTraceSchemaError({code:'23514'}),'contract_mismatch'));
await test('persistence-migration-missing-preflight',async()=>{
 const client={from:db.from.bind(db),rpc:()=>db.rpc('iq10b_missing_persistence_function',{})};
 assert.equal((await schema.preflightConversationTrace({client})).status,'missing_migration');
});
await test('preflight-bounded-outage',async()=>{
 const client=createClient('http://127.0.0.1:55421',process.env.SUPABASE_SERVICE_ROLE_KEY,{global:{fetch:(_input,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('isolated timeout'),{name:'AbortError'})),{once:true}))}});
 const started=Date.now();assert.equal((await schema.preflightConversationTrace({client,timeoutMs:120})).status,'database_unavailable');assert(Date.now()-started<1000);
});
await test('ordinary-assessment-followup-reassessment-denial-unavailable-correlate',async()=>{
 let thread=null;
 for(const message of ['List my home devices.','Tell me about the first one.','Is everything okay at home?','Does that change your assessment?','Show the wallet balance for apartment Q-808.','Teleport my house.']){
  const r=await run(message,thread);thread=r.thread_id;assert.equal(r.persistence_saved,true);assert.equal(r.execution.durable_trace.status,'saved');
  const c=captures.at(-1);assert.equal(c.trace.turn_ref,projection.opaqueReference('turn',c.id));assert.equal(c.trace.persistence_saved,true);
  const rows=await db.from('oyi_conversation_messages').select('metadata').eq('thread_id',thread).eq('metadata->>trace_request_id',c.id);
  assert.equal(rows.data.length,2);assert(rows.data.every(x=>x.metadata.trace_request_id===c.id));
 }
});
await test('confirmation-cancellation-provider-off-correlate',async()=>{
 let thread=null;for(const m of ['Switch on the living light.','Cancel that request.','Yes.']){const r=await run(m,thread);thread=r.thread_id;assert.equal(r.persistence_saved,true);assert.equal(r.execution.durable_trace.status,'saved');}assert.equal(executed,0);
});
await test('multipart-exact-ids-and-trace',async()=>{
 const r=await run('Show my wallet balance and list my devices.');assert.equal(r.persistence_saved,true);
 const rows=await db.from('oyi_conversation_messages').select('metadata,role').eq('thread_id',r.thread_id);
 assert.equal(rows.data.length,2);assert(rows.data.every(x=>x.metadata.trace_request_id===captures.at(-1).id));
 assert(rows.data.every(x=>x.metadata.conversation_request_ids?.length===2));assert.equal(r.execution.durable_trace.status,'saved');
});
await test('compound-withdrawal-history-is-final-answer',async()=>{
 const first=await run('Switch on the living light.');
 const message='Cancel the living-light action, then show my wallet balance.';
 const r=await run(message,first.thread_id);assert.equal(r.persistence_saved,true);
 const rows=await db.from('oyi_conversation_messages').select('role,content,metadata').eq('thread_id',r.thread_id).eq('metadata->>trace_request_id',captures.at(-1).id);
 assert.equal(rows.data.length,2);assert.equal(rows.data.find(x=>x.role==='user').content,message);assert.equal(rows.data.find(x=>x.role==='assistant').content,r.answer);
});
await test('trace-write-failure-visible-and-conversation-independent',async()=>{
 recorder.__setConversationTraceInsertForTests(async()=>{throw {code:'42501'};});
 try{const r=await run('Show my wallet balance.');assert.equal(r.persistence_saved,true);assert.equal(r.execution.durable_trace.status,'failed');assert.equal(captures.at(-1).trace,null);assert.equal(recorder.conversationTraceWriteHealth().status,'failed');}
 finally{recorder.__setConversationTraceInsertForTests(null);}
});
await test('trace-timeout-late-completion-not-saved',async()=>{
 recorder.__setConversationTraceInsertForTests(()=>new Promise(r=>setTimeout(r,2400)));
 try{const r=await run('Show my wallet balance.');assert.equal(r.execution.durable_trace.status,'failed');await new Promise(r=>setTimeout(r,300));assert.equal(r.execution.durable_trace.status,'failed');}
 finally{recorder.__setConversationTraceInsertForTests(null);}
});
await test('transaction-rollback-on-message-failure',async()=>{
 let attemptedThread;
 db.rpc=(name,args)=>{if(name==='oyi_persist_canonical_turn'){attemptedThread=args.p_thread.id;return rpc(name,{...args,p_assistant:{...args.p_assistant,content:null}});}return rpc(name,args);};
 try{const r=await run('Show my wallet balance.');assert.equal(r.persistence_saved,false);assert.match(r.persistence_warning,/not be confirmed/);assert.equal(captures.at(-1).trace.persistence_saved,false);
 const rows=await db.from('oyi_conversation_messages').select('id').eq('thread_id',attemptedThread);assert.equal(rows.data.length,0);
 const th=await db.from('oyi_conversation_threads').select('id').eq('id',attemptedThread);assert.equal(th.data.length,0);}
 finally{db.rpc=rpc;}
});
await test('ambiguous-committed-delivery-retries-once-no-duplicate',async()=>{
 let attempts=0;
 db.rpc=(name,args)=>{if(name!=='oyi_persist_canonical_turn')return rpc(name,args);
  return {abortSignal:async signal=>{const r=await rpc(name,args).abortSignal(signal);if(++attempts===1&&!r.error)return {error:{code:'UND_ERR_SOCKET'}};return r;}};};
 try{const r=await run('Show my wallet balance.');assert.equal(attempts,2);assert.equal(r.persistence_saved,true);assert.equal(r.persistence_duplicate,true);const rows=await db.from('oyi_conversation_messages').select('id').eq('thread_id',r.thread_id);assert.equal(rows.data.length,2);}
 finally{db.rpc=rpc;}
});
await test('save-outage-bounded-and-reconnection',async()=>{
 let attempts=0;db.rpc=(name,args)=>name==='oyi_persist_canonical_turn'?{abortSignal:async()=>{attempts++;return {error:{code:'08006'}};}}:rpc(name,args);
 try{const r=await run('Show my visitors.');assert.equal(r.persistence_saved,false);assert.equal(attempts,2);assert.equal(captures.at(-1).trace.persistence_saved,false);}finally{db.rpc=rpc;}
 const r=await run('Show my visitors.');assert.equal(r.persistence_saved,true);assert.equal(r.execution.durable_trace.status,'saved');
});
await test('both-acknowledgments-lost-remain-unconfirmed-not-deleted',async()=>{
 let tid;db.rpc=(name,args)=>name==='oyi_persist_canonical_turn'?{abortSignal:async signal=>{tid=args.p_thread.id;const r=await rpc(name,args).abortSignal(signal);assert(!r.error);return {error:{code:'UND_ERR_SOCKET'}};}}:rpc(name,args);
 try{const r=await run('Show my wallet balance.');assert.equal(r.persistence_saved,false);assert.match(r.persistence_warning,/not be confirmed/);const rows=await db.from('oyi_conversation_messages').select('id').eq('thread_id',tid);assert.equal(rows.data.length,2,'Ambiguous commit is never compensated by deletion');}finally{db.rpc=rpc;}
});
await test('partial-multipart-save-never-reports-complete',async()=>{
 let calls=0;db.rpc=(name,args)=>{if(name==='oyi_persist_canonical_turn'&&++calls===2)return {abortSignal:async()=>({error:{code:'23514'}})};return rpc(name,args);};
 try{const r=await run('Show my wallet balance and list my devices.');assert.equal(r.persistence_saved,false);assert.equal(captures.at(-1).trace.persistence_saved,false);}finally{db.rpc=rpc;}
});
await test('collapse-failure-never-reports-complete',async()=>{
 db.rpc=(name,args)=>name==='oyi_collapse_canonical_exchange'?{abortSignal:async()=>({error:{code:'42501'}})}:rpc(name,args);
 try{const r=await run('Show my wallet balance and list my devices.');assert.equal(r.persistence_saved,false);assert.match(r.persistence_warning,/not be confirmed/);}finally{db.rpc=rpc;}
});
await test('concurrent-duplicate-save-one-pair',async()=>{
 let captured;db.rpc=(name,args)=>{if(name==='oyi_persist_canonical_turn')captured=args;return rpc(name,args);};
 try{await run('Show my wallet balance.');}finally{db.rpc=rpc;}
 const results=await Promise.all(Array.from({length:6},()=>rpc('oyi_persist_canonical_turn',captured)));
 assert(results.every(x=>!x.error&&x.data.saved&&x.data.duplicate));
 const rows=await db.from('oyi_conversation_messages').select('id').eq('thread_id',captured.p_thread.id);assert.equal(rows.data.length,2);
});
await test('trace-idempotent-transport-delivery',async()=>{
 const r=await run('Show my wallet balance.');const row=captures.at(-1).trace;
 const {recorded_at,...payload}=row;
 const deliveries=await Promise.all(Array.from({length:4},()=>db.from('oyi_conversation_traces').upsert(payload,{onConflict:'trace_id',ignoreDuplicates:true})));
 assert(deliveries.every(x=>!x.error));const rows=await db.from('oyi_conversation_traces').select('trace_id').eq('trace_id',row.trace_id);assert.equal(rows.data.length,1);
});
await test('concurrent-distinct-requests-do-not-collapse-each-other',async()=>{
 const first=await run('Show my wallet balance.');const thread=first.thread_id;
 const results=await Promise.all(['List my devices.','Show my visitors.'].map(m=>run(m,thread)));
 assert(results.every(r=>r.persistence_saved));const q=await db.from('oyi_conversation_messages').select('metadata').eq('thread_id',thread);assert.equal(q.data.length,6);
});
await test('long-request-identifiers-do-not-collide',async()=>{
 const prefix='synthetic-request-'.repeat(14);
 const first=await run('Show my wallet balance.',null,prefix+'alpha');
 const second=await run('Show my visitors.',first.thread_id,prefix+'beta');
 assert(first.persistence_saved&&second.persistence_saved);
 assert.notEqual(first.persistence_request_id,second.persistence_request_id);
 assert.equal(captures.at(-1).trace.turn_ref,projection.opaqueReference('turn',second.persistence_trace_request_id));
});
await test('trace-allowlist-no-private-content',async()=>{
 const permitted=new Set([...Object.keys(projection.TRACE_FIELD_CLASSIFICATION),'recorded_at']);
 for(const c of captures.filter(c=>c.trace)){assert(Object.keys(c.trace).every(k=>permitted.has(k)));const raw=JSON.stringify(c.trace);assert(!raw.includes(c.message));assert(!raw.includes(actor.home_id));assert(!raw.includes(process.env.SUPABASE_SERVICE_ROLE_KEY));assert(!raw.includes('Wave11'));}
 assert.equal(projection.projectConversationTrace({events:[],startedAt:Date.now(),completedAt:Date.now(),requestId:null,threadId:null,surface:'consumer',actor:null,response:{},error:null}).persistence_saved,null);
 assert(captures.some(c=>c.trace?.planner_admitted!==null&&c.trace?.planner_admission_reason),'Planner decision survives allowlisted stage capture');
 const denied=captures.find(c=>c.message.includes('Q-808'));assert.equal(denied.trace.authority_result,'denied');assert.equal(denied.trace.terminal_outcome,'authority_denied');
});
assert.equal(executed,0);await recorder.flushConversationTraceWrites();
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify({checks,captures,executed,pass:checks.filter(x=>x.status==='PASS').length,fail:checks.filter(x=>x.status==='FAIL').length},null,2));
process.exitCode=checks.some(x=>x.status==='FAIL')?1:0;
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+checks],{env:process.env,stdio:'inherit',timeout:240000});
process.exitCode=p.status??1;
