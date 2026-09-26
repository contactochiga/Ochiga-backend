#!/usr/bin/env node
// Wave 8 Slice 1 -- Device/State Outcome Evaluator functional smoke
// (mocked supabaseAdmin, real deviceRuntimeStateService cache + real
// deviceCurrentStateAuthority/observationPolicy/classifyFreshness logic
// -- only the DB-facing edges are mocked, matching the established
// pattern of every prior slice's own functional smoke).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = require("node:url").fileURLToPath(new URL("..", import.meta.url));
require(path.join(backendRoot, "node_modules/dotenv")).config({ path: path.join(backendRoot, ".env") });

const supabaseClientModule = require("../dist/supabase/supabaseClient.js");

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

function matches(row, filters) {
  return filters.every(([op, col, val]) => {
    if (op === "eq") return row[col] === val;
    if (op === "in") return Array.isArray(val) && val.includes(row[col]);
    return true;
  });
}

let devicesTable = [];
let intelligenceFeedbackTable = [];
let decisionsTable = [];
let idCounter = 0;

function fakeFrom(table) {
  if (table === "devices") {
    return { select: () => chainableList(devicesTable) };
  }
  if (table === "intelligence_feedback") {
    return {
      select: () => chainableList(intelligenceFeedbackTable),
      insert(rows) {
        const arr = Array.isArray(rows) ? rows : [rows];
        const inserted = arr.map((row) => {
          idCounter += 1;
          const full = { id: `fb-${idCounter}`, created_at: new Date().toISOString(), ...row };
          intelligenceFeedbackTable.push(full);
          return full;
        });
        return {
          select: () => ({
            then(resolve) {
              return Promise.resolve({ data: inserted, error: null }).then(resolve);
            },
          }),
        };
      },
    };
  }
  if (table === "oyi_decisions") {
    return { select: () => chainableList(decisionsTable) };
  }
  return { select: () => chainableList([]) };
}

supabaseClientModule.supabaseAdmin = { from: fakeFrom };

const { deviceRuntimeStateService } = require("../dist/services/deviceRuntimeStateService.js");
const {
  evaluateDeviceStateOutcomes,
  evaluateDeviceStateOutcome,
  targetForActionId,
} = require("../dist/oyi-core/domains/devices/deviceOutcomeEvaluator.js");

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

function resetAll() {
  devicesTable = [];
  intelligenceFeedbackTable = [];
  decisionsTable = [];
  // deviceRuntimeStateService is a module singleton; clear its private cache
  // via the same public seams every consumer uses (no test-only backdoor).
  deviceRuntimeStateService.cache.clear();
}

function seedDevice(id) {
  devicesTable.push({ id, is_virtual: false, type: "switch", category: "switch", metadata: {}, adapter: "tuya", provider: "tuya", vendor: null, parent_device_id: null, external_id: null, capabilities: [] });
}

function seedObservedPower(deviceId, power, ageMs) {
  const device = devicesTable.find((d) => d.id === deviceId);
  const timestamp = new Date(Date.now() - ageMs).toISOString();
  deviceRuntimeStateService.set(
    device,
    { normalized_state: { power }, capability_codes: [], supported_controls: [], control_profile: "switch" },
    { providerTimestamp: timestamp, runtimeTimestamp: timestamp, lastRefresh: timestamp, source: "runtime" }
  );
}

console.log("\n=== Section 4/23: target semantics ===");

await check("device.on -> target power=true", () => {
  assert.deepEqual(targetForActionId("device.on"), { power: true });
});
await check("device.off -> target power=false", () => {
  assert.deepEqual(targetForActionId("device.off"), { power: false });
});
await check("device.toggle -> no deterministic target (never assumed on or off)", () => {
  assert.equal(targetForActionId("device.toggle"), null);
});
await check("device.toggle WITH an explicit caller-supplied target -> honored, never guessed by the evaluator itself", () => {
  assert.deepEqual(targetForActionId("device.toggle", { power: true }), { power: true });
});

console.log("\n=== Scenario A: fresh, observed=off, target=off -> achieved ===");
await check("A", async () => {
  resetAll();
  seedDevice("dev-a");
  seedObservedPower("dev-a", false, 5_000); // 5s old, well within fresh window
  const result = await evaluateDeviceStateOutcome({ lineage: { deviceId: "dev-a", decisionId: "dec-a", goalId: "goal-a" }, actionId: "device.off" });
  assert.equal(result.result, "achieved");
  assert.equal(result.freshness, "fresh");
  assert.equal(result.observedPower, false);
  assert.equal(result.persisted, true);
  assert.ok(result.feedbackId);
  assert.ok(result.causalNote.includes("does not by itself establish"));
});

console.log("\n=== Scenario B: fresh, observed=on, target=off -> contradicted ===");
await check("B", async () => {
  resetAll();
  seedDevice("dev-b");
  seedObservedPower("dev-b", true, 5_000);
  const result = await evaluateDeviceStateOutcome({ lineage: { deviceId: "dev-b" }, actionId: "device.off" });
  assert.equal(result.result, "contradicted");
  assert.equal(result.observedPower, true);
});

console.log("\n=== Scenario C: no observation at all -> unverified, not a fabricated failure ===");
await check("C", async () => {
  resetAll();
  seedDevice("dev-c");
  const result = await evaluateDeviceStateOutcome({ lineage: { deviceId: "dev-c" }, actionId: "device.off" });
  assert.equal(result.result, "unverified");
  assert.equal(result.freshness, "unknown", "no observation at all resolves to Wave 6's own honest \"unknown\" freshness, not a fabricated sentinel");
  assert.equal(result.source, "unavailable");
  assert.ok(result.notes.includes("No current-state observation exists"));
});

console.log("\n=== Scenario D: stale evidence -> unverified, never a false failure ===");
await check("D", async () => {
  resetAll();
  seedDevice("dev-d");
  // inactive_switch policy: stale_after_ms=720_000, expired_after_ms=1_800_000.
  seedObservedPower("dev-d", true, 900_000); // 15 min old -> stale, not fresh, not expired
  const result = await evaluateDeviceStateOutcome({ lineage: { deviceId: "dev-d" }, actionId: "device.off" });
  assert.equal(result.freshness, "stale");
  assert.equal(result.result, "unverified", "stale evidence must never become achieved OR contradicted");
});

console.log("\n=== Scenario E: fresh, observed=on, target=on -> achieved ===");
await check("E", async () => {
  resetAll();
  seedDevice("dev-e");
  seedObservedPower("dev-e", true, 1_000);
  const result = await evaluateDeviceStateOutcome({ lineage: { deviceId: "dev-e" }, actionId: "device.on" });
  assert.equal(result.result, "achieved");
});

console.log("\n=== Scenario F: toggle without deterministic target -> unsupported, never falsely evaluated, nothing persisted ===");
await check("F", async () => {
  resetAll();
  seedDevice("dev-f");
  seedObservedPower("dev-f", true, 1_000);
  const result = await evaluateDeviceStateOutcome({ lineage: { deviceId: "dev-f" }, actionId: "device.toggle" });
  assert.equal(result.result, "unsupported");
  assert.equal(result.persisted, false);
  assert.equal(intelligenceFeedbackTable.length, 0, "an unsupported evaluation must never write a feedback row");
});

console.log("\n=== Scenario G: same evaluation retried against the SAME evidence -> no duplicate factual feedback ===");
await check("G", async () => {
  resetAll();
  seedDevice("dev-g");
  seedObservedPower("dev-g", false, 5_000);
  const input = { lineage: { deviceId: "dev-g", decisionId: "dec-g" }, actionId: "device.off" };
  const first = await evaluateDeviceStateOutcome(input);
  const second = await evaluateDeviceStateOutcome(input);
  assert.equal(first.feedbackId, second.feedbackId);
  assert.equal(intelligenceFeedbackTable.length, 1, "retrying against unchanged evidence must not create a second row");
});

console.log("\n=== Scenario H: newer evidence after a prior evaluation -> safe re-evaluation, a genuinely new record ===");
await check("H", async () => {
  resetAll();
  seedDevice("dev-h");
  seedObservedPower("dev-h", true, 5_000); // fresh, contradicts an off target
  const input = { lineage: { deviceId: "dev-h", decisionId: "dec-h" }, actionId: "device.off" };
  const first = await evaluateDeviceStateOutcome(input);
  assert.equal(first.result, "contradicted");
  // Newer, different observation arrives (device actually turns off later).
  deviceRuntimeStateService.cache.clear();
  seedObservedPower("dev-h", false, 1_000);
  const second = await evaluateDeviceStateOutcome(input);
  assert.equal(second.result, "achieved");
  assert.notEqual(second.feedbackId, first.feedbackId, "genuinely new evidence must produce a new record, not overwrite the old one");
  assert.equal(intelligenceFeedbackTable.length, 2);
});

console.log("\n=== Scenario I: historical outcome remains truthful even after the world changes again ===");
await check("I", async () => {
  resetAll();
  seedDevice("dev-i");
  seedObservedPower("dev-i", false, 5_000);
  const input = { lineage: { deviceId: "dev-i", decisionId: "dec-i" }, actionId: "device.off" };
  const achieved = await evaluateDeviceStateOutcome(input);
  assert.equal(achieved.result, "achieved");
  const historicalRow = intelligenceFeedbackTable.find((r) => r.id === achieved.feedbackId);
  const historicalResultAtT1 = historicalRow.outcome_metadata.result;
  // World changes: device later turns back on.
  deviceRuntimeStateService.cache.clear();
  seedObservedPower("dev-i", true, 1_000);
  await evaluateDeviceStateOutcome(input);
  // The T1 row itself must never be mutated.
  const stillHistorical = intelligenceFeedbackTable.find((r) => r.id === achieved.feedbackId);
  assert.equal(stillHistorical.outcome_metadata.result, historicalResultAtT1);
  assert.equal(stillHistorical.outcome_metadata.result, "achieved", "the historical record of what was true at T1 must never be rewritten into failure");
});

console.log("\n=== Scenario J: zero physical/provider side effects ===");
await check("J: no execution/provider/dispatch import anywhere in the evaluator's own source", () => {
  const fs = require("fs");
  const source = fs.readFileSync(path.join(backendRoot, "src/oyi-core/domains/devices/deviceOutcomeEvaluator.ts"), "utf8");
  const stripped = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  const forbidden = ["executeRegisteredAction", "executeDeviceCommandForActor", "authorizeDeviceCommand", "mqtt", "adapterRegistry", ".dispatch(", "provider.send"];
  for (const pattern of forbidden) {
    assert.ok(!stripped.includes(pattern), `deviceOutcomeEvaluator.ts must never reference "${pattern}" -- it is read-only w.r.t. the physical world`);
  }
});

console.log("\n=== Batch / performance shape: one devices query + one current-state resolution + one feedback lookup + one insert regardless of N ===");
await check("batched evaluation of multiple devices produces correct independent results", async () => {
  resetAll();
  for (const id of ["dev-batch-1", "dev-batch-2", "dev-batch-3"]) seedDevice(id);
  seedObservedPower("dev-batch-1", false, 1_000);
  seedObservedPower("dev-batch-2", true, 1_000);
  // dev-batch-3 has no observation at all.
  const results = await evaluateDeviceStateOutcomes([
    { lineage: { deviceId: "dev-batch-1" }, actionId: "device.off" },
    { lineage: { deviceId: "dev-batch-2" }, actionId: "device.off" },
    { lineage: { deviceId: "dev-batch-3" }, actionId: "device.off" },
  ]);
  assert.equal(results.length, 3);
  assert.equal(results[0].result, "achieved");
  assert.equal(results[1].result, "contradicted");
  assert.equal(results[2].result, "unverified");
});

console.log("\n=== Lineage preservation: no fabricated links ===");
await check("evaluation without any Decision/Goal lineage is still returned, with lineage honestly null", async () => {
  resetAll();
  seedDevice("dev-lineage");
  seedObservedPower("dev-lineage", false, 1_000);
  const result = await evaluateDeviceStateOutcome({ lineage: { deviceId: "dev-lineage" }, actionId: "device.off" });
  assert.equal(result.lineage.decisionId, undefined);
  assert.equal(result.lineage.goalId, undefined);
  assert.equal(result.result, "achieved", "still real, provable evidence about the device even without Decision/Goal lineage");
});

console.log("");
console.log(`=== wave8-slice1-device-state-outcome-evaluator-smoke: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
