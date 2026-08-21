import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "milestone2-write-capabilities-smoke-service-role-key";

// Oyi Office Conversational Runtime, Milestone 2 — write capabilities:
// new (Automations pause/resume, Portfolio/Partnerships status
// transition) and extended (Meetings reschedule, Support assign/
// priority, Tasks priority). Same "no ConversationOrchestrator.js
// import in this process" discipline as phase4-batch-governed-proposals
// -smoke.mjs (see that file's header for why).
const {
  parseAutomationMutationIntent,
  isAutomationMutationMessage,
  parseMeetingMutationIntent,
  parseSupportMutationIntent,
  parsePortfolioMutationIntent,
  parsePartnershipMutationIntent,
  parseTaskMutationIntent,
  parseBatchTargetIntent,
} = await import("../dist/oyi-core/context/officeActionProposal.js");
const { buildOfficeActionCapabilities } = await import("../dist/oyi-core/capabilities/OfficeActionCapabilityModules.js");
const { buildOfficeInternalReadCapabilities } = await import("../dist/oyi-core/capabilities/OfficeCorporateCapabilityModules.js");

const actionModules = buildOfficeActionCapabilities();
const readModules = buildOfficeInternalReadCapabilities();
function actionModule(key) {
  const found = actionModules.find((m) => m.key === key);
  assert.ok(found, `${key} must be registered`);
  return found;
}
function readModule(key) {
  const found = readModules.find((m) => m.key === key);
  assert.ok(found, `${key} must be registered`);
  return found;
}

// ============================= Parsers =============================
assert.deepEqual(parseAutomationMutationIntent("pause this"), { operation: "pause", field: "enabled", rawValue: "pause", canonicalValue: false });
assert.deepEqual(parseAutomationMutationIntent("resume this"), { operation: "resume", field: "enabled", rawValue: "resume", canonicalValue: true });
assert.equal(parseAutomationMutationIntent("is this active"), null);
assert.equal(isAutomationMutationMessage("pause the second one"), true);

assert.deepEqual(parseMeetingMutationIntent("cancel this meeting"), { operation: "status_transition", field: "status", rawValue: "cancel", canonicalValue: "cancelled" });
const reschedule = parseMeetingMutationIntent("move the first one to 3pm");
assert.equal(reschedule.operation, "reschedule");
assert.ok(Date.parse(reschedule.canonicalValue), "must resolve a real ISO timestamp for a bare time-of-day phrase");
const rescheduleDay = parseMeetingMutationIntent("move this to Friday");
assert.equal(rescheduleDay.operation, "reschedule");
assert.ok(Date.parse(rescheduleDay.canonicalValue));

const resolveIntent = parseSupportMutationIntent("resolve this case - replaced the faulty sensor");
assert.equal(resolveIntent.operation, "resolve_case");
assert.equal(resolveIntent.resolutionNotes, "replaced the faulty sensor");
const assignIntent = parseSupportMutationIntent("assign those to Adoyi");
assert.deepEqual(assignIntent, { operation: "reassign_owner", field: "assigned_staff", rawValue: "Adoyi", canonicalValue: "Adoyi" });
const priorityIntent = parseSupportMutationIntent("make those high priority");
assert.deepEqual(priorityIntent, { operation: "change_priority", field: "priority", rawValue: "high priority", canonicalValue: "high" });

assert.deepEqual(parsePortfolioMutationIntent("mark this as normal"), { operation: "status_transition", field: "status", rawValue: "normal", canonicalValue: "normal" });
assert.equal(parsePortfolioMutationIntent("how is this doing"), null);

assert.deepEqual(parsePartnershipMutationIntent("move this to active"), { operation: "status_transition", field: "review_status", rawValue: "active", canonicalValue: "active" });

const taskPriority = parseTaskMutationIntent("make this high priority");
assert.deepEqual(taskPriority, { operation: "change_priority", field: "priority", rawValue: "high priority", canonicalValue: "high" });

// ======================= Mutual exclusion (3-way) =======================
function frame(domain, normalizedText) {
  return { domain, normalizedText };
}

{
  const write = actionModule("office_automations.write");
  const single = readModule("office_automations.read");
  const list = readModule("office_automations.query.read");
  const f = frame("automations", "pause the second one");
  assert.equal(write.supports(f), true);
  assert.equal(single.supports(f), false, "single-record read must not claim a mutation");
  assert.equal(list.supports(f), false, "list read must not claim a mutation, even though 'pause the automations' could otherwise look list-shaped");
  // Direct collision check: a message with BOTH the plural noun and a mutation verb.
  const collision = frame("automations", "pause the failed automations");
  assert.equal(write.supports(collision), true);
  assert.equal(list.supports(collision), false, "plural wording must not let the list module also claim a mutation message");
}

{
  const write = actionModule("office_meetings.write");
  const single = readModule("office_meetings.read");
  const list = readModule("office_meetings.query.read");
  const f = frame("office_meetings", "move the first one to 3pm");
  assert.equal(write.supports(f), true);
  assert.equal(single.supports(f), false);
  assert.equal(list.supports(f), false);
}

{
  const write = actionModule("office_support.write");
  const single = readModule("office_support.read");
  const list = readModule("office_support.query.read");
  for (const message of ["assign those to Adoyi", "make those high priority", "resolve this case - fixed it"]) {
    const f = frame("office_support", message);
    assert.equal(write.supports(f), true, `write must claim "${message}"`);
    assert.equal(single.supports(f), false, `single-record read must not claim "${message}"`);
    assert.equal(list.supports(f), false, `list read must not claim "${message}"`);
  }
}

{
  const write = actionModule("office_portfolio.write");
  const single = readModule("office_portfolio.read");
  const list = readModule("office_portfolio.query.read");
  const f = frame("office_portfolio", "mark this as normal");
  assert.equal(write.supports(f), true);
  assert.equal(single.supports(f), false);
  assert.equal(list.supports(f), false);
}

{
  const write = actionModule("office_partnerships.write");
  const single = readModule("office_partnerships.read");
  const list = readModule("office_partnerships.query.read");
  const f = frame("corporate_partnerships", "move this to active");
  assert.equal(write.supports(f), true);
  assert.equal(single.supports(f), false);
  assert.equal(list.supports(f), false);
}

{
  const write = actionModule("office_tasks.write");
  const single = readModule("office_tasks.read");
  const list = readModule("office_tasks.query.read");
  const f = frame("office_tasks", "make this high priority");
  assert.equal(write.supports(f), true);
  assert.equal(single.supports(f), false);
  assert.equal(list.supports(f), false);
}

// ======================= createDraft(): single-record honesty =======================
{
  const write = actionModule("office_automations.write");
  const noContext = { input: { message: "pause this", thread_id: "thread-1", context: {} }, actor: { id: "actor-1" } };
  const noContextDraft = await write.createDraft(noContext);
  assert.equal(noContextDraft.status, "unavailable");
  assert.ok(/specific automation open/i.test(noContextDraft.answer));

  const alreadyPaused = {
    input: { message: "pause this", thread_id: "thread-1", context: { automation_context: { automation_ref: "auto-1", name: "Weekly sweep", enabled: false, safe_summary: "x" } } },
    actor: { id: "actor-1" },
  };
  const alreadyPausedDraft = await write.createDraft(alreadyPaused);
  assert.equal(alreadyPausedDraft.status, "unavailable", "must never propose a no-op change");
  assert.ok(/already paused/i.test(alreadyPausedDraft.answer));

  const resumable = {
    input: { message: "pause this", thread_id: "thread-1", context: { automation_context: { automation_ref: "auto-1", name: "Weekly sweep", enabled: true, safe_summary: "x" } } },
    actor: { id: "actor-1" },
  };
  const proposalDraft = await write.createDraft(resumable);
  assert.equal(proposalDraft.status, "awaiting_confirmation");
  assert.ok(/pause "Weekly sweep"/i.test(proposalDraft.answer));
  const proposal = proposalDraft.metadata.pending_action_proposal;
  assert.equal(proposal.execute_directive.namespace, "automations");
  assert.equal(proposal.execute_directive.patch.enabled, false);
}

{
  const write = actionModule("office_portfolio.write");
  const invalidTransition = {
    input: {
      message: "mark this as completed",
      thread_id: "thread-1",
      context: { portfolio_context: { portfolio_ref: "pf-1", name: "Greenview Tower B", status: "attention", safe_summary: "x" } },
    },
    actor: { id: "actor-1" },
  };
  const draft = await write.createDraft(invalidTransition);
  assert.equal(draft.status, "unavailable", "attention -> completed is not a real transition and must be rejected pre-flight");

  const validTransition = {
    input: {
      message: "mark this as normal",
      thread_id: "thread-1",
      context: { portfolio_context: { portfolio_ref: "pf-1", name: "Greenview Tower B", status: "attention", safe_summary: "x" } },
    },
    actor: { id: "actor-1" },
  };
  const okDraft = await write.createDraft(validTransition);
  assert.equal(okDraft.status, "awaiting_confirmation");
  assert.equal(okDraft.metadata.pending_action_proposal.execute_directive.patch.status, "normal");
}

{
  const write = actionModule("office_partnerships.write");
  const context = {
    input: {
      message: "move this to active",
      thread_id: "thread-1",
      context: { partnership_context: { partnership_ref: "pt-1", organization_name: "Greenview Ltd", review_status: "under_review", safe_summary: "x" } },
    },
    actor: { id: "actor-1" },
  };
  const draft = await write.createDraft(context);
  assert.equal(draft.status, "awaiting_confirmation");
  assert.equal(draft.metadata.pending_action_proposal.execute_directive.patch.review_status, "active", "must patch review_status, not a nonexistent 'status' field");
}

{
  const write = actionModule("office_meetings.write");
  const context = {
    input: {
      message: "move this to 3pm",
      thread_id: "thread-1",
      context: { meeting_context: { meeting_ref: "meet-1", title: "Deployment review", status: "scheduled", scheduled_at: "2026-08-25T09:00:00.000Z", safe_summary: "x" } },
    },
    actor: { id: "actor-1" },
  };
  const draft = await write.createDraft(context);
  assert.equal(draft.status, "awaiting_confirmation");
  assert.ok(draft.metadata.pending_action_proposal.execute_directive.patch.scheduled_at, "reschedule must patch scheduled_at with a real ISO timestamp");
}

{
  const write = actionModule("office_support.write");
  const context = {
    input: {
      message: "assign this to Tony",
      thread_id: "thread-1",
      context: { support_context: { support_case_ref: "case-1", title: "Escalation", status: "open", assigned_staff: null, safe_summary: "x" } },
    },
    actor: { id: "actor-1" },
  };
  const draft = await write.createDraft(context);
  assert.equal(draft.status, "awaiting_confirmation");
  assert.equal(draft.metadata.pending_action_proposal.execute_directive.patch.assigned_staff, "Tony");
}

// ======================= createDraft(): batch =======================
{
  const write = actionModule("office_automations.write");
  const noResultSet = { input: { message: "pause all of them", thread_id: "thread-1", context: {} }, actor: { id: "actor-1" } };
  const draft = await write.createDraft(noResultSet);
  assert.equal(draft.status, "unavailable");
  assert.ok(/recent list of automations/i.test(draft.answer));
}

assert.deepEqual(parseBatchTargetIntent("pause all of them"), { type: "all" });

console.log("milestone2-write-capabilities-smoke: PASS");
