import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";
const runtime = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalConversationRuntime.ts"), "utf8");
const turnResolution = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalTurnResolution.ts"), "utf8");
const currentTurnAuthority = fs.readFileSync(path.join(root, "src/oyi-core/context/currentTurnAuthority.ts"), "utf8");
const intentRouting = fs.readFileSync(path.join(root, "src/oyi-core/interpretation/conversationIntentRouting.ts"), "utf8");
const targetResolver = fs.readFileSync(path.join(root, "src/oyi-core/runtime/conversationTargetResolver.ts"), "utf8");
const targetHydration = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts"), "utf8");
const objectHydration = fs.readFileSync(path.join(root, "src/oyi-core/context/conversationObjectHydration.ts"), "utf8");
const deviceEvidence = fs.readFileSync(path.join(root, "src/oyi-core/domains/devices/deviceEvidence.ts"), "utf8");
const answerPresentation = fs.readFileSync(path.join(root, "src/oyi-core/presentation/conversationAnswerPresentation.ts"), "utf8");
const proximity = fs.readFileSync(path.join(root, "src/services/proximityService.ts"), "utf8");
const runtimeModule = await import(path.join(root, "dist/oyi-core/testing/canonicalConversationTestSupport.js"));

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

const runConversation = runtime.slice(runtime.indexOf("export async function runCanonicalConversation"));
const contractBuilder = section("contract", turnResolution, "export function resolveIntentContract", "export function operationForResolvedTurn");
const activityBuilder = section("activity", deviceEvidence, "function loadRecentDeviceChangeFacts", "export async function loadLatestCommandFact");
const commandBuilder = section("command", answerPresentation, "function buildCommandOutcomeAnswer", "export function buildDeviceAvailabilityInventoryAnswer");

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
  assert.match(currentTurnAuthority, /canInheritedExactTargetSatisfyCurrentTurn/);
  assert.match(currentTurnAuthority, /currentTurnExplicitlyGlobal/);
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
  assert.match(turnResolution, /scopeHint/);
  assert.match(turnResolution, /scope_mode_hint[\s\S]{0,160}\.toLowerCase\(\)/);
  assert.match(contractBuilder, /scopeHint === "exact_target"/);
  assert.match(contractBuilder, /!explicitBroad[\s\S]{0,80}"exact_target"/);
});

check("explicit requested channel rebinding happens before hydration", () => {
  assert.match(targetResolver, /function requestedChannelCode/);
  assert.match(runConversation, /conversation_target_scope_normalized/);
  assert.match(contractBuilder, /requestedChannel && targetParentId/);
  assert.match(contractBuilder, /`\$\{targetParentId\}:\$\{requestedChannel\}`/);
});

check("exact-target evidence compatibility rejects proximity and internal events", () => {
  assert.match(turnResolution, /function evaluateFactCompatibility/);
  assert.match(turnResolution, /internal_or_proximity_noise/);
  assert.match(turnResolution, /different_channel_or_device/);
  assert.match(turnResolution, /exact_channel_match/);
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
  assert.match(turnResolution, /read_only_no_execution/);
});

check("object hydration uses shared registry plus surface policy", () => {
  assert.match(objectHydration, /hydrateCanonicalTarget/);
  assert.match(objectHydration, /hydrationPolicyForSurface/);
  assert.match(objectHydration, /canUseVisibleStateFallback \? input\.visibleState : null/);
  assert.match(targetHydration, /estate: \{ table: "estates"/);
  assert.match(targetHydration, /home: \{ table: "homes"/);
  assert.match(targetHydration, /building: \{ table: "estate_buildings"/);
  assert.match(targetHydration, /zone: \{ table: "estate_zones"/);
  assert.doesNotMatch(runConversation, /async function resolveCandidate/);
});

console.log("intelligence-target-evidence-closure-smoke passed");
