import assert from "node:assert/strict";
import path from "node:path";

const root = process.cwd();
const evidence = await import(path.join(root, "dist/oyi-core/evidence/EvidenceEnvelope.js"));
const evidenceContracts = await import(path.join(root, "dist/oyi-core/contracts/evidence.js"));
const intelligence = await import(path.join(root, "dist/oyi-core/contracts/intelligence.js"));
const capability = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityRegistry.js"));

const observed = evidence.evidenceEnvelope({
  domain: "devices",
  type: "runtime_state",
  object_type: "device",
  object_id: "device-1",
  source: "runtime",
  observed_at: "2026-08-13T08:00:00.000Z",
  freshness: "fresh",
  authorised_scope: { estate_id: "estate-1", building_id: "building-1", home_id: "home-1", room_id: "room-1" },
  confidence: 0.91,
  payload: { online: true },
});

assert.equal(observed.object_ref.object_type, "device");
assert.equal(observed.source_type, "device_runtime");
assert.equal(observed.truth_class, "observation");
assert.equal(observed.privacy_class, "household_private");
assert.deepEqual(observed.permissions, []);
assert.equal(evidenceContracts.claimStateForEvidence(observed), "confirmed");

const unavailable = evidence.evidenceEnvelope({
  domain: "maintenance",
  type: "request_feed",
  object_type: "home",
  object_id: "home-1",
  source: "domain_adapter",
  source_type: "database",
  observed_at: null,
  freshness: "unknown",
  truth_class: "unavailable",
  privacy_class: "resident_private",
  authorised_scope: { estate_id: "estate-1", home_id: "home-1", room_id: null },
  confidence: 0,
  payload: { reason: "maintenance source unavailable" },
});

assert.equal(evidenceContracts.claimStateForEvidence(unavailable), "unavailable");
assert.throws(() => evidenceContracts.assertClaimDoesNotPromoteUnavailable({
  claim_id: "claim-1",
  domain: "maintenance",
  statement: "Everything is normal.",
  state: "confirmed",
  evidence_ids: [unavailable.evidence_id],
  fact_ids: [],
  inference_ids: [],
  confidence: 0.9,
  privacy_class: "resident_private",
  generated_at: new Date().toISOString(),
  limitations: [],
}, [unavailable]), /cannot promote/);

const ranked = intelligence.rankHomeContributions([
  intelligence.unavailableContribution("maintenance", "Maintenance information is currently unavailable."),
  {
    domain: "security",
    status: "available",
    priority: "critical",
    summary: "Gate alert needs review.",
    evidence_ids: ["evidence-security-1"],
    freshness: "fresh",
    confidence: 0.8,
    recommended_actions: [],
    destination: "security.module",
    availability: { available: true, reason: null },
  },
]);
assert.equal(ranked[0].domain, "security");
assert.equal(ranked[1].status, "unavailable");
assert.ok(intelligence.REQUIRED_INTELLIGENCE_TRACE_EVENTS.includes("capability_selected"));
assert.ok(intelligence.REQUIRED_INTELLIGENCE_TRACE_EVENTS.includes("turn_persisted"));

assert.throws(() => capability.capabilityRegistry.register({
  key: "devices.dangerous_without_verify",
  domain: "devices",
  rolloutStatus: "enabled",
  risk_class: "consequential_action",
  supports: () => true,
  resolve: async () => ({ supported: true, reason: null }),
  collectEvidence: async () => [observed],
  execute: async () => ({ status: "sent", execution_id: "exec-1" }),
}), /no verification adapter/);

console.log("oyi intelligence permanent-site foundation smoke passed");
