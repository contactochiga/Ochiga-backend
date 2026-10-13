// New synthetic development only. Setup prefix contains no sealed questions.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const fixture=fs.readFileSync('scripts/iq8f-run.mjs','utf8'),marker='// IQ-8F certification runner:';
if(!fixture.includes(marker))throw Error('Fixture boundary changed');
const setup=fixture.slice(0,fixture.indexOf(marker)).replaceAll("'../dist/",`'${process.cwd()}/dist/`);
const test=String.raw`
unscripted();process.env.OYI_TRACE_REFERENCE_KEY=randomUUID()+randomUUID();process.env.OYI_CONVERSATION_TRACE_ENABLED='true';
const {createHash}=require('node:crypto'),sha=b=>createHash('sha256').update(b).digest('hex');
const manifestPath=process.env.WAVE11_HARNESS_OUT+'-manifest.json';
const manifest=JSON.parse(fs.readFileSync(manifestPath));
assert(manifest.files.every(f=>sha(fs.readFileSync(f.path))===f.sha256),'Runtime/fixture changed after freeze');
const recorder=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceRecorder.js');
const schema=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceSchema.js');
const projection=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceProjection.js');
const {reconcileConversationAttempts:reconcile,certificationPreflightDecision:gate,CERTIFICATION_PREFLIGHT_GATES:gates}=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceReconciliation.js');
const {capabilityService}=require(process.cwd()+'/dist/oyi-core/capabilities/CapabilityService.js');
const checks=[],captures=[],reconciliations=[];let preflight;
const journal=fs.openSync(process.env.WAVE11_HARNESS_OUT+'-attempts.jsonl','wx');
function journalEntry(value){fs.writeSync(journal,JSON.stringify(value)+'\n');fs.fsyncSync(journal);}
const rpc=db.rpc.bind(db),actor=actorFor('resident','consumer');
async function fixtureSnapshot(){const out={};for(const [table,fields]of [['wallets','id,home_id,balance,currency'],['homes','id,name,estate_id,resident_id'],['devices','id,name,home_id,room_id,status'],['maintenance_requests','id,title,status,priority,home_id'],['visitor_access','id,home_id,status'],['facility_cameras','id,home_id,status']]){const q=await db.from(table).select(fields).order('id').limit(100);assert(!q.error);assert(q.data.length<100);out[table]=q.data;}return out;}
const fixtureHash=sha(JSON.stringify(await fixtureSnapshot()));
async function test(id,fn){try{await fn();checks.push({id,status:'PASS'});}catch(e){checks.push({id,status:'FAIL',error:e.message});}console.log(checks.at(-1));}
async function call(message,{who=actor,surface='consumer',thread=null,id=randomUUID(),injected=null}={}){
 const started=Date.now(),attempt_id=randomUUID();let response=null,error=null,correlation=null;
 journalEntry({event:'started',attempt_id,request_id:id,thread_id:thread,surface});
 try{response=await conversationOrchestrator.run({actor:who,oisContext:oisContext(who,surface),input:{message,surface,thread_id:thread,estate_id:who?.estate_id,home_id:who?.home_id,context:{request_id:id,...(surface==='office_internal'?{operational_snapshot:officeSnapshot()}:{})}}});}
 catch(e){correlation=recorder.exceptionTraceCorrelation(e);error={ownership_rejected:e.message==='conversation_access_denied'&&e.status===403,name:e.name};}
 const receipt=response?.execution?.durable_trace||correlation?.receipt||null;
 const attemptedThread=response?.thread_id||response?.persistence_attempt_thread_id||thread;
 const a={attempt_id,request_id:correlation?.request_id||response?.persistence_trace_request_id||id,thread_id:attemptedThread,
  turn_ref:receipt?.turn_ref||projection.opaqueReference('turn',id),thread_ref:projection.opaqueReference('thread',attemptedThread),surface,
  outcome:error?.ownership_rejected?'ownership_rejected':error?'exception':'returned',expected_persistence:error?.ownership_rejected?'none':'pair',response_saved:response?.persistence_saved??null,trace_id:receipt?.trace_id??null,receipt,duplicate_reported:response?.persistence_duplicate===true};
 journalEntry({event:'returned',...a});
 const c={attempt:a,message,response,error,injected,latency_ms:Date.now()-started};captures.push(c);assert.equal(executed,0);return c;
}
async function checkReconcile(cs,timeoutMs=500){const r=await reconcile(cs.map(c=>c.attempt),{timeoutMs});reconciliations.push(r);return r;}
async function saved(c){await recorder.flushConversationTraceWrites();assert.equal(c.attempt.receipt.delivery_state,'saved_verified');const r=await checkReconcile([c]);assert(r.ready);return c;}
await test('preflight-schema-rpc',async()=>assert.equal((await schema.preflightConversationTrace()).status,'compatible'));
const healthy=[];
await test('ordinary-all-worker-correlation',async()=>{for(const [surface,role]of [['office_internal','ochiga_staff'],['public_corporate','public'],['facility','facility_manager'],['consumer','resident']])healthy.push(await saved(await call('What information is available here?',{surface,who:actorFor(role,surface)})));});
let home;
await test('own-read-and-effective-authority',async()=>{
 home=await saved(await call('Please show my wallet balance.'));const denied={...actor,role:'guest',permissions:[],permission_scopes:[]};
 assert(capabilityService.canUse('wallet.balance.read',{actor:{...actor,permissions:[],permission_scopes:[]},oisContext:oisContext(actor,'consumer'),surface:'consumer'}).allowed);
 assert(!capabilityService.canUse('wallet.balance.read',{actor:denied,oisContext:oisContext(denied,'consumer'),surface:'consumer'}).allowed);
 healthy.push(await saved(await call('Please show my wallet balance.',{who:denied})));assert(!healthy.at(-1).response.facts.length);
});
let rejected,multipart;
await test('ownership-rejection-retains-correlation-without-save',async()=>{
 rejected=await call('Show information from this thread.',{who:actorFor('resident_b','consumer'),thread:home.attempt.thread_id});
 assert.equal(rejected.attempt.outcome,'ownership_rejected');assert(rejected.attempt.trace_id);assert.equal(rejected.attempt.response_saved,null);
 await recorder.flushConversationTraceWrites();const r=await checkReconcile([rejected]);assert(r.ready);assert.equal(r.records[0].classification,'rejected_correlated');assert.equal(r.records[0].message_count,0);
});
await test('multipart-exact-consolidation',async()=>{multipart=await saved(await call('Show my wallet balance and list my devices.'));const r=await checkReconcile([multipart]);assert.equal(r.records[0].message_count,2);});
const failures=[];
for(const [code,kind]of [['42501','permission'],['42703','schema'],['23514','database_rejection'],['08006','database_unavailable'],['ECONNRESET','transport']])await test('insert-failure-'+kind,async()=>{
 recorder.__setConversationTraceInsertForTests(async()=>{throw {code,message:'PRIVATE-DIAGNOSTIC-CONTENT'};});
 try{const c=await call('Read the wallet figure.',{injected:kind});failures.push(c);await recorder.flushConversationTraceWrites();assert.equal(c.attempt.receipt.status,'failed');assert.equal(c.attempt.receipt.failure_class,kind);assert(!JSON.stringify(c.attempt.receipt).includes('PRIVATE'));assert(c.response.persistence_saved);const r=await checkReconcile([c],60);assert(!r.ready);assert(!r.records[0].trace_present);}
 finally{recorder.__setConversationTraceInsertForTests(null);}
});
await test('unknown-error-not-overdiagnosed',async()=>{assert.equal(recorder.traceFailureClass({message:'PRIVATE',code:'SENSITIVE_INVENTED_ERROR'}),'unknown');assert.equal(recorder.traceFailureClass({code:'42P01'}),'schema');assert.equal(recorder.traceFailureClass({code:'22P02'}),'database_rejection');});
await test('pending-and-late-commit-reconciliation',async()=>{
 recorder.__setConversationTraceInsertForTests(async row=>{await new Promise(r=>setTimeout(r,2350));const x=await db.from('oyi_conversation_traces').insert(row);if(x.error)throw x.error;});
 try{const c=await call('Read my wallet figure.',{injected:'late_commit'});assert.equal(c.attempt.receipt.status,'pending');await recorder.flushConversationTraceWrites();assert.equal(c.attempt.receipt.status,'failed');assert.equal(c.attempt.receipt.delivery_state,'timed_out');
 const r=await checkReconcile([c],1000);assert(r.ready);assert.equal(r.records[0].classification,'durable_trace_recovered');assert.equal(c.attempt.receipt.delivery_state,'timed_out');}
 finally{recorder.__setConversationTraceInsertForTests(null);}
});
await test('slow-success-before-deadline',async()=>{
 recorder.__setConversationTraceInsertForTests(async row=>{await new Promise(r=>setTimeout(r,100));const q=await db.from('oyi_conversation_traces').insert(row);if(q.error)throw q.error;});
 try{await saved(await call('Show my wallet balance.'));}finally{recorder.__setConversationTraceInsertForTests(null);}
});
await test('lost-receipt-exact-manifest-recovery',async()=>{const c=await saved(await call('Show my wallet balance.'));const copy={...c,attempt:{...c.attempt,receipt:null}};const r=await checkReconcile([copy]);assert(r.ready);assert.equal(r.records[0].classification,'durable_trace_recovered');});
await test('captured-reference-survives-key-rotation',async()=>{const key=process.env.OYI_TRACE_REFERENCE_KEY;process.env.OYI_TRACE_REFERENCE_KEY=randomUUID()+randomUUID();try{assert((await checkReconcile([home])).ready);}finally{process.env.OYI_TRACE_REFERENCE_KEY=key;}});
await test('acknowledged-without-durable-row-is-not-saved',async()=>{
 recorder.__setConversationTraceInsertForTests(async()=>{});
 try{const c=await call('Show the wallet figure.',{injected:'false_ack'});await recorder.flushConversationTraceWrites();assert.equal(c.attempt.receipt.status,'failed');assert.equal(c.attempt.receipt.failure_class,'verification_mismatch');assert(!(await checkReconcile([c],60)).ready);}finally{recorder.__setConversationTraceInsertForTests(null);}
});
await test('save-failure-independent-of-successful-trace',async()=>{
 db.rpc=(name,args)=>name==='oyi_persist_canonical_turn'?{abortSignal:async()=>({error:{code:'23514'}})}:rpc(name,args);
 try{const c=await call('Show my wallet balance.',{injected:'save_failure'});await recorder.flushConversationTraceWrites();assert.equal(c.response.persistence_saved,false);assert.equal(c.attempt.receipt.delivery_state,'saved_verified');const r=await checkReconcile([c]);assert(!r.ready);assert.equal(r.records[0].classification,'missing_expected_save');}
 finally{db.rpc=rpc;}
});
await test('retry-uncertain-save-does-not-reexecute-capability',async()=>{
 let n=0;db.rpc=(name,args)=>name==='oyi_persist_canonical_turn'?{abortSignal:async s=>{const r=await rpc(name,args).abortSignal(s);if(++n===1&&!r.error)return {error:{code:'UND_ERR_SOCKET'}};return r;}}:rpc(name,args);
 try{const c=await saved(await call('Show my wallet balance.'));assert.equal(n,2);assert(c.response.persistence_duplicate);}finally{db.rpc=rpc;}
});
await test('unconfirmed-save-with-durable-pair-is-not-silent-success',async()=>{
 db.rpc=(name,args)=>name==='oyi_persist_canonical_turn'?{abortSignal:async s=>{const r=await rpc(name,args).abortSignal(s);assert(!r.error);return {error:{code:'UND_ERR_SOCKET'}};}}:rpc(name,args);
 try{const c=await call('Show my wallet balance.',{injected:'both_save_acks_lost'});await recorder.flushConversationTraceWrites();assert.equal(c.response.persistence_saved,false);const r=await checkReconcile([c]);assert(!r.ready);assert.equal(r.records[0].classification,'save_unconfirmed_durable_pair');assert.equal(r.records[0].message_count,2);assert(r.records[0].trace_verified);}finally{db.rpc=rpc;}
});
await test('multipart-consolidation-failure-remains-visible',async()=>{
 db.rpc=(name,args)=>name==='oyi_collapse_canonical_exchange'?{abortSignal:async()=>({error:{code:'42501'}})}:rpc(name,args);
 try{const c=await call('Show my wallet balance and list my devices.',{injected:'collapse_failure'});await recorder.flushConversationTraceWrites();assert.equal(c.response.persistence_saved,false);const r=await checkReconcile([c]);assert(!r.ready);assert.equal(r.records[0].classification,'unexpected_message_set');assert.equal(r.records[0].message_count,4);}finally{db.rpc=rpc;}
});
for(const mode of ['lost-first-ack','retry-exhausted','transport-timeout'])await test('default-trace-transport-'+mode,async()=>{
 const from=db.from.bind(db);let attempts=0;
 db.from=table=>{const q=from(table);if(table==='oyi_conversation_traces'){const upsert=q.upsert.bind(q);q.upsert=(...args)=>{const write=upsert(...args);return {abortSignal:async s=>{attempts++;if(mode==='transport-timeout')return new Promise(resolve=>s.addEventListener('abort',()=>resolve({error:{code:'20'}}),{once:true}));if(mode==='retry-exhausted')return {error:{code:'ECONNRESET'}};const r=await write.abortSignal(s);return attempts===1&&!r.error?{error:{code:'ECONNRESET'}}:r;}};};}return q;};
 try{const c=await call('Show my wallet balance.',{injected:mode});await recorder.flushConversationTraceWrites();assert.equal(attempts,2);assert.equal(c.attempt.receipt.attempts,2);const r=await checkReconcile([c],70);
  if(mode==='retry-exhausted'||mode==='transport-timeout'){assert(!r.ready);assert.equal(c.attempt.receipt.delivery_state,mode==='transport-timeout'?'timed_out':'uncertain');}else{assert(r.ready);assert.equal(c.attempt.receipt.delivery_state,'saved_verified');}}
 finally{db.from=from;}
});
await test('duplicate-stable-read-request-one-message-pair',async()=>{
 const id=randomUUID();const c=await saved(await call('Show my wallet balance.',{thread:home.attempt.thread_id,id}));const d=await saved(await call('Show my wallet balance.',{thread:home.attempt.thread_id,id}));assert(d.response.persistence_duplicate);const r=await checkReconcile([c,d]);assert(r.ready);assert(r.records.every(x=>x.deliveries===2&&x.message_count===2));
});
await test('concurrent-requests-remain-distinct',async()=>{const cs=await Promise.all(['List my devices.','Show my visitors.','Show my wallet balance.'].map(message=>call(message,{thread:home.attempt.thread_id})));await recorder.flushConversationTraceWrites();assert((await checkReconcile(cs)).ready);});
await test('reconciliation-rejects-mismatched-or-missing-identifiers',async()=>{
 for(const patch of [{trace_id:null},{turn_ref:'wrong-reference'},{thread_ref:'wrong-thread'},{expected_persistence:'none'}]){const r=await checkReconcile([{...home,attempt:{...home.attempt,...patch}}]);assert(!r.ready);}
});
await test('invalid-empty-or-duplicated-attempt-manifest',async()=>{await assert.rejects(()=>reconcile([]),/invalid_attempt_manifest/);await assert.rejects(()=>reconcile([home.attempt,home.attempt]),/invalid_attempt_manifest/);const r=await reconcile([home.attempt,{...home.attempt,attempt_id:randomUUID()}],{timeoutMs:50});assert(!r.ready);assert(r.records.every(x=>x.classification==='duplicate_trace_identity'));});
await test('reconciliation-outage-bounded',async()=>{const chain={select(){return this;},eq(){return this;},limit(){return this;},abortSignal(){return this;},maybeSingle(){return this;},then(resolve){return Promise.resolve({data:null,error:{code:'08006'}}).then(resolve);}};const t=Date.now();const r=await reconcile([home.attempt],{timeoutMs:100,client:{from:()=>chain}});assert(!r.ready);assert.equal(r.records[0].lookup_error,'database_unavailable');assert(Date.now()-t<1000);});
await test('noncooperative-lookup-bounded',async()=>{const chain={select(){return this;},eq(){return this;},limit(){return this;},abortSignal(){return this;},maybeSingle(){return this;},then(){return new Promise(()=>{});}};const t=Date.now();const r=await reconcile([home.attempt],{timeoutMs:70,client:{from:()=>chain}});assert(!r.ready);assert.equal(r.records[0].lookup_error,'timeout');assert(Date.now()-t<1000);});
await test('preflight-fails-each-required-gate',async()=>{const all=Object.fromEntries(gates.map(k=>[k,true]));assert(gate(all).ready);assert(!gate({}).ready);for(const k of gates)assert.deepEqual(gate({...all,[k]:false}).failed,[k]);});
await test('trace-structural-privacy',async()=>{for(const c of captures){if(!c.attempt.trace_id)continue;const t=await db.from('oyi_conversation_traces').select('*').eq('trace_id',c.attempt.trace_id).maybeSingle();assert(!t.error);if(!t.data)continue;assert(Object.keys(t.data).every(k=>k==='recorded_at'||k in projection.TRACE_FIELD_CLASSIFICATION));const raw=JSON.stringify(t.data);assert(!raw.includes(c.message));assert(!raw.includes(process.env.SUPABASE_SERVICE_ROLE_KEY));assert(!raw.includes(actor.home_id));assert(!raw.includes('PRIVATE-DIAGNOSTIC'));}});
await test('runtime-and-fixture-stable-no-provider-no-execution',async()=>{
 assert(manifest.files.every(f=>sha(fs.readFileSync(f.path))===f.sha256));assert.equal(sha(JSON.stringify(await fixtureSnapshot())),fixtureHash);
 assert(!process.env.OPENAI_API_KEY&&!process.env.ANTHROPIC_API_KEY);assert.equal(executed,0);
});
const stable=checks.find(x=>x.id==='runtime-and-fixture-stable-no-provider-no-execution')?.status==='PASS';
preflight=gate({runtime_hash:stable,fixture_hash:stable,schema_rpc:checks.find(x=>x.id==='preflight-schema-rpc')?.status==='PASS',effective_authority:checks.find(x=>x.id==='own-read-and-effective-authority')?.status==='PASS',ordinary_correlation:checks.find(x=>x.id==='ordinary-all-worker-correlation')?.status==='PASS',rejection_correlation:checks.find(x=>x.id==='ownership-rejection-retains-correlation-without-save')?.status==='PASS',multipart_persistence:checks.find(x=>x.id==='multipart-exact-consolidation')?.status==='PASS',failure_injection:failures.length===5&&checks.every(x=>x.status==='PASS'),provider_off:!process.env.OPENAI_API_KEY&&!process.env.ANTHROPIC_API_KEY,execution_isolated:executed===0});
await recorder.flushConversationTraceWrites();const final=await reconcile(captures.map(c=>c.attempt),{timeoutMs:250});
assert.equal(final.attempted,captures.length);assert.equal(executed,0);
journalEntry({event:'final_reconciliation',...final});fs.closeSync(journal);
const report={manifest_sha256:sha(fs.readFileSync(manifestPath)),fixture_hash:fixtureHash,preflight,checks,captures,reconciliations,final,executed,pass:checks.filter(x=>x.status==='PASS').length,fail:checks.filter(x=>x.status==='FAIL').length};
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,fail:report.fail,attempted:captures.length,preflight,executed}));process.exitCode=report.fail?1:0;
`;
const p=spawnSync(process.execPath,['--input-type=module','-e',setup+test],{env:process.env,stdio:'inherit',timeout:240000});process.exitCode=p.status??1;
