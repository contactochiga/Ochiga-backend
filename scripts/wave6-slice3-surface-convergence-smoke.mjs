#!/usr/bin/env node
// Wave 6 Slice 3 -- Surface Read Convergence + Coverage Closure smoke suite.
//
// Proves: (1) the new direct estate_id/home_id columns on
// operational_awareness close the incident-less coverage gap without
// weakening any Slice 1/1B/2 privacy invariant; (2) the closure is opt-in
// (includeUnincidented) and never changes default listActiveAwareness
// behavior; (3) historical incident-linked rows without the new columns
// still resolve scope via the incident-join fallback; (4) GET
// /oyi/awareness's presentation adapter tries canonical first and falls
// back to legacy only explicitly, never blending the two truths; (5) a
// genuinely still-unscopeable row fails closed and is honestly counted.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = "/Users/ochigaidoko/Documents/Ochiga-backend";
require(path.join(backendRoot, "node_modules/dotenv")).config({ path: path.join(backendRoot, ".env") });

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) {
    pass += 1;
    console.log(`  PASS: ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL: ${label}`);
  }
}

function makeSupabaseMock(tables) {
  return {
    from(table) {
      const rows = tables[table] || [];
      const state = { eqFilters: {}, neqFilters: {}, inFilters: {}, notNullCols: [], nullCols: [], countMode: false, limitN: null };
      function applyFilters(source) {
        return source.filter((row) => {
          for (const [col, val] of Object.entries(state.eqFilters)) if (String(row[col] ?? "") !== String(val)) return false;
          for (const [col, val] of Object.entries(state.neqFilters)) if (String(row[col] ?? "") === String(val)) return false;
          for (const [col, vals] of Object.entries(state.inFilters)) if (!vals.map(String).includes(String(row[col] ?? ""))) return false;
          for (const col of state.notNullCols) if (row[col] === null || row[col] === undefined) return false;
          for (const col of state.nullCols) if (!(row[col] === null || row[col] === undefined)) return false;
          return true;
        });
      }
      function resolve(single) {
        let filtered = applyFilters(rows);
        if (state.countMode) return Promise.resolve({ data: null, error: null, count: filtered.length });
        if (state.limitN != null) filtered = filtered.slice(0, state.limitN);
        if (single) return Promise.resolve({ data: filtered[0] || null, error: null });
        return Promise.resolve({ data: filtered, error: null });
      }
      const b = {
        select(_cols, opts) {
          if (opts && opts.count === "exact" && opts.head) state.countMode = true;
          return b;
        },
        eq(col, val) { state.eqFilters[col] = val; return b; },
        neq(col, val) { state.neqFilters[col] = val; return b; },
        in(col, vals) { state.inFilters[col] = vals; return b; },
        not(col, op, val) { if (op === "is" && val === null) state.notNullCols.push(col); return b; },
        is(col, val) { if (val === null) state.nullCols.push(col); return b; },
        order() { return b; },
        limit(n) { state.limitN = n; return b; },
        maybeSingle() { return resolve(true); },
        single() { return resolve(true); },
        then(onFulfilled, onRejected) { return resolve(false).then(onFulfilled, onRejected); },
      };
      return b;
    },
  };
}

const ESTATE_X = "estate-x-11111111";
const HOME_A = "home-a-aaaaaaaaaa";
const HOME_B = "home-b-bbbbbbbbbb";

const residentA = { id: "resident-a", role: "resident", estate_id: ESTATE_X, home_id: HOME_A, permissions: [] };
const residentB = { id: "resident-b", role: "resident", estate_id: ESTATE_X, home_id: HOME_B, permissions: [] };
const facilityManager = { id: "fm-1", role: "facility_manager", estate_id: ESTATE_X, permissions: [] };
const noEstateActor = { id: "ghost-1", role: "resident", estate_id: null, home_id: null, permissions: [] };

function oisFor(actor) {
  return { actor_id: actor.id, role: actor.role, permissions: [], estate_id: actor.estate_id, home_id: actor.home_id, surface: "consumer" };
}

// inc-legacy-a: an OLD-style incident row -- awareness row has NO direct
// estate_id/home_id (simulating a row written before the write-path fix
// / not yet backfilled), scope must still resolve via the incident join.
const incidents = [
  { id: "inc-legacy-a", incident_key: "incident:x:a:device:dev-legacy", incident_type: "device", domain: "device", title: "Legacy-shape device incident", scope: { entity_type: "device", entity_id: "dev-legacy" }, privacy_class: "resident_device_private", status: "open", severity: "warning", confidence: 0.8, first_seen_at: "2026-09-01T00:00:00Z", last_seen_at: "2026-09-01T00:00:00Z", resolved_at: null, current_summary: "Legacy incident.", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_A },
];

const awareness = [
  // Legacy-shape row: incident_id set, estate_id/home_id NOT populated
  // directly (pre-Slice-3 write). Scope must fall back to the incident join.
  { id: "aw-legacy-a-1", incident_id: "inc-legacy-a", estate_id: null, home_id: null, awareness_key: "aw:legacy-a:1", audience: "resident_device_private", status: "open", title: "Legacy shape still resolves", summary: "s", reason: null, impact: null, urgency: "medium", owner: "oyi", recommended_action: null, verification: null, confidence: 0.8, related_signals: [], related_executions: [], generated_at: "2026-09-01T00:00:05Z", updated_at: "2026-09-01T00:00:05Z", expires_at: null, payload: { supporting_evidence: [] } },

  // New-shape, incident-LESS rows (correlateIncident() returned null) --
  // this is exactly the Slice 2 coverage gap, now closed at the write
  // level: estate_id/home_id are populated directly.
  { id: "aw-unincidented-a-1", incident_id: null, estate_id: ESTATE_X, home_id: HOME_A, awareness_key: "aw:unincidented-a:1", audience: "resident_device_private", status: "open", title: "Your device state changed", summary: "Routine private device observation for Home A.", reason: "routine_private_info", impact: null, urgency: "monitor", owner: "oyi", recommended_action: null, verification: null, confidence: 0.5, related_signals: [], related_executions: [], generated_at: "2026-09-01T06:00:05Z", updated_at: "2026-09-01T06:00:05Z", expires_at: null, payload: { supporting_evidence: [] } },
  { id: "aw-unincidented-b-1", incident_id: null, estate_id: ESTATE_X, home_id: HOME_B, awareness_key: "aw:unincidented-b:1", audience: "resident_device_private", status: "open", title: "Home B private observation", summary: "s", reason: "routine_private_info", impact: null, urgency: "monitor", owner: "oyi", recommended_action: null, verification: null, confidence: 0.5, related_signals: [], related_executions: [], generated_at: "2026-09-01T06:05:05Z", updated_at: "2026-09-01T06:05:05Z", expires_at: null, payload: { supporting_evidence: [] } },

  // Genuinely still-unresolvable row: no incident_id AND no direct scope
  // columns (a true historical row predating both the backfill and the
  // write-path fix). Must remain excluded and honestly counted.
  { id: "aw-truly-orphan-1", incident_id: null, estate_id: null, home_id: null, awareness_key: "aw:truly-orphan:1", audience: "resident_device_private", status: "open", title: "Unresolvable ancient row", summary: "s", reason: null, impact: null, urgency: "monitor", owner: "oyi", recommended_action: null, verification: null, confidence: 0.5, related_signals: [], related_executions: [], generated_at: "2026-09-01T06:10:05Z", updated_at: "2026-09-01T06:10:05Z", expires_at: null, payload: { supporting_evidence: [] } },
];

async function main() {
  const supabaseClientMod = require(path.join(backendRoot, "dist/supabase/supabaseClient.js"));
  supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({
    operational_awareness: awareness,
    operational_incidents: incidents,
    facility_cameras: [],
  }).from;

  const svc = require(path.join(backendRoot, "dist/oyi-core/read/canonicalAwarenessReadService.js"));

  console.log("=== Backward compatibility: legacy-shape row (no direct scope columns) still resolves via incident join ===");
  {
    const own = await svc.getAwareness(residentA, oisFor(residentA), "aw-legacy-a-1");
    check("residentA still resolves the legacy-shape row via incident join", own.ok && own.item?.title === "Legacy shape still resolves");
    const other = await svc.getAwareness(residentB, oisFor(residentB), "aw-legacy-a-1");
    check("residentB is still denied the legacy-shape row (home mismatch via incident join)", other.ok === false && other.reason === "denied");
  }

  console.log("\n=== Default behavior unchanged: incident-less rows excluded from listActiveAwareness by default ===");
  {
    const defaultList = await svc.listActiveAwareness(residentA, oisFor(residentA));
    check("default listActiveAwareness does NOT include the now-scoped incident-less row (includeUnincidented defaults false)", defaultList.ok && !defaultList.items.some((i) => i.awarenessId === "aw-unincidented-a-1"));
  }

  console.log("\n=== Opt-in coverage closure: includeUnincidented surfaces incident-less rows, still fully scope-gated ===");
  {
    const ownOptIn = await svc.listActiveAwareness(residentA, oisFor(residentA), { includeUnincidented: true });
    check("residentA WITH includeUnincidented sees their own now-scoped private observation", ownOptIn.ok && ownOptIn.items.some((i) => i.awarenessId === "aw-unincidented-a-1"));
    check("residentA does NOT see Home B's incident-less observation even with includeUnincidented", !ownOptIn.items.some((i) => i.awarenessId === "aw-unincidented-b-1"));

    const facilityOptIn = await svc.listActiveAwareness(facilityManager, oisFor(facilityManager), { includeUnincidented: true });
    check("facility_manager (cannot view private-home content) does not see either incident-less private row even with includeUnincidented", !facilityOptIn.items.some((i) => i.awarenessId === "aw-unincidented-a-1" || i.awarenessId === "aw-unincidented-b-1"));

    const directGet = await svc.getAwareness(residentA, oisFor(residentA), "aw-unincidented-a-1");
    check("direct getAwareness() of a now-scoped incident-less row resolves for the owning resident (no opt-in gate on direct id lookup)", directGet.ok && directGet.item?.scope.homeId === HOME_A);
  }

  console.log("\n=== Genuine remaining gap is still honest ===");
  {
    const orphanGet = await svc.getAwareness(residentA, oisFor(residentA), "aw-truly-orphan-1");
    check("a row with neither incident_id nor direct scope columns still fails closed", orphanGet.ok === false && orphanGet.reason === "scope_unresolved");
    const listWithGap = await svc.listActiveAwareness(residentA, oisFor(residentA), { includeUnincidented: true });
    check("coverageGap.scopeUnresolvedExcluded counts the truly-orphan row honestly", listWithGap.coverageGap.scopeUnresolvedExcluded === 1);
  }

  console.log("\n=== E2E F: incident-less awareness class made user-readable end to end ===");
  {
    const result = await svc.listActiveAwareness(residentA, oisFor(residentA), { includeUnincidented: true });
    const item = result.items.find((i) => i.awarenessId === "aw-unincidented-a-1");
    check("signal -> persisted authoritative scope (direct columns) -> canonical read succeeds for the owning resident", Boolean(item));
    check("privacy_class for the incident-less row resolves from audience (no incident to source it from)", item?.privacyClass === "resident_device_private");
  }

  console.log("\n=== GET /oyi/awareness presentation adapter: canonical-first, explicit fallback, no double presentation ===");
  {
    const oyiUnifiedMod = require(path.join(backendRoot, "dist/services/oyiUnifiedIntelligenceService.js"));
    let legacyCalls = 0;
    oyiUnifiedMod.getOyiUnifiedAwareness = async () => {
      legacyCalls += 1;
      return { ok: true, headline: "LEGACY DIGEST", summary: "legacy summary", body: "legacy body", severity: "warning", recommended_action: "legacy action", destination: "", cards: [{ id: "legacy-card" }], sources: [], suggested_actions: [], awareness_score: 40, score: 40, generated_at: "2026-09-01T00:00:00Z" };
    };
    const adapter = require(path.join(backendRoot, "dist/oyi-core/read/awarenessPresentationAdapter.js"));

    const canonicalSuccess = await adapter.getConvergedAwarenessDigest(residentA, oisFor(residentA), { surface: "consumer", estate_id: ESTATE_X, home_id: HOME_A });
    check("canonical-success path marks legacy_fallback_used:false", canonicalSuccess.legacy_fallback_used === false);
    check("canonical-success path never calls legacy at all (no double presentation)", legacyCalls === 0);
    check("canonical-success path sets a real canonical_status (complete or partial), not 'unavailable'", canonicalSuccess.canonical_status === "complete" || canonicalSuccess.canonical_status === "partial");
    check("canonical-success digest does not contain the legacy sentinel headline", canonicalSuccess.headline !== "LEGACY DIGEST");

    // Wave 6 Slice 8 Section 19 -- updated per the mandated fix: failure to
    // verify scope (no_verified_estate) must NOT trigger a fall-through to
    // the less-scope-verified legacy engine. It now fails closed instead
    // (still ok:true/graceful, never legacy-derived, never blended).
    const canonicalScopeUnverified = await adapter.getConvergedAwarenessDigest(noEstateActor, oisFor(noEstateActor), { surface: "consumer", estate_id: null, home_id: null });
    check("scope-unverified path does NOT fall back to legacy (Slice 8 fix -- fails closed instead)", legacyCalls === 0);
    check("scope-unverified digest is honestly marked legacy_fallback_used:false", canonicalScopeUnverified.legacy_fallback_used === false);
    check("scope-unverified digest carries the new scope_unverified fallback_reason", canonicalScopeUnverified.fallback_reason === "scope_unverified");
    check("scope-unverified digest never surfaces legacy content", canonicalScopeUnverified.headline !== "LEGACY DIGEST");
    check("scope-unverified digest still returns ok:true (graceful degradation, not a hard error)", canonicalScopeUnverified.ok === true);
    check("scope-unverified canonical_status is honestly 'unavailable'", canonicalScopeUnverified.canonical_status === "unavailable");

    // A genuine technical read failure (verified scope, but the canonical
    // read itself throws) is a separately-evaluated case and legitimately
    // still uses the explicit legacy fallback -- Section 19's principle is
    // scope-specific, not a blanket removal of all fallback.
    const originalFrom = supabaseClientMod.supabaseAdmin.from;
    const throwingBuilder = new Proxy({}, { get: (_t, prop) => (prop === "then" ? (_res, rej) => Promise.reject(new Error("connection refused")).catch(rej) : () => throwingBuilder) });
    supabaseClientMod.supabaseAdmin.from = (table) => (table === "operational_awareness" ? throwingBuilder : originalFrom(table));
    const canonicalTechnicalFailure = await adapter.getConvergedAwarenessDigest(facilityManager, oisFor(facilityManager), { surface: "consumer", estate_id: ESTATE_X, home_id: null });
    supabaseClientMod.supabaseAdmin.from = originalFrom;
    check("genuine technical read failure still explicitly falls back to legacy", legacyCalls === 1);
    check("technical-failure digest is honestly marked legacy_fallback_used:true", canonicalTechnicalFailure.legacy_fallback_used === true);
    check("technical-failure digest carries the documented fallback_reason", canonicalTechnicalFailure.fallback_reason === "canonical_coverage_gap");
    check("technical-failure digest actually surfaces the legacy content (not silently dropped)", canonicalTechnicalFailure.headline === "LEGACY DIGEST");
    check("technical-failure canonical_status is honestly 'unavailable'", canonicalTechnicalFailure.canonical_status === "unavailable");
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE SCRIPT CRASHED:", err);
  process.exit(1);
});
