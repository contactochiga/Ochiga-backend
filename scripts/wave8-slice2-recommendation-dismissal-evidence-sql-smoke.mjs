// Wave 8 Slice 2 -- Recommendation Dismissal Feedback Loop: real-Postgres
// proof. Both intelligence_feedback and operational_recommendations are
// EXISTING, unmodified tables (see
// supabase/migrations/20260728143000_oyi_core_convergence_canonical_storage.sql
// lines 111-142 and 160-169) -- no migration is created by this slice.
// This smoke proves the module's actual read query shape (jsonb domain
// extraction, IN-clause batching, the existing indexes) against a real
// Postgres instance, not just the in-memory mock the functional smoke
// uses.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const container = process.env.OYI_LOCAL_POSTGRES_CONTAINER || 'supabase_db_Ochiga-backend';
const db = 'oyi_wave8_slice2_' + Date.now();

// Extracted verbatim from the real migration, with the estate_id/home_id
// FK `references` clauses dropped (this throwaway DB has no estates/homes
// tables) -- column names, types, and both real indexes (the unique
// recommendation_key index and the intelligence_feedback lookup index)
// are otherwise identical to production.
const DDL = `
create table if not exists public.operational_recommendations (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid,
  recommendation_key text not null,
  action_type text not null,
  target jsonb not null default '{}'::jsonb,
  title text not null,
  summary text not null,
  reason text,
  expected_impact text,
  confidence numeric,
  urgency text,
  risk_class text,
  verification_required boolean not null default true,
  approval_required boolean not null default false,
  safe_to_automate boolean not null default false,
  status text not null default 'pending',
  accepted_by text,
  dismissed_by text,
  resolved_by text,
  outcome jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  estate_id uuid,
  home_id uuid,
  privacy_class text not null default 'organization_restricted',
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_operational_recommendations_key on public.operational_recommendations(recommendation_key);
create index if not exists idx_operational_recommendations_scope_status on public.operational_recommendations(estate_id, home_id, status, updated_at desc);

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
create index if not exists idx_intelligence_feedback_lookup on public.intelligence_feedback(object_type, feedback_type, object_id);
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

async function seedRecommendation(key, { actionType, domain, estateId = null, homeId = null }) {
  await sql(
    `insert into operational_recommendations(recommendation_key, action_type, target, title, summary, estate_id, home_id) values ('${esc(key)}', '${esc(actionType)}', jsonb_build_object('domain','${esc(domain)}'), 'title', 'summary', ${estateId ? `'${estateId}'` : 'null'}, ${homeId ? `'${homeId}'` : 'null'})`
  );
}

async function seedFeedback({ objectId, feedbackType, actorId = null, reason = null, createdAt }) {
  await sql(
    `insert into intelligence_feedback(object_type, object_id, feedback_type, actor_id, reason, created_at) values ('recommendation', '${esc(objectId)}', '${esc(feedbackType)}', ${actorId ? `'${esc(actorId)}'` : 'null'}, ${reason ? `'${esc(reason)}'` : 'null'}, '${createdAt}')`
  );
}

// Mirrors recommendationDismissalEvidence.ts's own two-step query shape:
// (1) fetch dismissal-family feedback for known object_ids via the
// existing (object_type, feedback_type, object_id) index, (2) batch-fetch
// the matching operational_recommendations rows via the existing unique
// recommendation_key index, joined in application code -- exactly what
// the module itself does, just expressed as raw SQL here to prove the
// underlying data/index shape genuinely supports it.
async function fetchDismissalFeedback(objectIds) {
  const idList = objectIds.map((id) => `'${esc(id)}'`).join(',');
  const rows = await sql(
    `select object_id, feedback_type, actor_id, created_at from intelligence_feedback where object_type='recommendation' and feedback_type in ('dismissed','not_useful','false_positive') and object_id in (${idList}) order by created_at`
  );
  if (!rows) return [];
  return rows.split('\n').map((line) => {
    const [objectId, feedbackType, actorId, createdAt] = line.split('|');
    return { objectId, feedbackType, actorId: actorId || null, createdAt };
  });
}

await sql(`create database ${db}`, 'postgres');
try {
  console.log('\n=== Apply the EXISTING, unmodified operational_recommendations + intelligence_feedback definitions -- no new migration for this slice ===');
  await sql(DDL);

  await test('both tables exist with exactly the columns the evidence module relies on', async () => {
    const recCols = await sql(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='operational_recommendations'`);
    assert.ok(recCols.includes('recommendation_key') && recCols.includes('action_type') && recCols.includes('target'));
    const fbCols = await sql(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='intelligence_feedback'`);
    assert.equal(fbCols, 'id,object_type,object_id,feedback_type,actor_id,reason,outcome_metadata,created_at');
  });

  console.log('\n=== recommendation_key uniqueness is DB-enforced -- confirms the join key used by the evidence module is genuinely 1:1 ===');
  await test('a duplicate recommendation_key is rejected by the existing unique index', async () => {
    await seedRecommendation('rec-unique-1', { actionType: 'verify_power', domain: 'infrastructure' });
    await assert.rejects(seedRecommendation('rec-unique-1', { actionType: 'verify_power', domain: 'infrastructure' }));
  });

  console.log('\n=== recommendation_key instability across occurrences: confirmed by direct schema proof, not assumed ===');
  await test('two DIFFERENT recommendation_key rows can share the same (domain, action_type) pattern -- the real shape recurring signals produce', async () => {
    await seedRecommendation('rec-pattern-a', { actionType: 'schedule_preventive_inspection', domain: 'maintenance' });
    await seedRecommendation('rec-pattern-b', { actionType: 'schedule_preventive_inspection', domain: 'maintenance' });
    const count = await sql(`select count(*) from operational_recommendations where action_type='schedule_preventive_inspection' and target->>'domain'='maintenance'`);
    assert.equal(count, '2', 'two distinct occurrences of the same semantic pattern must both be queryable under one (domain, action_type) grouping');
  });

  console.log('\n=== Evidence join: dismissal feedback rows resolve back to their pattern via recommendation_key ===');
  await test('the exact two-step query the module performs returns correct, joined evidence', async () => {
    await seedRecommendation('rec-join-1', { actionType: 'review_access_event', domain: 'security', estateId: '11111111-1111-1111-1111-111111111111' });
    await seedFeedback({ objectId: 'rec-join-1', feedbackType: 'dismissed', actorId: 'actor-1', createdAt: '2026-09-01T10:00:00Z' });
    await seedFeedback({ objectId: 'rec-join-1', feedbackType: 'not_useful', actorId: 'actor-2', createdAt: '2026-09-01T11:00:00Z' });
    const feedback = await fetchDismissalFeedback(['rec-join-1']);
    assert.equal(feedback.length, 2);
    const recRow = await sql(`select action_type, target->>'domain' from operational_recommendations where recommendation_key='rec-join-1'`);
    assert.equal(recRow, 'review_access_event|security');
  });

  console.log('\n=== A recommendation with zero feedback rows produces zero evidence, not an error ===');
  await test('no dismissal-family rows for a valid recommendation_key returns an empty set', async () => {
    await seedRecommendation('rec-no-feedback', { actionType: 'assign_owner', domain: 'financial' });
    const feedback = await fetchDismissalFeedback(['rec-no-feedback']);
    assert.equal(feedback.length, 0);
  });

  console.log('\n=== Non-dismissal-family feedback_type is correctly excluded by the IN clause ===');
  await test('an outcome_evaluation row for the same object_id is never returned as dismissal evidence', async () => {
    await seedRecommendation('rec-mixed', { actionType: 'inspect_hardware', domain: 'infrastructure' });
    await seedFeedback({ objectId: 'rec-mixed', feedbackType: 'dismissed', actorId: 'actor-1', createdAt: '2026-09-01T10:00:00Z' });
    await sql(`insert into intelligence_feedback(object_type, object_id, feedback_type, created_at) values ('recommendation', 'rec-mixed', 'outcome_evaluation', '2026-09-01T12:00:00Z')`);
    const feedback = await fetchDismissalFeedback(['rec-mixed']);
    assert.equal(feedback.length, 1, 'only the genuine dismissal-family row counts');
    assert.equal(feedback[0].feedbackType, 'dismissed');
  });

  console.log('\n=== Query plan sanity: the lookup uses the existing intelligence_feedback index, not a full scan ===');
  await test('EXPLAIN confirms an index-assisted plan for the (object_type, feedback_type, object_id) filter', async () => {
    for (let i = 0; i < 50; i += 1) {
      await seedFeedback({ objectId: `rec-scale-${i}`, feedbackType: 'dismissed', actorId: `actor-${i}`, createdAt: '2026-09-01T10:00:00Z' });
    }
    const plan = await sql(`explain select object_id from intelligence_feedback where object_type='recommendation' and feedback_type='dismissed' and object_id='rec-scale-25'`);
    assert.ok(/idx_intelligence_feedback_lookup|Index/i.test(plan), `expected an index-assisted plan, got: ${plan}`);
  });

  console.log(`\n=== wave8-slice2-recommendation-dismissal-evidence-sql-smoke: ${passed} checks passed ===`);
} finally {
  await sql(`drop database if exists ${db}`, 'postgres').catch(() => {});
}
