// Wave 8 Slice 3 -- Goal Outcome / Workflow Completion Separation: real-
// Postgres proof. This slice introduces NO new table and NO new writes
// (goalOutcomeEvaluator.ts is pure read) -- both intelligence_feedback
// and oyi_decisions are EXISTING, unmodified tables. This smoke proves
// the exact read-only query shape (a decisionId lookup by goal_id, then
// a batched intelligence_feedback lookup by object_id) against a real
// Postgres instance, and proves the "latest row wins" re-evaluation
// semantics genuinely work against real timestamps, not just the
// in-memory mock the functional smoke uses.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const container = process.env.OYI_LOCAL_POSTGRES_CONTAINER || 'supabase_db_Ochiga-backend';
const db = 'oyi_wave8_slice3_' + Date.now();

// Extracted verbatim from the real migrations (intelligence_feedback:
// 20260728143000_oyi_core_convergence_canonical_storage.sql lines
// 160-169; oyi_decisions's minimal shape needed here:
// 20260925100000_wave7_slice5_canonical_decision.sql, goal_id column
// only -- FK/other columns not needed by this slice's own read path, so
// this throwaway DB creates only the columns this smoke actually
// exercises, matching the established per-table extraction convention).
const DDL = `
create table if not exists public.oyi_decisions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid
);
create index if not exists idx_oyi_decisions_goal on public.oyi_decisions(goal_id);

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

async function findDecisionId(goalId) {
  const row = await sql(`select id from oyi_decisions where goal_id='${esc(goalId)}' limit 1`);
  return row || null;
}

async function fetchLatestByObjectId(objectIds) {
  const idList = objectIds.map((id) => `'${esc(id)}'`).join(',');
  const rows = await sql(
    `select object_id, outcome_metadata->>'result' as result, created_at from intelligence_feedback where object_type='device_state_outcome' and feedback_type='device_state_outcome_evaluation' and object_id in (${idList}) order by created_at`
  );
  const latest = new Map();
  if (rows) {
    for (const line of rows.split('\n')) {
      const [objectId, result, createdAt] = line.split('|');
      const existing = latest.get(objectId);
      if (!existing || createdAt > existing.createdAt) latest.set(objectId, { result, createdAt });
    }
  }
  return latest;
}

await sql(`create database ${db}`, 'postgres');
try {
  console.log('\n=== Apply the EXISTING, unmodified table definitions this slice reads from -- no new migration ===');
  await sql(DDL);

  await test('no Decision exists for this goal -> honest null, falls back to goalId as the lineage key', async () => {
    const id = await findDecisionId('33333333-3333-3333-3333-333333333333');
    assert.equal(id, null);
  });

  await test('a real Decision linked to this goal is found by the exact query goalEvaluator.ts already performs', async () => {
    await sql(`insert into oyi_decisions(id, goal_id) values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')`);
    const id = await findDecisionId('22222222-2222-2222-2222-222222222222');
    assert.equal(id, '11111111-1111-1111-1111-111111111111');
  });

  console.log('\n=== Latest-row-wins re-evaluation semantics against real timestamps ===');
  await test('two rows for the same object_id -> the later created_at wins, the earlier one is untouched', async () => {
    const objectId = 'device:dev-1:action:device.off:goal-1';
    await sql(`insert into intelligence_feedback(object_type, object_id, feedback_type, outcome_metadata, created_at) values ('device_state_outcome','${objectId}','device_state_outcome_evaluation', jsonb_build_object('result','unverified'), '2026-09-25T10:00:00Z')`);
    await sql(`insert into intelligence_feedback(object_type, object_id, feedback_type, outcome_metadata, created_at) values ('device_state_outcome','${objectId}','device_state_outcome_evaluation', jsonb_build_object('result','achieved'), '2026-09-25T11:00:00Z')`);
    const latest = await fetchLatestByObjectId([objectId]);
    assert.equal(latest.get(objectId).result, 'achieved');
    const count = await sql(`select count(*) from intelligence_feedback where object_id='${objectId}'`);
    assert.equal(count, '2', 'both rows must remain -- re-evaluation never deletes or overwrites history');
  });

  console.log('\n=== A goal with no evaluation rows at all -> empty map, never fabricated ===');
  await test('a device step that has never been evaluated returns no evidence, not a guessed result', async () => {
    const latest = await fetchLatestByObjectId(['device:dev-never-evaluated:action:device.off:goal-x']);
    assert.equal(latest.size, 0);
  });

  console.log('\n=== Query plan sanity: the intelligence_feedback lookup uses the existing index ===');
  await test('EXPLAIN confirms an index-assisted plan, matching Slice 1/2\'s own proof', async () => {
    const plan = await sql(`explain select object_id from intelligence_feedback where object_type='device_state_outcome' and feedback_type='device_state_outcome_evaluation' and object_id='device:dev-1:action:device.off:goal-1'`);
    assert.ok(/idx_intelligence_feedback_lookup|Index/i.test(plan), `expected an index-assisted plan, got: ${plan}`);
  });

  console.log(`\n=== wave8-slice3-goal-outcome-workflow-separation-sql-smoke: ${passed} checks passed ===`);
} finally {
  await sql(`drop database if exists ${db}`, 'postgres').catch(() => {});
}
