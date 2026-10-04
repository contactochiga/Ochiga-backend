// Oyi Interaction Layer, Slice 1 -- action truth contract smoke.
//
// Drives the REAL canonical chain for every regression-matrix case:
//   ActionService (in-memory repository) -> DeviceConversationActionAdapter
//   -> executeDeviceCommandForActor (stubbed at the module boundary with
//   result shapes copied from deviceCommandController) -> action projection
//   -> capabilityDomainResultToConversationResponse.
// It proves the response carries the canonical OyiActionStatus + the
// whitelisted public truth fields, never conflates approval with
// verification, and never leaks device/provider internals.
//
// It also emits the cross-surface contract fixture consumed by Consumer and
// Facility (docs/contracts/oyi-action-truth.fixture.json). Without
// --write-fixture the committed fixture must match what the runtime emits.
//
// No database, no network, no real device: everything runs in memory.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

process.env.SUPABASE_URL ||= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "action-truth-contract-local-only";
process.env.OYI_ACTION_MEMORY_REPOSITORY = "true";
process.env.OYI_WORKFLOW_MEMORY_REPOSITORY = "true";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const controller = require(path.join(root, "dist/controllers/deviceCommandController.js"));
const { ActionService } = require(path.join(root, "dist/oyi-core/actions/ActionService.js"));
const { InMemoryActionRepository } = require(path.join(root, "dist/oyi-core/actions/ActionRepository.js"));
const { DeviceConversationActionAdapter } = require(path.join(root, "dist/oyi-core/domains/devices/deviceActionAdapter.js"));
const { conversationActionProjection, sanitizeConversationAction, PUBLIC_DEVICE_COMMAND_TRUTH_FIELDS } = require(path.join(root, "dist/oyi-core/actions/actionTruthProjection.js"));
const { OYI_ACTION_STATUSES } = require(path.join(root, "dist/oyi-core/actions/ActionStateMachine.js"));
const { capabilityDomainResultToConversationResponse } = require(path.join(root, "dist/oyi-core/capabilities/CapabilityResponseAdapter.js"));

const FIXTURE_PATH = path.join(root, "docs/contracts/oyi-action-truth.fixture.json");
const WRITE = process.argv.includes("--write-fixture");

// Values that must never reach a conversation response.
const SENTINELS = {
  external_id: "ext-SENTINEL-7f3a",
  vendor: "vendor-SENTINEL",
  provider: "provider-SENTINEL",
  safe_error_message: "SAFE-ERROR-SENTINEL",
  canonical_id: "dev-SENTINEL-41c2",
  home_id: "home-SENTINEL-88aa",
  estate_id: "estate-SENTINEL-19bb",
  room_id: "room-SENTINEL-55cc",
  lifecycle: "LIFECYCLE-SENTINEL",
  payload: "RAW-PAYLOAD-SENTINEL",
};

function controllerResult(publicStatus, extra = {}) {
  // Shape copied from deviceCommandController.executeDeviceCommandForActor.
  return {
    ok: true,
    accepted: true,
    command_execution_id: "exec-1",
    ...publicStatus,
    safe_error_message: SENTINELS.safe_error_message,
    device: { id: SENTINELS.canonical_id, name: "Hall Light", external_id: SENTINELS.external_id, vendor: SENTINELS.vendor },
    command: { switch_1: true },
    command_lifecycle: [{ step: SENTINELS.lifecycle }],
    provider: SENTINELS.provider,
    provider_latency_ms: 42,
    raw: { payload: SENTINELS.payload },
    message: "Command sent",
    ...extra,
  };
}

const ACK_ONLY = { request_status: "accepted", dispatch_status: "dispatched", provider_status: "accepted", confirmation_status: "not_observable", physical_effect_status: "unknown", final_status: "provider_accepted", truth_state: "provider_ack_only_physical_unknown", retryable: null };
const AWAITING_STATE = { request_status: "accepted", dispatch_status: "dispatched", provider_status: "accepted", confirmation_status: "awaiting_state_confirmation", physical_effect_status: "unknown", final_status: "awaiting_state_confirmation", truth_state: "awaiting_state_confirmation", retryable: null };
const STATE_CONFIRMED = { request_status: "accepted", dispatch_status: "dispatched", provider_status: "accepted", confirmation_status: "state_confirmed", physical_effect_status: "confirmed", final_status: "state_confirmed", truth_state: "confirmed", retryable: null };
const STATE_MISMATCH = { request_status: "accepted", dispatch_status: "dispatched", provider_status: "accepted", confirmation_status: "state_mismatch", physical_effect_status: "mismatch", final_status: "state_mismatch", truth_state: "failed", retryable: true };
const CONFIRMATION_TIMED_OUT = { request_status: "accepted", dispatch_status: "dispatched", provider_status: "accepted", confirmation_status: "confirmation_timed_out", physical_effect_status: "unknown", final_status: "confirmation_timed_out", truth_state: "failed", retryable: true };
const PROVIDER_REJECTED_RESULT = { request_status: "accepted", dispatch_status: "failed", provider_status: "rejected", confirmation_status: "failed", physical_effect_status: "unknown", final_status: "provider_rejected", truth_state: "failed", retryable: false };

let stubBehaviour = null;
let dispatchCount = 0;
controller.executeDeviceCommandForActor = async (input) => {
  dispatchCount += 1;
  assert.equal(input.commandExecutionId.length > 0, true);
  return stubBehaviour(input);
};

function providerError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const actor = { id: "11111111-1111-4111-8111-111111111111", role: "resident", email: "resident@example.test" };
const capability = { key: "devices.power.control", domain: "devices", rolloutStatus: "enabled" };

function capabilityContext() {
  return {
    input: { thread_id: "thread-1", surface: "consumer", module: "devices", message: "Confirm", target: null },
    actor,
    resolvedTurn: { semantic_frame: { operation: "device.power.on" }, scope: { estate_id: null, home_id: null } },
  };
}

function workflow() {
  return { workflow_id: "wf-1", thread_id: "thread-1", capability_key: capability.key, domain: "devices" };
}

async function newAction() {
  const service = new ActionService(new InMemoryActionRepository());
  const action = await service.create({
    workflow: workflow(),
    actorId: actor.id,
    target: { object_type: "device", canonical_id: SENTINELS.canonical_id, label: "Hall Light", channel_code: "switch_1", home_id: SENTINELS.home_id, estate_id: SENTINELS.estate_id, room_id: SENTINELS.room_id },
    requestedOperation: "device.power.on",
    requestedState: true,
  });
  return { service, action };
}

function respond(result) {
  return capabilityDomainResultToConversationResponse({ context: capabilityContext(), capability, result, evidence: [] });
}

// Mirrors ConversationOrchestrator.durableWorkflowContinuationResult's confirm
// path result (status + metadata). The orchestrator wiring itself is covered
// by the live isolated journey.
async function confirmJourney(behaviour) {
  stubBehaviour = behaviour;
  const { service, action } = await newAction();
  const approved = await service.approve(action, actor.id);
  const before = dispatchCount;
  const executed = await service.executeWithAdapter(approved, new DeviceConversationActionAdapter(actor, {}));
  assert.equal(dispatchCount - before, 1, "confirmation must dispatch exactly once");
  return respond({
    status: executed.status === "confirmed" || executed.status === "unobservable" ? "answered" : "unavailable",
    answer: "Device command outcome.",
    metadata: {
      workflow_id: "wf-1",
      workflow_status: executed.status === "confirmed" || executed.status === "unobservable" ? "completed" : "failed",
      action_id: executed.action_id,
      action_status: executed.status,
      action: conversationActionProjection(executed, executed.result ?? undefined),
      executed_this_turn: true,
    },
  });
}

const cases = [];
function record(id, matrix, title, response, expectedStatus) {
  const execution = response.execution;
  if (expectedStatus === null) {
    assert.equal(execution.action, null, `${id}: no action expected`);
  } else {
    assert.equal(execution.action?.status, expectedStatus, `${id}: action status`);
    assert.ok(OYI_ACTION_STATUSES.includes(execution.action.status));
  }
  const serialized = JSON.stringify(response);
  for (const [name, value] of Object.entries(SENTINELS)) {
    assert.equal(serialized.includes(value), false, `${id}: ${name} leaked into the conversation response`);
  }
  if (execution.action?.truth) {
    for (const key of Object.keys(execution.action.truth)) {
      assert.ok([...PUBLIC_DEVICE_COMMAND_TRUTH_FIELDS, "retryable"].includes(key), `${id}: non-whitelisted truth field ${key}`);
    }
  }
  // Fixture determinism: replace generated ids with stable per-case ids.
  const stable = JSON.parse(JSON.stringify(execution).split(execution.action?.action_id || "\u0000").join(`action-${id}`));
  cases.push({
    id,
    matrix,
    title,
    response: {
      execution: {
        status: stable.status,
        current_turn_execution: stable.current_turn_execution,
        capability_result: stable.capability_result,
        action: stable.action,
      },
    },
    // What persistence stores on the assistant message (thread restoration).
    restored_metadata: { action: stable.action || {}, workflow: stable.workflow || {} },
  });
  console.log(`PASS ${id} ${title}`);
}

// A: confirmation required (proposal).
{
  const { action } = await newAction();
  const response = respond({
    status: "awaiting_confirmation",
    answer: "Please confirm: turn on Channel 1 on Hall Light. No command was sent yet.",
    actions: [{ action_type: "approval", label: "Confirm" }, { action_type: "cancel", label: "Cancel" }],
    metadata: { workflow_id: "wf-1", action_id: action.action_id, action: conversationActionProjection(action), confirmations: [{ type: "device_command_confirmation", action_id: action.action_id }] },
  });
  assert.equal(response.execution.status, "pending_confirmation");
  assert.equal(response.execution.current_turn_execution, false);
  assert.equal(response.requiresConfirmation, true);
  assert.equal(response.execution.action.truth, null, "nothing was dispatched, so there is no device truth yet");
  record("A", "A", "confirmation required", response, "awaiting_confirmation");
}

// B: user confirms -- approval is NOT verification.
{
  const { service, action } = await newAction();
  const approved = await service.approve(action, actor.id);
  const response = respond({ status: "answered", answer: "Approved.", metadata: { workflow_id: "wf-1", action_id: approved.action_id, action: conversationActionProjection(approved) } });
  assert.equal(response.execution.action.status, "approved");
  assert.notEqual(response.execution.action.status, "confirmed");
  assert.equal(response.execution.status, "action_result");
  assert.equal(response.execution.current_turn_execution, false);
  record("B", "B", "user approved (not verified)", response, "approved");
}

// C: provider accepted, ack-only (IR) -- accepted, physically unknown.
{
  const response = await confirmJourney(() => controllerResult(ACK_ONLY));
  assert.equal(response.execution.status, "action_result");
  assert.equal(response.execution.current_turn_execution, true);
  assert.equal(response.execution.action.truth.provider_status, "accepted");
  assert.equal(response.execution.action.truth.truth_state, "provider_ack_only_physical_unknown");
  assert.equal(response.execution.action.truth.physical_effect_status, "unknown");
  record("C", "C", "provider accepted, physical effect unknown", response, "unobservable");
}

// C2: the non-terminal provider_accepted status itself (projection contract).
{
  const { service, action } = await newAction();
  let current = await service.approve(action, actor.id);
  current = await service.transition(current, "queued");
  current = await service.transition(current, "sent");
  current = await service.transition(current, "provider_accepted");
  const response = respond({ status: "answered", answer: "Accepted.", metadata: { workflow_id: "wf-1", action_id: current.action_id, action: conversationActionProjection(current, controllerResult(ACK_ONLY)) } });
  record("C2", "C", "provider accepted (in flight)", response, "provider_accepted");
}

// D: verified.
{
  const response = await confirmJourney(() => controllerResult(STATE_CONFIRMED));
  assert.equal(response.execution.action.truth.final_status, "state_confirmed");
  record("D", "D", "verified", response, "confirmed");
}

// E: unobservable -- state confirmation not available within the turn.
{
  const response = await confirmJourney(() => controllerResult(AWAITING_STATE));
  assert.equal(response.execution.action.truth.confirmation_status, "awaiting_state_confirmation");
  record("E", "E", "accepted, not verifiable in this turn", response, "unobservable");
}

// F: failed -- state mismatch, and a not-dispatched executor error.
{
  const response = await confirmJourney(() => controllerResult(STATE_MISMATCH));
  record("F", "F", "failed (state mismatch)", response, "failed");
  const thrown = await confirmJourney(() => { throw providerError(409, "This device does not expose that control."); });
  assert.equal(thrown.execution.action.truth.dispatch_status, "not_dispatched");
  record("F2", "F", "failed before dispatch (executor error is recorded, not stranded)", thrown, "failed");
}

// G: timed out. The device adapter collapses confirmation_timed_out into
// "failed" (documented residual); the projection still carries the truth
// fields, and the canonical timed_out status is mapped by the surfaces.
{
  const response = await confirmJourney(() => controllerResult(CONFIRMATION_TIMED_OUT));
  assert.equal(response.execution.action.truth.final_status, "confirmation_timed_out");
  record("G", "G", "confirmation timed out (adapter reports failed)", response, "failed");
  const projected = sanitizeConversationAction({ action_id: "act-g", status: "timed_out", requested_operation: "device.power.on", requested_state: true, target: { label: "Hall Light" }, truth: { final_status: "confirmation_timed_out" } });
  const direct = respond({ status: "unavailable", answer: "Timed out.", metadata: { workflow_id: "wf-1", action_id: "act-g", action: projected } });
  record("G2", "G", "timed out (canonical status)", direct, "timed_out");
}

// H: cancelled.
{
  const { service, action } = await newAction();
  const cancelled = await service.cancel(action, actor.id);
  const response = respond({ status: "answered", answer: "Cancelled. I did not send that device command.", metadata: { workflow_id: "wf-1", action_id: cancelled.action_id, workflow_status: "cancelled", action: conversationActionProjection(cancelled) } });
  assert.equal(response.execution.current_turn_execution, false);
  record("H", "H", "cancelled", response, "cancelled");
}

// I: superseded.
{
  const { service, action } = await newAction();
  const superseded = await service.supersede(action, "new_request");
  const response = respond({ status: "answered", answer: "Replaced.", metadata: { workflow_id: "wf-1", action_id: superseded.action_id, action: conversationActionProjection(superseded) } });
  record("I", "I", "superseded", response, "superseded");
}

// J: provider rejected -- both as a result and as a thrown provider error.
{
  const response = await confirmJourney(() => controllerResult(PROVIDER_REJECTED_RESULT));
  record("J", "J", "provider rejected", response, "provider_rejected");
  const thrown = await confirmJourney(() => { throw providerError(503, "upstream 503 SECRET-HOSTNAME internal"); });
  assert.equal(JSON.stringify(thrown).includes("SECRET-HOSTNAME"), false, "raw provider error text must not leak");
  record("J2", "J", "provider error thrown by executor", thrown, "provider_rejected");
}

// K / L: read-only and ordinary answers carry no action.
{
  const readOnly = respond({ status: "answered", answer: "Hall Light is off.", metadata: {} });
  assert.equal(readOnly.execution.status, "read_only");
  assert.equal(readOnly.execution.current_turn_execution, false);
  record("K", "K", "read-only answer", readOnly, null);
  const ordinary = respond({ status: "answered", answer: "Good morning.", metadata: {} });
  record("L", "L", "ordinary answer", ordinary, null);
}

// M: permission restricted -- no action outcome, never success.
{
  const response = respond({ status: "permission_restricted", answer: "I cannot execute that pending device command.", metadata: { workflow_id: "wf-1", action_id: "act-m", reason: "surface_not_allowed" } });
  assert.equal(response.execution.status, "read_only");
  assert.equal(response.execution.capability_result, "permission_restricted");
  record("M", "M", "permission restricted", response, null);
}

// N: confirmation cancellation (the cancel path after a pending proposal).
{
  const { service, action } = await newAction();
  const cancelled = await service.cancel(action, actor.id);
  assert.equal(dispatchCount >= 0, true);
  const before = dispatchCount;
  const response = respond({ status: "answered", answer: "Cancelled. I did not send that device command.", metadata: { workflow_id: "wf-1", action_id: cancelled.action_id, workflow_status: "cancelled", action: conversationActionProjection(cancelled) } });
  assert.equal(dispatchCount, before, "cancellation must not dispatch");
  record("N", "N", "confirmation cancelled", response, "cancelled");
}

// O: restoration -- the persisted shape is execution.action, re-validated.
{
  const restored = sanitizeConversationAction(cases.find((c) => c.id === "D").restored_metadata.action);
  assert.equal(restored.status, "confirmed");
  console.log("PASS O thread restoration re-validates the persisted action");
}

// Adversarial: the boundary whitelist.
{
  assert.equal(sanitizeConversationAction({ action_id: "a", status: "success" }), null, "non-canonical status rejected");
  assert.equal(sanitizeConversationAction({ action_id: "a", status: "executed" }), null);
  assert.equal(sanitizeConversationAction({ status: "confirmed" }), null, "missing action_id rejected");
  const hostile = sanitizeConversationAction({
    action_id: "a1", status: "confirmed", requested_operation: "device.power.on", requested_state: true,
    target: { label: "Lamp", canonical_id: SENTINELS.canonical_id, home_id: SENTINELS.home_id },
    truth: { final_status: "state_confirmed", provider: SENTINELS.provider, safe_error_message: SENTINELS.safe_error_message, truth_state: "Robert'); DROP", retryable: "yes" },
    provider: SENTINELS.provider, evidence: [SENTINELS.payload], result: { raw: SENTINELS.payload },
  });
  assert.deepEqual(Object.keys(hostile).sort(), ["action_id", "requested_operation", "requested_state", "status", "target", "truth"]);
  assert.deepEqual(hostile.target, { label: "Lamp" });
  assert.deepEqual(hostile.truth, { final_status: "state_confirmed" });
  const leaked = JSON.stringify(respond({ status: "answered", answer: "x", metadata: { action: { action_id: "a1", status: "confirmed", provider: SENTINELS.provider, target: { canonical_id: SENTINELS.canonical_id } } } }));
  assert.equal(leaked.includes(SENTINELS.provider) || leaked.includes(SENTINELS.canonical_id), false);
  console.log("PASS adversarial whitelist");
}

const fixture = {
  contract: "oyi.conversation.execution.action",
  version: 1,
  generated_by: "Ochiga-backend scripts/oyi-action-truth-contract-smoke.mjs",
  canonical_statuses: OYI_ACTION_STATUSES,
  public_truth_fields: [...PUBLIC_DEVICE_COMMAND_TRUTH_FIELDS, "retryable"],
  cases,
};
const serialized = `${JSON.stringify(fixture, null, 2)}\n`;
if (WRITE) {
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, serialized);
  console.log(`WROTE ${path.relative(root, FIXTURE_PATH)} (${cases.length} cases)`);
} else {
  assert.ok(fs.existsSync(FIXTURE_PATH), "committed contract fixture missing (run with --write-fixture)");
  assert.equal(fs.readFileSync(FIXTURE_PATH, "utf8"), serialized, "committed contract fixture is stale: the runtime contract changed");
  console.log(`PASS committed fixture matches runtime (${cases.length} cases)`);
}
console.log("OYI ACTION TRUTH CONTRACT SMOKE PASSED");
// The device controller module keeps runtime timers/handles open.
process.exit(0);
