import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase4-nl-scheduling-handoff-smoke-service-role-key";

// Oyi Conversational Runtime Completion Programme, Phase 4, PR 6 — NL
// scheduling handoff. Pure-function coverage: parsing, suggestion
// parameter shape, and toolProposals()'s wiring -- all Supabase-free
// (corporateOfficeInternalPolicy.ts must stay that way; see
// officeAutomationSuggestion.ts's header comment on why the DB-touching
// loader lives in a separate file).
const {
  parseAutomationScheduleIntent,
  automationScheduleSuggestionParameters,
  automationSuggestionProposalId,
  buildLastVerifiedOfficeAction,
} = await import("../dist/oyi-core/context/officeAutomationSuggestion.js");
const { buildOfficeInternalResponse } = await import("../dist/oyi-core/policy/corporateOfficeInternalPolicy.js");

// --- parseAutomationScheduleIntent: narrow, requires "do that/this every <weekday>" ---
assert.deepEqual(parseAutomationScheduleIntent("Do that every Friday"), { weekday: 5, weekdayName: "Friday" });
assert.deepEqual(parseAutomationScheduleIntent("do this every monday"), { weekday: 1, weekdayName: "Monday" });
assert.equal(parseAutomationScheduleIntent("we meet every Friday"), null, "an unrelated weekly cadence must not misfire");
assert.equal(parseAutomationScheduleIntent("every Friday"), null, "missing the referring word must not match");
assert.equal(parseAutomationScheduleIntent("do that every week"), null, "a non-weekday word must not match");

// --- buildLastVerifiedOfficeAction: pure, no DB ---
const proposal = {
  domain: "office_tasks", operation: "change_due_date", target_entity_type: "task", target_entity_id: "task-1",
};
const lastAction = buildLastVerifiedOfficeAction(proposal, "Follow up with vendor", 'move the due date to Tue Aug 25 2026 for "Follow up with vendor"');
assert.equal(lastAction.domain, "office_tasks");
assert.equal(lastAction.target_label, "Follow up with vendor");
assert.ok(Date.parse(lastAction.verified_at) <= Date.now());

// --- automationScheduleSuggestionParameters: real, wizard-consumable trigger ---
const scheduleIntent = { weekday: 5, weekdayName: "Friday" };
const params = automationScheduleSuggestionParameters(scheduleIntent, lastAction);
assert.equal(params.suggested_schedule.schedule_type, "weekdays");
assert.deepEqual(params.suggested_schedule.weekdays, [5]);
assert.ok(params.suggested_name.includes("Friday"));
assert.ok(params.suggested_name.includes("Follow up with vendor"));

assert.ok(automationSuggestionProposalId("req-123").includes("req-123"));

// --- toolProposals() wiring via buildOfficeInternalResponse ---
const requestBase = {
  request_id: "req-schedule-1",
  office_session_id: "session-1",
  staff: { role: "ochiga_staff" },
  page_context: { selected_type: "task", selected_id: "task-1" },
  business_unit: "corporate",
};
const canonicalBase = { id: "c1", thread_id: null, intent: "office_internal_conversation", message: "Understood.", persistence_saved: true };

// No last-verified action on record -> no automation proposal fabricated.
const noReferenceResponse = buildOfficeInternalResponse({ ...requestBase, message: "Do that every Friday" }, canonicalBase, null);
assert.ok(
  !noReferenceResponse.tool_proposals.some((p) => p.tool === "office.create_automation"),
  "must never suggest an automation with nothing real to reference"
);

// A fresh last-verified action -> the prefilled suggestion, trigger only.
const scheduleResponse = buildOfficeInternalResponse({ ...requestBase, message: "Do that every Friday" }, canonicalBase, lastAction);
const automationProposal = scheduleResponse.tool_proposals.find((p) => p.tool === "office.create_automation");
assert.ok(automationProposal, "a fresh last-verified action must produce the office.create_automation suggestion");
assert.equal(automationProposal.governance, "office_validates_before_execution", "still governed, never auto-created");
assert.equal(automationProposal.parameters.suggested_schedule.schedule_type, "weekdays");
assert.deepEqual(automationProposal.parameters.suggested_schedule.weekdays, [5]);
assert.equal(automationProposal.parameters.review_required, true);
assert.equal(scheduleResponse.tool_proposals.length, 1, "must not ALSO fire the generic automation-detection proposal for the same message");

// The generic automation-detection path is untouched for ordinary phrasing.
const genericResponse = buildOfficeInternalResponse({ ...requestBase, message: "set up a rule for this" }, canonicalBase, null);
assert.ok(genericResponse.tool_proposals.some((p) => p.tool === "office.create_automation"));
assert.equal(genericResponse.tool_proposals.find((p) => p.tool === "office.create_automation").parameters.suggested_schedule, undefined, "the generic path must not fabricate a schedule it wasn't given");

console.log("phase4-nl-scheduling-handoff-smoke: PASS");
