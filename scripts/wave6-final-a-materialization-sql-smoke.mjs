import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const container=process.env.OYI_LOCAL_POSTGRES_CONTAINER||'supabase_db_Ochiga-backend',db='oyi_final_a_'+Date.now();
function sql(q,database=db){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database]);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',c=>c===0?resolve(out.trim()):reject(Error(err)));p.stdin.end(q)})}
const json=o=>"'"+JSON.stringify(o).replaceAll("'","''")+"'::jsonb";
const prepared={version:1,incident:null,rows:{awareness:[],recommendations:[],insights:[],plans:[],deliveries:[]}};
const register=(k,p=prepared,at=new Date().toISOString())=>sql(`select oyi_register_materialization(${json({canonical_signal_key:k,signal_type:'fixture',domain:'fixture',severity:'info',verified:true,privacy_class:'organization_restricted',occurred_at:at,payload:{}})},${json(p)});`).then(JSON.parse);
await sql(`create database ${db}`,'postgres');
try{
 await sql('create table estates(id uuid primary key);create table homes(id uuid primary key);');
 await sql(readFileSync('supabase/migrations/20260728143000_oyi_core_convergence_canonical_storage.sql','utf8'));
 await sql(readFileSync('supabase/migrations/20260924112951_wave6_canonical_materialization_durability.sql','utf8'));
 const a=await register('a');assert.equal(a.state,'pending');assert.equal((await register('a')).duplicate,true);
 const claim=()=>sql(`select coalesce(jsonb_agg(t),'[]') from oyi_claim_materialization(1,'${a.signal_id}') t`).then(JSON.parse);
 const claims=await Promise.all([claim(),claim()]);assert.equal(claims.flat().length,1);const r=claims.flat()[0];
 assert.equal(JSON.parse(await sql(`select oyi_complete_materialization('${a.signal_id}','00000000-0000-0000-0000-000000000000')`)).complete,false);
 assert.equal(JSON.parse(await sql(`select oyi_complete_materialization('${a.signal_id}','${r.materialization.claim_token}')`)).complete,true);
 assert.equal((await register('a')).state,'materialized');
 console.log('PASS registration duplicate concurrent claims fencing completion');
 const at='2026-09-24T10:00:00Z',id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
 const full={version:1,suppress_child:false,incident:{incident_key:'test',incident_type:'fixture',domain:'fixture',title:'fixture',scope:{},privacy_class:'organization_restricted',status:'open',severity:'warning',first_seen_at:at,last_seen_at:at,evidence:[{id:'e1'}],affected_entities:[]},rows:{
 awareness:[{id,awareness_key:'a1',audience:'organization_restricted',status:'open',title:'fixture',summary:'fixture',score_breakdown:{},related_signals:['s1'],related_executions:[],payload:{},generated_at:at,updated_at:at}],
 recommendations:[{id,recommendation_key:'r1',action_type:'inspect',target:{},title:'fixture',summary:'fixture',verification_required:true,approval_required:false,safe_to_automate:false,status:'pending',outcome:{},payload:{},privacy_class:'organization_restricted',generated_at:at,updated_at:at}],
 insights:[{id,domain:'fixture',insight_type:'fixture',reasoning_version:'v3',title:'fixture',summary:'fixture',evidence:[],status:'open',generated_at:at}],
 plans:[{id,plan_type:'fixture',target:{},preconditions:[],safety_checks:[],required_permissions:[],status:'planned',generated_at:at}],
 deliveries:[{id,delivery_key:'d1',channel:'fixture',audience:{},payload:{},redaction_version:'v1',status:'pending',attempt_count:0,created_at:at,updated_at:at}]}};
 await sql(`create function fixture_failure() returns trigger language plpgsql as $$begin raise exception 'fixture_failure';end$$;`);
 for(const table of ['operational_incidents','operational_awareness','operational_recommendations','operational_insights','operational_plans','operational_delivery_outbox','operational_signals']){
  const signal=await register('failure-'+table,full,at);
  const [claimed]=JSON.parse(await sql(`select jsonb_agg(t) from oyi_claim_materialization(1,'${signal.signal_id}') t`));
  const event=table==='operational_signals'?'update':'insert';
  await sql(`create trigger fixture_failure before ${event} on ${table} for each row execute function fixture_failure();`);
  await assert.rejects(()=>sql(`select oyi_complete_materialization('${signal.signal_id}','${claimed.materialization.claim_token}')`),/fixture_failure/);
  assert.equal(await sql(`select count(*) from operational_incidents`),'0');
  assert.equal(await sql(`select materialization->>'state' from operational_signals where id='${signal.signal_id}'`),'materializing');
  await sql(`drop trigger fixture_failure on ${table};update operational_signals set materialization=materialization||'{"state":"terminal_failure"}' where id='${signal.signal_id}';`);
 }
 console.log('PASS rollback at incident awareness recommendation insight plan delivery and completion bookkeeping');
 const signal=await register('full',full,at);
 const [claimed]=JSON.parse(await sql(`select jsonb_agg(t) from oyi_claim_materialization(1,'${signal.signal_id}') t`));
 await sql(`select oyi_complete_materialization('${signal.signal_id}','${claimed.materialization.claim_token}')`);
 await sql(`select oyi_complete_materialization('${signal.signal_id}','${claimed.materialization.claim_token}')`);
 for(const table of ['operational_incidents','operational_awareness','operational_recommendations','operational_insights','operational_plans','operational_delivery_outbox'])assert.equal(await sql(`select count(*) from ${table}`),'1');
 console.log('PASS stable artifact identities and duplicate completion');
 const newer=structuredClone(full);newer.incident.status='resolved';newer.incident.resolved_at='2026-09-24T11:00:00Z';newer.incident.last_seen_at='2026-09-24T11:00:00Z';newer.incident.evidence=[{id:'e2'}];
 const materialize=async(signal)=>{const [c]=JSON.parse(await sql(`select jsonb_agg(t) from oyi_claim_materialization(1,'${signal.signal_id}') t`));return sql(`select oyi_complete_materialization('${signal.signal_id}','${c.materialization.claim_token}')`)};
 await materialize(await register('newer',newer,'2026-09-24T11:00:00Z'));
 await sql(`update operational_recommendations set status='dismissed';update operational_awareness set status='resolved';update operational_delivery_outbox set status='acknowledged';`);
 await materialize(await register('older-delayed',full,at));
 assert.equal(await sql(`select status from operational_incidents`),'resolved');
 assert.equal(await sql(`select jsonb_array_length(evidence) from operational_incidents`),'2');
 assert.equal(await sql(`select status from operational_recommendations`),'dismissed');
 assert.equal(await sql(`select status from operational_awareness`),'resolved');
 assert.equal(await sql(`select status from operational_delivery_outbox`),'acknowledged');
 console.log('PASS delayed older signal cannot regress incident; evidence dedup and mutable lifecycle preserved');
 const equalOld=structuredClone(full),equalNew=structuredClone(newer);
 equalOld.incident.incident_key='equal';equalNew.incident.incident_key='equal';equalOld.incident.last_seen_at=at;equalNew.incident.last_seen_at=at;
 const e1=await register('equal-older',equalOld,at),e2=await register('equal-newer',equalNew,at);
 await materialize(e2);await materialize(e1);
 assert.equal(await sql(`select status from operational_incidents where incident_key='equal'`),'resolved');
 const manual=await register('manual-delayed',equalOld,'2026-09-24T12:00:00Z');
 await sql(`update operational_incidents set status='acknowledged',updated_at=clock_timestamp() where incident_key='equal'`);
 await materialize(manual);assert.equal(await sql(`select status from operational_incidents where incident_key='equal'`),'acknowledged');
 console.log('PASS equal source-time acceptance ordering and later manual lifecycle preservation');
 const leased=await register('lease');const first=JSON.parse(await sql(`select jsonb_agg(t) from oyi_claim_materialization(1,'${leased.signal_id}') t`))[0];
 await sql(`update operational_signals set materialization=materialization||'{"due_at":"2000-01-01T00:00:00.000000Z"}' where id='${leased.signal_id}'`);
 const second=JSON.parse(await sql(`select jsonb_agg(t) from oyi_claim_materialization(1,'${leased.signal_id}') t`))[0];
 assert.notEqual(first.materialization.claim_token,second.materialization.claim_token);
 assert.equal(JSON.parse(await sql(`select oyi_complete_materialization('${leased.signal_id}','${first.materialization.claim_token}')`)).complete,false);
 assert.equal(await sql(`select oyi_fail_materialization('${leased.signal_id}','${second.materialization.claim_token}','persistence_failed',false)`),'t');
 assert.equal((await register('lease')).state,'retryable_failure');
 assert.equal(await sql(`select count(*) from oyi_claim_materialization(1,'${leased.signal_id}')`),'0');
 console.log('PASS lease crash recovery fencing retry backoff');
 for(const n of [1,10,50,100]){
  await sql(`update operational_signals set materialization=materialization||'{"state":"terminal_failure"}' where materialization->>'state'<>'materialized'`);
  for(let k=0;k<n;k++)await register(`load-${n}-${k}`);
  const rows=JSON.parse(await sql(`select jsonb_agg(t) from oyi_claim_materialization(${n}) t`));assert.equal(rows.length,n);
 }
 console.log('PASS 1/10/50/100 pending signals claimed in one bounded query');
 for(const role of ['anon','authenticated'])await assert.rejects(()=>sql(`set role ${role};select * from oyi_claim_materialization(1);`),/permission denied/);
 assert.equal(await sql(`select bool_and(not prosecdef) from pg_proc where proname in ('oyi_register_materialization','oyi_claim_materialization','oyi_complete_materialization','oyi_fail_materialization')`),'t');
 console.log('PASS service-only invoker RPC privileges');
 await sql(`set role service_role;select * from oyi_claim_materialization(1);`);
 await assert.rejects(()=>register('invalid',{version:1,rows:{}}),/invalid_prepared_rows/);
 assert.equal(await sql(`select count(*) from operational_signals where canonical_signal_key='invalid'`),'0');
 await sql(`insert into operational_signals(canonical_signal_key,signal_type,domain,severity) values('legacy','fixture','fixture','info')`);
 assert.equal((await register('legacy')).state,'legacy_unverified');
 assert.equal(await sql(`select count(*) from oyi_claim_materialization(1,(select id from operational_signals where canonical_signal_key='legacy'))`),'0');
 console.log('PASS failed registration has no signal; legacy rows stay unverified and unclaimed');
 // Real prepared rows from actual Core, transported through Supabase-shaped responses
 // into the actual SQL functions. No shared application database or network service.
 await sql('alter table operational_awareness add column estate_id uuid;alter table operational_awareness add column home_id uuid;');
 const require=createRequire(import.meta.url);let failComplete=true;
 const rpcArgs={oyi_register_materialization:['p_signal','p_prepared'],oyi_claim_materialization:['p_limit','p_signal_id'],oyi_complete_materialization:['p_signal_id','p_token'],oyi_fail_materialization:['p_signal_id','p_token','p_code','p_terminal']};
 const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
 const client={async rpc(name,args){
  if(name==='oyi_complete_materialization'&&failComplete){failComplete=false;return{data:null,error:{code:'08006',message:'fixture transport failure'}}}
  const values=rpcArgs[name].map(k=>args[k]===null?'null':typeof args[k]==='object'?json(args[k]):typeof args[k]==='string'?quote(args[k]):String(args[k]));
  try{const result=await sql(name==='oyi_claim_materialization'?`select coalesce(jsonb_agg(t),'[]') from ${name}(${values}) t`:`select to_jsonb(${name}(${values}))`);return{data:JSON.parse(result),error:null}}catch(e){return{data:null,error:{code:'XX000',message:e.message}}}
 },from(table){let filters=[];const q={select(){return q},eq(k,v){filters.push(`${k}=${quote(v)}`);return q},async maybeSingle(){const out=await sql(`select row_to_json(t) from ${table} t where ${filters.join(' and ')} limit 1`);return{data:out?JSON.parse(out):null,error:null}}};return q}};
 for(const [path,exports]of [['../dist/supabase/supabaseClient.js',{supabaseAdmin:client}],['../dist/core/foundation/audit.js',{emitAuditEvent:async()=>{}}]]){const file=require.resolve(path);require.cache[file]={id:file,filename:file,loaded:true,exports};}
 const {submitCanonicalSignal}=require('../dist/oyi-core/ingress/canonicalSignalIngress.js');
 const {reconcileMaterialization}=require('../dist/oyi-core/persistence/materialization.js');
 const input={type:'camera.video.unavailable',domain:'camera',source:'camera',origin:'backend',entity:{id:'integration-camera',type:'camera',name:'Test camera'},severity:'warning',metadata:{provider_event_id:'final-a-integration',producer:'final_a_fixture'}};
 const result=await submitCanonicalSignal(input);assert.equal(result.materialization.signalPersisted,true);assert.equal(result.materialization.materializationComplete,false);assert.equal(result.materialization.materializationState,'retryable_failure');
 const sid=result.materialization.canonicalSignalId;
 await sql(`update operational_signals set materialization=materialization||'{"due_at":"2000-01-01T00:00:00.000000Z"}' where id='${sid}'`);
 const repaired=await reconcileMaterialization(1,sid);assert.equal(repaired[0].complete,true);
 const retry=await submitCanonicalSignal(input);assert.equal(retry.materialization.materializationComplete,true);assert.equal(retry.materialization.canonicalSignalId,sid);
 const beforeAwareness=Number(await sql('select count(*) from operational_awareness'));
 const next=await submitCanonicalSignal({...input,metadata:{...input.metadata,provider_event_id:'final-a-distinct-event'}});
 assert.equal(next.materialization.materializationComplete,true);assert.notEqual(next.materialization.canonicalSignalId,sid);
 assert.equal(Number(await sql('select count(*) from operational_awareness')),beforeAwareness+1);
 assert.notEqual(next.operational_awareness.id,result.operational_awareness.id);
 console.log('PASS distinct canonical events sharing display signal ID retain separate materialized artifact identities');
 console.log('PASS actual Core prepared bundle, resolved Supabase error, durable recovery and duplicate completion acknowledgement');
}finally{await sql(`drop database ${db}`,'postgres');}
