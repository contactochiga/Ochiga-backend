import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const db=`w9_scope_${Date.now()}`, container='supabase_db_Ochiga-backend';
function sql(query,database=db,success=true){const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:query,encoding:'utf8'});if(success)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0);return (r.stdout||'').trim();}
const migration=readFileSync(new URL('../supabase/migrations/20260926205543_wave9_camera_scope_schema_correction.sql',import.meta.url),'utf8');
sql(`create database ${db}`,'postgres');
try {
  sql('create table homes(id uuid primary key); create table facility_cameras(id uuid primary key, metadata jsonb);');
  sql(`insert into facility_cameras values ('11111111-1111-4111-a111-111111111111','{"privacy_scope":"home","home_id":"legacy"}');
    create index fixture_camera_index on facility_cameras(id);
    create function fixture_camera_trigger() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger fixture_camera_trigger before update on facility_cameras for each row execute function fixture_camera_trigger();
    create policy fixture_deny on facility_cameras for select to authenticated using (false);
    grant select on facility_cameras to anon,authenticated;`);
  const before=sql("select metadata::text from facility_cameras");
  const functionBefore=sql("select pg_get_functiondef('fixture_camera_trigger()'::regprocedure)");
  const triggerBefore=sql("select pg_get_triggerdef(oid) from pg_trigger where tgname='fixture_camera_trigger'");
  sql(migration); sql(migration);
  assert.equal(sql("select metadata::text from facility_cameras"),before);
  assert.equal(sql("select pg_get_functiondef('fixture_camera_trigger()'::regprocedure)"),functionBefore);
  assert.equal(sql("select pg_get_triggerdef(oid) from pg_trigger where tgname='fixture_camera_trigger'"),triggerBefore);
  assert.equal(sql('select count(*) from facility_cameras where home_id is null and privacy_scope is null'),'1');
  assert.equal(sql("select count(*) from pg_policies where tablename='facility_cameras' and policyname='fixture_deny'"),'1');
  assert.equal(sql("select count(*) from pg_indexes where tablename='facility_cameras' and indexname='fixture_camera_index'"),'1');
  assert.equal(sql("select relrowsecurity from pg_class where oid='facility_cameras'::regclass"),'t');
  assert.equal(sql("select has_table_privilege('anon','facility_cameras','select') or has_table_privilege('authenticated','facility_cameras','select')"),'f');
  assert.equal(sql("select has_table_privilege('service_role','facility_cameras','select')"),'t');
  sql("update facility_cameras set home_id='22222222-2222-4222-a222-222222222222'",db,false);
  sql("insert into homes values ('22222222-2222-4222-a222-222222222222'); update facility_cameras set home_id='22222222-2222-4222-a222-222222222222'; delete from homes;");
  assert.equal(sql('select home_id is null from facility_cameras'),'t');
  // Existing real May schema: proves additive upgrade, not full historical replay.
  sql('drop table facility_cameras; drop table homes;');
  sql(readFileSync(new URL('../migrations/schema.sql',import.meta.url),'utf8'));
  sql(readFileSync(new URL('../supabase/migrations/20260521000100_pilot_onboarding_foundation.sql',import.meta.url),'utf8'));
  sql(migration);
  assert.equal(sql("select count(*) from information_schema.columns where table_name='facility_cameras' and column_name in ('home_id','privacy_scope')"),'2');
  console.log('PASS additive existing-table upgrade, repeat idempotency, metadata preservation, FK, RLS, grants and retained policy/index; NOT full migration-chain replay');
} finally { sql(`drop database ${db}`,'postgres'); }
