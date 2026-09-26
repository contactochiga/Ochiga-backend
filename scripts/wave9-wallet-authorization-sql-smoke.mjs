import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const db=`w9_wallet_${Date.now()}`;
function sql(input,database=db,ok=true){const r=spawnSync('docker',['exec','-i','supabase_db_Ochiga-backend','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input,encoding:'utf8'});if(ok)assert.equal(r.status,0,r.stderr);else {assert.notEqual(r.status,0);assert.match(r.stderr,/permission denied/);}return r.stdout.trim();}
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
sql(`create database ${db}`,'postgres');
try {
 sql(`create table wallets(id uuid primary key,user_id uuid,balance numeric,is_frozen boolean default false,estate_id uuid,home_id uuid,membership_id uuid,updated_at timestamptz);
 create table wallet_transactions(id uuid default gen_random_uuid(),wallet_id uuid,wallet_account_id uuid,user_id uuid,estate_id uuid,home_id uuid,membership_id uuid,direction text,type text,amount numeric,reference text,status text,metadata jsonb,updated_at timestamptz);
 grant usage on schema public to service_role,anon,authenticated; grant select,update on wallets to service_role; grant select,insert on wallet_transactions to service_role;
 insert into wallets(id,user_id,balance) values ('11111111-1111-4111-a111-111111111111','22222222-2222-4222-a222-222222222222',100);`);
 for(const path of ['supabase/migrations/20260711000100_wallet_atomic_debit.sql','supabase/migrations/20260718163714_release_stabilization_multi_home_isolation.sql']) {
   const functions=read(path).match(/create or replace function public\.oyi_(?:credit|debit)(?:_home)?_wallet\([\s\S]*?\$\$;/gi)||[];
   assert.equal(functions.length,2);for(const f of functions)sql(f);
 }
 const correction=read('supabase/migrations/20260926211819_wallet_rpc_service_boundary.sql');sql(correction);sql(correction);
 for(const name of ['oyi_credit_wallet','oyi_debit_wallet','oyi_credit_home_wallet','oyi_debit_home_wallet']){
   const args=(name.includes('_home_')?"'11111111-1111-4111-a111-111111111111',":"")+"'22222222-2222-4222-a222-222222222222',1";
   for(const role of ['anon','authenticated'])sql(`set role ${role}; select public.${name}(${args});`,db,false);
   assert.equal(sql(`set role service_role; select public.${name}(${args})->>'ok';`),'true');
 }
 assert.equal(sql('select balance from wallets'),'100');
 assert.equal(sql('select count(*) from wallet_transactions'),'4');
 assert.equal(sql("select count(*) from pg_proc where proname like 'oyi_%wallet' and prosecdef"),'0');
 sql("set session authorization authenticated; set role service_role;",db,false);
 assert.equal(sql("set role service_role; select public.oyi_debit_home_wallet('11111111-1111-4111-a111-111111111111','33333333-3333-4333-a333-333333333333',1)->>'ok'"),'false');
 console.log('PASS four original wallet bodies: anon/authenticated denied, service success, wrong owner denied, no escalation, ledger preserved, repeat migration safe');
}finally{sql(`drop database ${db}`,'postgres');}
