import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Wave 10 retirement replacement for the former legacy-chat behavioural
// fixture. Awareness fallback remains separately covered; general chat must
// not be reintroduced as a compatibility engine.
const service = await readFile(new URL("../src/services/oyiUnifiedIntelligenceService.ts", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/oyi-core/runtime/canonicalConversationRuntime.ts", import.meta.url), "utf8");
const orchestrator = await readFile(new URL("../src/oyi-core/orchestration/ConversationOrchestrator.ts", import.meta.url), "utf8");

assert.doesNotMatch(service, /export\s+async\s+function\s+runOyiUnifiedChat\b/, "the dormant general-chat export must remain retired");
assert.doesNotMatch(runtime, /runOyiUnifiedChat\(/, "canonical runtime must not restore legacy chat fallback");
assert.doesNotMatch(orchestrator, /LegacyConversationAdapter|runCanonicalConversation|runOyiUnifiedChat/, "orchestrator must fail governedly, not re-enter compatibility chat");
assert.match(service, /export async function getOyiUnifiedAwareness\b/, "separate disclosed awareness compatibility remains explicit");

console.log("PASS retired legacy general chat remains absent while awareness compatibility stays explicit");
