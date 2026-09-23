#!/usr/bin/env node
// Wave 6 Slice 2 -- Canonical Awareness Read Path adversarial + E2E smoke suite.
//
// Runs against the compiled dist/ output of
// src/oyi-core/read/canonicalAwarenessReadService.ts, with supabaseAdmin
// monkey-patched to an in-memory fixture set standing in for the canonical
// operational_* tables. Exercises: the 5 mandated E2E lifecycles (A-E), the
// role x domain x scope matrix, cross-estate/cross-home denial, the camera
// source-evidence gate acting independently of the privacy-class gate,
// resolved/suppressed status-lifecycle exclusion, the honest
// incident-id-less coverage-gap accounting, evidence reference-vs-content
// shape, and execution-reference pass-through without success inference.
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
const CAM_HOME_B = "cam-home-b-1";

const residentA = { id: "resident-a", role: "resident", estate_id: ESTATE_X, home_id: HOME_A, permissions: [] };
const residentB = { id: "resident-b", role: "resident", estate_id: ESTATE_X, home_id: HOME_B, permissions: [] };
const residentY = { id: "resident-y", role: "resident", estate_id: ESTATE_Y, home_id: "home-y-1", permissions: [] };
const facilityManager = { id: "fm-1", role: "facility_manager", estate_id: ESTATE_X, permissions: [] };
const securityOperator = { id: "sec-1", role: "security_operator", estate_id: ESTATE_X, permissions: [] };
const maintenanceOperator = { id: "maint-1", role: "maintenance_operator", estate_id: ESTATE_X, permissions: [] };
const estateAdmin = { id: "admin-1", role: "estate_admin", estate_id: ESTATE_X, permissions: [] };
const noEstateActor = { id: "ghost-1", role: "resident", estate_id: null, home_id: null, permissions: [] };

function oisFor(actor) {
  return { actor_id: actor.id, role: actor.role, permissions: [], estate_id: actor.estate_id, home_id: actor.home_id, surface: "consumer" };
}

const cameras = [
  { id: CAM_COMMON, estate_id: ESTATE_X, home_id: null, privacy_scope: "facility", metadata: {} },
  { id: CAM_HOME_A, estate_id: ESTATE_X, home_id: HOME_A, privacy_scope: "home", metadata: {} },
  { id: CAM_HOME_B, estate_id: ESTATE_X, home_id: HOME_B, privacy_scope: "home", metadata: {} },
];

const incidents = [
  // Scenario A: device/infrastructure signal -> awareness -> correct actor sees it, wrong-home resident denied.
  { id: "inc-device-a", incident_key: "incident:x:a:device:dev-1", incident_type: "device", domain: "device", title: "Device Offline", scope: { entity_type: "device", entity_id: "dev-1" }, privacy_class: "resident_device_private", status: "open", severity: "warning", confidence: 0.8, first_seen_at: "2026-09-01T00:00:00Z", last_seen_at: "2026-09-01T00:00:00Z", resolved_at: null, current_summary: "Device dev-1 went offline.", affected_entities: [{ type: "device", id: "dev-1" }], evidence: [{ id: "sig-1", type: "device_status", source: "operational_signals", timestamp: "2026-09-01T00:00:00Z", summary: "raw protected summary" }], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_A },

  // Scenario B: camera signal (common/facility camera) -> awareness -> authorized facility actor sees it.
  { id: "inc-cam-common", incident_key: "incident:x:shared:camera:cam-common-1", incident_type: "camera", domain: "camera", title: "Motion at Lobby", scope: { entity_type: "camera", entity_id: CAM_COMMON }, privacy_class: "building_security", status: "open", severity: "info", confidence: 0.6, first_seen_at: "2026-09-01T01:00:00Z", last_seen_at: "2026-09-01T01:00:00Z", resolved_at: null, current_summary: "Motion detected at lobby camera.", affected_entities: [{ type: "camera", id: CAM_COMMON }], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },

  // Scenario B: camera signal (home-B camera) with a NON-private audience class, proving the camera
  // source-evidence gate blocks facility_manager independently of the privacy_class gate.
  { id: "inc-cam-home-b", incident_key: "incident:x:b:camera:cam-home-b-1", incident_type: "camera", domain: "camera", title: "Side gate anomaly", scope: { entity_type: "camera", entity_id: CAM_HOME_B }, privacy_class: "building_security", status: "open", severity: "warning", confidence: 0.7, first_seen_at: "2026-09-01T02:00:00Z", last_seen_at: "2026-09-01T02:00:00Z", resolved_at: null, current_summary: "Anomaly at Home B's gate camera.", affected_entities: [{ type: "camera", id: CAM_HOME_B }], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_B },

  // Scenario C: maintenance signal -> awareness/incident -> authorized scope read, cross-home resident denied.
  { id: "inc-maint-a", incident_key: "incident:x:a:maintenance:mr-1", incident_type: "maintenance", domain: "maintenance", title: "Leak reported", scope: { entity_type: "maintenance_request", entity_id: "mr-1" }, privacy_class: "home_private", status: "open", severity: "warning", confidence: 0.75, first_seen_at: "2026-09-01T03:00:00Z", last_seen_at: "2026-09-01T03:00:00Z", resolved_at: null, current_summary: "Water leak reported in Home A.", affected_entities: [{ type: "maintenance_request", id: "mr-1" }], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_A },

  // Scenario D: multiple related observations correlated into one incident.
  { id: "inc-power-outage", incident_key: "incident:x:shared:power:transformer-1", incident_type: "shared_infrastructure", domain: "power", title: "Estate power fluctuation", scope: { entity_type: "infrastructure", entity_id: "transformer-1" }, privacy_class: "building_operational", status: "monitoring", severity: "warning", confidence: 0.65, first_seen_at: "2026-09-01T04:00:00Z", last_seen_at: "2026-09-01T04:40:00Z", resolved_at: null, current_summary: "Recurring voltage dips across the estate.", affected_entities: [{ type: "infrastructure", id: "transformer-1" }], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },

  // Scenario E: recovery/resolution lifecycle.
  { id: "inc-water-pump", incident_key: "incident:x:shared:water:pump-2", incident_type: "shared_infrastructure", domain: "water", title: "Water pump recovered", scope: { entity_type: "infrastructure", entity_id: "pump-2" }, privacy_class: "building_operational", status: "resolved", severity: "info", confidence: 0.9, first_seen_at: "2026-09-01T05:00:00Z", last_seen_at: "2026-09-01T05:30:00Z", resolved_at: "2026-09-01T05:30:00Z", current_summary: "Water pump 2 recovered.", affected_entities: [{ type: "infrastructure", id: "pump-2" }], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },
];

const awareness = [
  { id: "aw-device-a-1", incident_id: "inc-device-a", awareness_key: "aw:device-a:1", audience: "resident_device_private", status: "open", title: "Your device went offline", summary: "dev-1 stopped reporting.", reason: "connectivity_loss", impact: "device_unreachable", urgency: "medium", owner: "oyi", recommended_action: "check_power", verification: "unverified", confidence: 0.8, related_signals: ["sig-1"], related_executions: ["exec-1"], generated_at: "2026-09-01T00:00:05Z", updated_at: "2026-09-01T00:00:05Z", expires_at: "2099-01-01T00:00:00Z", payload: { id: "aw:device-a:1", supporting_evidence: [{ id: "sig-1", type: "device_status", source: "operational_signals", timestamp: "2026-09-01T00:00:00Z", summary: "raw protected summary text", uri: "internal://signal/sig-1" }], executionReference: "exec-2", related_signals: ["sig-1"], related_executions: ["exec-1"] } },

  { id: "aw-cam-common-1", incident_id: "inc-cam-common", awareness_key: "aw:cam-common:1", audience: "building_security", status: "open", title: "Motion at Lobby", summary: "Motion detected at the lobby camera.", reason: "motion_detected", impact: "none", urgency: "low", owner: "oyi", recommended_action: "review_footage", verification: "unverified", confidence: 0.6, related_signals: ["sig-2"], related_executions: [], generated_at: "2026-09-01T01:00:05Z", updated_at: "2026-09-01T01:00:05Z", expires_at: null, payload: { id: "aw:cam-common:1", supporting_evidence: [], related_signals: ["sig-2"], related_executions: [] } },

  { id: "aw-cam-home-b-1", incident_id: "inc-cam-home-b", awareness_key: "aw:cam-home-b:1", audience: "building_security", status: "open", title: "Side gate anomaly", summary: "Anomaly detected at Home B's gate camera.", reason: "motion_detected", impact: "none", urgency: "medium", owner: "oyi", recommended_action: "review_footage", verification: "unverified", confidence: 0.7, related_signals: ["sig-3"], related_executions: [], generated_at: "2026-09-01T02:00:05Z", updated_at: "2026-09-01T02:00:05Z", expires_at: null, payload: { id: "aw:cam-home-b:1", supporting_evidence: [], related_signals: ["sig-3"], related_executions: [] } },

  { id: "aw-maint-a-1", incident_id: "inc-maint-a", awareness_key: "aw:maint-a:1", audience: "home_private", status: "open", title: "Leak reported in your home", summary: "A water leak was reported in Home A.", reason: "maintenance_request", impact: "water_damage_risk", urgency: "high", owner: "oyi", recommended_action: "dispatch_technician", verification: "unverified", confidence: 0.75, related_signals: ["sig-4"], related_executions: [], generated_at: "2026-09-01T03:00:05Z", updated_at: "2026-09-01T03:00:05Z", expires_at: null, payload: { id: "aw:maint-a:1", supporting_evidence: [], related_signals: ["sig-4"], related_executions: [] } },

  // Three related observations correlated into inc-power-outage.
  { id: "aw-power-1", incident_id: "inc-power-outage", awareness_key: "aw:power:1", audience: "building_operational", status: "open", title: "Voltage dip observed (1)", summary: "First voltage dip observed.", reason: "voltage_dip", impact: "minor", urgency: "low", owner: "oyi", recommended_action: "monitor", verification: "unverified", confidence: 0.5, related_signals: ["sig-5a"], related_executions: [], generated_at: "2026-09-01T04:00:05Z", updated_at: "2026-09-01T04:00:05Z", expires_at: null, payload: { id: "aw:power:1", supporting_evidence: [], related_signals: ["sig-5a"], related_executions: [] } },
  { id: "aw-power-2", incident_id: "inc-power-outage", awareness_key: "aw:power:2", audience: "building_operational", status: "open", title: "Voltage dip observed (2)", summary: "Second voltage dip observed.", reason: "voltage_dip", impact: "minor", urgency: "medium", owner: "oyi", recommended_action: "monitor", verification: "unverified", confidence: 0.6, related_signals: ["sig-5b"], related_executions: [], generated_at: "2026-09-01T04:20:05Z", updated_at: "2026-09-01T04:20:05Z", expires_at: null, payload: { id: "aw:power:2", supporting_evidence: [], related_signals: ["sig-5b"], related_executions: [] } },
  { id: "aw-power-3", incident_id: "inc-power-outage", awareness_key: "aw:power:3", audience: "building_operational", status: "open", title: "Voltage dip observed (3)", summary: "Third voltage dip observed.", reason: "voltage_dip", impact: "moderate", urgency: "medium", owner: "oyi", recommended_action: "inspect_transformer", verification: "unverified", confidence: 0.65, related_signals: ["sig-5c"], related_executions: [], generated_at: "2026-09-01T04:40:05Z", updated_at: "2026-09-01T04:40:05Z", expires_at: null, payload: { id: "aw:power:3", supporting_evidence: [], related_signals: ["sig-5c"], related_executions: [] } },

  // Scenario E: resolved awareness tied to the resolved incident -- must never appear in the default active read.
  { id: "aw-water-pump-1", incident_id: "inc-water-pump", awareness_key: "aw:water-pump:1", audience: "building_operational", status: "resolved", title: "Water pump 2 recovered", summary: "Pump 2 is back online.", reason: "recovered", impact: "none", urgency: "low", owner: "oyi", recommended_action: "none", verification: "unverified", confidence: 0.9, related_signals: ["sig-6"], related_executions: [], generated_at: "2026-09-01T05:30:05Z", updated_at: "2026-09-01T05:30:05Z", expires_at: null, payload: { id: "aw:water-pump:1", supporting_evidence: [], related_signals: ["sig-6"], related_executions: [] } },

  // Suppressed child awareness -- must never appear in the default active read regardless of includeResolved.
  { id: "aw-power-suppressed-1", incident_id: "inc-power-outage", awareness_key: "aw:power:suppressed:1", audience: "building_operational", status: "suppressed", title: "Voltage dip (duplicate)", summary: "Suppressed duplicate of the parent incident.", reason: "voltage_dip", impact: "minor", urgency: "low", owner: "oyi", recommended_action: "none", verification: "unverified", confidence: 0.4, related_signals: ["sig-5d"], related_executions: [], generated_at: "2026-09-01T04:45:05Z", updated_at: "2026-09-01T04:45:05Z", expires_at: null, payload: { id: "aw:power:suppressed:1", supporting_evidence: [], related_signals: ["sig-5d"], related_executions: [] } },

  // Known-gap rows: awareness with no incident_id (correlateIncident() returned null at write time).
  { id: "aw-orphan-1", incident_id: null, awareness_key: "aw:orphan:1", audience: "resident_device_private", status: "open", title: "Command acknowledged", summary: "A device command was acknowledged.", reason: "command_ack", impact: "none", urgency: "low", owner: "oyi", recommended_action: "none", verification: "unverified", confidence: 0.5, related_signals: ["sig-7"], related_executions: [], generated_at: "2026-09-01T06:00:05Z", updated_at: "2026-09-01T06:00:05Z", expires_at: null, payload: { id: "aw:orphan:1", supporting_evidence: [], related_signals: ["sig-7"], related_executions: [] } },
  { id: "aw-orphan-2", incident_id: null, awareness_key: "aw:orphan:2", audience: "resident_device_private", status: "open", title: "Device turned off by resident", summary: "Resident turned the device off.", reason: "user_off", impact: "none", urgency: "low", owner: "oyi", recommended_action: "none", verification: "unverified", confidence: 0.5, related_signals: ["sig-8"], related_executions: [], generated_at: "2026-09-01T06:10:05Z", updated_at: "2026-09-01T06:10:05Z", expires_at: null, payload: { id: "aw:orphan:2", supporting_evidence: [], related_signals: ["sig-8"], related_executions: [] } },
];

const insights = [
  { id: "insight-maint-a-1", incident_id: "inc-maint-a", domain: "maintenance", insight_type: "pattern", title: "Recurring leak pattern", summary: "This is the third leak reported in Home A this quarter.", reason: "trend_detected", impact: "elevated_risk", confidence: 0.7, evidence: [{ id: "sig-4", type: "maintenance_request", source: "operational_signals", timestamp: "2026-09-01T03:00:00Z" }], status: "open", generated_at: "2026-09-01T03:05:00Z" },
];

const recommendations = [
  { id: "rec-maint-a-1", incident_id: "inc-maint-a", recommendation_key: "rec:maint-a:1", action_type: "dispatch_technician", title: "Dispatch a plumber", summary: "Send a plumber to Home A to inspect the reported leak.", reason: "leak_reported", expected_impact: "prevent_water_damage", confidence: 0.75, urgency: "high", risk_class: "review", verification_required: true, approval_required: false, status: "pending", estate_id: ESTATE_X, home_id: HOME_A, privacy_class: "home_private", generated_at: "2026-09-01T03:05:00Z", expires_at: null },
];

const plans = [
  { id: "plan-maint-a-1", recommendation_id: "rec-maint-a-1", plan_type: "manual_dispatch", canonical_operation_id: null, approval_state: "not_required", status: "planned", generated_at: "2026-09-01T03:06:00Z", expires_at: null },
  { id: "plan-orphan-1", recommendation_id: null, plan_type: "manual_dispatch", canonical_operation_id: null, approval_state: "not_required", status: "planned", generated_at: "2026-09-01T03:07:00Z", expires_at: null },
];

async function main() {
  const supabaseClientMod = require(path.join(backendRoot, "dist/supabase/supabaseClient.js"));
  supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({
    operational_awareness: awareness,
    operational_incidents: incidents,
    operational_insights: insights,
    operational_recommendations: recommendations,
    operational_plans: plans,
    facility_cameras: cameras,
  }).from;

  const svc = require(path.join(backendRoot, "dist/oyi-core/read/canonicalAwarenessReadService.js"));

  console.log("=== Scenario A: device/infrastructure -- correct actor sees, wrong-home resident denied ===");
  {
    const own = await svc.listActiveAwareness(residentA, oisFor(residentA));
    check("residentA sees their own device awareness", own.ok && own.items.some((i) => i.awarenessId === "aw-device-a-1"));
    const other = await svc.listActiveAwareness(residentB, oisFor(residentB));
    check("residentB (different home, same estate) does NOT see Home A's device awareness", other.ok && !other.items.some((i) => i.awarenessId === "aw-device-a-1"));
    const denied = await svc.getAwareness(residentB, oisFor(residentB), "aw-device-a-1");
    check("residentB direct getAwareness(aw-device-a-1) is explicitly denied, not silently empty", denied.ok === false && denied.reason === "denied");
  }

  console.log("\n=== Scenario B: camera-derived awareness -- authorized actor sees, source-camera-denied actor does not ===");
  {
    const fmCommon = await svc.getAwareness(facilityManager, oisFor(facilityManager), "aw-cam-common-1");
    check("facility_manager sees common/facility camera awareness", fmCommon.ok && fmCommon.item?.title === "Motion at Lobby");

    const fmHomeB = await svc.getAwareness(facilityManager, oisFor(facilityManager), "aw-cam-home-b-1");
    check("facility_manager is DENIED Home B's camera awareness (camera source-evidence gate, privacy_class alone was not private)", fmHomeB.ok === false && fmHomeB.reason === "denied");

    const residentBHomeCam = await svc.getAwareness(residentB, oisFor(residentB), "aw-cam-home-b-1");
    check("residentB (owner of Home B / the source camera's home) DOES see their own camera awareness", residentBHomeCam.ok && residentBHomeCam.item?.title === "Side gate anomaly");

    const secOpCommon = await svc.getAwareness(securityOperator, oisFor(securityOperator), "aw-cam-common-1");
    check("security_operator is denied the facility camera per the existing (untouched) cameraAccess.policy.ts facilityRole() list", secOpCommon.ok === false);
  }

  console.log("\n=== Scenario C: maintenance -- authorized scope reads, cross-home resident denied ===");
  {
    const ownList = await svc.listActiveAwareness(residentA, oisFor(residentA), { domain: "maintenance" });
    check("residentA sees their own maintenance awareness", ownList.ok && ownList.items.some((i) => i.awarenessId === "aw-maint-a-1"));
    const crossHome = await svc.listActiveAwareness(residentB, oisFor(residentB), { domain: "maintenance" });
    check("residentB does not see Home A's maintenance awareness", crossHome.ok && !crossHome.items.some((i) => i.awarenessId === "aw-maint-a-1"));
    const insightRead = await svc.listInsights(residentA, oisFor(residentA));
    check("residentA sees the maintenance insight tied to their own incident", insightRead.ok && insightRead.items.some((i) => i.insightId === "insight-maint-a-1"));
    const insightDenied = await svc.listInsights(residentB, oisFor(residentB));
    check("residentB does not see Home A's maintenance insight", insightDenied.ok && !insightDenied.items.some((i) => i.insightId === "insight-maint-a-1"));
    const recRead = await svc.listRecommendations(estateAdmin, oisFor(estateAdmin));
    check("estate_admin (can_view_private_home) sees the home_private maintenance recommendation", recRead.ok && recRead.items.some((i) => i.recommendationId === "rec-maint-a-1"));
    const recDenied = await svc.listRecommendations(facilityManager, oisFor(facilityManager));
    check("facility_manager (cannot view private-home content) does NOT see the home_private recommendation", recDenied.ok && !recDenied.items.some((i) => i.recommendationId === "rec-maint-a-1"));
    const planRead = await svc.listPlans(residentA, oisFor(residentA));
    check("residentA sees the plan resolved via their own recommendation's scope", planRead.ok && planRead.items.some((i) => i.planId === "plan-maint-a-1"));
  }

  console.log("\n=== Scenario D: multiple related observations correlated into one incident ===");
  {
    const inc = await svc.getIncident(facilityManager, oisFor(facilityManager), "inc-power-outage");
    check("facility_manager can read the correlated power-outage incident", inc.ok && inc.item?.title === "Estate power fluctuation");
    const forIncident = await svc.listAwarenessForIncident(facilityManager, oisFor(facilityManager), "inc-power-outage");
    const ids = forIncident.items.map((i) => i.awarenessId).sort();
    check("all 3 correlated observations are exposed under the one incident", forIncident.ok && ["aw-power-1", "aw-power-2", "aw-power-3"].every((id) => ids.includes(id)));
    check("the suppressed sibling is still visible via the incident-scoped read (it is a real persisted row) but never via listActiveAwareness", ids.includes("aw-power-suppressed-1"));
  }

  console.log("\n=== Scenario E: resolution lifecycle -- resolved is never served as active by default ===");
  {
    const activeDefault = await svc.listActiveAwareness(facilityManager, oisFor(facilityManager));
    check("default active read excludes the resolved water-pump awareness", activeDefault.ok && !activeDefault.items.some((i) => i.awarenessId === "aw-water-pump-1"));
    check("default active read excludes the suppressed power awareness", activeDefault.ok && !activeDefault.items.some((i) => i.awarenessId === "aw-power-suppressed-1"));
    const withResolved = await svc.listActiveAwareness(facilityManager, oisFor(facilityManager), { includeResolved: true });
    check("includeResolved:true surfaces the resolved water-pump awareness explicitly", withResolved.ok && withResolved.items.some((i) => i.awarenessId === "aw-water-pump-1"));
    const incidentsDefault = await svc.listIncidents(facilityManager, oisFor(facilityManager));
    check("default incident list excludes the resolved water-pump incident", incidentsDefault.ok && !incidentsDefault.items.some((i) => i.incidentId === "inc-water-pump"));
    const incidentsResolved = await svc.listIncidents(facilityManager, oisFor(facilityManager), { includeResolved: true });
    check("includeResolved:true surfaces the resolved water-pump incident explicitly", incidentsResolved.ok && incidentsResolved.items.some((i) => i.incidentId === "inc-water-pump"));
  }

  console.log("\n=== Role x domain x scope matrix (spot checks) ===");
  {
    const crossEstate = await svc.listIncidents(residentY, oisFor(residentY));
    check("cross-estate actor (estate Y) sees zero of estate X's incidents", crossEstate.ok && crossEstate.items.length === 0);
    const crossEstateAwareness = await svc.listActiveAwareness(residentY, oisFor(residentY));
    check("cross-estate actor sees zero of estate X's awareness (cross-estate guard enforced even though operational_awareness has no estate_id column of its own)", crossEstateAwareness.ok && crossEstateAwareness.items.length === 0);
    const maintOpDevice = await svc.listActiveAwareness(maintenanceOperator, oisFor(maintenanceOperator), { domain: "device" });
    check("maintenance_operator (cannot view private-home content) does not see resident_device_private device awareness", maintOpDevice.ok && !maintOpDevice.items.some((i) => i.awarenessId === "aw-device-a-1"));
    const noEstate = await svc.listActiveAwareness(noEstateActor, oisFor(noEstateActor));
    check("actor with no verified estate is denied, not silently empty-by-accident", noEstate.ok === false && noEstate.reason === "no_verified_estate");
  }

  console.log("\n=== Coverage-gap honesty (known incident_id-less scope gap) ===");
  {
    const activeDefault = await svc.listActiveAwareness(facilityManager, oisFor(facilityManager));
    check("incident-id-less rows never appear in results", !activeDefault.items.some((i) => i.awarenessId.startsWith("aw-orphan")));
    check("coverage gap is honestly reported as a non-zero, real count (2 orphan rows), not hidden", activeDefault.coverageGap.scopeUnresolvedExcluded === 2);
    const orphanGet = await svc.getAwareness(facilityManager, oisFor(facilityManager), "aw-orphan-1");
    check("direct getAwareness() of a scope-unresolved row fails closed with an honest reason, not fabricated content", orphanGet.ok === false && orphanGet.reason === "scope_unresolved");
  }

  console.log("\n=== Evidence reference vs. content, and execution-reference pass-through ===");
  {
    const deviceAware = await svc.getAwareness(residentA, oisFor(residentA), "aw-device-a-1");
    const evidenceItem = deviceAware.item?.evidence?.[0];
    check("evidence reference exposes type/id pointers", evidenceItem?.type === "device_status" && evidenceItem?.id === "sig-1");
    check("evidence reference does NOT leak the raw protected summary/uri content fields", evidenceItem && !("summary" in evidenceItem) && !("uri" in evidenceItem));
    check("relatedExecutions is preserved verbatim", Array.isArray(deviceAware.item?.relatedExecutions) && deviceAware.item.relatedExecutions.includes("exec-1"));
    check("executionReference is preserved verbatim, separate from relatedExecutions", deviceAware.item?.executionReference === "exec-2");
    check("no success/confirmation field is synthesized from execution references (Wave 5 invariant)", !("executed" in (deviceAware.item || {})) && !("confirmed" in (deviceAware.item || {})) && !("success" in (deviceAware.item || {})));
  }

  console.log("\n=== Performance: query-count stays flat as row count grows (Section 21, N+1 avoidance) ===");
  {
    function buildScaledFixture(n) {
      const scaledIncidents = [];
      const scaledAwareness = [];
      for (let i = 0; i < n; i += 1) {
        const incId = `perf-inc-${i}`;
        scaledIncidents.push({ id: incId, incident_key: `incident:perf:${i}`, incident_type: "device", domain: "device", title: `Perf device ${i}`, scope: { entity_type: "device", entity_id: `perf-dev-${i}` }, privacy_class: "building_operational", status: "open", severity: "info", confidence: 0.5, first_seen_at: "2026-09-01T00:00:00Z", last_seen_at: "2026-09-01T00:00:00Z", resolved_at: null, current_summary: `Perf device ${i} summary`, affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null });
        scaledAwareness.push({ id: `perf-aw-${i}`, incident_id: incId, awareness_key: `aw:perf:${i}`, audience: "building_operational", status: "open", title: `Perf awareness ${i}`, summary: "s", reason: null, impact: null, urgency: "low", owner: "oyi", recommended_action: null, verification: null, confidence: 0.5, related_signals: [], related_executions: [], generated_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", expires_at: null, payload: { supporting_evidence: [] } });
      }
      return { operational_awareness: scaledAwareness, operational_incidents: scaledIncidents, operational_insights: [], operational_recommendations: [], operational_plans: [], facility_cameras: [] };
    }
    const counts = {};
    for (const n of [10, 50, 100]) {
      const counter = { calls: 0 };
      supabaseClientMod.supabaseAdmin.from = makeSupabaseMock(buildScaledFixture(n), counter).from;
      const result = await svc.listActiveAwareness(facilityManager, oisFor(facilityManager), { limit: 200 });
      counts[n] = counter.calls;
      check(`listActiveAwareness(${n} rows) returns all ${n} correctly-scoped items`, result.ok && result.items.length === n);
    }
    check(`query count does not grow with row count (10 rows: ${counts[10]} queries, 50 rows: ${counts[50]} queries, 100 rows: ${counts[100]} queries -- expected flat, not linear)`, counts[10] === counts[50] && counts[50] === counts[100]);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE SCRIPT CRASHED:", err);
  process.exit(1);
});
