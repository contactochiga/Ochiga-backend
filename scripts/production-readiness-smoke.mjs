#!/usr/bin/env node
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";

const { oyiCoreRuntime } = await import("../dist/oyi-core/service.js");
const { operationalMetrics } = await import("../dist/observability/metrics.js");
const { runtimeHealthRegistry } = await import("../dist/observability/runtimeHealth.js");
const { providerHealthRegistry } = await import("../dist/observability/providerHealth.js");

const envelope = await oyiCoreRuntime.receiveSignal({
  id: "smoke:signal:1",
  source: "mqtt",
  domain: "device.health",
  entity: { id: "device-1", type: "switch", name: "Living Room Switch", status: "stable" },
  estate: { id: "estate-1", name: "JEDAA Homes" },
  room: { id: "room-1", name: "Living Room" },
  actor: { id: "system", type: "system", role: "runtime" },
  metadata: { status: "stable", summary: "Device telemetry normalized." },
});

const metricsText = operationalMetrics.toPrometheus();
const runtime = runtimeHealthRegistry.summary();
const providers = providerHealthRegistry.snapshot();

const checks = [
  [envelope.operational_signal.id === "smoke:signal:1", "signal envelope created"],
  [envelope.operational_awareness?.id === "awareness:smoke:signal:1", "awareness generated"],
  [metricsText.includes("oyi_signals_received_total"), "signal metrics exposed"],
  [metricsText.includes("oyi_runtime_stage_latency_ms"), "runtime latency metrics exposed"],
  [Array.isArray(runtime.runtime) && runtime.runtime.length > 0, "runtime stages recorded"],
  [Array.isArray(providers) && providers.length >= 10, "provider registry initialized"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, label] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failures.length) process.exit(1);
