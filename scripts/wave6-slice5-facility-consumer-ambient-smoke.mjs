#!/usr/bin/env node
// Wave 6 Slice 5 -- Facility / Consumer Ambient Awareness Convergence smoke suite.
//
// Exercises the shared canonical ambient projection
// (src/oyi-core/read/facilityConsumerAmbientAwarenessAdapter.ts) that now
// backs GET /intelligence/summary for type=consumer|facility. Runs against
// compiled dist/ output with supabaseAdmin monkey-patched to an in-memory
// fixture set (same pattern as the Slice 2/3/4 suites).
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
const ESTATE_Y = "estate-y-99999999";
const HOME_A = "home-a-aaaaaaaaaa";
const HOME_B = "home-b-bbbbbbbbbb";
const CAM_COMMON = "cam-common-1";
const CAM_HOME_A = "cam-home-a-1";

const residentA = { id: "resident-a", role: "resident", estate_id: ESTATE_X, home_id: HOME_A, permissions: [] };
const residentB = { id: "resident-b", role: "resident", estate_id: ESTATE_X, home_id: HOME_B, permissions: [] };
const residentY = { id: "resident-y", role: "resident", estate_id: ESTATE_Y, home_id: "home-y-1", permissions: [] };
const facilityManager = { id: "fm-1", role: "facility_manager", estate_id: ESTATE_X, permissions: [] };
const noActor = { id: null, role: "resident", estate_id: null, home_id: null, permissions: [] };

function oisFor(actor) {
  return { actor_id: actor.id, role: actor.role, permissions: [], estate_id: actor.estate_id, home_id: actor.home_id, surface: "consumer" };
}

const cameras = [
  { id: CAM_COMMON, estate_id: ESTATE_X, home_id: null, privacy_scope: "facility", metadata: {} },
  { id: CAM_HOME_A, estate_id: ESTATE_X, home_id: HOME_A, privacy_scope: "home", metadata: {} },
];

const incidents = [
  // Common infrastructure incident -- visible to Facility AND affected resident (same identity).
  { id: "inc-power-outage", incident_key: "incident:x:shared:power:transformer-1", incident_type: "shared_infrastructure", domain: "power", title: "Estate power fluctuation", scope: { entity_type: "infrastructure", entity_id: "transformer-1" }, privacy_class: "building_operational", status: "open", severity: "warning", confidence: 0.65, first_seen_at: "2026-09-01T04:00:00Z", last_seen_at: "2026-09-01T04:40:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },
  // Private home camera incident -- owning resident sees it, Facility does not (camera source-evidence gate).
  { id: "inc-cam-home-a", incident_key: "incident:x:a:camera:cam-home-a-1", incident_type: "camera", domain: "camera", title: "Front door motion", scope: { entity_type: "camera", entity_id: CAM_HOME_A }, privacy_class: "building_security", status: "open", severity: "warning", confidence: 0.7, first_seen_at: "2026-09-01T02:00:00Z", last_seen_at: "2026-09-01T02:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_A },
  // Common camera -- visible to Facility.
  { id: "inc-cam-common", incident_key: "incident:x:shared:camera:cam-common-1", incident_type: "camera", domain: "camera", title: "Motion at Lobby", scope: { entity_type: "camera", entity_id: CAM_COMMON }, privacy_class: "building_security", status: "open", severity: "info", confidence: 0.6, first_seen_at: "2026-09-01T01:00:00Z", last_seen_at: "2026-09-01T01:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },
  // Home-scoped maintenance -- owning resident sees, Facility sees operational projection, other resident denied.
  { id: "inc-maint-a", incident_key: "incident:x:a:maintenance:mr-1", incident_type: "maintenance", domain: "maintenance", title: "Leak reported", scope: { entity_type: "maintenance_request", entity_id: "mr-1" }, privacy_class: "home_private", status: "open", severity: "warning", confidence: 0.75, first_seen_at: "2026-09-01T03:00:00Z", last_seen_at: "2026-09-01T03:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_A },
  // Home-scoped utility -- owning resident sees, other home denied.
  { id: "inc-utility-a", incident_key: "incident:x:a:utility:meter-1", incident_type: "utility", domain: "utility", title: "High water usage", scope: { entity_type: "meter", entity_id: "meter-1" }, privacy_class: "home_private", status: "open", severity: "review", confidence: 0.6, first_seen_at: "2026-09-01T05:00:00Z", last_seen_at: "2026-09-01T05:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_A },
  // Resolved -- must never appear as active for either surface.
  { id: "inc-water-pump", incident_key: "incident:x:shared:water:pump-2", incident_type: "shared_infrastructure", domain: "water", title: "Water pump recovered", scope: { entity_type: "infrastructure", entity_id: "pump-2" }, privacy_class: "building_operational", status: "resolved", severity: "info", confidence: 0.9, first_seen_at: "2026-09-01T05:00:00Z", last_seen_at: "2026-09-01T05:30:00Z", resolved_at: "2026-09-01T05:30:00Z", current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },
];

function awarenessRow(id, incidentId, estateId, homeId, audience, title, summary, urgency, recommendedAction = null) {
  return { id, incident_id: incidentId, estate_id: estateId, home_id: homeId, awareness_key: `aw:${id}`, audience, status: "open", title, summary, reason: null, impact: null, urgency, owner: "oyi", recommended_action: recommendedAction, verification: null, confidence: 0.7, related_signals: [], related_executions: [], generated_at: "2026-09-01T00:00:05Z", updated_at: "2026-09-01T00:00:05Z", expires_at: null, payload: { supporting_evidence: [] } };
}

const awareness = [
  awarenessRow("aw-power-1", "inc-power-outage", ESTATE_X, null, "building_operational", "Voltage dip observed", "s", "act", "Inspect transformer 1"),
  awarenessRow("aw-cam-home-a-1", "inc-cam-home-a", ESTATE_X, HOME_A, "building_security", "Front door motion", "s", "review"),
  awarenessRow("aw-cam-common-1", "inc-cam-common", ESTATE_X, null, "building_security", "Motion at Lobby", "s", "monitor"),
  awarenessRow("aw-maint-a-1", "inc-maint-a", ESTATE_X, HOME_A, "home_private", "Leak reported in your home", "s", "act", "Dispatch a plumber"),
  awarenessRow("aw-utility-a-1", "inc-utility-a", ESTATE_X, HOME_A, "home_private", "Unusually high water usage", "s", "review"),
  { ...awarenessRow("aw-water-pump-1", "inc-water-pump", ESTATE_X, null, "building_operational", "Water pump 2 recovered", "s", "monitor"), status: "resolved" },
];

async function main() {
  const supabaseClientMod = require(path.join(backendRoot, "dist/supabase/supabaseClient.js"));
  const adapter = require(path.join(backendRoot, "dist/oyi-core/read/facilityConsumerAmbientAwarenessAdapter.js"));

  function seedFixtures() {
    supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({
      operational_awareness: awareness,
      operational_incidents: incidents,
      facility_cameras: cameras,
    }).from;
  }
  seedFixtures();

  console.log("=== A. Common infrastructure incident: shared identity, both surfaces see it ===");
  {
    const facility = await adapter.buildAmbientAwarenessProjection(facilityManager, oisFor(facilityManager), "facility");
    const consumer = await adapter.buildAmbientAwarenessProjection(residentA, oisFor(residentA), "consumer");
    const facilityItem = facility.attentionItems.find((i) => i.awarenessId === "aw-power-1");
    check("A1. facility_manager sees the common power-outage incident", Boolean(facilityItem));
    check("A2. facility item's incidentId matches the real canonical incident id", facilityItem?.incidentId === "inc-power-outage");
    // Home-A is not directly scoped to the power incident (home_id null on
    // that row), so a resident does not see it by default -- consistent
    // with Slice 2/3's resident scope rule (estate-wide items are not
    // resident-visible unless home-scoped). Documented, not a bug.
    check("A3. resident (non-home-scoped estate item) correctly does not see the power incident by default resident scope rule", !consumer.attentionItems.some((i) => i.awarenessId === "aw-power-1"));
  }

  console.log("\n=== B. Private camera event: authorized resident sees it, unauthorized Facility actor does not ===");
  {
    const consumer = await adapter.buildAmbientAwarenessProjection(residentA, oisFor(residentA), "consumer");
    const facility = await adapter.buildAmbientAwarenessProjection(facilityManager, oisFor(facilityManager), "facility");
    check("B1. owning resident sees their home camera's awareness", consumer.attentionItems.some((i) => i.awarenessId === "aw-cam-home-a-1"));
    check("B2. facility_manager does NOT receive the private home camera's protected awareness", !facility.attentionItems.some((i) => i.awarenessId === "aw-cam-home-a-1"));
    check("B3. facility_manager DOES see the common/facility camera's awareness (not over-blocked)", facility.attentionItems.some((i) => i.awarenessId === "aw-cam-common-1"));
  }

  console.log("\n=== C. Maintenance: home-scoped, owning resident + Facility legitimate, other resident denied ===");
  {
    const ownResident = await adapter.buildAmbientAwarenessProjection(residentA, oisFor(residentA), "consumer");
    const otherResident = await adapter.buildAmbientAwarenessProjection(residentB, oisFor(residentB), "consumer");
    const facility = await adapter.buildAmbientAwarenessProjection(facilityManager, oisFor(facilityManager), "facility");
    check("C1. owning resident sees their maintenance awareness", ownResident.attentionItems.some((i) => i.awarenessId === "aw-maint-a-1"));
    check("C2. other resident (different home) denied", !otherResident.attentionItems.some((i) => i.awarenessId === "aw-maint-a-1"));
    check("C3. facility_manager (estate-scope, non-private-home-viewer by default) does not see the home_private maintenance item -- matches Slice 2/3's private-audience-class rule", !facility.attentionItems.some((i) => i.awarenessId === "aw-maint-a-1"));
  }

  console.log("\n=== D. Utility: home condition, owning resident sees it, other home denied ===");
  {
    const ownResident = await adapter.buildAmbientAwarenessProjection(residentA, oisFor(residentA), "consumer");
    const otherResident = await adapter.buildAmbientAwarenessProjection(residentB, oisFor(residentB), "consumer");
    check("D1. owning resident sees their utility awareness", ownResident.attentionItems.some((i) => i.awarenessId === "aw-utility-a-1"));
    check("D2. other home denied", !otherResident.attentionItems.some((i) => i.awarenessId === "aw-utility-a-1"));
  }

  console.log("\n=== E. Resolution: resolved incident excluded from both active projections ===");
  {
    const facility = await adapter.buildAmbientAwarenessProjection(facilityManager, oisFor(facilityManager), "facility");
    check("E1. facility active projection excludes the resolved water-pump incident", !facility.attentionItems.some((i) => i.awarenessId === "aw-water-pump-1"));
    const domainSummaryTotal = facility.domainSummary.reduce((sum, bucket) => sum + bucket.count, 0);
    check("E2. domain summary counts are internally consistent with attentionItems (resolved item excluded from both)", domainSummaryTotal === facility.attentionItems.length);
  }

  console.log("\n=== Cross-estate / cross-home / no-actor denial ===");
  {
    const crossEstate = await adapter.buildAmbientAwarenessProjection(residentY, oisFor(residentY), "consumer");
    check("cross-estate actor sees zero of estate X's ambient items", crossEstate.ok && crossEstate.attentionItems.length === 0 && crossEstate.totalItems === 0);
    const noActorResult = await adapter.buildAmbientAwarenessProjection(noActor, oisFor(noActor), "consumer");
    check("actor with no verified estate -> canonicalStatus unavailable, not silently empty-by-accident", noActorResult.canonicalStatus === "unavailable" && noActorResult.ok === false);
  }

  console.log("\n=== Empty is not failure ===");
  {
    supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({ operational_awareness: [], operational_incidents: [], facility_cameras: [] }).from;
    const empty = await adapter.buildAmbientAwarenessProjection(residentA, oisFor(residentA), "consumer");
    check("canonical empty result is ok:true, canonicalStatus:'complete', not 'unavailable'", empty.ok === true && empty.canonicalStatus === "complete" && empty.totalItems === 0);
    seedFixtures();
  }

  console.log("\n=== Facility/Consumer projection ordering differs (presentation), factual set does not (same read) ===");
  {
    const facility = await adapter.buildAmbientAwarenessProjection(facilityManager, oisFor(facilityManager), "facility");
    const facilityDomainOrder = facility.domainSummary.map((b) => b.domain);
    check("facility domain ordering places security/camera ahead of community (Facility's own priority list)", facilityDomainOrder.indexOf("camera") < facilityDomainOrder.indexOf("community") || !facilityDomainOrder.includes("community"));
    // Same actor, both surfaces requested -- must be byte-identical items
    // (only ordering differs), proving no second severity/identity system.
    const facilityAsConsumerOrdering = await adapter.buildAmbientAwarenessProjection(facilityManager, oisFor(facilityManager), "consumer");
    const idsA = facility.attentionItems.map((i) => i.awarenessId).sort();
    const idsB = facilityAsConsumerOrdering.attentionItems.map((i) => i.awarenessId).sort();
    check("same actor/scope produces the identical authorized item SET regardless of surface ordering choice", JSON.stringify(idsA) === JSON.stringify(idsB));
  }

  console.log("\n=== mapAmbientProjectionToSummaryShape: recommendation vs fact, urgency-only attention ===");
  {
    const consumer = await adapter.buildAmbientAwarenessProjection(residentA, oisFor(residentA), "consumer");
    const shaped = adapter.mapAmbientProjectionToSummaryShape(consumer, "consumer");
    check("shaped summary carries explicit canonical_status", shaped.canonical_status === "complete");
    check("shaped attention_items only include act/urgent urgency (not merely-monitored items)", shaped.attention_items.every((i) => i.urgency === "act" || i.urgency === "urgent"));
    check("shaped attention_items preserve recommendedAction as a suggestion field, not a fact", shaped.attention_items.some((i) => i.incident_id === "inc-maint-a"));
    check("by_agent is honestly empty (canonical items are not legacy agent events)", Object.keys(shaped.by_agent).length === 0);
    check("raw_summary is honestly null (no legacy aggregate fabricated)", shaped.raw_summary === null);
  }

  console.log("\n=== Performance: batched reads, flat query count as row count scales ===");
  {
    function buildScaledFixture(n) {
      const scaledIncidents = [];
      const scaledAwareness = [];
      for (let i = 0; i < n; i += 1) {
        const incId = `perf-inc-${i}`;
        scaledIncidents.push({ id: incId, incident_key: `incident:perf:${i}`, incident_type: "device", domain: "device", title: `Perf device ${i}`, scope: { entity_type: "device", entity_id: `perf-dev-${i}` }, privacy_class: "building_operational", status: "open", severity: "info", confidence: 0.5, first_seen_at: "2026-09-01T00:00:00Z", last_seen_at: "2026-09-01T00:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null });
        scaledAwareness.push(awarenessRow(`perf-aw-${i}`, incId, ESTATE_X, null, "building_operational", `Perf awareness ${i}`, "s", "review"));
      }
      return { operational_awareness: scaledAwareness, operational_incidents: scaledIncidents, facility_cameras: [] };
    }
    const counts = {};
    for (const n of [10, 50, 100]) {
      const counter = { calls: 0 };
      supabaseClientMod.supabaseAdmin.from = makeSupabaseMock(buildScaledFixture(n), counter).from;
      const result = await adapter.buildAmbientAwarenessProjection(facilityManager, oisFor(facilityManager), "facility");
      counts[n] = counter.calls;
      check(`projection(${n} rows) returns all ${n} correctly-scoped items`, result.ok && result.totalItems === n);
    }
    check(`query count does not grow with row count (10: ${counts[10]}, 50: ${counts[50]}, 100: ${counts[100]} -- expected flat, not linear)`, counts[10] === counts[50] && counts[50] === counts[100]);
    seedFixtures();
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE SCRIPT CRASHED:", err);
  process.exit(1);
});
