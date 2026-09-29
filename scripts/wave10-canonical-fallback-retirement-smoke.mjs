import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtime = await readFile(new URL("../src/oyi-core/runtime/canonicalConversationRuntime.ts", import.meta.url), "utf8");
const orchestrator = await readFile(new URL("../src/oyi-core/orchestration/ConversationOrchestrator.ts", import.meta.url), "utf8");

assert.doesNotMatch(runtime, /runOyiUnifiedChat\(/, "canonical runtime must not re-enter the legacy general chat service");
assert.doesNotMatch(orchestrator, /legacyConversationAdapter\.run\(/, "canonical orchestrator must not delegate unmatched turns to the legacy adapter");
assert.match(runtime, /oyi_canonical_runtime_unsupported_total/, "unmatched canonical turns must be observable");
assert.match(orchestrator, /canonicalUnavailableFallback/, "unmatched capabilities must receive a governed terminal response");
console.log("PASS Wave 10 canonical conversation fallback retirement guard");
