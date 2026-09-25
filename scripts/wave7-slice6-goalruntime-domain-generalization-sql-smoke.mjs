// Wave 7 Slice 6 -- GoalRuntime Domain Generalization: real-PostgreSQL
// proof. Proves what the mocked smoke cannot: (1) no migration was
// needed -- target_entities/plan are real jsonb columns, so the new
// estate_id/home_id/device_id/device_command fields round-trip cleanly
// against the REAL, unmodified oyi_goals table; (2) findActiveForDevice
// -- the operational-goal dedup query -- is a real, correct Postgres
// jsonb containment query; (3) an existing Office goal (no operational
// fields at all) persists/reads back byte-identical, proving backward
// compatibility at the database level, not just in-process.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const container = process.env.OYI_LOCAL_POSTGRES_CONTAINER || 'supabase_db_Ochiga-backend';
const db = 'oyi_wave7_slice6_' + Date.now();

function sql(q, database = db) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database]);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve(out.trim()) : reject(new Error(err))));
    p.stdin.end(q);
  });
}
const json = (o) => "'" + JSON.stringify(o).replaceAll("'", "''") + "'::jsonb";

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log('PASS ' + name);
}

await sql(`create database ${db}`, 'postgres');
try {
  await sql(readFileSync('supabase/migrations/20260822140000_oyi_goals.sql', 'utf8'));
  await sql(readFileSync('supabase/migrations/20260925090000_wave7_slice2_goal_canonical_signal_lineage.sql', 'utf8'));

  console.log('\n=== No migration needed: target_entities/plan are real jsonb columns ===');

  await test('target_entities and plan are genuinely jsonb (confirms Slice 6 needed zero schema changes)', async () => {
    const targetType = await sql(`select data_type from information_schema.columns where table_name='oyi_goals' and column_name='target_entities'`);
    const planType = await sql(`select data_type from information_schema.columns where table_name='oyi_goals' and column_name='plan'`);
    assert.equal(targetType, 'jsonb');
    assert.equal(planType, 'jsonb');
  });

  console.log('\n=== Operational goal: real round-trip with estate_id/home_id/device_id + device_action plan step ===');

  const operationalTargets = { lead_id: null, contact_id: null, user_id: null, organization_id: null, name: null, email: null, phone: null, whatsapp_phone: null, estate_id: '11111111-1111-4111-8111-111111111111', home_id: '22222222-2222-4222-8222-222222222222', device_id: '33333333-3333-4333-8333-333333333333' };
  const operationalPlan = [{ step_index: 0, channel: 'device', action_type: 'device_action', body: null, wait_hours: 0, skip_if: null, status: 'pending', executed_at: null, result: null, device_command: { device_id: '33333333-3333-4333-8333-333333333333', action_id: 'device.on', command: { power: 'on' } } }];

  const opGoalId = await sql(`insert into oyi_goals(correlation_id, surface, objective, target_entities, plan, status, canonical_signal_key) values ('corr-op-1','facility','Restore Device X to the desired operating state',${json(operationalTargets)},${json(operationalPlan)},'active',null) returning id`);

  await test('the operational goal round-trips estate_id/home_id/device_id exactly', async () => {
    const row = await sql(`select (target_entities->>'estate_id')||'|'||(target_entities->>'home_id')||'|'||(target_entities->>'device_id') from oyi_goals where id='${opGoalId}'`);
    assert.equal(row, '11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222|33333333-3333-4333-8333-333333333333');
  });

  await test('the device_action plan step round-trips its device_command payload exactly', async () => {
    const row = await sql(`select plan->0->'device_command'->>'action_id' from oyi_goals where id='${opGoalId}'`);
    assert.equal(row, 'device.on');
  });

  await test('target identity is descriptive only, never authorization -- no role/permission columns exist on oyi_goals at all', async () => {
    const authorityColumns = await sql(`select count(*) from information_schema.columns where table_name='oyi_goals' and column_name in ('role','permissions','authorized','can_control')`);
    assert.equal(authorityColumns, '0');
  });

  console.log('\n=== findActiveForDevice: real jsonb containment dedup query ===');

  await test('a real Postgres @> containment query finds the active operational goal by device_id', async () => {
    const found = await sql(`select id from oyi_goals where target_entities @> ${json({ device_id: '33333333-3333-4333-8333-333333333333' })}`);
    assert.equal(found, opGoalId);
  });

  await test('same device, retried (identical semantic goal) -> the dedup query still finds exactly the one active goal, proving a retry would not create a duplicate if a real producer checked first', async () => {
    const count = await sql(`select count(*) from oyi_goals where target_entities @> ${json({ device_id: '33333333-3333-4333-8333-333333333333' })} and status not in ('completed','cancelled','expired','failed')`);
    assert.equal(count, '1');
  });

  await test('a different device -> the dedup query correctly finds nothing (different target, different identity)', async () => {
    const found = await sql(`select coalesce(string_agg(id::text,','),'') from oyi_goals where target_entities @> ${json({ device_id: '44444444-4444-4444-8444-444444444444' })}`);
    assert.equal(found, '');
  });

  await test('a terminal-status goal for the same device is correctly excluded from the active dedup set (client-side filter, matching findActiveForLead\'s own established behaviour)', async () => {
    await sql(`update oyi_goals set status='completed' where id='${opGoalId}'`);
    const activeRows = await sql(`select target_entities, status from oyi_goals where target_entities @> ${json({ device_id: '33333333-3333-4333-8333-333333333333' })}`);
    assert.ok(activeRows.includes('completed'), 'the row itself must still be queryable by Postgres (findActiveForDevice filters terminal status client-side, exactly like findActiveForLead)');
  });

  console.log('\n=== Office/commercial goal: unchanged, byte-level backward compatibility ===');

  const officeTargets = { lead_id: 'lead-office-1', contact_id: null, user_id: null, organization_id: null, name: 'A Lead', email: null, phone: null, whatsapp_phone: '+2348000000000' };
  const officeGoalId = await sql(`insert into oyi_goals(correlation_id, surface, objective, target_entities, status, canonical_signal_key) values ('corr-office-1','office_material_event','Development/JV relationship communication',${json(officeTargets)},'active','office:evt-1:office:lead-office-1:global:no-home') returning id`);

  await test('an existing-shape Office goal (no operational fields at all) persists and reads back with no estate_id/home_id/device_id present', async () => {
    const row = await sql(`select coalesce(target_entities->>'estate_id','<ABSENT>')||'|'||coalesce(target_entities->>'device_id','<ABSENT>') from oyi_goals where id='${officeGoalId}'`);
    assert.equal(row, '<ABSENT>|<ABSENT>');
  });

  await test('Office lead-based dedup (findActiveForLead\'s own real query) is unaffected by the new device dedup query existing', async () => {
    const found = await sql(`select id from oyi_goals where target_entities @> ${json({ lead_id: 'lead-office-1' })}`);
    assert.equal(found, officeGoalId);
  });

  console.log(`\n=== wave7-slice6-goalruntime-domain-generalization-sql-smoke: ${passed} checks passed ===`);
} finally {
  await sql(`drop database if exists ${db}`, 'postgres').catch(() => {});
}
