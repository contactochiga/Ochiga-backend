import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const container=process.env.OYI_LOCAL_POSTGRES_CONTAINER || 'supabase_db_Ochiga-backend';
const database='oyi_slice14b_'+Date.now();
const estate='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
function sql(query,db=database){return new Promise((resolve,reject)=>{
  const p=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db]);
  let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);
  p.on('close',c=>c===0?resolve(out.trim()):reject(new Error(err.trim())));p.stdin.end(query);
});}
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
// Exercise PostgreSQL's trailing-zero normalization on every run.
const base=Math.floor(Date.now()/1000)*1000-60000+950;
const stamp=n=>new Date(base+n).toISOString();
const heartbeat=(n,status='online')=>({ts:stamp(n),status,sync_status:'synced',queue_depth:0,error_count:0,runtime_version:'fixture'});
const call=(node,p)=>`select public.oyi_ingest_edge_heartbeat('${estate}',${quote(node)},${quote(JSON.stringify(p))}::jsonb,30000);`;
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS '+name)}
await sql(`create database ${database};`,'postgres');
try{
  const foundation=readFileSync('supabase/migrations/20260522085935_edge_pilot_onboarding_foundation_20260522_fixed.sql','utf8');
  const schema=foundation.slice(foundation.indexOf('create table if not exists edge_nodes ('),foundation.indexOf('create index if not exists idx_edge_heartbeats_node_received'));
  await sql(`create table public.estates(id uuid primary key);insert into public.estates values('${estate}');${schema}
    alter table public.edge_nodes enable row level security;alter table public.edge_heartbeats enable row level security;
    grant usage on schema public to service_role,anon,authenticated;
    grant select,insert,update on public.edge_nodes,public.edge_heartbeats to service_role;
    create table public.facility_cameras(id integer,health_status text);insert into public.facility_cameras values(1,'online');
    create table public.camera_infrastructure(id integer,health_state text);insert into public.camera_infrastructure values(1,'healthy');`);
  await sql(readFileSync('supabase/migrations/20260924090934_wave6_edge_current_state_atomic_ingestion.sql','utf8'));
  await test('privileges: invoker function, no PUBLIC/anon/authenticated execution; service_role succeeds',async()=>{
    for(const role of ['anon','authenticated'])await assert.rejects(()=>sql(`set role ${role};${call('forbidden',heartbeat(0))}`),/permission denied/);
    const flags=await sql("select prosecdef from pg_proc where proname='oyi_ingest_edge_heartbeat';");assert.equal(flags,'f');
    assert.equal(await sql("select count(*) from pg_proc p cross join lateral aclexplode(p.proacl) a where p.proname='oyi_ingest_edge_heartbeat' and a.grantee=0 and a.privilege_type='EXECUTE';"),'0');
    const r=JSON.parse(await sql(`set role service_role;${call('node-a',heartbeat(0,'degraded'))}`));assert.equal(r.accepted,true);
  });
  await test('newer wins; older replay recorded without advancing either current timestamp',async()=>{
    const newer=JSON.parse(await sql(call('node-a',heartbeat(30000))));
    const replay=JSON.parse(await sql(call('node-a',heartbeat(-30000,'offline'))));assert.equal(replay.disposition,'older');
    assert.equal(replay.node.heartbeat_observed_at,newer.node.heartbeat_observed_at);assert.equal(replay.node.heartbeat_received_at,newer.node.heartbeat_received_at);
    assert.equal(replay.node.heartbeat_observation.status,'online');assert.notEqual(newer.node.heartbeat_received_at,newer.node.heartbeat_observed_at);
  });
  await test('duplicate is idempotent, including conflicting same-timestamp status (first report wins)',async()=>{
    const before=await sql('select count(*) from edge_heartbeats;');const r=JSON.parse(await sql(call('node-a',heartbeat(30000,'offline'))));
    assert.equal(r.disposition,'duplicate');assert.equal(r.node.heartbeat_observation.status,'online');assert.equal(await sql('select count(*) from edge_heartbeats;'),before);
  });
  await test('concurrent first/new/old/duplicate ingestion serializes and preserves maximum source time',async()=>{
    await Promise.all([0,30000,10000,20000,30000,0,5000].map(n=>sql(call('racing',heartbeat(n)))));
    // PostgreSQL strips trailing fractional zeroes (.950 -> .95). Compare
    // the actual instant, not incidental JSON timestamp formatting.
    assert.equal(new Date(await sql("select heartbeat_observation->>'observed_at' from edge_nodes where edge_node_id='racing';")).toISOString(),new Date(base+30000).toISOString());
    assert.equal(await sql("select count(*) from edge_heartbeats where edge_node_id='racing';"),'5');
  });
  await test('history failure rolls back projection and first-node creation',async()=>{
    await sql("create function public.fixture_history_failure() returns trigger language plpgsql as $$begin if new.edge_node_id='history-failure' then raise exception 'fixture history failure';end if;return new;end$$;create trigger fixture_history_failure before insert on edge_heartbeats for each row execute function public.fixture_history_failure();");
    await assert.rejects(()=>sql(call('history-failure',heartbeat(0))),/fixture history failure/);
    assert.equal(await sql("select count(*) from edge_nodes where edge_node_id='history-failure';"),'0');
  });
  await test('forced overlapping transactions hold the per-node lock until commit',async()=>{
    const first=sql(`begin;${call('locked',heartbeat(0))}select pg_sleep(1);commit;`);
    await new Promise(resolve=>setTimeout(resolve,200));
    const start=Date.now();const second=sql(call('locked',heartbeat(30000)));await Promise.all([first,second]);
    assert.ok(Date.now()-start>=600,'second transaction should wait for the first lock');
    assert.equal(Date.parse(await sql("select heartbeat_observed_at from edge_nodes where edge_node_id='locked';")),base+30000);
  });
  await test('projection failure rolls back inserted history',async()=>{
    await sql("create function public.fixture_projection_failure() returns trigger language plpgsql as $$begin if new.edge_node_id='projection-failure' then raise exception 'fixture projection failure';end if;return new;end$$;create trigger fixture_projection_failure before update on edge_nodes for each row execute function public.fixture_projection_failure();");
    await assert.rejects(()=>sql(call('projection-failure',heartbeat(0))),/fixture projection failure/);
    assert.equal(await sql("select count(*) from edge_heartbeats where edge_node_id='projection-failure';"),'0');
  });
  await test('missing/future source timestamps and tenant mismatch cannot write',async()=>{
    for(const p of [{status:'online'},{ts:'infinity'},{ts:'2026-09-24T10:00:00'},{ts:new Date(Date.now()+60000).toISOString()},{...heartbeat(0),site_id:'other'}])await assert.rejects(()=>sql(call('invalid',p)));
    assert.equal(await sql("select count(*) from edge_nodes where edge_node_id='invalid';"),'0');
  });
  await test('old Backend mirror/metadata update cannot overwrite authoritative observation columns',async()=>{
    const before=await sql("select heartbeat_observation from edge_nodes where edge_node_id='node-a';");
    await sql("update edge_nodes set heartbeat_status='offline',last_seen_at=now(),metadata='{}' where edge_node_id='node-a';");
    assert.equal(await sql("select heartbeat_observation from edge_nodes where edge_node_id='node-a';"),before);
  });
  await test('no camera rows changed by Edge ingestion',async()=>{
    assert.equal(await sql('select health_status from facility_cameras;'),'online');assert.equal(await sql('select health_state from camera_infrastructure;'),'healthy');
  });
  console.log(`Slice14B SQL: ${checks} groups passed (real PostgreSQL, isolated database).`);
}finally{
  // Only the unique fixture database created by this invocation; no shared data.
  await sql(`drop database ${database};`,'postgres');
}
