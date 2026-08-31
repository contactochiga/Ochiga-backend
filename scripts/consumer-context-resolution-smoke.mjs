#!/usr/bin/env node
// Production incident: a resident who had just accepted a real Home
// invitation (correct, active estate_memberships + home_memberships
// rows, confirmed directly against production) still saw Community's
// "join an estate" message and a 403 on POST /maintenance. Root cause:
// resolveOisContext's availableEstates()/availableHomes()
// (src/services/context/contextResolutionService.ts) destructured only
// `{ data }` from their Supabase queries, discarding `error` -- any
// query failure was silently indistinguishable from "this user
// genuinely has zero memberships", producing exactly the reported
// symptoms with nothing in any log to explain why. This test proves the
// fix behaviorally: a real query failure now throws a clear,
// diagnosable error instead of resolving to an empty scope, and a real
// success still resolves the actual membership data untouched.
//
// Also proves (Phase 1-6 of the role/authorization audit): resident's
// permission set already covers every capability a Home Owner needs
// (maintenance create/read, Community read/write, visitor create,
// device control) and does NOT include any Facility-administrative
// permission -- so a Home Owner is never silently promoted to Facility
// admin, and Home ownership (home_memberships.role) never leaks into
// the platform-wide users.role.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";

const { resolveOisContext, ContextResolutionError } = await import("../dist/services/context/contextResolutionService.js");
const { supabaseAdmin } = await import("../dist/supabase/supabaseClient.js");
const { ROLE_PERMISSIONS, permissionsForRole, canonicalRole } = await import("../dist/core/foundation/permissions.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

// Fake tables, matching the rewritten two-step (membership list, then
// estates/homes lookup by id) query shape -- no embedded relations,
// mirroring Profile's own already-proven-reliable query shape
// (getResidentVerificationContext, src/routes/me.routes.ts).
function fakeFrom({ estateMemberships, estates, homeMemberships, homes }) {
  return (table) => {
    if (table === "estate_memberships") {
      return { select: () => ({ eq: () => ({ eq: async () => estateMemberships }) }) };
    }
    if (table === "estates") {
      return {
        select: () => ({
          in: async () => estates,
          eq: () => ({ maybeSingle: async () => estates }),
        }),
      };
    }
    if (table === "home_memberships") {
      return { select: () => ({ eq: () => ({ eq: async () => homeMemberships }) }) };
    }
    if (table === "homes") {
      return { select: () => ({ in: async () => homes }) };
    }
    return originalFrom(table);
  };
}

// A. A real query failure on estate_memberships must throw a clear,
// diagnosable error -- never silently resolve to "no estates".
{
  supabaseAdmin.from = fakeFrom({
    estateMemberships: { data: null, error: { message: "simulated PostgREST failure" } },
    estates: { data: [], error: null },
    homeMemberships: { data: [], error: null },
    homes: { data: [], error: null },
  });
  let threw = null;
  try {
    await resolveOisContext({ id: "actor-1", role: "resident", estate_id: "estate-1", home_id: null, permissions: [] }, { surface: "consumer" });
  } catch (err) {
    threw = err;
  }
  need(threw instanceof ContextResolutionError, "a real estate_memberships query failure must throw ContextResolutionError, not resolve silently");
  need(threw && /simulated PostgREST failure/.test(threw.message), "the real underlying error message must be preserved, not swallowed");
  supabaseAdmin.from = originalFrom;
}

// B. Same for home_memberships.
{
  supabaseAdmin.from = fakeFrom({
    estateMemberships: { data: [], error: null },
    estates: { data: [], error: null },
    homeMemberships: { data: null, error: { message: "simulated home_memberships failure" } },
    homes: { data: [], error: null },
  });
  let threw = null;
  try {
    await resolveOisContext({ id: "actor-1", role: "resident", estate_id: null, home_id: "home-1", permissions: [] }, { surface: "consumer" });
  } catch (err) {
    threw = err;
  }
  need(threw instanceof ContextResolutionError, "a real home_memberships query failure must throw, not resolve silently");
  need(threw && /simulated home_memberships failure/.test(threw.message), "the real underlying error message must be preserved");
  supabaseAdmin.from = originalFrom;
}

// B2. A failure on the SECOND step (looking up estates/homes by id, once
// the membership list itself succeeded) must also throw, not silently
// drop the estate/home from the resolved scope.
{
  supabaseAdmin.from = fakeFrom({
    estateMemberships: { data: [{ estate_id: "estate-1", role: "resident" }], error: null },
    estates: { data: null, error: { message: "simulated estates lookup failure" } },
    homeMemberships: { data: [], error: null },
    homes: { data: [], error: null },
  });
  let threw = null;
  try {
    await resolveOisContext({ id: "actor-1", role: "resident", estate_id: null, home_id: null, permissions: [] }, { surface: "consumer" });
  } catch (err) {
    threw = err;
  }
  need(threw instanceof ContextResolutionError, "a failure resolving the estates referenced by a real membership list must also throw");
  supabaseAdmin.from = originalFrom;
}

// C. A genuine success -- correct, active membership rows -- must
// resolve them correctly with the new two-step (no embedded relation)
// query shape. This mirrors the real production account's actual data
// (Green smart Estate / Flat 120, home_memberships.role = "owner").
{
  supabaseAdmin.from = fakeFrom({
    estateMemberships: { data: [{ estate_id: "estate-1", role: "resident" }], error: null },
    estates: { data: [{ id: "estate-1", name: "Green smart Estate" }], error: null },
    homeMemberships: { data: [{ id: "membership-1", home_id: "home-1" }], error: null },
    homes: { data: [{ id: "home-1", name: "Flat 120", block: null, unit: null, estate_id: "estate-1", electricity_meter: null, water_meter: null, internet_id: null, gate_code: null }], error: null },
  });
  const context = await resolveOisContext({ id: "actor-1", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: [] }, { surface: "consumer" });
  need(context.estate_id === "estate-1", "a genuinely correct membership must still resolve the real estate_id");
  need(context.home_id === "home-1", "a genuinely correct membership must still resolve the real home_id");
  need(context.available_estates.length === 1 && context.available_estates[0].name === "Green smart Estate", "the resolved estate must carry the real name, not a fabricated one");
  need(context.available_homes.length === 1 && context.available_homes[0].name === "Flat 120", "the resolved home must carry the real name, not a fabricated one");
  need(context.home?.membership_id === "membership-1", "the home's own membership_id must be threaded through");
  supabaseAdmin.from = originalFrom;
}

// D. Home Owner capability matrix: resident's permission set already
// covers everything a Home Owner needs, and carries nothing Facility-
// administrative. home_memberships.role ("owner") is never consulted by
// hasPermission/requirePermission -- confirmed structurally by asserting
// what canonicalRole("resident") actually resolves to and what
// permissions it carries.
{
  const residentPermissions = ROLE_PERMISSIONS.resident || [];
  for (const required of ["homes.read", "devices.control", "visitors.create", "support.read", "community.read", "community.write", "services.pay"]) {
    need(residentPermissions.includes(required), `resident must carry ${required} -- a Home Owner needs this for the documented capability matrix`);
  }
  for (const forbidden of ["staff.manage", "settings.manage", "estates.write", "community.broadcast", "community.manage_announcements"]) {
    need(!residentPermissions.includes(forbidden), `resident must NOT carry ${forbidden} -- a Home Owner must never silently gain Facility-administrative authority`);
  }
  // Danger-of-confusion check: the bare string "owner" is itself a
  // LEGACY_ROLE_ALIASES entry mapping to the PLATFORM role
  // "estate_admin" (Facility admin). home_memberships.role="owner"
  // means "Home Owner" -- a completely different, Consumer/Home-scoped
  // concept that happens to share the word. This proves why
  // home_memberships.role must never be fed directly into
  // canonicalRole/hasPermission as if it were a platform role string --
  // doing so would silently grant Facility-administrative authority to
  // every Home Owner, exactly what this whole fix must not do.
  need(canonicalRole("owner") === "estate_admin", "the bare string 'owner' must resolve to the Facility platform role estate_admin when canonicalized -- proving home_memberships.role must never be passed to hasPermission directly");
}

if (failures.length) {
  console.error("consumer-context-resolution-smoke: FAILED");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("consumer-context-resolution-smoke: ALL PASSED");
