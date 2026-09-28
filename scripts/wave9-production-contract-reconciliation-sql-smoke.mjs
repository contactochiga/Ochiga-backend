import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const db=`w9_contract_${Date.now()}`;
function sql(input,database=db,ok=true){
  const result=spawnSync('docker',['exec','-i','supabase_db_Ochiga-backend','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input,encoding:'utf8'});
  if(ok)assert.equal(result.status,0,result.stderr); else assert.notEqual(result.status,0,'expected migration rejection');
  return result.stdout.trim();
}
const migration=readFileSync(new URL('../supabase/migrations/20260928090000_wave9_production_contract_reconciliation.sql',import.meta.url),'utf8');
const facilityController=readFileSync(new URL('../src/controllers/facility.controller.ts',import.meta.url),'utf8');
assert.match(facilityController,/from\("room_assignments"\)[\s\S]{0,400}resident_id: user_id/);
assert.doesNotMatch(facilityController,/from\("room_assignments"\)[\s\S]{0,400}\n\s*user_id,/);
sql(`create database ${db}`,'postgres');
try {
  sql(`create table homes(id uuid primary key); create table facility_cameras(id uuid primary key, ip text not null, rtsp_url text not null);
    create table ochiga_intelligence_predictions(
      id uuid primary key, confidence numeric(5,2), source_event_ids jsonb default '[]'::jsonb,
      evidence jsonb default '{}'::jsonb
    );
    insert into ochiga_intelligence_predictions values
      ('11111111-1111-4111-a111-111111111111',0.90,'["event-a","event-b"]','{"legacy":true}'),
      ('22222222-2222-4222-a222-222222222222',0.50,'[]','[]');`);
  sql(migration);
  assert.equal(sql("select confidence from ochiga_intelligence_predictions where id='11111111-1111-4111-a111-111111111111'"),'confirmed');
  assert.equal(sql("select confidence from ochiga_intelligence_predictions where id='22222222-2222-4222-a222-222222222222'"),'possible');
  assert.equal(sql("select source_event_ids::text from ochiga_intelligence_predictions where id='11111111-1111-4111-a111-111111111111'"),'{event-a,event-b}');
  assert.equal(sql("select evidence::text from ochiga_intelligence_predictions where id='11111111-1111-4111-a111-111111111111'"),'[{"legacy": true}]');
  assert.equal(sql("select format_type(atttypid,atttypmod) from pg_attribute where attrelid='ochiga_intelligence_predictions'::regclass and attname='source_event_ids'"),'text[]');
  assert.equal(sql("select is_nullable from information_schema.columns where table_name='facility_cameras' and column_name='ip'"),'YES');
  assert.equal(sql("select column_default from information_schema.columns where table_name='homes' and column_name='type'"),"'home'::text");
  sql(migration);
  console.log('PASS legacy prediction conversion, data-preserving evidence conversion, camera nullable discovery fields, home type, idempotency');
} finally { sql(`drop database ${db}`,'postgres'); }

const unsafe=`${db}_unsafe`;
sql(`create database ${unsafe}`,'postgres');
try {
  sql(`create table homes(id uuid primary key); create table facility_cameras(id uuid primary key, ip text not null, rtsp_url text not null);
    create table ochiga_intelligence_predictions(id uuid primary key, confidence numeric(5,2), source_event_ids jsonb, evidence jsonb);
    insert into ochiga_intelligence_predictions values ('33333333-3333-4333-a333-333333333333',.5,'{"not":"an array"}','[]');`,unsafe);
  sql(migration,unsafe,false);
  console.log('PASS unsafe legacy source_event_ids is rejected without a lossy cast');
} finally { sql(`drop database ${unsafe}`,'postgres'); }
console.log('PASS facility room assignment writes the production resident_id contract');
