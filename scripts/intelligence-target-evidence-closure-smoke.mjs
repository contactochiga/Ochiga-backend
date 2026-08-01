import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtime = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalConversationRuntime.ts"), "utf8");
const proximity = fs.readFileSync(path.join(root, "src/services/proximityService.ts"), "utf8");

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
const activityBuilder = section("activity", runtime, "function buildRecentChangesAnswer", "function buildFailureHistoryAnswer");
const commandBuilder = section("command", runtime, "function buildCommandOutcomeAnswer", "function buildReportAnswer");

check("explicit broad home read clears inherited exact target before resolution", () => {
  assert.match(runtime, /function isExplicitBroadHomeReadIntent/);
  assert.match(runConversation, /explicitTarget: broadReadOnlyDeviceIntent \? null : input\.target/);
  assert.match(runConversation, /selectedObject: broadReadOnlyDeviceIntent \? null/);
  assert.match(runConversation, /threadTarget: broadReadOnlyDeviceIntent \? null/);
  assert.match(runConversation, /conversation_inherited_target_cleared/);
  assert.match(runConversation, /const exactTargetRequested = !broadReadOnlyDeviceIntent/);
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
  assert.match(runtime, /isUsefulDeviceActivityFact/);
});

check("IR command history remains provider-ack-only", () => {
  assert.match(runtime, /confirmationStatus/);
  assert.match(runtime, /physicalEffectStatus/);
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
