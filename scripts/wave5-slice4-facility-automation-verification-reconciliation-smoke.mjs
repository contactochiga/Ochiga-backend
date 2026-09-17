#!/usr/bin/env node
// Intelligence Convergence, Wave 5 Slice 4 -- event-driven Facility
// Automation device verification reconciliation.
//
// Slice 3 established synchronous verification (executeApprovalRow ->
// runVerification -> verifyDeviceAction -> ai_execution_ledger), but left
// the asynchronous case incomplete: when a device command is still
// awaiting_state_confirmation at the moment executeApprovalRow checks it,
// automation_approvals is honestly left "executing" -- and nothing ever
// reconciled it once deviceRuntimeStateService later settled the ledger.
//
// Fix: deviceCommandExecutionStore.upsertDeviceCommandExecution (the one
// existing, canonical write point every device command on the platform
// already passes through, at dispatch time AND at settlement time) now
// detects the exact moment a ledger row newly becomes terminal
// (state_confirmed / state_mismatch / confirmation_timed_out) and calls
// facilityAutomationService.reconcileFacilityAutomationDeviceVerification
// -- no second polling runtime, no periodic scan of automation_approvals
// or ai_execution_ledger. Correlation is durable and explicit
// (automation_approvals.device_command_execution_id, written by
// executeApprovalRow before verification is even attempted), never a
// device_id + timestamp heuristic. Reconciliation reuses the exact same
// applyVerificationOutcome() the synchronous path already uses -- same
// succeeded/verification_failed mapping, same audit vocabulary -- and is
// CAS-guarded (WHERE status = 'executing') so it is safe under retries,
// duplicate ledger writes, and races with the synchronous path.
process.env.SUPABASE_URL = "http://127.0.0.1:54321";
const localServiceRoleKey = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!localServiceRoleKey) {
  throw new Error("OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required for this local Supabase smoke test");
}
process.env.SUPABASE_SERVICE_ROLE_KEY = localServiceRoleKey;

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const { upsertDeviceCommandExecution } = await import("../dist/services/deviceCommandExecutionStore.js");
const { reconcileFacilityAutomationDeviceVerification } = await import("../dist/services/facilityAutomationService.js");
const { verifyDeviceAction } = await import("../dist/intelligence-core/verificationService.js");
const { authorizeDeviceCommand, DEVICE_COMMAND_CAPABILITY_KEY } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");
const { capabilityRegistry } = await import("../dist/oyi-core/capabilities/CapabilityRegistry.js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const storeSource = readFileSync(new URL("../src/services/deviceCommandExecutionStore.ts", import.meta.url), "utf8");
const facilityAutomationServiceSource = readFileSync(new URL("../src/services/facilityAutomationService.ts", import.meta.url), "utf8");
const eventRuleSource = readFileSync(new URL("../src/services/facilityAutomationEventRuleService.ts", import.meta.url), "utf8");
const verificationServiceSource = readFileSync(new URL("../src/intelligence-core/verificationService.ts", import.meta.url), "utf8");
const deviceCommandControllerSource = readFileSync(new URL("../src/controllers/deviceCommandController.ts", import.meta.url), "utf8");

const TEST_ESTATE_ID = randomUUID();
const TEST_DEVICE_ID = randomUUID();

async function insertApproval(deviceCommandExecutionId) {
  const { data, error } = await supabase
    .from("automation_approvals")
    .insert({
      estate_id: TEST_ESTATE_ID,
      detector_id: "wave5-slice4-smoke",
      action_id: "device.on",
      entity_type: "device",
      entity_id: TEST_DEVICE_ID,
      target_label: "Smoke test device",
      reason: "wave5-slice4-smoke fixture",
      plan_snapshot: { action_id: "device.on", entity_id: TEST_DEVICE_ID },
      status: "executing",
      approver_id: null,
      approver_role: "system",
      execution_id: `automation_approval:${randomUUID()}`,
      device_command_execution_id: deviceCommandExecutionId,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function readApproval(id) {
  const { data, error } = await supabase.from("automation_approvals").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function waitForStatus(id, predicate, { attempts = 20, delayMs = 100 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const row = await readApproval(id);
    if (predicate(row)) return row;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return readApproval(id);
}

// ============================= 1. awaiting_state_confirmation -> automation remains executing =============================

{
  const commandExecutionId = randomUUID();
  const approval = await insertApproval(commandExecutionId);
  await upsertDeviceCommandExecution({
    command_execution_id: commandExecutionId,
    canonical_device_id: TEST_DEVICE_ID,
    provider: "tuya",
    source: "automation",
    requested_at: new Date().toISOString(),
    request_status: "accepted",
    dispatch_status: "dispatched",
    provider_status: "accepted",
    confirmation_status: "awaiting_state_confirmation",
    final_status: "awaiting_state_confirmation",
    truth_state: "awaiting_state_confirmation",
    expected_state: { switch_1: true },
    lifecycle: [{ status: "awaiting_state_confirmation", occurred_at: new Date().toISOString() }],
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const row = await readApproval(approval.id);
  need(row.status === "executing", `1. a device command still awaiting_state_confirmation must leave the automation row "executing", got: ${row.status}`);
}

// ============================= 2. state_confirmed -> exact correlated automation becomes succeeded (real end-to-end trigger, no direct call) =============================

let approvalConfirmed;
{
  const commandExecutionId = randomUUID();
  approvalConfirmed = await insertApproval(commandExecutionId);
  await upsertDeviceCommandExecution({
    command_execution_id: commandExecutionId,
    canonical_device_id: TEST_DEVICE_ID,
    provider: "tuya",
    source: "automation",
    requested_at: new Date().toISOString(),
    request_status: "accepted",
    dispatch_status: "dispatched",
    provider_status: "accepted",
    confirmation_status: "state_confirmed",
    physical_effect_status: "confirmed",
    final_status: "state_confirmed",
    truth_state: "state_confirmed",
    expected_state: { switch_1: true },
    observed_state: { switch_1: true },
    lifecycle: [{ status: "state_confirmed", occurred_at: new Date().toISOString() }],
  });
  const row = await waitForStatus(approvalConfirmed.id, (r) => r.status !== "executing");
  need(row.status === "succeeded", `2. a device command that settles state_confirmed (matching) must reconcile the exact correlated automation to "succeeded" via the real event-driven trigger (no direct call), got: ${row.status}`);
  approvalConfirmed = row;
}

// ============================= 3. state_mismatch -> verification_failed =============================

{
  const commandExecutionId = randomUUID();
  const approval = await insertApproval(commandExecutionId);
  await upsertDeviceCommandExecution({
    command_execution_id: commandExecutionId,
    canonical_device_id: TEST_DEVICE_ID,
    provider: "tuya",
    source: "automation",
    requested_at: new Date().toISOString(),
    request_status: "accepted",
    dispatch_status: "dispatched",
    provider_status: "accepted",
    confirmation_status: "state_mismatch",
    physical_effect_status: "contradicted",
    final_status: "state_mismatch",
    truth_state: "state_mismatch",
    expected_state: { switch_1: true },
    observed_state: { switch_1: false },
    lifecycle: [{ status: "state_mismatch", occurred_at: new Date().toISOString() }],
  });
  const row = await waitForStatus(approval.id, (r) => r.status !== "executing");
  need(row.status === "verification_failed", `3. a device command that settles state_mismatch must reconcile the automation to "verification_failed", got: ${row.status}`);
}

// ============================= 4. Nonterminal observation does not close automation (already proven in 1; re-check via direct reconcile call) =============================

{
  const commandExecutionId = randomUUID();
  const approval = await insertApproval(commandExecutionId);
  await upsertDeviceCommandExecution({
    command_execution_id: commandExecutionId,
    canonical_device_id: TEST_DEVICE_ID,
    provider: "tuya",
    source: "automation",
    confirmation_status: "not_started",
    final_status: "dispatching",
    expected_state: { switch_1: true },
  });
  await reconcileFacilityAutomationDeviceVerification(commandExecutionId, null);
  const row = await readApproval(approval.id);
  need(row.status === "executing", `4. reconciling a nonterminal ledger observation must never close the automation, got: ${row.status}`);
}

// ============================= 5. Wrong command_execution_id cannot settle another automation =============================

{
  const realId = randomUUID();
  const approval = await insertApproval(realId);
  await reconcileFacilityAutomationDeviceVerification(randomUUID(), null); // an unrelated, non-existent id
  const row = await readApproval(approval.id);
  need(row.status === "executing", `5. reconciling an unrelated/non-existent command_execution_id must never affect a different automation, got: ${row.status}`);
}

// ============================= 6. Duplicate reconciliation is idempotent =============================

{
  const before = await readApproval(approvalConfirmed.id);
  need(before.status === "succeeded", "sanity: fixture from scenario 2 must already be succeeded");
  await reconcileFacilityAutomationDeviceVerification(before.device_command_execution_id, null);
  const after = await readApproval(approvalConfirmed.id);
  need(after.status === "succeeded", `6. a duplicate reconciliation of an already-settled command must be a no-op, got: ${after.status}`);
  need(after.executed_at === before.executed_at, "6. a duplicate reconciliation must not rewrite executed_at (no duplicate side effect applied)");
}

// ============================= 7. Already-terminal automation cannot move backwards =============================

{
  const commandExecutionId = randomUUID();
  const approval = await insertApproval(commandExecutionId);
  await upsertDeviceCommandExecution({
    command_execution_id: commandExecutionId,
    canonical_device_id: TEST_DEVICE_ID,
    provider: "tuya",
    source: "automation",
    confirmation_status: "state_confirmed",
    physical_effect_status: "confirmed",
    final_status: "state_confirmed",
    expected_state: { switch_1: true },
    observed_state: { switch_1: true },
  });
  const succeededRow = await waitForStatus(approval.id, (r) => r.status !== "executing");
  need(succeededRow.status === "succeeded", "sanity: fixture must first reach succeeded");
  // Same-rank ledger flip (state_confirmed -> state_mismatch, both terminal
  // by LIFECYCLE_RANK) is not blocked at the ledger layer -- reconciliation
  // itself, via the CAS-guarded WHERE status = 'executing', is what must
  // hold the line here.
  await upsertDeviceCommandExecution({
    command_execution_id: commandExecutionId,
    canonical_device_id: TEST_DEVICE_ID,
    confirmation_status: "state_mismatch",
    physical_effect_status: "contradicted",
    final_status: "state_mismatch",
    expected_state: { switch_1: true },
    observed_state: { switch_1: false },
  });
  await reconcileFacilityAutomationDeviceVerification(commandExecutionId, null);
  const row = await readApproval(approval.id);
  need(row.status === "succeeded", `7. an already-terminal automation row must never move backwards even if the ledger later reports a contradictory terminal status, got: ${row.status}`);
}

// ============================= 8. Terminal audit/outcome emitted exactly once (structural: CAS gates the only emission path) =============================

{
  const fnStart = facilityAutomationServiceSource.indexOf("async function applyVerificationOutcome(");
  const fnBody = facilityAutomationServiceSource.slice(fnStart, facilityAutomationServiceSource.indexOf("\n}", fnStart) + 2);
  const casIdx = fnBody.indexOf('.eq("status", "executing")');
  const appliedCheckIdx = fnBody.indexOf("if (!applied)");
  const emitIdx = fnBody.indexOf("void emitAuditEvent({");
  need(casIdx > 0 && appliedCheckIdx > casIdx && emitIdx > appliedCheckIdx, "8. emitAuditEvent must only ever be reached after the CAS-guarded update succeeds (applied truthy) -- a lost race returns before any audit/notify/realtime emission, guaranteeing at-most-once terminal outcome emission");
  need(fnBody.includes('action: "automation.execution.verification_pending"'), "8. reconciliation's non-terminal path reuses the exact same audit vocabulary Slice 3 introduced -- no parallel event created");
}

// ============================= 9. Slice 1 capability authority intact =============================

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
}

// ============================= 10. Slice 2 system authority intact =============================

need(eventRuleSource.includes('role: "ai_agent",'), "10. the automation system actor must still use the honest ai_agent PlatformRole (Slice 2, untouched by this slice)");
need(eventRuleSource.includes('id: "system:facility-automation",'), "10. the automation system actor's id must still honestly self-identify as a system/automation principal (Slice 2, untouched)");

// ============================= 11. Slice 3 synchronous verification still works =============================

{
  const commandExecutionId = randomUUID();
  await upsertDeviceCommandExecution({
    command_execution_id: commandExecutionId,
    canonical_device_id: TEST_DEVICE_ID,
    provider: "tuya",
    confirmation_status: "state_confirmed",
    physical_effect_status: "confirmed",
    final_status: "state_confirmed",
    expected_state: { switch_1: true },
    observed_state: { switch_1: true },
  });
  const result = await verifyDeviceAction({ device_id: TEST_DEVICE_ID, command_execution_id: commandExecutionId });
  need(result.state === "verified", `11. synchronous verifyDeviceAction must still work exactly as Slice 3 established, got: ${JSON.stringify(result)}`);
}

// ============================= 12. Empty expected state still cannot verify =============================

{
  const commandExecutionId = randomUUID();
  await upsertDeviceCommandExecution({
    command_execution_id: commandExecutionId,
    canonical_device_id: TEST_DEVICE_ID,
    provider: "tuya",
    confirmation_status: "state_confirmed",
    physical_effect_status: "confirmed",
    final_status: "state_confirmed",
    expected_state: {},
    observed_state: { switch_1: true },
  });
  const result = await verifyDeviceAction({ device_id: TEST_DEVICE_ID, command_execution_id: commandExecutionId });
  need(result.state !== "verified", `12. an empty {} expected_state must still never verify, even under Slice 4's reconciliation path, got: ${JSON.stringify(result)}`);
}

// ============================= 13. provider_ack_only/IR does not become falsely state-confirmed =============================

{
  const commandExecutionId = randomUUID();
  const approval = await insertApproval(commandExecutionId);
  // Mirrors exactly what deviceCommandController.ts writes for an IR/
  // provider_ack_only dispatch: final_status stays "provider_accepted"
  // (LIFECYCLE_RANK 50, non-terminal) forever -- confirmation_status
  // "not_observable" is informational only and is never one of the three
  // DEVICE_VERIFICATION_TERMINAL_STATUSES.
  await upsertDeviceCommandExecution({
    command_execution_id: commandExecutionId,
    canonical_device_id: TEST_DEVICE_ID,
    provider: "tuya",
    confirmation_status: "not_observable",
    physical_effect_status: "unknown",
    final_status: "provider_accepted",
    truth_state: "provider_ack_only_physical_unknown",
    expected_state: { switch_1: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const row = await readApproval(approval.id);
  need(row.status === "executing", `13. a provider_ack_only/IR command must never be reconciled into succeeded -- it has no observable confirmation channel, got: ${row.status}`);
  need(deviceCommandControllerSource.includes('final_status: providerAckOnly ? "provider_accepted" : "awaiting_state_confirmation",'), "13. deviceCommandController.ts must still write final_status: \"provider_accepted\" (non-terminal) for provider_ack_only dispatch, not a terminal value");
  const terminalSetMatch = storeSource.match(/const DEVICE_VERIFICATION_TERMINAL_STATUSES = new Set\(\[[^\]]*\]\)/);
  need(Boolean(terminalSetMatch) && !terminalSetMatch[0].includes("not_observable") && !terminalSetMatch[0].includes("provider_accepted"), "13. DEVICE_VERIFICATION_TERMINAL_STATUSES must not include not_observable or provider_accepted -- IR devices must never trigger reconciliation");
}

// ============================= 14. Non-Tuya return contract surfaces the exact already-created command_execution_id =============================

{
  const fallbackIdx = deviceCommandControllerSource.indexOf('status: "command_queued",');
  need(fallbackIdx > 0, "14. the non-Tuya fallback return branch must still exist");
  const nearby = deviceCommandControllerSource.slice(fallbackIdx, fallbackIdx + 900);
  need(nearby.includes("command_execution_id: executionId,"), "14. the non-Tuya fallback return must now surface the exact same command_execution_id (executionId) already written to ai_execution_ledger by the vendor-agnostic upsert earlier in this function -- a pure additive contract fix");
}

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS a device command still awaiting_state_confirmation leaves the automation row honestly \"executing\"");
console.log("PASS state_confirmed settlement reconciles the exact correlated automation to \"succeeded\", via the real event-driven trigger (no direct call, no poller)");
console.log("PASS state_mismatch settlement reconciles the automation to \"verification_failed\"");
console.log("PASS a nonterminal observation never closes the automation");
console.log("PASS an unrelated/wrong command_execution_id can never settle a different automation");
console.log("PASS duplicate reconciliation of an already-settled command is a no-op -- no duplicate side effects");
console.log("PASS an already-terminal automation row can never move backwards, even under a contradictory later ledger write");
console.log("PASS terminal audit/outcome emission is CAS-gated to at-most-once, and reuses Slice 3's exact vocabulary");
console.log("PASS Slice 1's devices.power.control capability kill-switch still governs device execution");
console.log("PASS Slice 2's honest ai_agent autonomous-authority subject is unchanged");
console.log("PASS Slice 3's synchronous verifyDeviceAction still works");
console.log("PASS an empty {} expected_state still can never verify");
console.log("PASS provider_ack_only/IR commands are never falsely reconciled into a confirmed/succeeded outcome");
console.log("PASS the non-Tuya fallback return now surfaces the exact already-created command_execution_id");
console.log("wave5-slice4-facility-automation-verification-reconciliation-smoke passed");
