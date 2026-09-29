#!/usr/bin/env node
// Wave 8 Slice 4 -- Commercial Outcome Evaluator functional smoke.
// Exercises goalOutcomeEvaluator.ts's new commercial dispatch branch
// (deriveGoalOutcome/deriveGoalOutcomesBatch) against a REAL local HTTP
// server standing in for Office's admin API (same convention as
// oyi-communications-convergence-slice1-smoke.mjs -- more robust than
// monkeypatching "axios" across the CJS/ESM interop boundary). This is a
// real request/response cycle over loopback: officeOpportunityBridge.ts's
// actual axios.get calls, actual JSON parsing, actual status-code
// branching all run for real. Never touches the real Office deployment.
//
// Also proves the existing Slice 3 device-outcome path is completely
// unaffected (scenario M) and that this module never references
// reply/sentiment/delivery signals (scenario F, plus a source-text grep).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const backendRoot = require("node:url").fileURLToPath(new URL("..", import.meta.url));
require(path.join(backendRoot, "node_modules/dotenv")).config({ path: path.join(backendRoot, ".env") });

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "wave8-slice4-local-only";
process.env.OFFICE_SYNC_API_KEY ||= "test-only-shared-secret";

// A real local HTTP server standing in for Office's two admin list
// routes this bridge calls. Configurable per-test via `officeFixture`.
let officeFixture = { opportunities: [], activities: [] };
let opportunitiesCallCount = 0;
let activitiesCallCount = 0;
let officeUnreachable = false;
const officeServer = http.createServer((req, res) => {
  if (officeUnreachable) {
    req.destroy();
    return;
  }
  if (req.url.includes("/crm/opportunities")) {
    opportunitiesCallCount += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ collection: officeFixture.opportunities }));
    return;
  }
  if (req.url.includes("/crm/activities")) {
    activitiesCallCount += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ collection: officeFixture.activities }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
await new Promise((resolve) => officeServer.listen(0, "127.0.0.1", resolve));
const officePort = officeServer.address().port;
process.env.OFFICE_APP_URL = `http://127.0.0.1:${officePort}`;

// Same fake supabaseAdmin convention as
// wave8-slice3-goal-outcome-workflow-separation-smoke.mjs, needed here
// only so the device-path scenarios (M, and the mixed-batch scenario)
// resolve against empty, controlled tables instead of a real network
// call -- this smoke's own subject (the commercial path) never touches
// supabaseAdmin at all, proven separately by scenario L.
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
const supabaseClientModule = require("../dist/supabase/supabaseClient.js");
supabaseClientModule.supabaseAdmin = { from: () => chainableList([]) };

const { deriveGoalOutcome, deriveGoalOutcomesBatch } = require("../dist/services/goalRuntime/goalOutcomeEvaluator.js");

function resetOfficeFixture() {
  officeFixture = { opportunities: [], activities: [] };
  opportunitiesCallCount = 0;
  activitiesCallCount = 0;
  officeUnreachable = false;
}

function opportunityRow({ id, stage, status = "open", leadId = "lead-1", updatedAt = "2026-09-25T12:00:00.000Z" }) {
  return { id, stage, status, lead_id: leadId, updated_at: updatedAt };
}

function stageChangeActivity({ opportunityId, previousStage, targetStage, occurredAt }) {
  return {
    activity_type: "opportunity_stage_changed",
    related_id: opportunityId,
    occurred_at: occurredAt,
    metadata: { previous_stage: previousStage, target_stage: targetStage, evidence_type: "test_fixture", evidence_id: "fixture-1" },
  };
}

function goalFixture(overrides = {}) {
  return {
    id: "goal-1",
    correlation_id: "corr-1",
    requesting_actor_id: "actor-1",
    surface: "office_internal",
    conversation_thread_id: null,
    organization_scope: null,
    canonical_signal_key: null,
    objective: "Progress the opportunity to qualified",
    target_entities: {},
    status: "active",
    success_condition: { type: "reply_received" },
    stop_condition: { type: "none" },
    reply_branches: [],
    plan: [],
    current_step_index: 0,
    schedule: { deadline: null, recurrence: null, timezone: null },
    event_conditions: [],
    communication_preferences: { allowed_channels: ["whatsapp"], escalation_policy: "notify_requester" },
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
    completion_reason: null,
    created_at: "2026-09-25T09:00:00.000Z",
    updated_at: "2026-09-25T10:00:00.000Z",
    ...overrides,
  };
}

function commercialGoal({ id = "goal-c1", opportunityId, targetStage, ...overrides }) {
  return goalFixture({ id, target_entities: { opportunity_id: opportunityId, commercial_target_stage: targetStage }, ...overrides });
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

console.log("\n=== A: target=qualified, actual=qualified -> achieved ===");
await check("current stage equals the target stage exactly", async () => {
  resetOfficeFixture();
  officeFixture.opportunities = [opportunityRow({ id: "opp-a", stage: "qualified" })];
  const goal = commercialGoal({ id: "goal-a", opportunityId: "opp-a", targetStage: "qualified" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "achieved");
  assert.equal(outcome.provenance, "commercial_opportunity_evaluation");
  assert.equal(outcome.commercial.result, "achieved");
});

console.log("\n=== B: target=qualified, actual=negotiation -> achieved via forward ordering ===");
await check("a later stage than the target still satisfies it", async () => {
  resetOfficeFixture();
  officeFixture.opportunities = [opportunityRow({ id: "opp-b", stage: "negotiation" })];
  const goal = commercialGoal({ id: "goal-b", opportunityId: "opp-b", targetStage: "qualified" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "achieved");
});

console.log("\n=== C: target=won, actual=qualified -> unverified (not yet, not lost) ===");
await check("an intermediate stage never satisfies or fails a won target -- honestly unverified", async () => {
  resetOfficeFixture();
  officeFixture.opportunities = [opportunityRow({ id: "opp-c", stage: "qualified" })];
  const goal = commercialGoal({ id: "goal-c", opportunityId: "opp-c", targetStage: "won" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "unverified");
});

console.log("\n=== D: target=won, actual=won -> achieved ===");
await check("won target satisfied by currently-won stage", async () => {
  resetOfficeFixture();
  officeFixture.opportunities = [opportunityRow({ id: "opp-d", stage: "won", status: "closed_won" })];
  const goal = commercialGoal({ id: "goal-d", opportunityId: "opp-d", targetStage: "won" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "achieved");
});

console.log("\n=== E: target=won, actual=lost -> not_achieved, never inferred from proposal-accepted ===");
await check("a lost Opportunity is honestly not_achieved against a won target", async () => {
  resetOfficeFixture();
  officeFixture.opportunities = [opportunityRow({ id: "opp-e", stage: "lost", status: "closed_lost" })];
  const goal = commercialGoal({ id: "goal-e", opportunityId: "opp-e", targetStage: "won" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "not_achieved");
});

console.log("\n=== F: reply received but Opportunity unchanged -> no fabricated outcome from reply/sentiment/delivery ===");
await check("this module's CODE (not its explanatory comments) never references reply/sentiment/delivery signals", async () => {
  const stripComments = (src) => src.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  const evaluatorSrc = stripComments(fs.readFileSync(path.join(backendRoot, "src/oyi-core/domains/development/commercialOutcomeEvaluator.ts"), "utf8"));
  const bridgeSrc = stripComments(fs.readFileSync(path.join(backendRoot, "src/oyi-core/ingress/officeOpportunityBridge.ts"), "utf8"));
  for (const forbidden of ["InboundReplyOutcome", "sentiment", "delivered", "reply_received", "positive_reply"]) {
    assert.ok(!evaluatorSrc.includes(forbidden), `commercialOutcomeEvaluator.ts's actual code must never reference "${forbidden}"`);
    assert.ok(!bridgeSrc.includes(forbidden), `officeOpportunityBridge.ts's actual code must never reference "${forbidden}"`);
  }
});
await check("a reply-only goal (no opportunity/target set) never evaluates commercially, regardless of reply state", async () => {
  resetOfficeFixture();
  const goal = goalFixture({ id: "goal-f", target_entities: {}, objective: "Follow up on enquiry" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "unverified");
  assert.equal(outcome.provenance, "no_evaluator_available");
  assert.equal(opportunitiesCallCount, 0, "no Office call should ever be made for a goal with no commercial target");
});

console.log("\n=== G: workflow completed but Opportunity unchanged -> unverified per evidence semantics ===");
await check("goal.status completed does not itself imply commercial achievement", async () => {
  resetOfficeFixture();
  officeFixture.opportunities = [opportunityRow({ id: "opp-g", stage: "contacted" })];
  const goal = commercialGoal({ id: "goal-g", opportunityId: "opp-g", targetStage: "qualified", status: "completed", completion_reason: "Plan completed with no further steps." });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "unverified");
  assert.notEqual(outcome.state, "achieved");
});

console.log("\n=== H: same contact, two Opportunities -> isolated evaluations ===");
await check("two commercial goals for the same lead but different opportunities evaluate independently", async () => {
  resetOfficeFixture();
  officeFixture.opportunities = [
    opportunityRow({ id: "opp-h1", stage: "won", status: "closed_won", leadId: "lead-shared" }),
    opportunityRow({ id: "opp-h2", stage: "lost", status: "closed_lost", leadId: "lead-shared" }),
  ];
  const goalOne = commercialGoal({ id: "goal-h1", opportunityId: "opp-h1", targetStage: "won" });
  const goalTwo = commercialGoal({ id: "goal-h2", opportunityId: "opp-h2", targetStage: "won" });
  const outcomeOne = await deriveGoalOutcome(goalOne);
  const outcomeTwo = await deriveGoalOutcome(goalTwo);
  assert.equal(outcomeOne.state, "achieved");
  assert.equal(outcomeTwo.state, "not_achieved");
});

console.log("\n=== I: legacy Lead-only Goal -> no evaluator, never guesses an Opportunity ===");
await check("a goal with only lead_id set (no opportunity_id) is honestly no_evaluator_available", async () => {
  resetOfficeFixture();
  const goal = goalFixture({ id: "goal-i", target_entities: { lead_id: "lead-legacy" } });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "unverified");
  assert.equal(outcome.provenance, "no_evaluator_available");
  assert.equal(opportunitiesCallCount, 0);
});

console.log("\n=== J: Office unavailable -> unverified, never a false failure ===");
await check("a connection failure yields unverified/office_unavailable, not not_achieved", async () => {
  resetOfficeFixture();
  officeUnreachable = true;
  const goal = commercialGoal({ id: "goal-j", opportunityId: "opp-j", targetStage: "won" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "unverified");
  assert.equal(outcome.provenance, "office_unavailable");
  assert.notEqual(outcome.state, "not_achieved");
});

console.log("\n=== K: historical intermediate target remains achieved after later becoming lost ===");
await check("qualified reached at T1, lost at T2 -- target=qualified stays achieved", async () => {
  resetOfficeFixture();
  officeFixture.opportunities = [opportunityRow({ id: "opp-k", stage: "lost", status: "closed_lost" })];
  officeFixture.activities = [
    stageChangeActivity({ opportunityId: "opp-k", previousStage: "contacted", targetStage: "qualified", occurredAt: "2026-09-20T10:00:00.000Z" }),
    stageChangeActivity({ opportunityId: "opp-k", previousStage: "qualified", targetStage: "lost", occurredAt: "2026-09-24T10:00:00.000Z" }),
  ];
  const goal = commercialGoal({ id: "goal-k", opportunityId: "opp-k", targetStage: "qualified" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "achieved", "the intermediate target was genuinely reached at T1 and must remain true even after the later terminal loss");
  assert.ok(outcome.commercial.stagesEverReached.includes("qualified"));
});
await check("but a target never reached before becoming lost is honestly not_achieved", async () => {
  resetOfficeFixture();
  officeFixture.opportunities = [opportunityRow({ id: "opp-k2", stage: "lost", status: "closed_lost" })];
  officeFixture.activities = [
    stageChangeActivity({ opportunityId: "opp-k2", previousStage: "contacted", targetStage: "lost", occurredAt: "2026-09-24T10:00:00.000Z" }),
  ];
  const goal = commercialGoal({ id: "goal-k2", opportunityId: "opp-k2", targetStage: "negotiation" });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.state, "not_achieved");
});

console.log("\n=== L: this evaluation changes zero learning parameters/policies ===");
await check("no write-capable client is imported or invoked anywhere in the new modules", async () => {
  const files = [
    "src/oyi-core/domains/development/commercialOutcomeEvaluator.ts",
    "src/oyi-core/ingress/officeOpportunityBridge.ts",
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(backendRoot, file), "utf8");
    assert.ok(!src.includes("axios.post"), `${file} must never POST anything`);
    assert.ok(!src.includes("axios.patch"), `${file} must never PATCH anything`);
    assert.ok(!src.includes("supabaseAdmin"), `${file} must never touch Backend persistence directly`);
  }
});

console.log("\n=== M: Slice 3's own device-outcome path remains completely unaffected ===");
await check("a device-only goal (no commercial target) still evaluates via the device path, zero Office calls", async () => {
  resetOfficeFixture();
  const goal = goalFixture({ id: "goal-m", plan: [deviceStep(0, "dev-1")], target_entities: {} });
  const outcome = await deriveGoalOutcome(goal);
  // Slice 3's own established behavior: a device step present with zero
  // evaluation evidence yields insufficient_evidence, not
  // no_evaluator_available (that provenance is reserved for zero device
  // steps AND no commercial target -- see scenario I above). The point
  // of this scenario is that the commercial dispatch branch never
  // intercepts a device-bearing goal at all, proven by zero Office calls.
  assert.equal(outcome.provenance, "insufficient_evidence");
  assert.equal(opportunitiesCallCount, 0, "a device-path goal must never call Office");
});

console.log("\n=== Batch performance: N commercial goals cost exactly ONE Office call pair, not N ===");
for (const n of [1, 10, 50, 100]) {
  await check(`deriveGoalOutcomesBatch with ${n} commercial goals issues exactly 1 opportunities call and 1 activities call`, async () => {
    resetOfficeFixture();
    officeFixture.opportunities = Array.from({ length: n }, (_, i) => opportunityRow({ id: `opp-batch-${i}`, stage: "qualified" }));
    const goals = Array.from({ length: n }, (_, i) => commercialGoal({ id: `goal-batch-${i}`, opportunityId: `opp-batch-${i}`, targetStage: "qualified" }));
    const outcomes = await deriveGoalOutcomesBatch(goals);
    assert.equal(outcomes.length, n);
    assert.ok(outcomes.every((o) => o.state === "achieved"));
    assert.equal(opportunitiesCallCount, 1, `expected exactly 1 opportunities call for ${n} goals, got ${opportunitiesCallCount}`);
    assert.equal(activitiesCallCount, 1, `expected exactly 1 activities call for ${n} goals, got ${activitiesCallCount}`);
  });
}

console.log("\n=== Batch: mixed commercial + device + no-target goals all resolve correctly in one call ===");
await check("a batch of mixed goal types partitions correctly and preserves input order", async () => {
  resetOfficeFixture();
  officeFixture.opportunities = [opportunityRow({ id: "opp-mix", stage: "won", status: "closed_won" })];
  const commercial = commercialGoal({ id: "goal-mix-commercial", opportunityId: "opp-mix", targetStage: "won" });
  const device = goalFixture({ id: "goal-mix-device", plan: [deviceStep(0, "dev-mix")], target_entities: {} });
  const legacy = goalFixture({ id: "goal-mix-legacy", target_entities: { lead_id: "lead-mix" } });
  const outcomes = await deriveGoalOutcomesBatch([commercial, device, legacy]);
  assert.deepEqual(outcomes.map((o) => o.goalId), ["goal-mix-commercial", "goal-mix-device", "goal-mix-legacy"]);
  assert.equal(outcomes[0].state, "achieved");
  assert.equal(outcomes[1].provenance, "insufficient_evidence", "the device-bearing goal takes Slice 3's own device path, not the commercial one");
  assert.equal(outcomes[2].provenance, "no_evaluator_available", "the lead-only legacy goal has neither device steps nor a commercial target");
  assert.equal(opportunitiesCallCount, 1);
});

console.log("\n=== Batch: Office unavailable for a batch never reports false failure ===");
await check("a batch with Office unreachable returns unverified/office_unavailable for every commercial goal", async () => {
  resetOfficeFixture();
  officeUnreachable = true;
  const goals = [
    commercialGoal({ id: "goal-batch-down-1", opportunityId: "opp-x1", targetStage: "won" }),
    commercialGoal({ id: "goal-batch-down-2", opportunityId: "opp-x2", targetStage: "qualified" }),
  ];
  const outcomes = await deriveGoalOutcomesBatch(goals);
  assert.ok(outcomes.every((o) => o.state === "unverified" && o.provenance === "office_unavailable"));
});

officeServer.close();
console.log("");
console.log(`=== wave8-slice4-commercial-outcome-evaluator-smoke: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
