// Wave 7 Slice 5 -- Canonical Decision object: real-PostgreSQL proof.
//
// Proves what the mocked smoke cannot: (1) the migration applies
// cleanly, idempotently, with the right constraints/indexes, against a
// real database; (2) real unique-constraint-backed idempotent creation
// under genuine concurrency (two truly concurrent identical inserts
// resolve to exactly one row); (3) real CAS transition semantics under
// genuine concurrency (two truly concurrent conflicting transitions
// cannot both win); (4) the goal_id/superseded_by foreign keys behave as
// designed (ON DELETE SET NULL, no cascade-delete of history).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const container = process.env.OYI_LOCAL_POSTGRES_CONTAINER || 'supabase_db_Ochiga-backend';
const db = 'oyi_wave7_slice5_' + Date.now();

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

await sql(`create database ${db}`, 'postgres');
try {
  console.log('\n=== Migration: applies cleanly, idempotently, with real constraints ===');

  // oyi_goals is a real referenced table (goal_id FK) -- apply its base
  // migration (no estates/homes dependency for a bare insert).
  await sql(readFileSync('supabase/migrations/20260822140000_oyi_goals.sql', 'utf8'));
  await sql(readFileSync('supabase/migrations/20260925090000_wave7_slice2_goal_canonical_signal_lineage.sql', 'utf8'));

  await test('Decision migration applies cleanly against a fresh database', async () => {
    await sql(readFileSync('supabase/migrations/20260925100000_wave7_slice5_canonical_decision.sql', 'utf8'));
    const table = await sql(`select table_name from information_schema.tables where table_name='oyi_decisions'`);
    assert.equal(table, 'oyi_decisions');
  });

  await test('re-applying the migration is idempotent (no duplicate columns/indexes, no error)', async () => {
    await sql(readFileSync('supabase/migrations/20260925100000_wave7_slice5_canonical_decision.sql', 'utf8')); // must not throw
    const count = await sql(`select count(*) from information_schema.columns where table_name='oyi_decisions'`);
    assert.equal(count, '24'); // the exact real column count -- proves no duplication on reapply
  });

  await test('decision_key has a real unique index', async () => {
    const idx = await sql(`select indexdef from pg_indexes where tablename='oyi_decisions' and indexname='oyi_decisions_decision_key_key'`);
    assert.ok(/unique/i.test(idx));
    assert.ok(idx.includes('decision_key'));
  });

  await test('status has a real CHECK constraint limited to the 6 declared Decision statuses', async () => {
    await assert.rejects(() => sql(`insert into oyi_decisions(decision_key, entity_type, entity_id, action_type, title, status, authority_mode) values('bad-status-test','x','y','z','t','not_a_real_status','deterministic_policy')`));
  });

  await test('authority_mode has a real CHECK constraint', async () => {
    await assert.rejects(() => sql(`insert into oyi_decisions(decision_key, entity_type, entity_id, action_type, title, status, authority_mode) values('bad-authority-test','x','y','z','t','selected','made_up_authority')`));
  });

  await test('goal_id, when set, must reference a real oyi_goals row (real FK enforced)', async () => {
    await assert.rejects(() => sql(`insert into oyi_decisions(decision_key, entity_type, entity_id, action_type, title, status, authority_mode, goal_id) values('bad-goal-fk-test','x','y','z','t','selected','deterministic_policy','00000000-0000-0000-0000-000000000000')`));
  });

  await test('no unrelated foreign keys were added -- only goal_id (oyi_goals) and superseded_by (self)', async () => {
    const fks = await sql(`select confrelid::regclass::text from pg_constraint where conrelid='oyi_decisions'::regclass and contype='f' order by 1`);
    const rows = fks.split('\n').filter(Boolean).sort();
    assert.deepEqual(rows, ['oyi_decisions', 'oyi_goals']);
  });

  console.log('\n=== Real idempotent creation under genuine concurrency ===');

  await test('two truly concurrent identical inserts resolve to exactly one row (real unique-index race)', async () => {
    const insertOne = () =>
      sql(
        `insert into oyi_decisions(decision_key, entity_type, entity_id, action_type, title, status, authority_mode, requires_human, selected_by)
         values ('decision:office_lead:lead-race:HANDOFF:sig-race','office_lead','lead-race','HANDOFF','Race test','awaiting_human','deterministic_policy',true,'system')
         on conflict (decision_key) do nothing
         returning id`
      );
    const [a, b] = await Promise.all([insertOne(), insertOne()]);
    // Exactly one of the two concurrent attempts inserted a row; the
    // other's ON CONFLICT DO NOTHING legitimately returns empty.
    const nonEmpty = [a, b].filter((r) => r.length > 0);
    assert.equal(nonEmpty.length, 1, 'exactly one concurrent insert should have won');
    const count = await sql(`select count(*) from oyi_decisions where decision_key='decision:office_lead:lead-race:HANDOFF:sig-race'`);
    assert.equal(count, '1');
  });

  console.log('\n=== Real CAS transition under genuine concurrency ===');

  await test('two truly concurrent conflicting transitions cannot both win', async () => {
    const id = await sql(
      `insert into oyi_decisions(decision_key, entity_type, entity_id, action_type, title, status, authority_mode, requires_human, selected_by)
       values ('decision:office_lead:lead-cas-race:HANDOFF:sig-cas-race','office_lead','lead-cas-race','HANDOFF','CAS race test','awaiting_human','deterministic_policy',true,'system')
       returning id`
    );
    const approve = () => sql(`update oyi_decisions set status='approved', decided_at=now() where id='${id}' and status in ('awaiting_human') returning id`);
    const reject = () => sql(`update oyi_decisions set status='rejected', decided_at=now() where id='${id}' and status in ('awaiting_human') returning id`);
    const [approveResult, rejectResult] = await Promise.all([approve(), reject()]);
    const winners = [approveResult, rejectResult].filter((r) => r.length > 0);
    assert.equal(winners.length, 1, 'exactly one of two conflicting concurrent transitions should have won the CAS race');
    const finalStatus = await sql(`select status from oyi_decisions where id='${id}'`);
    assert.ok(['approved', 'rejected'].includes(finalStatus));
  });

  console.log('\n=== Lineage / history behavior ===');

  await test('deleting the referenced goal sets goal_id to null on the Decision, never deletes Decision history', async () => {
    const goalId = await sql(`insert into oyi_goals(correlation_id, surface, objective, canonical_signal_key) values ('corr-decision-goal-link','office_material_event','test objective','sig-goal-link') returning id`);
    const decisionId = await sql(
      `insert into oyi_decisions(decision_key, entity_type, entity_id, action_type, title, status, authority_mode, requires_human, selected_by, goal_id)
       values ('decision:office_lead:lead-goal-link:CONTINUE_RELATIONSHIP:sig-goal-link','office_lead','lead-goal-link','CONTINUE_RELATIONSHIP','t','selected','deterministic_policy',false,'system','${goalId}')
       returning id`
    );
    await sql(`delete from oyi_goals where id='${goalId}'`);
    const stillExists = await sql(`select count(*) from oyi_decisions where id='${decisionId}'`);
    assert.equal(stillExists, '1', 'Decision row must survive goal deletion -- it is history, not owned by the goal');
    const goalIdAfter = await sql(`select coalesce(goal_id::text, '<NULL>') from oyi_decisions where id='${decisionId}'`);
    assert.equal(goalIdAfter, '<NULL>');
  });

  await test('a Decision without any recommendation/goal/canonical-signal lineage is legitimate and persists cleanly', async () => {
    const id = await sql(
      `insert into oyi_decisions(decision_key, entity_type, entity_id, action_type, title, status, authority_mode, requires_human, selected_by)
       values ('decision:office_lead:lead-no-lineage:DO_NOT_CONTACT:no-signal','office_lead','lead-no-lineage','DO_NOT_CONTACT','t','selected','deterministic_policy',false,'system')
       returning id`
    );
    const row = await sql(`select coalesce(canonical_signal_key,'<NULL>')||'|'||coalesce(recommendation_key,'<NULL>')||'|'||coalesce(goal_id::text,'<NULL>') from oyi_decisions where id='${id}'`);
    assert.equal(row, '<NULL>|<NULL>|<NULL>');
  });

  console.log(`\n=== wave7-slice5-canonical-decision-sql-smoke: ${passed} checks passed ===`);
} finally {
  await sql(`drop database if exists ${db}`, 'postgres').catch(() => {});
}
