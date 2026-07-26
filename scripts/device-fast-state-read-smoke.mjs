#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "device-fast-state-smoke-service-role-key";

const { createGetDeviceState } = await import("../dist/controllers/deviceStateController.js");
const { enrichDeviceProviderState } = await import("../dist/device/runtime/deviceStateEnrichment.js");
const { deviceReadScopeCache } = await import("../dist/services/deviceReadScopeCache.js");
const deviceRoutesSource = await readFile(new URL("../src/routes/devices.ts", import.meta.url), "utf8");

const checks = [];
const check = (passed, label) => checks.push([Boolean(passed), label]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const device = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Living Room Switch",
  estate_id: "estate-1",
  home_id: "home-1",
  room_id: "room-1",
  external_id: "tuya-1",
  vendor: "tuya",
  adapter: "tuya",
  category: "kg",
  type: "switch",
  capabilities: ["switch_1", "countdown_1"],
  metadata: { device_family: "switch", control_profile: "switch" },
};

deviceReadScopeCache.set(device);
check(deviceReadScopeCache.get(device.id, device.estate_id)?.id === device.id, "scope cache returns a recently verified device");
check(deviceReadScopeCache.get(device.id, "another-estate") === null, "scope cache rejects cross-estate reads");
deviceReadScopeCache.invalidate(device.id);
check(deviceReadScopeCache.get(device.id, device.estate_id) === null, "assignment invalidation removes cached device scope");
check(deviceRoutesSource.includes('router.get("/runtime", requireDeviceRuntimeReadAuth'), "runtime dashboard uses the bounded read-auth cache");
check(deviceRoutesSource.includes('router.get("/:deviceId/state", requireDeviceRuntimeReadAuth'), "state reads use the bounded read-auth cache");
check(deviceRoutesSource.includes('router.post("/:deviceId/command", requireAuth'), "device commands keep uncached canonical authentication");

const snapshot = {
  device_id: device.id,
  state: {
    switch_1: false,
    online: true,
    normalized_state: { power: false, online: true, switches: { switch_1: false } },
    primary_state: "off",
    health_status: "stable",
    provider_health: "healthy",
    supported_controls: ["power", "timer"],
    capability_codes: ["switch_1", "countdown_1"],
    channel_definitions: [{ index: 1, code: "switch_1", name: "Main", state: false, controllable: true, last_update: null }],
    telemetry_summary: {},
    activity_summary: "Living Room Switch is idle.",
    device_family: "switch",
    device_type: "switch",
    control_profile: "switch",
  },
  summary: {
    normalized_state: { power: false, online: true, switches: { switch_1: false } },
    capabilities: ["switch_1", "countdown_1"],
    supported_controls: ["power", "timer"],
    control_profile: "switch",
    health_status: "stable",
    provider_health: "healthy",
    primary_state: "off",
    telemetry_summary: {},
    device_family: "switch",
    device_type: "switch",
    last_signal: "Living Room Switch is idle.",
    activity_summary: "Living Room Switch is idle.",
    channel_definitions: [{ index: 1, code: "switch_1", name: "Main", state: false, controllable: true, last_update: null }],
    capability_codes: ["switch_1", "countdown_1"],
  },
  provider_timestamp: null,
  runtime_timestamp: "2026-07-16T10:00:00.000Z",
  last_refresh: "2026-07-16T10:00:00.000Z",
  ttl: 10_000,
  stale: false,
  freshness: "fresh",
  age_ms: 0,
  provider_latency_ms: 300,
  dirty: false,
  source: "runtime",
  provider_error: null,
  authorization_state: "authorized",
  provider_warning: null,
  retry_after: null,
  last_successful_refresh: "2026-07-16T10:00:00.000Z",
};

function request(include = "", extraQuery = {}) {
  return {
    params: { deviceId: device.id },
    query: { ...(include ? { include } : {}), ...extraQuery },
    headers: {},
    user: { id: "user-1", role: "resident", estate_id: "estate-1", home_id: "home-1" },
    oisContext: { estate_id: "estate-1", home_id: "home-1" },
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    removeHeader(name) { delete this.headers[String(name).toLowerCase()]; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    type(value) { this.headers["content-type"] = value; return this; },
    send(body) { this.body = typeof body === "string" ? JSON.parse(body) : body; return this; },
  };
}

function runtime(overrides = {}) {
  return {
    has: () => true,
    get: () => snapshot,
    hydrateSnapshot: () => snapshot,
    markViewed: () => snapshot,
    shouldRefresh: () => false,
    scheduleRefresh: () => {},
    ...overrides,
  };
}

let warmSnapshotRequested = null;
let warmProviderReads = 0;
const warmHandler = createGetDeviceState({
  runtime: runtime({ scheduleRefresh: () => { warmProviderReads += 1; } }),
  findDevice: async ({ includeSnapshot }) => {
    warmSnapshotRequested = includeSnapshot;
    await wait(5);
    return { device, snapshot: null };
  },
});
const warmResponse = response();
const warmStarted = performance.now();
await warmHandler(request(), warmResponse);
const warmDuration = performance.now() - warmStarted;
check(warmResponse.statusCode === 200, "warm memory state returns successfully");
check(warmSnapshotRequested === false, "warm memory response avoids device_states lookup");
check(warmProviderReads === 0, "warm memory response performs no provider request");
check(!("timeline" in warmResponse.body) && !("memory_summary" in warmResponse.body), "timeline and intelligence are excluded by default");
check(warmDuration < 150, `warm memory synthetic response meets 150ms target (${warmDuration.toFixed(1)}ms)`);

let coldJoinedLookups = 0;
const coldHandler = createGetDeviceState({
  runtime: runtime({
    has: () => false,
    get: () => null,
    hydrateSnapshot: (_device, row) => row ? { ...snapshot, source: "persistent_snapshot" } : null,
  }),
  findDevice: async ({ includeSnapshot }) => {
    coldJoinedLookups += 1;
    await wait(25);
    return { device, snapshot: includeSnapshot ? { device_id: device.id, status: snapshot.state, last_seen: snapshot.last_refresh, updated_at: snapshot.runtime_timestamp } : null };
  },
});
const coldResponse = response();
const coldStarted = performance.now();
await coldHandler(request(), coldResponse);
const coldDuration = performance.now() - coldStarted;
check(coldResponse.statusCode === 200 && coldResponse.body.source === "persistent_snapshot", "cold persisted state seeds runtime and returns successfully");
check(coldJoinedLookups === 1, "cold persisted response uses one joined device and snapshot lookup");
check(coldDuration < 500, `cold persisted synthetic response meets 500ms target (${coldDuration.toFixed(1)}ms)`);

const deferred = [];
let staleRefreshes = 0;
const staleSnapshot = { ...snapshot, stale: true, freshness: "stale", dirty: false };
const staleHandler = createGetDeviceState({
  runtime: runtime({
    get: () => staleSnapshot,
    shouldRefresh: () => true,
    scheduleRefresh: () => { staleRefreshes += 1; },
  }),
  findDevice: async () => ({ device, snapshot: null }),
  defer: (operation) => deferred.push(operation),
});
const staleResponse = response();
const staleStarted = performance.now();
await staleHandler(request(), staleResponse);
const staleDuration = performance.now() - staleStarted;
check(staleResponse.statusCode === 200 && staleResponse.body.stale === true, "stale cached state returns immediately");
check(staleRefreshes === 0 && deferred.length === 0, "ordinary stale reads do not schedule provider refreshes");
check(staleDuration < 150, `stale synthetic response is not delayed by refresh (${staleDuration.toFixed(1)}ms)`);

const panelDeferred = [];
let panelRefreshes = 0;
let panelLeases = 0;
const panelStaleHandler = createGetDeviceState({
  runtime: runtime({
    get: () => staleSnapshot,
    shouldRefresh: () => true,
    markViewed: () => {
      panelLeases += 1;
      return { ...staleSnapshot, viewed_until_at: "2026-07-16T10:00:45.000Z" };
    },
    scheduleRefresh: (_device, input) => {
      if (input?.reason === "device_panel_view_stale" && input?.markDirty === false) panelRefreshes += 1;
    },
  }),
  findDevice: async () => ({ device, snapshot: null }),
  defer: (operation) => panelDeferred.push(operation),
});
const panelStaleResponse = response();
await panelStaleHandler(request("", { view: "panel" }), panelStaleResponse);
check(panelStaleResponse.statusCode === 200 && panelLeases === 1, "panel stale read acquires a single explicit view lease");
check(panelRefreshes === 0 && panelDeferred.length === 1, "panel stale provider refresh is deferred beyond the response");
panelDeferred.forEach((operation) => operation());
check(panelRefreshes === 1, "deferred panel refresh remains targeted and non-dirty");

let intelligenceLoads = 0;
let timelineBuilds = 0;
const includeHandler = createGetDeviceState({
  runtime: runtime(),
  findDevice: async () => ({ device, snapshot: null }),
  loadIntelligence: async () => {
    intelligenceLoads += 1;
    return { memory_summary: { headline: "Everything looks normal." }, relationships: { room_name: "Living Room" } };
  },
  buildTimeline: () => {
    timelineBuilds += 1;
    return [{ title: "Turned off" }];
  },
});
const includeResponse = response();
await includeHandler(request("intelligence,timeline"), includeResponse);
check(intelligenceLoads === 1 && timelineBuilds === 1, "optional intelligence and timeline includes remain compatible");
check(includeResponse.body.memory_summary?.headline && includeResponse.body.timeline?.length === 1, "optional include payload is returned");

const enriched = enrichDeviceProviderState({
  state: {
    online: true,
    __raw: { secret: true },
    normalized_state: {},
    provider_health: "healthy",
    health_status: "stable",
    primary_state: "on",
    switch: true,
    switch_1: true,
    switch_2: false,
    countdown_1: 0,
    relay_status: true,
    "volume+": true,
    power: true,
    temperature: 24,
    fan: "auto",
    swing: true,
  },
  metadata: { device_family: "switch", control_profile: "switch", product_name: "AC Bedroom Relay", model: "MODEL-X", raw: { category: "kg" } },
  device: { name: "AC Bedroom Switch", category: "kg", type: "switch" },
});
const publicCodes = new Set(enriched.capability_codes);
for (const code of ["switch_1", "switch_2", "countdown_1", "relay_status", "volume+", "power", "temperature", "fan", "swing"]) {
  check(publicCodes.has(code), `public capabilities preserve provider function code ${code}`);
}
for (const code of ["online", "__raw", "normalized_state", "provider_health", "health_status", "primary_state", "switch", "kg", "wnykq", "infrared_tv", "device", "generic", "unknown", "ac bedroom relay", "model-x"]) {
  check(!publicCodes.has(code), `public capabilities exclude internal or identity value ${code}`);
}

for (const [passed, label] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
if (checks.some(([passed]) => !passed)) process.exit(1);
