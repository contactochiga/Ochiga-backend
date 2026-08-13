import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase-c-local-smoke-only";

const workflows = await import("../dist/oyi-core/workflows/WorkflowService.js");
const workflowRepos = await import("../dist/oyi-core/workflows/WorkflowRepository.js");
const actions = await import("../dist/oyi-core/actions/ActionService.js");
const actionRepos = await import("../dist/oyi-core/actions/ActionRepository.js");

function turn(overrides = {}) {
  return {
    request_id: "request-1",
    correlation_id: "correlation-1",
    runtime_id: "runtime-1",
    thread_id: "11111111-1111-4111-8111-111111111111",
    actor: { id: "22222222-2222-4222-8222-222222222222", role: "resident", permissions: ["devices.control"] },
    semantic_frame: { operation: "device.power.off", domain: "devices", normalizedText: "turn off living room light", confidence: 0.91, temporalScope: { mode: "current" } },
    operation: "device.power.off",
    capability_key: "devices.power.control",
    domain: "devices",
    scope: { estate_id: "33333333-3333-4333-8333-333333333333", building_id: null, home_id: "44444444-4444-4444-8444-444444444444", room_id: "55555555-5555-4555-8555-555555555555" },
    target: { object_type: "device_channel", canonical_id: "device-1", label: "3Gang Living room", channel_code: "switch_2", home_id: "44444444-4444-4444-8444-444444444444", room_id: "55555555-5555-4555-8555-555555555555" },
    target_source: "current_turn",
    active_workflow_id: null,
    authority: { allowed: true, tier: 1, approval_required: true, secure_review_required: false, required_permissions: ["devices.control"], denial_reason: null },
    temporal_scope: { mode: "current" },
    presentation_policy: { primary: "approval" },
    context: { surface: "consumer" },
    ...overrides,
  };
}

const workflowRepository = new workflowRepos.InMemoryWorkflowRepository();
const actionRepository = new actionRepos.InMemoryActionRepository();
const workflowService = new workflows.WorkflowService(workflowRepository);
const actionService = new actions.ActionService(actionRepository);

const created = await workflowService.create(turn(), "awaiting_clarification", { unresolved_inputs: ["target"] });
assert.equal(created.status, "awaiting_clarification");
assert.equal(created.revision, 1);

const restoredFromThread = await workflowService.restoreActive({ threadId: created.thread_id, actorId: created.actor_id });
assert.equal(restoredFromThread.workflow_id, created.workflow_id);

const withInput = await workflowService.saveInput(restoredFromThread, { input_key: "target", value: { id: "device-1" }, validated: true });
assert.equal(withInput.revision, 2);
assert.equal(withInput.inputs.target.validated, true);

const ready = await workflowService.transition(withInput, "ready_for_review", { unresolved_inputs: [] });
const awaitingApproval = await workflowService.transition(ready, "awaiting_approval");
assert.equal(awaitingApproval.status, "awaiting_approval");

const action = await actionService.create({
  workflow: awaitingApproval,
  actorId: awaitingApproval.actor_id,
  target: turn().target,
  requestedOperation: "device.power.off",
  requestedState: false,
});
const same = await actionService.create({
  workflow: awaitingApproval,
  actorId: awaitingApproval.actor_id,
  target: turn().target,
  requestedOperation: "device.power.off",
  requestedState: false,
});
assert.equal(same.action_id, action.action_id, "idempotent equivalent action is reused");

const attached = await workflowService.attachAction(awaitingApproval, action.action_id);
assert.equal(attached.action_id, action.action_id);

const cancelledAction = await actionService.cancel(action, awaitingApproval.actor_id);
const cancelledWorkflow = await workflowService.cancel(attached);
assert.equal(cancelledAction.status, "cancelled");
assert.equal(cancelledWorkflow.status, "cancelled");

const freshWorkflow = await workflowService.create(turn({ request_id: "request-2" }), "awaiting_approval");
const freshAction = await actionService.create({
  workflow: freshWorkflow,
  actorId: freshWorkflow.actor_id,
  target: turn().target,
  requestedOperation: "device.power.on",
  requestedState: true,
});
const approved = await actionService.approve(freshAction, freshWorkflow.actor_id);
let executorCalls = 0;
const fakeAdapter = {
  domain: "devices",
  async execute(inputAction) {
    executorCalls += 1;
    return {
      status: "provider_accepted",
      executor_reference: { execution_id: `fake:${inputAction.action_id}` },
      result: { provider: "fake", accepted: true },
      evidence: [{ type: "fake_provider_acceptance", evidence_id: `fake:${inputAction.action_id}` }],
    };
  },
  async verify(inputAction, execution) {
    return {
      ...execution,
      status: "confirmed",
      result: { ...execution.result, state_confirmed: true, action_id: inputAction.action_id },
      evidence: [{ type: "fake_state_confirmation", evidence_id: `verified:${inputAction.action_id}` }],
    };
  },
};
const executed = await actionService.executeWithAdapter(approved, fakeAdapter);
assert.equal(executed.status, "confirmed");
assert.equal(executorCalls, 1);
assert.equal(executed.executor_reference.execution_id, `fake:${approved.action_id}`);

const conflictWorkflow = await workflowService.create(turn({ request_id: "request-3" }), "awaiting_approval");
const firstTransition = await workflowService.transition(conflictWorkflow, "cancelled");
assert.equal(firstTransition.status, "cancelled");
await assert.rejects(
  () => workflowRepository.save({ ...conflictWorkflow, status: "expired", revision: conflictWorkflow.revision + 1 }, { expectedRevision: conflictWorkflow.revision }),
  /Workflow revision conflict/,
);

const supersededWorkflow = await workflowService.create(turn({ request_id: "request-4" }), "awaiting_approval");
const superseded = await workflowService.supersede(supersededWorkflow, "opposite_request");
assert.equal(superseded.status, "superseded");

const expiringWorkflow = await workflowService.create(turn({ request_id: "request-5" }), "awaiting_approval", { expires_at: new Date(Date.now() - 1000).toISOString() });
const expired = await workflowService.expire(expiringWorkflow);
assert.equal(expired.status, "expired");

const restoredAfterServiceRestart = new workflows.WorkflowService(workflowRepository);
const stillRestored = await restoredAfterServiceRestart.restoreActive({ threadId: freshWorkflow.thread_id, actorId: freshWorkflow.actor_id });
assert.equal(stillRestored.workflow_id, freshWorkflow.workflow_id, "repository-backed workflow survives service re-instantiation");

console.log("oyi-workflow-action-phase-c-smoke passed");
