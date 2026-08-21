import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase4-office-reference-resolution-smoke-service-role-key";

// Oyi Conversational Runtime Completion Programme, Phase 4, PR 3 —
// Office-specific reference resolution. Proves two things:
//  (1) the REUSED, unmodified resultSetContext.ts/followUpResolver.ts
//      pure functions actually work correctly against Office-shaped
//      ResultSetObjectRefs (ordinal/pronoun/attribute/filter),
//  (2) the NEW officeResultSetReference.ts continuation answers
//      honestly from a ref's own data, and isOfficeResultSetDomain
//      never misclassifies a Consumer/Facility domain as Office's.
const { parseFollowUpIntent, resolveFollowUpReference, resolveFilterFollowUp } = await import("../dist/oyi-core/interpretation/followUpResolver.js");
const { isOfficeResultSetDomain, officeFactFromRef, officeFollowUpAnswer } = await import("../dist/oyi-core/context/officeResultSetReference.js");

function taskRef(overrides = {}) {
  return {
    object_type: "task",
    canonical_id: overrides.id || "task-1",
    label: overrides.label || "Follow up with vendor",
    occurred_at: overrides.due_at ?? "2026-08-10T00:00:00Z",
    metric: null,
    metric_value: null,
    status: overrides.status ?? "in_progress",
    attributes: {
      status: overrides.status ?? "in_progress",
      priority: overrides.priority ?? "high",
      owner: overrides.owner ?? "Tony",
      due_at: overrides.due_at ?? "2026-08-10T00:00:00Z",
      overdue: overrides.overdue ?? "true",
    },
  };
}

function resultSet(refs) {
  return {
    version: 1,
    result_set_id: "rs-1",
    domain: "office_tasks",
    capability_key: "office_tasks.query.read",
    operation: "list",
    object_refs: refs,
    timeframe: null,
    filters: {},
    metric: null,
    result_count: refs.length,
    selected_object_ref: refs.length === 1 ? refs[0] : null,
    source_request_id: "req-1",
    source_thread_id: "thread-1",
    source_message: "show me my overdue tasks",
    created_at: new Date().toISOString(),
  };
}

// --- Domain classification never misroutes a shared Consumer/Facility domain ---
assert.equal(isOfficeResultSetDomain("office_tasks"), true);
assert.equal(isOfficeResultSetDomain("crm"), true);
assert.equal(isOfficeResultSetDomain("automations"), false, "shared Consumer/Facility domain must never be misclassified as Office's");
assert.equal(isOfficeResultSetDomain("wallet"), false);
assert.equal(isOfficeResultSetDomain("devices"), false);

// --- Reused ordinal/pronoun resolution against Office-shaped refs ---
const refs = [
  taskRef({ id: "task-1", label: "Follow up with vendor", priority: "high" }),
  taskRef({ id: "task-2", label: "Prepare site report", priority: "medium", overdue: "false" }),
];
const rs = resultSet(refs);

const secondIntent = parseFollowUpIntent("the second one");
assert.deepEqual(secondIntent, { type: "ordinal", ordinal: "second" });
const secondResolution = resolveFollowUpReference(rs, secondIntent);
assert.equal(secondResolution.status, "resolved");
assert.equal(secondResolution.ref.canonical_id, "task-2");

const pronounIntent = parseFollowUpIntent("tell me more about that");
assert.deepEqual(pronounIntent, { type: "detail" });

// --- Hotfix regression: "the first two" is a COUNT reference (batch),
// not a single-ordinal one -- found live in production swallowing
// office_tasks.write's own batch-target parser before it ever ran. ---
assert.deepEqual(parseFollowUpIntent("the first one"), { type: "ordinal", ordinal: "first" }, "single-ordinal phrasing must still work");
assert.equal(parseFollowUpIntent("move the first two to Monday"), null, "a count phrase must not be claimed by the single-ordinal resolver");
assert.equal(parseFollowUpIntent("the first 3"), null, "a numeric count phrase must not be claimed either");

// --- Reused filter continuity ("only the high priority ones") against Office attributes ---
const filterIntent = parseFollowUpIntent("show only the high priority ones");
assert.equal(filterIntent.type, "filter");
const filterResolution = resolveFilterFollowUp(rs, filterIntent.keyword);
assert.equal(filterResolution.status, "resolved");
assert.equal(filterResolution.matched.length, 1);
assert.equal(filterResolution.matched[0].canonical_id, "task-1");

// --- New Office continuation: honest answers built from the ref alone ---
const withOwnerAndDue = taskRef({ owner: "Tony", due_at: "2026-08-10T00:00:00Z", overdue: "true" });
assert.equal(officeFollowUpAnswer(withOwnerAndDue, { type: "field", field: "who" }), "Follow up with vendor is owned by Tony.");
assert.equal(
  officeFollowUpAnswer(withOwnerAndDue, { type: "field", field: "when" }),
  "Follow up with vendor is due 2026-08-10T00:00:00Z — it's overdue."
);
assert.equal(officeFollowUpAnswer(withOwnerAndDue, { type: "status_check" }), "Follow up with vendor is in progress, and it's overdue.");

const noOwnerNoDue = taskRef({ owner: "", due_at: "" });
assert.equal(officeFollowUpAnswer(noOwnerNoDue, { type: "field", field: "who" }), "Follow up with vendor doesn't have an owner assigned yet.");
assert.equal(officeFollowUpAnswer(noOwnerNoDue, { type: "field", field: "when" }), "Follow up with vendor doesn't have a due date set.");

const detailAnswer = officeFollowUpAnswer(withOwnerAndDue, { type: "detail" });
assert.ok(detailAnswer.includes("Follow up with vendor"));
assert.ok(detailAnswer.includes("owned by Tony"));
assert.ok(detailAnswer.includes("due 2026-08-10T00:00:00Z (overdue)"));

const fact = officeFactFromRef(withOwnerAndDue);
assert.equal(fact.object.canonical_id, "task-1");
assert.equal(fact.object.object_type, "task");
assert.equal(fact.truth_state, "observed");
assert.equal(fact.value.owner, "Tony");

console.log("phase4-office-reference-resolution-smoke: PASS");
