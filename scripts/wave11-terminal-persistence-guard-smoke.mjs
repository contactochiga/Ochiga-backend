import assert from "node:assert/strict";
import fs from "node:fs";

const orchestrator = fs.readFileSync("src/oyi-core/orchestration/ConversationOrchestrator.ts", "utf8");
const metrics = fs.readFileSync("src/oyi-core/observability/ConversationMetrics.ts", "utf8");
const tracer = fs.readFileSync("src/oyi-core/observability/ConversationTracer.ts", "utf8");

assert.match(orchestrator, /async function persistTerminalConversationResponse[\s\S]*persistCanonicalConversationTurn/,
  "terminal canonical responses must use the single canonical persistence writer");
assert.match(orchestrator, /if \(capabilityOwnsResponse\) \{[\s\S]*persistCapabilityResponse[\s\S]*\} else \{[\s\S]*persistTerminalConversationResponse/,
  "every normal-route response must persist exactly once: capability owner or terminal lifecycle");
assert.match(orchestrator, /resolution_outcome: selection\.resolution_outcome/,
  "response metadata must expose the canonical resolution outcome");
assert.match(orchestrator, /canonical_terminal_response/,
  "canonical unsupported handling must not be traced as a legacy chat response");
assert.match(metrics, /oyi_conversation_terminal_outcome_total/,
  "canonical terminal outcomes require their own metric");
assert.match(tracer, /canonical_terminal_response/,
  "tracer must expose the canonical terminal stage");
console.log("PASS Wave 11 terminal persistence/telemetry guard: terminal responses use canonical persistence and canonical outcome taxonomy");
