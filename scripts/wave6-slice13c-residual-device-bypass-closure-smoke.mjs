#!/usr/bin/env node
// Wave 6 Slice 13C -- Residual Device Current-State Bypass Closure smoke.
//
// Proves generic read boundaries (geo, proximity, conversation, Facility, Watch,
// Spatial and Office) obey
// src/oyi-core/domains/devices/deviceCurrentStateAuthority.ts, and that only a genuinely
// fresh AND canonically online observation is treated as currently active for presence-sensitive
// alerts/counts/listings (stale/unknown/provider-disconnected must never silently become active).
import { createRequire } from "module";
import { projectSelected } from "./helpers/device-read-smoke-isolation.mjs";
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
      const state = { eqFilters: {}, inFilters: {}, neqFilters: {}, notNull: [], opType: null, opPayload: null };
      let selection = "*";
      const builder = {
        select(fields = "*") { selection = fields; return builder; },
        eq(col, val) { state.eqFilters[col] = val; return builder; },
        neq(col, val) { state.neqFilters[col] = val; return builder; },
        in(col, vals) { state.inFilters[col] = vals; return builder; },
        or() { return builder; },
        gte() { return builder; },
        not(col) { state.notNull.push(col); return builder; },
        order() { return builder; },
        limit() { return builder; },
        insert(payload) { state.opType = "insert"; state.opPayload = Array.isArray(payload) ? payload : [payload]; return builder; },
        update(payload) { state.opType = "update"; state.opPayload = payload; return builder; },
        upsert(payload) { state.opType = "upsert"; state.opPayload = payload; return builder; },
        _matches(row) {
          for (const [c, v] of Object.entries(state.eqFilters)) if (String(row[c] ?? "") !== String(v)) return false;
          for (const [c, v] of Object.entries(state.neqFilters)) if (String(row[c] ?? "") === String(v)) return false;
          for (const [c, vals] of Object.entries(state.inFilters)) if (!vals.map(String).includes(String(row[c]))) return false;
          for (const c of state.notNull) if (row[c] === null || row[c] === undefined) return false;
          return true;
        },
        maybeSingle() {
          if (state.opType === "upsert") return Promise.resolve({ data: { id: "mock-upsert-id", ...state.opPayload }, error: null });
          if (state.opType === "insert") return Promise.resolve({ data: { id: "mock-insert-id", ...(state.opPayload[0] || {}) }, error: null });
          return Promise.resolve({ data: projectSelected(rows.find((r) => builder._matches(r)) || null, selection), error: null });
        },
        single() {
          if (state.opType === "upsert") return Promise.resolve({ data: { id: "mock-upsert-id", ...state.opPayload }, error: null });
          if (state.opType === "insert") return Promise.resolve({ data: { id: "mock-insert-id", ...(state.opPayload[0] || {}) }, error: null });
          return Promise.resolve({ data: projectSelected(rows.find((r) => builder._matches(r)) || null, selection), error: null });
        },
        then(resolve) {
          if (state.opType === "insert") return Promise.resolve({ data: state.opPayload.map((r, i) => ({ id: `mock-${table}-${i}`, ...r })), error: null }).then(resolve);
          if (state.opType === "upsert") return Promise.resolve({ data: [{ id: "mock-upsert-id", ...state.opPayload }], error: null }).then(resolve);
          if (state.opType === "update") return Promise.resolve({ data: [], error: null }).then(resolve);
          return Promise.resolve({ data: rows.filter((r) => builder._matches(r)).map(row => projectSelected(row, selection)), error: null }).then(resolve);
        },
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
  const notifications = [];
  const notificationModule = require(path.join(backendRoot, "dist/services/NotificationService.js"));
  notificationModule.notifyUser = async (userId, payload) => { notifications.push({ userId, ...payload }); };
  notificationModule.NotificationService.sendToUser = notificationModule.notifyUser;
  const { deviceRuntimeStateService } = require(path.join(backendRoot, "dist/services/deviceRuntimeStateService.js"));
  let providerCalls = 0;
  deviceRuntimeStateService.readProvider = async () => { providerCalls += 1; throw new Error("Read boundary attempted provider polling"); };
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
      id, name: `Device ${id}`, estate_id: "estate-1", home_id: "home-1", room_id: "room-1",
      is_virtual: false, category: "switch", type: "switch", adapter: "tuya",
      online: true, status: null, metadata: {}, is_managed_disabled: false,
      capabilities: [], protocols: [], updated_at: isoAgo(48 * HOUR), last_seen_at: null,
      latitude: null, longitude: null,
      ...overrides,
    };
  }

  // =====================================================================
  // PART A -- geoController.evaluateGeoAlerts
  // =====================================================================
  console.log("\n=== PART A: geoController current-state convergence ===");
  const geoController = require(path.join(backendRoot, "dist/controllers/geoController.js"));

  // Devices are fixed at the home's installation coordinates; the request body carries the
  // USER's current (away) location -- evaluateGeoAlerts alerts when a device's distance from
  // the user's current position exceeds radius_meters, i.e. the device was left behind at home.
  const HOME_LAT = 6.5, HOME_LNG = 3.4; // ~1.1km from the user's away location below
  const USER_AWAY_LAT = 6.51, USER_AWAY_LNG = 3.41;

  const gActiveFresh = device("geo-active-fresh", { latitude: HOME_LAT, longitude: HOME_LNG, status: { switch: true } });
  deviceRuntimeStateService.set(gActiveFresh, completeState({ online: true, switch: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  const gProvisioningOnlyOn = device("geo-provisioning-only-on", { latitude: HOME_LAT, longitude: HOME_LNG, online: true, status: { switch: true } });
  // no runtime observation set -- pure provisioning-mirror claim, must not fabricate an alert
  const gStaleOn = device("geo-stale-on", { latitude: HOME_LAT, longitude: HOME_LNG });
  deviceRuntimeStateService.set(gStaleOn, completeState({ online: true, switch: true }), { providerTimestamp: isoAgo(2 * HOUR), source: "runtime" }); // expired
  const gDisconnectedOn = device("geo-disconnected-on", { latitude: HOME_LAT, longitude: HOME_LNG });
  deviceRuntimeStateService.set(gDisconnectedOn, completeState({ online: true, switch: true, provider_health: "provider_disconnected" }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  const gFreshOff = device("geo-fresh-off", { latitude: HOME_LAT, longitude: HOME_LNG, online: true });
  deviceRuntimeStateService.set(gFreshOff, completeState({ online: true, switch: false }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" }); // runtime says off despite provisioning online:true
  const gNearUser = device("geo-near-user", { latitude: USER_AWAY_LAT, longitude: USER_AWAY_LNG }); // co-located with the user -- within radius, never "left behind" regardless of active state
  deviceRuntimeStateService.set(gNearUser, completeState({ online: true, switch: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });

  const geoDevices = [gActiveFresh, gProvisioningOnlyOn, gStaleOn, gDisconnectedOn, gFreshOff, gNearUser];
  const mockGeo = makeSupabaseMock({ devices: geoDevices, notifications: [] });
  supabaseClientModule.supabaseAdmin = mockGeo;

  const geoReq = mockReq({
    body: { lat: USER_AWAY_LAT, lng: USER_AWAY_LNG, radius_meters: 100 },
    user: { id: "user-geo-1", home_id: "home-1", estate_id: "estate-1" },
  });
  const geoRes = mockRes();
  await geoController.evaluateGeoAlerts(geoReq, geoRes);
  check("A0 geoController: request succeeds (200)", geoRes.statusCode === 200, geoRes.body);
  const alertedIds = new Set((geoRes.body?.alerts || []).map((a) => a.device_id));

  check("A1 geo: fresh + genuinely active device -> alerted", alertedIds.has("geo-active-fresh"));
  check("A2 geo: provisioning online=true with NO runtime observation -> never fabricated an alert", !alertedIds.has("geo-provisioning-only-on"));
  check("A3 geo: stale (expired) observation -> never fabricated an alert", !alertedIds.has("geo-stale-on"));
  check("A4 geo: provider-disconnected observation -> never fabricated an alert", !alertedIds.has("geo-disconnected-on"));
  check("A5 geo: runtime says off despite provisioning online=true -> not alerted (runtime wins)", !alertedIds.has("geo-fresh-off"));
  check("A6 geo: device co-located with the user (within radius) never alerted regardless of active state", !alertedIds.has("geo-near-user"));
  check("A7 geo: exactly 1 batched device_states hydration for the whole evaluation (no N+1)", mockGeo.calls.device_states === 1, mockGeo.calls.device_states);

  // =====================================================================
  // PART B -- proximityService countActiveDevices (via recordProximityEvent's awareness message)
  // =====================================================================
  console.log("\n=== PART B: proximityService current-state convergence ===");
  const proximityService = require(path.join(backendRoot, "dist/services/proximityService.js"));

  const pActiveFresh = device("prox-active-fresh", { home_id: "home-P" });
  deviceRuntimeStateService.set(pActiveFresh, completeState({ online: true, switch: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  const pStaleOn = device("prox-stale-on", { home_id: "home-P" });
  deviceRuntimeStateService.set(pStaleOn, completeState({ online: true, switch: true }), { providerTimestamp: isoAgo(2 * HOUR), source: "runtime" });
  const pProvisioningOnlyOn = device("prox-provisioning-only-on", { home_id: "home-P", online: true });
  const pFreshOff = device("prox-fresh-off", { home_id: "home-P" });
  deviceRuntimeStateService.set(pFreshOff, completeState({ online: true, switch: false }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });

  const proxUser = { id: "user-prox-1", email: "prox@test.local", role: "resident", home_id: "home-P", estate_id: "estate-P" };
  const proxSettingsRow = { user_id: proxUser.id, home_id: "home-P", estate_id: "estate-P", enabled: true, radius_meters: 100, last_distance: 50 };

  const mockProxActive = makeSupabaseMock({
    resident_proximity_settings: [proxSettingsRow],
    devices: [pActiveFresh, pStaleOn, pProvisioningOnlyOn, pFreshOff],
    homes: [], estates: [],
  });
  supabaseClientModule.supabaseAdmin = mockProxActive;
  const proxResultActive = await proximityService.recordProximityEvent(proxUser, { state: "leaving_home", distance_meters: 500 });
  check("B1 proximity: exactly the single fresh+active device is counted (not the stale/no-observation/off ones)", proxResultActive.message === "You left home. 1 device is still on.", proxResultActive.message);
  check("B2 proximity: exactly 1 batched device_states hydration for countActiveDevices (no N+1)", mockProxActive.calls.device_states === 1, mockProxActive.calls.device_states);

  const mockProxNone = makeSupabaseMock({
    resident_proximity_settings: [proxSettingsRow],
    devices: [pStaleOn, pProvisioningOnlyOn, pFreshOff],
    homes: [], estates: [],
  });
  supabaseClientModule.supabaseAdmin = mockProxNone;
  const proxResultNone = await proximityService.recordProximityEvent(proxUser, { state: "leaving_home", distance_meters: 500 });
  check("B3 proximity: stale/no-observation/off devices alone never inflate the active count", proxResultNone.message === "You left home. Your home status is available in Oyi.", proxResultNone.message);

  // =====================================================================
  // PART C -- commandRouter summarize_devices tool
  // =====================================================================
  console.log("\n=== PART C: commandRouter summarize_devices convergence ===");
  const commandRouter = require(path.join(backendRoot, "dist/ai/commandRouter.js"));
  const crActor = { id: "user-cr-1", email: "cr@test.local", role: "resident", home_id: "home-CR", estate_id: "estate-CR", username: "resident" };

  const cConflictA = device("cr-conflict-a", { home_id: "home-CR", estate_id: "estate-CR", online: true }); // provisioning online
  deviceRuntimeStateService.set(cConflictA, completeState({ online: false }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" }); // runtime offline
  const cConflictB = device("cr-conflict-b", { home_id: "home-CR", estate_id: "estate-CR", online: false }); // provisioning offline
  deviceRuntimeStateService.set(cConflictB, completeState({ online: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" }); // runtime online
  const cStale = device("cr-stale", { home_id: "home-CR", estate_id: "estate-CR" });
  deviceRuntimeStateService.set(cStale, completeState({ online: true }), { providerTimestamp: isoAgo(2 * HOUR), source: "runtime" });
  const cNoObs = device("cr-no-obs", { home_id: "home-CR", estate_id: "estate-CR" });

  const crDevices = [cConflictA, cConflictB, cStale, cNoObs];
  const mockCr = makeSupabaseMock({ devices: crDevices, device_states: [] });
  supabaseClientModule.supabaseAdmin = mockCr;

  const listResult = await commandRouter.executeReadToolForTest("summarize_devices", crActor, "list my devices", {});
  const entitiesById = new Map((listResult.data?.conversation_entities || []).map((e) => [e.id, e]));

  check("C1 commandRouter list: provisioning online=true / runtime offline -> online_state offline", entitiesById.get("cr-conflict-a")?.details?.online_state === "offline", entitiesById.get("cr-conflict-a")?.details);
  check("C2 commandRouter list: provisioning online=false / runtime online -> online_state online", entitiesById.get("cr-conflict-b")?.details?.online_state === "online", entitiesById.get("cr-conflict-b")?.details);
  check("C3 commandRouter list: stale observation truthful (not fabricated offline, freshness != fresh)", entitiesById.get("cr-stale")?.details?.online_state !== "offline" && entitiesById.get("cr-stale")?.details?.freshness !== "fresh", entitiesById.get("cr-stale")?.details);
  check("C4 commandRouter list: no observation -> online_state unknown, freshness unknown", entitiesById.get("cr-no-obs")?.details?.online_state === "unknown" && entitiesById.get("cr-no-obs")?.details?.freshness === "unknown", entitiesById.get("cr-no-obs")?.details);
  check("C5 commandRouter list: freshness field now present (previously absent from this listing)", typeof entitiesById.get("cr-conflict-a")?.details?.freshness === "string");
  check("C6 commandRouter list: exactly 1 batched device_states hydration for the whole list (no N+1)", mockCr.calls.device_states === 1, mockCr.calls.device_states);

  // =====================================================================
  // PART D -- commandRouter summarizeHomeStateTool (summarize_home_state)
  // =====================================================================
  console.log("\n=== PART D: commandRouter summarize_home_state convergence ===");
  const homeStateActor = { id: "user-hs-1", email: "hs@test.local", role: "resident", home_id: "home-HS", estate_id: "estate-HS", username: "resident" };
  const hConflictA = device("hs-conflict-a", { home_id: "home-HS", estate_id: "estate-HS", online: true });
  deviceRuntimeStateService.set(hConflictA, completeState({ online: false }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });
  const hConflictB = device("hs-conflict-b", { home_id: "home-HS", estate_id: "estate-HS", online: false });
  deviceRuntimeStateService.set(hConflictB, completeState({ online: true }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });

  const mockHomeState = makeSupabaseMock({
    devices: [hConflictA, hConflictB],
    device_states: [],
    homes: [{ id: "home-HS", name: "Test Home", unit: "1", block: "A", estate_id: "estate-HS" }],
    estates: [{ id: "estate-HS", name: "Test Estate" }],
    rooms: [], notifications: [], maintenance_requests: [], visitor_access: [], community_posts: [],
  });
  supabaseClientModule.supabaseAdmin = mockHomeState;
  const homeStateResult = await commandRouter.executeReadToolForTest("summarize_home_state", homeStateActor, "how is my home", {});
  const homeSummaryCard = (homeStateResult.data?.cards || []).find((c) => c.type === "home_summary");
  const onlineMetric = homeSummaryCard?.items?.find((i) => i.label === "Online")?.value;
  const offlineMetric = homeSummaryCard?.items?.find((i) => i.label === "Offline")?.value;
  check("D1 commandRouter home_state: provisioning-vs-runtime conflicts resolved by the authority (1 online, 1 offline, not 2/0 or 0/2)", onlineMetric === 1 && offlineMetric === 1, { onlineMetric, offlineMetric });

  // =====================================================================
  // PART E -- direct authority cross-check (same device, same result, across all 3 surfaces)
  // =====================================================================
  console.log("\n=== PART E: cross-surface consistency ===");
  const sharedDevice = device("shared-13c-check", { home_id: "home-S13C", estate_id: "estate-S13C", online: true, latitude: 6.5, longitude: 3.4 });
  deviceRuntimeStateService.set(sharedDevice, completeState({ online: false }), { providerTimestamp: isoAgo(1 * MIN), source: "runtime" });

  const directAuthority = await resolveDeviceCurrentStates([sharedDevice]);
  const directAvailability = directAuthority.get("shared-13c-check")?.availability;

  const mockSharedGeo = makeSupabaseMock({ devices: [sharedDevice], notifications: [] });
  supabaseClientModule.supabaseAdmin = mockSharedGeo;
  const sharedGeoRes = mockRes();
  await geoController.evaluateGeoAlerts(mockReq({ body: { lat: 6.5, lng: 3.4, radius_meters: 10 }, user: { id: "user-shared", home_id: "home-S13C", estate_id: "estate-S13C" } }), sharedGeoRes);
  const sharedGeoAlerted = new Set((sharedGeoRes.body?.alerts || []).map((a) => a.device_id)).has("shared-13c-check");
  check("E1 geo agrees with authority: runtime-offline device never alerted as active", sharedGeoAlerted === false, { directAvailability, sharedGeoAlerted });

  const mockSharedCr = makeSupabaseMock({ devices: [sharedDevice], device_states: [] });
  supabaseClientModule.supabaseAdmin = mockSharedCr;
  const sharedCrResult = await commandRouter.executeReadToolForTest("summarize_devices", { ...crActor, home_id: "home-S13C", estate_id: "estate-S13C" }, "list", {});
  const sharedCrEntity = (sharedCrResult.data?.conversation_entities || []).find((e) => e.id === "shared-13c-check");
  check("E2 commandRouter list agrees with authority (same availability value)", sharedCrEntity?.details?.online_state === directAvailability, { authority: directAvailability, commandRouter: sharedCrEntity?.details?.online_state });

  // =====================================================================
  // PART F -- privacy / scope preservation (lightweight; full Slice 1/1B suites also rerun)
  // =====================================================================
  console.log("\n=== PART F: privacy / scope preservation ===");
  const otherHomeDevice = device("other-home-13c", { home_id: "home-OTHER-13C" });
  const mockScopeCr = makeSupabaseMock({ devices: [...crDevices, otherHomeDevice], device_states: [] });
  supabaseClientModule.supabaseAdmin = mockScopeCr;
  const scopedList = await commandRouter.executeReadToolForTest("summarize_devices", crActor, "list", {});
  check("F1 commandRouter list: cross-home device never returned to a home-scoped resident actor", !(scopedList.data?.conversation_entities || []).some((e) => e.id === "other-home-13c"));

  const mockScopeGeo = makeSupabaseMock({ devices: [gActiveFresh, { ...otherHomeDevice, latitude: 6.5, longitude: 3.4 }], notifications: [] });
  supabaseClientModule.supabaseAdmin = mockScopeGeo;
  const scopedGeoRes = mockRes();
  await geoController.evaluateGeoAlerts(mockReq({ body: { lat: 6.5, lng: 3.4, radius_meters: 100 }, user: { id: "user-geo-scope", home_id: "home-1", estate_id: "estate-1" } }), scopedGeoRes);
  check("F2 geo: cross-home device never evaluated for another home's alert batch", (scopedGeoRes.body?.evaluated || 0) === 1, scopedGeoRes.body);

  // =====================================================================
  // PART G -- command-adjacent / diagnostic call sites left untouched (intentional exceptions)
  // =====================================================================
  console.log("\n=== PART G: intentional exceptions preserved ===");
  const fs = require("fs");
  const commandRouterSource = fs.readFileSync(path.join(backendRoot, "src/ai/commandRouter.ts"), "utf8");
  const deviceOfflineCallSites = (commandRouterSource.match(/deviceOffline\(/g) || []).length;
  check("G1 commandRouter: deviceOffline() pre-dispatch command gate still present (command authorization untouched)", deviceOfflineCallSites >= 4, deviceOfflineCallSites);
  check("G2 commandRouter: logDeviceCommandDiagnostic's normalizeDeviceOnlineState diagnostic call untouched", /logDeviceCommandDiagnostic\("ai\.device\.resolve"/.test(commandRouterSource));
  const deviceCommandControllerSource = fs.readFileSync(path.join(backendRoot, "src/controllers/deviceCommandController.ts"), "utf8");
  check("G3 deviceCommandController: normalizeDeviceOnlineState still used for its own diagnostic purpose (out of Slice 13C READ/PRESENTATION scope)", /normalizeDeviceOnlineState/.test(deviceCommandControllerSource));
  const watchAdapterSource = fs.readFileSync(path.join(backendRoot, "src/services/watchAdapterService.ts"), "utf8");
  check("G4 watchAdapterService: Slice 13B diagnostic normalizeDeviceOnlineState usage untouched", /normalizeDeviceOnlineState/.test(watchAdapterSource));

  // =====================================================================
  // PART H -- exhaustive residual bypass search (Section 16)
  // =====================================================================
  console.log("\n=== PART H: exhaustive residual bypass search ===");
  const { execSync } = require("child_process");
  function grepCount(pattern, glob) {
    try {
      const out = execSync(`grep -rl --include='${glob}' -E '${pattern}' src`, { cwd: backendRoot }).toString().trim();
      return out ? out.split("\n") : [];
    } catch {
      return [];
    }
  }
  const geoHits = grepCount('normalizeDeviceOnlineState\\(device\\)|from\\("device_states"\\)', "geoController.ts");
  check("H1 geoController.ts no longer contains a raw device_states / normalizeDeviceOnlineState generic read", geoHits.length === 0, geoHits);
  const proximityHits = grepCount('normalizeDeviceOnlineState\\(device\\)', "proximityService.ts");
  check("H2 proximityService.ts no longer calls normalizeDeviceOnlineState directly", proximityHits.length === 0, proximityHits);
  // commandRouter.ts is expected to still contain normalizeDeviceOnlineState -- classified DIAGNOSTIC/command-adjacent (Part G), not a bypass.
  const summarizeDevicesBlockMatch = commandRouterSource.match(/if \(toolId === "summarize_devices"\) \{[\s\S]*?\n  \}\n/);
  const summarizeDevicesCodeOnly = (summarizeDevicesBlockMatch?.[0] || "").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  check("H3 summarize_devices tool block no longer derives `online` via normalizeDeviceOnlineState (uses resolveDeviceCurrentStates instead)", summarizeDevicesBlockMatch && !/normalizeDeviceOnlineState/.test(summarizeDevicesCodeOnly) && /resolveDeviceCurrentStates/.test(summarizeDevicesCodeOnly));

  // Same observations through REAL caller query chains. Instrument only the authority
  // boundary, never substitute its results. SELECT projection is honored by the mock.
  console.log("\n=== PART I: authority inputs across every read boundary ===");
  const authorityModule = require(path.join(backendRoot, "dist/oyi-core/domains/devices/deviceCurrentStateAuthority.js"));
  const originalResolve = authorityModule.resolveDeviceCurrentStates;
  const evidenceModule = require(path.join(backendRoot, "dist/oyi-core/domains/devices/deviceEvidence.js"));
  const watchModule = require(path.join(backendRoot, "dist/services/watchAdapterService.js"));
  const facilityModule = require(path.join(backendRoot, "dist/controllers/deviceEstateController.js"));
  const registryModule = require(path.join(backendRoot, "dist/controllers/deviceRegistryController.js"));
  const superAdminModule = require(path.join(backendRoot, "dist/controllers/superAdminController.js"));
  const infrastructureModule = require(path.join(backendRoot, "dist/controllers/facilityInfrastructureController.js"));
  const spatialModule = require(path.join(backendRoot, "dist/services/spatialFacilityContextService.js"));
  const referenceModule = require(path.join(backendRoot, "dist/services/canonicalReferenceResolver.js"));
  const officeRouter = require(path.join(backendRoot, "dist/routes/officeExport.js")).default;
  const actor = { id: "read-user", role: "resident", estate_id: "read-estate", home_id: "read-home" };
  const operator = { ...actor, role: "estate_admin" };
  const home = { id: actor.home_id, estate_id: actor.estate_id, name: "Fixture Home", canonical_ref: "fixture-home" };
  const settings = { user_id: actor.id, home_id: actor.home_id, estate_id: actor.estate_id, enabled: true, radius_meters: 100, last_distance: 50 };
  const specimens = [
    device("matrix-switch", { type: "switch" }),
    device("matrix-ir", { type: "ac", is_virtual: true, metadata: { control_profile: "ir", ir_appliance: { remote_id: "fixture-remote" } } }),
    device("matrix-lock", { type: "lock", metadata: { control_profile: "lock" } }),
    device("matrix-disconnected", {}),
    device("matrix-unknown-class", { type: "unrecognized", category: "unrecognized" }),
  ].map(d => ({ ...d, external_id: d.id, home_id: actor.home_id, estate_id: actor.estate_id, latitude: HOME_LAT, longitude: HOME_LNG, online: false, status: "offline" }));
  for (const d of specimens) {
    deviceRuntimeStateService.set(d, completeState({ online: true, switch: true, ...(d.id.includes("disconnected") ? { provider_health: "provider_disconnected" } : {}) }), {
      providerTimestamp: isoAgo(d.id.includes("ir") || d.id.includes("lock") ? 20 * MIN : MIN), source: "runtime",
    });
  }
  const expected = await originalResolve(specimens);
  const truth = c => [c?.availability, c?.freshness, c?.observedAt, c?.source, c?.reason];
  const hydrationModule = require(path.join(backendRoot, "dist/services/canonicalDevicePanelHydrationService.js"));
  supabaseClientModule.supabaseAdmin = makeSupabaseMock(tables(specimens));
  for (const d of specimens) {
    const hydrated = await hydrationModule.hydrateCanonicalDevicePanel({ actor, deviceId: d.id, estateId: actor.estate_id, homeId: actor.home_id });
    check(`I authorized exact-device hydration/${d.id}: same authority truth`, hydrated.status === "hydrated" && JSON.stringify(truth(hydrated.panel.current_state)) === JSON.stringify(truth(expected.get(d.id))));
  }
  const panelModule = require(path.join(backendRoot, "dist/controllers/deviceStateController.js"));
  const dashboardModule = require(path.join(backendRoot, "dist/controllers/deviceRuntimeStateController.js"));
  for (const d of specimens) {
    const snapshot = deviceRuntimeStateService.get(d.id);
    for (const [name, panel] of [
      ["exact device panel", panelModule.buildDeviceStateResponse({ device: d, runtime: snapshot })],
      ["runtime dashboard", dashboardModule.buildCompactRuntimeDashboardDevice(d, snapshot)],
    ]) {
      check(`I ${name}/${d.id}: same authority truth`, JSON.stringify(truth(panel.current_state)) === JSON.stringify(truth(expected.get(d.id))));
      check(`I ${name}/${d.id}: unavailable cannot claim current ON`, panel.current_state.availability === "online" || panel.primary_state === "unknown");
    }
  }
  check("I0 battery lock and virtual IR retain their existing class policy at 20 minutes", expected.get("matrix-ir")?.freshness === "fresh" && expected.get("matrix-lock")?.freshness === "fresh");
  check("I0b fresh is not available for a disconnected provider", expected.get("matrix-disconnected")?.freshness === "fresh" && expected.get("matrix-disconnected")?.availability === "provider_disconnected");
  let captured = new Map();
  authorityModule.resolveDeviceCurrentStates = async rows => {
    const result = await originalResolve(rows);
    for (const [id, value] of result) captured.set(id, value);
    return result;
  };
  const originalReference = referenceModule.resolveCanonicalRef;
  referenceModule.resolveCanonicalRef = async (_estate, ref) => ({ status: "resolved", entity_type: "home", canonical_id: home.id, canonical_ref: ref });
  const officeRead = async (route, req = {}) => {
    const layer = officeRouter.stack.find(l => l.route?.path === route && l.route.methods.get);
    const res = mockRes();
    await layer.route.stack.at(-1).handle(mockReq(req), res);
    return res;
  };
  const callers = {
    evidence: () => evidenceModule.loadHomeDeviceInventoryFacts({ ...actor, context: {} }, { estate_id: actor.estate_id, home_id: actor.home_id }),
    Watch: () => watchModule.getWatchFavorites(actor),
    Facility: async () => { const res = mockRes(); await facilityModule.getEstateDevices(mockReq({ params: { estateId: actor.estate_id }, user: operator, oisContext: { estate_id: actor.estate_id, home_id: actor.home_id } }), res); check("Facility request succeeds", res.statusCode === 200); return res; },
    FacilityRegistry: async () => { const res = mockRes(); await registryModule.listRegisteredDevices(mockReq({ user: operator }), res); check("Facility registry request succeeds", res.statusCode === 200); return res; },
    OfficeDevices: async () => { const res = mockRes(); await superAdminModule.listDevices(mockReq({ user: operator }), res); check("Office device request succeeds", res.statusCode === 200); return res; },
    FacilityInfrastructure: async () => { const res = mockRes(); await infrastructureModule.getFacilityInfrastructure(mockReq({ user: operator }), res); check("Facility infrastructure request succeeds", res.statusCode === 200); return res; },
    geo: async () => { const res = mockRes(); await geoController.evaluateGeoAlerts(mockReq({ user: actor, body: { lat: USER_AWAY_LAT, lng: USER_AWAY_LNG, radius_meters: 100 } }), res); check("geo request succeeds", res.statusCode === 200); return res; },
    proximity: () => proximityService.recordProximityEvent(actor, { state: "leaving_home", distance_meters: 500 }),
    commandRouter: () => commandRouter.executeReadToolForTest("summarize_devices", actor, "List my devices", {}),
    Spatial: () => spatialModule.resolveSpatialFacilityContext(actor.estate_id, home.canonical_ref, operator),
    Office: () => officeRead("/portfolio/projection"),
    OfficeExport: () => officeRead("/export"),
  };
  function tables(rows) { return { devices: rows, homes: [home], estates: [{ id: actor.estate_id, name: "Fixture Estate" }], resident_proximity_settings: [settings] }; }
  for (const [name, call] of Object.entries(callers)) {
    captured = new Map();
    supabaseClientModule.supabaseAdmin = makeSupabaseMock(tables(specimens));
    const result = await call();
    for (const d of specimens) check(`I ${name}/${d.id}: same availability/freshness/observedAt/source/reason`, JSON.stringify(truth(captured.get(d.id))) === JSON.stringify(truth(expected.get(d.id))), truth(captured.get(d.id)));
    if (name === "Office") check("I Office online count excludes fresh disconnection", result.body?.estates?.[0]?.devices_online === 4, result.body);
  }

  const answersModule = require(path.join(backendRoot, "dist/oyi-core/presentation/conversationAnswerPresentation.js"));
  const deviceAnswers = require(path.join(backendRoot, "dist/oyi-core/domains/devices/deviceConversationAnswers.js"));
  const hydrationRegistry = require(path.join(backendRoot, "dist/oyi-core/runtime/canonicalTargetHydrationRegistry.js"));
  supabaseClientModule.supabaseAdmin = makeSupabaseMock(tables(specimens));
  const inventoryFacts = await callers.evidence();
  const onlineAnswer = answersModule.buildDeviceAvailabilityInventoryAnswer(inventoryFacts, undefined, "Which devices are online?");
  check("I online answer excludes the fresh disconnected device", onlineAnswer.includes("matrix switch") && !onlineAnswer.includes("matrix disconnected"), onlineAnswer);
  for (const d of specimens) {
    const panel = panelModule.buildDeviceStateResponse({ device: d, runtime: deviceRuntimeStateService.get(d.id) });
    const { object } = hydrationRegistry.mapDevicePanelToHydrationForTest({ panel, device: d });
    const facts = { state: { availability: panel.current_state.availability, freshness: panel.freshness, provider_health: panel.provider_health } };
    const fact = evidenceModule.factFromOperationalObject(object, facts, { message: "Is my AC on?", surface: "consumer" }, null);
    const answer = deviceAnswers.buildDeviceCurrentStateAnswer(object, facts, { target: {} }, { factFromObject: () => fact });
    check(`I exact answer/${d.id}: fresh disconnected is not current confirmation`, panel.current_state.availability === "online" || (!answer.includes("latest reading confirms") && fact.truth_state === "unavailable"), answer);
  }

  console.log("\n=== PART J: adversarial state and side effects ===");
  const bad = [
    device("bad-disconnected", {}), device("bad-offline", {}), device("bad-unknown", {}), device("bad-stale", {}), device("bad-absent", {}),
  ].map(d => ({ ...d, external_id: d.id, estate_id: actor.estate_id, home_id: actor.home_id, latitude: HOME_LAT, longitude: HOME_LNG }));
  deviceRuntimeStateService.set(bad[0], completeState({ online: true, switch: true, provider_health: "provider_disconnected" }), { providerTimestamp: isoAgo(MIN) });
  deviceRuntimeStateService.set(bad[1], completeState({ online: false, switch: true }), { providerTimestamp: isoAgo(MIN) });
  deviceRuntimeStateService.set(bad[2], completeState({ online: null, normalized_state: { online: null }, switch: true }), { providerTimestamp: isoAgo(MIN) });
  deviceRuntimeStateService.set(bad[3], completeState({ online: true, switch: true }), { providerTimestamp: isoAgo(20 * MIN) });
  supabaseClientModule.supabaseAdmin = makeSupabaseMock(tables(bad));
  notifications.length = 0;
  const badGeo = await callers.geo();
  check("J geo emits no alerts or notification-side effects for untrustworthy ON", badGeo.body?.alerts?.length === 0 && notifications.length === 0);
  const badProx = await callers.proximity();
  check("J proximity retains transition but never claims devices still on", !/still on/.test(badProx.message) && notifications.every(n => !/still on/.test(n.message)));
  for (const d of bad) {
    supabaseClientModule.supabaseAdmin = makeSupabaseMock(tables([d]));
    const result = await commandRouter.routeAiCommand(undefined, { actor, surface: "consumer", scope: "home", prompt: `What is the status of ${d.name}?`, proposedTools: [{ tool_id: "device_command", arguments: { device_id: d.id } }] });
    const verdict = expected.get(d.id) || (await originalResolve([d])).get(d.id);
    check(`J read-only status ${d.id} uses canonical truth, never unknown -> available`, result.results?.[0]?.data?.current_state?.availability === verdict.availability && !/is available/.test(result.results?.[0]?.summary || ""), result.results?.[0]);
  }

  console.log("\n=== PART K: cold batches, 10 / 50 / 100 ===");
  for (const count of [10, 50, 100]) {
    for (const name of ["proximity", "commandRouter", "Spatial", "Office"]) {
      const rows = Array.from({ length: count }, (_, i) => device(`batch-${name}-${count}-${i}`, { home_id: actor.home_id, estate_id: actor.estate_id }));
      const mock = makeSupabaseMock(tables(rows));
      supabaseClientModule.supabaseAdmin = mock;
      await callers[name]();
      check(`K ${name}/${count}: one batched snapshot query, no N+1`, mock.calls.device_states === 1, mock.calls);
    }
  }
  authorityModule.resolveDeviceCurrentStates = originalResolve;
  referenceModule.resolveCanonicalRef = originalReference;
  check("K all read boundaries made zero provider calls", providerCalls === 0);

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
