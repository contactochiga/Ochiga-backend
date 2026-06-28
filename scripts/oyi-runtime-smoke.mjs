#!/usr/bin/env node
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";

const deliveries = [];
const realtimeEvents = [];

const fakeIo = {
  emit(event, payload) {
    realtimeEvents.push({ scope: "global", event, payload });
  },
  to(scope) {
    return {
      emit(event, payload) {
        realtimeEvents.push({ scope, event, payload });
      },
      to(nextScope) {
        return fakeIo.to(`${scope}|${nextScope}`);
      },
    };
  },
};

const { setIO } = await import("../dist/realtime/io.js");
const { runtimeSubscriptionEngine } = await import("../dist/oyi-core/runtime/runtimeSubscriptions.js");
const { oyiCoreRuntime } = await import("../dist/oyi-core/service.js");

setIO(fakeIo);

const unsubscribe = runtimeSubscriptionEngine.register({
  id: "smoke-runtime-subscriber",
  channels: ["facility:signal", "facility:awareness", "facility:insight", "facility:recommendation", "facility:automation"],
  onEvent(delivery) {
    deliveries.push(delivery);
  },
});

const envelope = await oyiCoreRuntime.receiveSignal({
  id: "smoke-runtime-signal",
  type: "device.state.reported",
  source: "mqtt",
  deviceId: "device-1",
  estateId: "estate-1",
  roomId: "room-1",
  state: { online: true, switch: true },
  status: "info",
  metadata: { status: "online" },
});

oyiCoreRuntime.emitRealtime("device.state.reported", {
  deviceId: "device-1",
  estateId: "estate-1",
  roomId: "room-1",
}, envelope);

await new Promise((resolve) => setTimeout(resolve, 25));

const conversation = oyiCoreRuntime.conversation(
  {
    id: "smoke-conversation",
    query: "What changed?",
    actor: { id: "smoke-user", permissions: ["devices.read"] },
  },
  {
    signals: [
      {
        id: "conversation-signal",
        source: "mqtt",
        domain: "device.health",
        entity: { id: "device-1", status: "warning", name: "Living Room Switch" },
        estate: { id: "estate-1" },
        room: { id: "room-1" },
        actor: { id: "system", role: "runtime" },
        metadata: { status: "offline" },
      },
    ],
  },
);

unsubscribe();

const checks = [
  [Boolean(envelope?.operational_signal?.id), "signal ingestion accepted at runtime boundary"],
  [Boolean(envelope?.bundle?.signals?.length), "signal ingestion returned runtime bundle"],
  [deliveries.length > 0, "runtime subscriptions delivered events"],
  [realtimeEvents.some((item) => item.event === "signal"), "realtime signal emitted"],
  [realtimeEvents.some((item) => item.event === "device.state.reported"), "realtime domain event emitted"],
  [Boolean(conversation?.summary || conversation?.answer || conversation?.response), "conversation runtime evaluated"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, label] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failures.length) process.exit(1);
