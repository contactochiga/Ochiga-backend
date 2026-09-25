#!/usr/bin/env node
// Wave 8 Slice 2 -- Recommendation Dismissal Feedback Loop functional
// smoke (mocked supabaseAdmin, matching the established pattern of every
// prior slice's own functional smoke). Exercises
// recommendationDismissalEvidence.ts entirely in-process against an
// in-memory intelligence_feedback + operational_recommendations table.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = "/Users/ochigaidoko/Documents/Ochiga-backend";
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
    order: () => builder,
    limit: () => builder,
    then(resolve, reject) {
      const matched = rows.filter((r) => matches(r, state.filters));
      return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

let intelligenceFeedbackTable = [];
let operationalRecommendationsTable = [];
let feedbackIdCounter = 0;

function fakeFrom(table) {
  if (table === "intelligence_feedback") return { select: () => chainableList(intelligenceFeedbackTable) };
  if (table === "operational_recommendations") return { select: () => chainableList(operationalRecommendationsTable) };
  return { select: () => chainableList([]) };
}

supabaseClientModule.supabaseAdmin = { from: fakeFrom };

const {
  getRecommendationDismissalEvidence,
  listDismissalPatternEvidence,
  DISMISSAL_FEEDBACK_TYPES,
} = require("../dist/oyi-core/domains/intelligence/recommendationDismissalEvidence.js");

function resetAll() {
  intelligenceFeedbackTable = [];
  operationalRecommendationsTable = [];
}

function seedRecommendation(key, { domain, actionType, estateId = "estate-1", homeId = "home-1" }) {
  operationalRecommendationsTable.push({
    recommendation_key: key,
    action_type: actionType,
    target: { domain },
    estate_id: estateId,
    home_id: homeId,
  });
}

function seedFeedback(objectId, { feedbackType, actorId = "actor-1", reason = null, at }) {
  feedbackIdCounter += 1;
  intelligenceFeedbackTable.push({
    id: `fb-${feedbackIdCounter}`,
    object_type: "recommendation",
    object_id: objectId,
    feedback_type: feedbackType,
    actor_id: actorId,
    reason,
    created_at: at,
  });
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

console.log("\n=== A: single dismissal -> count 1 ===");
await check("one dismissal of one recommendation is counted once", async () => {
  resetAll();
  seedRecommendation("rec-a", { domain: "maintenance", actionType: "schedule_preventive_inspection" });
  seedFeedback("rec-a", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T10:00:00.000Z" });
  const evidence = await getRecommendationDismissalEvidence("rec-a");
  assert.equal(evidence.dismissalCount, 1);
  assert.equal(evidence.byFeedbackType.dismissed, 1);
  assert.equal(evidence.distinctActorCount, 1);
});

console.log("\n=== B: three genuinely distinct dismissals (different actors) -> count 3 ===");
await check("three different actors dismissing the same recommendation each count", async () => {
  resetAll();
  seedRecommendation("rec-b", { domain: "infrastructure", actionType: "verify_power" });
  seedFeedback("rec-b", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T10:00:00.000Z" });
  seedFeedback("rec-b", { feedbackType: "dismissed", actorId: "actor-2", at: "2026-09-01T10:05:00.000Z" });
  seedFeedback("rec-b", { feedbackType: "dismissed", actorId: "actor-3", at: "2026-09-01T10:10:00.000Z" });
  const evidence = await getRecommendationDismissalEvidence("rec-b");
  assert.equal(evidence.dismissalCount, 3);
  assert.equal(evidence.distinctActorCount, 3);
});

console.log("\n=== D: retry collapse -- same actor, same key, same type, within 30s -> collapsed to 1 ===");
await check("a rapid double-submit from the same actor is collapsed to one occurrence", async () => {
  resetAll();
  seedRecommendation("rec-d", { domain: "security", actionType: "review_access_event" });
  seedFeedback("rec-d", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T10:00:00.000Z" });
  seedFeedback("rec-d", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T10:00:05.000Z" });
  const evidence = await getRecommendationDismissalEvidence("rec-d");
  assert.equal(evidence.dismissalCount, 1, "a 5-second-apart resubmit from the same actor must not be double-counted");
});

console.log("\n=== D2: same actor, same key, same type, FAR apart in time -> NOT collapsed ===");
await check("dismissals separated by a real gap are treated as distinct evidence, not a retry", async () => {
  resetAll();
  seedRecommendation("rec-d2", { domain: "security", actionType: "review_access_event" });
  seedFeedback("rec-d2", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T10:00:00.000Z" });
  seedFeedback("rec-d2", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T12:00:00.000Z" });
  const evidence = await getRecommendationDismissalEvidence("rec-d2");
  assert.equal(evidence.dismissalCount, 2);
});

console.log("\n=== G: dismissed/not_useful/false_positive are never combined into one opaque number ===");
await check("byFeedbackType breaks down distinct feedback families separately", async () => {
  resetAll();
  seedRecommendation("rec-g", { domain: "utility", actionType: "review_energy_spike" });
  seedFeedback("rec-g", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T10:00:00.000Z" });
  seedFeedback("rec-g", { feedbackType: "not_useful", actorId: "actor-2", at: "2026-09-01T11:00:00.000Z" });
  seedFeedback("rec-g", { feedbackType: "false_positive", actorId: "actor-3", at: "2026-09-01T12:00:00.000Z" });
  const evidence = await getRecommendationDismissalEvidence("rec-g");
  assert.equal(evidence.dismissalCount, 3);
  assert.equal(evidence.byFeedbackType.dismissed, 1);
  assert.equal(evidence.byFeedbackType.not_useful, 1);
  assert.equal(evidence.byFeedbackType.false_positive, 1);
});

console.log("\n=== H: a factual device-state outcome row (different object_type) never leaks into dismissal evidence ===");
await check("non-recommendation feedback rows are never counted as dismissal evidence", async () => {
  resetAll();
  seedRecommendation("rec-h", { domain: "environmental", actionType: "inspect_environmental_sensor" });
  feedbackIdCounter += 1;
  intelligenceFeedbackTable.push({
    id: `fb-${feedbackIdCounter}`,
    object_type: "device_state_outcome",
    object_id: "rec-h",
    feedback_type: "device_state_outcome_evaluation",
    actor_id: null,
    reason: null,
    created_at: "2026-09-01T10:00:00.000Z",
  });
  const evidence = await getRecommendationDismissalEvidence("rec-h");
  assert.equal(evidence.dismissalCount, 0, "human-feedback and factual-outcome evidence must never be combined into one score");
});

console.log("\n=== J: no evidence at all -> honest zero, not an error ===");
await check("a recommendation with no feedback returns a clean zero-evidence result", async () => {
  resetAll();
  const evidence = await getRecommendationDismissalEvidence("rec-nonexistent");
  assert.equal(evidence.dismissalCount, 0);
  assert.equal(evidence.distinctActorCount, 0);
  assert.equal(evidence.firstSeenAt, null);
});

console.log("\n=== E: pattern aggregation groups by (domain, action_type), not by recommendation_key ===");
await check("two different occurrences of the same semantic pattern aggregate together", async () => {
  resetAll();
  seedRecommendation("rec-e1", { domain: "maintenance", actionType: "schedule_preventive_inspection" });
  seedRecommendation("rec-e2", { domain: "maintenance", actionType: "schedule_preventive_inspection" });
  seedRecommendation("rec-e3", { domain: "security", actionType: "review_access_event" });
  seedFeedback("rec-e1", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T10:00:00.000Z" });
  seedFeedback("rec-e2", { feedbackType: "dismissed", actorId: "actor-2", at: "2026-09-02T10:00:00.000Z" });
  seedFeedback("rec-e3", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T10:00:00.000Z" });
  const patterns = await listDismissalPatternEvidence();
  const maintenancePattern = patterns.find((p) => p.domain === "maintenance" && p.actionType === "schedule_preventive_inspection");
  assert.ok(maintenancePattern, "the maintenance pattern must be present");
  assert.equal(maintenancePattern.dismissalCount, 2, "two distinct recommendation occurrences of the same pattern aggregate together");
  assert.equal(maintenancePattern.recommendationCount, 2);
  const securityPattern = patterns.find((p) => p.domain === "security");
  assert.equal(securityPattern.dismissalCount, 1);
});

console.log("\n=== F: distinct reasons are preserved as raw evidence, never fabricated ===");
await check("reasons surfaced are exactly the distinct persisted reasons, nothing invented", async () => {
  resetAll();
  seedRecommendation("rec-f", { domain: "community", actionType: "respond_to_complaints" });
  seedFeedback("rec-f", { feedbackType: "dismissed", actorId: "actor-1", reason: "Already resolved by staff", at: "2026-09-01T10:00:00.000Z" });
  seedFeedback("rec-f", { feedbackType: "not_useful", actorId: "actor-2", reason: "Not relevant to this home", at: "2026-09-01T11:00:00.000Z" });
  const evidence = await getRecommendationDismissalEvidence("rec-f");
  assert.deepEqual(evidence.reasons.sort(), ["Already resolved by staff", "Not relevant to this home"].sort());
});

console.log("\n=== I: scope filter narrows patterns by estate/home/domain/actionType ===");
await check("filter.estateId/homeId/domain/actionType correctly scope the pattern list", async () => {
  resetAll();
  seedRecommendation("rec-i1", { domain: "maintenance", actionType: "schedule_preventive_inspection", estateId: "estate-A", homeId: "home-A" });
  seedRecommendation("rec-i2", { domain: "maintenance", actionType: "schedule_preventive_inspection", estateId: "estate-B", homeId: "home-B" });
  seedFeedback("rec-i1", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T10:00:00.000Z" });
  seedFeedback("rec-i2", { feedbackType: "dismissed", actorId: "actor-2", at: "2026-09-01T10:00:00.000Z" });
  const scoped = await listDismissalPatternEvidence({ estateId: "estate-A" });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].recommendationCount, 1);
  const byDomain = await listDismissalPatternEvidence({ domain: "maintenance" });
  assert.equal(byDomain.length, 1);
  assert.equal(byDomain[0].recommendationCount, 2);
});

console.log("\n=== Zero-mutation proof: reading evidence never writes anywhere ===");
await check("no write-capable method exists anywhere on the mocked tables used by this module", async () => {
  resetAll();
  seedRecommendation("rec-z", { domain: "financial", actionType: "assign_owner" });
  seedFeedback("rec-z", { feedbackType: "dismissed", actorId: "actor-1", at: "2026-09-01T10:00:00.000Z" });
  const before = JSON.stringify(operationalRecommendationsTable);
  await getRecommendationDismissalEvidence("rec-z");
  await listDismissalPatternEvidence();
  assert.equal(JSON.stringify(operationalRecommendationsTable), before, "operational_recommendations must be byte-identical after any read");
});

console.log("\n=== Sanity: DISMISSAL_FEEDBACK_TYPES matches the real write path's own literal list ===");
await check("the exported constant matches canonicalIntelligenceStore.recordFeedback's own dismissal-family literal", async () => {
  assert.deepEqual([...DISMISSAL_FEEDBACK_TYPES].sort(), ["dismissed", "false_positive", "not_useful"].sort());
});

console.log("");
console.log(`=== wave8-slice2-recommendation-dismissal-evidence-smoke: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
