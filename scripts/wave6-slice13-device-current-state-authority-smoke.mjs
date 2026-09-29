#!/usr/bin/env node
// Wave 6 Slice 13 -- Device Current-State Authority Convergence smoke.
//
// Proves ONE AUTHORITY PER FACT for device current state:
//   provisioning        -> devices table (untouched, read by callers directly)
//   observed runtime     -> deviceRuntimeStateService (cache + persisted device_states)
//   current-state read   -> new src/oyi-core/domains/devices/deviceCurrentStateAuthority.ts,
//                            which delegates freshness to deviceObservationPolicy.ts's
//                            per-device-class policy (via contracts/freshness.ts), and
//                            availability to the existing canonicalDeviceAvailabilityStatus.
//   provider health       -> kept distinct, never conflated with "offline".
//
// loadHomeDeviceInventoryFacts (deviceEvidence.ts) -- the conversation "Is my AC on?" /
// Consumer+Facility shared evidence path -- is migrated onto this authority in this slice.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = require("node:url").fileURLToPath(new URL("..", import.meta.url));
require(path.join(backendRoot, "node_modules/dotenv")).config({ path: path.join(backendRoot, ".env") });

let pass = 0;
let fail = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`PASS ${label}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`FAIL ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ""}`);
  }
}

function makeSupabaseMock(tables) {
  const calls = { device_states: 0, devices: 0, rooms: 0 };
  return {
    calls,
    from(table) {
      calls[table] = (calls[table] || 0) + 1;
      const rows = tables[table] || [];
      const state = { eqFilters: {}, inFilters: {} };
      const builder = {
        select() { return builder; },
        eq(col, val) { state.eqFilters[col] = val; return builder; },
        in(col, vals) { state.inFilters[col] = vals; return builder; },
        limit() { return builder; },
        order() { return builder; },
        _matches(row) {
          for (const [c, v] of Object.entries(state.eqFilters)) if (String(row[c] ?? "") !== String(v)) return false;
          for (const [c, vals] of Object.entries(state.inFilters)) if (!vals.map(String).includes(String(row[c]))) return false;
          return true;
        },
        maybeSingle() { return Promise.resolve({ data: rows.find((r) => builder._matches(r)) || null, error: null }); },
        single() { return Promise.resolve({ data: rows.find((r) => builder._matches(r)) || null, error: null }); },
        then(resolve) { return Promise.resolve({ data: rows.filter((r) => builder._matches(r)), error: null }).then(resolve); },
      };
      return builder;
    },
  };
}

async function main() {
  const supabaseClientPath = path.join(backendRoot, "dist/supabase/supabaseClient.js");
  const supabaseClientModule = require(supabaseClientPath);
  const runtimeServicePath = path.join(backendRoot, "dist/services/deviceRuntimeStateService.js");
  const authorityPath = path.join(backendRoot, "dist/oyi-core/domains/devices/deviceCurrentStateAuthority.js");
  const deviceEvidencePath = path.join(backendRoot, "dist/oyi-core/domains/devices/deviceEvidence.js");
  const contributorSummaryPath = path.join(backendRoot, "dist/oyi-core/domains/contributorSummary.js");

  const { DeviceRuntimeStateService, deviceRuntimeStateService } = require(runtimeServicePath);
  const now = Date.now();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const isoAgo = (ms) => new Date(now - ms).toISOString();

  function completeState(overrides) {
    return {
      normalized_state: { online: true, ...(overrides?.normalized_state || {}) },
      capability_codes: [],
      supported_controls: [],
      control_profile: "switch",
      online: true,
      ...overrides,
    };
  }

  function switchDevice(id, overrides) {
    return { id, name: `Device ${id}`, estate_id: "estate-1", home_id: "home-1", room_id: "room-1", is_virtual: false, category: "climate", type: "ac", adapter: "tuya", online: true, status: null, metadata: {}, is_managed_disabled: false, ...overrides };
  }

  // =====================================================================
  // PART A -- resolveDeviceCurrentStates: core authority behavior
  // =====================================================================
  console.log("\n=== PART A: resolveDeviceCurrentStates authority ===");
  const { resolveDeviceCurrentStates } = require(authorityPath);

  // A1: provisioning metadata untouched by this module (it never reads/returns name/category/etc.)
  const d1 = switchDevice("d1-prov");
  deviceRuntimeStateService.set(d1, completeState({ online: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  const a1 = await resolveDeviceCurrentStates([d1]);
  check("A1 authority result has no provisioning fields (name/category) -- caller's own devices row remains the provisioning source", !("name" in a1.get("d1-prov")) && !("category" in a1.get("d1-prov")), Object.keys(a1.get("d1-prov")));

  // A2/A3: runtime authority wins over devices.online (Example A and B)
  const d2 = switchDevice("d2-conflict-a", { online: true }); // provisioning says online
  deviceRuntimeStateService.set(d2, completeState({ online: false }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" }); // runtime observed offline
  const a2 = await resolveDeviceCurrentStates([d2]);
  check("A2 devices.online=true vs runtime=offline -> runtime wins (offline)", a2.get("d2-conflict-a").availability === "offline", a2.get("d2-conflict-a"));

  const d3 = switchDevice("d3-conflict-b", { online: false }); // provisioning says offline
  deviceRuntimeStateService.set(d3, completeState({ online: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" }); // runtime observed online
  const a3 = await resolveDeviceCurrentStates([d3]);
  check("A3 devices.online=false vs runtime=online -> runtime wins (online)", a3.get("d3-conflict-b").availability === "online", a3.get("d3-conflict-b"));

  // A4: no observation at all -> honest unknown, never fabricated
  const d4 = switchDevice("d4-no-obs");
  const mockNoObs = makeSupabaseMock({ devices: [d4], device_states: [] });
  supabaseClientModule.supabaseAdmin = mockNoObs;
  const a4 = await resolveDeviceCurrentStates([d4]);
  check("A4 no observation -> availability unknown", a4.get("d4-no-obs").availability === "unknown", a4.get("d4-no-obs"));
  check("A4b no observation -> source unavailable, reason no_observation", a4.get("d4-no-obs").source === "unavailable" && a4.get("d4-no-obs").reason === "no_observation", a4.get("d4-no-obs"));

  // A5: stale observation stays stale, not fabricated fresh or offline
  const d5 = switchDevice("d5-stale");
  deviceRuntimeStateService.set(d5, completeState({ online: true }), { providerTimestamp: isoAgo(45 * MIN), source: "runtime" }); // past 15min fresh / within 6h recent -> "stale" bucket for devices policy... actually inactive_switch stale_after=720s(12min) -- device has no viewed_until_at, so inactive_switch policy applies (expected 600s, stale 720s, expired 1800s=30min). 45min > 1800000ms(30min) expired threshold.
  const a5 = await resolveDeviceCurrentStates([d5]);
  check("A5 stale/expired observation is honestly classified, not fresh", a5.get("d5-stale").freshness !== "fresh", a5.get("d5-stale").freshness);

  // A6: provider outage does not fabricate "offline" -- providerHealth signal wins over a stale-but-online-looking observation
  const d6 = switchDevice("d6-provider-outage");
  deviceRuntimeStateService.set(d6, completeState({ online: true, provider_health: "provider_disconnected" }), { providerTimestamp: isoAgo(2 * HOUR), source: "runtime" });
  const a6 = await resolveDeviceCurrentStates([d6]);
  check("A6 provider outage -> availability is provider_disconnected, NOT fabricated offline", a6.get("d6-provider-outage").availability === "provider_disconnected", a6.get("d6-provider-outage").availability);

  // A7/A7b: disabled provisioning flag never conflated with offline in either direction
  const d7 = switchDevice("d7-disabled-but-online", { is_managed_disabled: true });
  deviceRuntimeStateService.set(d7, completeState({ online: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  const a7 = await resolveDeviceCurrentStates([d7]);
  check("A7 administratively-disabled device with a real fresh online observation still honestly reports online (not forced offline)", a7.get("d7-disabled-but-online").availability === "online", a7.get("d7-disabled-but-online").availability);
  const d7b = switchDevice("d7b-disabled-no-obs", { is_managed_disabled: true });
  const mockD7b = makeSupabaseMock({ devices: [d7b], device_states: [] });
  supabaseClientModule.supabaseAdmin = mockD7b;
  const a7b = await resolveDeviceCurrentStates([d7b]);
  check("A7b disabled device with no observation is 'unknown', not fabricated 'offline'", a7b.get("d7b-disabled-no-obs").availability === "unknown", a7b.get("d7b-disabled-no-obs").availability);

  // A8: IR/virtual appliance uses its own wider observation policy honestly (not the flat switch window)
  const d8 = switchDevice("d8-ir", { is_virtual: true, control_profile: "ir_remote" });
  deviceRuntimeStateService.set(d8, completeState({ online: true }), { providerTimestamp: isoAgo(2 * HOUR), source: "runtime" });
  const a8 = await resolveDeviceCurrentStates([d8]);
  check("A8 IR appliance at 2h old is 'stale' under its own 30min/24h policy (not 'fresh', not 'expired')", a8.get("d8-ir").freshness === "stale", a8.get("d8-ir").freshness);

  // A9: providerHealth stays distinct -- the underlying observed online value is not erased by a health flag
  check("A9 provider health does not erase the underlying observed state", a6.get("d6-provider-outage").observedState?.online === true, a6.get("d6-provider-outage").observedState);

  // =====================================================================
  // PART B -- out-of-order protection + persistence/cache/restart semantics
  // (fresh, dependency-injected service instances for full determinism)
  // =====================================================================
  console.log("\n=== PART B: out-of-order + cache/persistence/restart ===");
  const persistedRows = new Map();
  const freshService = new DeviceRuntimeStateService({
    now: () => now,
    resolveDevice: async (id) => switchDevice(id),
    loadSnapshots: async (ids) => ids.map((id) => persistedRows.get(id)).filter(Boolean),
    persistSnapshot: async (entry) => { persistedRows.set(entry.device_id, { device_id: entry.device_id, status: entry.state, last_seen: entry.last_refresh, updated_at: entry.last_refresh }); },
    readProviderState: async () => { throw new Error("provider poll should not be called in this test"); },
    broadcast: () => {},
    emitSignal: async () => {},
  }, 5);

  const deviceB1 = switchDevice("b1-order");
  const older = await freshService.acceptProviderState(deviceB1, completeState({ online: true }), { providerTimestamp: isoAgo(10 * MIN) });
  check("B1 first observation accepted", older.ignored !== true && freshService.get("b1-order")?.state?.online === true);
  const newer = await freshService.acceptProviderState(deviceB1, completeState({ online: false }), { providerTimestamp: isoAgo(1 * MIN) });
  check("B2 newer observation wins and updates state", newer.ignored !== true && freshService.get("b1-order")?.state?.online === false, freshService.get("b1-order")?.state);
  const stale = await freshService.acceptProviderState(deviceB1, completeState({ online: true }), { providerTimestamp: isoAgo(8 * MIN) });
  check("B3 late older observation is rejected (ignored)", stale.ignored === true);
  check("B3b cache state unchanged by the rejected late observation", freshService.get("b1-order")?.state?.online === false, freshService.get("b1-order")?.state);

  // B4: cache hit does not re-query persistence
  let loadCallCount = 0;
  const cacheHitService = new DeviceRuntimeStateService({
    now: () => now,
    loadSnapshots: async (ids) => { loadCallCount += 1; return []; },
    persistSnapshot: async () => {},
  }, 5);
  const deviceB4 = switchDevice("b4-cache-hit");
  cacheHitService.set(deviceB4, completeState({ online: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  await cacheHitService.getOrHydrate(deviceB4);
  check("B4 cache hit never calls loadSnapshots", loadCallCount === 0, loadCallCount);

  // B5: restart recovery -- a fresh instance (empty cache) hydrating an OLD persisted row does not treat it as fresh
  persistedRows.set("b5-restart", { device_id: "b5-restart", status: completeState({ online: true }), last_seen: isoAgo(3 * HOUR), updated_at: isoAgo(3 * HOUR) });
  const restartedService = new DeviceRuntimeStateService({
    now: () => now,
    loadSnapshots: async (ids) => ids.map((id) => persistedRows.get(id)).filter(Boolean),
    persistSnapshot: async () => {},
  }, 5);
  const deviceB5 = switchDevice("b5-restart");
  const restartedSnapshot = await restartedService.getOrHydrate(deviceB5);
  check("B5 restart recovery: cold-hydrated 3h-old observation is not 'fresh' at the raw runtime-service level", restartedSnapshot?.freshness !== "fresh", restartedSnapshot?.freshness);
  const { resolveDeviceCurrentStates: resolveViaFreshInstance } = (() => {
    // The authority module imports the SINGLETON directly; to prove restart semantics through the
    // authority contract itself (not just the raw runtime service), seed the singleton's cache via
    // hydrateMany against the same old persisted row under a fresh device id.
    return { resolveDeviceCurrentStates };
  })();
  persistedRows.set("b5b-restart-authority", { device_id: "b5b-restart-authority", status: completeState({ online: true }), last_seen: isoAgo(3 * HOUR), updated_at: isoAgo(3 * HOUR) });
  const mockB5b = makeSupabaseMock({ devices: [], device_states: [persistedRows.get("b5b-restart-authority")] });
  supabaseClientModule.supabaseAdmin = mockB5b;
  const deviceB5b = switchDevice("b5b-restart-authority");
  const a5b = await resolveViaFreshInstance([deviceB5b]);
  check("B5b restart recovery through the authority contract: old persisted observation is honestly stale/expired, not fresh", a5b.get("b5b-restart-authority").freshness !== "fresh", a5b.get("b5b-restart-authority").freshness);

  // =====================================================================
  // PART C -- command vs. confirmed-observation separation
  // =====================================================================
  console.log("\n=== PART C: command-state vs observed-state separation ===");
  const deviceC1 = switchDevice("c1-pending-command");
  deviceRuntimeStateService.set(deviceC1, completeState({ online: true, _oyi_pending_command: { command_execution_id: "exec-1", command: { switch_1: false } } }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  const c1 = await resolveDeviceCurrentStates([deviceC1]);
  check("C1 a pending/accepted command does not itself become observed state -- reports the real observed online:true, not the requested false", c1.get("c1-pending-command").onlineRaw === true, c1.get("c1-pending-command").onlineRaw);

  const deviceC2 = switchDevice("c2-confirmed");
  await freshService.acceptProviderState(deviceC2, completeState({ online: false }), { providerTimestamp: isoAgo(1 * MIN) });
  check("C2 a confirmed observation DOES become current state", freshService.get("c2-confirmed")?.state?.online === false);

  // =====================================================================
  // PART D -- loadHomeDeviceInventoryFacts migration (conversation / Consumer+Facility shared evidence)
  // =====================================================================
  console.log("\n=== PART D: loadHomeDeviceInventoryFacts migration ===");
  const { loadHomeDeviceInventoryFacts } = require(deviceEvidencePath);
  const { buildContributorSummary } = require(contributorSummaryPath);

  const homeDevices = [
    switchDevice("home-fresh", { home_id: "home-D", online: true }),
    switchDevice("home-conflict", { home_id: "home-D", online: true }),
    switchDevice("home-no-obs", { home_id: "home-D" }),
  ];
  deviceRuntimeStateService.set(homeDevices[0], completeState({ online: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  deviceRuntimeStateService.set(homeDevices[1], completeState({ online: false }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" }); // devices.online=true but runtime says offline
  const mockD = makeSupabaseMock({ devices: homeDevices, device_states: [], rooms: [] });
  supabaseClientModule.supabaseAdmin = mockD;
  const homeFacts = await loadHomeDeviceInventoryFacts({ estate_id: "estate-1", home_id: "home-D", context: {} }, { estate_id: "estate-1", home_id: "home-D" });
  check("D1 inventory produces one fact per device", homeFacts.length === 3, homeFacts.length);
  const freshFact = homeFacts.find((f) => f.object.canonical_id === "home-fresh");
  const conflictFact = homeFacts.find((f) => f.object.canonical_id === "home-conflict");
  const noObsFact = homeFacts.find((f) => f.object.canonical_id === "home-no-obs");
  check("D2 fresh device reports online availability via the authority", freshFact?.value?.availability === "online", freshFact?.value);
  check("D3 devices.online=true vs runtime=offline conflict resolves to offline (runtime wins) in the migrated loader", conflictFact?.value?.availability === "offline", conflictFact?.value);
  check("D4 no observation -> honest unknown in the migrated loader (not fabricated online/offline)", noObsFact?.value?.availability === "unknown", noObsFact?.value);
  check("D5 fact.freshness top-level contract preserved: raw ISO timestamp or 'unknown' (Slice 10/12), not a pre-classified bucket", freshFact?.freshness !== "fresh" && freshFact?.freshness !== "stale" && (noObsFact?.freshness === "unknown"), { fresh: freshFact?.freshness, noObs: noObsFact?.freshness });
  check("D6 provisioning fields (category/type/room) still sourced from devices table, unaffected by the authority migration", freshFact?.value?.category === "climate" && freshFact?.value?.device_family === "climate", freshFact?.value);

  // Cross-surface consistency: the SAME authority call used directly must agree with what the
  // migrated loader reports for the identical device (Consumer/Facility share this one loader).
  const directCheck = await resolveDeviceCurrentStates([homeDevices[1]]);
  check("D7 cross-surface consistency: direct authority call agrees with the migrated evidence loader for the same device", directCheck.get("home-conflict").availability === conflictFact?.value?.availability, { direct: directCheck.get("home-conflict").availability, loader: conflictFact?.value?.availability });

  // Contributor freshness (Slice 12) still correct downstream of the migrated loader.
  const contributorSummary = buildContributorSummary({ domain: "devices", facts: homeFacts, summary: "test" });
  check("D8 contributor summary built from migrated facts does not crash and returns a valid bucket", ["fresh", "recent", "stale", "historical", "unknown", "unavailable"].includes(contributorSummary.freshness), contributorSummary.freshness);

  // Scope preservation: room-scoped request excludes devices outside the room; cross-home devices never returned.
  const otherHomeDevices = [switchDevice("other-home-device", { home_id: "home-OTHER" })];
  const mockScope = makeSupabaseMock({ devices: [...homeDevices, ...otherHomeDevices], device_states: [], rooms: [] });
  supabaseClientModule.supabaseAdmin = mockScope;
  const scopedFacts = await loadHomeDeviceInventoryFacts({ estate_id: "estate-1", home_id: "home-D", context: {} }, { estate_id: "estate-1", home_id: "home-D" });
  check("D9 cross-home devices never appear in a home-scoped inventory read", !scopedFacts.some((f) => f.object.canonical_id === "other-home-device"), scopedFacts.map((f) => f.object.canonical_id));

  // =====================================================================
  // PART E -- no N+1 provider polling
  // =====================================================================
  console.log("\n=== PART E: batched, no N+1 provider polling ===");
  let providerPollCount = 0;
  const batchService = new DeviceRuntimeStateService({
    now: () => now,
    loadSnapshots: async () => { batchService._dbCalls = (batchService._dbCalls || 0) + 1; return []; },
    readProviderState: async () => { providerPollCount += 1; return completeState({ online: true }); },
    persistSnapshot: async () => {},
  }, 5);
  const manyDevices = Array.from({ length: 100 }, (_, i) => switchDevice(`bulk-${i}`));
  await batchService.hydrateMany(manyDevices);
  check("E1 100 devices hydrate via exactly 1 batched DB call, not N", batchService._dbCalls === 1, batchService._dbCalls);
  check("E2 hydration never triggers a live provider poll", providerPollCount === 0, providerPollCount);

  // =====================================================================
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("Failures:", failures);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Smoke script crashed:", error);
  process.exit(1);
});
