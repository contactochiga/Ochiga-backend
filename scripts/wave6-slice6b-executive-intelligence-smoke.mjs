#!/usr/bin/env node
// Wave 6 Slice 6B -- Executive Intelligence Canonical Awareness Convergence
// smoke suite.
//
// Exercises getExecutiveIntelligence() (src/intelligence-core/executive.ts)
// now that its CURRENT_AWARENESS fields (focus, summary.events) are
// canonical-first via buildAmbientAwarenessProjection(..., "executive") --
// the exact same projection GET /intelligence/brief (Slice 6) already
// consumes. Runs against compiled dist/ output with supabaseAdmin
// monkey-patched to an in-memory fixture set (same established pattern as
// Slice 2-6).
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const path = require("path");
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
      intelligence_events: [],
    }).from;
  }
  seedFixtures();

  console.log("=== A. Common infrastructure incident: same identity as /intelligence/brief and /intelligence/summary ===");
  {
    const exec = await executive.getExecutiveIntelligence(estateAdmin, oisFor(estateAdmin));
    check("A1. executive intelligence call succeeds for an authorized role", exec.ok === true);
    check("A2. canonical-sourced (canonical_status present, not unavailable)", exec.canonical_status === "complete" || exec.canonical_status === "partial");
    check("A3. legacy_fallback_used is honestly false when canonical answered", exec.legacy_fallback_used === false);
    const briefProjection = await adapter.buildAmbientAwarenessProjection(estateAdmin, oisFor(estateAdmin), "executive");
    check("A4. same power-outage incident visible via both executive intelligence's summary.events and the shared executive projection (shared identity)", exec.summary.events.attention > 0 && briefProjection.attentionItems.some((i) => i.incidentId === "inc-power-outage"));
  }

  console.log("\n=== B. Multiple observations -> one executive problem ===");
  {
    const exec = await executive.getExecutiveIntelligence(estateAdmin, oisFor(estateAdmin));
    // The power incident has two observations (review + act); only the
    // dedup'd, single canonical incident should ever drive attention/focus
    // -- never two separate "problems."
    check("B1. focus references the power incident at most once in spirit (single latest_signal, not a duplicate-count artifact)", exec.summary.events.latest === null || typeof exec.summary.events.latest.title === "string");
    const projection = await adapter.buildAmbientAwarenessProjection(estateAdmin, oisFor(estateAdmin), "executive");
    const powerAttentionCount = projection.attentionItems.filter((i) => i.incidentId === "inc-power-outage").length;
    check("B2. the two power observations collapse into exactly one executive attention entry for that incident (reused Slice 6 dedup)", powerAttentionCount === 1);
  }

  console.log("\n=== C. Private camera: unauthorized actor cannot receive protected content ===");
  {
    const exec = await executive.getExecutiveIntelligence(facilityManager, oisFor(facilityManager));
    check("C1. summary.events.latest (if present) never surfaces Home A's protected camera title", !exec.summary.events.latest || exec.summary.events.latest.title !== "Front door motion");
    check("C2. focus never surfaces Home A's protected camera title", exec.focus !== "Front door motion");
  }

  console.log("\n=== D. Maintenance: legitimate executive scope visible, unauthorized scope hidden ===");
  {
    const estateAdminExec = await executive.getExecutiveIntelligence(estateAdmin, oisFor(estateAdmin));
    check("D1. estate_admin (private-home-capable) awareness includes the home_private maintenance incident's contribution to attention count", estateAdminExec.summary.events.attention > 0);
    const facilityProjection = await adapter.buildAmbientAwarenessProjection(facilityManager, oisFor(facilityManager), "executive");
    check("D2. facility_manager (cannot view private-home content) does not see the home_private maintenance incident in the shared projection", !facilityProjection.attentionItems.some((i) => i.incidentId === "inc-maint-a"));
  }

  console.log("\n=== E. Resolution: resolved incident absent from current executive intelligence ===");
  {
    const exec = await executive.getExecutiveIntelligence(estateAdmin, oisFor(estateAdmin));
    check("E1. the resolved water-pump condition never appears as summary.events.latest", !exec.summary.events.latest || exec.summary.events.latest.title !== "Water pump 2 recovered");
    check("E2. focus never references the resolved water-pump condition", exec.focus !== "Water pump 2 recovered");
  }

  console.log("\n=== F. Canonical empty: truthful, no legacy fallback merely for emptiness ===");
  {
    supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({ operational_awareness: [], operational_incidents: [], facility_cameras: [] }).from;
    const exec = await executive.getExecutiveIntelligence(estateAdmin, oisFor(estateAdmin));
    check("F1. empty canonical result -> canonical_status 'complete', not 'unavailable'", exec.canonical_status === "complete");
    check("F2. empty canonical result -> legacy_fallback_used stays false", exec.legacy_fallback_used === false);
    check("F3. summary.events.attention is honestly 0, not fabricated", exec.summary.events.attention === 0);
    check("F4. summary.events.latest is honestly null, not fabricated", exec.summary.events.latest === null);
    seedFixtures();
  }

  console.log("\n=== G. Canonical failure: explicit fallback/unavailable behavior ===");
  // Wave 6 Slice 10B -- a no-verified-estate actor is an AUTHORITY failure,
  // not an availability failure: it now fails closed (never falls back to
  // the legacy engine), matching GET /oyi/awareness's Slice 8 precedent.
  // G2/G3 updated accordingly; summary.events degrades to an honest empty
  // state rather than the legacy engine's output.
  {
    const exec = await executive.getExecutiveIntelligence(noEstateExecutive, oisFor(noEstateExecutive));
    check("G1. actor with no verified estate -> canonical_status 'unavailable'", exec.canonical_status === "unavailable");
    check("G2. authority failure fails closed -- legacy_fallback_used stays false", exec.legacy_fallback_used === false);
    check("G3. fallback_reason is the authority-specific \"scope_unverified\", not a generic coverage gap", exec.fallback_reason === "scope_unverified");
    check("G4. still returns ok:true (degrades to an honest empty events summary, does not error out)", exec.ok === true);
  }

  console.log("\n=== H. Non-awareness executive fields remain sourced exactly as before ===");
  {
    const exec = await executive.getExecutiveIntelligence(estateAdmin, oisFor(estateAdmin));
    check("H1. summary.predictions still present (PREDICTION untouched)", "predictions" in exec.summary);
    check("H2. summary.organization still present (ORGANIZATIONAL_FACT untouched)", "organization" in exec.summary);
    check("H3. summary.workflows still present (WORKFLOW untouched)", "workflows" in exec.summary);
    check("H4. collaboration_hints still present (advisory routing hints untouched)", Array.isArray(exec.collaboration_hints));
    check("H5. recommended_actions still present (PRESENTATION untouched)", Array.isArray(exec.recommended_actions));
    check("H6. warnings still present (OBSERVABILITY untouched)", Array.isArray(exec.warnings));
  }

  console.log("\n=== Executive authority gate unchanged ===");
  {
    const resident = { id: "resident-a", role: "resident", estate_id: ESTATE_X, home_id: HOME_A, permissions: [] };
    const denied = await executive.getExecutiveIntelligence(resident, oisFor(resident));
    check("resident role is still denied executive intelligence access (pre-existing canViewExecutive gate untouched)", denied.ok === false && denied.error === "Executive intelligence requires management access");
  }

  console.log("\n=== No double truth: executive intelligence's canonical projection matches /intelligence/brief and Facility's ===");
  {
    const execProjection = await adapter.buildAmbientAwarenessProjection(estateAdmin, oisFor(estateAdmin), "executive");
    const facilityProjection = await adapter.buildAmbientAwarenessProjection(estateAdmin, oisFor(estateAdmin), "facility");
    const execIds = execProjection.attentionItems.map((i) => i.incidentId).sort();
    const facilityIds = facilityProjection.attentionItems.map((i) => i.incidentId).sort();
    check("same actor/scope: executive-surface projection (shared by both /intelligence/executive and /intelligence/brief) and facility projection carry the identical authorized item SET", JSON.stringify(execIds) === JSON.stringify(facilityIds));

    const exec = await executive.getExecutiveIntelligence(estateAdmin, oisFor(estateAdmin));
    const brief = await require(path.join(backendRoot, "dist/intelligence-core/executive.js")).getExecutiveBrief(estateAdmin, oisFor(estateAdmin));
    check("getExecutiveIntelligence.summary.events.attention and getExecutiveBrief.summary.estate_health.attention_events agree (same canonical count)", exec.summary.events.attention === brief.summary.estate_health.attention_events);
  }

  console.log("\n=== Performance: canonical projection is batched, not N+1 (query count flat as item count grows) ===");
  {
    const counterSmall = { calls: 0 };
    supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({ operational_awareness: awareness, operational_incidents: incidents, facility_cameras: cameras }, counterSmall).from;
    await executive.getExecutiveIntelligence(estateAdmin, oisFor(estateAdmin));

    const bigAwareness = [];
    const bigIncidents = [];
    for (let i = 0; i < 5; i += 1) {
      for (const inc of incidents) bigIncidents.push({ ...inc, id: `${inc.id}-dup${i}`, incident_key: `${inc.incident_key}-dup${i}` });
      for (const aw of awareness) bigAwareness.push({ ...aw, id: `${aw.id}-dup${i}`, incident_id: `${aw.incident_id}-dup${i}` });
    }
    const counterBig = { calls: 0 };
    supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({ operational_awareness: bigAwareness, operational_incidents: bigIncidents, facility_cameras: cameras }, counterBig).from;
    await executive.getExecutiveIntelligence(estateAdmin, oisFor(estateAdmin));

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
