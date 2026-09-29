import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const aiRoutes = await readFile(new URL("../src/routes/aiRoutes.ts", import.meta.url), "utf8");
const watch = await readFile(new URL("../src/services/watchAdapterService.ts", import.meta.url), "utf8");
const orchestrator = await readFile(new URL("../src/oyi-core/orchestration/ConversationOrchestrator.ts", import.meta.url), "utf8");
const canonicalRuntime = await readFile(new URL("../src/oyi-core/runtime/canonicalConversationRuntime.ts", import.meta.url), "utf8");

assert.match(aiRoutes, /conversationOrchestrator\.run\(/, "/ai/chat must use canonical conversation");
assert.doesNotMatch(orchestrator, /from "\.\.\/\.\.\/ai\/commandRouter"|from "\.\.\/ai\/commandRouter"/, "canonical orchestrator cannot import the legacy router");
assert.doesNotMatch(canonicalRuntime, /commandRouter/, "canonical runtime cannot use the legacy router");
assert.match(watch, /routeAiCommand/, "Watch remains an explicit compatibility caller pending its domain-adapter migration");
assert.match(watch, /updateAiConfirmation/, "Watch confirmation compatibility remains explicit");
assert.match(aiRoutes, /import \{ listAiLedger, listAiConfirmations, updateAiConfirmation \} from "\.\.\/ai\/commandRouter"/, "legacy /ai routes may expose records but cannot route new commands");
assert.doesNotMatch(aiRoutes, /routeAiCommand\(/, "legacy /ai routes cannot invoke legacy command selection");
console.log("PASS Wave 10 legacy command-router boundary guard");
