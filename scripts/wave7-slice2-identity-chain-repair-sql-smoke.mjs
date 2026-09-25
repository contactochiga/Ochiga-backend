// Wave 7 Slice 2 -- Identity-Chain Repair: real-PostgreSQL proof.
//
// Two things only the companion Node smoke cannot prove:
//   1. The oyi_goals migration (20260925090000_...) applies cleanly,
//      idempotently, nullable, indexed, against a real table.
//   2. End-to-end through the REAL Final A RPCs (unchanged by this
//      slice -- see wave6-final-a-materialization-sql-smoke.mjs, still
//      passing): a bundle built by the REAL, now-fixed
//      operationalReasoningRuntime -> buildOperationalRecommendations ->
//      buildAutomationPlans pipeline, materialized twice with a
//      perturbed sibling ordering between the two calls (the exact
//      defect scenario), lands in `operational_recommendations` as
//      genuinely ONE row via `on conflict(recommendation_key) do
//      nothing` -- not two -- and that a mutable status change made
//      after the first materialization survives the second
//      (re-materialization) call untouched.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const path = require('path');
const backendRoot = '/Users/ochigaidoko/Documents/Ochiga-backend';
require(path.join(backendRoot, 'node_modules/dotenv')).config({ path: path.join(backendRoot, '.env') });

const container = process.env.OYI_LOCAL_POSTGRES_CONTAINER || 'supabase_db_Ochiga-backend';
const db = 'oyi_wave7_slice2_' + Date.now();

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

let checks = 0;
async function test(name, fn) {
  await fn();
  checks += 1;
  console.log('PASS ' + name);
}

await sql(`create database ${db}`, 'postgres');
try {
  // =====================================================================
  // Part 1: oyi_goals migration -- real table, real migration file.
  // =====================================================================
  console.log('\n=== oyi_goals canonical_signal_key migration ===');

  await sql(readFileSync('supabase/migrations/20260822140000_oyi_goals.sql', 'utf8'));

  await test('migration applies cleanly against the real oyi_goals base schema', async () => {
    await sql(readFileSync('supabase/migrations/20260925090000_wave7_slice2_goal_canonical_signal_lineage.sql', 'utf8'));
    const cols = (await sql(`select column_name from information_schema.columns where table_name='oyi_goals' and column_name='canonical_signal_key'`));
    assert.equal(cols, 'canonical_signal_key');
  });

  await test('column is nullable (backward-compatible -- existing/legacy goal rows remain valid with no lineage)', async () => {
    const nullable = await sql(`select is_nullable from information_schema.columns where table_name='oyi_goals' and column_name='canonical_signal_key'`);
    assert.equal(nullable, 'YES');
  });

  await test('re-applying the migration is idempotent (add column if not exists / create index if not exists)', async () => {
    await sql(readFileSync('supabase/migrations/20260925090000_wave7_slice2_goal_canonical_signal_lineage.sql', 'utf8')); // must not throw
    const count = await sql(`select count(*) from information_schema.columns where table_name='oyi_goals' and column_name='canonical_signal_key'`);
    assert.equal(count, '1', 'reapplying must not duplicate the column');
  });

  await test('a partial index exists on canonical_signal_key for lineage lookups, NOT a unique constraint (a signal may legitimately motivate more than one goal over time)', async () => {
    const idx = await sql(`select indexdef from pg_indexes where tablename='oyi_goals' and indexname='idx_oyi_goals_canonical_signal_key'`);
    assert.ok(idx.includes('canonical_signal_key'));
    assert.ok(!/unique/i.test(idx), 'must not be a unique index');
  });

  await test('no hard FK to operational_signals exists (goal creation and signal materialization are decoupled, unordered write paths)', async () => {
    const fks = await sql(`select count(*) from information_schema.table_constraints where table_name='oyi_goals' and constraint_type='FOREIGN KEY'`);
    assert.equal(fks, '0');
  });

  await test('real write+read round trip: a signal-driven goal persists canonical_signal_key; a conversational goal persists NULL', async () => {
    await sql(`insert into oyi_goals(correlation_id, surface, objective, canonical_signal_key) values('corr-1','office_material_event','test objective','office:idem-1:office:lead-1:global:no-home');`);
    await sql(`insert into oyi_goals(correlation_id, surface, objective, canonical_signal_key) values('corr-2','office_internal','test objective 2', null);`);
    const signalDriven = await sql(`select canonical_signal_key from oyi_goals where correlation_id='corr-1'`);
    const conversational = await sql(`select coalesce(canonical_signal_key,'<NULL>') from oyi_goals where correlation_id='corr-2'`);
    assert.equal(signalDriven, 'office:idem-1:office:lead-1:global:no-home');
    assert.equal(conversational, '<NULL>');
  });

  await test('lineage lookup query ("which goals trace back to this signal") returns the right row via the index-backed column', async () => {
    const rows = await sql(`select correlation_id from oyi_goals where canonical_signal_key='office:idem-1:office:lead-1:global:no-home'`);
    assert.equal(rows, 'corr-1');
  });

  // =====================================================================
  // Part 2: Final A end-to-end through the REAL (now-fixed) reasoning
  // pipeline -- real recommendation_key stability under real ON CONFLICT.
  // =====================================================================
  console.log('\n=== Final A durability with a real, now-stable recommendation_key ===');

  await sql('create table estates(id uuid primary key);create table homes(id uuid primary key);');
  await sql(readFileSync('supabase/migrations/20260728143000_oyi_core_convergence_canonical_storage.sql', 'utf8'));
  await sql(readFileSync('supabase/migrations/20260924112951_wave6_canonical_materialization_durability.sql', 'utf8'));
  await sql(`insert into estates(id) values('11111111-1111-4111-8111-111111111111');`);

  const { OperationalReasoningRuntime } = require('../dist/oyi-core/runtime/operationalReasoning.js');
  const { buildOperationalRecommendations } = require('../dist/oyi-core/runtime/operationalRecommendations.js');
  const { buildAutomationPlans } = require('../dist/oyi-core/runtime/safeAutomation.js');
  const { normalizeSignal } = require('../dist/oyi-core/contracts/operationalSignal.js');
  const { scopeMaterializationIdentities, prepareMaterialization } = require('../dist/oyi-core/persistence/materialization.js');

  function deviceSignal(severity) {
    return {
      id: 'sig-device-1', domain: 'infrastructure', type: 'device.offline', source: 'device',
      entity: { id: 'device-1', type: 'device', name: 'device-1', status: 'offline' },
      room: { id: null }, building: { id: null }, estate: { id: '11111111-1111-4111-8111-111111111111' },
      severity, confidence: 0.8, timestamp: '2026-09-25T10:00:00.000Z', metadata: {},
    };
  }
  function communitySignal(severity) {
    return {
      id: 'sig-community-1', domain: 'community', type: 'community.complaint', source: 'community',
      entity: { id: 'post-1', type: 'community_post', name: 'post-1' },
      room: { id: null }, building: { id: null }, estate: { id: '11111111-1111-4111-8111-111111111111' },
      severity, confidence: 0.8, timestamp: '2026-09-25T10:00:01.000Z', metadata: {},
    };
  }
  function buildBundle(communitySeverity) {
    const runtime = new OperationalReasoningRuntime({});
    const insights = runtime.evaluate({ signals: [deviceSignal('warning'), communitySignal(communitySeverity)], generatedAt: '2026-09-25T10:05:00.000Z' });
    const recommendations = buildOperationalRecommendations({ insights, generatedAt: '2026-09-25T10:05:00.000Z' });
    const plans = buildAutomationPlans({ recommendations, generatedAt: '2026-09-25T10:05:00.000Z' });
    return { awareness: [], insights, recommendations, automationPlans: plans };
  }

  // Two "materializations" of the SAME underlying situation, differing
  // only by a sibling's severity (the exact perturbation that used to
  // change sort position -> index -> id). Both use the same canonical
  // signal key, simulating a retry / re-materialization.
  const primarySignal = normalizeSignal(deviceSignal('warning'));
  const receipt = { signal: primarySignal, receivedAt: '2026-09-25T10:05:00.000Z', outputs: [] };

  const bundle1 = buildBundle('attention');
  const bundle2 = buildBundle('critical'); // flips sibling sort order

  await test('real reasoning pipeline: the two bundles genuinely have different sibling orderings (proves the perturbation is real)', async () => {
    assert.notDeepEqual(bundle1.recommendations.map((r) => r.domain), bundle2.recommendations.map((r) => r.domain));
  });

  await test('real reasoning pipeline (pre-scoping): despite the reordering, the infrastructure recommendation.id is identical across both bundles', async () => {
    assert.equal(bundle1.recommendations.find((r) => r.domain === 'infrastructure').id, bundle2.recommendations.find((r) => r.domain === 'infrastructure').id);
  });

  // scopeMaterializationIdentities is the REAL function service.ts calls
  // (mutates bundle.*.id in place, keyed on canonicalSignalKey(primarySignal)
  // -- the same real function this slice's stability fix flows through
  // unchanged).
  scopeMaterializationIdentities(bundle1, primarySignal);
  scopeMaterializationIdentities(bundle2, primarySignal);

  const infra1 = bundle1.recommendations.find((r) => r.domain === 'infrastructure');
  const infra2 = bundle2.recommendations.find((r) => r.domain === 'infrastructure');

  await test('post-scoping (scopeMaterializationIdentities, the real function): the scoped recommendation id is still identical across both bundles', async () => {
    assert.equal(infra1.id, infra2.id);
  });

  // prepareMaterialization is the REAL function that builds the exact
  // DB row shapes (including the real double-hashed uuid `id` column and
  // the real `recommendation_key` text value) -- nothing hand-rolled.
  const prepared1 = prepareMaterialization(bundle1, receipt);
  const prepared2 = prepareMaterialization(bundle2, receipt);
  const recKey1 = prepared1.rows.recommendations.find((r) => r.recommendation_key === infra1.id).recommendation_key;

  await test('prepareMaterialization (real function): the real recommendation_key written to the DB row is identical across both perturbed-sibling bundles', async () => {
    const recKey2 = prepared2.rows.recommendations.find((r) => r.recommendation_key === infra2.id).recommendation_key;
    assert.equal(recKey1, recKey2);
    assert.equal(recKey1, infra1.id);
  });

  const key = 'device:wave7-slice2-integration:infrastructure:device-1:estate-1:no-home';
  const register = (prepared) =>
    sql(`select oyi_register_materialization(${json({ canonical_signal_key: key, signal_type: 'fixture', domain: 'infrastructure', severity: 'warning', verified: true, privacy_class: 'organization_restricted', occurred_at: '2026-09-25T10:05:00.000Z', payload: {} })},${json(prepared)});`).then(JSON.parse);
  const claimAndComplete = async (signalId) => {
    const [claimed] = JSON.parse(await sql(`select jsonb_agg(t) from oyi_claim_materialization(1,'${signalId}') t`));
    return sql(`select oyi_complete_materialization('${signalId}','${claimed.materialization.claim_token}')`);
  };

  const first = await register(prepared1);
  await claimAndComplete(first.signal_id);

  await test('after first materialization: exactly one operational_recommendations row, with the real (now-stable) recommendation_key', async () => {
    const count = await sql(`select count(*) from operational_recommendations where recommendation_key='${recKey1}'`);
    assert.equal(count, '1');
  });

  await sql(`update operational_recommendations set status='dismissed' where recommendation_key='${recKey1}';`);

  // Retry: same canonical_signal_key (real registerMaterialization dedup
  // via `on conflict(canonical_signal_key) do nothing` returns the SAME
  // signal row as duplicate:true), re-materialized with the SIBLING-
  // PERTURBED bundle's prepared rows (prepared2). Pre-fix, this could
  // have carried a DIFFERENT recommendation_key, producing a SECOND row
  // and silently reopening the recommendation a human already dismissed.
  const retry = await register(prepared2);
  assert.equal(retry.duplicate, true, 'same canonical_signal_key must be recognized as a duplicate signal, not a new one');
  await sql(`update operational_signals set materialization=materialization||'{"state":"pending","due_at":"2000-01-01T00:00:00.000000Z"}'::jsonb where id='${retry.signal_id}';`);
  await claimAndComplete(retry.signal_id);

  await test('after retry with a sibling-perturbed bundle: STILL exactly one operational_recommendations row (on conflict(recommendation_key) do nothing correctly recognized the stable key)', async () => {
    const count = await sql(`select count(*) from operational_recommendations where recommendation_key='${recKey1}'`);
    assert.equal(count, '1', 'the stable recommendation_key must prevent a duplicate row from a retry, even with a differently-ordered sibling');
  });

  await test('the mutable lifecycle state set after the first materialization (dismissed) survives the retry untouched (Final A invariant preserved)', async () => {
    const status = await sql(`select status from operational_recommendations where recommendation_key='${recKey1}'`);
    assert.equal(status, 'dismissed', 'a retry/re-materialization must never reset legitimate later lifecycle state');
  });

  console.log(`\n${checks} passed, 0 failed`);
} finally {
  await sql(`drop database if exists ${db}`, 'postgres').catch(() => {});
}
