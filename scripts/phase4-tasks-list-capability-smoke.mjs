import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase4-tasks-list-smoke-service-role-key";
const { buildOfficeInternalReadCapabilities } = await import("../dist/oyi-core/capabilities/OfficeCorporateCapabilityModules.js");

// Oyi Conversational Runtime Completion Programme, Phase 4, PR 2 — Tasks
// list capability (office_tasks.query.read) + result-set population.
// Calls the capability's own supports()/collectEvidence()/buildReadResponse()
// directly (same unit-level approach as this repo's other capability
// smokes), not the full conversationOrchestrator.run() pipeline, so this
// never touches Supabase/network.

const modules = buildOfficeInternalReadCapabilities();
const queryModule = modules.find((m) => m.key === "office_tasks.query.read");
const singleModule = modules.find((m) => m.key === "office_tasks.read");
assert.ok(queryModule, "office_tasks.query.read must be registered");
assert.ok(singleModule, "office_tasks.read must still be registered");

function frame(domain, normalizedText) {
  return { domain, normalizedText };
}

function contextWithSnapshot(message, tasksSnapshot) {
  return {
    input: {
      message,
      context: { operational_snapshot: { tasks: tasksSnapshot } },
    },
  };
}

// --- Mutual exclusion by construction (no score tie-break to reason about) ---
assert.equal(queryModule.supports(frame("office_tasks", "show me my overdue tasks")), true, "plural list query claimed by query module");
assert.equal(singleModule.supports(frame("office_tasks", "show me my overdue tasks")), false, "single-record module must not also claim a list query");

assert.equal(queryModule.supports(frame("office_tasks", "is this task overdue")), false, "singular single-record question must not be claimed by the list module");
assert.equal(singleModule.supports(frame("office_tasks", "is this task overdue")), true, "single-record module still owns singular questions");

assert.equal(queryModule.supports(frame("office_tasks", "move this to in progress")), false, "mutation intent must not be claimed by the read-list module");
assert.equal(singleModule.supports(frame("office_tasks", "move this to in progress")), false, "mutation intent must not be claimed by the single-read module either (office_tasks.write owns it)");

assert.equal(queryModule.supports(frame("crm", "show me my overdue tasks")), false, "wrong domain must never match");

// --- Evidence + answer shape ---
const tasks = {
  open: [
    { id: "task-1", title: "Follow up with vendor", status: "in_progress", priority: "high", owner: "Tony", due_at: "2026-08-10T00:00:00Z", overdue: true },
    { id: "task-2", title: "Prepare site report", status: "open", priority: "medium", owner: null, due_at: "2026-08-25T00:00:00Z", overdue: false },
  ],
  total_open: 2,
};

const overdueContext = contextWithSnapshot("Show me my overdue tasks", tasks);
const evidence = await queryModule.collectEvidence(overdueContext);
// Regression guard for a real production bug (found in live Milestone 1
// verification): collect() must filter the SAME way answer() does, not
// return every open task regardless of phrasing -- otherwise the
// persisted result set ("the first two") resolves against the wrong,
// unfiltered list instead of what was actually shown to the user.
assert.equal(evidence.length, 1, "collect() must filter to overdue-only, matching answer()'s own filtering exactly");
assert.equal(evidence[0].object_id, "task-1", "the single evidence item must be the actually-overdue task");
assert.ok(evidence[0].payload?.fact?.object?.canonical_id, "each evidence item must carry a fact with object.canonical_id for result-set/follow-up resolution");
// Regression guard for a real production bug (found in live Milestone 1
// verification, not caught here originally because this test calls
// collect()/buildReadResponse() directly and never exercised
// CapabilityService's assertEvidenceAllowed gate): evidenceFromFact()
// silently defaulted every office_* fact to privacy_class
// "household_private", which privacyAllowed() unconditionally blocks
// for office_internal, making this capability's evidence permanently
// rejected in production despite every unit-level check here passing.
assert.equal(evidence[0].privacy_class, "corporate_private", "task evidence must carry an office-appropriate privacy_class, not Consumer/Facility's household_private default");

const overdueResult = await queryModule.buildReadResponse(overdueContext, evidence);
assert.equal(overdueResult.status, "answered");
assert.ok(/Follow up with vendor/.test(overdueResult.answer));
assert.ok(!/Prepare site report/.test(overdueResult.answer), "overdue-only phrasing must not list the non-overdue task in the text answer");
assert.equal(overdueResult.blocks?.[0]?.type, "record_list");
assert.equal(overdueResult.blocks[0].rows.length, 1);
assert.equal(overdueResult.blocks[0].rows[0].id, "task-1");
assert.equal(overdueResult.blocks[0].total_count, 2);

const allOpenContext = contextWithSnapshot("What tasks are open?", tasks);
const allOpenResult = await queryModule.buildReadResponse(allOpenContext, await queryModule.collectEvidence(allOpenContext));
assert.equal(allOpenResult.blocks[0].rows.length, 2, "non-overdue-scoped phrasing must list every open task");

// --- Honesty: no snapshot / empty snapshot never fabricated ---
const noSnapshotContext = { input: { message: "Show me my overdue tasks", context: {} } };
const noSnapshotResult = await queryModule.buildReadResponse(noSnapshotContext, []);
assert.equal(noSnapshotResult.status, "unavailable");
assert.ok(/wasn't attached/i.test(noSnapshotResult.answer));

const emptyContext = contextWithSnapshot("Show me my overdue tasks", { open: [], total_open: 0 });
const emptyResult = await queryModule.buildReadResponse(emptyContext, []);
assert.equal(emptyResult.status, "empty");

console.log("phase4-tasks-list-capability-smoke: PASS");
