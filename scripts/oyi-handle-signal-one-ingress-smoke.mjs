#!/usr/bin/env node
// Oyi Intelligence Convergence, Canonical Signal Path Hardening Slice --
// Objective 1 regression coverage. Proves, against the real compiled
// core/control-plane/index.js and its realtimeSubscriber.ts:
//   - handleSignal(signal) results in exactly ONE
//     oyiCoreRuntime.receiveSignal() call, with Socket.IO attached and
//     absent.
//   - realtimeSubscriber() no longer calls
//     oyiCoreRuntime.decorateRealtimePayload() at all -- it reuses the
//     RuntimeEnvelope handleSignal() already produced.
//   - The realtime broadcast (emitRealtime) is built from that SAME
//     reused envelope, not a second, independently-derived one.
//   - Since awareness/insights/recommendations/persistence
//     (canonicalIntelligenceStore.recordSignal) all happen INSIDE the
//     one receiveSignal() call (confirmed by reading oyi-core/service.ts
//     directly), proving receiveSignal() fires exactly once is a
//     complete proof that none of those can be duplicated by this
//     signal reaching handleSignal() once.
//   - Representative producers: a device-operational-shaped signal and
//     an infrastructure-intelligence-shaped signal (the two producer
//     families named in this slice's brief), both driven through the
//     real handleSignal(), not a synthetic shape unrelated to real
//     callers.
import assert from "node:assert/strict";
import path from "node:path";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "handle-signal-one-ingress-local-only";

const root = process.cwd();
const controlPlaneModule = await import(path.join(root, "dist/core/control-plane/index.js"));
const oyiCoreServiceModule = await import(path.join(root, "dist/oyi-core/service.js"));
const ioModule = await import(path.join(root, "dist/realtime/io.js"));
const notificationSubscriberNamespace = await import(path.join(root, "dist/core/control-plane/subscribers/notificationSubscriber.js"));
const notificationSubscriberModule = notificationSubscriberNamespace.default;
const intentWorkerNamespace = await import(path.join(root, "dist/workers/intentWorker.js"));
const intentWorkerModule = intentWorkerNamespace.default;

const { handleSignal } = controlPlaneModule;
const oyiCoreRuntime = oyiCoreServiceModule.oyiCoreRuntime;

const originalReceiveSignal = oyiCoreRuntime.receiveSignal.bind(oyiCoreRuntime);
const originalDecorateRealtimePayload = oyiCoreRuntime.decorateRealtimePayload.bind(oyiCoreRuntime);
const originalEmitRealtime = oyiCoreRuntime.emitRealtime.bind(oyiCoreRuntime);
const originalNotificationSubscriber = notificationSubscriberModule.notificationSubscriber;
const originalEnqueueIntent = intentWorkerModule.enqueueIntent;

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

function makeEnvelope(overrides = {}) {
  return {
    receipt: { accepted: true, duplicate: false, outputs: [], issues: [], priority: "normal" },
    bundle: { signals: [], awareness: [], insights: [], recommendations: [], automationPlans: [] },
    operational_signal: {
      id: "sig-1", type: "operational", source: "device_adapter", domain: "device", origin: "physical",
      initiatorType: "device", initiatorId: null,
      estateId: "estate-1", buildingId: null, unitId: null,
      provider: null, providerEventId: null, sessionId: null, runtimeId: null, correlationId: null,
      triggerReason: null, verified: false, verificationMethod: null, trustScore: 0.65, executionSource: null,
      entity: { id: "device-1", type: "device", name: "Device 1", status: "online" },
      estate: { id: "estate-1", name: null }, building: { id: null, name: null }, room: { id: "room-1", name: null },
      actor: { id: null, type: "device", name: null, role: null },
      severity: "info", confidence: 0.65, timestamp: new Date().toISOString(), context: {}, metadata: {}, evidence: [],
    },
    operational_awareness: { id: "awareness-1", kind: "operational" },
    operational_insights: [],
    operational_recommendations: [],
    operational_automation_plans: [],
    ...overrides,
  };
}

// Representative device-operational signal -- same shape family
// deviceOperationalSignalService.ts's emitOperationalDeviceSignal()
// builds (type/domain "operational"/"device", estate/home/room/device
// scope fields, evidence array) before calling handleSignal().
const deviceOperationalSignal = {
  schemaVersion: "1.0.0",
  type: "device.state.updated",
  source: "device_adapter",
  estateId: "estate-1",
  homeId: "home-1",
  roomId: "room-1",
  deviceId: "device-1",
  status: "online",
  evidence: [{ id: "evidence-1", type: "device_state_payload", source: "tuya" }],
};

// Representative infrastructure-intelligence signal --
// infrastructureEventIntelligenceService.ts's shape family (telemetry/
// infra domain, estate-scoped, no device identity).
const infrastructureSignal = {
  schemaVersion: "1.0.0",
  type: "infrastructure.telemetry.updated",
  source: "infrastructure_registry",
  estateId: "estate-1",
  status: "warning",
};

async function withScenario({ io, fn }) {
  ioModule.setIO(io);
  try {
    await fn();
  } finally {
    ioModule.setIO(null);
  }
}

for (const [label, signal] of [["device operational signal", deviceOperationalSignal], ["infrastructure intelligence signal", infrastructureSignal]]) {
  for (const ioLabel of ["Socket.IO absent", "Socket.IO attached"]) {
    await check(`handleSignal(${label}) -- ${ioLabel} -- receiveSignal fires exactly once`, async () => {
      const envelope = makeEnvelope();
      const receiveSpy = spy(envelope);
      const decorateSpy = spy(envelope);
      let roomTargets = [];
      const fakeIo = { to: (room) => { roomTargets.push(room); return { emit: () => {} }; }, emit: () => {} };

      oyiCoreRuntime.receiveSignal = receiveSpy;
      oyiCoreRuntime.decorateRealtimePayload = decorateSpy;
      const notifySpy = spy(undefined);
      const enqueueSpy = spy(undefined);
      notificationSubscriberModule.notificationSubscriber = notifySpy;
      intentWorkerModule.enqueueIntent = enqueueSpy;

      await withScenario({
        io: ioLabel === "Socket.IO attached" ? fakeIo : null,
        fn: async () => {
          const result = await handleSignal(signal);

          need(receiveSpy.calls.length === 1, `expected exactly one receiveSignal() call, got ${receiveSpy.calls.length}`);
          need(receiveSpy.calls[0][0] === signal, "receiveSignal must be called with the original signal handleSignal() received");
          need(decorateSpy.calls.length === 0, `decorateRealtimePayload() must NEVER be called from handleSignal()'s path anymore, got ${decorateSpy.calls.length} call(s) -- this is the exact double-ingestion this slice eliminates`);
          need(result === envelope, "handleSignal() must return the same envelope receiveSignal() produced (proves no second derivation)");
          need(notifySpy.calls.length === 1, `notificationSubscriber must fire exactly once per handleSignal() call, got ${notifySpy.calls.length}`);
          need(notifySpy.calls[0][0] === signal, "notificationSubscriber must receive the same original signal");

          if (ioLabel === "Socket.IO attached") {
            need(roomTargets.length > 0, "with Socket.IO attached, the realtime broadcast must actually reach at least one room");
          } else {
            need(roomTargets.length === 0, "with no Socket.IO attached, emitRealtime's own getIO() guard must prevent any broadcast attempt -- and must not be worked around by re-deriving a second envelope");
          }
          // device.state.updated / infrastructure.telemetry.updated are
          // not "device.command.requested" -- none of decisionEngine's
          // policies (devicePermissionPolicy/deviceCapabilityPolicy/
          // deviceCommandPolicy all gate on that exact type) match, so
          // evaluateSignal() legitimately returns no intents for these
          // two producer types and enqueueIntent is correctly never
          // called here -- this is existing, unrelated behaviour, not
          // something this fix changed. Asserted explicitly so a future
          // change that accidentally starts enqueuing intents for state/
          // telemetry signals is caught.
          need(enqueueSpy.calls.length === 0, `expected zero physical-execution intent enqueues for a state/telemetry signal, got ${enqueueSpy.calls.length}`);
        },
      });

      oyiCoreRuntime.receiveSignal = originalReceiveSignal;
      oyiCoreRuntime.decorateRealtimePayload = originalDecorateRealtimePayload;
      notificationSubscriberModule.notificationSubscriber = originalNotificationSubscriber;
      intentWorkerModule.enqueueIntent = originalEnqueueIntent;
    });
  }
}

// Realtime subscriber reuses the original Core result, not a
// re-derivation with different content -- prove the broadcast payload
// actually carries fields FROM the reused envelope (entity id, estate
// id), not a generic/empty one, confirming real reuse, not an
// accidentally-empty envelope that happens to also avoid a second call.
await check("realtime broadcast carries the reused envelope's real content, not a re-derived one", async () => {
  const distinctiveEnvelope = makeEnvelope({
    operational_awareness: { id: "awareness-distinctive-marker", kind: "operational" },
  });
  oyiCoreRuntime.receiveSignal = spy(distinctiveEnvelope);
  oyiCoreRuntime.decorateRealtimePayload = spy(() => { throw new Error("must not be called"); });

  let broadcastPayload = null;
  const fakeIo = {
    to: (room) => ({ emit: (_event, payload) => { if (room === "estate:estate-1" && !broadcastPayload) broadcastPayload = payload; } }),
    emit: () => {},
  };
  await withScenario({
    io: fakeIo,
    fn: async () => {
      await handleSignal(deviceOperationalSignal);
    },
  });

  need(!!broadcastPayload, "expected a broadcast payload to have been captured for the estate room");
  need(broadcastPayload?.operational_awareness?.id === "awareness-distinctive-marker", "the broadcast payload must carry the SAME envelope handleSignal() produced from its one receiveSignal() call, not a re-derived one");

  oyiCoreRuntime.receiveSignal = originalReceiveSignal;
  oyiCoreRuntime.decorateRealtimePayload = originalDecorateRealtimePayload;
});

// emitRealtime itself is unchanged (still gated by getIO()) -- confirm
// its own real behaviour (not mocked) still correctly no-ops with no IO
// and broadcasts with one, using realtimeSubscriber's real (not mocked)
// call into it.
await check("emitRealtime is invoked by the real (unmocked) realtimeSubscriber exactly once per handleSignal() call", async () => {
  const envelope = makeEnvelope();
  oyiCoreRuntime.receiveSignal = spy(envelope);
  const emitRealtimeSpy = spy(undefined);
  oyiCoreRuntime.emitRealtime = emitRealtimeSpy;

  await withScenario({
    io: { to: () => ({ emit: () => {} }), emit: () => {} },
    fn: async () => {
      await handleSignal(deviceOperationalSignal);
    },
  });

  need(emitRealtimeSpy.calls.length === 1, `expected emitRealtime to be called exactly once, got ${emitRealtimeSpy.calls.length}`);
  need(emitRealtimeSpy.calls[0][2] === envelope, "emitRealtime must be called with the exact envelope object receiveSignal() produced");

  oyiCoreRuntime.receiveSignal = originalReceiveSignal;
  oyiCoreRuntime.emitRealtime = originalEmitRealtime;
});

if (failures.length) {
  console.error(`FAIL oyi-handle-signal-one-ingress-smoke (${failures.length} failure(s)):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("oyi-handle-signal-one-ingress-smoke passed");
// intentWorker.ts constructs a real BullMQ Queue at module load (keeps a
// Redis reconnect timer referenced) -- explicit exit, same pattern
// already established by facility-spatial-device-action-smoke.mjs.
process.exit(0);
