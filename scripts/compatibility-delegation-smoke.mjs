import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const oyiRoutes = await readFile(new URL("../src/routes/oyiRoutes.ts", import.meta.url), "utf8");
const aiRoutes = await readFile(new URL("../src/routes/aiRoutes.ts", import.meta.url), "utf8");
const legacyAdapter = await readFile(new URL("../src/oyi-core/legacy/LegacyConversationAdapter.ts", import.meta.url), "utf8");

assert.match(oyiRoutes, /conversationOrchestrator\.run/);
assert.doesNotMatch(oyiRoutes, /runCanonicalConversation/);
assert.match(legacyAdapter, /runCanonicalConversation/);
assert.match(aiRoutes, /runCanonicalConversation/);
assert.doesNotMatch(oyiRoutes, /runOyiUnifiedChat\(/);
assert.doesNotMatch(aiRoutes, /routeAiCommand\(req,\s*\{/);

console.log("compatibility delegation smoke ok");
