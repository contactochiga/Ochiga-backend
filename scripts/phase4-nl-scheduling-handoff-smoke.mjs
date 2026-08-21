import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase4-nl-scheduling-handoff-smoke-service-role-key";

// Oyi Conversational Runtime Completion Programme, Phase 4, PR 6 — NL
// scheduling handoff. Widened in Milestone 2 to cover daily/weekly/
// monthly cadence phrasing (not just weekday), still referent-gated
// (that/this/it) so ordinary mentions of a cadence never misfire.
// Pure-function coverage: parsing, suggestion parameter shape, and
// toolProposals()'s wiring -- all Supabase-free (corporateOfficeInternalPolicy.ts
// must stay that way; see officeAutomationSuggestion.ts's header
// comment on why the DB-touching loader lives in a separate file).
const {
  parseAutomationScheduleIntent,
  isAutomationScheduleOrRecurrenceMessage,
  automationScheduleSuggestionParameters,
  automationSuggestionProposalId,
  buildLastVerifiedOfficeAction,
} = await import("../dist/oyi-core/context/officeAutomationSuggestion.js");
const { buildOfficeInternalResponse } = await import("../dist/oyi-core/policy/corporateOfficeInternalPolicy.js");

// --- parseAutomationScheduleIntent: weekday cadence (existing) ---
assert.deepEqual(parseAutomationScheduleIntent("Do that every Friday"), { cadence: "weekday", weekday: 5, weekdayName: "Friday" });
assert.deepEqual(parseAutomationScheduleIntent("do this every monday"), { cadence: "weekday", weekday: 1, weekdayName: "Monday" });
assert.equal(parseAutomationScheduleIntent("we meet every Friday"), null, "an unrelated weekly cadence must not misfire");
assert.equal(parseAutomationScheduleIntent("every Friday"), null, "missing the referring word must not match");

// --- parseAutomationScheduleIntent: daily/weekly/monthly cadence (Milestone 2) ---
assert.deepEqual(parseAutomationScheduleIntent("do that every day"), { cadence: "daily" });
assert.deepEqual(parseAutomationScheduleIntent("repeat this daily"), { cadence: "daily" });
assert.deepEqual(parseAutomationScheduleIntent("keep doing this every day"), { cadence: "daily" });
assert.deepEqual(parseAutomationScheduleIntent("repeat this weekly"), { cadence: "weekly" });
assert.deepEqual(parseAutomationScheduleIntent("keep doing this each week"), { cadence: "weekly" });
assert.deepEqual(parseAutomationScheduleIntent("make this recurring"), { cadence: "weekly" });
assert.deepEqual(parseAutomationScheduleIntent("run that monthly"), { cadence: "monthly" });
assert.deepEqual(parseAutomationScheduleIntent("repeat this every month"), { cadence: "monthly" });
assert.equal(parseAutomationScheduleIntent("we run reports monthly"), null, "missing the referring word must still not match for the new cadences");
assert.deepEqual(parseAutomationScheduleIntent("from now on do this every Monday"), { cadence: "weekday", weekday: 1, weekdayName: "Monday" }, "a leading qualifier before the recognized phrase must not break the match");

// --- isAutomationScheduleOrRecurrenceMessage: broader net used to guard read capabilities ---
assert.equal(isAutomationScheduleOrRecurrenceMessage("Do that every Friday"), true);
assert.equal(isAutomationScheduleOrRecurrenceMessage("whenever a new qualified lead arrives, create a follow-up"), true, "generic recurrence phrasing must also be recognized even without a narrow schedule-intent match");
assert.equal(isAutomationScheduleOrRecurrenceMessage("set up a rule for this"), true);
assert.equal(isAutomationScheduleOrRecurrenceMessage("is this task overdue"), false, "an ordinary question must not be swept up by the guard");

// --- buildLastVerifiedOfficeAction: pure, no DB ---
const proposal = {
  domain: "office_tasks", operation: "change_due_date", target_entity_type: "task", target_entity_id: "task-1",
};
const lastAction = buildLastVerifiedOfficeAction(proposal, "Follow up with vendor", 'move the due date to Tue Aug 25 2026 for "Follow up with vendor"');
assert.equal(lastAction.domain, "office_tasks");
assert.equal(lastAction.target_label, "Follow up with vendor");
assert.ok(Date.parse(lastAction.verified_at) <= Date.now());

// --- automationScheduleSuggestionParameters: real, wizard-consumable trigger ---
const weekdayParams = automationScheduleSuggestionParameters({ cadence: "weekday", weekday: 5, weekdayName: "Friday" }, lastAction);
assert.equal(weekdayParams.suggested_schedule.schedule_type, "weekdays");
assert.deepEqual(weekdayParams.suggested_schedule.weekdays, [5]);
assert.ok(weekdayParams.suggested_name.includes("Friday"));
assert.ok(weekdayParams.suggested_name.includes("Follow up with vendor"));

const dailyParams = automationScheduleSuggestionParameters({ cadence: "daily" }, lastAction);
assert.equal(dailyParams.suggested_schedule.schedule_type, "daily", "daily is a real, wizard-supported schedule_type and must be fully prefilled");
assert.ok(dailyParams.suggested_name.includes("every day"));

const weeklyParams = automationScheduleSuggestionParameters({ cadence: "weekly" }, lastAction);
assert.equal(weeklyParams.suggested_schedule.schedule_type, "weekdays");
assert.deepEqual(weeklyParams.suggested_schedule.weekdays, [], "an unspecified weekly cadence must leave the day blank rather than inventing one");

const monthlyParams = automationScheduleSuggestionParameters({ cadence: "monthly" }, lastAction);
assert.equal(monthlyParams.suggested_schedule, undefined, "monthly has no real schedule_type in this system -- must never fabricate one");
assert.ok(monthlyParams.suggested_name.includes("every month"));

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

// Monthly cadence -> the automation proposal still fires (it's a real
// recurrence reference) but carries a limitation note and no fabricated schedule.
const monthlyResponse = buildOfficeInternalResponse({ ...requestBase, message: "run that monthly" }, canonicalBase, lastAction);
const monthlyProposal = monthlyResponse.tool_proposals.find((p) => p.tool === "office.create_automation");
assert.ok(monthlyProposal, "a monthly recurrence reference must still produce a proposal card, just without a fabricated schedule");
assert.equal(monthlyProposal.parameters.suggested_schedule, undefined);
assert.ok(/monthly recurrence isn.t available/i.test(monthlyProposal.reason), "the reason text must honestly disclose the unsupported cadence");

// The generic automation-detection path is untouched for ordinary phrasing.
const genericResponse = buildOfficeInternalResponse({ ...requestBase, message: "set up a rule for this" }, canonicalBase, null);
assert.ok(genericResponse.tool_proposals.some((p) => p.tool === "office.create_automation"));
assert.equal(genericResponse.tool_proposals.find((p) => p.tool === "office.create_automation").parameters.suggested_schedule, undefined, "the generic path must not fabricate a schedule it wasn't given");

// --- Milestone 2: the NL scheduling handoff was never Tasks-specific
// at this layer (buildLastVerifiedOfficeAction/toolProposals both key
// off proposal.domain/operation generically) -- confirm it composes
// correctly end to end for a genuinely different domain now that
// Automations/Meetings/Support/Portfolio/Partnerships all confirm
// through the same pipeline (ConversationOrchestrator.ts's
// handleOfficeActionProposalTurn). "Pause this" on an automation,
// confirmed and verified, followed by "do that every Friday" must
// reference the automation pause, not a task. ---
const automationProposal2 = {
  domain: "automations", operation: "pause", target_entity_type: "automation", target_entity_id: "auto-1",
};
const automationLastAction = buildLastVerifiedOfficeAction(automationProposal2, "Weekly follow-up sweep", 'pause "Weekly follow-up sweep"');
assert.equal(automationLastAction.domain, "automations");
const automationScheduleResponse = buildOfficeInternalResponse(
  { ...requestBase, message: "do that every Friday" },
  canonicalBase,
  automationLastAction
);
const automationScheduleProposal = automationScheduleResponse.tool_proposals.find((p) => p.tool === "office.create_automation");
assert.ok(automationScheduleProposal, "a recurrence reference to a just-verified AUTOMATION action must still produce the prefilled suggestion");
assert.ok(automationScheduleProposal.parameters.suggested_name.includes("Weekly follow-up sweep"), "the suggested name must reference the automation that was actually verified, not a task");
assert.equal(automationScheduleProposal.parameters.suggested_schedule.schedule_type, "weekdays");

console.log("phase4-nl-scheduling-handoff-smoke: PASS");
