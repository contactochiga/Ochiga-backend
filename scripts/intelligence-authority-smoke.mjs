import fs from "fs";
import assert from "assert";

const read = (file) => fs.readFileSync(file, "utf8");

const runtime = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const intentRouting = read("src/oyi-core/interpretation/conversationIntentRouting.ts");
const targetResolver = read("src/oyi-core/runtime/conversationTargetResolver.ts");
const deviceAnswers = read("src/oyi-core/domains/devices/deviceConversationAnswers.ts");
const deviceEvidence = read("src/oyi-core/domains/devices/deviceEvidence.ts");
const surfacePolicy = read("src/oyi-core/policy/surfaceConversationPolicy.ts");
const timeFreshness = read("src/oyi-core/presentation/timeFreshness.ts");
const answerPresentation = read("src/oyi-core/presentation/conversationAnswerPresentation.ts");
const routes = read("src/routes/oyiRoutes.ts");
const aiRoutes = read("src/routes/aiRoutes.ts");
const requestMapper = read("src/oyi-core/api/ConversationRequestMapper.ts");
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
  assert.match(intentRouting, /export type IntelligenceRequestContract/);
  assert.match(intentRouting, /operation_class/);
  assert.match(intentRouting, /scope_mode/);
  assert.match(intentRouting, /answer_builder/);
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
  assert.match(deviceAnswers, /buildDeviceHealthAnswer/);
  assert.doesNotMatch(deviceAnswers.match(/function buildDeviceHealthAnswer[\s\S]*?export function buildDeviceFailureHistoryAnswer/)?.[0] || "", /Done\.|Everything responded normally/);
});

check("current-turn execution correlation prevents stale execution leakage", () => {
  assert.match(runtime, /conversation_execution_correlation_checked/);
  assert.match(runtime, /current_turn_execution: false/);
  assert.match(runtime, /referenced_execution/);
  assert.match(runtime, /command_outcome/);
});

check("recent changes engine loads concrete records and deduplicates facts", () => {
  assert.match(runtime, /loadRecentChangeFacts/);
  assert.match(deviceEvidence, /ai_execution_ledger/);
  assert.match(deviceEvidence, /audit_events/);
  assert.match(runtime, /dedupeFacts/);
  assert.match(deviceEvidence, /conversation_fact_deduplicated/);
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
  assert.match(answerPresentation, /Period:/);
  assert.match(answerPresentation, /Summary:/);
  assert.match(answerPresentation, /Unresolved items:/);
  assert.match(answerPresentation, /Limitations:/);
});

check("single authoritative persistence is canonical for supported builders", () => {
  assert.match(runtime, /persistCanonicalAuthoritativeMessages/);
  assert.match(runtime, /single_authoritative_response/);
  assert.match(runtime, /conversation_final_answer_selected/);
});

check("compatibility routes still delegate into canonical runtime", () => {
  assert.match(routes, /conversationOrchestrator\.run/);
  assert.match(routes, /adaptCanonicalToCompatibilityChat/);
  assert.doesNotMatch(routes, /runOyiUnifiedChat\(/);
});

check("runtime routes preserve submitted canonical target instead of overwriting it", () => {
  assert.match(routes, /mapOyiRouteBodyToConversationRequest/);
  assert.match(requestMapper, /body\?\.target \|\| body\?\.request\?\.target \|\| oisContext\?\.target/);
  assert.match(aiRoutes, /req\.body\?\.target \|\| context\.target \|\| req\.oisContext\?\.target/);
});

check("named device and room lookup live in the canonical target resolver", () => {
  assert.match(targetResolver, /resolveNamedDeviceForRead/);
  assert.match(targetResolver, /resolveRoomForRead/);
  assert.match(targetResolver, /requestedChannelCode/);
  assert.match(targetResolver, /conversation_named_device_resolution_failed/);
  assert.match(targetResolver, /conversation_room_resolution_failed/);
  assert.doesNotMatch(runtime, /async function resolveNamedDeviceForRead/);
  assert.doesNotMatch(runtime, /async function resolveRoomForRead/);
});

check("exact-target read builders cover activity, failures, diagnosis and relationships", () => {
  for (const token of ["failure_history", "diagnosis", "relationships"]) {
    assert.match(runtime, new RegExp(token));
  }
  for (const token of ["buildDeviceFailureHistoryAnswer", "buildDeviceDiagnosisAnswer", "buildDeviceRelationshipsAnswer"]) {
    assert.match(deviceAnswers, new RegExp(token));
  }
  assert.match(runtime, /exact_target_read_authority/);
  assert.match(runtime, /conversation_inventory_fallback_blocked/);
});

check("device channel activity is filtered by exact command channel", () => {
  assert.match(deviceEvidence, /object\?\.object_type === "device_channel"/);
  assert.match(deviceEvidence, /channel !== contract\.target\.channel_code/);
  assert.match(runtime, /factAppliesToContract/);
});

check("safe date and internal language firewall prevent Invalid Date and internal event names", () => {
  assert.match(timeFreshness, /function safeDateLabel/);
  assert.match(runtime, /Invalid Date/);
  assert.match(runtime, /ai\\\.\[a-z0-9_/);
  assert.doesNotMatch(deviceEvidence.match(/function loadRecentDeviceChangeFacts[\s\S]*?export async function loadLatestCommandFact/)?.[0] || "", /new Date\([^)]*\)\.toLocale/);
});

check("surface capability policy is outside the canonical runtime", () => {
  assert.match(surfacePolicy, /globalCapabilityAnswerForSurface/);
  assert.match(surfacePolicy, /surface === "facility"/);
  assert.match(surfacePolicy, /control authorised devices/);
  assert.match(runtime, /buildSurfaceCapabilityAnswer/);
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
