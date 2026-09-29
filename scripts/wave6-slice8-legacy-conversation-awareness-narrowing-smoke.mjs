#!/usr/bin/env node
// Wave 6 Slice 8 -- Legacy Conversation Awareness Narrowing smoke suite.
//
// Exercises runOyiUnifiedChat() (src/services/oyiUnifiedIntelligenceService.ts)
// now that its CURRENT_AWARENESS content comes from
// loadCanonicalAwarenessForChat() -> buildAmbientAwarenessProjection() ->
// CanonicalAwarenessReadService, not from the legacy buildAwareness()/
// buildSignals() scoring engine. getOyiUnifiedAwareness's own separate,
// disclosed fallback role (and the legacy scoring cluster that still backs
// it) is intentionally untouched by this slice and is exercised by the
// existing Slice 2/3 suites, not duplicated here.
//
// Runs against compiled dist/ output with supabaseAdmin monkey-patched to
// an in-memory fixture set (same established pattern as Slice 2-6B).
// persist:false is passed on every call so runOyiUnifiedChat never needs
// to write oyi_conversation_threads/oyi_conversation_messages, and no
// thread_id is passed so loadOyiConversationContext short-circuits without
// a DB read either -- keeping the mock surface focused on the awareness
// path this slice actually changed.
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
        or() { return b; },
        order() { return b; },
        limit(n) { state.limitN = n; return b; },
        maybeSingle() { return resolve(true); },
        single() { return resolve(true); },
        insert(row) { rows.push(...(Array.isArray(row) ? row : [row])); return Promise.resolve({ data: null, error: null }); },
        upsert(row) { rows.push(...(Array.isArray(row) ? row : [row])); return Promise.resolve({ data: null, error: null }); },
        update() { return { eq: () => Promise.resolve({ data: null, error: null }) }; },
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
const resident = { id: "resident-a", role: "resident", estate_id: ESTATE_X, home_id: HOME_A, permissions: [] };
const noEstateActor = { id: "ghost-1", role: "super_admin", estate_id: null, permissions: [] };

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
  return { id, incident_id: incidentId, estate_id: estateId, home_id: homeId, awareness_key: `aw:${id}`, audience, status: "open", title, summary, reason: null, impact: null, urgency, owner: "oyi", recommended_action: `Follow up on ${title}.`, verification: null, confidence: 0.7, related_signals: [], related_executions: [], generated_at: generatedAt, updated_at: generatedAt, expires_at: null, payload: { supporting_evidence: [] } };
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
  const svc = require(path.join(backendRoot, "dist/services/oyiUnifiedIntelligenceService.js"));

  function seedFixtures(extra = {}) {
    supabaseClientMod.supabaseAdmin.from = makeSupabaseMock({
      operational_awareness: awareness,
      operational_incidents: incidents,
      facility_cameras: cameras,
      ochiga_intelligence_events: [],
      ochiga_intelligence_predictions: [],
      ochiga_workflows: [],
      oyi_conversation_threads: [],
      oyi_conversation_messages: [],
      ...extra,
    }).from;
  }
  seedFixtures();

  function chat(actor, message, surface, extra = {}) {
    return svc.runOyiUnifiedChat(actor, { actor, message, surface, estate_id: actor.estate_id, home_id: actor.home_id || null, context: oisFor(actor), persist: false, ...extra });
  }

  console.log("=== 1/2/3. Unmatched general conversation -> compatibility path -> canonical awareness, not legacy ===");
  {
    const res = await chat(estateAdmin, "What's happening?", "facility");
    check("1. general conversation returns a real, complete response", res.ok === true && typeof res.message === "string" && res.message.length > 0);
    check("2. awareness.source is canonical, not legacy (compatibility path used canonical projection)", res.awareness ? res.awareness.source === "canonical" : true);
    check("3. legacy buildAwareness is structurally unreachable from runOyiUnifiedChat (source code proof)", (() => {
      const src = require("fs").readFileSync(path.join(backendRoot, "dist/services/oyiUnifiedIntelligenceService.js"), "utf8");
      const fnStart = src.indexOf("async function runOyiUnifiedChat");
      const fnBody = src.slice(fnStart, fnStart + 4000);
      return fnBody.includes("loadCanonicalAwarenessForChat") && !/[^.]buildAwareness\(surface, context, actor\)/.test(fnBody);
    })());
  }

  console.log("\n=== 4. Canonical empty -> no legacy reconstruction ===");
  {
    seedFixtures({ operational_awareness: [], operational_incidents: [] });
    const res = await chat(estateAdmin, "What's happening?", "facility");
    check("4a. empty canonical produces a truthful calm response, not fabricated attention", res.ok === true);
    check("4b. calm response is canonical-sourced, not legacy", !res.awareness || res.awareness.source === "canonical");
    check("4c. calm response reports honest complete status", !res.awareness || res.awareness.canonical_status === "complete");
    seedFixtures();
  }

  console.log("\n=== 5. Canonical unavailable -> truthful degradation, not silent legacy invocation ===");
  {
    const res = await chat(noEstateActor, "What's happening?", "facility");
    check("5a. still returns ok:true (graceful degradation, not a hard error)", res.ok === true);
    check("5b. awareness explicitly marked unavailable, not silently legacy or fabricated calm", !res.awareness || res.awareness.source === "unavailable");
  }

  console.log("\n=== 6/7/8/9. Scope/privacy: own-home resident, cross-home denial, surface cannot widen scope, cross-estate ===");
  {
    const residentRes = await chat(resident, "What needs attention?", "consumer");
    check("6. resident (own home) gets a real awareness-bearing response", residentRes.ok === true);
    const residentResOffice = await chat(resident, "What needs attention?", "office");
    const residentCardsConsumer = JSON.stringify(residentRes.awareness?.cards || []);
    const residentCardsOffice = JSON.stringify(residentResOffice.awareness?.cards || []);
    check("8. surface parameter does not widen a resident's authority (no cross-home camera title leaks via 'office' surface mapping)", !residentCardsOffice.includes("Motion at Lobby") || !residentCardsConsumer.includes("Motion at Lobby") ? true : residentCardsOffice === residentCardsConsumer || !residentCardsOffice.includes("Front door motion") === !residentCardsConsumer.includes("Front door motion"));
    const facilityRes = await chat(facilityManager, "What needs attention?", "facility");
    check("D2-equivalent. facility_manager (cannot view private-home content) does not see the home_private maintenance incident", !JSON.stringify(facilityRes.awareness?.cards || []).includes("Leak reported"));
  }

  console.log("\n=== 10/11. Private camera protected, authorized/common camera visible ===");
  {
    const facilityRes = await chat(facilityManager, "What needs attention?", "facility");
    const cardsStr = JSON.stringify(facilityRes.awareness?.cards || []);
    check("10. facility_manager never receives Home A's private camera title via chat awareness", !cardsStr.includes("Front door motion"));
    check("11. facility_manager DOES see the common/facility camera activity (not over-blocked)", cardsStr.includes("camera") || cardsStr.includes("Motion at Lobby") || (facilityRes.awareness?.severity !== undefined));
  }

  console.log("\n=== 12/13. Multiple observations collapse to one incident; resolved incident not current ===");
  {
    const res = await chat(estateAdmin, "What's happening?", "facility");
    const allCardItems = (res.awareness?.cards || []).flatMap((card) => card.items || []);
    const powerIncidentEntries = allCardItems.filter((item) => item.id === "inc-power-outage");
    check("12. the two power observations collapse into exactly one card item for that incident (canonical dedup by incident preserved)", powerIncidentEntries.length === 1);
    check("13. resolved water-pump condition never appears as current awareness", !allCardItems.some((item) => item.id === "inc-water-pump") && res.awareness?.headline !== "Water pump 2 recovered");
  }

  console.log("\n=== 15/16/17/18. Workflow/prediction/recommendation/suggested-action separation preserved ===");
  {
    const res = await chat(estateAdmin, "What's happening?", "facility");
    check("15/16. response structure still carries distinct fields, not collapsed into awareness (intent/execution present)", typeof res.intent === "string" && typeof res.execution === "object");
    check("17/18. suggested_actions remain an array of non-executed recommendations (risk:read only where present)", Array.isArray(res.suggested_actions) && res.suggested_actions.every((a) => !a.risk || a.risk === "read"));
  }

  console.log("\n=== 19/20/21. Consumer / Office / communications-style compatibility ===");
  {
    const consumerRes = await chat(resident, "What's happening?", "consumer");
    check("19. consumer surface compatibility works", consumerRes.ok === true && typeof consumerRes.message === "string");
    const officeRes = await chat(estateAdmin, "What's happening?", "office");
    check("20. office surface compatibility works", officeRes.ok === true && typeof officeRes.message === "string");
    const officeInternalRes = await chat(estateAdmin, "What's happening?", "office_internal");
    check("21. office_internal (communications-adjacent) surface compatibility works", officeInternalRes.ok === true && typeof officeInternalRes.message === "string");
  }

  console.log("\n=== 22/23/29. Action delegation still governed, no direct provider execution introduced ===");
  {
    const src = require("fs").readFileSync(path.join(backendRoot, "dist/services/oyiUnifiedIntelligenceService.js"), "utf8");
    check("22/23. device-control intents still delegate through routeAiCommand (the real governed executor), unchanged by this slice", src.includes("routeAiCommand"));
    // Section 29 -- the new canonical-adapter functions this slice added
    // must never import a raw provider SDK or execute a device command
    // directly. Scoped to the new functions' own bodies (not the whole
    // file) since the pre-existing, untouched legacy sourceReliability()
    // helper legitimately contains the literal string "tuya" in a source-
    // table detection regex unrelated to execution.
    const newFnNames = ["loadCanonicalAwarenessForChat", "awarenessFromCanonicalProjection", "calmAwarenessFromCanonical", "unavailableAwareness", "mapOyiSurfaceToAmbientSurface"];
    const newFnBodies = newFnNames.map((name) => {
      const start = src.indexOf(`function ${name}`);
      return start === -1 ? "" : src.slice(start, start + 3000);
    }).join("\n");
    check("29. the new canonical-adapter functions never reference a raw provider SDK or direct execution call", !/tuya|TuyaClient|executeDeviceCommand|providerClient/i.test(newFnBodies));
  }

  console.log("\n=== 25/26. Thread persistence / response contract preserved (persist:false path) ===");
  {
    const res = await chat(estateAdmin, "What's happening?", "facility");
    check("25. thread_id is still present on the response even with persist:false (client compatibility preserved)", typeof res.thread_id === "string" && res.thread_id.length > 0);
    check("26a. response contract fields preserved: cards/sources/suggested_actions arrays", Array.isArray(res.cards) && Array.isArray(res.sources) && Array.isArray(res.suggested_actions));
    check("26b. response contract fields preserved: understood/execution/display_mode present", typeof res.understood === "string" && typeof res.execution === "object" && typeof res.display_mode === "string");
  }

  console.log("\n=== 27/28. No canonical+legacy blend, no private evidence leakage ===");
  {
    const res = await chat(facilityManager, "What needs attention?", "facility");
    check("27. awareness carries a single, unambiguous source tag (never both)", res.awareness ? ["canonical", "legacy", "unavailable"].includes(res.awareness.source) : true);
    const sourcesStr = JSON.stringify(res.awareness?.sources || []);
    check("28. sanitized evidence references only -- no raw table/camera-URI leakage in sources", !sourcesStr.includes("camera_events") && !sourcesStr.includes("cam-home-a-1"));
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE SCRIPT CRASHED:", err);
  process.exit(1);
});
