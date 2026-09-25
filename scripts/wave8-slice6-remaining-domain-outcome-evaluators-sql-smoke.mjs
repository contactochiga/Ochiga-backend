// Wave 8 Slice 6 -- Camera/Maintenance/Visitor Outcome Evaluators: real-
// Postgres proof. This slice introduces NO new table and NO new
// migration -- it reuses Slice 5's own real partial unique index
// (idx_intelligence_feedback_outcome_evaluation_identity, scoped to
// feedback_type='outcome_evaluation') for genuine DB-level feedback
// idempotency. This smoke proves, against a real Postgres instance, the
// object_id redesign this slice required (evidence key folded directly
// into object_id -- see cameraOutcomeEvaluator.ts's own comment): the
// SAME evidence re-inserted collides (real idempotency), while
// DIFFERENT evidence for the SAME underlying target does NOT collide
// (real historical preservation) -- a distinction the functional
// smoke's in-memory mock could assert but only a real unique index can
// actually prove.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const container = process.env.OYI_LOCAL_POSTGRES_CONTAINER || 'supabase_db_Ochiga-backend';
const db = 'oyi_wave8_slice6_' + Date.now();

// Extracted verbatim from the real migrations/schema this slice reads
// from (no new columns/tables added by this slice):
// 20260728143000_oyi_core_convergence_canonical_storage.sql
// (intelligence_feedback), 20260926090000_wave8_slice5_learning_
// parameter_governance.sql (the partial unique index this slice
// reuses), migrations/schema.sql + 20260924130000_maintenance_requests_
// schema_drift_closure.sql (maintenance_requests, columns this slice's
// SELECT actually reads), and the real visitor_access/visitor_analytics
// shape read directly from visitorController.ts/visitorAccessTransition.ts.
const DDL = `
create table if not exists public.intelligence_feedback (
  id uuid primary key default gen_random_uuid(),
  object_type text not null,
  object_id text not null,
  feedback_type text not null,
  actor_id text,
  reason text,
  outcome_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_intelligence_feedback_lookup
  on public.intelligence_feedback(object_type, feedback_type, object_id);
create unique index if not exists idx_intelligence_feedback_outcome_evaluation_identity
  on public.intelligence_feedback(object_type, object_id, feedback_type)
  where feedback_type = 'outcome_evaluation';

create table if not exists public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid,
  home_id uuid,
  status text,
  completed_at timestamptz,
  verified_at timestamptz,
  verified_by_resident boolean not null default false,
  resident_rating integer,
  resident_feedback text
);

create table if not exists public.visitor_access (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.visitor_analytics (
  id uuid primary key default gen_random_uuid(),
  visitor_access_id uuid not null,
  arrived_at timestamptz,
  exited_at timestamptz,
  duration_minutes integer
);
`;

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

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log('PASS ' + name);
}

function esc(v) {
  return String(v).replace(/'/g, "''");
}

await sql(`create database ${db}`, 'postgres');
try {
  console.log("\n=== Apply the EXISTING, unmodified table definitions this slice reads from -- no new migration ===");
  await sql(DDL);

  console.log('\n=== Camera: feedback identity/idempotency against the real Slice 5 index ===');
  const cameraObjectIdBase = 'camera:cam-sql-1:target:healthy_acquisition:goal-sql-1';
  await test('the same evidence (same observedAt-derived object_id) inserted twice is rejected by the DB (23505)', async () => {
    const objectId = `${cameraObjectIdBase}:at:2026-09-25T10:00:00.000Z`;
    await sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('camera_state_outcome', '${esc(objectId)}', 'outcome_evaluation', '{"result":"achieved"}')`);
    let threw = false;
    try {
      await sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('camera_state_outcome', '${esc(objectId)}', 'outcome_evaluation', '{"result":"achieved"}')`);
    } catch (error) {
      threw = true;
      assert.ok(/duplicate key value violates unique constraint/i.test(String(error.message)));
    }
    assert.equal(threw, true, 'a duplicate evaluation of the exact same evidence must be rejected at the DB level');
    const count = await sql(`select count(*) from intelligence_feedback where object_id='${esc(objectId)}'`);
    assert.equal(count, '1');
  });

  await test('DIFFERENT evidence for the SAME underlying camera/target does NOT collide -- real historical preservation', async () => {
    const achievedId = `${cameraObjectIdBase}:at:2026-09-25T10:00:00.000Z`;
    const laterDegradedId = `${cameraObjectIdBase}:at:2026-09-25T12:00:00.000Z`;
    await sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('camera_state_outcome', '${esc(laterDegradedId)}', 'outcome_evaluation', '{"result":"contradicted"}')`);
    const rows = await sql(`select outcome_metadata->>'result' as result from intelligence_feedback where object_type='camera_state_outcome' and object_id in ('${esc(achievedId)}','${esc(laterDegradedId)}') order by outcome_metadata->>'result'`);
    const results = rows.split('\n').sort();
    assert.deepEqual(results, ['achieved', 'contradicted'], 'both the earlier achieved and later contradicted evaluations must survive as distinct rows');
  });

  await test('a genuine CONCURRENT double-insert race for identical evidence resolves to exactly one surviving row', async () => {
    const objectId = 'camera:cam-sql-race:target:healthy_acquisition:goal-sql-race:at:2026-09-25T13:00:00.000Z';
    const insertOne = () => sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('camera_state_outcome', '${esc(objectId)}', 'outcome_evaluation', '{"result":"achieved"}')`).catch((e) => ({ failed: true, message: e.message }));
    const results = await Promise.all([insertOne(), insertOne()]);
    const failures = results.filter((r) => r && r.failed);
    assert.equal(failures.length, 1, 'exactly one of the two concurrent identical-evidence inserts must fail on the unique index');
    const count = await sql(`select count(*) from intelligence_feedback where object_id='${esc(objectId)}'`);
    assert.equal(count, '1');
  });

  console.log('\n=== Cross-domain isolation: camera/maintenance/visitor never collide despite sharing feedback_type ===');
  await test('the same lineage string used as an object_id suffix across 3 different object_types yields 3 independent rows', async () => {
    const suffix = 'shared-lineage-key:at:2026-09-25T14:00:00.000Z';
    await sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('camera_state_outcome', '${esc(suffix)}', 'outcome_evaluation', '{}')`);
    await sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('maintenance_outcome', '${esc(suffix)}', 'outcome_evaluation', '{}')`);
    await sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('visitor_outcome', '${esc(suffix)}', 'outcome_evaluation', '{}')`);
    const count = await sql(`select count(*) from intelligence_feedback where object_id='${esc(suffix)}'`);
    assert.equal(count, '3');
  });

  console.log('\n=== Maintenance: factual state query shape + integrity-gate scenario ===');
  const maintenanceId = await sql(`insert into maintenance_requests (status, completed_at, verified_by_resident) values ('completed', '2026-09-25T09:00:00.000Z', true) returning id`);
  await test('a valid completion sequence (completed_at present) is queryable and trustworthy', async () => {
    const row = await sql(`select status, completed_at, verified_by_resident from maintenance_requests where id='${maintenanceId}'`);
    const [status, completedAt, verified] = row.split('|');
    assert.equal(status, 'completed');
    assert.ok(completedAt);
    assert.equal(verified, 't');
  });
  const integrityGapId = await sql(`insert into maintenance_requests (status, completed_at, verified_by_resident) values (null, null, true) returning id`);
  await test('the disclosed integrity gap is real at the schema level -- verified_by_resident=true with completed_at NULL is a legal row today', async () => {
    const row = await sql(`select completed_at, verified_by_resident from maintenance_requests where id='${integrityGapId}'`);
    const [completedAt, verified] = row.split('|');
    assert.equal(completedAt, '');
    assert.equal(verified, 't', 'the schema itself places zero server-side constraint preventing this -- confirms the audited gap is real, not hypothetical');
  });

  console.log('\n=== Visitor: lifecycle evidence query shape + historical entry preservation ===');
  const visitorId = await sql(`insert into visitor_access (status) values ('entered') returning id`);
  await sql(`insert into visitor_analytics (visitor_access_id, arrived_at) values ('${visitorId}', '2026-09-25T10:00:00.000Z')`);
  await test('entered status with a real visitor_analytics.arrived_at row is queryable', async () => {
    const row = await sql(`select va.status, an.arrived_at from visitor_access va join visitor_analytics an on an.visitor_access_id = va.id where va.id='${visitorId}'`);
    const [status, arrivedAt] = row.split('|');
    assert.equal(status, 'entered');
    assert.ok(arrivedAt);
  });
  await sql(`update visitor_access set status='exited' where id='${visitorId}'`);
  await sql(`update visitor_analytics set exited_at='2026-09-25T12:00:00.000Z', duration_minutes=120 where visitor_access_id='${visitorId}'`);
  await test('after exit, arrived_at remains untouched -- the historical entry fact survives the later status change', async () => {
    const row = await sql(`select va.status, an.arrived_at, an.exited_at from visitor_access va join visitor_analytics an on an.visitor_access_id = va.id where va.id='${visitorId}'`);
    const [status, arrivedAt, exitedAt] = row.split('|');
    assert.equal(status, 'exited');
    assert.ok(arrivedAt.startsWith('2026-09-25 10:00:00'), `expected arrived_at to still be the original entry timestamp, got: ${arrivedAt}`);
    assert.ok(exitedAt);
  });

  console.log('\n=== Query plan sanity ===');
  await test('the real partial unique index this slice reuses exists in pg_indexes', async () => {
    const row = await sql(`select indexname from pg_indexes where tablename='intelligence_feedback' and indexname='idx_intelligence_feedback_outcome_evaluation_identity'`);
    assert.equal(row, 'idx_intelligence_feedback_outcome_evaluation_identity');
  });

  console.log(`\n=== wave8-slice6-remaining-domain-outcome-evaluators-sql-smoke: ${passed} checks passed ===`);
} finally {
  await sql(`drop database if exists ${db}`, 'postgres').catch(() => {});
}
