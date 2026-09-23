#!/usr/bin/env node
// Wave 6 Slice 1B -- Surface Authority Closure adversarial/functional smoke.
// Exercises the canonical evidence loaders (visitors/security/utilities/
// maintenance/scenes) and src/ai/commandRouter.ts's moduleScope directly
// against the compiled dist/ output, proving a requested surface alone can
// never widen read scope beyond what the actor's real, server-derived role
// permits. No live database is used -- supabaseAdmin.from() is replaced
// with an in-memory fixture responder.
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
    console.log(`FAIL ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

function makeSupabaseMock(handlers) {
  return {
    from(table) {
      const state = { table, filters: {}, ins: {} };
      function resolve() {
        const handler = handlers[table];
        if (!handler) return Promise.resolve({ data: [], error: null });
        return Promise.resolve(handler(state));
      }
      const b = {
        select() { return b; },
        eq(col, val) { state.filters[col] = val; return b; },
        in(col, vals) { state.ins[col] = vals; return b; },
        order() { return b; },
        limit() { return b; },
        maybeSingle() { return resolve(); },
        single() { return resolve(); },
        then(onFulfilled, onRejected) { return resolve().then(onFulfilled, onRejected); },
      };
      return b;
    },
  };
}

const ESTATE_X = "estate-x-11111111";
const ESTATE_Y = "estate-y-22222222";
const HOME_A = "home-a-aaaaaaaaaa";
const HOME_B = "home-b-bbbbbbbbbb";

const residentA = { id: "resident-a", role: "resident", estate_id: ESTATE_X, home_id: HOME_A, permissions: [] };
const facilityManager = { id: "fac-mgr", role: "facility_manager", estate_id: ESTATE_X, home_id: null, permissions: [] };
const securityOperator = { id: "sec-op", role: "security_operator", estate_id: ESTATE_X, home_id: null, permissions: [] };

function oisContextFor(actor, overrides = {}) {
  return { actor_id: actor.id, role: actor.role, permissions: actor.permissions, estate_id: actor.estate_id, home_id: actor.home_id, surface: "consumer", ...overrides };
}

const CONTRACT = { conversation_request_id: "req-1", thread_id: null, surface: "consumer", operation_class: "read", intent: "unknown", scope_mode: "narrow", temporal_scope: { mode: "current", from: null, to: null }, target: { object_type: null, canonical_id: null, parent_id: null, channel_code: null, label: null }, mutation: {} };

async function main() {
  const supabaseClientMod = require(path.join(backendRoot, "dist/supabase/supabaseClient.js"));

  // =====================================================================
  // Domain fixtures: one row in HOME_A (resident A's own), one in HOME_B
  // (a different resident's home, same estate).
  // =====================================================================
  const visitorRows = [
    { id: "va-a", estate_id: ESTATE_X, home_id: HOME_A, visitor_name: "Own Visitor", purpose: "delivery", access_code: "1111", status: "pending", expires_at: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: "va-b", estate_id: ESTATE_X, home_id: HOME_B, visitor_name: "Neighbour Visitor", purpose: "private matter", access_code: "2222", status: "pending", expires_at: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
  ];
  const incidentRows = [
    { id: "inc-a", estate_id: ESTATE_X, home_id: HOME_A, room_id: null, title: "Own incident", incident_type: "alarm", severity: "low", status: "open", location: {}, opened_at: "2026-01-01", acknowledged_at: null, resolved_at: null, closed_at: null, updated_at: "2026-01-01" },
    { id: "inc-b", estate_id: ESTATE_X, home_id: HOME_B, room_id: null, title: "Neighbour incident", incident_type: "alarm", severity: "low", status: "open", location: {}, opened_at: "2026-01-01", acknowledged_at: null, resolved_at: null, closed_at: null, updated_at: "2026-01-01" },
  ];
  const assignmentRows = [
    { estate_id: ESTATE_X, home_id: HOME_A, service_key: "electricity_service", enabled: true, scope: {}, updated_at: "2026-01-01" },
    { estate_id: ESTATE_X, home_id: HOME_B, service_key: "electricity_service", enabled: true, scope: {}, updated_at: "2026-01-01" },
  ];
  const accountRows = [
    { id: "acct-a", estate_id: ESTATE_X, home_id: HOME_A, service_key: "electricity_service", provider: "p", status: "active", linked: true, due_date: null, expires_at: null, updated_at: "2026-01-01" },
    { id: "acct-b", estate_id: ESTATE_X, home_id: HOME_B, service_key: "electricity_service", provider: "p", status: "active", linked: true, due_date: null, expires_at: null, updated_at: "2026-01-01" },
  ];
  const maintenanceRows = [
    { id: "mr-a", estate_id: ESTATE_X, home_id: HOME_A, room_id: null, user_id: "resident-a", title: "Own leak", description: "leak", status: "open", assigned_to: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: "mr-b", estate_id: ESTATE_X, home_id: HOME_B, room_id: null, user_id: "resident-b", title: "Neighbour leak", description: "leak", status: "open", assigned_to: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
  ];
  const sceneRows = [
    { id: "sc-a", estate_id: ESTATE_X, home_id: HOME_A, name: "Own Morning", actions: [], enabled: true, updated_at: "2026-01-01" },
    { id: "sc-b", estate_id: ESTATE_X, home_id: HOME_B, name: "Neighbour Morning", actions: [], enabled: true, updated_at: "2026-01-01" },
  ];

  function filterRows(rows, state) {
    return rows.filter((row) => Object.entries(state.filters).every(([col, val]) => String(row[col] ?? "") === String(val)));
  }

  const handlers = {
    visitor_access: (state) => ({ data: filterRows(visitorRows, state), error: null }),
    facility_incidents: (state) => ({ data: filterRows(incidentRows, state), error: null }),
    home_service_assignments: (state) => ({ data: filterRows(assignmentRows, state), error: null }),
    home_service_accounts: (state) => ({ data: filterRows(accountRows, state), error: null }),
    maintenance_requests: (state) => ({ data: filterRows(maintenanceRows, state), error: null }),
    consumer_scenes: (state) => ({ data: filterRows(sceneRows, state), error: null }),
  };
  supabaseClientMod.supabaseAdmin.from = makeSupabaseMock(handlers).from;

  const { loadVisitorAccessFacts } = require(path.join(backendRoot, "dist/oyi-core/domains/visitors/visitorEvidence.js"));
  const { loadSecurityIncidentFacts } = require(path.join(backendRoot, "dist/oyi-core/domains/security/securityEvidence.js"));
  const { loadServiceAccountFacts } = require(path.join(backendRoot, "dist/oyi-core/domains/utilities/utilityEvidence.js"));
  const { loadMaintenanceRequestFacts } = require(path.join(backendRoot, "dist/oyi-core/domains/maintenance/maintenanceEvidence.js"));
  const { loadSceneFacts } = require(path.join(backendRoot, "dist/oyi-core/domains/automations/sceneAutomationEvidence.js"));

  function factIds(facts) {
    return new Set((facts || []).map((f) => String(f.fact_id || f.value?.id || f.evidence?.[0]?.id || "")));
  }

  async function runDomainMatrix(label, loader, { ownId, otherId, callArgs = [] }) {
    // 1. own-home, consumer surface: allowed.
    const own = await loader({ surface: "consumer", estate_id: ESTATE_X, home_id: HOME_A }, oisContextFor(residentA), CONTRACT, ...callArgs);
    const ownIds = factIds(own);
    check(`${label}: resident own-home evidence allowed`, [...ownIds].some((id) => id.includes(ownId)) || own.length > 0 && !own.some((f) => JSON.stringify(f).includes(otherId)));

    // 2/3. other-home requested directly (forged home_id) is denied,
    // regardless of surface -- oisContext (own home) wins over input.
    const forgedHome = await loader({ surface: "consumer", estate_id: ESTATE_X, home_id: HOME_B }, oisContextFor(residentA), CONTRACT, ...callArgs);
    check(`${label}: forged home_id does not leak other-home evidence`, !JSON.stringify(forgedHome).includes(otherId));

    const forgedSurface = await loader({ surface: "facility", estate_id: ESTATE_X, home_id: HOME_B }, oisContextFor(residentA), CONTRACT, ...callArgs);
    check(`${label}: facility surface + forged home_id does not widen or leak other-home evidence`, !JSON.stringify(forgedSurface).includes(otherId));

    const facilitySurfaceOwnHome = await loader({ surface: "facility", estate_id: ESTATE_X, home_id: HOME_A }, oisContextFor(residentA, { surface: "facility" }), CONTRACT, ...callArgs);
    check(`${label}: resident requesting facility surface never gains estate-wide evidence`, !JSON.stringify(facilitySurfaceOwnHome).includes(otherId));

    // Authorized facility actor retains legitimate estate-wide scope.
    const facilityWide = await loader({ surface: "facility", estate_id: ESTATE_X, home_id: null }, oisContextFor(facilityManager, { surface: "facility" }), CONTRACT, ...callArgs);
    check(`${label}: authorized facility actor retains legitimate estate-wide evidence`, JSON.stringify(facilityWide).includes(otherId) && JSON.stringify(facilityWide).includes(ownId));

    // Unknown/missing surface cannot widen scope for a resident.
    const unknownSurface = await loader({ surface: "some_unknown_surface", estate_id: ESTATE_X, home_id: HOME_A }, oisContextFor(residentA, { surface: "some_unknown_surface" }), CONTRACT, ...callArgs);
    check(`${label}: unknown surface does not widen resident scope`, !JSON.stringify(unknownSurface).includes(otherId));

    const missingSurface = await loader({ estate_id: ESTATE_X, home_id: HOME_A }, oisContextFor(residentA, { surface: undefined }), CONTRACT, ...callArgs);
    check(`${label}: missing surface does not widen resident scope`, !JSON.stringify(missingSurface).includes(otherId));

    // Cross-estate: facility actor from a different estate gets nothing.
    const crossEstateActor = { ...facilityManager, id: "fac-mgr-y", estate_id: ESTATE_Y };
    const crossEstate = await loader({ surface: "facility", estate_id: ESTATE_Y, home_id: null }, oisContextFor(crossEstateActor, { surface: "facility", estate_id: ESTATE_Y }), CONTRACT, ...callArgs);
    check(`${label}: cross-estate facility actor gets zero rows from Estate X`, !JSON.stringify(crossEstate).includes(ownId) && !JSON.stringify(crossEstate).includes(otherId));
  }

  console.log("\n=== 1-3: Visitor evidence ===");
  await runDomainMatrix("visitor", loadVisitorAccessFacts, { ownId: "va-a", otherId: "va-b" });

  console.log("\n=== 13-15: Security evidence ===");
  await runDomainMatrix("security", loadSecurityIncidentFacts, { ownId: "inc-a", otherId: "inc-b" });
  // Authorized security actor retains legitimate permitted security scope.
  const secWide = await loadSecurityIncidentFacts({ surface: "facility", estate_id: ESTATE_X, home_id: null }, oisContextFor(securityOperator, { surface: "facility" }), CONTRACT);
  check("22. authorized security actor retains legitimate estate-wide security scope", JSON.stringify(secWide).includes("inc-a") && JSON.stringify(secWide).includes("inc-b"));

  console.log("\n=== 7-9: Utility evidence ===");
  // loadServiceAccountFacts derives fact_id/source_id from `${home_id}:${service_key}`,
  // not the raw account row id -- use the home ids as the presence/absence markers.
  await runDomainMatrix("utility", loadServiceAccountFacts, { ownId: HOME_A, otherId: HOME_B });

  console.log("\n=== 4-6: Maintenance evidence ===");
  await runDomainMatrix("maintenance", loadMaintenanceRequestFacts, { ownId: "mr-a", otherId: "mr-b" });

  console.log("\n=== 10-12: Scene evidence ===");
  await runDomainMatrix("scene", loadSceneFacts, { ownId: "sc-a", otherId: "sc-b" });

  // =====================================================================
  // 25/26/27: forged __oyi_surface / forged home_id / role from
  // authoritative identity -- via commandRouter.ts's moduleScopeForTest.
  // =====================================================================
  console.log("\n=== commandRouter.ts moduleScope ===");
  const { moduleScopeForTest } = require(path.join(backendRoot, "dist/ai/commandRouter.js"));
  const residentForgedFacility = moduleScopeForTest(residentA, { __oyi_surface: "facility", home_id: HOME_B, role: "facility_manager" });
  check("25/27. forged __oyi_surface + forged role in args does not grant facility scope (role sourced from authenticated actor only)", residentForgedFacility.facility === false && residentForgedFacility.homeId === HOME_A);
  check("26. forged home_id in args does not override authenticated actor's real home", residentForgedFacility.homeId === HOME_A);
  const facilityManagerRealFacility = moduleScopeForTest(facilityManager, { __oyi_surface: "facility" });
  check("21 (commandRouter). authorized facility actor's moduleScope still resolves facility=true", facilityManagerRealFacility.facility === true && facilityManagerRealFacility.homeId === null);
  const watchNeverWidens = moduleScopeForTest(residentA, { __oyi_surface: "watch" });
  check("18. Watch surface never sets facility scope via moduleScope", watchNeverWidens.facility === false && watchNeverWidens.homeId === HOME_A);
  const twinNeverWidens = moduleScopeForTest(residentA, { __oyi_surface: "twin" });
  check("19. Twin surface never sets facility scope via moduleScope", twinNeverWidens.facility === false && twinNeverWidens.homeId === HOME_A);

  // =====================================================================
  // commandRouter.ts cameras module -- per-camera privacy check.
  // =====================================================================
  console.log("\n=== commandRouter.ts cameras module (summarizeModuleTool) ===");
  const CAM_PRIVATE = { id: "cam-private-01", estate_id: ESTATE_X, home_id: HOME_B, privacy_scope: "home", metadata: {}, name: "Neighbour Bedroom Camera" };
  const CAM_COMMON = { id: "cam-common-01", estate_id: ESTATE_X, home_id: null, privacy_scope: "facility", metadata: {}, name: "Lobby Camera" };
  const cameraHandlers = {
    ...handlers,
    facility_cameras: (state) => ({ data: filterRows([CAM_PRIVATE, CAM_COMMON], state), error: null }),
    camera_events: (state) => ({ data: [], error: null }),
    camera_detections: (state) => ({ data: [], error: null }),
  };
  supabaseClientMod.supabaseAdmin.from = makeSupabaseMock(cameraHandlers).from;
  const { summarizeModuleToolForTest } = require(path.join(backendRoot, "dist/ai/commandRouter.js"));
  const cameraResultResident = await summarizeModuleToolForTest(residentA, "show cameras", { module: "cameras" });
  const residentCameraIds = (cameraResultResident.data?.conversation_entities || []).map((e) => e.id);
  check("16/17. resident cannot see another resident's home-private camera via commandRouter cameras module", !residentCameraIds.includes(CAM_PRIVATE.id));
  // canAccessCamera's pre-existing, unmodified facility-scope branch has no
  // resident bypass (only admin/system_admin), so a resident correctly sees
  // zero cameras at all here -- this is the same, already-verified
  // Slice 1 behavior, not a regression introduced by this fix.
  check("16/17. resident sees zero cameras (pre-existing, unmodified camera policy)", residentCameraIds.length === 0);
  const cameraResultFacility = await summarizeModuleToolForTest(facilityManager, "show cameras", { module: "cameras" });
  const facilityCameraIds = (cameraResultFacility.data?.conversation_entities || []).map((e) => e.id);
  check("16/17. authorized facility actor sees the common-area camera via commandRouter cameras module", facilityCameraIds.includes(CAM_COMMON.id));
  check("16/17. authorized facility actor does NOT see the other resident's home-private camera (no home_id match)", !facilityCameraIds.includes(CAM_PRIVATE.id));

  // =====================================================================
  // Post-fix-search finding: commandRouter.ts's summarize_devices tool
  // used the same-class __oyi_estate_wide/__oyi_surface flag (via
  // deviceRuntimeScope) with no role check, letting a resident list every
  // device in the estate. Fixed via readOnlyDeviceScope.
  // =====================================================================
  console.log("\n=== commandRouter.ts readOnlyDeviceScope ===");
  const { readOnlyDeviceScopeForTest } = require(path.join(backendRoot, "dist/ai/commandRouter.js"));
  const residentForgedEstateWide = readOnlyDeviceScopeForTest(residentA, { __oyi_estate_wide: true });
  check("28 (post-fix search). forged __oyi_estate_wide does not grant a resident estate-wide device visibility", residentForgedEstateWide.estateWide === false && residentForgedEstateWide.homeId === HOME_A);
  const residentForgedSurface = readOnlyDeviceScopeForTest(residentA, { __oyi_surface: "facility" });
  check("28 (post-fix search). forged __oyi_surface:facility does not grant a resident estate-wide device visibility", residentForgedSurface.estateWide === false && residentForgedSurface.homeId === HOME_A);
  const facilityRealEstateWide = readOnlyDeviceScopeForTest(facilityManager, { __oyi_estate_wide: true });
  check("28 (post-fix search). authorized facility actor still gets estate-wide device visibility", facilityRealEstateWide.estateWide === true && facilityRealEstateWide.homeId === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("Failed checks:", failures.join(", "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE SCRIPT CRASHED:", err);
  process.exit(1);
});
