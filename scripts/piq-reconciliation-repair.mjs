// New diagnostic controls only; uses the existing local fixture setup, no sealed cases.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('scripts/iq8f-run.mjs','utf8');
const marker='// IQ-8F certification runner:';
if(!source.includes(marker))throw Error('setup boundary changed');
const setup=source.slice(0,source.indexOf(marker)).replaceAll("'../dist/",`'${process.cwd()}/dist/`);
const body=String.raw`
unscripted();process.env.OYI_TRACE_REFERENCE_KEY=randomUUID()+randomUUID();process.env.OYI_CONVERSATION_TRACE_ENABLED='true';
const recorder=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceRecorder.js');
const {reconcileConversationAttempts:reconcile}=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceReconciliation.js');
const checks=[],diagnostics=[],live=[];
async function test(id,fn){try{await fn();checks.push({id,status:'PASS'});}catch(e){checks.push({id,status:'FAIL',error:e.message});}}
const a={attempt_id:'synthetic-attempt',request_id:'synthetic-request',thread_id:'synthetic-thread',turn_ref:'synthetic-turn',thread_ref:'synthetic-thread-ref',surface:'consumer',outcome:'returned',expected_persistence:'pair',response_saved:false,trace_id:'synthetic-trace',receipt:{delivery_state:'saved_verified'},duplicate_reported:false};
const trace={trace_id:a.trace_id,turn_ref:a.turn_ref,thread_ref:a.thread_ref,surface:a.surface,persistence_saved:false};
const pair=[{id:'m1',thread_id:a.thread_id,role:'user'},{id:'m2',thread_id:a.thread_id,role:'assistant'}];
function mock(mode){let round=0;return {from(table){const n=table==='oyi_conversation_traces'?++round:round;let signal;
 const q={select(){return this;},eq(){return this;},limit(){return this;},maybeSingle(){return this;},abortSignal(s){signal=s;return this;},then(resolve,reject){
  const value={data:table==='oyi_conversation_traces'?trace:[],error:null};
  if(mode==='never')return new Promise(()=>{});
  if(mode==='outage'||(mode==='late-outage'&&n>1))return Promise.resolve({data:null,error:{code:'08006',message:'PRIVATE_ERROR'}}).then(resolve,reject);
  if((['late-abort','missing-trace-abort'].includes(mode)&&n>1)||mode==='initial-abort')return new Promise(r=>{const done=()=>r({data:null,error:{code:'',message:'PRIVATE_ERROR'}});if(signal.aborted)done();else signal.addEventListener('abort',done,{once:true});}).then(resolve,reject);
  if(mode==='missing-trace-abort')value.data=table==='oyi_conversation_traces'?null:pair;
  if(mode==='mismatch'&&table==='oyi_conversation_traces')value.data={...trace,turn_ref:'wrong-turn'};
  if(mode==='partial-query-failure'&&table==='oyi_conversation_messages')return Promise.resolve({data:null,error:{code:'42501',message:'PRIVATE_ERROR'}}).then(resolve,reject);
  if(mode==='recovery'&&n===1)return Promise.resolve({data:null,error:{code:'08006'}}).then(resolve,reject);
  if(mode==='recovery'||(mode==='late-save'&&n>1))value.data=table==='oyi_conversation_traces'?{...trace,persistence_saved:true}:pair;
  return Promise.resolve(value).then(resolve,reject);
 }};return q;}};}
await test('completed-absence-survives-deadline-abort',async()=>{const r=await reconcile([a],{client:mock('late-abort'),timeoutMs:70,pollMs:0});diagnostics.push({id:'late-abort',result:r});assert.equal(r.ready,false);assert.equal(r.records[0].classification,'missing_expected_save');assert.equal(r.records[0].lookup_error,'timeout');assert.equal(r.records[0].trace_verified,true);assert(r.records[0].lookup_failures>0);assert(r.records[0].last_completed_lookup_ms!==null);});
await test('no-successful-lookup-cannot-prove-absence',async()=>{const r=await reconcile([a],{client:mock('initial-abort'),timeoutMs:70,pollMs:0});diagnostics.push({id:'initial-abort',result:r});assert.equal(r.ready,false);assert.equal(r.records[0].classification,'lookup_unavailable');assert.equal(r.records[0].lookup_error,'timeout');assert.equal(r.records[0].trace_verified,false);});
await test('completed-absence-followed-by-outage-remains-failed',async()=>{const r=await reconcile([a],{client:mock('late-outage'),timeoutMs:70,pollMs:10});diagnostics.push({id:'late-outage',result:r});assert(!r.ready);assert.equal(r.records[0].classification,'missing_expected_save');assert.equal(r.records[0].lookup_error,'database_unavailable');assert(r.records[0].lookup_failures>0);});
await test('initial-outage-never-infers-zero',async()=>{const r=await reconcile([a],{client:mock('outage'),timeoutMs:60,pollMs:10});assert(!r.ready);assert.equal(r.records[0].classification,'lookup_unavailable');assert.equal(r.records[0].trace_verified,false);});
await test('later-successful-read-replaces-earlier-absence',async()=>{const r=await reconcile([{...a,response_saved:true}],{client:mock('late-save'),timeoutMs:100,pollMs:0});assert(r.ready);assert.equal(r.records[0].message_count,2);assert.equal(r.records[0].lookup_error,null);});
await test('outage-then-durable-recovery',async()=>{const r=await reconcile([{...a,response_saved:true}],{client:mock('recovery'),timeoutMs:100,pollMs:0});assert(r.ready);assert(r.records[0].lookup_failures>0);});
await test('noncooperative-lookups-bounded',async()=>{const t=Date.now();const r=await reconcile([a],{client:mock('never'),timeoutMs:60});assert(!r.ready);assert.equal(r.records[0].classification,'lookup_unavailable');assert.equal(r.records[0].lookup_error,'timeout');assert(Date.now()-t<1000);});
await test('missing-trace-observation-survives-abort-without-success',async()=>{const r=await reconcile([{...a,response_saved:true}],{client:mock('missing-trace-abort'),timeoutMs:70,pollMs:0});assert(!r.ready);assert.equal(r.records[0].classification,'missing_trace');assert.equal(r.records[0].message_count,2);assert.equal(r.records[0].trace_verified,false);assert.equal(r.records[0].lookup_error,'timeout');});
await test('partial-query-error-cannot-prove-absence',async()=>{const r=await reconcile([a],{client:mock('partial-query-failure'),timeoutMs:60});assert(!r.ready);assert.equal(r.records[0].classification,'lookup_unavailable');assert.equal(r.records[0].lookup_error,'permission');assert.equal(r.records[0].last_completed_lookup_ms,null);assert.equal(r.records[0].trace_verified,false);});
await test('wrong-correlation-remains-blocked',async()=>{const r=await reconcile([a],{client:mock('mismatch'),timeoutMs:60});assert(!r.ready);assert.equal(r.records[0].classification,'trace_contract_mismatch');});
await test('concurrent-deadlines-account-for-every-attempt',async()=>{const attempts=Array.from({length:20},(_,i)=>({...a,attempt_id:'attempt-'+i,request_id:'request-'+i,trace_id:'trace-'+i}));const r=await reconcile(attempts,{client:mock('never'),timeoutMs:70});assert(!r.ready);assert.equal(r.records.length,20);assert(r.records.every(x=>!x.trace_verified&&!x.persistence_verified));assert.deepEqual(r.records.map(x=>x.attempt_id),attempts.map(x=>x.attempt_id));});
await test('no-private-diagnostics',()=>assert(!JSON.stringify(diagnostics).includes('PRIVATE_ERROR')));

// Trace each completed local read in the affected scenario; no query text, content or credentials.
const rpc=db.rpc.bind(db),who=actorFor('resident','consumer');
for(let i=0;i<6;i++)await test('isolated-save-failure-'+i,async()=>{
 const id=randomUUID(),started=Date.now();let r;
 db.rpc=(name,args)=>name==='oyi_persist_canonical_turn'?{abortSignal:async()=>({error:{code:'23514'}})}:rpc(name,args);
 try{r=await conversationOrchestrator.run({actor:who,oisContext:oisContext(who,'consumer'),input:{message:'Show my wallet balance.',surface:'consumer',home_id:who.home_id,estate_id:who.estate_id,context:{request_id:id}}});}finally{db.rpc=rpc;}
 await recorder.flushConversationTraceWrites();const receipt=r.execution.durable_trace;
 const attempt={...a,attempt_id:randomUUID(),request_id:r.persistence_trace_request_id||id,thread_id:r.persistence_attempt_thread_id||r.thread_id,turn_ref:receipt.turn_ref,thread_ref:require(process.cwd()+'/dist/oyi-core/observability/conversationTraceProjection.js').opaqueReference('thread',r.persistence_attempt_thread_id||r.thread_id),trace_id:receipt.trace_id,receipt,response_saved:r.persistence_saved};
 const reads=[];
 const client={from(table){return new Proxy(db.from(table),{get(target,prop){if(prop==='select')return(...args)=>{
  const query=target.select(...args);let signal;const original=query.abortSignal.bind(query),then=query.then.bind(query);
  query.abortSignal=s=>{signal=s;return original(s);};
  query.then=(resolve,reject)=>then(value=>{reads.push({table,elapsed_ms:Date.now()-started,aborted:signal?.aborted===true,error:!!value.error,safe_error_class:value.error?recorder.traceFailureClass(value.error):null,rows:Array.isArray(value.data)?value.data.length:value.data?1:0});return resolve(value);},reject);return query;
 };return Reflect.get(target,prop);}});}};
 const result=await reconcile([attempt],{client,timeoutMs:500});
 const audit=await reconcile([attempt],{timeoutMs:2000});
 live.push({attempt,reads,result,audit});
 assert.equal(r.persistence_saved,false);assert.equal(receipt.delivery_state,'saved_verified');assert.equal(result.records[0].classification,'missing_expected_save');assert(!result.ready);assert.equal(audit.records[0].classification,'missing_expected_save');assert.equal(audit.records[0].message_count,0);assert.equal(audit.records[0].trace_verified,true);assert.equal(executed,0);
});
const report={checks,diagnostics,live,pass:checks.filter(x=>x.status==='PASS').length,fail:checks.filter(x=>x.status==='FAIL').length,executed};
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({pass:report.pass,fail:report.fail,failures:checks.filter(x=>x.status==='FAIL'),executed}));process.exitCode=report.fail?1:0;
`;
const result=spawnSync(process.execPath,['--input-type=module','-e',setup+body],{env:process.env,stdio:'inherit',timeout:120000});process.exitCode=result.status??1;
