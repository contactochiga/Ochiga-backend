import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const maintenanceEvidenceSource = read("src/oyi-core/domains/maintenance/maintenanceEvidence.ts");
const visitorEvidenceSource = read("src/oyi-core/domains/visitors/visitorEvidence.ts");
const readCapabilityModulesSource = read("src/oyi-core/capabilities/ReadCapabilityModules.ts");
const capabilityRolloutSource = read("src/oyi-core/capabilities/CapabilityRollout.ts");
const orchestratorSource = read("src/oyi-core/orchestration/ConversationOrchestrator.ts");
const evidenceContractSource = read("src/oyi-core/contracts/evidence.ts");

const { buildPhaseBReadCapabilities } = await import(path.join(root, "dist/oyi-core/capabilities/ReadCapabilityModules.js"));
const { assertEnabledCapabilityHasAdapter } = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityRollout.js"));
const testSupport = await import(path.join(root, "dist/oyi-core/testing/canonicalConversationTestSupport.js"));

check("maintenance direct evidence loader queries the database directly, not client-supplied relationships", () => {
  assert.match(maintenanceEvidenceSource, /export async function loadMaintenanceRequestFacts/);
  assert.match(maintenanceEvidenceSource, /supabaseAdmin\s*\n?\s*\.from\("maintenance_requests"\)/);
  assert.match(maintenanceEvidenceSource, /truth_state:\s*"unavailable"/);
  assert.match(maintenanceEvidenceSource, /source_type:\s*"database"/);
  // Legacy context-derived helpers are retained (still used by presentation
  // code and covered by maintenance-domain-extraction-smoke.mjs) but are no
  // longer the evidence source for the maintenance.requests.read capability.
  assert.match(maintenanceEvidenceSource, /maintenanceRecordsFromContext/);
});

check("visitor direct evidence loader queries the database directly and redacts access codes", () => {
  assert.match(visitorEvidenceSource, /export async function loadVisitorAccessFacts/);
  assert.match(visitorEvidenceSource, /supabaseAdmin\s*\n?\s*\.from\("visitor_access"\)/);
  assert.match(visitorEvidenceSource, /truth_state:\s*"unavailable"/);
  assert.match(visitorEvidenceSource, /redactAccessCredentialForConversation\(row\.access_code\)/);
  assert.doesNotMatch(visitorEvidenceSource, /value:\s*\{[^}]*access_code:\s*row\.access_code[^}]*\}/);
});

check("maintenance.requests.read and visitors.pending.read are enabled with a real evidence collector", () => {
  const modules = buildPhaseBReadCapabilities();
  const maintenance = modules.find((module) => module.key === "maintenance.requests.read");
  const visitors = modules.find((module) => module.key === "visitors.pending.read");
  assert.ok(maintenance, "maintenance.requests.read must be registered");
  assert.ok(visitors, "visitors.pending.read must be registered");
  assert.equal(maintenance.rolloutStatus, "enabled");
  assert.equal(visitors.rolloutStatus, "enabled");
  assert.equal(Boolean(maintenance.collectEvidence.__isDeclaredStub), false, "maintenance collector must not be the declared-module stub");
  assert.equal(Boolean(visitors.collectEvidence.__isDeclaredStub), false, "visitors collector must not be the declared-module stub");
  assert.ok(maintenance.evidence_requirements.length > 0);
  assert.ok(visitors.evidence_requirements.length > 0);
  // Registration itself calling assertEnabledCapabilityHasAdapter and not
  // throwing is the real end-to-end proof these two are wired correctly.
  assertEnabledCapabilityHasAdapter(maintenance);
  assertEnabledCapabilityHasAdapter(visitors);
});

check("still-declared domains keep the stub sentinel (regression guard for the new assertion itself)", () => {
  const modules = buildPhaseBReadCapabilities();
  const security = modules.find((module) => module.key === "security.incidents.read");
  assert.ok(security, "security.incidents.read must still be registered");
  assert.notEqual(security.rolloutStatus, "enabled");
  assert.equal(Boolean(security.collectEvidence.__isDeclaredStub), true, "still-declared domains must keep the stub collector");
});

check("assertEnabledCapabilityHasAdapter rejects an enabled capability that still uses the declared-module stub", () => {
  const stubCollect = async () => [];
  stubCollect.__isDeclaredStub = true;
  const fakeModule = {
    key: "fake.domain.read",
    domain: "global",
    rolloutStatus: "enabled",
    risk_class: "read",
    collectEvidence: stubCollect,
    buildReadResponse: async () => ({ status: "empty", answer: "" }),
  };
  assert.throws(() => assertEnabledCapabilityHasAdapter(fakeModule), /declared-module stub evidence collector/);
});

check("CapabilityRollout wires the stub-sentinel guard and ReadCapabilityModules tags the stub", () => {
  assert.match(capabilityRolloutSource, /__isDeclaredStub/);
  assert.match(capabilityRolloutSource, /still uses the declared-module stub evidence collector/);
  assert.match(readCapabilityModulesSource, /declaredModuleStubCollect as any\)\.__isDeclaredStub\s*=\s*true/);
});

check("assertClaimDoesNotPromoteUnavailable is now actually called (was dead code)", () => {
  assert.match(orchestratorSource, /assertClaimDoesNotPromoteUnavailable/);
  assert.match(orchestratorSource, /enforceReadResultRespectsEvidence/);
  // The evidence.ts assertion itself is unchanged — this test proves a real
  // call site exists, not that the invariant's logic changed.
  assert.match(evidenceContractSource, /export function assertClaimDoesNotPromoteUnavailable/);
});

check("maintenance/visitor answer builders summarize without inventing counts", () => {
  const maintenanceFacts = [
    { fact_id: "m1", domain: "maintenance", fact_type: "maintenance_request", value: { title: "Leaking tap", status: "open", priority: "high", assigned_to: null }, occurred_at: "2026-08-01T00:00:00.000Z", freshness: "2026-08-01T00:00:00.000Z", truth_state: "confirmed", confidence: 0.9, observed_at: "2026-08-01T00:00:00.000Z", scope: {}, object: { object_type: "maintenance_request", canonical_id: "m1", label: "Leaking tap" }, statement: "", previous_value: null, source_type: "database", source_id: "m1", privacy_class: "resident_home_private", permissions: ["maintenance.read"], evidence: [] },
  ];
  const maintenanceAnswer = testSupport.canonicalMaintenanceRequestsAnswerForTest({ facts: maintenanceFacts });
  assert.match(maintenanceAnswer, /1 maintenance request/);
  assert.match(maintenanceAnswer, /1 still unresolved/);

  const emptyAnswer = testSupport.canonicalMaintenanceRequestsAnswerForTest({ facts: [] });
  assert.match(emptyAnswer, /do not see any maintenance requests/);

  const visitorFacts = [
    { fact_id: "v1", domain: "visitors", fact_type: "visitor_access", value: { visitor_name: "Jane Doe", status: "pending", purpose: "Delivery", access_code: "[redacted access credential]" }, occurred_at: "2026-08-01T00:00:00.000Z", freshness: "2026-08-01T00:00:00.000Z", truth_state: "confirmed", confidence: 0.9, observed_at: "2026-08-01T00:00:00.000Z", scope: {}, object: { object_type: "visitor_access", canonical_id: "v1", label: "Jane Doe" }, statement: "", previous_value: null, source_type: "database", source_id: "v1", privacy_class: "security_sensitive", permissions: ["visitors.read"], evidence: [] },
  ];
  const visitorAnswer = testSupport.canonicalVisitorAccessAnswerForTest({ facts: visitorFacts });
  assert.match(visitorAnswer, /1 visitor access record/);
  assert.match(visitorAnswer, /1 pending/);
  assert.doesNotMatch(visitorAnswer, /\d{4,}/, "answer text must never contain a raw access code");
});

console.log("oyi-direct-evidence-maintenance-visitors-smoke passed");
