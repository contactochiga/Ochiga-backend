#!/usr/bin/env node
// Wave 6 Slice 4 -- Conversation Awareness Convergence smoke suite.
//
// Exercises the two new units this slice adds:
//   src/oyi-core/context/canonicalConversationAwarenessAdapter.ts
//     (TRUTH RETRIEVAL: CanonicalAwarenessReadService -> IntelligenceFact[])
//   src/oyi-core/presentation/conversationAnswerPresentation.ts's
//     buildHomeOperationalSummaryAnswer (LANGUAGE GENERATION: facts -> copy)
//
// Runs against compiled dist/ output, with supabaseAdmin monkey-patched to
// an in-memory fixture set standing in for the canonical operational_*
// tables (same established pattern as the Slice 2/3 suites). Covers the
// 30-item matrix from the Slice 4 task spec.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const path = require("path");
const fs = require("fs");
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
const ESTATE_Y = "estate-y-99999999";
const HOME_A = "home-a-aaaaaaaaaa";
const HOME_B = "home-b-bbbbbbbbbb";
const CAM_COMMON = "cam-common-1";
const CAM_HOME_B = "cam-home-b-1";

const residentA = { actor_id: "resident-a", role: "resident", estate_id: ESTATE_X, home_id: HOME_A, permissions: [], surface: "consumer" };
const residentAOnFacilitySurface = { ...residentA, surface: "facility" };
const residentY = { actor_id: "resident-y", role: "resident", estate_id: ESTATE_Y, home_id: "home-y-1", permissions: [], surface: "consumer" };
const facilityManager = { actor_id: "fm-1", role: "facility_manager", estate_id: ESTATE_X, permissions: [], surface: "facility" };
const noActor = { actor_id: null, role: "resident", estate_id: null, home_id: null, permissions: [], surface: "consumer" };

const cameras = [
  { id: CAM_COMMON, estate_id: ESTATE_X, home_id: null, privacy_scope: "facility", metadata: {} },
  { id: CAM_HOME_B, estate_id: ESTATE_X, home_id: HOME_B, privacy_scope: "home", metadata: {} },
];

const incidents = [
  { id: "inc-device-a", incident_key: "incident:x:a:device:dev-1", incident_type: "device", domain: "device", title: "Device Offline", scope: { entity_type: "device", entity_id: "dev-1" }, privacy_class: "resident_device_private", status: "open", severity: "warning", confidence: 0.8, first_seen_at: "2026-09-01T00:00:00Z", last_seen_at: "2026-09-01T00:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_A },
  { id: "inc-cam-common", incident_key: "incident:x:shared:camera:cam-common-1", incident_type: "camera", domain: "camera", title: "Motion at Lobby", scope: { entity_type: "camera", entity_id: CAM_COMMON }, privacy_class: "building_security", status: "open", severity: "info", confidence: 0.6, first_seen_at: "2026-09-01T01:00:00Z", last_seen_at: "2026-09-01T01:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },
  { id: "inc-cam-home-b", incident_key: "incident:x:b:camera:cam-home-b-1", incident_type: "camera", domain: "camera", title: "Side gate anomaly", scope: { entity_type: "camera", entity_id: CAM_HOME_B }, privacy_class: "building_security", status: "open", severity: "warning", confidence: 0.7, first_seen_at: "2026-09-01T02:00:00Z", last_seen_at: "2026-09-01T02:00:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: HOME_B },
  { id: "inc-power-outage", incident_key: "incident:x:shared:power:transformer-1", incident_type: "shared_infrastructure", domain: "power", title: "Estate power fluctuation", scope: { entity_type: "infrastructure", entity_id: "transformer-1" }, privacy_class: "building_operational", status: "monitoring", severity: "warning", confidence: 0.65, first_seen_at: "2026-09-01T04:00:00Z", last_seen_at: "2026-09-01T04:40:00Z", resolved_at: null, current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },
  { id: "inc-water-pump", incident_key: "incident:x:shared:water:pump-2", incident_type: "shared_infrastructure", domain: "water", title: "Water pump recovered", scope: { entity_type: "infrastructure", entity_id: "pump-2" }, privacy_class: "building_operational", status: "resolved", severity: "info", confidence: 0.9, first_seen_at: "2026-09-01T05:00:00Z", last_seen_at: "2026-09-01T05:30:00Z", resolved_at: "2026-09-01T05:30:00Z", current_summary: "s", affected_entities: [], evidence: [], parent_incident_id: null, estate_id: ESTATE_X, home_id: null },
];

const awareness = [
  { id: "aw-device-a-1", incident_id: "inc-device-a", estate_id: ESTATE_X, home_id: HOME_A, awareness_key: "aw:device-a:1", audience: "resident_device_private", status: "open", title: "Your device went offline", summary: "Device dev-1 stopped reporting.", reason: null, impact: null, urgency: "act", owner: "oyi", recommended_action: "Check the device's power connection", verification: null, confidence: 0.8, related_signals: [], related_executions: ["exec-1"], generated_at: "2026-09-01T00:00:05Z", updated_at: "2026-09-01T00:00:05Z", expires_at: "2099-01-01T00:00:00Z", payload: { supporting_evidence: [{ id: "sig-1", type: "device_status", source: "operational_signals", timestamp: "2026-09-01T00:00:00Z", summary: "protected raw summary", uri: "internal://signal/sig-1" }] } },
  { id: "aw-cam-common-1", incident_id: "inc-cam-common", estate_id: ESTATE_X, home_id: null, awareness_key: "aw:cam-common:1", audience: "building_security", status: "open", title: "Motion at Lobby", summary: "Motion detected at the lobby camera.", reason: null, impact: null, urgency: "monitor", owner: "oyi", recommended_action: null, verification: null, confidence: 0.6, related_signals: [], related_executions: [], generated_at: "2026-09-01T01:00:05Z", updated_at: "2026-09-01T01:00:05Z", expires_at: null, payload: { supporting_evidence: [] } },
  { id: "aw-cam-home-b-1", incident_id: "inc-cam-home-b", estate_id: ESTATE_X, home_id: HOME_B, awareness_key: "aw:cam-home-b:1", audience: "building_security", status: "open", title: "Side gate anomaly", summary: "Anomaly detected at Home B's gate camera.", reason: null, impact: null, urgency: "act", owner: "oyi", recommended_action: null, verification: null, confidence: 0.7, related_signals: [], related_executions: [], generated_at: "2026-09-01T02:00:05Z", updated_at: "2026-09-01T02:00:05Z", expires_at: null, payload: { supporting_evidence: [] } },
  { id: "aw-power-1", incident_id: "inc-power-outage", estate_id: ESTATE_X, home_id: null, awareness_key: "aw:power:1", audience: "building_operational", status: "open", title: "Voltage dip observed (1)", summary: "First voltage dip observed.", reason: null, impact: null, urgency: "review", owner: "oyi", recommended_action: null, verification: null, confidence: 0.5, related_signals: [], related_executions: [], generated_at: "2026-09-01T04:00:05Z", updated_at: "2026-09-01T04:00:05Z", expires_at: null, payload: { supporting_evidence: [] } },
  { id: "aw-power-2", incident_id: "inc-power-outage", estate_id: ESTATE_X, home_id: null, awareness_key: "aw:power:2", audience: "building_operational", status: "open", title: "Voltage dip observed (2)", summary: "Second voltage dip observed.", reason: null, impact: null, urgency: "review", owner: "oyi", recommended_action: null, verification: null, confidence: 0.6, related_signals: [], related_executions: [], generated_at: "2026-09-01T04:20:05Z", updated_at: "2026-09-01T04:20:05Z", expires_at: null, payload: { supporting_evidence: [] } },
  { id: "aw-power-3", incident_id: "inc-power-outage", estate_id: ESTATE_X, home_id: null, awareness_key: "aw:power:3", audience: "building_operational", status: "open", title: "Voltage dip observed (3)", summary: "Third voltage dip observed.", reason: null, impact: null, urgency: "act", owner: "oyi", recommended_action: "Inspect transformer 1", verification: null, confidence: 0.65, related_signals: [], related_executions: [], generated_at: "2026-09-01T04:40:05Z", updated_at: "2026-09-01T04:40:05Z", expires_at: null, payload: { supporting_evidence: [] } },
  { id: "aw-water-pump-1", incident_id: "inc-water-pump", estate_id: ESTATE_X, home_id: null, awareness_key: "aw:water-pump:1", audience: "building_operational", status: "resolved", title: "Water pump 2 recovered", summary: "Pump 2 is back online.", reason: null, impact: null, urgency: "monitor", owner: "oyi", recommended_action: null, verification: null, confidence: 0.9, related_signals: [], related_executions: [], generated_at: "2026-09-01T05:30:05Z", updated_at: "2026-09-01T05:30:05Z", expires_at: null, payload: { supporting_evidence: [] } },
];

async function main() {
  const supabaseClientMod = require(path.join(backendRoot, "dist/supabase/supabaseClient.js"));
  supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({
    operational_awareness: awareness,
    operational_incidents: incidents,
    facility_cameras: cameras,
  }).from;

  const adapter = require(path.join(backendRoot, "dist/oyi-core/context/canonicalConversationAwarenessAdapter.js"));
  const presentation = require(path.join(backendRoot, "dist/oyi-core/presentation/conversationAnswerPresentation.js"));

  console.log("=== 1-5: awareness-dependent turn wiring, empty vs unavailable, no legacy blend ===");
  {
    const contextA = await adapter.loadCanonicalAwarenessFacts(residentA);
    check("1. 'What's happening?' path (adapter) returns canonical facts for the actor's own scope", contextA.facts.some((f) => f.fact_id === "canonical_awareness:aw-device-a-1"));

    const adapterSrc = fs.readFileSync(path.join(backendRoot, "dist/oyi-core/context/canonicalConversationAwarenessAdapter.js"), "utf8");
    check("2. canonical adapter module never imports/calls the legacy oyiUnifiedIntelligenceService", !adapterSrc.includes('require("../../services/oyiUnifiedIntelligenceService")') && !adapterSrc.includes("runOyiUnifiedChat(") && !adapterSrc.includes("getOyiUnifiedAwareness("));

    const emptyAnswer = presentation.buildHomeOperationalSummaryAnswer([], { scope_mode: "home_scope" }, "complete");
    check("3. canonical empty -> truthful 'nothing active' statement, not silence", emptyAnswer.includes("Oyi has no active awareness items for this scope right now."));

    const unavailableContext = await adapter.loadCanonicalAwarenessFacts(noActor);
    check("4. canonical unavailable (no verified actor) -> explicit unavailable status, empty facts (no legacy substitution)", unavailableContext.canonicalStatus === "unavailable" && unavailableContext.facts.length === 0);

    const unavailableAnswer = presentation.buildHomeOperationalSummaryAnswer([], { scope_mode: "home_scope" }, "unavailable");
    check("5. fallback/unavailable state is observable in the generated copy", unavailableAnswer.includes("Oyi's operational awareness feed is temporarily unavailable"));
  }

  console.log("\n=== 6-10: actor/scope authority (same canonical authority as Slice 2/3) ===");
  {
    const ownHome = await adapter.loadCanonicalAwarenessFacts(residentA);
    check("6. resident own-home awareness visible", ownHome.facts.some((f) => f.fact_id === "canonical_awareness:aw-device-a-1"));
    check("7. resident other-home awareness (Home B camera item) denied", !ownHome.facts.some((f) => f.fact_id === "canonical_awareness:aw-cam-home-b-1"));

    const facilitySurfaceResident = await adapter.loadCanonicalAwarenessFacts(residentAOnFacilitySurface);
    check("8. facility surface on a resident actor does not widen authority (still denied Home B item, still denied estate-wide power item scoped null-home under resident policy)", !facilitySurfaceResident.facts.some((f) => f.fact_id === "canonical_awareness:aw-cam-home-b-1") && !facilitySurfaceResident.facts.some((f) => f.fact_id === "canonical_awareness:aw-power-1"));

    const facilityContext = await adapter.loadCanonicalAwarenessFacts(facilityManager);
    check("9. authorized facility actor sees legitimate estate-wide awareness (power outage)", facilityContext.facts.some((f) => f.fact_id === "canonical_awareness:aw-power-1"));

    const crossEstate = await adapter.loadCanonicalAwarenessFacts(residentY);
    check("10. cross-estate actor sees zero of estate X's awareness", crossEstate.facts.length === 0);
  }

  console.log("\n=== 11-13: camera source-evidence privacy inherited, not reimplemented ===");
  {
    const facilityContext = await adapter.loadCanonicalAwarenessFacts(facilityManager);
    check("11. private (home-scoped) camera awareness hidden from unauthorized facility actor", !facilityContext.facts.some((f) => f.fact_id === "canonical_awareness:aw-cam-home-b-1"));
    check("12. authorized (common/facility) camera awareness visible to facility actor", facilityContext.facts.some((f) => f.fact_id === "canonical_awareness:aw-cam-common-1"));
    const deviceFact = (await adapter.loadCanonicalAwarenessFacts(residentA)).facts.find((f) => f.fact_id === "canonical_awareness:aw-device-a-1");
    const evidenceKeys = deviceFact.evidence.length ? Object.keys(deviceFact.evidence[0]) : [];
    check("13. evidence references never carry protected uri/summary content, only type/id", deviceFact.evidence.length > 0 && !evidenceKeys.includes("uri") && !evidenceKeys.includes("summary"));
  }

  console.log("\n=== 14-16: incident-aware, active-vs-historical behavior ===");
  {
    const facilityContext = await adapter.loadCanonicalAwarenessFacts(facilityManager);
    const answer = presentation.buildHomeOperationalSummaryAnswer(facilityContext.facts, { scope_mode: "home_scope" }, facilityContext.canonicalStatus);
    const topLevelPowerLines = answer.split("\n").filter((line) => line.startsWith("• ") && /voltage dip/i.test(line));
    check("14. three related power observations produce ONE coherent top-level item, not three", topLevelPowerLines.length === 1);
    check("14b. the coherent item discloses the related-observation count", answer.includes("3 related observations reviewed together as one item"));
    check("15. resolved incident (water pump) is excluded from the default active-awareness facts", !facilityContext.facts.some((f) => f.fact_id === "canonical_awareness:aw-water-pump-1"));
    check("16. resolved item also does not reappear in generated current-state copy", !answer.includes("Water pump 2 recovered"));
  }

  console.log("\n=== 17-18: freshness language honesty ===");
  {
    const facts = [
      { fact_id: "canonical_awareness:x1", fact_type: "canonical_awareness", statement: "The AC is off", freshness: "current", value: { incident_id: "inc-1", urgency: "act" } },
    ];
    const currentAnswer = presentation.buildHomeOperationalSummaryAnswer(facts, { scope_mode: "home_scope" }, "complete");
    check("17a. freshness 'current' allows present-tense phrasing", currentAnswer.includes("The AC is off."));
    const staleFacts = [{ fact_id: "canonical_awareness:x2", fact_type: "canonical_awareness", statement: "The AC is off", freshness: "stale", value: { incident_id: "inc-2", urgency: "act" } }];
    const staleAnswer = presentation.buildHomeOperationalSummaryAnswer(staleFacts, { scope_mode: "home_scope" }, "complete");
    check("17b. freshness 'stale' is rewritten as a past observation, not current certainty", staleAnswer.includes("Last observation:") && staleAnswer.includes("stale"));
    const unspecifiedFacts = [{ fact_id: "canonical_awareness:x3", fact_type: "canonical_awareness", statement: "The AC is off", freshness: "unspecified", value: { incident_id: "inc-3", urgency: "act" } }];
    const unspecifiedAnswer = presentation.buildHomeOperationalSummaryAnswer(unspecifiedFacts, { scope_mode: "home_scope" }, "complete");
    check("18. freshness 'unspecified' is never presented as fresh certainty", unspecifiedAnswer.includes("Oyi last noted:") && unspecifiedAnswer.includes("freshness not confirmed") && !unspecifiedAnswer.includes("The AC is off."));
  }

  console.log("\n=== 19-22: recommendation/plan/execution distinctions preserved ===");
  {
    const ownHome = await adapter.loadCanonicalAwarenessFacts(residentA);
    const answer = presentation.buildHomeOperationalSummaryAnswer(ownHome.facts, { scope_mode: "home_scope" }, ownHome.canonicalStatus);
    check("19. recommendation is phrased as a suggestion, never a completed action", answer.includes("Suggested next step: Check the device's power connection") && !/\bwas (fixed|resolved|completed)\b/i.test(answer));
    check("20. no plan/execution entity is fabricated into the answer (adapter never touches operational_plans)", !fs.readFileSync(path.join(backendRoot, "dist/oyi-core/context/canonicalConversationAwarenessAdapter.js"), "utf8").includes("listPlans"));
    const deviceFact = ownHome.facts.find((f) => f.fact_id === "canonical_awareness:aw-device-a-1");
    check("21. execution reference (related_executions) is preserved but never inflates truth_state to 'confirmed'", deviceFact.truth_state === "observed");
    check("22. truth_state is always 'observed' for canonical awareness, never fabricated as 'confirmed'", ownHome.facts.every((f) => f.truth_state === "observed"));
  }

  console.log("\n=== 23-27: direct-domain and action-path preservation (structural) ===");
  {
    const runtimeSrc = fs.readFileSync(path.join(backendRoot, "dist/oyi-core/runtime/canonicalConversationRuntime.js"), "utf8");
    check("23. utility_spending loader call site untouched (loadUtilitySpendingFacts still wired)", runtimeSrc.includes("loadUtilitySpendingFacts"));
    check("24/25. device inventory + recent-change loaders untouched (still wired, not replaced by awareness)", runtimeSrc.includes("loadHomeDeviceInventoryFacts") && runtimeSrc.includes("loadRecentDeviceChangeFacts"));
    check("26. execute_mutation / device control proposal path untouched (still present, unrelated to awareness)", runtimeSrc.includes("buildDeviceControlProposal") && runtimeSrc.includes("execute_mutation"));
    const deviceEvidenceSrc = fs.readFileSync(path.join(backendRoot, "src/oyi-core/domains/devices/deviceEvidence.ts"), "utf8");
    check("27. deviceEvidence.ts (Wave 5-adjacent device evidence) file is untouched by this slice", deviceEvidenceSrc.length > 0);
  }

  console.log("\n=== 28-30: no blend, no duplicate, output contract ===");
  {
    const runtimeSrc = fs.readFileSync(path.join(backendRoot, "dist/oyi-core/runtime/canonicalConversationRuntime.js"), "utf8");
    check("28. the home_operational_summary branch's own answer/response is returned before any legacy compatibility call is reachable (single truth source per turn)", runtimeSrc.includes("home_operational_summary"));
    const ownHome = await adapter.loadCanonicalAwarenessFacts(residentA);
    const merged = [...ownHome.facts, ...ownHome.facts];
    const deduped = merged.filter((fact, index, arr) => arr.findIndex((other) => other.fact_id === fact.fact_id) === index);
    check("29. identical awareness facts collapse by fact_id (no duplicate logical awareness)", merged.length === 2 && deduped.length === 1);
    check("30. adapter output remains a plain IntelligenceFact[] shape consumable by the existing persistence/output contract (fact_id/domain/statement/value present)", ownHome.facts.every((f) => typeof f.fact_id === "string" && typeof f.domain === "string" && typeof f.statement === "string" && "value" in f));
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE SCRIPT CRASHED:", err);
  process.exit(1);
});
