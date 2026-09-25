// Wave 7 Slice 1 -- Recommendation-read unification smoke.
//
// Proves the exact duplication the Slice 0 audit named (duplicate-authority
// finding A): for the SAME scope, the canonical `operational_recommendations`
// read path (canonicalAwarenessReadService.listRecommendations, frozen Wave
// 6 truth) and the ephemeral recomputation path (recommendationPlanner.ts,
// fed here via a mocked legacy-adapter recommendation) can diverge -- and
// that runIntelligenceOrchestrator now deterministically prefers canonical
// whenever a real actor is present and the call is not the proactive-
// delivery path, falling back to ephemeral (unchanged behavior) exactly
// when canonical cannot answer or no actor is available, with every
// outcome explicitly disclosed via recommendation_source /
// recommendation_fallback_reason -- never silently blended.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const path = require('path');
const backendRoot = '/Users/ochigaidoko/Documents/Ochiga-backend';
require(path.join(backendRoot, 'node_modules/dotenv')).config({ path: path.join(backendRoot, '.env') });

const supabaseClientModule = require('../dist/supabase/supabaseClient.js');
const legacyAdapterModule = require('../dist/oyi-core/domains/intelligence/legacyPredictionAdapter.js');
const { runIntelligenceOrchestrator } = require('../dist/oyi-core/domains/intelligence/intelligenceOrchestrator.js');

const ESTATE_ID = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const HOME_ID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';

const CANONICAL_ROW = {
  id: 'canonical-rec-1',
  incident_id: null,
  recommendation_key: 'recommendation:infrastructure:insight:infrastructure:device:abc:0',
  action_type: 'verify_power',
  title: 'CANONICAL: Verify power to Riser B1',
  summary: 'Canonical truth: power anomaly on Riser B1.',
  reason: 'Canonical reason: sustained voltage drop observed.',
  expected_impact: null,
  confidence: 0.9,
  urgency: 'act',
  risk_class: null,
  verification_required: true,
  approval_required: false,
  status: 'pending',
  estate_id: ESTATE_ID,
  home_id: null,
  privacy_class: null,
  generated_at: new Date().toISOString(),
  expires_at: null,
};

// A row that must NOT surface -- proves live/terminal-status filtering.
const RESOLVED_ROW = { ...CANONICAL_ROW, id: 'canonical-rec-resolved', recommendation_key: 'recommendation:security:insight:security:x:1', status: 'resolved' };

function chainable(resolvedValue) {
  const handler = {
    select: () => chainable(resolvedValue),
    eq: () => chainable(resolvedValue),
    in: () => chainable(resolvedValue),
    order: () => chainable(resolvedValue),
    limit: () => chainable(resolvedValue),
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (resolve, reject) => Promise.resolve(resolvedValue).then(resolve, reject),
  };
  return handler;
}

let canonicalReadMode = 'ok'; // 'ok' | 'fail' | 'empty'
function mockSupabaseAdmin() {
  return {
    from(table) {
      if (table === 'operational_recommendations') {
        if (canonicalReadMode === 'fail') return chainable(Promise.resolve({ data: null, error: new Error('simulated canonical read failure') }));
        if (canonicalReadMode === 'empty') return chainable(Promise.resolve({ data: [], error: null }));
        return chainable(Promise.resolve({ data: [CANONICAL_ROW, RESOLVED_ROW], error: null }));
      }
      // Every other table (homes, devices, intelligence_predictions, etc.)
      // -- generic empty-safe response so the ephemeral detector/provider
      // pipeline degrades gracefully to empty rather than throwing.
      return chainable(Promise.resolve({ data: [], error: null }));
    },
  };
}
supabaseClientModule.supabaseAdmin = mockSupabaseAdmin();

const EPHEMERAL_RECOMMENDATION = {
  recommendation_id: 'ephemeral-rec-1',
  domain: 'devices',
  scope: { estate_id: ESTATE_ID, home_id: HOME_ID, room_id: null },
  object_refs: [],
  created_at: new Date().toISOString(),
  severity: 'warning',
  title: 'EPHEMERAL: Review device cluster',
  summary: 'Ephemeral recomputation: divergent view of the same underlying issue.',
  reason: 'Ephemeral reason.',
  evidence_ids: [],
  suggested_action: 'Check device cluster.',
  actionability: 'review',
  requires_confirmation: false,
  capability_key: null,
  expires_at: null,
  status: 'open',
  dedup_key: 'ephemeral:devices:cluster',
};
legacyAdapterModule.runLegacyPredictionAdapter = async () => ({
  anomalies: [],
  predictions: [],
  recommendations: [EPHEMERAL_RECOMMENDATION],
  warnings: [],
});

function baseInput(overrides = {}) {
  return {
    input: { message: '', surface: 'consumer', estate_id: ESTATE_ID, home_id: HOME_ID },
    oisContext: { estate_id: ESTATE_ID, home_id: HOME_ID },
    contract: {
      conversation_request_id: 'smoke',
      thread_id: null,
      surface: 'consumer',
      operation_class: 'read',
      intent: 'evidence',
      scope_mode: 'home_scope',
      temporal_scope: { mode: 'current', from: null, to: null },
      target: { object_type: null, canonical_id: null, parent_id: null, channel_code: null, label: null },
      mutation: { requested: false, confirmed: false, command: null, desired_state: null, risk_class: 'read' },
      evidence_requirements: { current_state: true, recent_events: true, execution_history: true, audit_history: false, relationships: false, permissions: true, provider_state: false, financial_ledger: false, access_records: false },
      answer_builder: null,
      report_builder: null,
      truth_policy: 'read_only_no_execution',
      confidence: 0.8,
    },
    scope: { estate_id: ESTATE_ID, home_id: null, room_id: null }, // home_id:null dodges the forecast provider entirely
    persist: false,
    ...overrides,
  };
}

const ACTOR = { id: 'actor-1', role: 'estate_admin', estate_id: ESTATE_ID, home_id: null };

let checks = 0;
async function test(name, fn) {
  await fn();
  checks += 1;
  console.log('PASS ' + name);
}

// =====================================================================
// PRE-FIX REPRODUCTION -- prove the live divergence the audit named.
// Simulating "pre-fix" by calling with no actor (the code path every
// caller used before this slice, since IntelligenceOrchestratorInput.actor
// was `unknown` and never consulted for recommendation selection).
// =====================================================================
console.log('\n=== Pre-fix reproduction: divergence between canonical and ephemeral for the same scope ===');

await test('pre-fix (no actor): caller receives the EPHEMERAL recommendation, not canonical -- the exact duplication named by the audit', async () => {
  canonicalReadMode = 'ok';
  const result = await runIntelligenceOrchestrator(baseInput({ actor: null }));
  assert.equal(result.recommendation_source, 'ephemeral');
  assert.equal(result.recommendation_fallback_reason, 'no_actor_context');
  const ids = result.recommendations.map((r) => r.recommendation_id);
  assert.ok(ids.includes('ephemeral-rec-1'), 'expected the ephemeral recommendation to be present');
  assert.ok(!ids.includes('canonical-rec-1'), 'canonical recommendation must not appear on the no-actor path');
});

// =====================================================================
// POST-FIX: canonical preference, real actor present.
// =====================================================================
console.log('\n=== Post-fix: canonical preferred over ephemeral when a real actor is present ===');

await test('actor present, not proactive, canonical.ok -- returns CANONICAL, not ephemeral (the fix)', async () => {
  canonicalReadMode = 'ok';
  const result = await runIntelligenceOrchestrator(baseInput({ actor: ACTOR, proactive: false }));
  assert.equal(result.recommendation_source, 'canonical');
  assert.equal(result.recommendation_fallback_reason, null);
  const ids = result.recommendations.map((r) => r.recommendation_id);
  assert.ok(ids.includes('canonical-rec-1'), 'expected the canonical recommendation to be present');
  assert.ok(!ids.includes('ephemeral-rec-1'), 'ephemeral recommendation must not appear when canonical answered');
});

await test('resolved-status canonical rows are excluded (only pending/monitoring are live)', async () => {
  canonicalReadMode = 'ok';
  const result = await runIntelligenceOrchestrator(baseInput({ actor: ACTOR, proactive: false }));
  const ids = result.recommendations.map((r) => r.recommendation_id);
  assert.ok(!ids.includes('canonical-rec-resolved'), 'a resolved canonical row must not be surfaced as a live recommendation');
});

await test('canonical mapping preserves real domain (parsed from recommendation_key), severity (urgency-mapped), and the real dedup_key', async () => {
  canonicalReadMode = 'ok';
  const result = await runIntelligenceOrchestrator(baseInput({ actor: ACTOR, proactive: false }));
  const rec = result.recommendations.find((r) => r.recommendation_id === 'canonical-rec-1');
  assert.ok(rec, 'canonical recommendation must be present');
  assert.equal(rec.domain, 'devices', 'infrastructure domain must map to devices (presentation-only translation)');
  assert.equal(rec.severity, 'warning', 'urgency "act" must map to severity "warning"');
  assert.equal(rec.dedup_key, CANONICAL_ROW.recommendation_key, 'dedup_key must be the real canonical recommendation_key');
  assert.equal(rec.capability_key, null, 'capability_key must stay null -- Slice 1 never widens executability');
  assert.equal(rec.actionability, 'informational', 'approval_required:false must map to informational, not actionable');
});

// =====================================================================
// POST-FIX: honest fallback when canonical cannot answer.
// =====================================================================
console.log('\n=== Post-fix: disclosed fallback to ephemeral when canonical read fails ===');

await test('actor present, canonical read fails (ok:false) -- falls back to ephemeral, discloses canonical_coverage_gap', async () => {
  canonicalReadMode = 'fail';
  const result = await runIntelligenceOrchestrator(baseInput({ actor: ACTOR, proactive: false }));
  assert.equal(result.recommendation_source, 'ephemeral');
  assert.equal(result.recommendation_fallback_reason, 'canonical_coverage_gap');
  const ids = result.recommendations.map((r) => r.recommendation_id);
  assert.ok(ids.includes('ephemeral-rec-1'));
  canonicalReadMode = 'ok';
});

await test('actor present, canonical returns a truthful EMPTY result (ok:true, zero rows) -- still preferred, per Wave 6 precedent; no fallback', async () => {
  canonicalReadMode = 'empty';
  const result = await runIntelligenceOrchestrator(baseInput({ actor: ACTOR, proactive: false }));
  assert.equal(result.recommendation_source, 'canonical');
  assert.equal(result.recommendation_fallback_reason, null);
  assert.deepEqual(result.recommendations, [], 'a truthful empty canonical answer must not fall back to ephemeral');
  canonicalReadMode = 'ok';
});

// =====================================================================
// POST-FIX: proactive-delivery path unchanged (no notification-authority widening).
// =====================================================================
console.log('\n=== Post-fix: proactive-delivery path is structurally excluded (Frozen systems affected: None) ===');

await test('proactive scheduler shape (actor:null, proactive:true) -- ephemeral only, matches pre-slice behavior exactly', async () => {
  canonicalReadMode = 'ok';
  const result = await runIntelligenceOrchestrator(baseInput({ actor: null, proactive: true, persist: false }));
  assert.equal(result.recommendation_source, 'ephemeral');
  assert.equal(result.recommendation_fallback_reason, 'no_actor_context');
  const ids = result.recommendations.map((r) => r.recommendation_id);
  assert.ok(ids.includes('ephemeral-rec-1'));
});

await test('actor present but proactive:true -- still ephemeral, discloses proactive_delivery_path (never widens notification authority)', async () => {
  canonicalReadMode = 'ok';
  const result = await runIntelligenceOrchestrator(baseInput({ actor: ACTOR, proactive: true, persist: false }));
  assert.equal(result.recommendation_source, 'ephemeral');
  assert.equal(result.recommendation_fallback_reason, 'proactive_delivery_path');
});

// =====================================================================
// Room/Home contributor shape (actor omitted entirely -- undefined, not null).
// =====================================================================
console.log('\n=== Post-fix: contributor-context shape (actor undefined) behaves identically to actor:null ===');

await test('actor omitted (undefined, matching roomContributors.ts/homeContributors.ts call shape) -- ephemeral, no_actor_context', async () => {
  canonicalReadMode = 'ok';
  const input = baseInput({ proactive: false });
  delete input.actor;
  const result = await runIntelligenceOrchestrator(input);
  assert.equal(result.recommendation_source, 'ephemeral');
  assert.equal(result.recommendation_fallback_reason, 'no_actor_context');
});

console.log(`\n${checks} passed, 0 failed`);
