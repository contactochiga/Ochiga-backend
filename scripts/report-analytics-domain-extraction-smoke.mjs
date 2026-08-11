import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const runtimeSource = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const reportAnswers = read("src/oyi-core/domains/reports/reportConversationAnswers.ts");
const reportEvidence = read("src/oyi-core/domains/reports/reportEvidence.ts");
const presentation = read("src/oyi-core/presentation/conversationAnswerPresentation.ts");
const utilityEvidence = read("src/oyi-core/domains/utilities/utilityEvidence.ts");
const maintenanceEvidence = read("src/oyi-core/domains/maintenance/maintenanceEvidence.ts");
const securityEvidence = read("src/oyi-core/domains/security/securityEvidence.ts");
const capabilityRegistry = read("src/oyi-core/runtime/domainCapabilityRegistry.ts");
const targetCandidates = read("src/oyi-core/context/conversationTargetCandidates.ts");
const targetResolver = read("src/oyi-core/runtime/conversationTargetResolver.ts");
const objectHydration = read("src/oyi-core/context/conversationObjectHydration.ts");
const runtime = await import(path.join(root, "dist/oyi-core/testing/canonicalConversationTestSupport.js"));

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const staleDevice = {
  object_type: "device",
  canonical_id: "device-living-room-tv",
  label: "Living Room TV",
  estate_id: "estate-1",
  building_id: "building-1",
  home_id: "home-1",
  room_id: "living-room",
  source_module: "devices",
  capabilities: ["power"],
  current_state: "unknown",
  health: "stale",
  permissions: ["devices.read"],
  relationships: {},
  evidence_references: [],
  metadata: {},
  freshness: "stale",
};

const meterObject = {
  object_type: "meter",
  canonical_id: "meter-electricity-1",
  label: "Electricity Meter",
  estate_id: "estate-1",
  building_id: "building-1",
  home_id: "home-1",
  room_id: null,
  source_module: "utilities",
  capabilities: ["utilities.read"],
  current_state: "active",
  health: "healthy",
  permissions: ["utilities.read"],
  relationships: {},
  evidence_references: [],
  metadata: { utility_type: "electricity" },
  freshness: "fresh",
};

const reportFacts = [
  {
    fact_id: "fact-power-1",
    fact_type: "utility_usage",
    statement: "Electricity usage was recorded for the current period.",
    value: { domain: "utilities", amount: 12000, status: "recorded" },
    object: { object_type: "meter", canonical_id: "meter-electricity-1", label: "Electricity Meter" },
    scope: { estate_id: "estate-1", building_id: "building-1", home_id: "home-1", room_id: null },
    occurred_at: "2026-08-11T08:00:00.000Z",
    observed_at: "2026-08-11T08:00:00.000Z",
    source_type: "calculation",
    source_id: "calc-1",
    truth_state: "confirmed",
    confidence: 0.91,
    freshness: "fresh",
    privacy_class: "resident_home_private",
    permissions: ["utilities.read"],
    evidence: [],
  },
  {
    fact_id: "fact-maint-1",
    fact_type: "maintenance_status",
    statement: "AC repair is unresolved.",
    value: { domain: "maintenance", status: "warning" },
    object: { object_type: "maintenance_request", canonical_id: "request-ac", label: "AC repair" },
    scope: { estate_id: "estate-1", building_id: "building-1", home_id: "home-1", room_id: "living-room" },
    occurred_at: "2026-08-10T08:00:00.000Z",
    observed_at: "2026-08-10T08:00:00.000Z",
    source_type: "database",
    source_id: "request-ac",
    truth_state: "observed",
    confidence: 0.86,
    freshness: "recent",
    privacy_class: "resident_home_private",
    permissions: ["maintenance.read"],
    evidence: [],
  },
];

check("reports domain owns deterministic report answer and evidence boundary", () => {
  assert.match(reportAnswers, /buildReportAnswer/);
  assert.match(reportEvidence, /loadReportEvidence/);
  assert.match(reportEvidence, /isBroadReportRequest/);
  assert.match(reportEvidence, /reportEvidenceProfile/);
  assert.doesNotMatch(presentation, /export function buildReportAnswer/);
  assert.match(runtimeSource, /loadReportEvidence/);
});

check("reports are registered capability but not another intelligence engine", () => {
  assert.match(capabilityRegistry, /domain: "reports"/);
  assert.match(capabilityRegistry, /unsupported: \["execute", "export_without_report_workflow"\]/);
  assert.doesNotMatch(reportAnswers, /predictionTruth|summarizePredictions|forecast\(|recommendation engine|prediction engine/i);
  assert.doesNotMatch(reportEvidence, /from\("wallet_transactions"\)|from\("maintenance_requests"\)|from\("security_incidents"\)/);
});

check("target, resolver and hydration contracts remain canonical", () => {
  assert.match(targetCandidates, /constructBroadScopeObject/);
  assert.match(targetResolver, /resolveConversationTarget/);
  assert.match(objectHydration, /hydrateOperationalObjectCandidate/);
  assert.doesNotMatch(reportEvidence, /resolveConversationTarget|hydrateOperationalObjectCandidate/);
});

check("consumer home report stays home scoped and clears stale exact device", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Give me a home operations report for this month.",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(result.resolved_turn.domain, "reports");
  assert.equal(result.contract.intent, "report");
  assert.equal(result.contract.operation_class, "report");
  assert.equal(result.contract.scope_mode, "home_scope");
  assert.notEqual(result.contract.target.object_type, "device");
  assert.equal(result.contract.mutation.requested, false);
});

check("facility report uses authorized building scope", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Give me the building utility report for this month.",
    object: staleDevice,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.equal(result.resolved_turn.domain, "reports");
  assert.equal(result.contract.intent, "report");
  assert.equal(result.contract.scope_mode, "building_scope");
  assert.notEqual(result.contract.target.object_type, "device");
});

check("exact-object report can retain explicit report target", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Show a report for this meter this month.",
    object: meterObject,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(result.resolved_turn.domain, "reports");
  assert.equal(result.contract.intent, "report");
  assert.equal(result.contract.scope_mode, "exact_target");
  assert.equal(result.contract.target.object_type, "meter");
  assert.equal(result.contract.target.canonical_id, "meter-electricity-1");
});

check("analytical read is distinct from report artifact generation", () => {
  const generated = runtime.canonicalReportAnswerForTest({
    facts: reportFacts,
    message: "Generate a monthly operations report.",
  });
  assert.match(generated, /Report generation: this is an analytical conversation answer/);
  assert.match(generated, /No persisted\/exported report artifact was created/);
  const readOnly = runtime.canonicalReportAnswerForTest({
    facts: reportFacts,
    message: "Give me an operations report.",
  });
  assert.match(readOnly, /Report generation: not requested for this turn/);
});

check("report answers preserve deterministic sections and insufficient evidence caveat", () => {
  const answer = runtime.canonicalReportAnswerForTest({
    facts: reportFacts,
    message: "Give me an operations report.",
  });
  assert.match(answer, /Period:/);
  assert.match(answer, /Summary:/);
  assert.match(answer, /Unresolved items:/);
  assert.match(answer, /Key changes:/);
  assert.match(answer, /Limitations:/);
  assert.match(answer, /does not infer physical appliance effects, trends, or predictions/);
});

check("cross-domain report reuse keeps source domains canonical", () => {
  assert.match(utilityEvidence, /loadUtilitySpendingFacts/);
  assert.match(utilityEvidence, /loadWalletTransactionFacts/);
  assert.match(maintenanceEvidence, /unresolvedMaintenanceRecordsForContext/);
  assert.match(securityEvidence, /securityRiskAllowed/);
  assert.doesNotMatch(reportEvidence, /loadWalletTransactionFacts|unresolvedMaintenanceRecordsForContext|securityRiskAllowed/);
});

check("thread continuity supports comparison follow-up while cross-domain report changes scope", () => {
  const compare = runtime.canonicalResolvedTurnForTest({
    message: "Compare it with last month.",
    object: meterObject,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(compare.contract.target.object_type, "meter");

  const maintenance = runtime.canonicalResolvedTurnForTest({
    message: "Now show all maintenance issues this month in a report.",
    object: meterObject,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(maintenance.resolved_turn.domain, "reports");
  assert.notEqual(maintenance.contract.target.object_type, "meter");
});

check("report intent safety keeps utility actions and command retries outside reports", () => {
  const buy = runtime.canonicalResolvedTurnForTest({
    message: "Buy ₦20,000 electricity.",
    object: null,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.notEqual(buy.resolved_turn.domain, "reports");

  const retry = runtime.canonicalResolvedTurnForTest({
    message: "Retry the failed command.",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.notEqual(retry.contract.intent, "report");
});

check("existing table presentation contracts stay reused outside reports", () => {
  assert.match(presentation, /tableBlockForContract/);
  assert.match(presentation, /ConversationTableBlock/);
  assert.doesNotMatch(reportAnswers, /type: "table"|columns:|rows:/);
});

console.log("report-analytics-domain-extraction-smoke passed");
