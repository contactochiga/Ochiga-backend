import fs from "fs";
import assert from "assert";

const read = (file) => fs.readFileSync(file, "utf8");

const runtime = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const routes = read("src/routes/oyiRoutes.ts");
const aiRoutes = read("src/routes/aiRoutes.ts");
const lifecycleStore = read("src/services/deviceCommandExecutionStore.ts");
const deviceSignals = read("src/services/deviceOperationalSignalService.ts");
const audit = read("src/core/foundation/audit.ts");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check("canonical request contract owns operation, intent, scope and builder", () => {
  assert.match(runtime, /export type IntelligenceRequestContract/);
  assert.match(runtime, /operation_class/);
  assert.match(runtime, /scope_mode/);
  assert.match(runtime, /answer_builder/);
  assert.match(runtime, /conversation_request_contract_resolved/);
});

check("read-only firewall runs before legacy compatibility can answer", () => {
  const buildIndex = runtime.indexOf("const canonicalBuilt = await buildCanonicalAuthoritativeAnswer");
  const legacyIndex = runtime.indexOf("const compatibility = await runOyiUnifiedChat");
  assert.ok(buildIndex > 0 && legacyIndex > buildIndex, "canonical builder must precede legacy chat");
  assert.match(runtime, /conversation_read_only_execution_blocked/);
  assert.match(runtime, /read_only_no_execution/);
});

check("device health answer does not use mutation completion language", () => {
  assert.match(runtime, /canonicalDeviceHealthAnswerForTest/);
  assert.match(runtime, /buildHealthAnswer/);
  assert.doesNotMatch(runtime.match(/function buildHealthAnswer[\s\S]*?function buildCapabilityAnswer/)?.[0] || "", /Done\.|Everything responded normally/);
});

check("current-turn execution correlation prevents stale execution leakage", () => {
  assert.match(runtime, /conversation_execution_correlation_checked/);
  assert.match(runtime, /current_turn_execution: false/);
  assert.match(runtime, /referenced_execution/);
  assert.match(runtime, /command_outcome/);
});

check("recent changes engine loads concrete records and deduplicates facts", () => {
  assert.match(runtime, /loadRecentChangeFacts/);
  assert.match(runtime, /ai_execution_ledger/);
  assert.match(runtime, /audit_events/);
  assert.match(runtime, /dedupeFacts/);
  assert.match(runtime, /conversation_fact_deduplicated/);
});

check("risk claims require evidence and proximity alone is not access risk", () => {
  assert.match(runtime, /securityRiskAllowed/);
  assert.match(runtime, /conversation_risk_claim_evaluated/);
  assert.match(runtime, /evaluateFactCompatibility/);
  assert.match(runtime, /internal_or_proximity_noise/);
  assert.doesNotMatch(runtime, /repeated denial, verification mismatch, or unusual activity/);
});

check("internal compatibility language is filtered from final user copy", () => {
  assert.match(runtime, /stripInternalLanguage/);
  assert.match(runtime, /conversation_internal_language_blocked/);
  assert.match(runtime, /compatibility awareness/);
  assert.match(runtime, /execution ledger/);
});

check("report builder exposes deterministic report sections", () => {
  assert.match(runtime, /canonicalReportAnswerForTest/);
  assert.match(runtime, /Period:/);
  assert.match(runtime, /Summary:/);
  assert.match(runtime, /Unresolved items:/);
  assert.match(runtime, /Limitations:/);
});

check("single authoritative persistence is canonical for supported builders", () => {
  assert.match(runtime, /persistCanonicalAuthoritativeMessages/);
  assert.match(runtime, /single_authoritative_response/);
  assert.match(runtime, /conversation_final_answer_selected/);
});

check("compatibility routes still delegate into canonical runtime", () => {
  assert.match(routes, /runCanonicalConversation/);
  assert.doesNotMatch(routes, /runOyiUnifiedChat\(/);
});

check("runtime routes preserve submitted canonical target instead of overwriting it", () => {
  assert.match(routes, /req\.body\?\.target \|\| req\.body\?\.request\?\.target \|\| req\.oisContext\?\.target/);
  assert.match(aiRoutes, /req\.body\?\.target \|\| context\.target \|\| req\.oisContext\?\.target/);
});

check("exact-target read builders cover activity, failures, diagnosis and relationships", () => {
  for (const token of ["failure_history", "diagnosis", "relationships", "buildFailureHistoryAnswer", "buildDiagnosisAnswer", "buildRelationshipsAnswer"]) {
    assert.match(runtime, new RegExp(token));
  }
  assert.match(runtime, /exact_target_read_authority/);
  assert.match(runtime, /conversation_inventory_fallback_blocked/);
});

check("device channel activity is filtered by exact command channel", () => {
  assert.match(runtime, /object\?\.object_type === "device_channel"/);
  assert.match(runtime, /channel !== contract\.target\.channel_code/);
  assert.match(runtime, /factAppliesToContract/);
});

check("safe date and internal language firewall prevent Invalid Date and internal event names", () => {
  assert.match(runtime, /function safeDateLabel/);
  assert.match(runtime, /Invalid Date/);
  assert.match(runtime, /ai\\\.\[a-z0-9_/);
  assert.doesNotMatch(runtime.match(/function buildRecentChangesAnswer[\s\S]*?function buildFailureHistoryAnswer/)?.[0] || "", /new Date\([^)]*\)\.toLocale/);
});

check("expected command lifecycle replay is idempotent without warning noise", () => {
  assert.match(lifecycleStore, /device_command_lifecycle_duplicate_replay_ignored/);
  assert.match(lifecycleStore, /String\(attemptedStatus\) === "requested"/);
  assert.match(lifecycleStore, /lifecycleRank\(previousStatus\) >= lifecycleRank\("accepted_for_processing"\)/);
});

check("resident-private device telemetry and audits do not project as generic infrastructure", () => {
  assert.match(deviceSignals, /loadDeviceScopeContext/);
  assert.match(deviceSignals, /device_event_context_enriched/);
  assert.match(deviceSignals, /privacy_class: domain/);
  assert.match(audit, /if \(isResidentDeviceAudit\) return/);
});

console.log("intelligence-authority-smoke passed");
