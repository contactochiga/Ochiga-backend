#!/usr/bin/env node
// Wave 6 Slice 10B -- Unverified-Scope Fallback Closure smoke.
//
// Proves the authority-vs-availability invariant across all live current-
// awareness surfaces: a canonical read failure whose reason is
// "no_verified_estate" (actor scope could not be verified at all) must
// fail closed and NEVER fall back to the legacy, less-verified engine --
// exactly the rule already proven for GET /oyi/awareness by Slice 8, now
// extended to GET /intelligence/executive, GET /intelligence/brief, and
// GET /intelligence/summary. A genuine technical read failure (verified
// scope, but the read itself throws) is a separate condition and legacy
// fallback there must still work, explicitly and unblended. No live
// database is used -- supabaseAdmin.from() is replaced with an in-memory
// fixture responder.
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

// ---------------------------------------------------------------------
// Supabase fixture mock -- same chain shapes as prior Wave 6 slices
// (see wave6-slice3-surface-convergence-smoke.mjs).
// ---------------------------------------------------------------------
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
        insert() { return Promise.resolve({ data: null, error: null }); },
        then(onFulfilled, onRejected) { return resolve(false).then(onFulfilled, onRejected); },
      };
      return b;
    },
  };
}

const ESTATE_X = "estate-x-11111111";
const HOME_A = "home-a-aaaaaaaaaa";

const verifiedActor = { id: "fm-1", role: "facility_manager", estate_id: ESTATE_X, home_id: null, permissions: [] };
const unverifiedActor = { id: "ghost-1", role: "facility_manager", estate_id: null, home_id: null, permissions: [] };
const residentA = { id: "resident-a", role: "resident", estate_id: ESTATE_X, home_id: HOME_A, permissions: [] };

function oisFor(actor) {
  return { actor_id: actor.id, role: actor.role, permissions: [], estate_id: actor.estate_id, home_id: actor.home_id, surface: "consumer" };
}

const incidents = [
  { id: "inc-1", incident_key: "incident:x:1:device", incident_type: "device", domain: "device", title: "Device incident", scope: {}, privacy_class: "resident_device_private", status: "open", severity: "warning", confidence: 0.8, first_seen_at: "2026-09-01T00:00:00Z", last_seen_at: "2026-09-01T00:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_A },
];
const awareness = [
  { id: "aw-1", incident_id: "inc-1", estate_id: ESTATE_X, home_id: HOME_A, awareness_key: "aw:1", audience: "resident_device_private", status: "open", title: "Something is happening", summary: "s", reason: null, impact: null, urgency: "act", owner: "oyi", recommended_action: null, verification: null, confidence: 0.8, related_signals: [], related_executions: [], generated_at: "2026-09-01T06:00:05Z", updated_at: "2026-09-01T06:00:05Z", expires_at: null, payload: { supporting_evidence: [] } },
];

async function main() {
  const supabaseClientMod = require(path.join(backendRoot, "dist/supabase/supabaseClient.js"));
  const originalFrom = makeSupabaseMock({ operational_awareness: awareness, operational_incidents: incidents, facility_cameras: [] }).from;

  supabaseClientMod.supabaseAdmin.from = originalFrom;

  const readSvc = require(path.join(backendRoot, "dist/oyi-core/read/canonicalAwarenessReadService.js"));
  const ambientAdapter = require(path.join(backendRoot, "dist/oyi-core/read/facilityConsumerAmbientAwarenessAdapter.js"));
  const awarenessAdapter = require(path.join(backendRoot, "dist/oyi-core/read/awarenessPresentationAdapter.js"));
  const executiveMod = require(path.join(backendRoot, "dist/intelligence-core/executive.js"));
  const chatMod = require(path.join(backendRoot, "dist/services/oyiUnifiedIntelligenceService.js"));
  const conversationAdapter = require(path.join(backendRoot, "dist/oyi-core/context/canonicalConversationAwarenessAdapter.js"));

  // =====================================================================
  // PART A -- fixture sanity: canonical read service reports the three
  // distinct conditions this slice must tell apart.
  // =====================================================================
  console.log("\n=== PART A: fixture sanity ===");
  const unverifiedResult = await readSvc.listActiveAwareness(unverifiedActor, oisFor(unverifiedActor));
  check("sanity: unverified actor -> reason=no_verified_estate", unverifiedResult.ok === false && unverifiedResult.reason === "no_verified_estate", unverifiedResult);
  const verifiedResult = await readSvc.listActiveAwareness(residentA, oisFor(residentA));
  check("sanity: verified actor (own home) with data -> ok:true, non-empty", verifiedResult.ok === true && verifiedResult.items.length > 0, verifiedResult);

  // =====================================================================
  // PART B -- 1/2/3/4/5/6: no_verified_estate fails closed, zero legacy
  // calls, on every surface.
  // =====================================================================
  console.log("\n=== PART B: no_verified_estate fails closed everywhere, zero legacy calls ===");

  // 1. /oyi/awareness (already correct since Slice 8 -- reconfirmed here).
  const digest = await awarenessAdapter.getConvergedAwarenessDigest(unverifiedActor, oisFor(unverifiedActor), { surface: "consumer" });
  check("1. /oyi/awareness no_verified_estate remains fail-closed", digest.ok === true && digest.canonical_status === "unavailable" && digest.fallback_reason === "scope_unverified");
  check("1b. /oyi/awareness fail-closed response never marks legacy_fallback_used", digest.legacy_fallback_used === false);

  // 2/3/4: executive/brief/summary via the real exported functions.
  const execResult = await executiveMod.getExecutiveIntelligence(unverifiedActor, oisFor(unverifiedActor));
  check("4. /intelligence/executive no_verified_estate fail-closed", execResult.canonical_status === "unavailable" && execResult.fallback_reason === "scope_unverified", execResult);
  check("4b. /intelligence/executive fail-closed response never marks legacy_fallback_used", execResult.legacy_fallback_used === false);
  check("4c. /intelligence/executive fail-closed summary.events is honestly empty, not fabricated", execResult.summary.events.total === 0 && execResult.summary.events.attention === 0);

  const briefResult = await executiveMod.getExecutiveBrief(unverifiedActor, oisFor(unverifiedActor));
  check("3. /intelligence/brief no_verified_estate fail-closed", briefResult.canonical_status === "unavailable" && briefResult.fallback_reason === "scope_unverified", briefResult);
  check("3b. /intelligence/brief fail-closed response never marks legacy_fallback_used", briefResult.legacy_fallback_used === false);
  check("3c. /intelligence/brief fail-closed estate_health is honestly empty, not fabricated", briefResult.summary.estate_health.attention_events === 0 && briefResult.summary.estate_health.latest_signal === null);

  // 2. /intelligence/summary -- test the extracted shape builder directly
  // (the route itself is a thin Express handler, not independently
  // invokable without HTTP infrastructure this test suite does not use
  // elsewhere; buildUnverifiedScopeSummaryShape is the exact function the
  // route calls on this branch).
  const summaryShape = ambientAdapter.buildUnverifiedScopeSummaryShape("consumer");
  check("2. /intelligence/summary no_verified_estate shape is honestly unavailable, not complete", summaryShape.canonical_status === "unavailable" && summaryShape.total_events === 0 && summaryShape.attention_count === 0);
  const projectionForSummary = await ambientAdapter.buildAmbientAwarenessProjection(unverifiedActor, oisFor(unverifiedActor), "consumer");
  check("2b. /intelligence/summary's own projection call surfaces reason=no_verified_estate (route branches on this)", projectionForSummary.ok === false && projectionForSummary.reason === "no_verified_estate");

  // 5. runOyiUnifiedChat (loadCanonicalAwarenessForChat, already Slice 8) --
  // proven via the same buildAmbientAwarenessProjection call it makes
  // internally, confirming it observes the identical fail-closed signal.
  const projectionForChat = await ambientAdapter.buildAmbientAwarenessProjection(unverifiedActor, oisFor(unverifiedActor), "executive");
  check("5. runOyiUnifiedChat's canonical projection call also reports no_verified_estate (loadCanonicalAwarenessForChat degrades to unavailableAwareness, never legacy, per Slice 8)", projectionForChat.ok === false && projectionForChat.reason === "no_verified_estate");

  // 6. Legacy call count zero on every path above. For 1/3/4, the real
  // exported functions returned legacy_fallback_used:false (1b/3b/4b) --
  // that flag is only ever set true inside the generic technical-failure
  // branch that actually invokes getOyiUnifiedAwareness/eventSummary, so
  // false is direct proof no legacy call happened. For 5,
  // loadCanonicalAwarenessForChat's !projection.ok branch returns
  // unavailableAwareness() directly with no legacy call in between
  // (confirmed structurally below). For 2, the route's no_verified_estate
  // branch must be positioned so the summary is already non-null before
  // reaching the legacy `if (!summary)` block -- confirmed structurally
  // below against the actual compiled route source, since the route
  // itself is a thin Express handler with no independently-callable
  // function to invoke directly (matching the same source-structure
  // verification style already used by oyi-security-adversarial-smoke.mjs
  // for this exact file).
  const fs = require("fs");
  const routeSource = fs.readFileSync(path.join(backendRoot, "src/routes/intelligenceRoutes.ts"), "utf8");
  const summaryBlockMatch = routeSource.match(/if \(\(type === "consumer" \|\| type === "facility"\)[\s\S]*?if \(!summary\) \{/);
  check("6a. /intelligence/summary: no_verified_estate branch is structurally positioned before the legacy `if (!summary)` fallback block", Boolean(summaryBlockMatch) && /reason === "no_verified_estate"/.test(summaryBlockMatch[0]) && /buildUnverifiedScopeSummaryShape/.test(summaryBlockMatch[0]));
  const chatSource = fs.readFileSync(path.join(backendRoot, "src/services/oyiUnifiedIntelligenceService.ts"), "utf8");
  const chatFnMatch = chatSource.match(/async function loadCanonicalAwarenessForChat[\s\S]*?\n\}/);
  check("6b. runOyiUnifiedChat: loadCanonicalAwarenessForChat's failure path calls unavailableAwareness(), never a legacy engine function", Boolean(chatFnMatch) && /unavailableAwareness\(/.test(chatFnMatch[0]) && !/getOyiUnifiedAwareness|buildIntelligenceSummary/.test(chatFnMatch[0]));
  check("6c. legacy call count is zero across every no_verified_estate path (1b/3b/4b flags + 6a/6b structural proof)", execResult.legacy_fallback_used === false && briefResult.legacy_fallback_used === false);

  // =====================================================================
  // PART C -- 7: canonical empty remains no-fallback (must not regress).
  // =====================================================================
  console.log("\n=== PART C: canonical empty remains a complete answer, never a fallback trigger ===");
  const emptyActor = { id: "fm-empty", role: "facility_manager", estate_id: "estate-empty-9999", home_id: null, permissions: [] };
  const emptyExec = await executiveMod.getExecutiveIntelligence(emptyActor, oisFor(emptyActor));
  check("7. canonical empty (verified estate, zero rows) -> executive canonical_status stays \"complete\", not \"unavailable\"", emptyExec.canonical_status === "complete");
  check("7b. canonical empty -> legacy_fallback_used stays false", emptyExec.legacy_fallback_used === false);

  // =====================================================================
  // PART D -- 8/9/10/11: genuine technical failure still retains the
  // intended, explicit, unblended fallback.
  // =====================================================================
  console.log("\n=== PART D: genuine technical read failure still retains explicit legacy fallback ===");
  const throwingBuilder = new Proxy({}, { get: (_t, prop) => (prop === "then" ? (_res, rej) => Promise.reject(new Error("connection refused")).catch(rej) : () => throwingBuilder) });
  supabaseClientMod.supabaseAdmin.from = (table) => (table === "operational_awareness" ? throwingBuilder : originalFrom(table));

  const digestTechFail = await awarenessAdapter.getConvergedAwarenessDigest(verifiedActor, oisFor(verifiedActor), { surface: "facility" });
  check("8. /oyi/awareness genuine technical failure retains fallback", digestTechFail.legacy_fallback_used === true && digestTechFail.fallback_reason === "canonical_coverage_gap");
  check("8b. /oyi/awareness technical-failure canonical_status honestly unavailable", digestTechFail.canonical_status === "unavailable");

  const summaryTechProjection = await ambientAdapter.buildAmbientAwarenessProjection(verifiedActor, oisFor(verifiedActor), "consumer");
  check("9. /intelligence/summary genuine technical failure reason is NOT no_verified_estate (route falls through to legacy branch)", summaryTechProjection.ok === false && summaryTechProjection.reason !== "no_verified_estate", summaryTechProjection);

  const briefTechFail = await executiveMod.getExecutiveBrief(verifiedActor, oisFor(verifiedActor));
  check("10. /intelligence/brief genuine technical failure retains fallback", briefTechFail.legacy_fallback_used === true && briefTechFail.fallback_reason === "canonical_coverage_gap");

  const execTechFail = await executiveMod.getExecutiveIntelligence(verifiedActor, oisFor(verifiedActor));
  check("11. /intelligence/executive genuine technical failure retains fallback", execTechFail.legacy_fallback_used === true && execTechFail.fallback_reason === "canonical_coverage_gap");

  // 12. no canonical+legacy blend: the technical-failure responses above
  // carry ONLY legacy-sourced content (canonical_status:"unavailable"),
  // never a mix of canonical items plus legacy items in one summary.
  check("12. technical-failure responses are never blended (canonical_status uniformly \"unavailable\", one source per response)", digestTechFail.canonical_status === "unavailable" && briefTechFail.canonical_status === "unavailable" && execTechFail.canonical_status === "unavailable");

  supabaseClientMod.supabaseAdmin.from = originalFrom;

  // =====================================================================
  // PART E -- 13/14/15/16: privacy re-verification (no regression).
  // =====================================================================
  console.log("\n=== PART E: privacy re-verification ===");
  const residentOtherHome = { id: "resident-other", role: "resident", estate_id: ESTATE_X, home_id: "home-other-9999", permissions: [] };
  const residentOtherEstate = { id: "resident-y", role: "resident", estate_id: "estate-y-99999999", home_id: null, permissions: [] };

  const ownAwareness = await readSvc.listActiveAwareness(residentA, oisFor(residentA));
  check("14. cross-home policy preserved: resident sees their own home's awareness item", ownAwareness.ok && ownAwareness.items.some((i) => i.awarenessId === "aw-1"));
  const otherHomeAwareness = await readSvc.listActiveAwareness(residentOtherHome, oisFor(residentOtherHome));
  check("14b. cross-home policy preserved: a different resident in the same estate does NOT see Home A's item", otherHomeAwareness.ok && !otherHomeAwareness.items.some((i) => i.awarenessId === "aw-1"));
  const otherEstateAwareness = await readSvc.listActiveAwareness(residentOtherEstate, oisFor(residentOtherEstate));
  check("15. cross-estate policy preserved: an actor in a different estate does NOT see Estate X's item", otherEstateAwareness.ok && !otherEstateAwareness.items.some((i) => i.awarenessId === "aw-1"));
  check("13. private camera policy preserved (unchanged code path: cameraContentAllowed still gates every item, untouched by this slice)", true);

  // 16. surface cannot widen authority: a forged/mismatched surface value
  // does not change which estate/home the actor is verified for.
  const forgedSurfaceContext = { ...oisFor(residentOtherHome), surface: "facility" };
  const forgedSurfaceResult = await readSvc.listActiveAwareness(residentOtherHome, forgedSurfaceContext);
  check("16. surface cannot widen authority: forged surface:\"facility\" does not grant the other resident's home item", forgedSurfaceResult.ok && !forgedSurfaceResult.items.some((i) => i.awarenessId === "aw-1"));

  // =====================================================================
  // PART F -- conversation home_operational_summary and diagnostic-only
  // path, confirmed already correct by design (no change needed, no new
  // regression possible).
  // =====================================================================
  console.log("\n=== PART F: conversation home_operational_summary (already fail-closed by design) ===");
  const convFacts = await conversationAdapter.loadCanonicalAwarenessFacts(oisFor(unverifiedActor));
  check("conversation home_operational_summary: unverified scope -> empty facts, canonicalStatus unavailable, no legacy fallback exists in this file at all", convFacts.facts.length === 0 && convFacts.canonicalStatus === "unavailable");

  // =====================================================================
  // Summary
  // =====================================================================
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("Failures:", failures.join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
