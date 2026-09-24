#!/usr/bin/env node
// Wave 6 Slice 13B -- Device Current-State Consumer Convergence smoke.
//
// Proves the two remaining generic CURRENT_STATE consumers Slice 13 left outside the authority
// (Watch's watchAdapterService.ts, and Facility's deviceEstateController.ts device list) now
// obey src/oyi-core/domains/devices/deviceCurrentStateAuthority.ts, and that all migrated
// surfaces agree with each other and with the authority itself for the same device.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = "/Users/ochigaidoko/Documents/Ochiga-backend";
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
  const calls = {};
  return {
    calls,
    from(table) {
      calls[table] = (calls[table] || 0) + 1;
      const rows = tables[table] || [];
      const state = { eqFilters: {}, inFilters: {}, notNull: [] };
      const builder = {
        select() { return builder; },
        eq(col, val) { state.eqFilters[col] = val; return builder; },
        in(col, vals) { state.inFilters[col] = vals; return builder; },
        or() { return builder; },
        not(col) { state.notNull.push(col); return builder; },
        order() { return builder; },
        limit() { return builder; },
        _matches(row) {
          for (const [c, v] of Object.entries(state.eqFilters)) if (String(row[c] ?? "") !== String(v)) return false;
          for (const [c, vals] of Object.entries(state.inFilters)) if (!vals.map(String).includes(String(row[c]))) return false;
          for (const c of state.notNull) if (row[c] === null || row[c] === undefined) return false;
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

function mockReq(overrides = {}) {
  return { params: {}, query: {}, body: {}, headers: {}, ...overrides };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

async function main() {
  const supabaseClientModule = require(path.join(backendRoot, "dist/supabase/supabaseClient.js"));
  const { deviceRuntimeStateService } = require(path.join(backendRoot, "dist/services/deviceRuntimeStateService.js"));
  const { resolveDeviceCurrentStates } = require(path.join(backendRoot, "dist/oyi-core/domains/devices/deviceCurrentStateAuthority.js"));

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

  function device(id, overrides) {
    return {
      // category/type deliberately "switch" -- Watch's canExposeControl()/deviceFamily()
      // gate favoriting to light/switch/outlet/heater families; an "hvac"-classified fixture
      // would silently be excluded from favorite_devices, making status assertions vacuous.
      id, name: `Device ${id}`, estate_id: "estate-1", home_id: "home-1", room_id: "room-1",
      is_virtual: false, category: "switch", type: "switch", adapter: "tuya",
      online: true, status: null, metadata: {}, is_managed_disabled: false,
      capabilities: [], protocols: [], updated_at: isoAgo(48 * HOUR), last_seen_at: null,
      ...overrides,
    };
  }

  // =====================================================================
  // PART A -- Watch
  // =====================================================================
  console.log("\n=== PART A: Watch current-state convergence ===");
  const watchAdapter = require(path.join(backendRoot, "dist/services/watchAdapterService.js"));
  const actor = { id: "user-1", email: "watch@test.local", role: "resident", home_id: "home-1", estate_id: "estate-1", username: "resident" };

  const wA = device("watch-conflict-a", { online: true }); // provisioning online
  deviceRuntimeStateService.set(wA, completeState({ online: false }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" }); // runtime offline
  const wB = device("watch-conflict-b", { online: false }); // provisioning offline
  deviceRuntimeStateService.set(wB, completeState({ online: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" }); // runtime online
  const wStale = device("watch-stale");
  deviceRuntimeStateService.set(wStale, completeState({ online: true }), { providerTimestamp: isoAgo(2 * HOUR), source: "runtime" }); // inactive_switch: expired after 30min
  const wDisconnected = device("watch-disconnected");
  deviceRuntimeStateService.set(wDisconnected, completeState({ online: true, provider_health: "provider_disconnected" }), { providerTimestamp: isoAgo(2 * HOUR), source: "runtime" });
  const wNoObs = device("watch-no-obs");

  const { getWatchFavorites } = watchAdapter;
  // getWatchFavorites caps favorite_devices at 3 -- split into two rounds (<=3 favorited each)
  // so every fixture genuinely surfaces in the response rather than being silently truncated,
  // which would make a "!== offline" style assertion vacuously true against `undefined`.
  wA.metadata = { favorite: true };
  wB.metadata = { favorite: true };
  wStale.metadata = { favorite: true };
  const mockWatchRound1 = makeSupabaseMock({ devices: [wA, wB, wStale], rooms: [] });
  supabaseClientModule.supabaseAdmin = mockWatchRound1;
  const favoritesRound1 = await getWatchFavorites(actor);
  const cardsRound1 = new Map(favoritesRound1.favorite_devices.map((c) => [c.id, c]));
  check("fixture sanity: Watch round 1 returned all 3 favorited devices", cardsRound1.size === 3, [...cardsRound1.keys()]);

  wDisconnected.metadata = { favorite: true };
  wNoObs.metadata = { favorite: true };
  const mockWatchRound2 = makeSupabaseMock({ devices: [wDisconnected, wNoObs], rooms: [] });
  supabaseClientModule.supabaseAdmin = mockWatchRound2;
  const favoritesRound2 = await getWatchFavorites(actor);
  const cardsRound2 = new Map(favoritesRound2.favorite_devices.map((c) => [c.id, c]));
  check("fixture sanity: Watch round 2 returned both favorited devices", cardsRound2.size === 2, [...cardsRound2.keys()]);

  const cardsById = new Map([...cardsRound1, ...cardsRound2]);

  check("A1 Watch: provisioning online=true / runtime offline -> online:false", cardsById.get("watch-conflict-a")?.online === false, cardsById.get("watch-conflict-a"));
  check("A2 Watch: provisioning online=false / runtime online -> online:true", cardsById.get("watch-conflict-b")?.online === true, cardsById.get("watch-conflict-b"));
  check("A3 Watch: stale observation is never fabricated offline (status != offline)", cardsById.get("watch-stale")?.status !== "offline", cardsById.get("watch-stale")?.status);
  check("A4 Watch: provider-disconnected never fabricated offline", cardsById.get("watch-disconnected")?.status !== "offline", cardsById.get("watch-disconnected")?.status);
  check("A4b Watch: provider-disconnected device stays enabled-eligible (not disabled_reason device_offline)", cardsById.get("watch-disconnected")?.disabled_reason !== "device_offline", cardsById.get("watch-disconnected")?.disabled_reason);
  check("A5 Watch: no observation -> status unknown, not fabricated online/offline", cardsById.get("watch-no-obs")?.status === "unknown", cardsById.get("watch-no-obs")?.status);
  check("A6 Watch: last_updated uses the real observation time, not the provisioning updated_at", cardsById.get("watch-conflict-a")?.last_updated !== wA.updated_at, { last_updated: cardsById.get("watch-conflict-a")?.last_updated, provisioning_updated_at: wA.updated_at });

  // =====================================================================
  // PART B -- Facility device list
  // =====================================================================
  console.log("\n=== PART B: Facility device-list current-state convergence ===");
  const deviceEstateController = require(path.join(backendRoot, "dist/controllers/deviceEstateController.js"));

  const fA = device("facility-conflict-a", { home_id: "home-F", online: true });
  deviceRuntimeStateService.set(fA, completeState({ online: false }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  const fB = device("facility-conflict-b", { home_id: "home-F", online: false });
  deviceRuntimeStateService.set(fB, completeState({ online: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  const fStale = device("facility-stale", { home_id: "home-F" });
  deviceRuntimeStateService.set(fStale, completeState({ online: true }), { providerTimestamp: isoAgo(2 * HOUR), source: "runtime" });
  const fDisconnected = device("facility-disconnected", { home_id: "home-F" });
  deviceRuntimeStateService.set(fDisconnected, completeState({ online: true, provider_health: "provider_disconnected" }), { providerTimestamp: isoAgo(2 * HOUR), source: "runtime" });
  const fNoObs = device("facility-no-obs", { home_id: "home-F" });

  const facilityDevices = [fA, fB, fStale, fDisconnected, fNoObs].map((d) => ({ ...d, rooms: [{ id: "room-1", name: "Living Room" }] }));
  const mockFacility = makeSupabaseMock({ devices: facilityDevices });
  supabaseClientModule.supabaseAdmin = mockFacility;

  const facilityReq = mockReq({
    params: { estateId: "estate-1" },
    query: {},
    user: { estate_id: "estate-1", home_id: "home-F", role: "estate_admin" },
    oisContext: { estate_id: "estate-1", home_id: "home-F" },
  });
  const facilityRes = mockRes();
  await deviceEstateController.getEstateDevices(facilityReq, facilityRes);
  check("fixture sanity: Facility endpoint returned 200 with devices", facilityRes.statusCode === 200 && Array.isArray(facilityRes.body?.devices), facilityRes.body);
  const facilityById = new Map((facilityRes.body?.devices || []).map((d) => [d.id, d]));

  check("B1 Facility: provisioning online=true / runtime offline -> status offline", facilityById.get("facility-conflict-a")?.status === "offline", facilityById.get("facility-conflict-a")?.status);
  check("B2 Facility: provisioning online=false / runtime online -> status online", facilityById.get("facility-conflict-b")?.status === "online", facilityById.get("facility-conflict-b")?.status);
  check("B3 Facility: stale observation truthful (freshness != fresh, status != offline)", facilityById.get("facility-stale")?.freshness !== "fresh" && facilityById.get("facility-stale")?.status !== "offline", facilityById.get("facility-stale"));
  check("B4 Facility: provider-disconnected truthful (status provider_disconnected, not fabricated offline)", facilityById.get("facility-disconnected")?.status === "provider_disconnected", facilityById.get("facility-disconnected")?.status);
  check("B5 Facility: no observation -> status unknown, freshness unknown", facilityById.get("facility-no-obs")?.status === "unknown" && facilityById.get("facility-no-obs")?.freshness === "unknown", facilityById.get("facility-no-obs"));
  check("B6 Facility: freshness field now present (Section 9 finding -- previously absent entirely)", typeof facilityById.get("facility-conflict-a")?.freshness === "string", facilityById.get("facility-conflict-a")?.freshness);

  // UI capabilities / provisioning metadata preservation
  check("B7 Facility: ui_capabilities still assembled (unchanged UI-capability pipeline)", facilityById.get("facility-conflict-a")?.ui_capabilities !== undefined);
  check("B8 Facility: provisioning metadata (category/type) unchanged", facilityById.get("facility-conflict-a")?.category === "switch" && facilityById.get("facility-conflict-a")?.type === "switch");
  check("B9 Facility: room enrichment unchanged", facilityById.get("facility-conflict-a")?.room?.name === "Living Room", facilityById.get("facility-conflict-a")?.room);

  // =====================================================================
  // PART C -- Cross-surface consistency (authority vs evidence loader vs Watch vs Facility)
  // =====================================================================
  console.log("\n=== PART C: cross-surface consistency ===");
  const deviceEvidence = require(path.join(backendRoot, "dist/oyi-core/domains/devices/deviceEvidence.js"));
  const sharedDevice = device("shared-x-check", { home_id: "home-S", online: true });
  deviceRuntimeStateService.set(sharedDevice, completeState({ online: false }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });

  const directAuthority = await resolveDeviceCurrentStates([sharedDevice]);
  const directState = directAuthority.get("shared-x-check");

  const mockEvidence = makeSupabaseMock({ devices: [sharedDevice], rooms: [] });
  supabaseClientModule.supabaseAdmin = mockEvidence;
  const evidenceFacts = await deviceEvidence.loadHomeDeviceInventoryFacts({ estate_id: "estate-1", home_id: "home-S", context: {} }, { estate_id: "estate-1", home_id: "home-S" });
  const evidenceFact = evidenceFacts.find((f) => f.object.canonical_id === "shared-x-check");

  check("C1 authority == evidence loader (availability)", directState.availability === evidenceFact?.value?.availability, { authority: directState.availability, evidence: evidenceFact?.value?.availability });
  check("C2 authority == evidence loader (freshness)", directState.freshness === evidenceFact?.value?.freshness, { authority: directState.freshness, evidence: evidenceFact?.value?.freshness });

  const sharedFacilityDevices = [{ ...sharedDevice, rooms: [{ id: "room-1", name: "Room" }] }];
  const mockSharedFacility = makeSupabaseMock({ devices: sharedFacilityDevices });
  supabaseClientModule.supabaseAdmin = mockSharedFacility;
  const sharedFacilityReq = mockReq({
    params: { estateId: "estate-1" },
    query: {},
    user: { estate_id: "estate-1", home_id: "home-S", role: "estate_admin" },
    oisContext: { estate_id: "estate-1", home_id: "home-S" },
  });
  const sharedFacilityRes = mockRes();
  await deviceEstateController.getEstateDevices(sharedFacilityReq, sharedFacilityRes);
  const sharedFacilityDevice = (sharedFacilityRes.body?.devices || []).find((d) => d.id === "shared-x-check");
  check("C3 authority == Facility (status/availability)", sharedFacilityDevice?.status === directState.availability, { authority: directState.availability, facility: sharedFacilityDevice?.status });
  check("C4 authority == Facility (freshness)", sharedFacilityDevice?.freshness === directState.freshness, { authority: directState.freshness, facility: sharedFacilityDevice?.freshness });

  const sharedWatchActor = { id: "user-2", email: "w2@test.local", role: "resident", home_id: "home-S", estate_id: "estate-1", username: "resident2" };
  const mockSharedWatch = makeSupabaseMock({ devices: [{ ...sharedDevice, metadata: { favorite: true } }], rooms: [] });
  supabaseClientModule.supabaseAdmin = mockSharedWatch;
  const sharedFavorites = await getWatchFavorites(sharedWatchActor);
  const sharedWatchCard = sharedFavorites.favorite_devices.find((c) => c.id === "shared-x-check");
  check("C5 authority == Watch (online flag matches availability=offline)", sharedWatchCard?.online === (directState.availability === "online"), { authority_availability: directState.availability, watch_online: sharedWatchCard?.online });

  // =====================================================================
  // PART D -- Cache / restart consistency
  // =====================================================================
  console.log("\n=== PART D: cache / restart consistency ===");
  const restartDevice = device("restart-check");
  const persistedOld = { device_id: "restart-check", status: completeState({ online: true }), last_seen: isoAgo(5 * HOUR), updated_at: isoAgo(5 * HOUR) };
  const mockRestart = makeSupabaseMock({ devices: [restartDevice], device_states: [persistedOld] });
  supabaseClientModule.supabaseAdmin = mockRestart;
  const coldStates = await resolveDeviceCurrentStates([restartDevice]);
  check("D1 cold hydration of an old persisted observation is not fabricated fresh", coldStates.get("restart-check")?.freshness !== "fresh", coldStates.get("restart-check")?.freshness);
  const warmStates = await resolveDeviceCurrentStates([restartDevice]);
  check("D2 warm cache re-read agrees with cold-hydrated result", warmStates.get("restart-check")?.freshness === coldStates.get("restart-check")?.freshness && warmStates.get("restart-check")?.availability === coldStates.get("restart-check")?.availability);

  // =====================================================================
  // PART E -- Batching / no N+1 (10, 50, 100 devices) across both migrated surfaces
  // =====================================================================
  console.log("\n=== PART E: batching / no N+1 ===");
  for (const count of [10, 50, 100]) {
    const bulkDevices = Array.from({ length: count }, (_, i) => device(`bulk-${count}-${i}`, { home_id: `home-bulk-${count}` }));
    const mockBulk = makeSupabaseMock({ devices: bulkDevices, device_states: [] });
    supabaseClientModule.supabaseAdmin = mockBulk;
    await resolveDeviceCurrentStates(bulkDevices);
    check(`E-${count} authority hydrates ${count} devices via exactly 1 batched device_states query`, mockBulk.calls.device_states === 1, mockBulk.calls.device_states);
  }
  // Facility endpoint itself: one devices query, one batched hydration underneath.
  const bulkFacilityDevices = Array.from({ length: 50 }, (_, i) => ({ ...device(`facbulk-${i}`, { home_id: "home-F" }), rooms: [] }));
  const mockBulkFacility = makeSupabaseMock({ devices: bulkFacilityDevices, device_states: [] });
  supabaseClientModule.supabaseAdmin = mockBulkFacility;
  const bulkFacilityReq = mockReq({
    params: { estateId: "estate-1" },
    query: {},
    user: { estate_id: "estate-1", home_id: "home-F", role: "estate_admin" },
    oisContext: { estate_id: "estate-1", home_id: "home-F" },
  });
  await deviceEstateController.getEstateDevices(bulkFacilityReq, mockRes());
  check("E-facility 50-device Facility list issues exactly 1 devices query and 1 device_states query", mockBulkFacility.calls.devices === 1 && mockBulkFacility.calls.device_states === 1, mockBulkFacility.calls);

  // =====================================================================
  // PART F -- Privacy scope preservation (lightweight direct check; full Slice 1/1B suites also rerun)
  // =====================================================================
  console.log("\n=== PART F: privacy / scope preservation ===");
  const otherHomeDevice = device("other-home-device", { home_id: "home-OTHER" });
  const mockScope = makeSupabaseMock({ devices: [...facilityDevices, otherHomeDevice] });
  supabaseClientModule.supabaseAdmin = mockScope;
  const scopedReq = mockReq({
    params: { estateId: "estate-1" },
    query: {},
    user: { estate_id: "estate-1", home_id: "home-F", role: "resident" },
    oisContext: { estate_id: "estate-1", home_id: "home-F" },
  });
  const scopedRes = mockRes();
  await deviceEstateController.getEstateDevices(scopedReq, scopedRes);
  check("F1 Facility: cross-home device never returned to a resident actor", !(scopedRes.body?.devices || []).some((d) => d.id === "other-home-device"), (scopedRes.body?.devices || []).map((d) => d.id));

  const crossEstateReq = mockReq({
    params: { estateId: "estate-2" },
    query: {},
    user: { estate_id: "estate-1", home_id: "home-F", role: "estate_admin" },
    oisContext: { estate_id: "estate-1", home_id: "home-F" },
  });
  const crossEstateRes = mockRes();
  await deviceEstateController.getEstateDevices(crossEstateReq, crossEstateRes);
  check("F2 Facility: mismatched estate param is denied (403), unaffected by authority migration", crossEstateRes.statusCode === 403, crossEstateRes.statusCode);

  // =====================================================================
  // PART G -- Intentional exceptions preserved (smart access / Facility Automation)
  // =====================================================================
  console.log("\n=== PART G: intentional exceptions ===");
  const fs = require("fs");
  const smartAccessSource = fs.readFileSync(path.join(backendRoot, "src/services/smartAccessCapabilityService.ts"), "utf8");
  check("G1 smartAccessCapabilityService retains its own richer provenance model (declaredByProvider/liveVerified/verifiedAt), not migrated to the generic authority", /declaredByProvider/.test(smartAccessSource) && /liveVerified/.test(smartAccessSource) && /verifiedAt/.test(smartAccessSource));
  const facilityAutomationSource = fs.readFileSync(path.join(backendRoot, "src/services/facilityAutomationService.ts"), "utf8");
  check("G2 facilityAutomationService's device precondition read is untouched (execution authority frozen)", /device_states.*status,last_seen,updated_at.*device_id.*entityId/.test(facilityAutomationSource.replace(/\s+/g, "")));

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
