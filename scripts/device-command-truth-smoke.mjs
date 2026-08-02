import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const controller = read("src/controllers/deviceCommandController.ts");
const runtime = read("src/services/deviceRuntimeStateService.ts");
const store = read("src/services/deviceCommandExecutionStore.ts");
const oyiRoutes = read("src/routes/oyiRoutes.ts");
const tuya = read("src/device/adapters/tuya/TuyaAdapter.ts");
const conversation = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const bridge = read("src/device/bridge.ts");
const audit = read("src/core/foundation/audit.ts");
const policy = read("src/oyi-core/policy/intelligencePolicyResolver.ts");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check("non-IR command response is accepted but not final", () => {
  assert.match(controller, /accepted:\s*true[\s\S]*final:\s*false[\s\S]*execution_status:\s*"accepted_for_processing"/);
  assert.match(controller, /message:\s*"Command sent\. Waiting for confirmation\."/);
});

check("durable command execution store records split status fields", () => {
  for (const token of [
    "request_status",
    "dispatch_status",
    "provider_status",
    "confirmation_status",
    "physical_effect_status",
    "truth_state",
    "safe_error_message",
  ]) assert.match(store, new RegExp(token));
  assert.match(store, /ai_execution_ledger/);
  assert.match(store, /command\.execution\.updated/);
});

check("runtime confirmation updates durable execution status", () => {
  assert.match(runtime, /upsertDeviceCommandExecution/);
  assert.match(runtime, /confirmation_status:\s*"state_confirmed"/);
  assert.match(runtime, /confirmation_status:\s*terminalConfirmation/);
  assert.match(runtime, /finalizePendingCommandFailure/);
  assert.match(runtime, /delete entry\.state\._oyi_pending_command/);
});

check("execution status endpoint can return device command records", () => {
  assert.match(oyiRoutes, /getDeviceCommandExecution/);
  assert.match(oyiRoutes, /\/runtime\/executions\/:executionId/);
});

check("IR false result is not logged as acknowledged success", () => {
  assert.doesNotMatch(tuya, /ir_provider_acknowledged/);
  assert.match(tuya, /ir_provider_response_received/);
  assert.match(tuya, /ir_provider_accepted/);
  assert.match(tuya, /ir_dispatch_unconfirmed/);
  assert.match(tuya, /IR_PROVIDER_DISPATCH_UNCONFIRMED/);
});

check("read-only offline-device intent blocks stale command context reuse", () => {
  assert.match(conversation, /isReadOnlyBroadDeviceIntent/);
  assert.match(conversation, /read_only_command_execution_blocked/);
  assert.match(conversation, /conversation_current_turn_authority_resolved/);
  assert.match(conversation, /inheritedExactTargetAllowed \? input\.target as any : null/);
  assert.match(conversation, /object_type:\s*inheritedExactTargetAllowed \? explicitCandidate\?\.object_type \|\| null : null/);
  assert.match(conversation, /conversation_explicit_scope_applied/);
});

check("multi-gang channel command identity is preserved", () => {
  assert.match(controller, /commandTargetType/);
  assert.match(controller, /commandChannelCode/);
  assert.match(controller, /target_type:\s*commandTargetType/);
  assert.match(controller, /channel_code:\s*commandChannelCode/);
  assert.match(controller, /device_channel[\s\S]{0,220}missing_channel_code/);
});

check("command lifecycle transitions are monotonic", () => {
  assert.match(store, /LIFECYCLE_RANK/);
  assert.match(store, /device_command_invalid_transition_blocked/);
  assert.match(store, /lifecycleRank\(attemptedStatus\) < lifecycleRank\(previousStatus\)/);
});

check("confirmation evidence rejects stale pre-command state", () => {
  assert.match(runtime, /newer_than_dispatch/);
  assert.match(runtime, /device_command_confirmation_evidence/);
  assert.match(runtime, /command_dispatch_timestamp/);
});

check("command confirmation uses priority refresh observability", () => {
  assert.match(runtime, /device_command_priority_refresh_scheduled/);
  assert.match(runtime, /delay_ms:\s*900/);
  assert.match(runtime, /device_command_priority_refresh_joined/);
});

check("provider events and resident audits stay home-private", () => {
  assert.match(bridge, /device_event_context_enriched/);
  assert.match(audit, /resident_device_private/);
  assert.match(audit, /homeId/);
  assert.match(policy, /resident_device_private/);
  assert.match(policy, /privateConsumer \? \[\] : \["future:executive"/);
});

check("fast control-state view remains separate from intelligence", () => {
  const stateController = read("src/controllers/deviceStateController.ts");
  assert.match(stateController, /view/);
  assert.match(stateController, /include_intelligence/);
  assert.match(stateController, /device_runtime_state_read_timing/);
});

console.log("device-command-truth-smoke passed");
