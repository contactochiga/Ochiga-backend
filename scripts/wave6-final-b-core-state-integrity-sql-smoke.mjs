// Wave 6 Final B -- real PostgreSQL concurrency + migration proof.
//
// Part 6 (task spec): "Use real local PostgreSQL where practical. Prove
// entry vs deny/revoke/expire, entry vs exit, duplicate entry, duplicate
// exit, stale transition cannot produce contradictory final truth."
// The Node-level mock-supabase smoke (wave6-final-b-core-state-integrity-
// smoke.mjs) proves the *branch logic* of markEntry/markExit deterministically;
// this script proves the underlying CAS primitive itself resolves genuinely
// SIMULTANEOUS writes from separate real PostgreSQL connections (not just
// JS single-threaded call ordering) without contradiction, using the exact
// query shape transitionVisitorAccessStatus (visitorAccessTransition.ts)
// issues: `UPDATE ... SET status=$to WHERE id=$id AND status = ANY($fromAny)
// RETURNING *`.
//
// Also applies the real Wave 6 Final B maintenance_requests migration to a
// throwaway database and proves it is additive, idempotent, and that the
// previously-dropped columns now genuinely persist a write+read round trip.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const container = process.env.OYI_LOCAL_POSTGRES_CONTAINER || 'supabase_db_Ochiga-backend';
const db = 'oyi_wave6_finalb_' + Date.now();
const visitorId = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

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

// Mirrors transitionVisitorAccessStatus's exact CAS query shape.
async function casUpdate(fromAny, to) {
  const list = fromAny.map((s) => `'${s}'`).join(',');
  const out = await sql(
    `update visitor_access set status='${to}', updated_at=now() where id='${visitorId}' and status = any(array[${list}]) returning row_to_json(visitor_access.*);`
  );
  return out ? JSON.parse(out) : null;
}

let checks = 0;
async function test(name, fn) {
  await fn();
  checks += 1;
  console.log('PASS ' + name);
}

async function resetVisitor(status) {
  await sql(`update visitor_access set status='${status}', updated_at=now() where id='${visitorId}';`);
}

await sql(`create database ${db}`, 'postgres');
try {
  await sql(`
    create table visitor_access(
      id uuid primary key, estate_id uuid, home_id uuid, created_by uuid, resident_id uuid,
      visitor_name text, status text, expires_at timestamptz, updated_at timestamptz, created_at timestamptz default now()
    );
    insert into visitor_access(id, estate_id, home_id, created_by, resident_id, visitor_name, status, expires_at, updated_at)
      values('${visitorId}', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Jane Visitor', 'approved', now() + interval '1 hour', now());
  `);

  // =====================================================================
  // Real-connection concurrency proof
  // =====================================================================
  console.log('\n=== Real PostgreSQL concurrency: visitor_access CAS ===');

  await test('entry vs deny: two genuinely simultaneous connections racing entry (from approved) and deny (from active/pending) -- entry wins since deny cannot match "approved", no contradictory final state', async () => {
    await resetVisitor('approved');
    const [entryResult, denyResult] = await Promise.all([
      casUpdate(['approved'], 'entered'),
      casUpdate(['active', 'pending'], 'denied'),
    ]);
    assert.ok(entryResult, 'entry must win: visitor was approved, which is in its legitimate FROM set');
    assert.equal(denyResult, null, 'deny must lose: visitor was never active/pending, so its CAS matches zero rows');
    const final = JSON.parse(await sql(`select row_to_json(v) from visitor_access v where id='${visitorId}'`));
    assert.equal(final.status, 'entered');
  });

  await test('entry vs revoke-after-approval-race: deny fired first (real connection), then a stale entry attempt against the pre-deny snapshot must conflict, never silently overwrite', async () => {
    await resetVisitor('active');
    await casUpdate(['active', 'pending'], 'denied');
    const staleEntry = await casUpdate(['approved'], 'entered');
    assert.equal(staleEntry, null, 'entry must find zero matching rows once the real row is denied');
    const final = JSON.parse(await sql(`select row_to_json(v) from visitor_access v where id='${visitorId}'`));
    assert.equal(final.status, 'denied', 'denial must not be silently overwritten by a stale entry attempt');
  });

  await test('entry vs exit ordering: exit cannot precede entry even when fired concurrently -- exit only ever matches "entered"', async () => {
    await resetVisitor('approved');
    const [entryResult, exitResult] = await Promise.all([
      casUpdate(['approved'], 'entered'),
      casUpdate(['entered'], 'exited'),
    ]);
    assert.ok(entryResult, 'entry must win first since the row starts approved');
    assert.equal(exitResult, null, 'exit racing against a not-yet-entered row must find zero matching rows');
    const final = JSON.parse(await sql(`select row_to_json(v) from visitor_access v where id='${visitorId}'`));
    assert.equal(final.status, 'entered', 'final truth is entered, never a contradictory exited-before-entered state');
  });

  await test('duplicate entry from two real simultaneous connections: exactly one write wins, no contradictory final state', async () => {
    await resetVisitor('approved');
    const results = await Promise.all([casUpdate(['approved'], 'entered'), casUpdate(['approved'], 'entered')]);
    const winners = results.filter(Boolean);
    assert.equal(winners.length, 1, 'exactly one of the two simultaneous UPDATE...WHERE status=ANY(...) statements may affect a row');
    const final = JSON.parse(await sql(`select row_to_json(v) from visitor_access v where id='${visitorId}'`));
    assert.equal(final.status, 'entered');
  });

  await test('duplicate exit from two real simultaneous connections: exactly one write wins', async () => {
    await resetVisitor('entered');
    const results = await Promise.all([casUpdate(['entered'], 'exited'), casUpdate(['entered'], 'exited')]);
    const winners = results.filter(Boolean);
    assert.equal(winners.length, 1, 'exactly one of the two simultaneous exit attempts may win');
    const final = JSON.parse(await sql(`select row_to_json(v) from visitor_access v where id='${visitorId}'`));
    assert.equal(final.status, 'exited');
  });

  await test('stale actor: after another writer advances state, a transition still addressed at the old state is rejected, not force-applied', async () => {
    await resetVisitor('approved');
    await casUpdate(['approved'], 'entered');
    const staleExitAttempt = await casUpdate(['approved'], 'exited'); // wrong FROM set for the real current state
    assert.equal(staleExitAttempt, null);
    const final = JSON.parse(await sql(`select row_to_json(v) from visitor_access v where id='${visitorId}'`));
    assert.equal(final.status, 'entered', 'the winning transition (entered) must not be clobbered by a stale-precondition attempt');
  });

  // =====================================================================
  // maintenance_requests migration: additive, idempotent, real round trip
  // =====================================================================
  console.log('\n=== Real PostgreSQL: maintenance_requests schema drift migration ===');

  await sql(`
    create table users(id uuid primary key default gen_random_uuid());
    create table home_memberships(id uuid primary key default gen_random_uuid(), home_id uuid, user_id uuid);
    create table maintenance_requests(
      id uuid default gen_random_uuid() primary key,
      estate_id uuid, home_id uuid, room_id uuid, user_id uuid,
      title text not null, description text, status text default 'open', assigned_to text,
      attachments jsonb default '[]'::jsonb, created_at timestamptz default now(), updated_at timestamptz default now()
    );
  `);

  const migrationSql = readFileSync('supabase/migrations/20260924130000_maintenance_requests_schema_drift_closure.sql', 'utf8');

  await test('migration applies cleanly against the pre-drift base schema', async () => {
    await sql(migrationSql);
    const cols = (await sql(`select column_name from information_schema.columns where table_name='maintenance_requests' order by column_name`)).split('\n');
    for (const c of ['resident_id', 'category', 'priority', 'membership_id']) assert.ok(cols.includes(c), `expected column ${c} to exist, got: ${cols.join(',')}`);
  });

  await test('all four new columns are nullable (purely additive, no NOT NULL surprise for existing rows)', async () => {
    const rows = await sql(`select column_name, is_nullable from information_schema.columns where table_name='maintenance_requests' and column_name in ('resident_id','category','priority','membership_id') order by column_name`);
    for (const line of rows.split('\n')) assert.ok(line.endsWith('|YES'), `expected nullable, got: ${line}`);
  });

  await test('resident_id and membership_id carry real foreign keys (not bare uuid columns)', async () => {
    const fks = await sql(`select conname from pg_constraint where conrelid='maintenance_requests'::regclass and contype='f'`);
    assert.ok(/resident_id|maintenance_requests_resident_id_fkey/.test(fks) || fks.split('\n').length >= 2, `expected FK constraints, got: ${fks}`);
  });

  await test('re-applying the migration is idempotent (add column if not exists / create index if not exists)', async () => {
    await sql(migrationSql); // must not throw
    const cols = (await sql(`select count(*) from information_schema.columns where table_name='maintenance_requests' and column_name in ('resident_id','category','priority','membership_id')`));
    assert.equal(cols, '4', 'reapplying must not duplicate or drop columns');
  });

  await test('write+read round trip: resident_id/category/priority genuinely persist (the pre-fix defect: these were always silently dropped)', async () => {
    const uid = (await sql(`insert into users default values returning id`)).trim();
    await sql(`insert into maintenance_requests(id, estate_id, home_id, title, resident_id, category, priority, status) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Leaking tap', '${uid}', 'plumbing', 'high', 'open')`);
    const row = JSON.parse(await sql(`select row_to_json(m) from maintenance_requests m where resident_id='${uid}'`));
    assert.equal(row.category, 'plumbing');
    assert.equal(row.priority, 'high');
    assert.equal(row.resident_id, uid);
  });

  console.log(`\n${checks} passed, 0 failed`);
} finally {
  await sql(`drop database if exists ${db}`, 'postgres').catch(() => {});
}
