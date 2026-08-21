import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase4-revision-lifecycle-smoke-service-role-key";

// Oyi Conversational Runtime Completion Programme, Phase 4, PR 5 —
// Revision accumulation + lifecycle precision. Pure-function coverage
// only (parsing, proposal-merge arithmetic, description building,
// policy regex fix) -- never calls createDraft() in this process, so
// it doesn't hit the pre-existing Redis-reconnect side effect
// documented in phase4-batch-governed-proposals-smoke.mjs's header.
const {
  parseTaskMutationIntent,
  buildGovernedActionProposal,
  mergeTaskRevisionIntoProposal,
} = await import("../dist/oyi-core/context/officeActionProposal.js");
const { officeProposalFieldsAndValues } = await import("../dist/oyi-core/orchestration/ConversationOrchestrator.js");
const { buildOfficeInternalResponse } = await import("../dist/oyi-core/policy/corporateOfficeInternalPolicy.js");

// --- parseTaskAssigneeIntent broadened to accept "give" (needed for
// "and give it to Tony" style revision additions) ---
assert.equal(parseTaskMutationIntent("give it to Tony").canonicalValue, "Tony");
assert.equal(parseTaskMutationIntent("and give it to Tony").canonicalValue, "Tony");
assert.equal(parseTaskMutationIntent("give this task to Tony").canonicalValue, "Tony");
assert.equal(parseTaskMutationIntent("assign this to Tony").canonicalValue, "Tony", "pre-existing phrasing must still work");

// --- mergeTaskRevisionIntoProposal: accumulates fields, doesn't replace ---
const base = buildGovernedActionProposal({
  threadId: "thread-1", actorId: "actor-1", domain: "office_tasks", targetEntityType: "task", targetEntityId: "task-1",
  operation: "change_due_date", field: "due_at", rawValue: "Tuesday", canonicalValue: "2026-08-25T12:00:00.000Z",
  description: 'Ready to move "Follow up with vendor"\'s due date to Tue Aug 25 2026.',
  previousState: { due_at: null },
  authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
  validation: { valid: true, reason: null }, riskLevel: "low_risk_action",
  executeDirective: { namespace: "crm", collection: "tasks", record_id: "task-1", patch: { due_at: "2026-08-25T12:00:00.000Z" } },
});
const ownerIntent = parseTaskMutationIntent("and give it to Tony");
const merged = mergeTaskRevisionIntoProposal(base, ownerIntent, "combined description placeholder");

assert.equal(merged.proposed_state.due_at, "2026-08-25T12:00:00.000Z", "the FIRST revision must survive a second one");
assert.equal(merged.proposed_state.assignee, "Tony", "the SECOND revision must be added");
assert.equal(merged.execute_directive.patch.due_at, "2026-08-25T12:00:00.000Z");
assert.equal(merged.execute_directive.patch.assignee, "Tony");
assert.equal(merged.parameters.fields.due_at.canonical_value, "2026-08-25T12:00:00.000Z");
assert.equal(merged.parameters.fields.assignee.canonical_value, "Tony");
assert.ok(Date.parse(merged.expires_at) > Date.now(), "revising must refresh the TTL");

// --- officeProposalFieldsAndValues: plural, all entries ---
const fields = officeProposalFieldsAndValues(merged);
assert.equal(fields.length, 2);
assert.ok(fields.some((f) => f.field === "due_at" && f.value === "2026-08-25T12:00:00.000Z"));
assert.ok(fields.some((f) => f.field === "assignee" && f.value === "Tony"));

// A never-merged (single-field) proposal still returns exactly one entry.
assert.equal(officeProposalFieldsAndValues(base).length, 1);

// --- Milestone 2: mergeTaskRevisionIntoProposal now also accumulates
// previous_state, not just proposed_state -- the known Milestone 1 gap
// where a field added by a LATER revision had no "before" value at all,
// so the multi-field diff card had nothing to show on that side. The
// currentValue param captures it once, from the live context slot, the
// first time that field is touched. ---
assert.equal(merged.previous_state.due_at, null, "the original proposal's own previous_state entry is preserved");
assert.equal(merged.previous_state.assignee, null, "no currentValue was passed for the assignee merge above -- must record null, never fabricate a value");

const mergedWithCurrent = mergeTaskRevisionIntoProposal(base, parseTaskMutationIntent("make this high priority"), "desc", "medium");
assert.equal(mergedWithCurrent.previous_state.priority, "medium", "a real currentValue must be captured into previous_state on first mention");
assert.equal(mergedWithCurrent.proposed_state.priority, "high");

// Merging the SAME field a second time must not overwrite an
// already-captured previous_state (that would silently lose the
// genuine "before" and replace it with an intermediate value).
const mergedTwice = mergeTaskRevisionIntoProposal(mergedWithCurrent, parseTaskMutationIntent("actually make it low priority"), "desc2", "high");
assert.equal(mergedTwice.previous_state.priority, "medium", "previous_state must not be overwritten by a second revision to the same field");
assert.equal(mergedTwice.proposed_state.priority, "low", "proposed_state must still reflect the latest revision");

// --- corporateOfficeInternalPolicy: Phase 3 gap #2 fix -- "Due" substring must not fire the follow-up proposal ---
const requestBase = {
  request_id: "req-1",
  message: "Is this on track?",
  office_session_id: "session-1",
  staff: { role: "ochiga_staff" },
  page_context: { selected_type: "task", selected_id: "task-1" },
  business_unit: "corporate",
};
const onTimeResponse = buildOfficeInternalResponse(
  { ...requestBase, task_context: { safe_summary: "Vendor check-in. Due: Aug 20, on track.", task_ref: "task-1" } },
  { id: "c1", thread_id: null, intent: "office_internal_conversation", message: "It's on track.", persistence_saved: true }
);
assert.equal(onTimeResponse.attention_signal, "none", 'a due-but-not-overdue task summary must not raise "follow_up" attention');
assert.ok(
  !onTimeResponse.tool_proposals.some((p) => p.tool === "office.create_followup_task"),
  'a due-but-not-overdue task summary must not fire office.create_followup_task on its own'
);

const overdueResponse = buildOfficeInternalResponse(
  { ...requestBase, task_context: { safe_summary: "Vendor check-in. This is overdue by 3 days.", task_ref: "task-1" } },
  { id: "c2", thread_id: null, intent: "office_internal_conversation", message: "It's on track.", persistence_saved: true }
);
assert.equal(overdueResponse.attention_signal, "follow_up", "a genuinely overdue task summary must still raise follow_up attention");
assert.ok(
  overdueResponse.tool_proposals.some((p) => p.tool === "office.create_followup_task"),
  "a genuinely overdue task summary must still fire office.create_followup_task"
);

console.log("phase4-revision-lifecycle-smoke: PASS");
// ConversationOrchestrator.js's import graph leaves a lingering handle
// open (a pre-existing Redis client, not touched by this test) that
// otherwise keeps the process alive after every assertion has passed.
process.exit(0);
