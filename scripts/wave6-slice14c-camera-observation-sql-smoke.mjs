import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const edge=require(resolve(process.env.OYI_EDGE_CHECKOUT||'../../oyi-edge-agent','src/camera/observations.js'));
const container=process.env.OYI_LOCAL_POSTGRES_CONTAINER||'supabase_db_Ochiga-backend',db='oyi_slice14c_'+Date.now();
const estate='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',cam='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',other='cccccccc-cccc-4ccc-cccc-cccccccccccc';
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function sql(q,database=db){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database]);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',c=>c===0?resolve(out.trim()):reject(Error(err)));p.stdin.end(q)})}
const at=n=>new Date(Date.now()-600000+n*1000).toISOString();const t1=at(1),t2=at(2),t3=at(3);
const obs=(kind='stream',result='inspected',time=t1,details={})=>edge.observation({id:cam},'edge-a',kind,{stream:'go2rtc_inspection',frame:'go2rtc_snapshot',reachability:'onvif_probe',inference:'external_detector'}[kind],result,details,time);
const call=items=>`select public.oyi_ingest_camera_observations('${estate}','edge-a',${quote(JSON.stringify(items))}::jsonb);`;
const state=async()=>JSON.parse(await sql(`select runtime_observations from facility_cameras where id='${cam}'`));
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name)}
await sql(`create database ${db}`,'postgres');
try{
 const migration=readFileSync('supabase/migrations/20260521000100_pilot_onboarding_foundation.sql','utf8');
 const schema=migration.slice(migration.indexOf('create table if not exists facility_cameras ('),migration.indexOf('alter table if exists facility_cameras'));
 await sql(`create table estates(id uuid primary key);create table estate_zones(id uuid primary key);create table users(id uuid primary key);insert into estates values('${estate}');${schema}
 alter table facility_cameras add column edge_node_id text;alter table facility_cameras enable row level security;
 grant usage on schema public to service_role,anon,authenticated;grant select,update on facility_cameras to service_role;
 insert into facility_cameras(id,estate_id,name,edge_node_id)values('${cam}','${estate}','Fixture','edge-a'),('${other}','${estate}','Other','edge-b');`);
 await sql(readFileSync('supabase/migrations/20260924093033_wave6_camera_observation_persistence.sql','utf8'));
 await test('nullable legacy-safe projection and service-only invoker RPC',async()=>{
  assert.equal(await sql(`select runtime_observations is null from facility_cameras where id='${cam}'`),'t');
  assert.equal(await sql(`select prosecdef from pg_proc where proname='oyi_ingest_camera_observations'`),'f');
  for(const role of ['anon','authenticated'])await assert.rejects(()=>sql(`set role ${role};${call([obs()])}`),/permission denied/);
  await sql(`set role service_role;${call([obs()])}`);
 });
 await test('Edge producer envelope accepted unchanged; independent source-time dimensions',async()=>{
  const reach=obs('reachability','succeeded',t3);const stream=obs('stream','inspected',t2,{stream_present:true,producer_count:0});
  await sql(call([reach,stream]));const s=await state();assert.equal(s.dimensions['reachability:onvif_probe'].latest.observed_at,t3);assert.equal(s.dimensions['stream:go2rtc_inspection'].latest.observed_at,t2);
 });
 await test('frame latest success survives later failed attempt and older replay; receipt distinct',async()=>{
  const success=obs('frame','acquired',t2,{mime_type:'image/jpeg',size_bytes:10,validation:'bounded_image_signature'}),fail=obs('frame','failed',t3,{error_code:'capture_failed'});
  await sql(call([fail,success]));let s=(await state()).dimensions['frame:go2rtc_snapshot'];assert.equal(s.latest.result,'failed');assert.equal(s.last_success.observation_id,success.observation_id);assert.notEqual(s.latest.received_at,s.latest.observed_at);
  const before=await state();await sql(call([success,fail,obs('frame','failed',t1)]));assert.deepEqual(await state(),before);
 });
 await test('equal source times use lexical UUID tie-break, independent of arrival order',async()=>{
  const a={...obs('inference','succeeded',t2,{detection_count:0}),observation_id:'00000000-0000-4000-8000-000000000001'};
  const b={...a,observation_id:'ffffffff-ffff-4fff-8fff-ffffffffffff'};
  await sql(call([b,a]));assert.equal((await state()).dimensions['inference:external_detector'].latest.observation_id,b.observation_id);
  await assert.rejects(()=>sql(call([{...b,result:'failed'}])),/id_conflict/);
 });
 await test('later stream and legacy metadata writes cannot erase independent frame evidence',async()=>{
  const before=(await state()).dimensions['frame:go2rtc_snapshot'];
  await sql(call([obs('stream','failed',t3,{error_code:'inspection_failed'})]));
  await sql(`update facility_cameras set metadata='{"stream_status":"online"}' where id='${cam}'`);
  assert.deepEqual((await state()).dimensions['frame:go2rtc_snapshot'],before);
 });
 await test('whole batch fails closed on assignment, unknown camera and spoofed scope',async()=>{
  const before=await state();for(const bad of [{...obs(),camera_id:other},{...obs(),camera_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'},{...obs(),edge_node_id:'edge-b'},{...obs(),estate_id:estate}])await assert.rejects(()=>sql(call([obs('stream','inspected',t3),bad])));
  assert.deepEqual(await state(),before);
  const foreign='ffffffff-ffff-4fff-8fff-ffffffffffff';await sql(`insert into estates values('${foreign}');update facility_cameras set estate_id='${foreign}',edge_node_id='edge-a' where id='${other}'`);
  await assert.rejects(()=>sql(call([{...obs(),camera_id:other}])),/assignment_denied/);
  await sql(`update facility_cameras set estate_id='${estate}',edge_node_id='edge-b' where id='${other}'`);
 });
 await test('bounds/credentials/image bytes/invalid timestamps and vocabularies rejected',async()=>{
  const before=await state();for(const bad of [{...obs(),details:{token:'secret'}},{...obs(),details:{image_base64:'bytes'}},{...obs(),source:'rtsp://user:password@host'},
   {...obs(),observed_at:new Date(Date.now()+60000).toISOString()},{...obs(),observed_at:'2026-09-24'}, {...obs(),kind:'overall_health'}, {...obs(),result:'healthy'}, {...obs(),observation_id:'bad'}, {...obs(),details:{producer_count:-1}}, {...obs(),details:{producer_count:'1'}}])await assert.rejects(()=>sql(call([bad])));
  await assert.rejects(()=>sql(call(Array.from({length:129},()=>obs()))));assert.deepEqual(await state(),before);
 });
 await test('concurrent ingestion keeps latest source time, including reversed camera order',async()=>{
  await sql(`update facility_cameras set edge_node_id='edge-a' where id='${other}'`);
  await Promise.all([1,4,2,5,3].map(n=>sql(call([obs('stream','inspected',at(n)),{...obs('stream','inspected',at(n)),camera_id:other}].reverse()))));
  assert.equal(Date.parse((await state()).dimensions['stream:go2rtc_inspection'].latest.observed_at)>Date.parse(t3),true);
 });
 await test('actual write failure on second camera rolls back first camera update',async()=>{
  await sql(`create function fixture_fail()returns trigger language plpgsql as $$begin if new.id='${other}' then raise exception 'fixture rollback';end if;return new;end$$;create trigger fixture_fail before update on facility_cameras for each row execute function fixture_fail();`);
  const before=await state();await assert.rejects(()=>sql(call([obs('reachability','failed',at(10)),{...obs('reachability','failed',at(10)),camera_id:other}])),/fixture rollback/);assert.deepEqual(await state(),before);await sql('drop trigger fixture_fail on facility_cameras');
 });
 await test('10/50/100-camera batches: one RPC, no history growth or legacy health writes',async()=>{
  for(const n of [10,50,100]){
   const ids=Array.from({length:n},(_,i)=>`dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12,'0')}`);
   await sql(`insert into facility_cameras(id,estate_id,name,edge_node_id)values ${ids.map(id=>`('${id}','${estate}','Fixture','edge-a')`).join(',')} on conflict(id) do nothing`);
   const observations=ids.map(id=>({...obs(),camera_id:id}));const r=JSON.parse(await sql(call(observations)));assert.equal(r.results.length,n);
  }
  assert.equal(await sql(`select count(*) from facility_cameras where status<>'pending' or health_status<>'pending_stream_details' or last_seen_at is not null`),'0');
 });
 console.log(`Slice14C SQL: ${count} groups passed; real PostgreSQL and real Edge envelope builder.`);
}finally{await sql(`drop database ${db}`,'postgres')}
