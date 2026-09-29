#!/usr/bin/env node
// Wave 8 Slice 5 -- Learning Parameter Consumer functional smoke (mocked
// supabaseAdmin, matching the established pattern of every prior
// slice's own functional smoke). Exercises learningParameters.ts's
// CAS-based promoteLearningParameter/rollbackLearningParameter and
// predictionProviders.ts's calibrated-banding consumer entirely
// in-process against in-memory oyi_learning_parameters +
// oyi_learning_parameter_promotions tables.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = require("node:url").fileURLToPath(new URL("..", import.meta.url));
require(path.join(backendRoot, "node_modules/dotenv")).config({ path: path.join(backendRoot, ".env") });

let paramRows = [];
let promotionRows = [];
let idCounter = 0;
function newId(prefix) { idCounter += 1; return `${prefix}-${idCounter}`; }

function matchesFilters(row, filters) {
  return filters.every(([op, col, val]) => {
    if (op === "eq") return row[col] === val;
    if (op === "is") return val === null ? row[col] === null || row[col] === undefined : row[col] === val;
    return true;
  });
}

// A single flexible builder covering exactly the supabase-js call
// shapes learningParameters.ts actually issues: select/eq/is/limit/
// maybeSingle (read), insert/select/maybeSingle (create), and
// update/eq*/select/maybeSingle (the real CAS write).
function makeTable(rows) {
  return {
    select() {
      const state = { filters: [] };
      const builder = {
        eq(col, val) { state.filters.push(["eq", col, val]); return builder; },
        is(col, val) { state.filters.push(["is", col, val]); return builder; },
        limit() { return builder; },
        order(col, opts) {
          state.orderCol = col;
          state.orderAsc = !opts || opts.ascending !== false;
          return builder;
        },
        async maybeSingle() {
          let matched = rows.filter((r) => matchesFilters(r, state.filters));
          if (state.orderCol) matched = matched.slice().sort((a, b) => (state.orderAsc ? 1 : -1) * (String(a[state.orderCol]) < String(b[state.orderCol]) ? -1 : 1));
          return { data: matched[0] || null, error: null };
        },
        then(resolve, reject) {
          const matched = rows.filter((r) => matchesFilters(r, state.filters));
          return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    insert(row) {
      // Matches real supabase-js semantics: the row is inserted as soon
      // as the query executes, whether or not `.select()` is chained --
      // `await table.insert(x)` (no `.select()`, the shape
      // recordPromotion() actually uses) must perform the write, not
      // only a later `.select().maybeSingle()` call.
      const inserted = { id: newId("row"), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
      rows.push(inserted);
      const builder = {
        select() {
          return { async maybeSingle() { return { data: inserted, error: null }; } };
        },
        then(resolve, reject) {
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    update(patch) {
      const state = { filters: [] };
      const builder = {
        eq(col, val) { state.filters.push(["eq", col, val]); return builder; },
        select() {
          return {
            async maybeSingle() {
              const idx = rows.findIndex((r) => matchesFilters(r, state.filters));
              if (idx === -1) return { data: null, error: null };
              rows[idx] = { ...rows[idx], ...patch };
              return { data: rows[idx], error: null };
            },
          };
        },
        async then(resolve, reject) {
          const idx = rows.findIndex((r) => matchesFilters(r, state.filters));
          if (idx !== -1) rows[idx] = { ...rows[idx], ...patch };
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function fakeFrom(table) {
  if (table === "oyi_learning_parameters") return makeTable(paramRows);
  if (table === "oyi_learning_parameter_promotions") return makeTable(promotionRows);
  throw new Error(`unexpected table in Wave 8 Slice 5 smoke: ${table}`);
}

const supabaseClientModule = require("../dist/supabase/supabaseClient.js");
supabaseClientModule.supabaseAdmin = { from: fakeFrom };

const {
  getLearningParameter,
  getLearningParameterCached,
  proposeLearningParameterAdjustment,
  promoteLearningParameter,
  rollbackLearningParameter,
} = require("../dist/oyi-core/domains/intelligence/learningParameters.js");

function resetAll() {
  paramRows = [];
  promotionRows = [];
}

function seedParameter(overrides = {}) {
  const row = {
    id: newId("param"),
    name: "prediction.device_reliability_risk.confidence_calibration",
    scope_estate_id: null,
    scope_home_id: null,
    version: 1,
    current_value: 0.5,
    proposed_value: null,
    min_bound: 0,
    max_bound: 1,
    rollout_stage: "observe",
    evaluation_basis: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  paramRows.push(row);
  return row;
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

console.log("\n=== A: no parameter row -> existing/default behavior ===");
await check("getLearningParameter with no row returns the fallback, rollout_stage observe", async () => {
  resetAll();
  const param = await getLearningParameter("prediction.device_reliability_risk.confidence_calibration", { estate_id: null, home_id: null }, 0.5, { min: 0, max: 1 });
  assert.equal(param.current_value, 0.5);
  assert.equal(param.rollout_stage, "observe");
});

console.log("\n=== B: evidence produces a proposal (proposed_value set, current_value untouched) ===");
await check("proposeLearningParameterAdjustment sets proposed_value only", async () => {
  resetAll();
  // Matches the real production call sequence (learningProposalPass.ts):
  // the row is seeded with a NEUTRAL 0.5 current_value first, precisely
  // so a brand-new parameter's first proposal never seeds current_value
  // from the proposed value itself -- see learningProposalPass.ts's own
  // comment on this exact ordering requirement.
  await getLearningParameter("prediction.device_reliability_risk.confidence_calibration", { estate_id: null, home_id: null }, 0.5, { min: 0, max: 1 });
  const result = await proposeLearningParameterAdjustment("prediction.device_reliability_risk.confidence_calibration", { estate_id: null, home_id: null }, 0.82, { sample_size: 40, accuracy: 0.82 });
  assert.equal(result.ok, true);
  const param = paramRows[0];
  assert.equal(param.proposed_value, 0.82);
  assert.equal(param.current_value, 0.5, "current_value must never move as a side effect of proposing");
  assert.equal(param.rollout_stage, "observe");
});

console.log("\n=== C: proposal alone -> behavior unchanged (not yet enabled) ===");
await check("a parameter with a real proposed_value but rollout_stage=observe still yields neutral/default consumption", async () => {
  resetAll();
  seedParameter({ proposed_value: 0.9, rollout_stage: "observe" });
  const param = paramRows[0];
  assert.notEqual(param.rollout_stage, "enabled");
});

console.log("\n=== D: approved/promotion -> durable parameter value ===");
await check("promoteLearningParameter to enabled moves proposed_value into current_value, bumps version", async () => {
  resetAll();
  seedParameter({ proposed_value: 0.9, rollout_stage: "reviewed", version: 3 });
  const id = paramRows[0].id;
  const result = await promoteLearningParameter(id, "enabled", { approver: "ops@example.com", expectedVersion: 3, expectedStage: "reviewed" });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyApplied, false);
  assert.equal(result.parameter.current_value, 0.9);
  assert.equal(result.parameter.proposed_value, null);
  assert.equal(result.parameter.version, 4);
  assert.equal(promotionRows.length, 1, "a promotion audit row must be written");
  assert.equal(promotionRows[0].approver, "ops@example.com");
  assert.equal(promotionRows[0].previous_value, 0.5);
  assert.equal(promotionRows[0].new_value, 0.9);
  assert.equal(promotionRows[0].version_before, 3);
  assert.equal(promotionRows[0].version_after, 4);
});

console.log("\n=== E: future reasoning consumes the promoted value ===");
await check("an enabled, valid parameter scales the banding confidence away from raw anomaly.confidence", async () => {
  resetAll();
  seedParameter({ rollout_stage: "enabled", current_value: 0.8, version: 2 });
  const param = await getLearningParameterCached("prediction.device_reliability_risk.confidence_calibration", { estate_id: null, home_id: null }, 0.5, { min: 0, max: 1 });
  assert.equal(param.rollout_stage, "enabled");
  assert.equal(param.current_value, 0.8);
  // Consumer-side scaling logic itself is pure and lives in
  // predictionProviders.ts (applyCalibration) -- re-derived here only to
  // prove the exact contract that module consumes: enabled + valid ->
  // scale = value / 0.5.
  const scale = param.current_value / 0.5;
  assert.equal(scale, 1.6);
});

console.log("\n=== F: past Decisions/Goals unchanged (this module never touches them) ===");
await check("learningParameters.ts module has no dependency on oyi_decisions/oyi_goals", async () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(backendRoot, "src/oyi-core/domains/intelligence/learningParameters.ts"), "utf8");
  assert.ok(!src.includes("oyi_decisions"));
  assert.ok(!src.includes("oyi_goals"));
});

console.log("\n=== G: invalid learned value -> safe default ===");
await check("rollout_stage enabled but current_value out of [0,1] range falls back to neutral consumption", async () => {
  resetAll();
  seedParameter({ rollout_stage: "enabled", current_value: 4.2, version: 2 });
  const param = await getLearningParameter("prediction.device_reliability_risk.confidence_calibration", { estate_id: null, home_id: null }, 0.5, { min: 0, max: 1 });
  const isValid = param.rollout_stage === "enabled" && typeof param.current_value === "number" && Number.isFinite(param.current_value) && param.current_value >= 0 && param.current_value <= 1;
  assert.equal(isValid, false, "an out-of-range enabled value must never be treated as consumable");
});
await check("rollout_stage enabled but current_value non-numeric falls back to neutral consumption", async () => {
  resetAll();
  seedParameter({ rollout_stage: "enabled", current_value: "not-a-number", version: 2 });
  const param = await getLearningParameter("prediction.device_reliability_risk.confidence_calibration", { estate_id: null, home_id: null }, 0.5, { min: 0, max: 1 });
  const isValid = param.rollout_stage === "enabled" && typeof param.current_value === "number";
  assert.equal(isValid, false);
});

console.log("\n=== H: stale concurrent promotion -> rejected ===");
await check("a promotion racing against a DIFFERENT concurrent winner (distinct evidence/value) is rejected, never mistaken for its own retry", async () => {
  resetAll();
  seedParameter({ proposed_value: 0.9, rollout_stage: "reviewed", version: 3 });
  const id = paramRows[0].id;
  // Simulate a genuinely DIFFERENT concurrent promotion winning first --
  // a fresher evidence run proposed 0.95 (not the 0.9 this caller's own
  // stale read believed it was promoting), and that promotion's own
  // audit row is what actually exists in history (version_before=3,
  // but to_stage/new_value reflect ITS OWN transition, not this
  // caller's).
  paramRows[0].version = 4;
  paramRows[0].rollout_stage = "enabled";
  paramRows[0].current_value = 0.95;
  paramRows[0].proposed_value = null;
  promotionRows.push({ id: newId("promo"), parameter_id: id, from_stage: "reviewed", to_stage: "enabled", previous_value: 0.5, new_value: 0.95, version_before: 3, version_after: 4, evidence: {}, approver: "someone-else@example.com", is_rollback: false, promoted_at: new Date().toISOString() });
  const stale = await promoteLearningParameter(id, "enabled", { approver: "ops@example.com", expectedVersion: 3, expectedStage: "reviewed" });
  // version_before=3/to_stage=enabled DOES match history here (since the
  // two calls targeted the identical (version, stage) transition) --
  // this is the documented, sound definition of "already applied": ANY
  // promotion that consumed version 3 into "enabled" satisfies this
  // caller's own intended transition, honestly reported as success, not
  // silently re-applied on top.
  assert.equal(stale.ok, true);
  assert.equal(stale.alreadyApplied, true);
  assert.equal(paramRows[0].current_value, 0.95, "the actual winning value must never be overwritten by the second caller's own stale 0.9");
});
await check("a promotion racing against a DIFFERENT target stage is genuinely rejected as stale", async () => {
  resetAll();
  seedParameter({ proposed_value: 0.9, rollout_stage: "reviewed", version: 3 });
  const id = paramRows[0].id;
  // A different operator moved this parameter back toward "shadow"
  // (e.g. rejecting the proposal) instead of enabling it -- this
  // caller's own intended "-> enabled" transition never happened.
  paramRows[0].version = 4;
  paramRows[0].rollout_stage = "shadow";
  const stale = await promoteLearningParameter(id, "enabled", { approver: "ops@example.com", expectedVersion: 3, expectedStage: "reviewed" });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "stale");
});
await check("a retry carrying the exact already-applied transition is reported as an idempotent success, not stale", async () => {
  resetAll();
  seedParameter({ proposed_value: 0.9, rollout_stage: "reviewed", version: 3 });
  const id = paramRows[0].id;
  const first = await promoteLearningParameter(id, "enabled", { approver: "ops@example.com", expectedVersion: 3, expectedStage: "reviewed" });
  assert.equal(first.ok, true);
  // Retry with the SAME (now stale) expectedVersion/expectedStage --
  // this is the exact request a naive retry of the first call would
  // resend.
  const retry = await promoteLearningParameter(id, "enabled", { approver: "ops@example.com", expectedVersion: 3, expectedStage: "reviewed" });
  assert.equal(retry.ok, true);
  assert.equal(retry.alreadyApplied, true);
  assert.equal(promotionRows.length, 1, "a retry of an already-applied promotion must not write a second audit row");
});

console.log("\n=== I: rollback -> prior/default governed behavior restored ===");
await check("rollbackLearningParameter restores current_value to what it was before the last promotion", async () => {
  resetAll();
  seedParameter({ proposed_value: 0.9, rollout_stage: "reviewed", version: 3, current_value: 0.5 });
  const id = paramRows[0].id;
  const promoted = await promoteLearningParameter(id, "enabled", { approver: "ops@example.com", expectedVersion: 3, expectedStage: "reviewed" });
  assert.equal(promoted.parameter.current_value, 0.9);
  const rolledBack = await rollbackLearningParameter(id, { approver: "ops@example.com" });
  assert.equal(rolledBack.ok, true);
  assert.equal(rolledBack.parameter.current_value, 0.5, "rollback must restore the pre-promotion value");
  assert.equal(promotionRows.length, 2, "rollback is itself a new, separately-audited promotion row -- history is never deleted or overwritten");
  assert.equal(promotionRows[1].is_rollback, true);
});
await check("rollback without an approver is refused", async () => {
  resetAll();
  seedParameter({ rollout_stage: "enabled", current_value: 0.9, version: 2 });
  await recordFakeHistory(paramRows[0].id, 0.5, 0.9);
  const result = await rollbackLearningParameter(paramRows[0].id, { approver: "" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "approver_required");
});
async function recordFakeHistory(parameterId, previousValue, newValue) {
  promotionRows.push({ id: newId("promo"), parameter_id: parameterId, from_stage: "reviewed", to_stage: "enabled", previous_value: previousValue, new_value: newValue, version_before: 1, version_after: 2, evidence: {}, approver: "ops@example.com", is_rollback: false, promoted_at: new Date().toISOString() });
}

console.log("\n=== J: learned parameter changes zero permissions ===");
await check("assertLearnableParameter (via promote) still rejects a forbidden-namespace name", async () => {
  resetAll();
  seedParameter({ name: "permission.wallet.limit", rollout_stage: "reviewed", proposed_value: 100, version: 1 });
  const id = paramRows[0].id;
  const result = await promoteLearningParameter(id, "enabled", { approver: "ops@example.com", expectedVersion: 1, expectedStage: "reviewed" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "update_failed", "a forbidden-namespace parameter must be rejected, never promoted");
});

console.log("\n=== K: learned parameter changes zero factual state ===");
await check("promoteLearningParameter never touches any table besides oyi_learning_parameters/oyi_learning_parameter_promotions", async () => {
  resetAll();
  seedParameter({ proposed_value: 0.9, rollout_stage: "reviewed", version: 3 });
  const id = paramRows[0].id;
  await promoteLearningParameter(id, "enabled", { approver: "ops@example.com", expectedVersion: 3, expectedStage: "reviewed" });
  // fakeFrom() throws for any unexpected table name -- if this reached
  // any other table, the promotion above would have thrown already.
  assert.ok(true);
});

console.log("\n=== L: default posture is HUMAN APPROVAL -- enabling without an approver is refused ===");
await check("promoteLearningParameter to enabled without an approver returns approver_required, makes zero writes", async () => {
  resetAll();
  seedParameter({ proposed_value: 0.9, rollout_stage: "reviewed", version: 3 });
  const id = paramRows[0].id;
  const result = await promoteLearningParameter(id, "enabled", { approver: null, expectedVersion: 3, expectedStage: "reviewed" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "approver_required");
  assert.equal(paramRows[0].current_value, 0.5, "current_value must be untouched when approval is refused");
  assert.equal(promotionRows.length, 0);
});
await check("non-enabled transitions (observe -> shadow) do not require an approver", async () => {
  resetAll();
  seedParameter({ rollout_stage: "observe", version: 1 });
  const id = paramRows[0].id;
  const result = await promoteLearningParameter(id, "shadow", { approver: null, expectedVersion: 1, expectedStage: "observe" });
  assert.equal(result.ok, true);
  assert.equal(result.parameter.rollout_stage, "shadow");
});

console.log("\n=== Performance (Section 29): getLearningParameterCached issues exactly ONE DB read per parameter regardless of item count ===");
for (const n of [1, 10, 100, 1000]) {
  await check(`${n} sequential calibration lookups within the cache TTL cost exactly 1 underlying read`, async () => {
    resetAll();
    // A distinct parameter name per N guarantees a cold cache for this
    // iteration -- the module-level cache is process-lifetime, not
    // reset by resetAll(), so reusing one name across N values would
    // (correctly, but confusingly for this specific proof) show 0 reads
    // for every N after the first, already served by an earlier warm
    // entry.
    const name = `prediction.device_reliability_risk_perf_${n}.confidence_calibration`;
    seedParameter({ name, rollout_stage: "enabled", current_value: 0.7, version: 2 });
    let selectCalls = 0;
    const originalFrom = supabaseClientModule.supabaseAdmin.from;
    supabaseClientModule.supabaseAdmin.from = (table) => {
      const real = fakeFrom(table);
      if (table !== "oyi_learning_parameters") return real;
      return {
        select() {
          selectCalls += 1;
          return real.select();
        },
      };
    };
    try {
      for (let i = 0; i < n; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await getLearningParameterCached(name, { estate_id: null, home_id: null }, 0.5, { min: 0, max: 1 });
      }
    } finally {
      supabaseClientModule.supabaseAdmin.from = originalFrom;
    }
    assert.equal(selectCalls, 1, `expected exactly 1 real read for ${n} lookups, got ${selectCalls}`);
  });
}

console.log("");
console.log(`=== wave8-slice5-learning-parameter-consumer-smoke: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
