// Evidence-only runner: existing canonical setup and IQ-11C capture contract.
// Never grades, repairs Core, retries a conversation or edits frozen expectations.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const workers=['oma','osa','facility','consumer'];
const root='artifacts/piq-20261016';
const output=process.env.WAVE11_HARNESS_OUT;
const worker=workers.find(w=>output?.endsWith('-'+w));
assert(worker,'Output prefix must end with worker name');
const seal=JSON.parse(fs.readFileSync(root+'-seal.json'));
assert(seal.files.every(f=>sha(fs.readFileSync(f.path))===f.sha256),'Frozen input changed');
assert(!fs.existsSync(output+'.json')&&!fs.existsSync(output+'-attempts.jsonl'),'No replay or overwrite');
const source=fs.readFileSync('scripts/iq8f-run.mjs','utf8');
const boundary='// IQ-8F certification runner:';
assert(source.includes(boundary));
let setup=source.slice(0,source.indexOf(boundary)).replaceAll("'../dist/",`'${process.cwd()}/dist/`);
const isolation=String.raw`
// Defense in depth beyond fetch: block other HTTP clients, TLS, UDP and subprocesses.
const net=require('node:net'),socketConnect=net.Socket.prototype.connect;
let blockedNetwork=0;
net.Socket.prototype.connect=function(...args){
 const a=Array.isArray(args[0])?args[0]:args;
 const o=typeof a[0]==='object'?a[0]:{port:a[0],host:typeof a[1]==='string'?a[1]:'localhost'};
 if(!['127.0.0.1','localhost'].includes(o.host||o.hostname||'localhost')||Number(o.port)!==55421){blockedNetwork++;throw Error('PIQ_EXTERNAL_TRANSPORT_BLOCKED');}
 return socketConnect.apply(this,args);
};
require('node:dgram').createSocket=()=>{blockedNetwork++;throw Error('PIQ_DATAGRAM_BLOCKED');};
for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])require('node:child_process')[method]=()=>{throw Error('PIQ_SUBPROCESS_BLOCKED');};
`;
setup=setup.replace('let executed = 0;',isolation+'\nlet executed = 0;');
const test=String.raw`
unscripted();
for(const name of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','OFFICE_SYNC_KEY','OFFICE_API_KEY'])assert(!process.env[name]);
process.env.OYI_TRACE_REFERENCE_KEY=randomUUID()+randomUUID();process.env.OYI_CONVERSATION_TRACE_ENABLED='true';
const {createHash}=require('node:crypto'),sha=b=>createHash('sha256').update(b).digest('hex');
const worker=WORKER,root='artifacts/piq-20261016';
const seal=JSON.parse(fs.readFileSync(root+'-seal.json'));
assert(seal.files.every(f=>sha(fs.readFileSync(f.path))===f.sha256));
const corpus=JSON.parse(fs.readFileSync(root+'-'+worker+'-corpus.json'));
const recorder=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceRecorder.js');
const projection=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceProjection.js');
const schema=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceSchema.js');
const {reconcileConversationAttempts:reconcile}=require(process.cwd()+'/dist/oyi-core/observability/conversationTraceReconciliation.js');
assert.equal((await schema.preflightConversationTrace()).status,'compatible');
const preflight=JSON.parse(fs.readFileSync(root+'-preflight.json'));
assert(preflight.preflight.ready&&preflight.pass===32&&preflight.fail===0);
const snapshot=JSON.parse(fs.readFileSync(root+'-office-snapshot.json'));
const [surface,role]={oma:['office_internal','ochiga_staff'],osa:['public_corporate','public'],facility:['facility','facility_manager'],consumer:['consumer','resident']}[worker];
const captures=[],startedAt=new Date().toISOString();
const journal=fs.openSync(process.env.WAVE11_HARNESS_OUT+'-attempts.jsonl','wx',0o600);
function entry(x){fs.writeSync(journal,JSON.stringify(x)+'\n');fs.fsyncSync(journal);}
async function fixtureHash(){const out={};for(const [table,fields]of [['wallets','id,home_id,balance,currency'],['homes','id,name,estate_id,resident_id'],['devices','id,name,home_id,room_id,status'],['maintenance_requests','id,title,status,priority,home_id'],['visitor_access','id,home_id,status'],['facility_cameras','id,home_id,status']]){const q=await db.from(table).select(fields).order('id').limit(100);assert(!q.error&&q.data.length<100);out[table]=q.data;}return sha(JSON.stringify(out));}
assert.equal(await fixtureHash(),seal.fixture_hash);
const frozenFacts=JSON.parse(fs.readFileSync(root+'-fixture-facts.json'));
async function completeFixtureStable(){const rows={};for(const [table,fields]of Object.entries(frozenFacts.tables)){const q=await db.from(table).select(fields).order('id').limit(100);assert(!q.error&&q.data.length<100);rows[table]=q.data;}return sha(JSON.stringify(rows))===frozenFacts.sha256;}
assert(await completeFixtureStable(),'Complete fixture changed');
function actorForTurn(turn){let a=actorFor(turn.actor==='resident_b'?'resident_b':role,surface);if(turn.actor==='denied')a={...a,role:'guest',permissions:[],permission_scopes:[]};if(turn.actor==='visitor_denied')a={...a,role:'maintenance_operator',permissions:[],permission_scopes:[]};return a;}
async function call(turn,thread,caseId,scored){
 const actor=actorForTurn(turn),id=randomUUID(),attempt_id=randomUUID(),t=Date.now();
 let response=null,error=null,correlation=null;
 entry({event:'started',attempt_id,request_id:id,thread_id:thread,surface,case_id:caseId,turn_id:turn.id,scored});
 try{response=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,surface),input:{message:turn.utterance,surface,thread_id:thread,estate_id:actor?.estate_id,home_id:actor?.home_id,context:{request_id:id,...(surface==='office_internal'?{operational_snapshot:snapshot}:{})}}});}
 catch(e){correlation=recorder.exceptionTraceCorrelation(e);error={ownership_rejected:e.message==='conversation_access_denied'&&e.status===403,name:e.name,status:e.status??null};}
 const receipt=response?.execution?.durable_trace||correlation?.receipt||null;
 const attemptedThread=response?.thread_id||response?.persistence_attempt_thread_id||thread;
 const a={attempt_id,request_id:correlation?.request_id||response?.persistence_trace_request_id||id,thread_id:attemptedThread,
 turn_ref:receipt?.turn_ref||projection.opaqueReference('turn',id),thread_ref:projection.opaqueReference('thread',attemptedThread),surface,
 outcome:error?.ownership_rejected?'ownership_rejected':error?'exception':'returned',expected_persistence:error?.ownership_rejected?'none':'pair',response_saved:response?.persistence_saved??null,trace_id:receipt?.trace_id??null,receipt,duplicate_reported:response?.persistence_duplicate===true};
 const c={case_id:caseId,turn_id:turn.id,scored,actor:turn.actor,utterance:turn.utterance,attempt:a,response,error,latency_ms:Date.now()-t};
 // Record immediately, including failures; no missing call can disappear on crash.
 entry({event:'returned',...c});captures.push(c);
 await recorder.flushConversationTraceWrites();
 c.receipt_after_drain=receipt?{...receipt}:null;
 if(a.trace_id){const q=await db.from('oyi_conversation_traces').select('*').eq('trace_id',a.trace_id).maybeSingle();c.trace=q.error?null:q.data;c.trace_lookup_error=q.error?'lookup_unavailable':null;}
 if(attemptedThread&&!error?.ownership_rejected){const q=await db.from('oyi_conversation_threads').select('metadata').eq('id',attemptedThread).maybeSingle();c.thread_metadata=q.error?null:q.data?.metadata;c.context_lookup_error=q.error?'lookup_unavailable':null;}
 entry({event:'captured',...c});
 return attemptedThread;
}
const allTurns=new Map();for(const j of corpus.journeys)for(let i=0;i<j.turns.length;i++)allTurns.set(j.turns[i].id,{j,index:i});
for(const j of corpus.journeys){let thread=null;for(const turn of j.turns)thread=await call(turn,thread,j.id,true);}
for(const companion of corpus.companions){const parent=allTurns.get(companion.parent_turn_id);assert(parent);let thread=null;for(const t of parent.j.turns.slice(0,parent.index))thread=await call(t,thread,companion.id,false);await call(companion,thread,companion.id,true);}
await recorder.flushConversationTraceWrites();
const final=await reconcile(captures.map(c=>c.attempt),{timeoutMs:15000});
const stable=seal.files.every(f=>sha(fs.readFileSync(f.path))===f.sha256)&&await fixtureHash()===seal.fixture_hash&&await completeFixtureStable();
const report={worker,runtime:seal.runtime_head,seal_sha256:sha(fs.readFileSync(root+'-seal.json')),started_at:startedAt,ended_at:new Date().toISOString(),captures,final,stable,physical_executor_attempts:executed,blocked_external_attempts:blockedNetwork,provider_enabled:false};
entry({event:'final_reconciliation',...final,stable,physical_executor_attempts:executed,blocked_external_attempts:blockedNetwork});fs.closeSync(journal);
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({worker,attempted:captures.length,scored:captures.filter(c=>c.scored).length,correlated:final.traces_verified,persisted:final.persisted_pairs,ready:final.ready,stable,physical_executor_attempts:executed,blocked_external_attempts:blockedNetwork}));
process.exitCode=final.ready&&stable?0:1;
`.replace('WORKER',JSON.stringify(worker));
const child=spawnSync(process.execPath,['--input-type=module','-e',setup+test],{env:process.env,stdio:'inherit',timeout:290000});
process.exitCode=child.status??1;
