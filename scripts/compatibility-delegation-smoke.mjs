import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const oyiRoutes = await readFile(new URL("../src/routes/oyiRoutes.ts", import.meta.url), "utf8");
const aiRoutes = await readFile(new URL("../src/routes/aiRoutes.ts", import.meta.url), "utf8");
const legacyAdapter = await readFile(new URL("../src/oyi-core/legacy/LegacyConversationAdapter.ts", import.meta.url), "utf8");

assert.match(oyiRoutes, /conversationOrchestrator\.run/);
assert.doesNotMatch(oyiRoutes, /runCanonicalConversation/);
assert.match(legacyAdapter, /runCanonicalConversation/);
// Programme 4 Phase B: /ai/chat now resolves through the canonical
// ConversationOrchestrator directly, same as /oyi/chat. It no longer calls
// the pipeline-2 runtime itself; that runtime remains reachable only via
// LegacyConversationAdapter's fallback (asserted above).
assert.match(aiRoutes, /conversationOrchestrator\.run/);
assert.doesNotMatch(aiRoutes, /runCanonicalConversation/);
assert.doesNotMatch(oyiRoutes, /runOyiUnifiedChat\(/);
assert.doesNotMatch(aiRoutes, /routeAiCommand\(req,\s*\{/);

console.log("compatibility delegation smoke ok");
