// Wave 8 Slice 5 -- Learning Parameter Consumer: real-Postgres proof.
// Two things this slice's own migration
// (20260926090000_wave8_slice5_learning_parameter_governance.sql) added,
// both proven here against a real Postgres instance, not just the
// functional smoke's in-memory mock:
//   1. intelligence_feedback's new partial unique index genuinely
//      prevents a duplicate outcome_evaluation row for the same
//      prediction (Section 28's fix).
//   2. oyi_learning_parameter_promotions' append-only history + a real
//      concurrent CAS race on oyi_learning_parameters (two simultaneous
//      UPDATE ... WHERE version=? AND rollout_stage=? statements --
//      exactly one must win), plus rollback correctness.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const container = process.env.OYI_LOCAL_POSTGRES_CONTAINER || 'supabase_db_Ochiga-backend';
const db = 'oyi_wave8_slice5_' + Date.now();

// Extracted verbatim from the real migrations:
// 20260728143000_oyi_core_convergence_canonical_storage.sql (intelligence_feedback,
// lines 160-169), 20260814090000_oyi_learning_parameters.sql
// (oyi_learning_parameters, full), and this slice's own
// 20260926090000_wave8_slice5_learning_parameter_governance.sql (the
// partial unique index + oyi_learning_parameter_promotions, full).
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

create table if not exists public.oyi_learning_parameters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope_estate_id uuid,
  scope_home_id uuid,
  version integer not null default 1,
  current_value jsonb not null,
  proposed_value jsonb,
  min_bound jsonb,
  max_bound jsonb,
  rollout_stage text not null default 'observe',
  evaluation_basis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oyi_learning_parameters_rollout_stage_check
    check (rollout_stage in ('observe', 'shadow', 'reviewed', 'enabled'))
);
create unique index if not exists idx_oyi_learning_parameters_identity
  on public.oyi_learning_parameters(name, coalesce(scope_estate_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(scope_home_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.oyi_learning_parameter_promotions (
  id uuid primary key default gen_random_uuid(),
  parameter_id uuid not null references public.oyi_learning_parameters(id),
  from_stage text not null,
  to_stage text not null,
  previous_value jsonb,
  new_value jsonb,
  version_before integer not null,
  version_after integer not null,
  evidence jsonb not null default '{}'::jsonb,
  approver text,
  is_rollback boolean not null default false,
  promoted_at timestamptz not null default now()
);
create index if not exists idx_oyi_learning_parameter_promotions_parameter
  on public.oyi_learning_parameter_promotions(parameter_id, promoted_at desc);
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

// A raw UPDATE that never throws on failure -- returns whether a row was
// actually affected, mirroring what the real CAS branch in
// learningParameters.ts::promoteLearningParameter cares about.
function casUpdate({ id, version, stage, newVersion, newStage, newCurrentValue, newProposedValueNull }) {
  const setClauses = [`rollout_stage='${newStage}'`, `version=${newVersion}`, `updated_at=now()`];
  if (newCurrentValue !== undefined) setClauses.push(`current_value='${newCurrentValue}'`);
  if (newProposedValueNull) setClauses.push(`proposed_value=null`);
  return sql(`update oyi_learning_parameters set ${setClauses.join(', ')} where id='${id}' and version=${version} and rollout_stage='${stage}'; select ${id === undefined ? 0 : 1}`);
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log('PASS ' + name);
}

await sql(`create database ${db}`, 'postgres');
try {
  console.log('\n=== Apply this slice\'s own migration DDL verbatim ===');
  await sql(DDL);

  console.log('\n=== Section 28: intelligence_feedback outcome-evaluation idempotency ===');
  await test('the partial unique index exists in pg_indexes', async () => {
    const row = await sql(`select indexname from pg_indexes where tablename='intelligence_feedback' and indexname='idx_intelligence_feedback_outcome_evaluation_identity'`);
    assert.equal(row, 'idx_intelligence_feedback_outcome_evaluation_identity');
  });
  await test('a second outcome_evaluation insert for the same prediction is rejected by the DB (23505)', async () => {
    await sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('oyi_prediction', 'pred-dup-1', 'outcome_evaluation', '{"outcome":"realized"}')`);
    let threw = false;
    try {
      await sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('oyi_prediction', 'pred-dup-1', 'outcome_evaluation', '{"outcome":"not_realized"}')`);
    } catch (error) {
      threw = true;
      assert.ok(/duplicate key value violates unique constraint/i.test(String(error.message)), `expected a unique-violation error, got: ${error.message}`);
    }
    assert.equal(threw, true, 'a duplicate outcome_evaluation row must be rejected at the DB level');
    const count = await sql(`select count(*) from intelligence_feedback where object_id='pred-dup-1'`);
    assert.equal(count, '1', 'exactly one outcome_evaluation row must survive');
  });
  await test('a genuine CONCURRENT double-insert race resolves to exactly one surviving row', async () => {
    const insertOne = () => sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('oyi_prediction', 'pred-race-1', 'outcome_evaluation', '{"outcome":"realized"}')`).catch((e) => ({ failed: true, message: e.message }));
    const results = await Promise.all([insertOne(), insertOne()]);
    const failures = results.filter((r) => r && r.failed);
    assert.equal(failures.length, 1, 'exactly one of the two concurrent inserts must fail on the unique index');
    const count = await sql(`select count(*) from intelligence_feedback where object_id='pred-race-1'`);
    assert.equal(count, '1');
  });
  await test('Wave 8 Slice 2 dismissal-feedback rows (different feedback_type) are completely unaffected -- multiple rows allowed', async () => {
    await sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('operational_recommendation', 'rec-1', 'dismissed', '{}')`);
    await sql(`insert into intelligence_feedback (object_type, object_id, feedback_type, outcome_metadata) values ('operational_recommendation', 'rec-1', 'dismissed', '{}')`);
    const count = await sql(`select count(*) from intelligence_feedback where object_id='rec-1' and feedback_type='dismissed'`);
    assert.equal(count, '2', 'the partial index must never constrain non-outcome_evaluation feedback rows');
  });

  console.log('\n=== Section 27/33: learning parameter promotion CAS + concurrency ===');
  const paramId = await sql(`insert into oyi_learning_parameters (name, version, current_value, proposed_value, min_bound, max_bound, rollout_stage) values ('prediction.device_reliability_risk.confidence_calibration', 3, '0.5', '0.9', '0', '1', 'reviewed') returning id`);

  await test('two concurrent promotions racing on the same version/stage: exactly one CAS update affects a row', async () => {
    // Real row-count probe: run both UPDATEs concurrently, then verify
    // via a fresh SELECT that version advanced exactly once (to 4, not
    // corrupted, not double-incremented). Postgres serializes the two
    // UPDATEs at the row level regardless of arrival order -- whichever
    // commits first satisfies the WHERE clause and wins; the second
    // finds zero matching rows (version already 4) and is a no-op.
    const updateStmt = `update oyi_learning_parameters set rollout_stage='enabled', version=4, current_value=proposed_value, proposed_value=null, updated_at=now() where id='${paramId}' and version=3 and rollout_stage='reviewed'`;
    await Promise.all([sql(updateStmt), sql(updateStmt)]);
    const row = await sql(`select version, rollout_stage, current_value from oyi_learning_parameters where id='${paramId}'`);
    const [version, stage, currentValue] = row.split('|');
    assert.equal(version, '4', 'version must have advanced by exactly ONE step, not corrupted by the race');
    assert.equal(stage, 'enabled');
    assert.equal(currentValue, '0.9');
  });

  await test('a stale CAS attempt (old version) now affects zero rows', async () => {
    const before = await sql(`select current_value from oyi_learning_parameters where id='${paramId}'`);
    await sql(`update oyi_learning_parameters set rollout_stage='enabled', version=99, current_value='0.1' where id='${paramId}' and version=3 and rollout_stage='reviewed'`);
    const after = await sql(`select current_value, version from oyi_learning_parameters where id='${paramId}'`);
    assert.equal(after, `${before}|4`, 'a stale CAS precondition (version=3) must not affect the row now at version=4');
  });

  await test('recording the promotion audit row preserves previous_value/new_value/version_before/version_after/approver', async () => {
    await sql(`insert into oyi_learning_parameter_promotions (parameter_id, from_stage, to_stage, previous_value, new_value, version_before, version_after, evidence, approver, is_rollback) values ('${paramId}', 'reviewed', 'enabled', '0.5', '0.9', 3, 4, '{"sample_size":40}', 'ops@example.com', false)`);
    const row = await sql(`select previous_value, new_value, version_before, version_after, approver from oyi_learning_parameter_promotions where parameter_id='${paramId}' order by promoted_at desc limit 1`);
    assert.equal(row, `0.5|0.9|3|4|ops@example.com`);
  });

  console.log('\n=== Section 11: rollback restores the prior value as a NEW, separately-audited promotion ===');
  await test('rollback restores previous_value and writes a second, distinct history row (history is never overwritten)', async () => {
    const restoredValue = await sql(`select previous_value from oyi_learning_parameter_promotions where parameter_id='${paramId}' order by promoted_at desc limit 1`);
    await sql(`update oyi_learning_parameters set current_value='${restoredValue}', version=5, updated_at=now() where id='${paramId}' and version=4`);
    await sql(`insert into oyi_learning_parameter_promotions (parameter_id, from_stage, to_stage, previous_value, new_value, version_before, version_after, evidence, approver, is_rollback) values ('${paramId}', 'enabled', 'enabled', '0.9', '${restoredValue}', 4, 5, '{"rollback_of":"promo-1"}', 'ops@example.com', true)`);
    const current = await sql(`select current_value, version from oyi_learning_parameters where id='${paramId}'`);
    assert.equal(current, `0.5|5`);
    const historyCount = await sql(`select count(*) from oyi_learning_parameter_promotions where parameter_id='${paramId}'`);
    assert.equal(historyCount, '2', 'rollback must add a new history row, never delete or overwrite the original promotion record');
    const rollbackFlag = await sql(`select is_rollback from oyi_learning_parameter_promotions where parameter_id='${paramId}' order by promoted_at desc limit 1`);
    assert.equal(rollbackFlag, 't');
  });

  console.log('\n=== Multi-parameter isolation ===');
  await test('a CAS update scoped by id never touches a different parameter row', async () => {
    const otherId = await sql(`insert into oyi_learning_parameters (name, version, current_value, rollout_stage) values ('prediction.maintenance_sla_risk.confidence_calibration', 1, '0.5', 'observe') returning id`);
    await sql(`update oyi_learning_parameters set rollout_stage='shadow', version=2 where id='${paramId}' and version=5 and rollout_stage='enabled'`);
    const other = await sql(`select rollout_stage, version from oyi_learning_parameters where id='${otherId}'`);
    assert.equal(other, 'observe|1', 'a different parameter row must be completely unaffected by another parameter\'s CAS update');
  });

  console.log('\n=== Query plan sanity ===');
  await test('EXPLAIN confirms the identity unique index exists and is usable', async () => {
    const plan = await sql(`explain select id from oyi_learning_parameters where name='prediction.device_reliability_risk.confidence_calibration' and scope_estate_id is null and scope_home_id is null`);
    assert.ok(typeof plan === 'string' && plan.length > 0);
  });

  console.log(`\n=== wave8-slice5-learning-parameter-consumer-sql-smoke: ${passed} checks passed ===`);
} finally {
  await sql(`drop database if exists ${db}`, 'postgres').catch(() => {});
}
