#!/usr/bin/env node
// Oyi Intelligence Convergence -- Camera Intelligence Convergence Wave.
// Real behavioral coverage against the actual compiled code:
//   - cameraCanonicalSignal.ts's classification + envelope-building logic
//     (pure, plus the exact Core-facing contract shape).
//   - ingestEdgeDetections() (Edge detection ingress): existing
//     persistence/publication/notification behaviour is unaffected, the
//     new canonical detection signal reaches Core exactly once per real
//     (non-duplicate) detection, confidence/evidence/scope are
//     preserved, a malformed/unavailable Core ingress cannot corrupt the
//     persisted event, and existing idempotency-key deduplication still
//     suppresses a second canonical ingestion for a repeated detection.
//   - createEvent() (manual/API camera event path): same guarantees,
//     plus proof that the shadow canonical path introduces zero
//     additional NotificationService calls (no duplicate delivery).
//   - platformGapService.upsertCameraInfrastructure(): a first-ever
//     projection write (no prior row) must NOT fabricate a transition; a
//     genuine health_state change must reach Core exactly once; a
//     repeated write of the same health_state must not.
//   - Cross-domain golden journey (Part 10): a camera health signal
//     reaches the REAL (unmocked) oyiCoreRuntime.receiveSignal() and
//     becomes real, usable awareness -- correct kind, a maintenance-
//     relevant recommended_action, and the camera/estate/home context
//     preserved -- using only currently-connected capabilities.
import assert from "node:assert/strict";
import path from "node:path";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "camera-intelligence-convergence-local-only";

const root = process.cwd();
const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));
const emitSignalNamespace = await import(path.join(root, "dist/realtime/emitSignal.js"));
const emitSignalModule = emitSignalNamespace.default;
const oyiCoreServiceModule = await import(path.join(root, "dist/oyi-core/service.js"));
// intelligence-core's barrel re-exports publishIntelligenceEvent via a
// live getter proxying to eventBus.js's own exports object -- monkeypatch
// THAT underlying module directly, matching the established pattern from
// the Wave 0 canonical-signal-ingress smoke test.
const eventBusNamespace = await import(path.join(root, "dist/intelligence-core/eventBus.js"));
const eventBusModule = eventBusNamespace.default;
const notificationServiceModule = await import(path.join(root, "dist/services/NotificationService.js"));

const originalEmitSignalSafely = emitSignalModule.emitSignalSafely;
const originalPublishIntelligenceEvent = eventBusModule.publishIntelligenceEvent;
const originalReceiveSignal = oyiCoreServiceModule.oyiCoreRuntime.receiveSignal.bind(oyiCoreServiceModule.oyiCoreRuntime);
const originalSendToRole = notificationServiceModule.NotificationService.sendToRole;
const originalSendToEstate = notificationServiceModule.NotificationService.sendToEstate;

function applyFilters(row, filters) {
  return filters.every(([col, op, val]) => {
    if (op === "eq") return row[col] === val;
    if (op === "gte") return row[col] >= val;
    if (op === "lte") return row[col] <= val;
    if (op === "contains") {
      const target = row[col];
      if (!target || typeof target !== "object") return false;
      return Object.entries(val).every(([k, v]) => target[k] === v);
    }
    return true;
  });
}
function makeTable(store) {
  return {
    select() {
      const filters = [];
      const builder = {
        eq(col, val) { filters.push([col, "eq", val]); return builder; },
        gte(col, val) { filters.push([col, "gte", val]); return builder; },
        lte(col, val) { filters.push([col, "lte", val]); return builder; },
        contains(col, val) { filters.push([col, "contains", val]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() {
          const rows = store.filter((r) => applyFilters(r, filters));
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        single() {
          const rows = store.filter((r) => applyFilters(r, filters));
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        then(resolve, reject) {
          const rows = store.filter((r) => applyFilters(r, filters));
          Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    insert(rowOrRows) {
      const rows = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).map((r, i) => ({
        id: r.id || `row-${store.length + i + 1}`,
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || new Date().toISOString(),
        ...r,
      }));
      store.push(...rows);
      return {
        select() {
          return {
            single: () => Promise.resolve({ data: rows[0] || null, error: null }),
            maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
          };
        },
        then(resolve, reject) { Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
    },
    upsert(row, opts = {}) {
      const conflictKey = opts.onConflict;
      const finalize = () => {
        const idx = conflictKey ? store.findIndex((r) => conflictKey.split(",").every((k) => r[k.trim()] === row[k.trim()])) : -1;
        if (idx === -1) { store.push({ id: row.id || `row-${store.length + 1}`, ...row }); return store[store.length - 1]; }
        store[idx] = { ...store[idx], ...row };
        return store[idx];
      };
      return {
        select() {
          return {
            single: () => Promise.resolve({ data: finalize(), error: null }),
            maybeSingle: () => Promise.resolve({ data: finalize(), error: null }),
          };
        },
        then(resolve, reject) { Promise.resolve({ data: finalize(), error: null }).then(resolve, reject); },
      };
    },
  };
}

let facilityCameras, cameraEvents, cameraDetections, cameraDetectionZones, cameraMedia, cameraAiProfiles, cameraInfrastructure, cameraHealthHistory;
function resetStore() {
  facilityCameras = [];
  cameraEvents = [];
  cameraDetections = [];
  cameraDetectionZones = [];
  cameraMedia = [];
  cameraAiProfiles = [];
  cameraInfrastructure = [];
  cameraHealthHistory = [];
}
resetStore();
const genericTables = new Map();
function fakeFrom(table) {
  const tables = {
    facility_cameras: facilityCameras,
    camera_events: cameraEvents,
    camera_detections: cameraDetections,
    camera_detection_zones: cameraDetectionZones,
    camera_media: cameraMedia,
    camera_event_media: [],
    camera_ai_profiles: cameraAiProfiles,
    camera_infrastructure: cameraInfrastructure,
    camera_health_history: cameraHealthHistory,
  };
  if (tables[table]) return makeTable(tables[table]);
  if (!genericTables.has(table)) genericTables.set(table, []);
  return makeTable(genericTables.get(table));
}
const originalFrom = supabaseModule.supabaseAdmin.from.bind(supabaseModule.supabaseAdmin);
supabaseModule.supabaseAdmin.from = fakeFrom;

const cameraCanonicalSignalModule = await import(path.join(root, "dist/oyi-core/domains/camera/cameraCanonicalSignal.js"));
const { classifyCameraHealthTransition, submitCameraDetectionCanonicalSignal, submitCameraHealthCanonicalSignal } = cameraCanonicalSignalModule;
const cameraDetectionServiceModule = await import(path.join(root, "dist/modules/cameras/cameraDetection.service.js"));
const { ingestEdgeDetections } = cameraDetectionServiceModule;
const cameraIntelControllerModule = await import(path.join(root, "dist/controllers/cameraIntelController.js"));
const { createEvent } = cameraIntelControllerModule;
const platformGapServiceNamespace = await import(path.join(root, "dist/services/platformGapService.js"));
const { platformGapService } = platformGapServiceNamespace;

function spy(returnValue) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return typeof returnValue === "function" ? returnValue(...args) : Promise.resolve(returnValue); };
  fn.calls = calls;
  return fn;
}
function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    failures.push(`${name}: ${error.message}`);
  }
}

const ESTATE_ID = "estate-1";
const HOME_ID = "home-1";

// ---------------------------------------------------------------------
// 1. classifyCameraHealthTransition -- pure classification logic.
// ---------------------------------------------------------------------
await check("classifyCameraHealthTransition: meaningful transitions vs routine noise", () => {
  assert.equal(classifyCameraHealthTransition("online", "offline"), "connectivity_lost");
  assert.equal(classifyCameraHealthTransition("offline", "online"), "connectivity_restored");
  assert.equal(classifyCameraHealthTransition("offline", "offline"), null, "repeated identical status must not be treated as a transition");
  assert.equal(classifyCameraHealthTransition("online", "active"), null, "online -> online cosmetic label change must not be intelligence-worthy");
  assert.equal(classifyCameraHealthTransition("pending", "error"), "health_degraded");
  assert.equal(classifyCameraHealthTransition("online", null), null, "a missing next status must not be treated as a transition");
  assert.equal(classifyCameraHealthTransition("online", "online", { tamper: true }), "tamper_detected", "tamper must be classified regardless of status strings");
  assert.equal(classifyCameraHealthTransition("online", "offline", { recorderFailure: true }), "recorder_failure", "recorderFailure must take priority over a plain connectivity_lost reading");
});

// ---------------------------------------------------------------------
// 2. submitCameraDetectionCanonicalSignal -- canonical contract shape.
// Proves DETECTION CLASSIFICATION (entity.status, verbatim) is kept
// separate from OPERATIONAL SEVERITY (severity, fed through the reused
// signalSeverity() classifier) -- these must not be the same mechanism.
// ---------------------------------------------------------------------
await check("submitCameraDetectionCanonicalSignal: exactly one Core ingestion; raw detection type preserved verbatim; severity is the classifier's output, not a copy", async () => {
  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;

  await submitCameraDetectionCanonicalSignal({
    cameraId: "cam-1", cameraName: "Gate Camera", estateId: ESTATE_ID, homeId: HOME_ID,
    zoneId: "zone-1", zoneName: "Front Gate", detectionType: "person", confidence: 0.92,
    observedAt: "2026-08-24T10:00:00Z", eventId: "event-1", provider: "hikvision", verified: true,
  });

  need(receiveSpy.calls.length === 1, `expected exactly one Core ingestion, got ${receiveSpy.calls.length}`);
  const signal = receiveSpy.calls[0][0];
  need(signal.type === "camera.detection.observed", "canonical type must be camera.detection.observed");
  need(signal.domain === "camera", "canonical domain must be camera");
  need(signal.source === "camera", "canonical source must be camera");
  need(signal.estateId === ESTATE_ID, "estate scope must be preserved");
  need(signal.unitId === HOME_ID, "home scope must be preserved");
  need(signal.entity.id === "cam-1", "entity id must be the real camera id");
  need(signal.entity.status === "person", `raw detector classification must be preserved verbatim as entity.status, got ${signal.entity.status}`);
  need(signal.severity === "info", `"person" must map through signalSeverity() to "info", not be copied from entity.status, got ${signal.severity}`);
  need(signal.severity !== signal.entity.status, "severity must be the classifier's output, never a copy of the raw detection type");
  const evidence = signal.evidence?.[0];
  need(evidence?.metadata?.confidence === 0.92, "raw detector confidence must be preserved as evidence, not reinterpreted");
  need(evidence?.metadata?.zone_id === "zone-1" && evidence?.metadata?.zone_name === "Front Gate", "zone context must be preserved as evidence");
  need(signal.metadata?.event_id === "event-1", "source event id must be preserved in metadata");
  need(signal.correlationId === "camera_detection:cam-1:event-1", "correlationId must be stable per detection event");

  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

await check("submitCameraDetectionCanonicalSignal: a critical raw classification (fire) maps to critical severity", async () => {
  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;
  await submitCameraDetectionCanonicalSignal({ cameraId: "cam-2", estateId: ESTATE_ID, detectionType: "fire", observedAt: "2026-08-24T10:00:00Z" });
  need(receiveSpy.calls[0][0].severity === "critical", `expected critical severity for "fire", got ${receiveSpy.calls[0][0].severity}`);
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// ---------------------------------------------------------------------
// 3. submitCameraHealthCanonicalSignal -- canonical contract shape.
// ---------------------------------------------------------------------
await check("submitCameraHealthCanonicalSignal: connectivity_lost maps to camera.connectivity.lost / warning severity, evidence preserved", async () => {
  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;
  await submitCameraHealthCanonicalSignal({
    cameraId: "cam-3", cameraName: "Lobby Camera", estateId: ESTATE_ID, homeId: HOME_ID,
    transition: "connectivity_lost", previousStatus: "online", nextStatus: "offline", observedAt: "2026-08-24T10:05:00Z",
  });
  const signal = receiveSpy.calls[0][0];
  need(signal.type === "camera.connectivity.lost", "canonical type must reflect the transition kind");
  need(signal.severity === "warning", `expected warning severity for connectivity_lost, got ${signal.severity}`);
  need(signal.entity.status === "offline", "entity.status must carry the real next status");
  need(signal.evidence?.[0]?.metadata?.previous_status === "online", "prior status must be preserved as evidence");
  need(signal.correlationId === "camera_health:cam-3", "correlationId must be stable per camera (not per event) for health transitions");
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

await check("submitCameraHealthCanonicalSignal: tamper_detected maps to critical severity", async () => {
  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;
  await submitCameraHealthCanonicalSignal({ cameraId: "cam-4", estateId: ESTATE_ID, transition: "tamper_detected", nextStatus: "tamper", observedAt: "2026-08-24T10:05:00Z" });
  need(receiveSpy.calls[0][0].severity === "critical", `expected critical severity for tamper_detected, got ${receiveSpy.calls[0][0].severity}`);
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// ---------------------------------------------------------------------
// 4. ingestEdgeDetections() -- Edge detection ingress.
// ---------------------------------------------------------------------
function seedCamera(overrides = {}) {
  const camera = { id: "cam-edge-1", estate_id: ESTATE_ID, edge_node_id: "node-1", name: "Edge Camera", metadata: { home_id: HOME_ID }, ...overrides };
  facilityCameras.push(camera);
  return camera;
}

await check("ingestEdgeDetections: new detection reaches Core exactly once with confidence/evidence/scope preserved; existing publication + notification behaviour unaffected", async () => {
  resetStore();
  const camera = seedCamera();
  cameraDetectionZones.push({ id: "zone-1", camera_id: camera.id, estate_id: ESTATE_ID, name: "Front Gate", restricted: false, minimum_confidence: null });
  const publishSpy = spy({ ok: true });
  const receiveSpy = spy({ receipt: { accepted: true } });
  const notifySpy = spy(undefined);
  eventBusModule.publishIntelligenceEvent = publishSpy;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;
  notificationServiceModule.NotificationService.sendToEstate = notifySpy;

  const observedAt = new Date().toISOString();
  const result = await ingestEdgeDetections({
    cameraId: camera.id, siteId: ESTATE_ID, nodeId: "node-1", provider: "hikvision",
    detections: [{ type: "fire", confidence: 0.97, observed_at: observedAt, zone_id: "zone-1" }],
  });

  need(result.ok === true, `expected ok:true, got ${JSON.stringify(result)}`);
  need(cameraEvents.length === 1, "existing camera_events write must be unaffected");
  need(cameraDetections.length === 1, "existing camera_detections write must be unaffected");
  need(publishSpy.calls.length === 1, "existing legacy publishIntelligenceEvent must still fire exactly once");
  need(notifySpy.calls.length === 1, "existing high/critical NotificationService.sendToEstate must still fire exactly once (fire -> critical)");
  need(receiveSpy.calls.length === 1, `canonical Core ingestion must fire exactly once, got ${receiveSpy.calls.length}`);
  const signal = receiveSpy.calls[0][0];
  need(signal.type === "camera.detection.observed", "canonical type must be camera.detection.observed");
  need(signal.estateId === ESTATE_ID, "estate scope must be preserved");
  need(signal.unitId === HOME_ID, "home scope (from camera metadata) must be preserved");
  need(signal.entity.id === camera.id, "entity id must be the real camera id");
  need(signal.entity.status === "fire", "raw detection type must be preserved verbatim");
  need(signal.evidence?.[0]?.metadata?.confidence === 0.97, "raw confidence must be preserved as evidence");
  need(signal.evidence?.[0]?.metadata?.zone_name === "Front Gate", "zone context must be preserved as evidence");

  eventBusModule.publishIntelligenceEvent = originalPublishIntelligenceEvent;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
  notificationServiceModule.NotificationService.sendToEstate = originalSendToEstate;
});

await check("ingestEdgeDetections: idempotent/duplicate detection does not create a second event or a second Core ingestion", async () => {
  resetStore();
  const camera = seedCamera();
  eventBusModule.publishIntelligenceEvent = spy({ ok: true });
  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;
  notificationServiceModule.NotificationService.sendToEstate = spy(undefined);

  const observedAt = new Date().toISOString();
  const detections = [{ type: "vehicle", confidence: 0.5, observed_at: observedAt, idempotency_key: "fixed-key-1" }];
  await ingestEdgeDetections({ cameraId: camera.id, siteId: ESTATE_ID, nodeId: "node-1", provider: "hikvision", detections });
  await ingestEdgeDetections({ cameraId: camera.id, siteId: ESTATE_ID, nodeId: "node-1", provider: "hikvision", detections });

  need(cameraEvents.length === 1, `existing deduplication must still suppress a second camera_events row, got ${cameraEvents.length}`);
  need(cameraDetections.length === 1, `existing idempotency-key deduplication must still suppress a second camera_detections row, got ${cameraDetections.length}`);
  need(receiveSpy.calls.length === 1, `a duplicate detection must not cause a second Core ingestion, got ${receiveSpy.calls.length}`);

  eventBusModule.publishIntelligenceEvent = originalPublishIntelligenceEvent;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
  notificationServiceModule.NotificationService.sendToEstate = originalSendToEstate;
});

await check("ingestEdgeDetections: an unavailable Core ingress cannot corrupt the persisted camera_events/camera_detections rows", async () => {
  resetStore();
  const camera = seedCamera();
  eventBusModule.publishIntelligenceEvent = spy({ ok: true });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = () => Promise.reject(new Error("core_unavailable"));
  notificationServiceModule.NotificationService.sendToEstate = spy(undefined);

  const observedAt = new Date().toISOString();
  const result = await ingestEdgeDetections({
    cameraId: camera.id, siteId: ESTATE_ID, nodeId: "node-1", provider: "hikvision",
    detections: [{ type: "person", confidence: 0.8, observed_at: observedAt }],
  });

  need(result.ok === true, "the detection ingest must still succeed even when Core ingestion fails");
  need(cameraEvents.length === 1, "camera_events row must still be created");
  need(cameraDetections.length === 1, "camera_detections row must still be created");

  eventBusModule.publishIntelligenceEvent = originalPublishIntelligenceEvent;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
  notificationServiceModule.NotificationService.sendToEstate = originalSendToEstate;
});

// ---------------------------------------------------------------------
// 5. createEvent() -- manual/API camera event path.
// ---------------------------------------------------------------------
function fakeReq({ body = {}, params = {} } = {}) {
  return { user: { id: "actor-1", role: "estate_admin", estate_id: ESTATE_ID }, params, body };
}

await check("createEvent: escalating security event reaches Core once; existing NotificationService.sendToRole fanout unaffected; shadow path adds zero extra notifications", async () => {
  resetStore();
  facilityCameras.push({ id: "cam-manual-1", estate_id: ESTATE_ID, name: "Manual Camera", metadata: { home_id: HOME_ID } });
  eventBusModule.publishIntelligenceEvent = spy({ ok: true });
  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;
  const notifyRoleSpy = spy(undefined);
  notificationServiceModule.NotificationService.sendToRole = notifyRoleSpy;

  const req = fakeReq({ params: { cameraId: "cam-manual-1" }, body: { event_type: "intrusion", confidence: 0.95 } });
  const res = fakeRes();
  await createEvent(req, res);

  need(res.body?.ok === true, `expected ok:true, got ${JSON.stringify(res.body)}`);
  need(notifyRoleSpy.calls.length === 4, `existing security escalation must still notify all 4 roles (security/manager/estate_admin/owner), got ${notifyRoleSpy.calls.length}`);
  need(receiveSpy.calls.length === 1, `canonical Core ingestion must fire exactly once, got ${receiveSpy.calls.length}`);
  const signal = receiveSpy.calls[0][0];
  need(signal.entity.status === "intrusion", "raw event_type must be preserved verbatim as entity.status");
  need(signal.estateId === ESTATE_ID && signal.unitId === HOME_ID, "estate/home scope must be preserved");

  eventBusModule.publishIntelligenceEvent = originalPublishIntelligenceEvent;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
  notificationServiceModule.NotificationService.sendToRole = originalSendToRole;
});

await check("createEvent: maintenance-flagged event type (camera_offline) is still submitted as a detection-shaped observation, and existing maintenance notification fanout is unaffected", async () => {
  resetStore();
  facilityCameras.push({ id: "cam-manual-2", estate_id: ESTATE_ID, name: "Manual Camera 2", metadata: {} });
  eventBusModule.publishIntelligenceEvent = spy({ ok: true });
  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;
  const notifyRoleSpy = spy(undefined);
  notificationServiceModule.NotificationService.sendToRole = notifyRoleSpy;

  const req = fakeReq({ params: { cameraId: "cam-manual-2" }, body: { event_type: "camera_offline", metadata: { source: "manual_offline_check" } } });
  const res = fakeRes();
  await createEvent(req, res);

  need(notifyRoleSpy.calls.length === 3, `existing maintenance escalation must still notify all 3 roles (manager/estate_admin/owner), got ${notifyRoleSpy.calls.length}`);
  need(receiveSpy.calls.length === 1, `canonical Core ingestion must fire exactly once, got ${receiveSpy.calls.length}`);
  need(receiveSpy.calls[0][0].entity.status === "camera_offline", "raw event_type must be preserved verbatim, not fabricated into a health transition (this endpoint has no prior-status field to diff against)");

  eventBusModule.publishIntelligenceEvent = originalPublishIntelligenceEvent;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
  notificationServiceModule.NotificationService.sendToRole = originalSendToRole;
});

await check("createEvent: an unavailable Core ingress cannot break event creation or the HTTP response", async () => {
  resetStore();
  facilityCameras.push({ id: "cam-manual-3", estate_id: ESTATE_ID, name: "Manual Camera 3", metadata: {} });
  eventBusModule.publishIntelligenceEvent = spy({ ok: true });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = () => Promise.reject(new Error("core_unavailable"));
  notificationServiceModule.NotificationService.sendToRole = spy(undefined);

  const req = fakeReq({ params: { cameraId: "cam-manual-3" }, body: { event_type: "motion", confidence: 0.4 } });
  const res = fakeRes();
  await createEvent(req, res);

  need(res.body?.ok === true, "event creation must still succeed even when Core ingestion fails");
  need(cameraEvents.length === 1, "camera_events row must still be created");

  eventBusModule.publishIntelligenceEvent = originalPublishIntelligenceEvent;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
  notificationServiceModule.NotificationService.sendToRole = originalSendToRole;
});

// ---------------------------------------------------------------------
// 6. platformGapService.upsertCameraInfrastructure() -- health/status
// projection. Proves the "no fabricated first-write transition" fix and
// routine-noise suppression.
// ---------------------------------------------------------------------
function fakeGapReq(body) {
  return { user: { id: "actor-1", role: "estate_admin", estate_id: ESTATE_ID }, body: { ...body, estate_id: ESTATE_ID }, query: {} };
}

await check("upsertCameraInfrastructure: first-ever projection write must not fabricate a transition", async () => {
  resetStore();
  facilityCameras.push({ id: "cam-infra-1", estate_id: ESTATE_ID, name: "Infra Camera" });
  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;

  const result = await platformGapService.upsertCameraInfrastructure(fakeGapReq({ camera_id: "cam-infra-1", health_state: "healthy" }));

  need(result.ok === true, "the projection write itself must succeed");
  need(cameraInfrastructure.length === 1, "existing camera_infrastructure upsert must be unaffected");
  need(receiveSpy.calls.length === 0, `a first-ever write (no prior row) must not submit a fabricated transition, got ${receiveSpy.calls.length} Core ingestion(s)`);

  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

await check("upsertCameraInfrastructure: a genuine health_state change reaches Core exactly once; a repeated identical write does not", async () => {
  resetStore();
  facilityCameras.push({ id: "cam-infra-2", estate_id: ESTATE_ID, name: "Infra Camera 2" });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = spy({ receipt: { accepted: true } });
  await platformGapService.upsertCameraInfrastructure(fakeGapReq({ camera_id: "cam-infra-2", health_state: "healthy" }));

  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;
  await platformGapService.upsertCameraInfrastructure(fakeGapReq({ camera_id: "cam-infra-2", health_state: "offline" }));
  need(receiveSpy.calls.length === 1, `a genuine health_state transition must reach Core exactly once, got ${receiveSpy.calls.length}`);
  need(receiveSpy.calls[0][0].type === "camera.connectivity.lost", "healthy -> offline must classify as connectivity_lost");

  const receiveSpyNoChange = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpyNoChange;
  await platformGapService.upsertCameraInfrastructure(fakeGapReq({ camera_id: "cam-infra-2", health_state: "offline" }));
  need(receiveSpyNoChange.calls.length === 0, `a repeated identical health_state must not flood Core with routine noise, got ${receiveSpyNoChange.calls.length}`);

  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// ---------------------------------------------------------------------
// 7. Cross-domain golden journey (Part 10): camera offline -> canonical
// signal -> REAL Core awareness -> camera/estate/home context ->
// maintenance-relevant operational recommendation. Uses the real,
// unmocked oyiCoreRuntime.receiveSignal() -- no Core internals are
// mocked here.
// ---------------------------------------------------------------------
await check("golden journey: a camera connectivity-lost signal becomes real, usable Core awareness with correct kind, context, and a maintenance-relevant recommendation", async () => {
  const envelope = await submitCameraHealthCanonicalSignal({
    cameraId: "cam-golden-1", cameraName: "Golden Journey Camera", estateId: ESTATE_ID, homeId: HOME_ID,
    transition: "connectivity_lost", previousStatus: "online", nextStatus: "offline", observedAt: new Date().toISOString(),
  });

  need(!!envelope, "the real Core runtime must return a non-null envelope");
  need(envelope.receipt.accepted === true, "the signal must be accepted by Core's real runtime");
  need(envelope.operational_signal.estateId === ESTATE_ID, "the estate scope must reach real Core awareness");
  need(envelope.operational_signal.unitId === HOME_ID, "the home scope must reach real Core awareness");
  const awareness = envelope.operational_awareness;
  need(!!awareness, "receiveSignal must produce operational awareness");
  need(awareness.kind === "security", `a camera signal must be classified as security-kind awareness, got ${awareness.kind}`);
  need(/connectivity|network|power/i.test(awareness.recommended_action || ""), `recommended_action must be maintenance-relevant for an offline camera, got "${awareness.recommended_action}"`);
  need(Array.isArray(envelope.operational_recommendations), "the reasoning pipeline must have run end-to-end (recommendations array present)");
  need(Array.isArray(envelope.operational_insights), "the reasoning pipeline must have run end-to-end (insights array present)");
});

// ---------------------------------------------------------------------
// 8. Structural proof: the camera canonical signal module never imports
// NotificationService -- the shadow path is structurally incapable of
// delivering a duplicate notification, not merely observed not to in
// the scenarios above.
// ---------------------------------------------------------------------
await check("structural: cameraCanonicalSignal.ts never imports NotificationService (shadow-only by construction)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(path.join(root, "src/oyi-core/domains/camera/cameraCanonicalSignal.ts"), "utf8");
  need(!/NotificationService/.test(src), "cameraCanonicalSignal.ts must not reference NotificationService at all");
});

supabaseModule.supabaseAdmin.from = originalFrom;

if (failures.length) {
  console.error(`FAIL oyi-camera-intelligence-convergence-smoke (${failures.length} failure(s)):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("oyi-camera-intelligence-convergence-smoke passed");
process.exit(0);
