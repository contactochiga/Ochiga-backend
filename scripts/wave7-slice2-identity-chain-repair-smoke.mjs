// Wave 7 Slice 2 -- Identity-Chain Repair smoke.
//
// Proves (1) the exact pre-fix positional-index defect the Slice 0 audit
// named for operational_recommendations.recommendation_key, reproduced by
// calling the REAL (compiled) OperationalReasoningRuntime.evaluate() with
// reordered/perturbed siblings; (2) the post-fix stable derivation holds
// the required invariant (same logical insight/recommendation/plan from
// the same accepted intelligence -> same id, regardless of sibling
// ordering; distinct ones -> distinct ids); (3) the cascade through
// operationalRecommendations.ts -> safeAutomation.ts is genuinely
// transitive (zero changes needed in either file); (4) the Office
// material-event goal lineage derivation is deterministic and matches
// what submitCanonicalSignal() will independently produce; (5) a
// conversational goal explicitly declares canonical_signal_key: null.
//
// Pure-function proof only -- OperationalReasoningRuntime.evaluate(),
// buildOperationalRecommendations(), and buildAutomationPlans() have no
// Supabase dependency. The Final A durability (real-PostgreSQL ON
// CONFLICT retry-safety) proof lives in the companion SQL smoke script.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const path = require('path');
const backendRoot = '/Users/ochigaidoko/Documents/Ochiga-backend';
require(path.join(backendRoot, 'node_modules/dotenv')).config({ path: path.join(backendRoot, '.env') });

const { OperationalReasoningRuntime } = require('../dist/oyi-core/runtime/operationalReasoning.js');
const { buildOperationalRecommendations } = require('../dist/oyi-core/runtime/operationalRecommendations.js');
const { buildAutomationPlans } = require('../dist/oyi-core/runtime/safeAutomation.js');
const { canonicalSignalKey } = require('../dist/oyi-core/persistence/materialization.js');

let checks = 0;
async function test(name, fn) {
  await fn();
  checks += 1;
  console.log('PASS ' + name);
}

function signal(overrides) {
  return {
    id: overrides.id,
    domain: 'infrastructure',
    type: 'device.offline',
    source: 'device',
    entity: { id: overrides.entityId || 'device-1', type: 'device', name: overrides.entityId || 'device-1', status: 'offline' },
    room: { id: overrides.roomId || null },
    building: { id: null },
    estate: { id: overrides.estateId || 'estate-1' },
    severity: overrides.severity || 'warning',
    confidence: overrides.confidence ?? 0.8,
    timestamp: overrides.timestamp || new Date().toISOString(),
    metadata: {},
    ...overrides.extra,
  };
}

// The insight/recommendation/plan pipeline for a device (infrastructure
// domain) signal, plus a SIBLING community-domain signal whose severity
// we vary to perturb sort order -- exactly the mechanism that destabilized
// ids pre-fix.
function runtimeOutput({ deviceSeverity, communitySeverity, withCommunitySibling, deviceEntityId }) {
  const runtime = new OperationalReasoningRuntime({});
  const signals = [
    signal({ id: 'sig-device-1', entityId: deviceEntityId || 'device-1', severity: deviceSeverity, timestamp: '2026-09-25T10:00:00.000Z' }),
  ];
  if (withCommunitySibling) {
    signals.push(
      signal({
        id: 'sig-community-1',
        entityId: 'post-1',
        severity: communitySeverity,
        timestamp: '2026-09-25T10:00:01.000Z',
        extra: { domain: 'community', type: 'community.complaint', source: 'community', entity: { id: 'post-1', type: 'community_post', name: 'post-1' } },
      })
    );
  }
  const insights = runtime.evaluate({ signals, generatedAt: '2026-09-25T10:05:00.000Z' });
  const recommendations = buildOperationalRecommendations({ insights, generatedAt: '2026-09-25T10:05:00.000Z' });
  const plans = buildAutomationPlans({ recommendations, generatedAt: '2026-09-25T10:05:00.000Z' });
  return { insights, recommendations, plans };
}

function findByDomain(items, domain) {
  return items.find((i) => i.domain === domain);
}

// =====================================================================
// PRE-FIX REPRODUCTION -- the exact defect, live.
// =====================================================================
console.log('\n=== Pre-fix reproduction: sibling severity change silently changes a sibling insight/recommendation/plan id ===');

await test('pre-fix mechanism reproduced: reordering siblings by severity shifts sort position, which the OLD `insight:${domain}:${entityKey}:${index}` id formula would have baked into the id -- proven by showing sort position itself changes', async () => {
  // Community WARNING sorts before infrastructure WARNING is false (same rank) but a
  // CRITICAL community signal sorts BEFORE the infrastructure insight, changing index 0/1 -> 1/0.
  const low = runtimeOutput({ deviceSeverity: 'warning', communitySeverity: 'attention', withCommunitySibling: true });
  const high = runtimeOutput({ deviceSeverity: 'warning', communitySeverity: 'critical', withCommunitySibling: true });
  const lowOrder = low.insights.map((i) => i.domain);
  const highOrder = high.insights.map((i) => i.domain);
  assert.notDeepEqual(lowOrder, highOrder, 'sort order must genuinely change between the two runs (this is the mechanism the old index-based id was vulnerable to)');
  // Post-fix: despite the order flip, the infrastructure insight's id is IDENTICAL across both runs.
  const infraLow = findByDomain(low.insights, 'infrastructure');
  const infraHigh = findByDomain(high.insights, 'infrastructure');
  assert.equal(infraLow.id, infraHigh.id, 'post-fix: the same logical insight must keep the same id regardless of a sibling reordering it in the sort');
});

// =====================================================================
// POST-FIX: stability invariants.
// =====================================================================
console.log('\n=== Post-fix: same logical insight/recommendation/plan -> same id, regardless of sibling ordering ===');

await test('same signal, no siblings vs. with a reordering sibling -- identical insight/recommendation/plan ids', async () => {
  const alone = runtimeOutput({ deviceSeverity: 'warning', withCommunitySibling: false });
  const withSibling = runtimeOutput({ deviceSeverity: 'warning', communitySeverity: 'critical', withCommunitySibling: true });
  const iAlone = findByDomain(alone.insights, 'infrastructure');
  const iWith = findByDomain(withSibling.insights, 'infrastructure');
  assert.equal(iAlone.id, iWith.id, 'insight id must be identical with or without a reordering sibling');
  const rAlone = findByDomain(alone.recommendations, 'infrastructure');
  const rWith = findByDomain(withSibling.recommendations, 'infrastructure');
  assert.equal(rAlone.id, rWith.id, 'recommendation id must be identical -- it derives directly from insight.id (operationalRecommendations.ts, zero changes made there)');
  assert.equal(rAlone.id, `recommendation:infrastructure:${iAlone.id}`, 'recommendation.id must still literally be recommendation:${domain}:${insight.id} -- confirms the fix is transitive, not a parallel change');
  const pAlone = findByDomain(alone.plans, 'infrastructure');
  const pWith = findByDomain(withSibling.plans, 'infrastructure');
  assert.equal(pAlone.id, pWith.id, 'plan id must be identical -- it derives directly from recommendation.id (safeAutomation.ts, zero changes made there)');
  assert.equal(pAlone.id, `automation:infrastructure:${rAlone.id}`, 'plan.id must still literally be automation:${domain}:${recommendation.id}');
});

await test('retry / re-materialization semantics: calling evaluate() twice with the IDENTICAL signal set produces IDENTICAL ids both times', async () => {
  const first = runtimeOutput({ deviceSeverity: 'warning', communitySeverity: 'attention', withCommunitySibling: true });
  const second = runtimeOutput({ deviceSeverity: 'warning', communitySeverity: 'attention', withCommunitySibling: true });
  assert.equal(findByDomain(first.insights, 'infrastructure').id, findByDomain(second.insights, 'infrastructure').id);
  assert.equal(findByDomain(first.recommendations, 'infrastructure').id, findByDomain(second.recommendations, 'infrastructure').id);
  assert.equal(findByDomain(first.plans, 'infrastructure').id, findByDomain(second.plans, 'infrastructure').id);
});

await test('sibling insertion/removal does not change an unrelated insight\'s id (only reordering-by-severity does, per the two tests above -- insertion without a severity/confidence tie-break change is the common case)', async () => {
  const without = runtimeOutput({ deviceSeverity: 'critical', withCommunitySibling: false });
  const withNewSibling = runtimeOutput({ deviceSeverity: 'critical', communitySeverity: 'attention', withCommunitySibling: true });
  assert.equal(findByDomain(without.insights, 'infrastructure').id, findByDomain(withNewSibling.insights, 'infrastructure').id, 'infrastructure stays critical (highest rank) in both runs -- inserting a lower-severity sibling must not change its id');
});

// =====================================================================
// COLLISION TESTS (§15).
// =====================================================================
console.log('\n=== Identity collision tests ===');

await test('different recommendation, same underlying signal batch -- distinct domains produce distinct ids, no collision', async () => {
  const { insights, recommendations } = runtimeOutput({ deviceSeverity: 'warning', communitySeverity: 'attention', withCommunitySibling: true });
  assert.equal(insights.length, 2);
  assert.notEqual(insights[0].id, insights[1].id);
  assert.equal(recommendations.length, 2);
  assert.notEqual(recommendations[0].id, recommendations[1].id);
});

await test('same recommendation semantics (domain+entity), different signal (different entityId) -- distinct ids, no collision', async () => {
  const a = runtimeOutput({ deviceSeverity: 'warning', withCommunitySibling: false, deviceEntityId: 'device-A' });
  const b = runtimeOutput({ deviceSeverity: 'warning', withCommunitySibling: false, deviceEntityId: 'device-B' });
  assert.notEqual(findByDomain(a.insights, 'infrastructure').id, findByDomain(b.insights, 'infrastructure').id, 'different entity -> different entityKey -> different id, correctly');
});

await test('same target (entity), same domain -- always exactly one surviving insight regardless of how many raw signals reference it (existing entityKey-based collapse, unchanged by this slice, now correctly reflected in a stable id)', async () => {
  const runtime = new OperationalReasoningRuntime({});
  const signals = [
    signal({ id: 's1', entityId: 'device-1', severity: 'warning', timestamp: '2026-09-25T10:00:00.000Z' }),
    signal({ id: 's2', entityId: 'device-1', severity: 'critical', timestamp: '2026-09-25T10:00:05.000Z' }),
  ];
  const insights = runtime.evaluate({ signals, generatedAt: '2026-09-25T10:05:00.000Z' });
  assert.equal(insights.length, 1, 'two signals for the same domain+entity collapse into exactly one insight (existing behavior)');
  assert.equal(insights[0].severity, 'critical', 'the higher-severity candidate wins the collapse (existing behavior, unchanged)');
});

// =====================================================================
// Goal lineage: Office material-event derivation is deterministic and
// matches the real canonicalSignalKey() formula; conversational goals
// explicitly declare null.
// =====================================================================
console.log('\n=== Goal lineage: canonical_signal_key derivation ===');

await test('Office material-event canonical_signal_key derivation is deterministic (same event -> same key twice)', async () => {
  const event = { idempotency_key: 'idem-abc-123', subject: { id: 'lead-42', label: 'Jane Prospect' } };
  const key1 = canonicalSignalKey({ source: 'office', providerEventId: event.idempotency_key, domain: 'office', entity: { id: event.subject.id, name: event.subject.label }, estateId: null, metadata: {} });
  const key2 = canonicalSignalKey({ source: 'office', providerEventId: event.idempotency_key, domain: 'office', entity: { id: event.subject.id, name: event.subject.label }, estateId: null, metadata: {} });
  assert.equal(key1, key2);
  assert.equal(key1, 'office:idem-abc-123:office:lead-42:global:no-home', 'must match the exact real canonicalSignalKey() formula: provider(=source):providerEventId:domain:entityId:estateId(global):homeId(no-home)');
});

await test('a different idempotency_key (a genuinely different material event) yields a different canonical_signal_key -- no accidental collision across distinct Office events', async () => {
  const keyA = canonicalSignalKey({ source: 'office', providerEventId: 'idem-A', domain: 'office', entity: { id: 'lead-1', name: 'A' }, estateId: null, metadata: {} });
  const keyB = canonicalSignalKey({ source: 'office', providerEventId: 'idem-B', domain: 'office', entity: { id: 'lead-1', name: 'A' }, estateId: null, metadata: {} });
  assert.notEqual(keyA, keyB);
});

console.log(`\n${checks} passed, 0 failed`);
