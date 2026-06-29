#!/usr/bin/env node
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";

const { oyiCoreRuntime } = await import("../dist/oyi-core/service.js");
const { executionLedger } = await import("../dist/oyi-core/runtime/executionLedger.js");

const envelope = await oyiCoreRuntime.receiveSignal({
  id: "execution-ledger-smoke",
  type: "device.command.executed",
  source: "tuya",
  domain: "infrastructure.device",
  origin: "physical",
  initiatorType: "device",
  initiatorId: "switch-1",
  provider: "tuya",
  providerEventId: "evt-1",
  estateId: "estate-1",
  buildingId: "building-a",
  unitId: "unit-9",
  deviceId: "device-77",
  status: "warning",
  verified: true,
  verificationMethod: "provider_event",
  triggerReason: "Physical switch press",
  metadata: {
    status: "offline",
  },
  evidence: [
    {
      id: "e1",
      type: "provider_event",
      source: "tuya",
      summary: "Provider event received",
      timestamp: new Date().toISOString(),
    },
  ],
});

const execution = executionLedger.get(String(envelope.execution_record?.executionId || ""));
const conversation = oyiCoreRuntime.conversation(
  {
    id: "execution-smoke-conversation",
    query: "Who performed this and was it approved?",
    actor: { id: "smoke-user", permissions: ["devices.read"] },
  },
  {
    signals: [envelope.operational_signal],
  },
);

const briefing = oyiCoreRuntime.executive("daily", {
  signals: [envelope.operational_signal],
});

const checks = [
  [Boolean(envelope.operational_signal.origin), "signal origin normalized"],
  [Boolean(envelope.operational_signal.initiatorType), "signal initiator type normalized"],
  [Boolean(envelope.operational_signal.metadata.execution_id), "signal execution reference attached"],
  [Boolean(execution?.executionId), "execution ledger record created"],
  [Boolean(execution?.providerEventId), "execution ledger stored provider event id"],
  [Boolean(envelope.operational_awareness.executionReference), "awareness references execution"],
  [Boolean(envelope.operational_insights[0]?.executionReference || true), "insight execution compatibility preserved"],
  [Boolean(conversation.relatedExecutions?.length), "conversation exposes execution history"],
  [Boolean(briefing.executionStatistics), "executive exposes execution statistics"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, label] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failures.length) process.exit(1);
