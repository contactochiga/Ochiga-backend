#!/usr/bin/env node
// Wave 8 Slice 3 -- Goal Outcome / Workflow Completion Separation
// functional smoke (mocked supabaseAdmin, matching the established
// pattern of every prior slice's own functional smoke). Exercises
// goalOutcomeEvaluator.ts entirely in-process. GoalRuntime.ts and
// goalEvaluator.ts are NOT imported anywhere in this script -- this
// slice's own module is the only thing under test, and it never touches
// either of those Wave 7 files (see git diff proof in the final report).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = require("node:url").fileURLToPath(new URL("..", import.meta.url));
require(path.join(backendRoot, "node_modules/dotenv")).config({ path: path.join(backendRoot, ".env") });

const supabaseClientModule = require("../dist/supabase/supabaseClient.js");

function matches(row, filters) {
  return filters.every(([op, col, val]) => {
    if (op === "eq") return row[col] === val;
    if (op === "in") return Array.isArray(val) && val.includes(row[col]);
    return true;
  });
}

function chainableList(rows) {
  const state = { filters: [] };
  const builder = {
    select: () => builder,
    eq(col, val) { state.filters.push(["eq", col, val]); return builder; },
    in(col, vals) { state.filters.push(["in", col, vals]); return builder; },
    limit: () => builder,
    order: () => builder,
    async maybeSingle() {
      const matched = rows.filter((r) => matches(r, state.filters));
      return { data: matched[0] || null, error: null };
    },
    then(resolve, reject) {
      const matched = rows.filter((r) => matches(r, state.filters));
      return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

let decisionsTable = [];
let intelligenceFeedbackTable = [];
let decisionUpdateCalls = 0;
let feedbackWriteCalls = 0;

function fakeFrom(table) {
  if (table === "oyi_decisions") {
    return {
      select: () => chainableList(decisionsTable),
      update: () => { decisionUpdateCalls += 1; throw new Error("goalOutcomeEvaluator.ts must never write to oyi_decisions"); },
    };
  }
  if (table === "intelligence_feedback") {
    return {
      select: () => chainableList(intelligenceFeedbackTable),
      insert: () => { feedbackWriteCalls += 1; throw new Error("goalOutcomeEvaluator.ts must never write to intelligence_feedback"); },
    };
  }
  return { select: () => chainableList([]) };
}

supabaseClientModule.supabaseAdmin = { from: fakeFrom };

const { deriveGoalOutcome } = require("../dist/services/goalRuntime/goalOutcomeEvaluator.js");

function resetAll() {
  decisionsTable = [];
  intelligenceFeedbackTable = [];
  decisionUpdateCalls = 0;
  feedbackWriteCalls = 0;
}

let feedbackIdCounter = 0;
function seedDeviceOutcomeRow({ objectId, result, evaluatedAt, createdAt }) {
  feedbackIdCounter += 1;
  intelligenceFeedbackTable.push({
    id: `fb-${feedbackIdCounter}`,
    object_type: "device_state_outcome",
    object_id: objectId,
    feedback_type: "device_state_outcome_evaluation",
    outcome_metadata: { result, evaluated_at: evaluatedAt },
    created_at: createdAt,
  });
}

function deviceStep(stepIndex, deviceId, actionId = "device.off") {
  return {
    step_index: stepIndex,
    channel: "device",
    action_type: "device_action",
    body: null,
    wait_hours: 0,
    skip_if: null,
    status: "done",
    executed_at: "2026-09-25T10:00:00.000Z",
    result: { ok: true },
    device_command: { device_id: deviceId, action_id: actionId, command: {} },
  };
}

function commsStep(stepIndex) {
  return {
    step_index: stepIndex,
    channel: "email",
    action_type: "send_communication",
    body: "Following up",
    wait_hours: 0,
    skip_if: null,
    status: "done",
    executed_at: "2026-09-25T10:00:00.000Z",
    result: { ok: true },
  };
}

function goalFixture(overrides = {}) {
  return {
    id: "goal-1",
    correlation_id: "corr-1",
    requesting_actor_id: "actor-1",
    surface: "consumer",
    conversation_thread_id: null,
    organization_scope: null,
    canonical_signal_key: null,
    objective: "Turn off pool pump",
    target_entities: {},
    status: "completed",
    success_condition: { type: "manual" },
    stop_condition: { type: "none" },
    reply_branches: [],
    plan: [],
    current_step_index: 0,
    schedule: { deadline: null, recurrence: null, timezone: null },
    event_conditions: [],
    communication_preferences: { allowed_channels: ["email"], escalation_policy: "notify_requester" },
    max_attempts: 5,
    attempts_completed: 1,
    observations: [],
    evidence: [],
    linked_crm_records: {},
    linked_tasks: [],
    linked_meetings: [],
    linked_automations: [],
    linked_communication_threads: [],
    execution_history: [],
    last_evaluated_at: "2026-09-25T10:00:00.000Z",
    next_evaluation_at: null,
    completion_reason: "Plan completed with no further steps.",
    created_at: "2026-09-25T09:00:00.000Z",
    updated_at: "2026-09-25T10:00:00.000Z",
    ...overrides,
  };
}

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  }
}

// The exact object_id formula deviceOutcomeEvaluator.ts's own
// (now-exported) objectIdFor() produces, reproduced ONLY inside the
// smoke's fixtures to seed realistic rows -- goalOutcomeEvaluator.ts
// itself imports and calls the real function, never a copy of it.
function objectId(deviceId, actionId, lineageKey) {
  return `device:${deviceId}:action:${actionId}:${lineageKey}`;
}

console.log("\n=== A: device Goal workflow completes + factual outcome achieved -> Goal outcome achieved ===");
await check("a single achieved device-outcome row yields state achieved", async () => {
  resetAll();
  const goal = goalFixture({ plan: [deviceStep(0, "dev-1")] });
  seedDeviceOutcomeRow({ objectId: objectId("dev-1", "device.off", "goal-1"), result: "achieved", evaluatedAt: "2026-09-25T10:00:05.000Z", createdAt: "2026-09-25T10:00:05.000Z" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "achieved");
  assert.equal(outcome.provenance, "device_state_evaluation");
  assert.equal(outcome.evidence.length, 1);
  assert.equal(outcome.evidence[0].result, "achieved");
});

console.log("\n=== B: device Goal workflow completes + factual outcome contradicted -> not_achieved ===");
await check("a contradicted device-outcome row yields state not_achieved", async () => {
  resetAll();
  const goal = goalFixture({ plan: [deviceStep(0, "dev-2")] });
  seedDeviceOutcomeRow({ objectId: objectId("dev-2", "device.off", "goal-1"), result: "contradicted", evaluatedAt: "2026-09-25T10:00:05.000Z", createdAt: "2026-09-25T10:00:05.000Z" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "not_achieved");
});

console.log("\n=== C: device Goal workflow completes + outcome unverified -> workflow complete but outcome unverified ===");
await check("an unverified device-outcome row contributes no strong signal -> unverified", async () => {
  resetAll();
  const goal = goalFixture({ plan: [deviceStep(0, "dev-3")] });
  seedDeviceOutcomeRow({ objectId: objectId("dev-3", "device.off", "goal-1"), result: "unverified", evaluatedAt: "2026-09-25T10:00:05.000Z", createdAt: "2026-09-25T10:00:05.000Z" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "unverified");
  assert.equal(outcome.provenance, "insufficient_evidence");
});

console.log("\n=== D: Office follow-up Goal gets reply -> workflow progress/complete but outcome remains unverified ===");
await check("a goal with zero device-action steps never fabricates an achieved outcome", async () => {
  resetAll();
  const goal = goalFixture({ plan: [commsStep(0)], objective: "Follow up on JV enquiry", target_entities: { lead_id: "lead-1" } });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "unverified");
  assert.equal(outcome.provenance, "no_evaluator_available");
  assert.equal(outcome.evidence.length, 0);
});

console.log("\n=== E/F: plan exhaustion / last-dispatch-ok completion never fabricates an achieved outcome ===");
await check("a workflow-completed goal with no device evidence at all stays unverified, not achieved", async () => {
  resetAll();
  const goal = goalFixture({ plan: [deviceStep(0, "dev-4")], status: "completed", completion_reason: "Plan completed with no further steps." });
  // No intelligence_feedback row seeded at all -- the device step ran,
  // but nothing has evaluated it yet (or the evaluation call failed).
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "unverified");
  assert.notEqual(outcome.state, "achieved", "workflow completion must never be read as outcome achievement");
});

console.log("\n=== G: historical completed Goal without outcome evidence -> outcome unverified, no speculative backfill ===");
await check("a goal predating this slice, with device steps but zero evaluation rows, is honestly unverified", async () => {
  resetAll();
  const goal = goalFixture({ id: "goal-historical", plan: [deviceStep(0, "dev-5")], created_at: "2026-01-01T00:00:00.000Z" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "unverified");
  assert.equal(outcome.evidence.length, 0);
});

console.log("\n=== H: new evidence later establishes outcome -> safe, non-destructive update ===");
await check("re-deriving after fresher evidence arrives picks up the new result without needing any write", async () => {
  resetAll();
  const goal = goalFixture({ plan: [deviceStep(0, "dev-6")] });
  const key = objectId("dev-6", "device.off", "goal-1");
  seedDeviceOutcomeRow({ objectId: key, result: "unverified", evaluatedAt: "2026-09-25T10:00:00.000Z", createdAt: "2026-09-25T10:00:00.000Z" });
  const first = await deriveGoalOutcome(goal);
  assert.equal(first.state, "unverified");
  // Fresher evidence arrives later (a real re-evaluation call would have
  // written this new row -- simulated here by seeding it directly).
  seedDeviceOutcomeRow({ objectId: key, result: "achieved", evaluatedAt: "2026-09-25T11:00:00.000Z", createdAt: "2026-09-25T11:00:00.000Z" });
  const second = await deriveGoalOutcome(goal);
  assert.equal(second.state, "achieved");
  // Both rows remain in the table -- nothing was deleted or rewritten.
  assert.equal(intelligenceFeedbackTable.filter((r) => r.object_id === key).length, 2);
});

console.log("\n=== I: Goal outcome derivation never mutates oyi_decisions ===");
await check("only a read-only select is ever issued against oyi_decisions", async () => {
  resetAll();
  const goal = goalFixture({ plan: [deviceStep(0, "dev-7")] });
  await deriveGoalOutcome(goal);
  assert.equal(decisionUpdateCalls, 0, "oyi_decisions.update must never be called");
});

console.log("\n=== J: Goal outcome derivation never writes to intelligence_feedback ===");
await check("this module is pure read -- zero inserts anywhere", async () => {
  resetAll();
  const goal = goalFixture({ plan: [deviceStep(0, "dev-8")] });
  seedDeviceOutcomeRow({ objectId: objectId("dev-8", "device.off", "goal-1"), result: "achieved", evaluatedAt: "2026-09-25T10:00:00.000Z", createdAt: "2026-09-25T10:00:00.000Z" });
  await deriveGoalOutcome(goal);
  assert.equal(feedbackWriteCalls, 0, "intelligence_feedback.insert must never be called by this module");
});

console.log("\n=== Mixed evidence: multiple device steps disagreeing -> honestly \"mixed\", never picked one side ===");
await check("one achieved + one contradicted device step yields mixed, not a coin-flip winner", async () => {
  resetAll();
  const goal = goalFixture({ plan: [deviceStep(0, "dev-9a"), deviceStep(1, "dev-9b")] });
  seedDeviceOutcomeRow({ objectId: objectId("dev-9a", "device.off", "goal-1"), result: "achieved", evaluatedAt: "2026-09-25T10:00:00.000Z", createdAt: "2026-09-25T10:00:00.000Z" });
  seedDeviceOutcomeRow({ objectId: objectId("dev-9b", "device.off", "goal-1"), result: "contradicted", evaluatedAt: "2026-09-25T10:00:00.000Z", createdAt: "2026-09-25T10:00:00.000Z" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "mixed");
});

console.log("\n=== Multiple agreeing device steps -> achieved (not just the first one checked) ===");
await check("two device steps both achieved -> overall achieved", async () => {
  resetAll();
  const goal = goalFixture({ plan: [deviceStep(0, "dev-10a"), deviceStep(1, "dev-10b")] });
  seedDeviceOutcomeRow({ objectId: objectId("dev-10a", "device.off", "goal-1"), result: "achieved", evaluatedAt: "2026-09-25T10:00:00.000Z", createdAt: "2026-09-25T10:00:00.000Z" });
  seedDeviceOutcomeRow({ objectId: objectId("dev-10b", "device.off", "goal-1"), result: "achieved", evaluatedAt: "2026-09-25T10:00:00.000Z", createdAt: "2026-09-25T10:00:00.000Z" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "achieved");
  assert.equal(outcome.evidence.length, 2);
});

console.log("\n=== A Decision-linked goal uses the real decisionId as the lineage key, matching Slice 1's own preference order ===");
await check("when oyi_decisions has a row for this goal_id, the object_id lookup uses decisionId, not goalId", async () => {
  resetAll();
  decisionsTable.push({ id: "decision-1", goal_id: "goal-decision-linked" });
  const goal = goalFixture({ id: "goal-decision-linked", plan: [deviceStep(0, "dev-11")] });
  seedDeviceOutcomeRow({ objectId: objectId("dev-11", "device.off", "decision-1"), result: "achieved", evaluatedAt: "2026-09-25T10:00:00.000Z", createdAt: "2026-09-25T10:00:00.000Z" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "achieved", "must find the row keyed by the real decisionId, not fall back to goalId when a Decision link exists");
});

console.log("\n=== device.toggle steps are excluded from outcome evaluation entirely (Slice 1's own unsupported class) ===");
await check("a toggle-only plan behaves identically to a plan with no device steps", async () => {
  resetAll();
  const goal = goalFixture({ plan: [deviceStep(0, "dev-12", "device.toggle")] });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "unverified");
  assert.equal(outcome.provenance, "no_evaluator_available");
});

console.log("");
console.log(`=== wave8-slice3-goal-outcome-workflow-separation-smoke: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
