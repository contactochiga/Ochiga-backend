#!/usr/bin/env node
// Wave 6 Slice 6 -- Executive Brief Awareness Convergence smoke suite.
//
// Exercises getExecutiveBrief() (src/intelligence-core/executive.ts) now
// that its ambient fields (camera_alerts, maintenance_risks,
// estate_health.attention_events, estate_health.latest_signal) are
// canonical-first via buildAmbientAwarenessProjection(..., "executive").
// Runs against compiled dist/ output with supabaseAdmin monkey-patched to
// an in-memory fixture set (same established pattern as Slice 2-5).
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const path = require("path");
const fs = require("fs");
const backendRoot = require("node:url").fileURLToPath(new URL("..", import.meta.url));
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

function makeSupabaseMock(tables, counter) {
  return {
    from(table) {
      if (counter) counter.calls += 1;
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
const CAM_COMMON = "cam-common-1";
const CAM_HOME_A = "cam-home-a-1";

const estateAdmin = { id: "admin-1", role: "estate_admin", estate_id: ESTATE_X, permissions: [] };
const facilityManager = { id: "fm-1", role: "facility_manager", estate_id: ESTATE_X, permissions: [] };
const noEstateExecutive = { id: "exec-ghost", role: "super_admin", estate_id: null, permissions: [] };

function oisFor(actor) {
  return { actor_id: actor.id, role: actor.role, permissions: [], estate_id: actor.estate_id, home_id: actor.home_id || null, surface: "office" };
}

const cameras = [
  { id: CAM_COMMON, estate_id: ESTATE_X, home_id: null, privacy_scope: "facility", metadata: {} },
  { id: CAM_HOME_A, estate_id: ESTATE_X, home_id: HOME_A, privacy_scope: "home", metadata: {} },
];

const incidents = [
  { id: "inc-power-outage", incident_key: "incident:x:shared:power:transformer-1", incident_type: "shared_infrastructure", domain: "power", title: "Estate power fluctuation", scope: { entity_type: "infrastructure", entity_id: "transformer-1" }, privacy_class: "building_operational", status: "open", severity: "warning", confidence: 0.65, first_seen_at: "2026-09-01T04:00:00Z", last_seen_at: "2026-09-01T04:40:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },
  { id: "inc-cam-home-a", incident_key: "incident:x:a:camera:cam-home-a-1", incident_type: "camera", domain: "camera", title: "Front door motion", scope: { entity_type: "camera", entity_id: CAM_HOME_A }, privacy_class: "building_security", status: "open", severity: "warning", confidence: 0.7, first_seen_at: "2026-09-01T02:00:00Z", last_seen_at: "2026-09-01T02:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_A },
  { id: "inc-cam-common", incident_key: "incident:x:shared:camera:cam-common-1", incident_type: "camera", domain: "camera", title: "Motion at Lobby", scope: { entity_type: "camera", entity_id: CAM_COMMON }, privacy_class: "building_security", status: "open", severity: "info", confidence: 0.6, first_seen_at: "2026-09-01T01:00:00Z", last_seen_at: "2026-09-01T01:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },
  { id: "inc-maint-a", incident_key: "incident:x:a:maintenance:mr-1", incident_type: "maintenance", domain: "maintenance", title: "Leak reported", scope: { entity_type: "maintenance_request", entity_id: "mr-1" }, privacy_class: "home_private", status: "open", severity: "warning", confidence: 0.75, first_seen_at: "2026-09-01T03:00:00Z", last_seen_at: "2026-09-01T03:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_A },
  { id: "inc-water-pump", incident_key: "incident:x:shared:water:pump-2", incident_type: "shared_infrastructure", domain: "water", title: "Water pump recovered", scope: { entity_type: "infrastructure", entity_id: "pump-2" }, privacy_class: "building_operational", status: "resolved", severity: "info", confidence: 0.9, first_seen_at: "2026-09-01T05:00:00Z", last_seen_at: "2026-09-01T05:30:00Z", resolved_at: "2026-09-01T05:30:00Z", current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },
];

function awarenessRow(id, incidentId, estateId, homeId, audience, title, summary, urgency, generatedAt) {
  return { id, incident_id: incidentId, estate_id: estateId, home_id: homeId, awareness_key: `aw:${id}`, audience, status: "open", title, summary, reason: null, impact: null, urgency, owner: "oyi", recommended_action: null, verification: null, confidence: 0.7, related_signals: [], related_executions: [], generated_at: generatedAt, updated_at: generatedAt, expires_at: null, payload: { supporting_evidence: [] } };
}

const awareness = [
  awarenessRow("aw-power-1", "inc-power-outage", ESTATE_X, null, "building_operational", "Voltage dip observed (1)", "s", "review", "2026-09-01T04:00:05Z"),
  awarenessRow("aw-power-2", "inc-power-outage", ESTATE_X, null, "building_operational", "Voltage dip observed (2)", "s", "act", "2026-09-01T04:40:05Z"),
  awarenessRow("aw-cam-home-a-1", "inc-cam-home-a", ESTATE_X, HOME_A, "building_security", "Front door motion", "s", "act", "2026-09-01T02:00:05Z"),
  awarenessRow("aw-cam-common-1", "inc-cam-common", ESTATE_X, null, "building_security", "Motion at Lobby", "s", "monitor", "2026-09-01T01:00:05Z"),
  awarenessRow("aw-maint-a-1", "inc-maint-a", ESTATE_X, HOME_A, "home_private", "Leak reported in Home A", "s", "act", "2026-09-01T03:00:05Z"),
  { ...awarenessRow("aw-water-pump-1", "inc-water-pump", ESTATE_X, null, "building_operational", "Water pump 2 recovered", "s", "monitor", "2026-09-01T05:30:05Z"), status: "resolved" },
];

async function main() {
  const supabaseClientMod = require(path.join(backendRoot, "dist/supabase/supabaseClient.js"));
  const executive = require(path.join(backendRoot, "dist/intelligence-core/executive.js"));
  const adapter = require(path.join(backendRoot, "dist/oyi-core/read/facilityConsumerAmbientAwarenessAdapter.js"));

  function seedFixtures() {
    supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({
      operational_awareness: awareness,
      operational_incidents: incidents,
      facility_cameras: cameras,
      // legacy-side tables used by the still-unmigrated parts of the
      // brief (predictions/workflows/observability/lead+sales counts) --
      // empty is fine, those code paths are untouched by this slice.
      intelligence_events: [],
    }).from;
  }
  seedFixtures();

  console.log("=== A. Common infrastructure incident: appears in canonical executive brief, same identity ===");
  {
    const brief = await executive.getExecutiveBrief(estateAdmin, oisFor(estateAdmin));
    check("A1. executive brief call succeeds for an authorized role", brief.ok === true);
    check("A2. brief is canonical-sourced (canonical_status present, not unavailable)", brief.canonical_status === "complete" || brief.canonical_status === "partial");
    check("A3. legacy_fallback_used is honestly false when canonical answered", brief.legacy_fallback_used === false);
    const projection = await adapter.buildAmbientAwarenessProjection(estateAdmin, oisFor(estateAdmin), "facility");
    check("A4. same incident (power outage) is visible via both the executive brief's ambient count and the Facility projection (shared identity)", brief.summary.estate_health.attention_events > 0 && projection.attentionItems.some((i) => i.incidentId === "inc-power-outage"));
  }

  console.log("\n=== B. Multiple observations -> one incident -> one executive attention item ===");
  {
    const brief = await executive.getExecutiveBrief(estateAdmin, oisFor(estateAdmin));
    // Only aw-power-2 (urgency "act") counts as "attention"; aw-power-1 is
    // "review" and correctly excluded, and both belong to the SAME
    // incident so they must not double-count as two crises.
    const projection = await adapter.buildAmbientAwarenessProjection(estateAdmin, oisFor(estateAdmin), "executive");
    const powerAttentionCount = projection.attentionItems.filter((i) => i.incidentId === "inc-power-outage").length;
    check("B1. the two power observations collapse into exactly one executive attention entry for that incident", powerAttentionCount === 1);
  }

  console.log("\n=== C. Private camera: unauthorized executive-like actor cannot receive protected content ===");
  {
    const brief = await executive.getExecutiveBrief(facilityManager, oisFor(facilityManager));
    const latest = brief.summary.estate_health.latest_signal;
    check("C1. latest_signal (if present) never surfaces Home A's protected camera title", !latest || latest.title !== "Front door motion");
    const projection = await adapter.buildAmbientAwarenessProjection(facilityManager, oisFor(facilityManager), "executive");
    check("C2. facility_manager's canonical projection does not include the private home camera incident", !projection.attentionItems.some((i) => i.incidentId === "inc-cam-home-a"));
    check("C3. facility_manager DOES see the common/facility camera incident (not over-blocked)", projection.attentionItems.some((i) => i.incidentId === "inc-cam-common"));
  }

  console.log("\n=== D. Maintenance: legitimate operational scope visible, unauthorized home scope hidden ===");
  {
    const estateAdminProjection = await adapter.buildAmbientAwarenessProjection(estateAdmin, oisFor(estateAdmin), "executive");
    check("D1. estate_admin (can_view_private_home) sees the home_private maintenance incident in the executive projection", estateAdminProjection.attentionItems.some((i) => i.incidentId === "inc-maint-a"));
    const facilityProjection = await adapter.buildAmbientAwarenessProjection(facilityManager, oisFor(facilityManager), "executive");
    check("D2. facility_manager (cannot view private-home content) does not see the home_private maintenance incident", !facilityProjection.attentionItems.some((i) => i.incidentId === "inc-maint-a"));
  }

  console.log("\n=== E. Resolution: resolved incident disappears from current executive attention ===");
  {
    const brief = await executive.getExecutiveBrief(estateAdmin, oisFor(estateAdmin));
    const latest = brief.summary.estate_health.latest_signal;
    check("E1. the resolved water-pump condition never appears as latest_signal", !latest || latest.title !== "Water pump 2 recovered");
    const projection = await adapter.buildAmbientAwarenessProjection(estateAdmin, oisFor(estateAdmin), "executive");
    check("E2. the resolved incident is excluded from the executive projection's attention items", !projection.attentionItems.some((i) => i.incidentId === "inc-water-pump"));
  }

  console.log("\n=== F. Empty: truthful no-current-attention result, no legacy fallback merely for emptiness ===");
  {
    supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({ operational_awareness: [], operational_incidents: [], facility_cameras: [] }).from;
    const brief = await executive.getExecutiveBrief(estateAdmin, oisFor(estateAdmin));
    check("F1. empty canonical result -> canonical_status 'complete', not 'unavailable'", brief.canonical_status === "complete");
    check("F2. empty canonical result -> legacy_fallback_used stays false", brief.legacy_fallback_used === false);
    check("F3. estate_health.attention_events is honestly 0, not fabricated", brief.summary.estate_health.attention_events === 0);
    check("F4. estate_health.latest_signal is honestly null, not fabricated", brief.summary.estate_health.latest_signal === null);
    seedFixtures();
  }

  console.log("\n=== G. Canonical failure: explicit fallback/unavailable behavior ===");
  // Wave 6 Slice 10B -- a no-verified-estate actor is an AUTHORITY failure,
  // not an availability failure: it now fails closed (never falls back to
  // the legacy engine), matching GET /oyi/awareness's Slice 8 precedent.
  // G2/G3 updated accordingly; this scenario's ambient fields also degrade
  // to an honest empty state rather than the legacy engine's output.
  {
    const brief = await executive.getExecutiveBrief(noEstateExecutive, oisFor(noEstateExecutive));
    check("G1. actor with no verified estate -> canonical_status 'unavailable'", brief.canonical_status === "unavailable");
    check("G2. authority failure fails closed -- legacy_fallback_used stays false", brief.legacy_fallback_used === false);
    check("G3. fallback_reason is the authority-specific \"scope_unverified\", not a generic coverage gap", brief.fallback_reason === "scope_unverified");
    check("G4. the brief still returns ok:true (degrades to an honest empty ambient state, does not error out)", brief.ok === true);
  }

  console.log("\n=== Executive authority gate unchanged ===");
  {
    const resident = { id: "resident-a", role: "resident", estate_id: ESTATE_X, home_id: HOME_A, permissions: [] };
    const denied = await executive.getExecutiveBrief(resident, oisFor(resident));
    check("resident role is still denied executive brief access (pre-existing canViewExecutive gate untouched)", denied.ok === false && denied.error === "Executive brief requires management access");
  }

  console.log("\n=== Predictions/workflows/business counts untouched (not converted to awareness) ===");
  {
    const briefSrc = fs.readFileSync(path.join(backendRoot, "dist/intelligence-core/executive.js"), "utf8");
    check("summarizePredictions still wired (predictions remain PREDICTION, not awareness)", briefSrc.includes("summarizePredictions"));
    check("getWorkflowSummary still wired (workflows remain WORKFLOW, not awareness)", briefSrc.includes("getWorkflowSummary"));
    check("getAgentObservabilitySummary still wired (agent_health remains OBSERVABILITY)", briefSrc.includes("getAgentObservabilitySummary"));
    const brief = await executive.getExecutiveBrief(estateAdmin, oisFor(estateAdmin));
    check("lead_activity/sales_activity fields still present (Office/CRM business counts preserved, out of this slice's scope)", "lead_activity" in brief.summary && "sales_activity" in brief.summary);
  }

  console.log("\n=== No double truth: brief's canonical projection matches Facility/Consumer's for the same actor ===");
  {
    const executiveProjection = await adapter.buildAmbientAwarenessProjection(estateAdmin, oisFor(estateAdmin), "executive");
    const facilityProjection = await adapter.buildAmbientAwarenessProjection(estateAdmin, oisFor(estateAdmin), "facility");
    const execIds = executiveProjection.attentionItems.map((i) => i.incidentId).sort();
    const facilityIds = facilityProjection.attentionItems.map((i) => i.incidentId).sort();
    check("same actor/scope: executive and facility projections carry the identical authorized item SET", JSON.stringify(execIds) === JSON.stringify(facilityIds));
  }

  console.log("\n=== Performance: canonical projection is batched, not N+1 (query count flat as item count grows) ===");
  {
    // The brief's total .from() count includes the pre-existing legacy
    // pipeline (events/predictions/workflows/observability), which this
    // slice does not touch. What this slice must prove is that the NEW
    // canonical-projection portion does not grow per-item: compare total
    // query count at the baseline fixture size against a 5x-larger
    // awareness/incident set for the same actor. A batched implementation
    // (listActiveAwareness's own batch-fetch, not one query per row)
    // produces an identical call count at both scales; an N+1
    // implementation would grow with the item count.
    const counterSmall = { calls: 0 };
    supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({ operational_awareness: awareness, operational_incidents: incidents, facility_cameras: cameras }, counterSmall).from;
    await executive.getExecutiveBrief(estateAdmin, oisFor(estateAdmin));

    const bigAwareness = [];
    const bigIncidents = [];
    for (let i = 0; i < 5; i += 1) {
      for (const inc of incidents) {
        bigIncidents.push({ ...inc, id: `${inc.id}-dup${i}`, incident_key: `${inc.incident_key}-dup${i}` });
      }
      for (const aw of awareness) {
        bigAwareness.push({ ...aw, id: `${aw.id}-dup${i}`, incident_id: `${aw.incident_id}-dup${i}` });
      }
    }
    const counterBig = { calls: 0 };
    supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({ operational_awareness: bigAwareness, operational_incidents: bigIncidents, facility_cameras: cameras }, counterBig).from;
    await executive.getExecutiveBrief(estateAdmin, oisFor(estateAdmin));

    check(`query count stays flat as item count grows 5x (baseline ${counterSmall.calls} calls, scaled ${counterBig.calls} calls -- no N+1)`, counterBig.calls === counterSmall.calls);
    seedFixtures();
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE SCRIPT CRASHED:", err);
  process.exit(1);
});
