#!/usr/bin/env node
// Wave 6 Slice 1 -- Privacy Boundary Closure adversarial/functional smoke.
//
// Exercises the two proven Slice 0 defects directly against the compiled
// dist/ output (CJS require, not ESM import -- module.exports objects are
// mutable via require() and can be monkey-patched for test fixtures; an
// ESM import()'s namespace object cannot). No live database is used --
// supabaseAdmin.from() is replaced with an in-memory fixture responder
// scoped to exactly the tables each code path under test reads.
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
async function checkThrows(label, fn, statusCode) {
  try {
    await fn();
    fail += 1;
    failures.push(label);
    console.log(`FAIL ${label} :: expected throw, none occurred`);
  } catch (err) {
    const ok = statusCode === undefined || err?.statusCode === statusCode;
    if (ok) {
      pass += 1;
      console.log(`PASS ${label}`);
    } else {
      fail += 1;
      failures.push(label);
      console.log(`FAIL ${label} :: wrong statusCode ${err?.statusCode}, message=${err?.message}`);
    }
  }
}

// ---------------------------------------------------------------------
// Supabase fixture mock -- supports the exact chain shapes used by the
// code under test: .select().eq()... / .select().in()... terminated by
// either an implicit await (thenable builder) or an explicit
// .maybeSingle()/.single().
// ---------------------------------------------------------------------
function makeSupabaseMock(handlers) {
  return {
    from(table) {
      const state = { table, filters: {}, ins: {} };
      function resolve() {
        const handler = handlers[table];
        if (!handler) return Promise.resolve({ data: null, error: { message: `no fixture handler for table "${table}"` } });
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

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------
const ESTATE_X = "estate-x-11111111";
const ESTATE_Y = "estate-y-22222222";
const HOME_A = "home-a-aaaaaaaaaa"; // Resident A's own home
const HOME_B = "home-b-bbbbbbbbbb"; // a different resident's home, same estate
const HOME_Y = "home-y-yyyyyyyyyy"; // a home in a different estate entirely

const residentA = { id: "resident-a", role: "resident", estate_id: ESTATE_X, home_id: HOME_A, permissions: [] };
const facilityManager = { id: "fac-mgr", role: "facility_manager", estate_id: ESTATE_X, home_id: null, permissions: [] };
const facilityManagerLivingInHomeA = { id: "fac-mgr-resident", role: "facility_manager", estate_id: ESTATE_X, home_id: HOME_A, permissions: [] };

const HOME_ROWS = {
  [HOME_A]: { id: HOME_A, name: "Home A", block: "A", unit: "01", estate_id: ESTATE_X, electricity_meter: "EM-A", water_meter: "WM-A", internet_id: "NET-A", gate_code: "1111" },
  [HOME_B]: { id: HOME_B, name: "Home B", block: "B", unit: "02", estate_id: ESTATE_X, electricity_meter: "EM-B", water_meter: "WM-B", internet_id: "NET-B", gate_code: "2222" },
  [HOME_Y]: { id: HOME_Y, name: "Home Y", block: "Y", unit: "09", estate_id: ESTATE_Y, electricity_meter: "EM-Y", water_meter: "WM-Y", internet_id: "NET-Y", gate_code: "9999" },
};

function estateMembershipsFor(userId) {
  if (userId === "resident-a") return [{ estate_id: ESTATE_X, role: "resident" }];
  if (userId === "fac-mgr") return [{ estate_id: ESTATE_X, role: "facility_manager" }];
  if (userId === "fac-mgr-resident") return [{ estate_id: ESTATE_X, role: "facility_manager" }];
  return [];
}
function homeMembershipsFor(userId) {
  if (userId === "resident-a") return [{ id: "mem-a", home_id: HOME_A }];
  if (userId === "fac-mgr-resident") return [{ id: "mem-fac-a", home_id: HOME_A }];
  return [];
}

const contextHandlers = {
  estate_memberships: (state) => ({ data: estateMembershipsFor(state.filters.user_id), error: null }),
  home_memberships: (state) => ({ data: homeMembershipsFor(state.filters.user_id), error: null }),
  estates: (state) => {
    const ids = state.ins.id || (state.filters.id ? [state.filters.id] : []);
    const rows = ids.filter((id) => id === ESTATE_X || id === ESTATE_Y).map((id) => ({ id, name: id === ESTATE_X ? "Estate X" : "Estate Y" }));
    if (state.filters.id) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  },
  homes: (state) => {
    if (state.ins.id) {
      return { data: state.ins.id.map((id) => HOME_ROWS[id]).filter(Boolean), error: null };
    }
    if (state.filters.id) {
      return { data: HOME_ROWS[state.filters.id] || null, error: null };
    }
    return { data: null, error: null };
  },
};

const CAM_PRIVATE = { id: "cam-private-0001", estate_id: ESTATE_X, home_id: HOME_A, privacy_scope: "home", metadata: {} };
const CAM_COMMON = { id: "cam-common-0002", estate_id: ESTATE_X, home_id: null, privacy_scope: "facility", metadata: {} };

const cameraHandlers = {
  facility_cameras: (state) => {
    const ids = state.ins.id || [];
    return { data: [CAM_PRIVATE, CAM_COMMON].filter((c) => ids.includes(c.id)), error: null };
  },
};

async function main() {
  // Rebuild everything fresh each require so mocks below don't leak across
  // Part A / Part B (each part patches a different supabaseClient export).
  const supabaseClientMod = require(path.join(backendRoot, "dist/supabase/supabaseClient.js"));

  // =====================================================================
  // PART A -- Camera awareness projection leak
  // =====================================================================
  console.log("\n=== PART A: Camera awareness projection leak ===");
  const { canAccessCamera, cameraAccessActor } = require(path.join(backendRoot, "dist/modules/cameras/cameraAccess.policy.js"));

  // 1. Direct camera access denied to ordinary Facility actor for a
  // resident-home-private camera.
  const directAccess = canAccessCamera(CAM_PRIVATE, cameraAccessActor(facilityManager, null));
  check("1. private-home camera direct access denied to ordinary Facility actor", directAccess.ok === false, JSON.stringify(directAccess));

  supabaseClientMod.supabaseAdmin.from = makeSupabaseMock(cameraHandlers).from;
  const permissionEngineMod = require(path.join(backendRoot, "dist/intelligence-core/permissionEngine.js"));

  const leakEvent = {
    id: "evt-camera-leak-1",
    category: "camera",
    camera_id: CAM_PRIVATE.id,
    agent_id: "camera",
    title: "Activity detected on Bedroom Camera",
    summary: "Person detected in Bedroom Camera at 22:14, confidence 0.91.",
    metadata: { camera_id: CAM_PRIVATE.id, core_event: { title: "Activity detected on Bedroom Camera" } },
  };
  const commonEvent = {
    id: "evt-camera-common-1",
    category: "camera",
    camera_id: CAM_COMMON.id,
    agent_id: "camera",
    title: "Activity detected on Lobby Camera",
    summary: "Person detected in Lobby Camera at 09:03.",
    metadata: { camera_id: CAM_COMMON.id },
  };

  const cameraLookup = await permissionEngineMod.loadCameraAccessLookup([leakEvent, commonEvent]);
  check("lookup resolves both fixture cameras", cameraLookup.size === 2, `size=${cameraLookup.size}`);

  const filteredForFacility = permissionEngineMod.filterEventsForActor([leakEvent, commonEvent], facilityManager, cameraLookup);
  const stillHasPrivate = filteredForFacility.some((e) => e.id === leakEvent.id);

  // 2. Same camera event not leaked through awareness.
  check("2. private-home camera event not leaked through awareness", !stillHasPrivate);
  // 3/4/5. Full omission means no field of the protected event survives --
  // title/summary/evidence cannot leak piecemeal because the object itself
  // is absent from the filtered result.
  check("3. title does not leak protected location (event omitted)", !filteredForFacility.some((e) => String(e.title || "").includes("Bedroom")));
  check("4. summary does not leak event detail (event omitted)", !filteredForFacility.some((e) => String(e.summary || "").includes("confidence 0.91")));
  check("5. evidence/metadata does not leak (event omitted)", !filteredForFacility.some((e) => e?.metadata?.camera_id === CAM_PRIVATE.id));

  // 6. Authorized common-area camera awareness remains visible.
  check("6. authorized common-area camera awareness remains visible", filteredForFacility.some((e) => e.id === commonEvent.id));

  // 7. Legitimately authorized home camera remains visible (facility actor
  // whose own home_id genuinely matches the camera's home).
  const filteredForFacilityResident = permissionEngineMod.filterEventsForActor([leakEvent], facilityManagerLivingInHomeA, cameraLookup);
  check("7. legitimately authorized home camera remains visible", filteredForFacilityResident.some((e) => e.id === leakEvent.id));

  // Backward-compatibility: omitting cameraById preserves pre-Slice-1
  // role-only behavior at that specific call site (not a regression for
  // any caller not yet updated to pass the lookup).
  const filteredNoLookup = permissionEngineMod.filterEventsForActor([leakEvent], facilityManager);
  check("backward-compat: filterEventsForActor without cameraById keeps prior role-only behavior", filteredNoLookup.some((e) => e.id === leakEvent.id));

  // Shared primitive used directly by executive.ts.
  const executiveFiltered = permissionEngineMod.filterCameraProtectedEvents([leakEvent, commonEvent], facilityManager, cameraLookup);
  check("executive.ts primitive (filterCameraProtectedEvents) excludes protected camera event", !executiveFiltered.some((e) => e.id === leakEvent.id));
  check("executive.ts primitive keeps authorized common-area event", executiveFiltered.some((e) => e.id === commonEvent.id));

  // Residents were never affected (can_view_camera hardcoded false) --
  // confirm that remains true post-fix.
  const filteredForResident = permissionEngineMod.filterEventsForActor([leakEvent, commonEvent], residentA, cameraLookup);
  check("resident still sees zero camera events (unrelated pre-existing role gate, unaffected by this fix)", filteredForResident.length === 0);

  // =====================================================================
  // PART B -- Facility-surface home scope escalation
  // =====================================================================
  console.log("\n=== PART B: Facility-surface home scope escalation ===");
  supabaseClientMod.supabaseAdmin.from = makeSupabaseMock(contextHandlers).from;
  const contextResolutionMod = require(path.join(backendRoot, "dist/services/context/contextResolutionService.js"));

  // 8/9. Resident own-home Consumer context remains valid.
  const ownConsumer = await contextResolutionMod.resolveOisContext(residentA, { surface: "consumer" });
  check("8/9. resident own-home Consumer context remains valid", ownConsumer.home?.id === HOME_A);

  // 10. Resident requests Facility surface for OWN home -> resolves via
  // their real membership (unaffected by this fix), and does not promote
  // their role.
  const ownFacility = await contextResolutionMod.resolveOisContext(residentA, { surface: "facility", home_id: HOME_A });
  check("10. resident requesting facility surface for own home resolves, no role promotion", ownFacility.home?.id === HOME_A && ownFacility.role === "resident");

  // 11/12/13/14/16. Resident requests Facility surface for ANOTHER
  // resident's home in the SAME estate -- must be denied, and none of
  // Home B's private fields may be observable from the thrown result.
  let crossHomeError = null;
  try {
    await contextResolutionMod.resolveOisContext(residentA, { surface: "facility", home_id: HOME_B });
  } catch (err) {
    crossHomeError = err;
  }
  check("11. resident requesting facility surface for another home is denied", crossHomeError?.statusCode === 403, crossHomeError ? `${crossHomeError.statusCode}: ${crossHomeError.message}` : "no error thrown -- LEAK NOT CLOSED");
  const errorText = JSON.stringify(crossHomeError && { message: crossHomeError.message });
  check("12. Home B meter data not present anywhere in the denial", !errorText.includes("EM-B") && !errorText.includes("WM-B"));
  check("13. Home B gate code not present anywhere in the denial", !errorText.includes("2222"));
  check("14. Home B unit/block identity not present anywhere in the denial", !errorText.includes("\"unit\":\"02\"") && !errorText.includes("Home B"));
  check("16. forged client home_id does not alter authoritative assignment (same denial as above)", crossHomeError?.statusCode === 403);

  // 15. Forged client surface does not alter authenticated role for the
  // actor's own home either.
  check("15. forged client surface does not alter authenticated role", ownFacility.role === residentA.role);

  // 17. Authorized Facility actor retains legitimate operational context
  // for a home they do not personally live in -- must NOT regress.
  const facilityCrossHome = await contextResolutionMod.resolveOisContext(facilityManager, { surface: "facility", home_id: HOME_B });
  check("17. authorized facility actor retains legitimate cross-home operational context", facilityCrossHome.home?.id === HOME_B && facilityCrossHome.home?.gate_code === "2222");

  // 18. Cross-estate access remains denied even for a legitimate facility
  // actor (estate membership check, unchanged, still enforced).
  let crossEstateError = null;
  try {
    await contextResolutionMod.resolveOisContext(facilityManager, { surface: "facility", home_id: HOME_Y });
  } catch (err) {
    crossEstateError = err;
  }
  check("18. cross-estate access remains denied", crossEstateError?.statusCode === 403);

  // 19. Missing/ambiguous scope (a home id that resolves to nothing)
  // fails safely rather than defaulting open.
  let missingHomeError = null;
  try {
    await contextResolutionMod.resolveOisContext(facilityManager, { surface: "facility", home_id: "00000000-0000-0000-0000-000000000000" });
  } catch (err) {
    missingHomeError = err;
  }
  check("19. missing/unresolvable home fails safely (denied, not defaulted open)", missingHomeError?.statusCode === 403);

  // 20. Downstream consumers cannot rehydrate Home B data: resolveOisContext
  // is the single choke point every downstream consumer (Oyi conversation,
  // commandRouter, awareness, recommendations) reads req.oisContext from
  // (contextResolver.ts's resolveRequestContext middleware sets
  // req.oisContext = await resolveOisContext(...) and 403s before calling
  // next() on any ContextResolutionError). Since the denied call above
  // throws instead of returning a context object at all, no oisContext
  // ever reaches a downstream handler for Home B -- there is no separate
  // object for a downstream consumer to read.
  check("20. denied request never produces an oisContext object for downstream consumers", crossHomeError instanceof contextResolutionMod.ContextResolutionError);

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
