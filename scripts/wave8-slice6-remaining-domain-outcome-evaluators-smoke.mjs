#!/usr/bin/env node
// Wave 8 Slice 6 -- Camera/Maintenance/Visitor Outcome Evaluators
// functional smoke (mocked supabaseAdmin, matching the established
// pattern of every prior slice's own functional smoke). Exercises
// cameraOutcomeEvaluator.ts, maintenanceOutcomeEvaluator.ts,
// visitorOutcomeEvaluator.ts, and goalOutcomeEvaluator.ts's new dispatch
// branches entirely in-process against in-memory facility_cameras/
// edge_nodes/maintenance_requests/visitor_access/visitor_analytics/
// intelligence_feedback tables.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = require("node:url").fileURLToPath(new URL("..", import.meta.url));
require(path.join(backendRoot, "node_modules/dotenv")).config({ path: path.join(backendRoot, ".env") });

let tables = {};
let idCounter = 0;
function newId(prefix) { idCounter += 1; return `${prefix}-${idCounter}`; }

function matchesFilters(row, filters) {
  return filters.every(([op, col, val]) => {
    if (op === "eq") return row[col] === val;
    if (op === "in") return Array.isArray(val) && val.includes(row[col]);
    return true;
  });
}

function makeTable(rows) {
  return {
    select() {
      const state = { filters: [] };
      const builder = {
        eq(col, val) { state.filters.push(["eq", col, val]); return builder; },
        in(col, vals) { state.filters.push(["in", col, vals]); return builder; },
        limit() { return builder; },
        async maybeSingle() {
          const matched = rows.filter((r) => matchesFilters(r, state.filters));
          return { data: matched[0] || null, error: null };
        },
        then(resolve, reject) {
          const matched = rows.filter((r) => matchesFilters(r, state.filters));
          return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    insert(rowOrRows) {
      const incoming = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      // Simulate Slice 5's real partial unique index:
      // (object_type, object_id, feedback_type) where
      // feedback_type='outcome_evaluation' -- only meaningful for the
      // intelligence_feedback table, a no-op key check for others.
      const conflict = incoming.find((row) =>
        row.feedback_type === "outcome_evaluation" &&
        rows.some((existing) => existing.object_type === row.object_type && existing.object_id === row.object_id && existing.feedback_type === "outcome_evaluation")
      );
      function commit() {
        if (conflict) {
          const error = new Error("duplicate key value violates unique constraint");
          error.code = "23505";
          return { data: null, error };
        }
        const inserted = incoming.map((row) => ({ id: newId("row"), created_at: new Date().toISOString(), ...row }));
        rows.push(...inserted);
        return { data: inserted, error: null };
      }
      const builder = {
        // Matches real supabase-js: `.insert(x).select(cols)` (no
        // `.maybeSingle()`) is itself directly awaitable, resolving to
        // `{data: [...], error}` for the multi-row case this module's
        // shared persistence helper actually uses.
        select() {
          return {
            then(resolve, reject) { return Promise.resolve(commit()).then(resolve, reject); },
            async maybeSingle() {
              const result = commit();
              return { data: result.data ? result.data[0] : null, error: result.error };
            },
          };
        },
        then(resolve, reject) { return Promise.resolve(commit()).then(resolve, reject); },
      };
      return builder;
    },
  };
}

function fakeFrom(table) {
  if (!tables[table]) tables[table] = [];
  return makeTable(tables[table]);
}

const supabaseClientModule = require("../dist/supabase/supabaseClient.js");
supabaseClientModule.supabaseAdmin = { from: fakeFrom };

const { evaluateCameraOutcomes } = require("../dist/modules/cameras/cameraOutcomeEvaluator.js");
const { evaluateMaintenanceOutcomes } = require("../dist/services/maintenanceOutcomeEvaluator.js");
const { evaluateVisitorOutcomes } = require("../dist/services/visitorOutcomeEvaluator.js");
const { deriveGoalOutcome, deriveGoalOutcomesBatch } = require("../dist/services/goalRuntime/goalOutcomeEvaluator.js");

function resetAll() {
  tables = {};
  supabaseClientModule.supabaseAdmin = { from: fakeFrom };
}

// ---------- Camera fixtures ----------
const ESTATE_ID = "estate-1";
function frameEvidence({ cameraId, edgeNodeId, result, observedAt }) {
  return {
    source: "ai_snapshot",
    kind: "frame",
    result,
    observation_id: "11111111-1111-1111-1111-111111111111",
    schema_version: 1,
    camera_id: cameraId,
    edge_node_id: edgeNodeId,
    observed_at: observedAt,
    received_at: observedAt,
    details: result === "acquired" ? { validation: "bounded_image_signature", mime_type: "image/jpeg", size_bytes: 1000 } : {},
  };
}

function seedCamera({ id, edgeNodeId = null, runtimeObservations = null }) {
  tables.facility_cameras = tables.facility_cameras || [];
  tables.facility_cameras.push({
    id,
    estate_id: ESTATE_ID,
    home_id: null,
    privacy_scope: "facility",
    metadata: {},
    edge_node_id: edgeNodeId,
    nvr_id: null,
    channel: null,
    ai_enabled: false,
    runtime_observations: runtimeObservations,
  });
}

function seedHealthyEdge(edgeNodeId) {
  tables.edge_nodes = tables.edge_nodes || [];
  tables.edge_nodes.push({
    id: newId("edge"),
    estate_id: ESTATE_ID,
    edge_node_id: edgeNodeId,
    heartbeat_observed_at: new Date().toISOString(),
    heartbeat_received_at: new Date().toISOString(),
    heartbeat_observation: { version: 1, source: "edge_heartbeat", status: "online", queue_depth: 0, sync_status: "synced", error_count: 0, expected_interval_ms: 30000 },
  });
}

function seedExpiredEdge(edgeNodeId) {
  tables.edge_nodes = tables.edge_nodes || [];
  const veryOld = new Date(Date.now() - 999999999999).toISOString();
  tables.edge_nodes.push({
    id: newId("edge"),
    estate_id: ESTATE_ID,
    edge_node_id: edgeNodeId,
    heartbeat_observed_at: veryOld,
    heartbeat_received_at: veryOld,
    heartbeat_observation: { version: 1, source: "edge_heartbeat", status: "online", queue_depth: 0, sync_status: "synced", error_count: 0, expected_interval_ms: 30000 },
  });
}

// evidence() in cameraCurrentStateAuthority.ts REQUIRES camera.edge_node_id
// to be bound and to match the evidence's own edge_node_id -- every
// scenario below binds a real edge node (healthy unless the scenario is
// specifically testing edge impairment).
function seedHealthyCamera(cameraId) {
  const now = new Date().toISOString();
  const edgeNodeId = `${cameraId}-edge`;
  seedCamera({ id: cameraId, edgeNodeId, runtimeObservations: { version: 1, dimensions: { "frame:ai_snapshot": { latest: frameEvidence({ cameraId, edgeNodeId, result: "acquired", observedAt: now }) } } } });
  seedHealthyEdge(edgeNodeId);
}

function seedDegradedByEdgeCamera(cameraId, edgeNodeId, observedAtOverride) {
  const now = observedAtOverride || new Date().toISOString();
  seedCamera({ id: cameraId, edgeNodeId, runtimeObservations: { version: 1, dimensions: { "frame:ai_snapshot": { latest: frameEvidence({ cameraId, edgeNodeId, result: "acquired", observedAt: now }) } } } });
  seedExpiredEdge(edgeNodeId);
}

function seedUnavailableCamera(cameraId) {
  const now = new Date().toISOString();
  const edgeNodeId = `${cameraId}-edge`;
  seedCamera({ id: cameraId, edgeNodeId, runtimeObservations: { version: 1, dimensions: { "frame:ai_snapshot": { latest: frameEvidence({ cameraId, edgeNodeId, result: "failed", observedAt: now }) } } } });
  seedHealthyEdge(edgeNodeId);
}

function seedUnknownCamera(cameraId) {
  seedCamera({ id: cameraId, runtimeObservations: null });
}

// ---------- Maintenance/Visitor fixtures ----------
function seedMaintenance({ id, status = null, completedAt = null, verifiedByResident = false }) {
  tables.maintenance_requests = tables.maintenance_requests || [];
  tables.maintenance_requests.push({ id, status, completed_at: completedAt, verified_at: null, verified_by_resident: verifiedByResident });
}

function seedVisitor({ id, status, arrivedAt = null, exitedAt = null }) {
  tables.visitor_access = tables.visitor_access || [];
  tables.visitor_access.push({ id, status });
  if (arrivedAt) {
    tables.visitor_analytics = tables.visitor_analytics || [];
    tables.visitor_analytics.push({ visitor_access_id: id, arrived_at: arrivedAt, exited_at: exitedAt });
  }
}

function goalFixture(overrides = {}) {
  return {
    id: "goal-1",
    correlation_id: "corr-1",
    requesting_actor_id: "actor-1",
    surface: "facility",
    conversation_thread_id: null,
    organization_scope: null,
    canonical_signal_key: null,
    objective: "Restore trustworthy video acquisition",
    target_entities: {},
    status: "active",
    success_condition: { type: "manual" },
    stop_condition: { type: "none" },
    reply_branches: [],
    plan: [],
    current_step_index: 0,
    schedule: { deadline: null, recurrence: null, timezone: null },
    event_conditions: [],
    communication_preferences: { allowed_channels: [], escalation_policy: "notify_requester" },
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
    last_evaluated_at: null,
    next_evaluation_at: null,
    completion_reason: null,
    created_at: "2026-09-26T09:00:00.000Z",
    updated_at: "2026-09-26T09:00:00.000Z",
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

console.log("\n=== A: target acquisition healthy + authoritative healthy -> achieved ===");
await check("a fresh acquired frame with no impairment yields achieved", async () => {
  resetAll();
  seedHealthyCamera("cam-a");
  const [evaluation] = await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-a", estateId: ESTATE_ID } }]);
  assert.equal(evaluation.observedOverall, "healthy");
  assert.equal(evaluation.result, "achieved");
});

console.log("\n=== B: target healthy + authoritative degraded -> contradicted (honest, not fabricated failure) ===");
await check("edge-impaired degraded overall yields contradicted with reasons preserved", async () => {
  resetAll();
  seedDegradedByEdgeCamera("cam-b", "edge-b");
  const [evaluation] = await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-b", estateId: ESTATE_ID } }]);
  assert.equal(evaluation.observedOverall, "degraded");
  assert.equal(evaluation.result, "contradicted");
  assert.ok(evaluation.reasons.includes("edge_telemetry_impaired_not_physical_camera_offline"));
});

console.log("\n=== C: target healthy + unknown -> unverified ===");
await check("no evidence at all yields unverified, never a fabricated failure", async () => {
  resetAll();
  seedUnknownCamera("cam-c");
  const [evaluation] = await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-c", estateId: ESTATE_ID } }]);
  assert.equal(evaluation.observedOverall, "unknown");
  assert.equal(evaluation.result, "unverified");
});

console.log("\n=== D: Edge expired alone -> no fabricated camera failure (degraded, not unavailable) ===");
await check("edge expiry alone pushes overall to degraded, never unavailable, per the frozen invariant", async () => {
  resetAll();
  seedDegradedByEdgeCamera("cam-d", "edge-d");
  const [evaluation] = await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-d", estateId: ESTATE_ID } }]);
  assert.notEqual(evaluation.observedOverall, "unavailable", "Edge expiry alone must never fabricate a camera acquisition failure");
  assert.equal(evaluation.observedOverall, "degraded");
});

console.log("\n=== E: historical healthy evaluation remains after later degradation ===");
await check("an earlier achieved feedback row is never deleted/overwritten by a later contradicted evaluation", async () => {
  resetAll();
  seedHealthyCamera("cam-e");
  const first = await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-e", estateId: ESTATE_ID, goalId: "goal-e" } }]);
  assert.equal(first[0].result, "achieved");
  // Camera degrades later -- re-seed with edge impairment, same camera id,
  // a deliberately LATER observedAt so this is genuinely distinct
  // evidence (never relying on wall-clock granularity between two
  // synchronous calls, which could otherwise land in the same
  // millisecond and be mistaken for the same evidence).
  tables.facility_cameras = tables.facility_cameras.filter((c) => c.id !== "cam-e");
  tables.edge_nodes = [];
  seedDegradedByEdgeCamera("cam-e", "edge-e2", new Date(Date.now() + 5000).toISOString());
  const second = await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-e", estateId: ESTATE_ID, goalId: "goal-e" } }]);
  assert.equal(second[0].result, "contradicted");
  const rows = tables.intelligence_feedback.filter((r) => r.object_type === "camera_state_outcome");
  assert.equal(rows.length, 2, "both the earlier achieved row and the later contradicted row must remain -- history is never rewritten");
});

console.log("\n=== unavailable overall (a real fresh failure) -> contradicted, with honest wording ===");
await check("a fresh failed frame attempt (no successful path) yields contradicted, never claiming physical death", async () => {
  resetAll();
  seedUnavailableCamera("cam-unavail");
  const [evaluation] = await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-unavail", estateId: ESTATE_ID } }]);
  assert.equal(evaluation.observedOverall, "unavailable");
  assert.equal(evaluation.result, "contradicted");
  assert.ok(evaluation.notes.includes("never physical/electrical/network camera death"));
});

console.log("\n=== F: maintenance status completed, no resident verification -> not automatically achieved ===");
await check("completed status alone never yields achieved", async () => {
  resetAll();
  seedMaintenance({ id: "req-f", status: "completed", completedAt: "2026-09-25T10:00:00.000Z", verifiedByResident: false });
  const [evaluation] = await evaluateMaintenanceOutcomes([{ lineage: { maintenanceRequestId: "req-f" } }]);
  assert.equal(evaluation.result, "unverified");
});

console.log("\n=== G: verified_by_resident=true with valid prerequisites -> achieved ===");
await check("verified_by_resident=true with completed_at present is trusted", async () => {
  resetAll();
  seedMaintenance({ id: "req-g", status: "completed", completedAt: "2026-09-25T10:00:00.000Z", verifiedByResident: true });
  const [evaluation] = await evaluateMaintenanceOutcomes([{ lineage: { maintenanceRequestId: "req-g" } }]);
  assert.equal(evaluation.result, "achieved");
  assert.equal(evaluation.integritySequenceValid, true);
});

console.log("\n=== H: resident rating high, verification absent -> not factual achievement ===");
await check("resident_rating is never read as outcome evidence by this evaluator", async () => {
  resetAll();
  seedMaintenance({ id: "req-h", status: "completed", completedAt: "2026-09-25T10:00:00.000Z", verifiedByResident: false });
  const [evaluation] = await evaluateMaintenanceOutcomes([{ lineage: { maintenanceRequestId: "req-h" } }]);
  assert.equal(evaluation.result, "unverified");
  const src = require("fs").readFileSync(path.join(backendRoot, "src/services/maintenanceOutcomeEvaluator.ts"), "utf8");
  assert.ok(!src.includes(".select(") || !src.match(/\.select\([^)]*resident_rating/), "the maintenance_requests select() must never fetch resident_rating");
  assert.ok(!src.includes("row.resident_rating") && !src.includes(".resident_rating\b"), "the actual evaluation code must never property-access resident_rating");
});

console.log("\n=== Integrity gate: verified_by_resident=true but completed_at missing -> unverified, never blindly trusted ===");
await check("the disclosed integrity gap is defended against at read time", async () => {
  resetAll();
  seedMaintenance({ id: "req-integrity", status: null, completedAt: null, verifiedByResident: true });
  const [evaluation] = await evaluateMaintenanceOutcomes([{ lineage: { maintenanceRequestId: "req-integrity" } }]);
  assert.equal(evaluation.result, "unverified");
  assert.equal(evaluation.integritySequenceValid, false);
});

console.log("\n=== I: no negative factual authority exists -> unverified, never not_achieved ===");
await check("maintenance never produces a not_achieved result (no such column exists)", async () => {
  resetAll();
  seedMaintenance({ id: "req-i", status: "cancelled", completedAt: null, verifiedByResident: false });
  const [evaluation] = await evaluateMaintenanceOutcomes([{ lineage: { maintenanceRequestId: "req-i" } }]);
  assert.equal(evaluation.result, "unverified");
});

console.log("\n=== J: no evidence -> unverified ===");
await check("an unresolvable maintenance_request_id is honestly unverified", async () => {
  resetAll();
  const [evaluation] = await evaluateMaintenanceOutcomes([{ lineage: { maintenanceRequestId: "req-missing" } }]);
  assert.equal(evaluation.result, "unverified");
});

console.log("\n=== K: approved only -> not yet achieved (unverified, still possible) ===");
await check("approved status without entry evidence is unverified, not not_achieved", async () => {
  resetAll();
  seedVisitor({ id: "visit-k", status: "approved" });
  const [evaluation] = await evaluateVisitorOutcomes([{ lineage: { visitorAccessId: "visit-k" } }]);
  assert.equal(evaluation.result, "unverified");
});

console.log("\n=== L: entered -> achieved ===");
await check("entered status with analytics arrived_at yields achieved", async () => {
  resetAll();
  seedVisitor({ id: "visit-l", status: "entered", arrivedAt: "2026-09-25T10:00:00.000Z" });
  const [evaluation] = await evaluateVisitorOutcomes([{ lineage: { visitorAccessId: "visit-l" } }]);
  assert.equal(evaluation.result, "achieved");
  assert.equal(evaluation.evidenceSource, "visitor_analytics");
});

console.log("\n=== M: entered then exited -> historical entry achieved, not undone ===");
await check("exited status does not erase the historical entry fact", async () => {
  resetAll();
  seedVisitor({ id: "visit-m", status: "exited", arrivedAt: "2026-09-25T10:00:00.000Z", exitedAt: "2026-09-25T12:00:00.000Z" });
  const [evaluation] = await evaluateVisitorOutcomes([{ lineage: { visitorAccessId: "visit-m" } }]);
  assert.equal(evaluation.result, "achieved");
  assert.equal(evaluation.arrivedAt, "2026-09-25T10:00:00.000Z");
});

console.log("\n=== N: denied/expired before entry -> not achieved ===");
await check("denied with no entry evidence is honestly not_achieved", async () => {
  resetAll();
  seedVisitor({ id: "visit-n1", status: "denied" });
  const denied = await evaluateVisitorOutcomes([{ lineage: { visitorAccessId: "visit-n1" } }]);
  assert.equal(denied[0].result, "not_achieved");
});
await check("expired with no entry evidence is honestly not_achieved", async () => {
  resetAll();
  seedVisitor({ id: "visit-n2", status: "expired" });
  const expired = await evaluateVisitorOutcomes([{ lineage: { visitorAccessId: "visit-n2" } }]);
  assert.equal(expired[0].result, "not_achieved");
});

console.log("\n=== O: unknown/missing lifecycle -> unverified ===");
await check("an unresolvable visitor_access_id is honestly unverified", async () => {
  resetAll();
  const [evaluation] = await evaluateVisitorOutcomes([{ lineage: { visitorAccessId: "visit-missing" } }]);
  assert.equal(evaluation.result, "unverified");
  assert.equal(evaluation.evidenceSource, "not_found");
});

console.log("\n=== P: one shared Goal outcome interface represents Device/Camera/Maintenance/Visitor/Commercial without flattening provenance ===");
await check("each domain's Goal outcome carries its own distinct provenance + sub-object, never collapsed", async () => {
  resetAll();
  seedHealthyCamera("cam-p");
  seedMaintenance({ id: "req-p", status: "completed", completedAt: "2026-09-25T10:00:00.000Z", verifiedByResident: true });
  seedVisitor({ id: "visit-p", status: "entered", arrivedAt: "2026-09-25T10:00:00.000Z" });

  const cameraGoal = goalFixture({ id: "goal-p-camera", target_entities: { estate_id: ESTATE_ID, camera_id: "cam-p" } });
  const maintenanceGoal = goalFixture({ id: "goal-p-maintenance", target_entities: { maintenance_request_id: "req-p" } });
  const visitorGoal = goalFixture({ id: "goal-p-visitor", target_entities: { visitor_access_id: "visit-p" } });

  const cameraOutcome = await deriveGoalOutcome(cameraGoal);
  const maintenanceOutcome = await deriveGoalOutcome(maintenanceGoal);
  const visitorOutcome = await deriveGoalOutcome(visitorGoal);

  assert.equal(cameraOutcome.provenance, "camera_state_evaluation");
  assert.ok(cameraOutcome.camera && !cameraOutcome.maintenance && !cameraOutcome.visitor && !cameraOutcome.commercial);
  assert.equal(maintenanceOutcome.provenance, "maintenance_resident_verification");
  assert.ok(maintenanceOutcome.maintenance && !maintenanceOutcome.camera && !maintenanceOutcome.visitor);
  assert.equal(visitorOutcome.provenance, "visitor_entry_evidence");
  assert.ok(visitorOutcome.visitor && !visitorOutcome.camera && !visitorOutcome.maintenance);
});

console.log("\n=== Q: one domain's evidence can never satisfy another domain's Goal ===");
await check("a Goal naming a maintenance_request_id never gets evaluated against camera/visitor evidence", async () => {
  resetAll();
  seedHealthyCamera("cam-q");
  seedMaintenance({ id: "req-q", status: "completed", completedAt: "2026-09-25T10:00:00.000Z", verifiedByResident: false });
  const goal = goalFixture({ id: "goal-q", target_entities: { maintenance_request_id: "req-q" } });
  const outcome = await deriveGoalOutcome(goal);
  assert.equal(outcome.provenance, "maintenance_resident_verification");
  assert.equal(outcome.state, "unverified", "the healthy camera evidence must have zero bearing on this maintenance Goal");
});

console.log("\n=== R: evaluator does zero physical/provider side effects ===");
await check("none of the three new evaluator modules ever call a device/provider execution path", async () => {
  for (const file of ["src/modules/cameras/cameraOutcomeEvaluator.ts", "src/services/maintenanceOutcomeEvaluator.ts", "src/services/visitorOutcomeEvaluator.ts"]) {
    const src = require("fs").readFileSync(path.join(backendRoot, file), "utf8");
    assert.ok(!src.includes("executeDeviceCommandForActor") && !src.includes("executeRegisteredAction") && !/\.patch\(|\.update\(/.test(src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")), `${file} must perform zero writes/commands`);
  }
});

console.log("\n=== S: evaluator changes zero learning parameters ===");
await check("none of the three new evaluator modules reference oyi_learning_parameters", async () => {
  for (const file of ["src/modules/cameras/cameraOutcomeEvaluator.ts", "src/services/maintenanceOutcomeEvaluator.ts", "src/services/visitorOutcomeEvaluator.ts"]) {
    const src = require("fs").readFileSync(path.join(backendRoot, file), "utf8");
    assert.ok(!src.includes("oyi_learning_parameters") && !src.includes("learningParameters"));
  }
});

console.log("\n=== T: evaluator changes zero Decision/Goal history ===");
await check("none of the three new evaluator modules ever write to oyi_decisions or oyi_goals", async () => {
  for (const file of ["src/modules/cameras/cameraOutcomeEvaluator.ts", "src/services/maintenanceOutcomeEvaluator.ts", "src/services/visitorOutcomeEvaluator.ts"]) {
    const src = require("fs").readFileSync(path.join(backendRoot, file), "utf8");
    assert.ok(!src.includes("oyi_decisions") && !src.includes("oyi_goals"));
  }
});

console.log("\n=== Feedback identity/idempotency: concurrent identical evaluations -> one factual feedback row ===");
await check("re-evaluating the exact same evidence for the same camera does not create a duplicate row", async () => {
  resetAll();
  seedHealthyCamera("cam-idem");
  await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-idem", estateId: ESTATE_ID, goalId: "goal-idem" } }]);
  await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-idem", estateId: ESTATE_ID, goalId: "goal-idem" } }]);
  const rows = tables.intelligence_feedback.filter((r) => r.object_type === "camera_state_outcome");
  assert.equal(rows.length, 1, "identical evidence re-evaluated must produce exactly one feedback row, not two");
});

console.log("\n=== Cross-domain object_type isolation under Slice 5's shared feedback_type index ===");
await check("camera/maintenance/visitor feedback rows never collide with each other despite sharing feedback_type='outcome_evaluation'", async () => {
  resetAll();
  seedHealthyCamera("cam-cross");
  seedMaintenance({ id: "cam-cross", status: "completed", completedAt: "2026-09-25T10:00:00.000Z", verifiedByResident: true });
  seedVisitor({ id: "cam-cross", status: "entered", arrivedAt: "2026-09-25T10:00:00.000Z" });
  await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-cross", estateId: ESTATE_ID } }]);
  await evaluateMaintenanceOutcomes([{ lineage: { maintenanceRequestId: "cam-cross" } }]);
  await evaluateVisitorOutcomes([{ lineage: { visitorAccessId: "cam-cross" } }]);
  const rows = tables.intelligence_feedback.filter((r) => r.feedback_type === "outcome_evaluation");
  assert.equal(rows.length, 3, "the SAME identity string across 3 different object_types must yield 3 independent rows, never a false collision");
  const objectTypes = new Set(rows.map((r) => r.object_type));
  assert.equal(objectTypes.size, 3);
});

console.log("\n=== Performance: batch evaluation costs a fixed number of reads regardless of Goal count ===");
for (const n of [1, 10, 50, 100]) {
  await check(`deriveGoalOutcomesBatch with ${n} camera Goals in the SAME estate issues a fixed number of facility_cameras/edge_nodes reads`, async () => {
    resetAll();
    for (let i = 0; i < n; i += 1) seedHealthyCamera(`cam-batch-${i}`);
    let facilityCameraCalls = 0;
    const originalFrom = supabaseClientModule.supabaseAdmin.from;
    supabaseClientModule.supabaseAdmin.from = (table) => {
      if (table === "facility_cameras") facilityCameraCalls += 1;
      return fakeFrom(table);
    };
    try {
      const goals = Array.from({ length: n }, (_, i) => goalFixture({ id: `goal-batch-${i}`, target_entities: { estate_id: ESTATE_ID, camera_id: `cam-batch-${i}` } }));
      const outcomes = await deriveGoalOutcomesBatch(goals);
      assert.equal(outcomes.length, n);
      assert.ok(outcomes.every((o) => o.state === "achieved"));
      assert.equal(facilityCameraCalls, 1, `expected exactly 1 facility_cameras read for ${n} Goals in one estate, got ${facilityCameraCalls}`);
    } finally {
      supabaseClientModule.supabaseAdmin.from = originalFrom;
    }
  });
}

console.log("\n=== Batch: mixed camera/maintenance/visitor/device/no-target Goals all resolve correctly in one call ===");
await check("a mixed batch partitions correctly and preserves input order across all Slice 6 domains", async () => {
  resetAll();
  seedHealthyCamera("cam-mix");
  seedMaintenance({ id: "req-mix", status: "completed", completedAt: "2026-09-25T10:00:00.000Z", verifiedByResident: true });
  seedVisitor({ id: "visit-mix", status: "entered", arrivedAt: "2026-09-25T10:00:00.000Z" });
  const cameraGoal = goalFixture({ id: "goal-mix-camera", target_entities: { estate_id: ESTATE_ID, camera_id: "cam-mix" } });
  const maintenanceGoal = goalFixture({ id: "goal-mix-maintenance", target_entities: { maintenance_request_id: "req-mix" } });
  const visitorGoal = goalFixture({ id: "goal-mix-visitor", target_entities: { visitor_access_id: "visit-mix" } });
  const legacyGoal = goalFixture({ id: "goal-mix-legacy", target_entities: { lead_id: "lead-mix" } });
  const outcomes = await deriveGoalOutcomesBatch([cameraGoal, maintenanceGoal, visitorGoal, legacyGoal]);
  assert.deepEqual(outcomes.map((o) => o.goalId), ["goal-mix-camera", "goal-mix-maintenance", "goal-mix-visitor", "goal-mix-legacy"]);
  assert.equal(outcomes[0].state, "achieved");
  assert.equal(outcomes[0].provenance, "camera_state_evaluation");
  assert.equal(outcomes[1].state, "achieved");
  assert.equal(outcomes[1].provenance, "maintenance_resident_verification");
  assert.equal(outcomes[2].state, "achieved");
  assert.equal(outcomes[2].provenance, "visitor_entry_evidence");
  assert.equal(outcomes[3].provenance, "no_evaluator_available");
});

console.log("\n=== Causal ceiling: every evaluation carries an explicit causal note ===");
await check("camera/maintenance/visitor evaluations each state the causal ceiling explicitly", async () => {
  resetAll();
  seedHealthyCamera("cam-causal");
  seedMaintenance({ id: "req-causal", status: "completed", completedAt: "2026-09-25T10:00:00.000Z", verifiedByResident: true });
  seedVisitor({ id: "visit-causal", status: "entered", arrivedAt: "2026-09-25T10:00:00.000Z" });
  const [camera] = await evaluateCameraOutcomes([{ lineage: { cameraId: "cam-causal", estateId: ESTATE_ID } }]);
  const [maintenance] = await evaluateMaintenanceOutcomes([{ lineage: { maintenanceRequestId: "req-causal" } }]);
  const [visitor] = await evaluateVisitorOutcomes([{ lineage: { visitorAccessId: "visit-causal" } }]);
  for (const evaluation of [camera, maintenance, visitor]) {
    assert.ok(evaluation.causalNote.toLowerCase().includes("does not establish") || evaluation.causalNote.toLowerCase().includes("never claims"));
  }
});

console.log("");
console.log(`=== wave8-slice6-remaining-domain-outcome-evaluators-smoke: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
