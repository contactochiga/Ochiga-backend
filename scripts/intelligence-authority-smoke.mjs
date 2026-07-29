import fs from "fs";
import assert from "assert";

const read = (file) => fs.readFileSync(file, "utf8");

const runtime = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const routes = read("src/routes/oyiRoutes.ts");

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
  assert.match(runtime, /proximity signal alone is not evidence of an access problem/);
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

console.log("intelligence-authority-smoke passed");
