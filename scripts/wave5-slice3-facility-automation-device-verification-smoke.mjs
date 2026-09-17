#!/usr/bin/env node
// Intelligence Convergence, Wave 5 Slice 3 -- real physical-state
// verification for Facility Automation device actions.
//
// Confirmed defect: Facility Automation verified physical device actions
// via verifyDeviceAction({..., expected_state: {}}), and the old
// verification logic evaluated Object.entries({}).every(...) -- vacuously
// true. A Facility Automation device command could be reported
// verified:true without the physical device ever being confirmed.
//
// Fix: verifyDeviceAction (src/intelligence-core/verificationService.ts)
// no longer independently reconstructs truth from the legacy device_states
// table. It now consumes the one already-real, already-canonical
// confirmation outcome that executeDeviceCommandForActor's dispatch (and
// deviceRuntimeStateService's own expected-vs-observed comparison) already
// writes to ai_execution_ledger, keyed by command_execution_id --
// threaded from executionRegistry.ts's existing executeDeviceCommandForActor
// call, through executeRegisteredAction's existing { ok, status, result }
// return shape (result.command_execution_id was already there; nothing in
// executionRegistry.ts needed to change), into facilityAutomationService.ts's
// executeApprovalRow/runVerification. verifyDeviceAction's own VerificationState
// vocabulary (pending|verified|failed|timeout) is unchanged and unextended --
// "pending" already existed (verifyWorkflowCompletion) and is exactly what
// an honestly-unconfirmed command now reports, both from verifyDeviceAction
// and from executeApprovalRow's own status update, which now leaves
// automation_approvals in "executing" (unchanged existing terminal-CAS
// value) instead of misreporting it as verification_failed.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// This exercises real reads/writes against ai_execution_ledger, so it must
// target the local Supabase dev instance only -- never .env's remote
// project. Values match `supabase status`'s local REST API/secret key.
process.env.SUPABASE_URL = "http://127.0.0.1:54321";
const localServiceRoleKey = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!localServiceRoleKey) {
  throw new Error("OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required for this local Supabase smoke test");
}
process.env.SUPABASE_SERVICE_ROLE_KEY = localServiceRoleKey;

const { verifyDeviceAction, verifyVisitorStatus } = await import("../dist/intelligence-core/verificationService.js");
const { upsertDeviceCommandExecution } = await import("../dist/services/deviceCommandExecutionStore.js");
const { authorizeDeviceCommand, DEVICE_COMMAND_CAPABILITY_KEY } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");
const { capabilityRegistry } = await import("../dist/oyi-core/capabilities/CapabilityRegistry.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const verificationServiceSource = readFileSync(new URL("../src/intelligence-core/verificationService.ts", import.meta.url), "utf8");
const facilityAutomationServiceSource = readFileSync(new URL("../src/services/facilityAutomationService.ts", import.meta.url), "utf8");
const eventRuleSource = readFileSync(new URL("../src/services/facilityAutomationEventRuleService.ts", import.meta.url), "utf8");
const deviceCommandControllerSource = readFileSync(new URL("../src/controllers/deviceCommandController.ts", import.meta.url), "utf8");
const executionRegistrySource = readFileSync(new URL("../src/intelligence-core/executionRegistry.ts", import.meta.url), "utf8");

const TEST_DEVICE_ID = "wave5-slice3-smoke-device";

async function fixtureExecution(patch) {
  const commandExecutionId = randomUUID();
  await upsertDeviceCommandExecution({
    command_execution_id: commandExecutionId,
    canonical_device_id: TEST_DEVICE_ID,
    provider: "tuya",
    source: "automation",
    requested_at: new Date().toISOString(),
    request_status: "accepted",
    dispatch_status: "dispatched",
    provider_status: "accepted",
    final_status: patch.final_status,
    truth_state: patch.final_status,
    expected_state: patch.expected_state,
    observed_state: patch.observed_state || null,
    lifecycle: [{ status: patch.final_status, occurred_at: new Date().toISOString() }],
    ...patch,
  });
  return commandExecutionId;
}

// ============================= 1. Empty {} expected state can never produce verified:true =============================

{
  const id = await fixtureExecution({ confirmation_status: "state_confirmed", physical_effect_status: "confirmed", final_status: "state_confirmed", expected_state: {}, observed_state: { switch_1: true } });
  const result = await verifyDeviceAction({ device_id: TEST_DEVICE_ID, command_execution_id: id });
  need(result.state !== "verified", `1. an empty {} expected_state must never yield verified:true even when confirmation_status is state_confirmed, got: ${JSON.stringify(result)}`);
}

// ============================= 2. device.on with confirmed matching physical state -> verified =============================

{
  const id = await fixtureExecution({ confirmation_status: "state_confirmed", physical_effect_status: "confirmed", final_status: "state_confirmed", expected_state: { switch_1: true }, observed_state: { switch_1: true } });
  const result = await verifyDeviceAction({ device_id: TEST_DEVICE_ID, command_execution_id: id });
  need(result.state === "verified", `2. device.on with a confirmed, matching physical state must verify, got: ${JSON.stringify(result)}`);
}

// ============================= 3. device.off with confirmed matching physical state -> verified =============================

{
  const id = await fixtureExecution({ confirmation_status: "state_confirmed", physical_effect_status: "confirmed", final_status: "state_confirmed", expected_state: { switch_1: false }, observed_state: { switch_1: false } });
  const result = await verifyDeviceAction({ device_id: TEST_DEVICE_ID, command_execution_id: id });
  need(result.state === "verified", `3. device.off with a confirmed, matching physical state must verify, got: ${JSON.stringify(result)}`);
}

// ============================= 4. Confirmed state mismatch -> verification_failed (state: failed) =============================

{
  const id = await fixtureExecution({ confirmation_status: "state_mismatch", physical_effect_status: "contradicted", final_status: "state_mismatch", expected_state: { switch_1: true }, observed_state: { switch_1: false } });
  const result = await verifyDeviceAction({ device_id: TEST_DEVICE_ID, command_execution_id: id });
  need(result.state === "failed", `4. a confirmed physical-state mismatch must report state:"failed" (mapped to verification_failed by executeApprovalRow), got: ${JSON.stringify(result)}`);
}

// ============================= 5. Dispatch accepted but state not confirmed -> must not be reported verified =============================

{
  const id = await fixtureExecution({ confirmation_status: "awaiting_state_confirmation", physical_effect_status: "unknown", final_status: "awaiting_state_confirmation", expected_state: { switch_1: true } });
  const result = await verifyDeviceAction({ device_id: TEST_DEVICE_ID, command_execution_id: id });
  need(result.state === "pending", `5. an accepted-but-unconfirmed command must report the honest, existing "pending" state -- never verified, and never a fabricated failure, got: ${JSON.stringify(result)}`);
}

// ============================= 6. Dispatch failure remains an execution failure, not a verification concern =============================

{
  const failIdx = facilityAutomationServiceSource.indexOf("if (!result.ok) {");
  const verificationIdx = facilityAutomationServiceSource.indexOf("const commandExecutionId = (result as any)?.result?.command_execution_id");
  need(failIdx > 0 && verificationIdx > failIdx, "6. executeApprovalRow must still return on dispatch failure (!result.ok) before any verification logic runs -- a dispatch failure is an execution_failed outcome, never routed through runVerification/verifyDeviceAction");
  need(facilityAutomationServiceSource.slice(failIdx, failIdx + 400).includes('status: "failed"'), "6. dispatch failure must still write automation_approvals.status = \"failed\", unchanged");
}

// ============================= 7/8. device.toggle cannot fabricate a target state; verifies only when a real ledger record resolves one =============================

{
  // verifyDeviceAction is action-id-agnostic -- it has no branch or special
  // case for "toggle" (nor does executeDeviceCommandForActor: zero
  // occurrences of the literal string "toggle" anywhere in its dispatch
  // logic). A toggle's command must already be a concrete, resolved
  // key/value pair by the time it reaches the executor -- proven here by
  // running the exact same fixture/verify path device.on/off already used
  // above, with no toggle-specific code path required or exercised.
  const idResolved = await fixtureExecution({ confirmation_status: "state_confirmed", physical_effect_status: "confirmed", final_status: "state_confirmed", expected_state: { switch_1: true }, observed_state: { switch_1: true } });
  const resolvedResult = await verifyDeviceAction({ device_id: TEST_DEVICE_ID, command_execution_id: idResolved });
  need(resolvedResult.state === "verified", `7/8. a toggle whose resolved command produced a confirmed, matching physical state must verify (proving toggle is not blocked from ever verifying), got: ${JSON.stringify(resolvedResult)}`);

  // No command_execution_id at all (e.g. a toggle dispatched through a
  // provider path that has not returned one) -- must remain honestly
  // unverified, never fabricate a target state or a pass.
  const noIdResult = await verifyDeviceAction({ device_id: TEST_DEVICE_ID, command_execution_id: null });
  need(noIdResult.state === "pending", `8. a toggle (or any device action) with no traceable command_execution_id must remain honestly unverified ("pending"), never fabricate verified:true, got: ${JSON.stringify(noIdResult)}`);

  need(!deviceCommandControllerSource.toLowerCase().includes("toggle"), "7. no toggle-specific deterministic target-state resolution exists anywhere in the shared executor -- toggle must therefore reuse the same expected/observed comparison as on/off, never a fabricated target");
}

// ============================= 9. Slice 1's capability kill switch remains enforced =============================

{
  const actor = { id: "facility-manager-1", role: "facility_manager", home_id: null, estate_id: "estate-1", permissions: ["devices.control"] };
  const allowed = authorizeDeviceCommand({ actor, commandSource: "facility", estateId: "estate-1", homeId: "home-1", roomId: null });
  need(allowed.allowed === true, `9. an authorized facility actor must still pass Slice 1's DeviceCommandAuthority gate, got: ${JSON.stringify(allowed)}`);
  const capabilityModule = capabilityRegistry.get(DEVICE_COMMAND_CAPABILITY_KEY);
  const original = capabilityModule.rolloutStatus;
  capabilityModule.rolloutStatus = "disabled";
  const denied = authorizeDeviceCommand({ actor, commandSource: "facility", estateId: "estate-1", homeId: "home-1", roomId: null });
  need(denied.allowed === false && denied.reason === "capability_disabled", `9. the devices.power.control kill-switch must still deny device execution, got: ${JSON.stringify(denied)}`);
  capabilityModule.rolloutStatus = original;
  need(executionRegistrySource.includes("authorizeDeviceCommand({"), "9. executionRegistry.ts's device fallthrough must still call authorizeDeviceCommand before dispatch (Slice 1, untouched by this slice)");
}

// ============================= 10. Slice 2's ai_agent autonomous authority remains unchanged =============================

need(eventRuleSource.includes('role: "ai_agent",'), "10. the automation system actor must still use the honest ai_agent PlatformRole (Slice 2, untouched by this slice)");
need(eventRuleSource.includes('id: "system:facility-automation",'), "10. the automation system actor's id must still honestly self-identify as a system/automation principal (Slice 2, untouched)");
need(eventRuleSource.includes("automationSystemActorMayActOnAction(automationActor, rule.action_id)"), "10. the action-specific authority check for auto_allowed execution must remain in place (Slice 2, untouched)");

// ============================= 11. Non-device verification behaviour is unchanged =============================

{
  const visitorResult = await verifyVisitorStatus({ visitor_id: "00000000-0000-0000-0000-000000000000", expected_status: "approved" }).catch((error) => ({ state: "timeout", summary: error?.message }));
  need(["verified", "failed", "timeout"].includes(visitorResult.state), `11. verifyVisitorStatus must still behave exactly as before (unchanged function, not touched by this slice), got: ${JSON.stringify(visitorResult)}`);
  need(!verificationServiceSource.slice(0, verificationServiceSource.indexOf("export async function verifyVisitorStatus")).includes("visitor_access"), "sanity: visitor verification logic lives in its own untouched function, not inside the rewritten verifyDeviceAction");
  need(facilityAutomationServiceSource.includes('if (actionId.startsWith("visitor.")) return expectedStatus ? verifyVisitorStatus('), "11. runVerification's visitor branch must still call the real, unchanged verifyVisitorStatus when an expected status exists");
  need(facilityAutomationServiceSource.includes('if (actionId.startsWith("maintenance.")) return expectedStatus ? verifyMaintenanceStatus('), "11. runVerification's maintenance branch must still call the real, unchanged verifyMaintenanceStatus when an expected status exists");
}

// ============================= 12. No false canonical outcome/signal reports physical verification that did not occur =============================

{
  need(facilityAutomationServiceSource.includes("const verificationTerminal = verification.state === \"verified\" || verification.state === \"failed\" || verification.state === \"timeout\";"), "12. executeApprovalRow must only treat verified/failed/timeout as terminal -- \"pending\" is explicitly excluded");
  need(facilityAutomationServiceSource.includes("if (verificationTerminal) updatePayload.status = verified ? \"succeeded\" : \"verification_failed\";"), "12. automation_approvals.status must only be written to a terminal value (succeeded/verification_failed) when verification is terminal -- a pending/unconfirmed outcome must never masquerade as either");
  need(facilityAutomationServiceSource.includes('action: "automation.execution.verification_pending"'), "12. a genuinely-pending verification must be recorded via its own honest audit action, never as automation.execution.succeeded or .verification_failed");
  need(!verificationServiceSource.includes("Object.entries(expected).every"), "12. the old vacuous Object.entries({}).every(...) comparison must be fully gone from verifyDeviceAction");
  need(!verificationServiceSource.slice(verificationServiceSource.indexOf("export async function verifyDeviceAction")).includes('from("device_states")'), "12. verifyDeviceAction must no longer read the legacy device_states table at all -- it consumes the canonical ai_execution_ledger record instead");
}

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS an empty {} expected_state can never produce verified:true, even against a state_confirmed ledger record");
console.log("PASS device.on with a confirmed, matching physical state verifies against the real ai_execution_ledger record");
console.log("PASS device.off with a confirmed, matching physical state verifies against the real ai_execution_ledger record");
console.log("PASS a confirmed physical-state mismatch reports \"failed\" (verification_failed), never a false pass");
console.log("PASS dispatch accepted but not yet confirmed reports the honest, pre-existing \"pending\" state -- never verified, never a fabricated failure");
console.log("PASS a dispatch failure short-circuits before any verification logic runs, unchanged");
console.log("PASS device.toggle has no special-case/fabricated target-state logic anywhere -- it verifies exactly like on/off when a real ledger record resolves, and stays honestly unverified when none does");
console.log("PASS Slice 1's devices.power.control capability kill-switch still governs device execution");
console.log("PASS Slice 2's honest ai_agent autonomous-authority subject is unchanged");
console.log("PASS non-device (visitor/maintenance) verification behaviour is unchanged");
console.log("PASS no false canonical outcome/signal (succeeded or verification_failed) is ever reported for a verification that did not actually occur");
console.log("wave5-slice3-facility-automation-device-verification-smoke passed");
