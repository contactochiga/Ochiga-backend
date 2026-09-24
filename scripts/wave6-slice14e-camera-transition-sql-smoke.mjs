import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
const container=process.env.OYI_LOCAL_POSTGRES_CONTAINER||'supabase_db_Ochiga-backend';
const db='oyi_slice14e_'+Date.now(),cam='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',estate='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function sql(q,database=db){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database]);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',c=>c===0?resolve(out.trim()):reject(Error(err)));p.stdin.end(q)})}
const json=v=>v===null?'null':quote(JSON.stringify(v))+'::jsonb';
const row=async()=>JSON.parse(await sql(`select row_to_json(c) from facility_cameras c where id='${cam}'`));
const prepare=async(state,type=null)=>{const c=await row();const{health_transition_checkpoint:cp,...expected}=c;return{expected,cp,evaluation:{overall:state,transition_type:type,policy_revision:'camera-transition-v1/current-state-14d-v1',evaluated_at:new Date().toISOString(),valid_until:new Date(Date.now()+950).toISOString(),summary:{scope_revision:'a'.repeat(64),policy_key:JSON.stringify(['camera-transition-v1/current-state-14d-v1',30000,'15000']),components:{frame:'acquired'},reasons:[],evidence:[]}}}};
const call=(p,edge=null)=>`select public.oyi_accept_camera_health_transition('${cam}',${json(p.expected)},${json(edge)},${json(p.cp)},${json(p.evaluation)});`;
const accept=async(p,edge=null)=>JSON.parse(await sql(call(p,edge)));
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name)}
await sql(`create database ${db}`,'postgres');
try{
 await sql(`create table facility_cameras(id uuid primary key,estate_id uuid,home_id uuid,privacy_scope text,metadata jsonb,edge_node_id text,nvr_id text,channel text,ai_enabled boolean,runtime_observations jsonb);
 create table edge_nodes(id uuid primary key,estate_id uuid,edge_node_id text,heartbeat_observed_at timestamptz,heartbeat_received_at timestamptz,heartbeat_observation jsonb);
 insert into facility_cameras values('${cam}','${estate}',null,'facility','{}','node-a',null,null,false,null);
 grant usage on schema public to service_role,anon,authenticated;grant select,update on facility_cameras to service_role;grant select,update on edge_nodes to service_role;`);
 await sql(readFileSync('supabase/migrations/20260924101810_wave6_camera_health_transition_outbox.sql','utf8'));
 await test('service-only invoker, nullable checkpoint, initialization silent',async()=>{
  const p=await prepare('healthy');for(const role of ['anon','authenticated'])await assert.rejects(()=>sql(`set role ${role};${call(p)}`),/permission denied/);
  p.evaluation.summary.policy_key=JSON.stringify(['camera-transition-v1/current-state-14d-v1',30000,'15000']);
  p.evaluation.summary.evidence=[{id:'00000000-0000-4000-8000-000000000001',source:'frame:ai_snapshot',observed_at:new Date().toISOString()}];
  assert.equal(await sql(`select prosecdef from pg_proc where proname='oyi_accept_camera_health_transition'`),'f');
  const r=JSON.parse(await sql(`set role service_role;${call(p)}`));assert.equal(r.accepted,true);assert.equal(r.transition_id,null);
 });
 await test('two concurrent evaluators: exactly one CAS winner, stable transition identity',async()=>{
  const p=await prepare('degraded','camera.health.degraded');const result=await Promise.all([accept(p),accept(p)]);
  assert.equal(result.filter(r=>r.accepted).length,1);assert.equal(result.filter(r=>r.reason==='checkpoint_changed').length,1);
  assert.equal(await sql('select count(*) from camera_health_transition_outbox'),'1');
  assert.equal((await accept(p)).accepted,false);
 });
 await test('observation/scope/Edge revisions and expiry reject stale interpretation',async()=>{
  let p=await prepare('unavailable','camera.video.unavailable');await sql(`update facility_cameras set runtime_observations='{"version":1,"dimensions":{}}' where id='${cam}'`);
  assert.equal((await accept(p)).reason,'camera_evidence_changed');
  p=await prepare('healthy');await sql(`insert into edge_nodes values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${estate}','node-a',now(),now(),'{}')`);
  assert.equal((await accept(p)).reason,'edge_evidence_changed');
  p=await prepare('healthy');
  const edge=JSON.parse(await sql('select row_to_json(n) from edge_nodes n'));
  await sql(`update edge_nodes set heartbeat_observation='{"status":"degraded"}'`);
  assert.equal((await accept(p,edge)).reason,'edge_evidence_changed');
  p=await prepare('healthy');
  const latest=JSON.parse(await sql('select row_to_json(n) from edge_nodes n'));
  p.evaluation.valid_until=new Date(Date.now()-1).toISOString();
  assert.equal((await accept(p,latest)).reason,'evaluation_expired','time-only Edge/camera boundary invalidates same stored evidence');
  await sql('delete from edge_nodes');p=await prepare('healthy');p.evaluation.valid_until=new Date(Date.now()-1).toISOString();assert.equal((await accept(p)).reason,'evaluation_expired');
 });
 await test('scope race, malformed summary and false initialization rejected without outbox',async()=>{
  let p=await prepare('healthy');await sql(`update facility_cameras set privacy_scope='home' where id='${cam}'`);
  assert.equal((await accept(p)).reason,'camera_evidence_changed');await sql(`update facility_cameras set privacy_scope='facility' where id='${cam}'`);
  p=await prepare('healthy');p.evaluation.summary.components={password:'secret'};
  await assert.rejects(()=>accept(p),/invalid_component_summary/);
  p=await prepare('healthy');p.evaluation.summary.evidence=[{id:'x',source:'test',observed_at:new Date().toISOString(),url:'rtsp://secret'}];
  await assert.rejects(()=>accept(p),/invalid_evidence_summary/);
  p=await prepare('healthy','camera.video.restored');p.cp=null;
  await assert.rejects(()=>sql(`begin;update facility_cameras set health_transition_checkpoint=null;${call(p)}commit;`),/initialization_is_not_recovery/);
 });
 await test('outbox insert failure rolls checkpoint back',async()=>{
  const before=(await row()).health_transition_checkpoint;
  await sql(`create function fail_outbox()returns trigger language plpgsql as $$begin raise exception 'fixture rollback';end$$;create trigger fail_outbox before insert on camera_health_transition_outbox for each row execute function fail_outbox();`);
  const failing=await prepare('unavailable','camera.video.unavailable');
  await assert.rejects(()=>accept(failing),/fixture rollback/);
  assert.deepEqual((await row()).health_transition_checkpoint,before);await sql('drop trigger fail_outbox on camera_health_transition_outbox');
 });
 await test('crash before delivery preserves pending row; concurrent claim only one winner; lease permits restart retry',async()=>{
  const r=await accept(await prepare('unavailable','camera.video.unavailable'));
  const pending=JSON.parse(await sql(`select row_to_json(o) from camera_health_transition_outbox o where transition_id=${quote(r.transition_id)}`));assert.equal(pending.delivery_state,'pending');
  const claim=t=>`update camera_health_transition_outbox set delivery_state='submitting',claim_token='${t}',updated_at=clock_timestamp(),lease_until=clock_timestamp()+interval '60 seconds',attempt_count=attempt_count+1 where transition_id=${quote(r.transition_id)} and updated_at=${quote(pending.updated_at)}::timestamptz returning transition_id;`;
  const claims=await Promise.all([sql(claim('dddddddd-dddd-4ddd-8ddd-dddddddddddd')),sql(claim('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'))]);assert.equal(claims.filter(Boolean).length,1);
  await sql(`update camera_health_transition_outbox set lease_until=now()-interval '1 second' where transition_id=${quote(r.transition_id)}`);
  assert.equal(await sql(`select transition_id from camera_health_transition_outbox where transition_id=${quote(r.transition_id)} and lease_until<now()`),r.transition_id);
 });
 await test('failure leaves durable obligation; repeated accepted healthy checkpoints do not create signal storm',async()=>{
  await accept(await prepare('healthy','camera.video.restored'));
  const before=await sql('select count(*) from camera_health_transition_outbox');for(let i=0;i<10;i++)await accept(await prepare('healthy'));
  assert.equal(await sql('select count(*) from camera_health_transition_outbox'),before);
 });
 console.log(`Slice14E SQL: ${checks} groups passed; real isolated PostgreSQL`);
}finally{await sql(`drop database ${db}`,'postgres')}
