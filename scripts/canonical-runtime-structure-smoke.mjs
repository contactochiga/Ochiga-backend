import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const runtimePath = "src/oyi-core/runtime/canonicalConversationRuntime.ts";
const runtime = read(runtimePath);
const contracts = read("src/oyi-core/contracts/canonicalConversation.ts");
const adapters = read("src/oyi-core/runtime/canonicalConversationAdapters.ts");
const persistence = read("src/oyi-core/persistence/canonicalConversationPersistence.ts");
const truth = read("src/oyi-core/persistence/canonicalConversationTruth.ts");
const fallbackPresentation = read("src/oyi-core/presentation/objectFallbackPresentation.ts");
const clarification = read("src/oyi-core/workflows/conversationClarification.ts");
const turnResolution = read("src/oyi-core/runtime/canonicalTurnResolution.ts");
const testSupport = read("src/oyi-core/testing/canonicalConversationTestSupport.ts");

const sourceFiles = [];
function collect(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(rel);
    else if (entry.name.endsWith(".ts")) sourceFiles.push(rel);
  }
}
collect("src/oyi-core");

assert.match(contracts, /export type CanonicalConversationRequest/);
assert.match(contracts, /export type CanonicalConversationResponse/);
assert.match(contracts, /export type OperationalObject/);
assert.doesNotMatch(runtime, /export type CanonicalConversationRequest/);
assert.doesNotMatch(runtime, /export type OperationalObject\s*=/);

for (const file of sourceFiles) {
  if (file === runtimePath) continue;
  const source = read(file);
  const runtimeTypeImport = source
    .split("\n")
    .some((line) => /^\s*import\s+type\b/.test(line) && /canonicalConversationRuntime/.test(line));
  assert.equal(runtimeTypeImport, false, `${file} must import canonical conversation types from contracts, not the runtime`);
}

assert.match(adapters, /adaptCanonicalToCompatibilityChat/);
assert.match(adapters, /adaptCanonicalToAiChat/);
assert.doesNotMatch(adapters, /runCanonicalConversation|runOyiUnifiedChat|supabaseAdmin|resolveConversationTarget|hydrateOperationalObjectCandidate/);
assert.doesNotMatch(runtime, /export function adaptCanonicalToCompatibilityChat/);
assert.doesNotMatch(runtime, /export function adaptCanonicalToAiChat/);

assert.match(runtime, /runCanonicalConversation/);
assert.match(runtime, /persistCanonicalAuthoritativeMessages/);
assert.match(runtime, /resolveCurrentTurnAuthorityDecision/);
assert.doesNotMatch(runtime, /supabaseAdmin|oyi_conversation_threads|oyi_conversation_messages|thread_upsert|assistant_message_insert|user_message_insert|current_turn_verification/);
assert.match(persistence, /persistCanonicalConversationTurn/);
assert.match(persistence, /oyi_conversation_threads/);
assert.match(persistence, /oyi_conversation_messages/);
assert.match(truth, /canonicalTruthFor/);

assert.doesNotMatch(runtime, /function objectPersonality|function spatialReasoningReply|export function shapeObjectConversation/);
assert.match(fallbackPresentation, /function objectPersonality/);
assert.match(fallbackPresentation, /function spatialReasoningReply/);
assert.match(fallbackPresentation, /export function shapeObjectConversation/);

assert.doesNotMatch(runtime, /function pendingClarificationFromThread|function matchPendingClarificationCandidate|function buildClarificationContinuationResponse/);
assert.match(clarification, /pendingClarificationFromThread/);
assert.match(clarification, /matchPendingClarificationCandidate/);
assert.match(clarification, /buildClarificationContinuationResponse/);

assert.doesNotMatch(runtime, /function selectConversationBuilder|function presentationPolicyForContract|function resolveIntentContract/);
assert.match(turnResolution, /function selectConversationBuilder/);
assert.match(turnResolution, /function presentationPolicyForContract/);
assert.match(turnResolution, /function resolveIntentContract/);

assert.doesNotMatch(runtime, /export function canonical[A-Za-z]+ForTest|export \{ resolveContextSourceForTest/);
assert.match(testSupport, /canonicalResolvedTurnForTest/);

console.log("canonical-runtime-structure-smoke: ok");
