#!/usr/bin/env node
// Facility Spatial Mode Convergence, Foundation Slice 3 -- Spatial Facility
// Read Path. Real behavioral coverage against the compiled
// resolveSpatialFacilityContext() with a controllable fake Supabase client
// standing in for homes/rooms/devices/maintenance_requests/
// facility_incidents/facility_cameras, plus a monkeypatched
// deviceRuntimeStateService.getOrHydrate -- same monkeypatch pattern
// already proven by the Slice 2 resolver/readiness smokes. No live
// database and no real device provider/adapter registry required.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";

const { resolveSpatialFacilityContext } = await import("../dist/services/spatialFacilityContextService.js");
const { supabaseAdmin } = await import("../dist/supabase/supabaseClient.js");
const { deviceRuntimeStateService } = await import("../dist/services/deviceRuntimeStateService.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
const originalHydrateMany = deviceRuntimeStateService.hydrateMany.bind(deviceRuntimeStateService);
const originalGet = deviceRuntimeStateService.get.bind(deviceRuntimeStateService);

// Generic in-memory table supporting every chain shape the service and its
// reused dependencies (canonicalReferenceResolver, platformGapService.
// incidents) actually issue: .eq() in any order relative to
// .order()/.limit(), .maybeSingle(), or a bare await (thenable).
function makeTable(rows) {
  return {
    select(fields = '*') {
      const project = row => !row ? null : fields === '*' ? row : Object.fromEntries(fields.split(',').map(key => [key, row[key] ?? null]));
      const filters = {};
      const inFilters = {};
      let limitN = null;
      const builder = {
        eq(col, val) {
          filters[col] = val;
          return builder;
        },
        in(col, vals) { inFilters[col] = vals; return builder; },
        order() {
          return builder;
        },
        limit(n) {
          limitN = n;
          return builder;
        },
        maybeSingle() {
          const matched = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
          return Promise.resolve({ data: project(matched[0]), error: null });
        },
        then(resolve, reject) {
          let matched = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v) && Object.entries(inFilters).every(([k, vals]) => vals.includes(r[k])));
          if (limitN != null) matched = matched.slice(0, limitN);
          Promise.resolve({ data: matched.map(project), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const HOMES = [
  { id: "home-1", estate_id: "estate-1", canonical_ref: "LUNA-L06-APT-A", name: "Apartment A", unit: "L06-A", block: "L06", floor: "6", type: "home", building_id: "building-1", zone_id: null },
  { id: "home-other-estate", estate_id: "estate-2", canonical_ref: "OTHER-ESTATE-HOME", name: "Other Home", unit: null, block: null, floor: null, type: "home", building_id: null, zone_id: null },
  { id: "home-dup", estate_id: "estate-1", canonical_ref: "DUP-REF", name: "Dup Home", unit: null, block: null, floor: null, type: "home", building_id: null, zone_id: null },
];
const ROOMS = [
  { id: "room-1", estate_id: "estate-1", home_id: "home-1", canonical_ref: "LUNA-L06-APT-A-BEDROOM1", name: "Bedroom 1", type: "bedroom", floor: null },
  { id: "room-dup", estate_id: "estate-1", home_id: "home-1", canonical_ref: "DUP-REF", name: "Dup Room", type: "bedroom", floor: null },
];
const DEVICE_1 = {
  id: "device-1", estate_id: "estate-1", home_id: "home-1", room_id: "room-1", canonical_ref: "LUNA-L06-APT-A-BEDROOM1-AC",
  name: "Bedroom AC", type: "ac", category: "climate", adapter: "tuya", vendor: "Tuya", provider: "tuya",
  external_id: "ext-1", parent_device_id: null, is_virtual: false, online: true, status: "online",
  capabilities: ["power", "temperature"], metadata: {}, last_seen_at: new Date().toISOString(), last_event_at: null, updated_at: new Date().toISOString(),
};
const DEVICES = [DEVICE_1];

const MAINTENANCE = [
  { id: "maint-open", estate_id: "estate-1", home_id: "home-1", room_id: "room-1", title: "Leaky faucet", status: "open", priority: "medium", assigned_to: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "maint-closed", estate_id: "estate-1", home_id: "home-1", room_id: "room-1", title: "Old ticket", status: "closed", priority: "low", assigned_to: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];
const INCIDENTS = [
  { id: "incident-1", estate_id: "estate-1", home_id: "home-1", room_id: null, title: "Water leak", status: "open", severity: "medium", created_at: new Date().toISOString() },
];
const CAMERAS = [
  { id: "camera-1", estate_id: "estate-1", home_id: "home-1", name: "Entrance cam", privacy_scope: "facility", metadata: {}, ai_enabled: false },
];

function fakeFrom(overrides = {}) {
  const tables = {
    homes: HOMES,
    rooms: ROOMS,
    devices: DEVICES,
    device_states: [],
    maintenance_requests: MAINTENANCE,
    facility_incidents: INCIDENTS,
    facility_cameras: CAMERAS,
    ...overrides,
  };
  return (table) => {
    if (tables[table]) return makeTable(tables[table]);
    return originalFrom(table);
  };
}

const FULL_ACTOR = { id: "actor-1", role: "estate_admin", estate_id: "estate-1", permission_scopes: ["twin.view", "homes.read", "devices.read", "support.read", "cameras.view"] };

const FAKE_RUNTIME_SNAPSHOT = {
  device_id: "device-1",
  state: { online: true, power: "on", temperature: 22 },
  summary: { availability: "online", label: "Bedroom AC" },
  provider_timestamp: new Date().toISOString(),
  runtime_timestamp: new Date().toISOString(),
  last_refresh: new Date().toISOString(),
  ttl: 10000,
  stale: false,
  freshness: "fresh",
  age_ms: 500,
  provider_latency_ms: 120,
  dirty: false,
  source: "runtime",
  provider_error: null,
  authorization_state: "authorized",
  provider_warning: null,
  retry_after: null,
  last_successful_refresh: new Date().toISOString(),
};

// 1 & 2. Valid device canonical_ref resolves to real Facility device
// context. Runtime evidence is retained, while generic availability/freshness
// is projected by the single current-state authority, not registry mirrors.
{
  supabaseAdmin.from = fakeFrom();
  deviceRuntimeStateService.hydrateMany = async (devices) => {
    need(devices[0].id === "device-1", "authority hydration must use the resolved device row");
  };
  deviceRuntimeStateService.get = () => FAKE_RUNTIME_SNAPSHOT;
  const result = await resolveSpatialFacilityContext("estate-1", "LUNA-L06-APT-A-BEDROOM1-AC", FULL_ACTOR);
  need(result.status === "resolved", `expected resolved, got ${result.status}`);
  if (result.status === "resolved") {
    const ctx = result.context;
    need(ctx.entity_type === "device", `expected entity_type device, got ${ctx.entity_type}`);
    need(ctx.canonical_id === "device-1", "canonical_id must be the real device UUID");
    need(ctx.scope.home_id === "home-1" && ctx.scope.room_id === "room-1", "device scope must reflect its real home/room");
    need(ctx.operational_state.summary.label === FAKE_RUNTIME_SNAPSHOT.summary.label, "runtime summary identity must be preserved");
    need(ctx.operational_state.summary.availability === ctx.operational_state.current_state.availability, "summary availability must agree with the authority");
    need(ctx.operational_state.current_state.observedState === FAKE_RUNTIME_SNAPSHOT.state, "observed evidence must remain the runtime snapshot, not reconstructed state");
    need(!("health_status" in FAKE_RUNTIME_SNAPSHOT.summary), "presentation must not mutate the authoritative runtime cache");
    need(ctx.operational_state.freshness === "fresh", "operational_state.freshness must come from the runtime snapshot");
    need(ctx.operational_state.online === true, "operational_state.online must reflect the live runtime state");
    need(Array.isArray(ctx.available_capabilities) && ctx.available_capabilities.includes("view"), "a viewable device must expose at least the view capability");
    need(!("execute" in ctx), "the context must never expose a command/execute affordance -- this slice is read-only");
  }
  supabaseAdmin.from = originalFrom;
  deviceRuntimeStateService.hydrateMany = originalHydrateMany;
  deviceRuntimeStateService.get = originalGet;
}

// 3. Home canonical_ref resolves correctly, with bounded related records.
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveSpatialFacilityContext("estate-1", "LUNA-L06-APT-A", FULL_ACTOR);
  need(result.status === "resolved", `expected resolved, got ${result.status}`);
  if (result.status === "resolved") {
    const ctx = result.context;
    need(ctx.entity_type === "home", `expected entity_type home, got ${ctx.entity_type}`);
    need(ctx.canonical_id === "home-1", "canonical_id must be the real home UUID");
    need(ctx.operational_state === null, "a home has no single operational_state concept in current schema -- must be null, not fabricated");
    need(ctx.related_operational_records.maintenance.permitted === true, "maintenance must be permitted for an actor holding support.read");
    need(ctx.related_operational_records.maintenance.items.length === 1, `expected exactly 1 open maintenance item (closed ticket excluded), got ${ctx.related_operational_records.maintenance.items.length}`);
    need(ctx.related_operational_records.incidents.items.length === 1, "expected exactly 1 incident scoped to this home");
    need(ctx.related_operational_records.devices.items.length === 1, "expected exactly 1 device scoped to this home");
    need(ctx.related_operational_records.cameras.items.length === 1, "expected exactly 1 camera scoped to this home");
  }
  supabaseAdmin.from = originalFrom;
}

// 4. Room canonical_ref resolves correctly, narrower than its parent home.
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveSpatialFacilityContext("estate-1", "LUNA-L06-APT-A-BEDROOM1", FULL_ACTOR);
  need(result.status === "resolved", `expected resolved, got ${result.status}`);
  if (result.status === "resolved") {
    const ctx = result.context;
    need(ctx.entity_type === "room", `expected entity_type room, got ${ctx.entity_type}`);
    need(ctx.canonical_id === "room-1", "canonical_id must be the real room UUID");
    need(ctx.scope.home_id === "home-1", "a room's scope must surface its parent home_id");
    need(ctx.related_operational_records.maintenance.items.length === 1, "room-scoped maintenance must match the room_id-filtered ticket");
    need(ctx.related_operational_records.cameras.permitted === true && ctx.related_operational_records.cameras.items.length === 0, "cameras are only home-scoped today -- a room context must disclose zero cameras honestly, not fabricate room-level camera binding");
  }
  supabaseAdmin.from = originalFrom;
}

// 5. Unknown canonical_ref -> safe not_found.
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveSpatialFacilityContext("estate-1", "NO-SUCH-REF", FULL_ACTOR);
  need(result.status === "not_found", `expected not_found, got ${result.status}`);
  supabaseAdmin.from = originalFrom;
}

// 6. Cross-estate canonical_ref -> safe not_found (never leaks existence).
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveSpatialFacilityContext("estate-1", "OTHER-ESTATE-HOME", FULL_ACTOR);
  need(result.status === "not_found", `a ref belonging to a different estate must resolve as not_found, got ${result.status}`);
  supabaseAdmin.from = originalFrom;
}

// 7. Ambiguous canonical_ref -> safe failure, no winner silently picked.
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveSpatialFacilityContext("estate-1", "DUP-REF", FULL_ACTOR);
  need(result.status === "ambiguous", `expected ambiguous, got ${result.status}`);
  supabaseAdmin.from = originalFrom;
}

// 8. twin.view missing -> denied at the route layer. Structural check
// against the compiled route source: the spatial-context route must be
// gated by requirePermission("twin.view") before the controller runs.
{
  const fs = await import("node:fs");
  const routeSource = fs.readFileSync(new URL("../dist/routes/facility.routes.js", import.meta.url), "utf8");
  const lineMatch = routeSource.split("\n").find((line) => line.includes("spatial-context"));
  need(!!lineMatch, "the spatial-context route must exist in the compiled routes");
  need(!!lineMatch && /requirePermission/.test(lineMatch) && /["']twin\.view["']/.test(lineMatch), "the spatial-context route must be gated by requirePermission(\"twin.view\") on the same route registration line");
}

// 9. Underlying domain permission missing -> restricted data is not
// leaked. An actor with twin.view + homes.read but none of
// support.read/devices.read/cameras.view must see every related domain
// marked not-permitted, with no items array at all (not an empty one that
// could be confused with "genuinely zero records").
{
  supabaseAdmin.from = fakeFrom();
  // role "guest" carries no Facility-domain permissions by default
  // (ROLE_PERMISSIONS.guest = ["visitors.create"] only), so granting
  // twin.view + homes.read via explicit permission_scopes produces a
  // genuinely restricted actor -- unlike role "estate_admin", whose own
  // role-default permission set already includes every domain permission
  // this test needs to prove is withheld.
  const restrictedActor = { id: "actor-2", role: "guest", estate_id: "estate-1", permission_scopes: ["twin.view", "homes.read"] };
  const result = await resolveSpatialFacilityContext("estate-1", "LUNA-L06-APT-A", restrictedActor);
  need(result.status === "resolved", `expected resolved (actor can still view the home itself), got ${result.status}`);
  if (result.status === "resolved") {
    const records = result.context.related_operational_records;
    for (const domain of ["maintenance", "incidents", "devices"]) {
      need(records[domain].permitted === false, `${domain} must be marked not-permitted for an actor lacking its gating permission`);
      need(!("items" in records[domain]), `${domain} must not carry an items array when not permitted -- absence must never be confused with zero real records`);
    }
  }
  // And an actor missing devices.read entirely must be denied the device
  // context itself, not shown a stripped/redacted device object.
  const noDeviceActor = { id: "actor-3", role: "guest", estate_id: "estate-1", permission_scopes: ["twin.view", "homes.read"] };
  const deviceResult = await resolveSpatialFacilityContext("estate-1", "LUNA-L06-APT-A-BEDROOM1-AC", noDeviceActor);
  need(deviceResult.status === "permission_denied", `an actor without devices.read must be denied the device context entirely, got ${deviceResult.status}`);
  supabaseAdmin.from = originalFrom;
}

// 10. No mutation occurs -- structural guard against regressions: the
// compiled service must never call an insert/update/upsert/delete verb.
{
  const fs = await import("node:fs");
  const serviceSource = fs.readFileSync(new URL("../dist/services/spatialFacilityContextService.js", import.meta.url), "utf8");
  need(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(serviceSource), "spatialFacilityContextService must never call a mutating Supabase verb -- this slice is read-only");
}

// 14F: actual Twin/Home reader agrees with the authority for conflicting
// registry state, inference failure, unavailable acquisition and expired evidence.
{
  const { cameraCurrentState, CAMERA_CURRENT_STATE_SELECT } = await import('../dist/modules/cameras/cameraCurrentStateAuthority.js');
  const now = Date.now(), iso = age => new Date(now-age).toISOString();
  const edge = {edge_node_id:'edge-a',estate_id:'estate-1',heartbeat_observed_at:iso(1000),heartbeat_received_at:iso(900),heartbeat_observation:{version:1,source:'edge_heartbeat',status:'online',queue_depth:0,sync_status:'synced',error_count:0,expected_interval_ms:30000}};
  for (const [result, age, inference] of [['acquired',1000,null],['acquired',1000,'failed'],['failed',1000,null],['acquired',300000,null],[null,0,null]]) {
    const camera = {...CAMERAS[0],edge_node_id:'edge-a',nvr_id:null,channel:null,runtime_observations:{version:1,dimensions:{}},status:'offline',health_status:'offline'};
    const observe = (kind,source,value) => ({schema_version:1,observation_id:'00000000-0000-4000-8000-000000000001',camera_id:camera.id,edge_node_id:'edge-a',kind,source,result:value,observed_at:iso(age),received_at:iso(age),details:kind==='frame'&&value==='acquired'?{mime_type:'image/jpeg',size_bytes:4,validation:'bounded_image_signature'}:{detection_count:0}});
    if(result)camera.runtime_observations.dimensions['frame:ai_snapshot']={latest:observe('frame','ai_snapshot',result)};
    if(inference)camera.runtime_observations.dimensions['inference:external_detector']={latest:observe('inference','external_detector',inference)};
    const canonical=Object.fromEntries(CAMERA_CURRENT_STATE_SELECT.split(',').map(k=>[k,camera[k]??null]));
    supabaseAdmin.from=fakeFrom({facility_cameras:[camera],edge_nodes:[edge]});
    const view=await resolveSpatialFacilityContext('estate-1','LUNA-L06-APT-A',FULL_ACTOR);
    const current=view.context.related_operational_records.cameras.items[0].current_state;
    need(current.overall===cameraCurrentState(canonical,FULL_ACTOR,edge,{now}).overall,'Twin must use canonical interpretation, never registry offline');
    need(current.frame.freshness===cameraCurrentState(canonical,FULL_ACTOR,edge,{now}).frame.freshness,'Twin component freshness must agree');
  }
  supabaseAdmin.from=originalFrom;
}

if (failures.length) {
  console.error(`FAIL facility-spatial-context-smoke (${failures.length} failure(s)):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("PASS facility-spatial-context-smoke");
