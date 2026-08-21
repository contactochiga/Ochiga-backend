import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "milestone2-ordinal-mutation-filter-fix-smoke-service-role-key";

// Oyi Office Conversational Runtime, Milestone 2 — three real production
// bugs found in live verification, all variants of the same underlying
// issue class ("a message that's ALSO a genuine mutation gets swallowed
// by a mechanism that only knows how to READ"):
//
// 1. "pause the second one" / "move the first one to 3pm" — a SINGULAR
//    ordinal mutation target. parseBatchTargetIntent only recognized
//    "the first N" (N>=2) and "all" before this; a bare singular ordinal
//    fell through to nothing, AND separately got swallowed by the
//    generic read-only follow-up resolver (parseFollowUpIntent's own
//    ordinal detection, which runs BEFORE capability routing).
// 2. "assign those to Adoyi" — a PRONOUN batch target referring to the
//    whole active/filtered list, not a specific count.
// 3. "which ones are critical?" — a filter follow-up without "only"/
//    "just" wording.
// Plus one classifier bug found alongside these: "partnerships" (plural)
// never matched corporate_partnerships' domain classifier at all
// (only the singular "partnership" did, since \bpartnership\b requires
// a word boundary immediately after "partnership" that the plural's
// trailing "s" breaks).
const { parseBatchTargetIntent } = await import("../dist/oyi-core/context/officeActionProposal.js");
const { parseFollowUpIntent, resolveFilterFollowUp } = await import("../dist/oyi-core/interpretation/followUpResolver.js");
const { normalizeUserTurn } = await import("../dist/oyi-core/runtime/languageUnderstanding.js");
function classifyDomain(text) {
  return normalizeUserTurn(text).domain;
}

// --- 1. Single-ordinal batch target ---
assert.deepEqual(parseBatchTargetIntent("pause the second one"), { type: "ordinal", position: 2 });
assert.deepEqual(parseBatchTargetIntent("pause the first one"), { type: "ordinal", position: 1 });
assert.deepEqual(parseBatchTargetIntent("move the first automation to 3pm"), { type: "ordinal", position: 1 });
assert.deepEqual(parseBatchTargetIntent("resolve the third one"), { type: "ordinal", position: 3 });
// Still mutually exclusive with the existing count pattern.
assert.deepEqual(parseBatchTargetIntent("pause the first two"), { type: "count", count: 2 });
assert.deepEqual(parseBatchTargetIntent("pause all of them"), { type: "all" });

// --- 2. Pronoun batch target ("those"/"these") ---
assert.deepEqual(parseBatchTargetIntent("assign those to Adoyi"), { type: "all" });
assert.deepEqual(parseBatchTargetIntent("make these high priority"), { type: "all" });
assert.equal(parseBatchTargetIntent("assign this to Adoyi"), null, "a SINGULAR 'this' must never be misread as a batch target -- that's the single-record path");

// --- 3. Filter follow-up without "only"/"just" ---
assert.deepEqual(parseFollowUpIntent("which ones are critical"), { type: "filter", keyword: "critical" });
assert.deepEqual(parseFollowUpIntent("which are high priority?"), { type: "filter", keyword: "high priority" });
assert.deepEqual(parseFollowUpIntent("show only the high priority ones"), { type: "filter", keyword: "high priority" }, "pre-existing only/just phrasing must be unaffected");
assert.equal(parseFollowUpIntent("which meeting is this"), null, "a genuinely unrelated 'which' question must not be misread as a filter");

const resultSet = {
  object_refs: [
    { object_type: "support_case", canonical_id: "case-1", label: "Escalation", occurred_at: null, metric: null, metric_value: null, status: "open", attributes: { severity: "critical", priority: "high" } },
    { object_type: "support_case", canonical_id: "case-2", label: "Billing question", occurred_at: null, metric: null, metric_value: null, status: "open", attributes: { severity: "low", priority: "low" } },
  ],
};
const filterResolution = resolveFilterFollowUp(resultSet, "critical");
assert.equal(filterResolution.status, "resolved");
assert.equal(filterResolution.matched.length, 1);
assert.equal(filterResolution.matched[0].canonical_id, "case-1");

// --- Partnerships plural classifier fix ---
assert.equal(classifyDomain("Show me the partnerships"), "corporate_partnerships", "the plural form must classify correctly, not just the singular");
assert.equal(classifyDomain("What is the status of this partnership"), "corporate_partnerships", "the pre-existing singular form must be unaffected");
assert.equal(classifyDomain("How can I partner with Ochiga"), "corporate_partnerships", "the pre-existing qualified phrase must be unaffected");

console.log("milestone2-ordinal-mutation-and-filter-fix-smoke: PASS");
