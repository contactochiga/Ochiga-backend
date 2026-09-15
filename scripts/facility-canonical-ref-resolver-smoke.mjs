#!/usr/bin/env node
// Facility Spatial Mode Convergence, Foundation Slice 2 -- canonical
// reference resolver. Real behavioral coverage against the compiled
// resolveCanonicalRef() with a controllable fake Supabase client standing
// in for homes/rooms/devices -- same monkeypatch-supabaseAdmin.from
// pattern already proven by consumer-context-resolution-smoke.mjs and
// facility-delete-eligibility-smoke.mjs. No live database required.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";

const { resolveCanonicalRef } = await import("../dist/services/canonicalReferenceResolver.js");
const { supabaseAdmin } = await import("../dist/supabase/supabaseClient.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

// Generic in-memory table: supports the exact chain shapes
// resolveCanonicalRef actually issues --
//   .select(cols).eq(col, val).eq(col2, val2).limit(n)
//   .select(cols).eq(col, val).maybeSingle()
function makeTable(rows, errorOverride) {
  return {
    select() {
      const filters = {};
      const builder = {
        eq(col, val) {
          filters[col] = val;
          return builder;
        },
        limit(n) {
          if (errorOverride) return Promise.resolve({ data: null, error: errorOverride });
          const matched = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)).slice(0, n);
          return Promise.resolve({ data: matched, error: null });
        },
        maybeSingle() {
          if (errorOverride) return Promise.resolve({ data: null, error: errorOverride });
          const matched = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
          return Promise.resolve({ data: matched[0] || null, error: null });
        },
      };
      return builder;
    },
  };
}

const HOMES = [
  { id: "home-1", estate_id: "estate-1", building_id: "building-1", canonical_ref: "LUNA-L06-APT-A" },
  { id: "home-other-estate", estate_id: "estate-2", building_id: null, canonical_ref: "OTHER-ESTATE-HOME" },
  { id: "home-dup", estate_id: "estate-1", building_id: "building-1", canonical_ref: "DUP-REF" },
];
const ROOMS = [
  { id: "room-1", estate_id: "estate-1", home_id: "home-1", canonical_ref: "LUNA-L06-APT-A-BEDROOM1" },
  { id: "room-dup", estate_id: "estate-1", home_id: "home-1", canonical_ref: "DUP-REF" },
];
const DEVICES = [{ id: "device-1", estate_id: "estate-1", home_id: "home-1", room_id: "room-1", canonical_ref: "LUNA-L06-APT-A-BEDROOM1-AC" }];

function fakeFrom({ homes = HOMES, rooms = ROOMS, devices = DEVICES, homesError, roomsError, devicesError } = {}) {
  return (table) => {
    if (table === "homes") return makeTable(homes, homesError);
    if (table === "rooms") return makeTable(rooms, roomsError);
    if (table === "devices") return makeTable(devices, devicesError);
    return originalFrom(table);
  };
}

// 1. Valid home canonical_ref resolves correctly, with building scope.
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveCanonicalRef("estate-1", "LUNA-L06-APT-A");
  need(result.status === "resolved", `expected resolved, got ${result.status}`);
  need(result.entity_type === "home", `expected entity_type home, got ${result.entity_type}`);
  need(result.canonical_id === "home-1", `expected canonical_id home-1, got ${result.canonical_id}`);
  need(result.scope.home_id === "home-1", "home resolution must set scope.home_id");
  need(result.scope.building_id === "building-1", "home resolution must surface its own building_id");
  need(result.scope.room_id === null, "a home resolution must not fabricate a room_id");
  supabaseAdmin.from = originalFrom;
}

// 2. Valid room canonical_ref resolves correctly, deriving building_id via its parent home.
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveCanonicalRef("estate-1", "LUNA-L06-APT-A-BEDROOM1");
  need(result.status === "resolved", `expected resolved, got ${result.status}`);
  need(result.entity_type === "room", `expected entity_type room, got ${result.entity_type}`);
  need(result.canonical_id === "room-1", `expected canonical_id room-1, got ${result.canonical_id}`);
  need(result.scope.home_id === "home-1", "room resolution must surface its parent home_id");
  need(result.scope.building_id === "building-1", "room resolution must derive building_id via its parent home, not leave it null");
  supabaseAdmin.from = originalFrom;
}

// 3. Valid device canonical_ref resolves correctly.
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveCanonicalRef("estate-1", "LUNA-L06-APT-A-BEDROOM1-AC");
  need(result.status === "resolved", `expected resolved, got ${result.status}`);
  need(result.entity_type === "device", `expected entity_type device, got ${result.entity_type}`);
  need(result.canonical_id === "device-1", `expected canonical_id device-1, got ${result.canonical_id}`);
  need(result.scope.room_id === "room-1", "device resolution must surface its own room_id");
  need(result.scope.building_id === "building-1", "device resolution must derive building_id via its parent home");
  supabaseAdmin.from = originalFrom;
}

// 4. Unknown canonical_ref does not guess -- not_found, nothing fabricated.
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveCanonicalRef("estate-1", "NO-SUCH-REF");
  need(result.status === "not_found", `expected not_found, got ${result.status}`);
  need(result.canonical_id === null, "an unresolved ref must never carry a fabricated canonical_id");
  need(result.entity_type === null, "an unresolved ref must never carry a fabricated entity_type");
  supabaseAdmin.from = originalFrom;
}

// 5. Null/missing refs are not fabricated.
{
  supabaseAdmin.from = fakeFrom();
  for (const input of [null, undefined, "", "   "]) {
    const result = await resolveCanonicalRef("estate-1", input);
    need(result.status === "not_found", `expected not_found for input ${JSON.stringify(input)}, got ${result.status}`);
    need(result.canonical_id === null, `expected null canonical_id for input ${JSON.stringify(input)}`);
  }
  supabaseAdmin.from = originalFrom;
}

// 6. Duplicate/ambiguous identity (same ref string in two different
// tables, e.g. a home and a room both using "DUP-REF") cannot silently
// resolve to either one.
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveCanonicalRef("estate-1", "DUP-REF");
  need(result.status === "ambiguous", `expected ambiguous, got ${result.status}`);
  need(result.canonical_id === null, "an ambiguous resolution must never pick a winner");
  supabaseAdmin.from = originalFrom;
}

// 7. Cross-estate access is denied: a ref that genuinely exists, but
// belongs to a different estate than the caller's authorized scope, must
// not resolve -- proving the resolver cannot be used to escape estate
// scope.
{
  supabaseAdmin.from = fakeFrom();
  const result = await resolveCanonicalRef("estate-1", "OTHER-ESTATE-HOME");
  need(result.status === "not_found", `a ref belonging to a different estate must resolve as not_found from estate-1's scope, got ${result.status}`);
  need(result.canonical_id === null, "cross-estate lookup must never leak the other estate's canonical_id");

  const sameRefOwnEstate = await resolveCanonicalRef("estate-2", "OTHER-ESTATE-HOME");
  need(sameRefOwnEstate.status === "resolved", "the same ref must resolve correctly when queried from its own, authorized estate");
  supabaseAdmin.from = originalFrom;
}

// 8. Not-yet-applied migration (column does not exist, Postgres 42703)
// resolves as not_found, not a 500 -- same defensive posture already
// established in src/routes/me.routes.ts for this exact migration.
{
  supabaseAdmin.from = fakeFrom({ homesError: { code: "42703", message: 'column "canonical_ref" does not exist' }, roomsError: { code: "42703", message: 'column "canonical_ref" does not exist' }, devicesError: { code: "42703", message: 'column "canonical_ref" does not exist' } });
  const result = await resolveCanonicalRef("estate-1", "LUNA-L06-APT-A");
  need(result.status === "not_found", `a not-yet-applied canonical_ref column must resolve as not_found, got ${result.status}`);
  supabaseAdmin.from = originalFrom;
}

// 9. A genuine, non-missing-column query error must still throw, not be
// swallowed into a false not_found.
{
  supabaseAdmin.from = fakeFrom({ homesError: { code: "500", message: "simulated real database failure" } });
  let threw = null;
  try {
    await resolveCanonicalRef("estate-1", "LUNA-L06-APT-A");
  } catch (err) {
    threw = err;
  }
  need(threw && /simulated real database failure/.test(threw.message), "a genuine query failure must propagate, not resolve as not_found");
  supabaseAdmin.from = originalFrom;
}

// 10. Permission consistency fix (Section 9): the dormant
// digital_twin.object destination must use the real permission
// vocabulary (twin.view), not the never-real "digital_twin.read".
{
  const { SEMANTIC_DESTINATIONS } = await import("../dist/oyi-core/interpretation/conversationIntentRouting.js");
  const destination = SEMANTIC_DESTINATIONS["digital_twin.object"];
  need(!!destination, "digital_twin.object destination must still exist");
  need(destination.required_permission === "twin.view", `expected digital_twin.object.required_permission to be "twin.view", got ${JSON.stringify(destination.required_permission)}`);
}

if (failures.length) {
  console.error(`FAIL facility-canonical-ref-resolver-smoke (${failures.length} failure(s)):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("PASS facility-canonical-ref-resolver-smoke");
