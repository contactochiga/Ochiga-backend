import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase4-batch-governed-proposals-smoke-service-role-key";

// Oyi Conversational Runtime Completion Programme, Phase 4, PR 4 — Batch
// governed proposals, part 1: parsing, contract shape, capability-level
// mutual exclusion, and createDraft() behavior. Deliberately does NOT
// import ConversationOrchestrator.js in this process -- doing so
// alongside a direct createDraft() call on a capability module triggers
// an unrelated pre-existing module-load side effect (a Redis client
// with an unbounded reconnect loop, used by other parts of the runtime
// this smoke doesn't exercise) that hangs the process indefinitely.
// Confirmed by direct bisection: importing ConversationOrchestrator.js
// alone, or calling createDraft() without it, are both fine in
// isolation -- only the combination hangs. The confirm/verify
// arithmetic those orchestrator-level functions implement is covered
// separately in phase4-batch-verification-arithmetic-smoke.mjs, which
// imports ConversationOrchestrator.js but never calls createDraft().
const {
  parseBatchTargetIntent,
  parseBatchMutationIntent,
  isTaskMutationMessage,
  buildGovernedActionProposal,
  buildBatchGovernedActionProposal,
  proposalPublicView,
} = await import("../dist/oyi-core/context/officeActionProposal.js");
const { buildOfficeActionCapabilities } = await import("../dist/oyi-core/capabilities/OfficeActionCapabilityModules.js");
const { buildOfficeInternalReadCapabilities } = await import("../dist/oyi-core/capabilities/OfficeCorporateCapabilityModules.js");

// --- parseBatchTargetIntent ---
assert.deepEqual(parseBatchTargetIntent("Move the first two to Monday"), { type: "count", count: 2 });
assert.deepEqual(parseBatchTargetIntent("move the first 3 to done"), { type: "count", count: 3 });
assert.deepEqual(parseBatchTargetIntent("assign all of them to Tony"), { type: "all" });
assert.deepEqual(parseBatchTargetIntent("cancel everything"), { type: "all" });
assert.equal(parseBatchTargetIntent("move this to in progress"), null, "a single-record message must never match a batch target");
assert.equal(parseBatchTargetIntent("show me my overdue tasks"), null);

// --- parseBatchMutationIntent (direct pass-through + lenient due-date fallback) ---
assert.deepEqual(parseBatchMutationIntent("move the first two to in progress"), {
  operation: "status_transition", field: "status", rawValue: "in progress", canonicalValue: "in_progress",
});
assert.equal(parseBatchMutationIntent("assign these to Tony").canonicalValue, "Tony");
assert.equal(parseBatchMutationIntent("reassign them to Adoyi").canonicalValue, "Adoyi");
const dueIntent = parseBatchMutationIntent("move the first two to Monday");
assert.equal(dueIntent.operation, "change_due_date");
assert.ok(dueIntent.canonicalValue, "must resolve a real ISO date for a weekday phrase");
assert.equal(parseBatchMutationIntent("show me my overdue tasks"), null, "a non-mutation message must never be misread as a due-date change");

// --- isTaskMutationMessage (mutual exclusion source of truth) ---
assert.equal(isTaskMutationMessage("move this to in progress"), true);
assert.equal(isTaskMutationMessage("move the first two to Monday"), true, "batch due-date phrasing must count as a mutation");
assert.equal(isTaskMutationMessage("show me my overdue tasks"), false);
assert.equal(isTaskMutationMessage("is this task overdue"), false);

// --- Capability-level mutual exclusion: batch messages claimed by write only ---
const actionModules = buildOfficeActionCapabilities();
const readModules = buildOfficeInternalReadCapabilities();
const tasksWrite = actionModules.find((m) => m.key === "office_tasks.write");
const tasksRead = readModules.find((m) => m.key === "office_tasks.read");
const tasksQueryRead = readModules.find((m) => m.key === "office_tasks.query.read");
const batchFrame = { domain: "office_tasks", normalizedText: "move the first two to monday" };
assert.equal(tasksWrite.supports(batchFrame), true);
assert.equal(tasksRead.supports(batchFrame), false, "single-record read module must not claim a batch mutation");
assert.equal(tasksQueryRead.supports(batchFrame), false, "list module must not claim a batch mutation");

// --- createDraft(): batch branch with no prior result set is honest, not broken ---
const batchContext = {
  input: { message: "Move the first two to Monday", thread_id: "thread-1", context: {} },
  actor: { id: "actor-1" },
};
const batchDraft = await tasksWrite.createDraft(batchContext);
assert.equal(batchDraft.status, "unavailable");
assert.ok(/recent list of tasks/i.test(batchDraft.answer), "must ask for a list turn first, never fabricate a target");

// --- createDraft(): single-record path is unchanged by the new batch branch ---
const singleContext = {
  input: {
    message: "move this to in progress",
    thread_id: "thread-1",
    context: { task_context: { task_ref: "task-1", title: "Follow up with vendor", status: "open", safe_summary: "x" } },
  },
  actor: { id: "actor-1" },
};
const singleDraft = await tasksWrite.createDraft(singleContext);
assert.equal(singleDraft.status, "awaiting_confirmation");
assert.equal(singleDraft.metadata.pending_action_proposal.target_entity_id, "task-1");
assert.equal(singleDraft.metadata.pending_action_proposal.child_operations, null);

// --- Batch proposal contract shape (parent + children, execute_directive withheld until confirmed) ---
function childProposal(id, label, dueIso) {
  return buildGovernedActionProposal({
    threadId: "thread-1",
    actorId: "actor-1",
    domain: "office_tasks",
    targetEntityType: "task",
    targetEntityId: id,
    operation: "change_due_date",
    field: "due_at",
    rawValue: "Monday",
    canonicalValue: dueIso,
    description: `Move "${label}"'s due date to Monday.`,
    previousState: { due_at: null },
    authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
    validation: { valid: true, reason: null },
    riskLevel: "low_risk_action",
    executeDirective: { namespace: "crm", collection: "tasks", record_id: id, patch: { due_at: dueIso } },
  });
}
const dueIso = "2026-08-24T12:00:00.000Z";
const child1 = childProposal("task-1", "Follow up with vendor", dueIso);
const child2 = childProposal("task-2", "Prepare site report", dueIso);
const parent = buildBatchGovernedActionProposal({
  threadId: "thread-1",
  actorId: "actor-1",
  domain: "office_tasks",
  operation: "change_due_date",
  description: 'Ready to move the due date to Mon Aug 24 2026 for 2 tasks: "Follow up with vendor", "Prepare site report".',
  riskLevel: "low_risk_action",
  children: [child1, child2],
});

assert.equal(parent.status, "pending");
assert.equal(parent.target_entity_id, "batch");
assert.equal(parent.execute_directive, null);
assert.equal(parent.child_operations.length, 2);

const pendingView = proposalPublicView(parent);
assert.equal(pendingView.execute_directive, null);
assert.equal(pendingView.child_operations[0].execute_directive, null, "a pending batch must not leak a child's execute_directive early");
assert.equal(pendingView.child_operations[1].execute_directive, null);

console.log("phase4-batch-governed-proposals-smoke: PASS");
