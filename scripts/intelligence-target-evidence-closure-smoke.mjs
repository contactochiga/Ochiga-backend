import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";
const runtime = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalConversationRuntime.ts"), "utf8");
const intentRouting = fs.readFileSync(path.join(root, "src/oyi-core/interpretation/conversationIntentRouting.ts"), "utf8");
const deviceEvidence = fs.readFileSync(path.join(root, "src/oyi-core/domains/devices/deviceEvidence.ts"), "utf8");
const answerPresentation = fs.readFileSync(path.join(root, "src/oyi-core/presentation/conversationAnswerPresentation.ts"), "utf8");
const proximity = fs.readFileSync(path.join(root, "src/services/proximityService.ts"), "utf8");
const runtimeModule = await import(path.join(root, "dist/oyi-core/runtime/canonicalConversationRuntime.js"));

function section(name, source, start, end) {
  return source.match(new RegExp(`${start}[\\s\\S]*?${end}`))?.[0] || "";
}

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const runConversation = section("run", runtime, "export async function runCanonicalConversation", "export function adaptCanonicalToCompatibilityChat");
const contractBuilder = section("contract", runtime, "function resolveIntentContract", "function currentScope");
const activityBuilder = section("activity", deviceEvidence, "function loadRecentDeviceChangeFacts", "export async function loadLatestCommandFact");
const commandBuilder = section("command", answerPresentation, "function buildCommandOutcomeAnswer", "export function buildReportAnswer");

const channel3 = {
  object_type: "device_channel",
  canonical_id: "11111111-1111-4111-8111-111111111111:switch_3",
  label: "Channel 3",
  home_id: "home-1",
  room_id: "room-1",
  parent_id: "11111111-1111-4111-8111-111111111111",
  source: "page_selection",
};

check("explicit broad home read clears inherited exact target before resolution", () => {
  assert.match(intentRouting, /function isExplicitBroadHomeReadIntent/);
  assert.match(runConversation, /explicitTarget: inheritedExactTargetAllowed \? input\.target as any : null/);
  assert.match(runConversation, /selectedObject: inheritedExactTargetAllowed \?/);
  assert.match(runConversation, /threadTarget: inheritedExactTargetAllowed && threadCandidate \?/);
  assert.match(runConversation, /conversation_inherited_target_cleared/);
  assert.match(runConversation, /const exactTargetRequested = !Boolean/);
  assert.equal(runtimeModule.canonicalInheritedTargetEligibilityForTest({ message: "Show offline devices", object: channel3 }), false);
  assert.equal(runtimeModule.canonicalInheritedTargetEligibilityForTest({ message: "What's happening in my home?", object: channel3 }), false);
  assert.equal(runtimeModule.canonicalInheritedTargetEligibilityForTest({ message: "Is this channel on?", object: channel3 }), true);
});

check("scope hints preserve exact drawer quick actions", () => {
  assert.match(runtime, /scopeHint/);
  assert.match(runtime, /scope_mode_hint[\s\S]{0,120}\.toLowerCase\(\)/);
  assert.match(contractBuilder, /scopeHint === "exact_target"/);
  assert.match(contractBuilder, /!explicitBroad[\s\S]{0,80}"exact_target"/);
});

check("explicit requested channel rebinding happens before hydration", () => {
  assert.match(runtime, /function requestedChannelCode/);
  assert.match(runConversation, /conversation_target_scope_normalized/);
  assert.match(contractBuilder, /requestedChannel && targetParentId/);
  assert.match(contractBuilder, /`\$\{targetParentId\}:\$\{requestedChannel\}`/);
});

check("exact-target evidence compatibility rejects proximity and internal events", () => {
  assert.match(runtime, /function evaluateFactCompatibility/);
  assert.match(runtime, /internal_or_proximity_noise/);
  assert.match(runtime, /different_channel_or_device/);
  assert.match(runtime, /exact_channel_match/);
});

check("activity answer does not render proximity disclaimer or system event noise", () => {
  assert.doesNotMatch(activityBuilder, /proximity alone/i);
  assert.doesNotMatch(activityBuilder, /system event/i);
  assert.match(deviceEvidence, /isResidentVisibleOperationalFact/);
});

check("IR command history remains provider-ack-only", () => {
  assert.match(deviceEvidence, /confirmationStatus/);
  assert.match(deviceEvidence, /physicalEffectStatus/);
  assert.match(commandBuilder, /cannot directly observe whether the physical appliance responded/);
  assert.doesNotMatch(commandBuilder, /waiting for confirmation[\s\S]{0,120}not_observable/);
});

check("routine proximity checks do not emit audit intelligence", () => {
  assert.match(proximity, /if \(decision\.notify\) \{/);
  assert.match(proximity, /proximity\.awareness\.notified/);
  assert.doesNotMatch(proximity, /action: "proximity\.awareness\.checked"/);
});

check("home summary and offline inventory remain read-only", () => {
  assert.match(runtime, /read_only_command_execution_blocked/);
  assert.match(runtime, /show_offline_devices/);
  assert.match(runtime, /read_only_no_execution/);
});

console.log("intelligence-target-evidence-closure-smoke passed");
