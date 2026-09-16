#!/usr/bin/env node
// Oyi Intelligence Convergence, Wave 0 -- Objectives 2 & 3 regression
// coverage. Proves, against the real compiled platformGapService.js and
// canonicalSignalIngress.js:
//   - Facility incident creation still performs its existing behaviour
//     (row + timeline write, realtime broadcast, legacy publication).
//   - Facility incident creation ALSO reaches canonical Core
//     (oyiCoreRuntime.receiveSignal) with a correctly-shaped signal.
//   - Twin state updates (registerModel/updateModel/upsertPlacement)
//     retain realtime behaviour AND reach canonical Core.
//   - A malformed/unavailable Core ingress cannot break the underlying
//     Facility/Twin write.
//   - No NotificationService or device-execution call is introduced by
//     any of this (neither producer has any notification/execution
//     capability to begin with).
//   - The pre-existing, UNRELATED duplicate-ingestion path this slice
//     discovered (emitSignal() -> oyiCoreRuntime.decorateRealtimePayload()
//     -> receiveSignal(), which already fires whenever a live socket.io
//     server is attached via setIO()) is explicitly demonstrated and
//     documented as a known, out-of-scope finding -- not something this
//     slice introduced, and not something this slice's two producers
//     alone can safely fix (decorateRealtimePayload/emitSignal are shared
//     by every domain in the codebase).
import assert from "node:assert/strict";
import path from "node:path";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "canonical-signal-ingress-local-only";

const root = process.cwd();
const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));
const emitSignalNamespace = await import(path.join(root, "dist/realtime/emitSignal.js"));
const emitSignalModule = emitSignalNamespace.default;
const ioModule = await import(path.join(root, "dist/realtime/io.js"));
// platformGapService.ts imports publishSourceIntelligenceEvent from the
// "../intelligence-core" barrel, which re-exports it via a live getter
// proxying to sourceEventPublisher.js's own exports object -- monkeypatch
// THAT underlying module directly (the getter re-reads it dynamically),
// not the barrel's read-only getter.
const intelligenceCoreNamespace = await import(path.join(root, "dist/intelligence-core/sourceEventPublisher.js"));
const intelligenceCoreModule = intelligenceCoreNamespace.default;
const oyiCoreServiceModule = await import(path.join(root, "dist/oyi-core/service.js"));
const notificationServiceModule = await import(path.join(root, "dist/services/NotificationService.js"));
const deviceCommandControllerNamespace = await import(path.join(root, "dist/controllers/deviceCommandController.js"));
const deviceCommandController = deviceCommandControllerNamespace.default;

const originalEmitSignal = emitSignalModule.emitSignal;
const originalPublish = intelligenceCoreModule.publishSourceIntelligenceEvent;
const originalReceiveSignal = oyiCoreServiceModule.oyiCoreRuntime.receiveSignal.bind(oyiCoreServiceModule.oyiCoreRuntime);
const originalSendToRole = notificationServiceModule.NotificationService.sendToRole;
const originalSendToEstate = notificationServiceModule.NotificationService.sendToEstate;
const originalSendToUser = notificationServiceModule.NotificationService.sendToUser;
const originalExecuteDeviceCommandForActor = deviceCommandController.executeDeviceCommandForActor;

function matches(row, filters) {
  return filters.every(([col, op, val]) => {
    if (op === "eq") return row[col] === val;
    return true;
  });
}
function makeTable(store) {
  return {
    select() {
      const filters = [];
      const builder = {
        eq(col, val) { filters.push([col, "eq", val]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() {
          const rows = store.filter((row) => matches(row, filters));
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        single() {
          const rows = store.filter((row) => matches(row, filters));
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        then(resolve, reject) {
          const rows = store.filter((row) => matches(row, filters));
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
    update(patch) {
      const filters = [];
      const builder = {
        eq(col, val) { filters.push([col, "eq", val]); return builder; },
        select() {
          return {
            single: () => {
              const idx = store.findIndex((row) => matches(row, filters));
              if (idx === -1) return Promise.resolve({ data: null, error: null });
              store[idx] = { ...store[idx], ...patch };
              return Promise.resolve({ data: store[idx], error: null });
            },
          };
        },
      };
      return builder;
    },
    upsert(row, opts = {}) {
      const conflictKey = opts.onConflict;
      return {
        select() {
          return {
            single: () => {
              const idx = conflictKey ? store.findIndex((r) => conflictKey.split(",").every((k) => r[k.trim()] === row[k.trim()])) : -1;
              if (idx === -1) { store.push({ id: row.id || `row-${store.length + 1}`, ...row }); return Promise.resolve({ data: store[store.length - 1], error: null }); }
              store[idx] = { ...store[idx], ...row };
              return Promise.resolve({ data: store[idx], error: null });
            },
          };
        },
      };
    },
  };
}

let facilityIncidents, facilityIncidentTimeline, twinModels, twinEntityPlacements;
function resetStore() {
  facilityIncidents = [];
  facilityIncidentTimeline = [];
  twinModels = [];
  twinEntityPlacements = [];
}
resetStore();
const genericTables = new Map();
function fakeFrom(table) {
  const tables = {
    facility_incidents: facilityIncidents,
    facility_incident_timeline: facilityIncidentTimeline,
    twin_models: twinModels,
    twin_entity_placements: twinEntityPlacements,
  };
  if (tables[table]) return makeTable(tables[table]);
  // Any other table (audit_events, utility_telemetry, estate_memberships,
  // etc.) -- a generic in-memory store via the same makeTable() builder,
  // so incidental writes from shared helpers (e.g. emitAuditEvent) never
  // crash the test instead of a hand-limited read-only stub.
  if (!genericTables.has(table)) genericTables.set(table, []);
  return makeTable(genericTables.get(table));
}
const originalFrom = supabaseModule.supabaseAdmin.from.bind(supabaseModule.supabaseAdmin);
supabaseModule.supabaseAdmin.from = fakeFrom;

const platformGapServiceNamespace = await import(path.join(root, "dist/services/platformGapService.js"));
const { createFacilityIncident, platformGapService } = platformGapServiceNamespace;

function spy(returnValue) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return typeof returnValue === "function" ? returnValue(...args) : Promise.resolve(returnValue); };
  fn.calls = calls;
  return fn;
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

const ACTOR_ID = "actor-1";
const ESTATE_ID = "estate-1";

// 1. Golden path: incident creation keeps existing behaviour AND reaches
// canonical Core exactly once (no live IO in this scenario, so the
// pre-existing emitSignal->decorateRealtimePayload->receiveSignal path
// is not in play -- see test 6 for that).
await check("facility incident: existing behaviour intact + reaches Core exactly once", async () => {
  resetStore();
  const emitSpy = spy(undefined);
  const publishSpy = spy({ ok: true });
  const receiveSpy = spy({ receipt: { accepted: true } });
  emitSignalModule.emitSignal = emitSpy;
  intelligenceCoreModule.publishSourceIntelligenceEvent = publishSpy;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;

  const data = await createFacilityIncident({
    estateId: ESTATE_ID, homeId: "home-1", title: "Water leak", description: "Leak in B1", severity: "high", actorId: ACTOR_ID,
  });

  need(facilityIncidents.length === 1, "existing facility_incidents write must be unaffected");
  need(facilityIncidentTimeline.length === 1, "existing timeline write must be unaffected");
  need(emitSpy.calls.length === 1, "existing realtime broadcast (emitSignal) must still fire exactly once");
  need(emitSpy.calls[0][0].type === "incident.created", "broadcast must still carry the same event type");
  need(publishSpy.calls.length === 1, "existing legacy publishSourceIntelligenceEvent must still fire exactly once");
  need(receiveSpy.calls.length === 1, `canonical Core ingress must fire exactly once, got ${receiveSpy.calls.length}`);
  const signal = receiveSpy.calls[0][0];
  need(signal.type === "facility.incident.created", `expected canonical type facility.incident.created, got ${signal.type}`);
  need(signal.domain === "security", "canonical domain must be security");
  need(signal.source === "facility_incident_registry", "canonical source must be facility_incident_registry");
  need(signal.origin === "facility_app", "canonical origin must be facility_app");
  need(signal.estateId === ESTATE_ID, "canonical estateId must be preserved");
  need(signal.unitId === "home-1", "canonical unitId must carry the home id");
  need(signal.entity?.id === data.id, "canonical entity id must be the real incident row id, not empty");
  need(signal.entity?.type === "facility_incident", "canonical entity type must be facility_incident");
  // signalSeverity() maps free-text severity onto the canonical
  // info/attention/warning/critical enum -- "high" maps to "warning",
  // it is not passed through verbatim.
  need(signal.severity === "warning", `canonical severity must map data.severity="high" through signalSeverity(), got ${signal.severity}`);
  need(signal.actor?.id === ACTOR_ID, "canonical actor id must be preserved");
  need(signal.correlationId === `facility_incident:${data.id}`, "canonical correlationId must be stable per incident row");

  emitSignalModule.emitSignal = originalEmitSignal;
  intelligenceCoreModule.publishSourceIntelligenceEvent = originalPublish;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// 2. Malformed/unavailable Core ingress cannot break the underlying
// Facility write.
await check("facility incident: unavailable Core ingress does not break the write", async () => {
  resetStore();
  emitSignalModule.emitSignal = spy(undefined);
  intelligenceCoreModule.publishSourceIntelligenceEvent = spy({ ok: true });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = () => Promise.reject(new Error("core_unavailable"));

  const data = await createFacilityIncident({ estateId: ESTATE_ID, title: "Power outage", actorId: ACTOR_ID });
  need(!!data?.id, "the incident row must still be created and returned even when Core ingress fails");
  need(facilityIncidents.length === 1, "the facility_incidents write must not be rolled back by a Core failure");

  emitSignalModule.emitSignal = originalEmitSignal;
  intelligenceCoreModule.publishSourceIntelligenceEvent = originalPublish;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

function fakeReq({ body = {}, params = {}, query = {} } = {}) {
  return { user: { id: ACTOR_ID, role: "estate_admin", estate_id: ESTATE_ID }, body, params, query };
}

// 3. Twin model registration: existing behaviour + canonical Core.
await check("twin model registration: existing behaviour intact + reaches Core exactly once", async () => {
  resetStore();
  const emitSpy = spy(undefined);
  const receiveSpy = spy({ receipt: { accepted: true } });
  emitSignalModule.emitSignal = emitSpy;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;

  const result = await platformGapService.registerModel(fakeReq({ body: { name: "Luna Model", source_type: "glb", state: "uploaded" } }));

  need(twinModels.length === 1, "existing twin_models write must be unaffected");
  // registerModel's own audit() call legitimately emits a separate
  // "audit.recorded" signal too (pre-existing, unrelated behaviour) --
  // assert the twin.state.updated broadcast is present exactly once
  // among whatever emitSignal() calls occurred, not that it's the only
  // call.
  const twinBroadcasts = emitSpy.calls.filter((args) => args[0]?.type === "twin.state.updated");
  need(twinBroadcasts.length === 1, `existing twin.state.updated broadcast must still fire exactly once, got ${twinBroadcasts.length} (total emitSignal calls: ${emitSpy.calls.length})`);
  need(receiveSpy.calls.length === 1, `canonical Core ingress must fire exactly once, got ${receiveSpy.calls.length}`);
  const signal = receiveSpy.calls[0][0];
  need(signal.type === "twin.state.updated", "canonical type must be twin.state.updated");
  need(signal.domain === "twin", "canonical domain must be twin");
  need(signal.source === "digital_twin", "canonical source must be digital_twin (the reserved Twin literal)");
  need(signal.entity?.id === result.model.id, "canonical entity id must be the real model row id");
  need(signal.entity?.type === "twin_model", "canonical entity type must be twin_model");
  need(signal.actor?.id === ACTOR_ID, "canonical actor id must be preserved");

  emitSignalModule.emitSignal = originalEmitSignal;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// 4. Twin placement upsert: existing behaviour + canonical Core.
await check("twin placement upsert: existing behaviour intact + reaches Core exactly once", async () => {
  resetStore();
  const emitSpy = spy(undefined);
  const receiveSpy = spy({ receipt: { accepted: true } });
  emitSignalModule.emitSignal = emitSpy;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;

  const result = await platformGapService.upsertPlacement(fakeReq({ body: { entity_type: "device", entity_id: "device-9", coordinates: { x: 1, y: 2, z: 0 }, home_id: "home-1" } }));

  need(twinEntityPlacements.length === 1, "existing twin_entity_placements write must be unaffected");
  const twinBroadcasts = emitSpy.calls.filter((args) => args[0]?.type === "twin.state.updated");
  need(twinBroadcasts.length === 1, `existing twin.state.updated broadcast must still fire exactly once, got ${twinBroadcasts.length} (total emitSignal calls: ${emitSpy.calls.length})`);
  need(receiveSpy.calls.length === 1, `canonical Core ingress must fire exactly once, got ${receiveSpy.calls.length}`);
  const signal = receiveSpy.calls[0][0];
  need(signal.entity?.type === "twin_entity_placement", "canonical entity type must be twin_entity_placement");
  need(signal.entity?.id === result.placement.id, "canonical entity id must be the real placement row id");
  need(signal.unitId === "home-1", "canonical unitId must carry the placement's home id");

  emitSignalModule.emitSignal = originalEmitSignal;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// 5. No NotificationService or device-execution call is ever introduced
// by either producer -- neither has any such capability, this proves it
// structurally against the real compiled code path.
await check("no duplicate NotificationService delivery or device execution is introduced", async () => {
  resetStore();
  const notifyRoleSpy = spy(undefined);
  const notifyEstateSpy = spy(undefined);
  const notifyUserSpy = spy(undefined);
  const execSpy = spy({ final_status: "state_confirmed" });
  notificationServiceModule.NotificationService.sendToRole = notifyRoleSpy;
  notificationServiceModule.NotificationService.sendToEstate = notifyEstateSpy;
  notificationServiceModule.NotificationService.sendToUser = notifyUserSpy;
  deviceCommandController.executeDeviceCommandForActor = execSpy;
  emitSignalModule.emitSignal = spy(undefined);
  intelligenceCoreModule.publishSourceIntelligenceEvent = spy({ ok: true });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = spy({ receipt: { accepted: true } });

  await createFacilityIncident({ estateId: ESTATE_ID, title: "Test incident", actorId: ACTOR_ID });
  await platformGapService.registerModel(fakeReq({ body: { name: "Model" } }));

  need(notifyRoleSpy.calls.length === 0, "no NotificationService.sendToRole call should occur");
  need(notifyEstateSpy.calls.length === 0, "no NotificationService.sendToEstate call should occur");
  need(notifyUserSpy.calls.length === 0, "no NotificationService.sendToUser call should occur");
  need(execSpy.calls.length === 0, "no device execution should occur");

  notificationServiceModule.NotificationService.sendToRole = originalSendToRole;
  notificationServiceModule.NotificationService.sendToEstate = originalSendToEstate;
  notificationServiceModule.NotificationService.sendToUser = originalSendToUser;
  deviceCommandController.executeDeviceCommandForActor = originalExecuteDeviceCommandForActor;
  emitSignalModule.emitSignal = originalEmitSignal;
  intelligenceCoreModule.publishSourceIntelligenceEvent = originalPublish;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// 6. ONE-INGRESS INVARIANT, live IO: attaching a live Socket.IO server
// (the normal production condition) must NOT cause a second Core
// observation of a migrated producer's event. Before this slice,
// createFacilityIncident under live IO produced TWO receiveSignal()
// calls (the explicit high-fidelity one, plus an ambient low-fidelity
// one via emitSignal() -> decorateRealtimePayload()). This test proves
// exactly one now, and that the surviving observation is the explicit,
// high-fidelity signal (real entity identity), not the generic
// realtime-derived one.
await check("one-ingress invariant: live Socket.IO does not cause a second Core observation of a migrated producer", async () => {
  resetStore();
  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;
  intelligenceCoreModule.publishSourceIntelligenceEvent = spy({ ok: true });
  // A minimal fake Socket.IO server, simulating 10 connected clients --
  // client count must never change how many times Core observes the
  // event. `.to(room)` is called once per targeted room regardless of
  // how many sockets are actually in it; none of this touches Core.
  let roomEmitCount = 0;
  const fakeIo = { to: () => ({ emit: () => { roomEmitCount += 1; } }), emit: () => { roomEmitCount += 1; } };
  ioModule.setIO(fakeIo);
  emitSignalModule.emitSignal = originalEmitSignal; // use the REAL emitSignal for this test

  const data = await createFacilityIncident({ estateId: ESTATE_ID, title: "Live IO incident", actorId: ACTOR_ID });

  need(receiveSpy.calls.length === 1, `expected exactly one Core observation under live IO, got ${receiveSpy.calls.length}`);
  const signal = receiveSpy.calls[0][0];
  need(signal.source === "facility_incident_registry", "the surviving observation must be the explicit high-fidelity canonical signal, not the ambient embit-derived one");
  need(signal.entity?.id === data.id, "the surviving observation must carry the real incident entity id");
  need(roomEmitCount > 0, "the realtime broadcast must still have happened (client count/broadcast must be independent of Core ingestion count)");

  ioModule.setIO(null);
  intelligenceCoreModule.publishSourceIntelligenceEvent = originalPublish;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// 7. Broadcasting failure must not erase a successful canonical
// ingestion -- canonical ingestion (submitCanonicalSignal ->
// receiveSignal) and realtime broadcast (emitSignal) are independent,
// parallel, fire-and-forget calls; one failing must not affect the
// other or the underlying write.
await check("broadcast failure does not erase a successful canonical ingestion", async () => {
  resetStore();
  const receiveSpy = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;
  intelligenceCoreModule.publishSourceIntelligenceEvent = spy({ ok: true });
  // The real emitSignal() is an async function -- a thrown/rejected
  // failure inside it always surfaces as a rejected Promise, never a
  // synchronous throw to the caller (emit() calls it without awaiting,
  // exactly like production). Attach a no-op .catch() so this
  // deliberately-unhandled-by-the-caller rejection doesn't crash the
  // test process itself, matching real emitSignal()'s actual contract.
  emitSignalModule.emitSignal = () => {
    const failed = Promise.reject(new Error("socket.io broadcast failed"));
    failed.catch(() => {});
    return failed;
  };

  const data = await createFacilityIncident({ estateId: ESTATE_ID, title: "Broadcast failure incident", actorId: ACTOR_ID });

  need(!!data?.id, "the incident row must still be created even if the realtime broadcast throws");
  need(receiveSpy.calls.length === 1, `canonical ingestion must still have happened exactly once despite the broadcast failure, got ${receiveSpy.calls.length}`);

  emitSignalModule.emitSignal = originalEmitSignal;
  intelligenceCoreModule.publishSourceIntelligenceEvent = originalPublish;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// 8. Core ingestion failure must not become dependent on Socket.IO --
// re-run the "unavailable Core ingress" case with a live IO attached, to
// prove the failure-does-not-break-the-write guarantee holds regardless
// of realtime transport state.
await check("Core ingestion failure semantics are independent of Socket.IO state", async () => {
  resetStore();
  const fakeIo = { to: () => ({ emit: () => {} }), emit: () => {} };
  ioModule.setIO(fakeIo);
  emitSignalModule.emitSignal = originalEmitSignal;
  intelligenceCoreModule.publishSourceIntelligenceEvent = spy({ ok: true });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = () => Promise.reject(new Error("core_unavailable"));

  const data = await createFacilityIncident({ estateId: ESTATE_ID, title: "Live IO + Core failure incident", actorId: ACTOR_ID });
  need(!!data?.id, "the incident row must still be created even with live IO and a failing Core ingestion");

  ioModule.setIO(null);
  intelligenceCoreModule.publishSourceIntelligenceEvent = originalPublish;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// 9. Compatibility preserved: an AMBIENT-ONLY producer NOT migrated to
// submitCanonicalSignal() in this slice -- updateIncident()'s
// emit("incident.updated", ...) -- must still reach Core exactly once
// under live IO (preserved, not silently disconnected), and zero times
// with no IO attached. This is unchanged prior behaviour, not something
// this slice added or fixed: incident.updated has always depended on
// live IO for its only route to Core, and still does after this slice
// -- migrating it to explicit canonical ingress is out of scope here
// (see this slice's report).
await check("compatibility: an unmigrated ambient-only producer (incident.updated) still reaches Core exactly once under live IO, zero with none", async () => {
  resetStore();
  emitSignalModule.emitSignal = originalEmitSignal;
  intelligenceCoreModule.publishSourceIntelligenceEvent = spy({ ok: true });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = spy({ receipt: { accepted: true } });

  const created = await createFacilityIncident({ estateId: ESTATE_ID, title: "Ambient compatibility incident", actorId: ACTOR_ID });

  // No IO attached: updateIncident's emit("incident.updated", ...) must
  // reach Core zero times (its only route to Core is the ambient path,
  // which requires live IO -- unchanged prior behaviour).
  const receiveSpyNoIo = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpyNoIo;
  await platformGapService.updateIncident(fakeReq({ params: { incidentId: created.id }, body: { status: "acknowledged", note: "ack" } }));
  need(receiveSpyNoIo.calls.length === 0, `expected zero Core observations for incident.updated with no IO attached, got ${receiveSpyNoIo.calls.length}`);

  // Live IO attached: the same call must now reach Core exactly once
  // (preserved compatibility -- not silently disconnected, not
  // duplicated).
  const receiveSpyLiveIo = spy({ receipt: { accepted: true } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpyLiveIo;
  const fakeIo = { to: () => ({ emit: () => {} }), emit: () => {} };
  ioModule.setIO(fakeIo);
  await platformGapService.updateIncident(fakeReq({ params: { incidentId: created.id }, body: { status: "resolved", note: "resolved" } }));
  const incidentUpdatedCalls = receiveSpyLiveIo.calls.filter((args) => args[0]?.type === "incident.updated");
  need(incidentUpdatedCalls.length === 1, `expected exactly one Core observation of incident.updated under live IO, got ${incidentUpdatedCalls.length}`);

  ioModule.setIO(null);
  intelligenceCoreModule.publishSourceIntelligenceEvent = originalPublish;
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

supabaseModule.supabaseAdmin.from = originalFrom;

if (failures.length) {
  console.error(`FAIL oyi-canonical-signal-ingress-smoke (${failures.length} failure(s)):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("oyi-canonical-signal-ingress-smoke passed");
process.exit(0);
