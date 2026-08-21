import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase4-batch-verification-arithmetic-smoke-service-role-key";

// Oyi Conversational Runtime Completion Programme, Phase 4, PR 4 — Batch
// governed proposals, part 2: the confirm/verify arithmetic
// respondFromBatchVerification (ConversationOrchestrator.ts) actually
// uses. Kept in its own process/script, importing ONLY
// ConversationOrchestrator.js and never calling createDraft() on any
// capability -- see phase4-batch-governed-proposals-smoke.mjs's header
// comment for why that specific combination hangs (an unrelated
// pre-existing Redis reconnect side effect, not something this PR
// introduced).
const {
  officeProposalFieldAndValue,
  officeProposalValuesMatch,
  OFFICE_PROPOSAL_FIELD_TO_CONTEXT_FIELD,
  confirmProposalTree,
} = await import("../dist/oyi-core/orchestration/ConversationOrchestrator.js");
const { buildGovernedActionProposal, buildBatchGovernedActionProposal, proposalPublicView } = await import(
  "../dist/oyi-core/context/officeActionProposal.js"
);

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
  description: "Ready to move the due date to Mon Aug 24 2026 for 2 tasks.",
  riskLevel: "low_risk_action",
  children: [child1, child2],
});

// Confirm: parent AND every child flip to confirmed, directives now visible.
const confirmed = confirmProposalTree(parent);
assert.equal(confirmed.status, "confirmed");
assert.equal(confirmed.child_operations[0].status, "confirmed");
assert.equal(confirmed.child_operations[1].status, "confirmed");
const confirmedView = proposalPublicView(confirmed);
assert.equal(confirmedView.child_operations[0].execute_directive.record_id, "task-1");
assert.equal(confirmedView.child_operations[1].execute_directive.record_id, "task-2");

// The exact per-child comparison respondFromBatchVerification uses.
function verifyChild(child, observedEntry) {
  const proposedField = officeProposalFieldAndValue(child);
  const contextFieldKey = proposedField ? (OFFICE_PROPOSAL_FIELD_TO_CONTEXT_FIELD[proposedField.field] || proposedField.field) : null;
  const observed = observedEntry && contextFieldKey ? observedEntry[contextFieldKey] : undefined;
  return Boolean(observedEntry && proposedField && officeProposalValuesMatch(proposedField.field, proposedField.value, observed));
}

// Full success: both children's PATCH responses reflect the proposed due date.
assert.equal(verifyChild(confirmed.child_operations[0], { task_ref: "task-1", due_at: dueIso }), true);
assert.equal(verifyChild(confirmed.child_operations[1], { task_ref: "task-2", due_at: dueIso }), true);

// Partial success: task-2's PATCH silently didn't take (stale due date) -- must report false, never assume success.
assert.equal(verifyChild(confirmed.child_operations[1], { task_ref: "task-2", due_at: "2020-01-01T00:00:00.000Z" }), false);

// No matching entry at all (client-side PATCH call itself failed) -- must count as unverified, not crash.
assert.equal(verifyChild(confirmed.child_operations[0], undefined), false);

// owner field mapping (assignee -> owner) also holds for batch children.
const ownerChild = buildGovernedActionProposal({
  threadId: "thread-1", actorId: "actor-1", domain: "office_tasks", targetEntityType: "task", targetEntityId: "task-3",
  operation: "reassign_owner", field: "assignee", rawValue: "Tony", canonicalValue: "Tony",
  description: 'Assign "Prepare site report" to Tony.', previousState: { assignee: null },
  authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
  validation: { valid: true, reason: null }, riskLevel: "consequential_action",
  executeDirective: { namespace: "crm", collection: "tasks", record_id: "task-3", patch: { assignee: "Tony" } },
});
assert.equal(verifyChild(ownerChild, { task_ref: "task-3", owner: "Tony" }), true);
assert.equal(verifyChild(ownerChild, { task_ref: "task-3", owner: "Someone Else" }), false);

console.log("phase4-batch-verification-arithmetic-smoke: PASS");
// ConversationOrchestrator.js's import graph leaves a lingering handle
// open (a pre-existing Redis client used elsewhere in the runtime, not
// touched by this test) that otherwise keeps the process alive
// indefinitely after every assertion has already passed.
process.exit(0);
