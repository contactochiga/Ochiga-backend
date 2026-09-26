#!/usr/bin/env node
import { allowSmokeHttp, assertRuntimeIsolation, isolation } from "./helpers/runtime-smoke-isolation.mjs";

const appModule = await import("../dist/app.js");
const app = appModule.default?.default || appModule.default || appModule;
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

const server = app.listen(0, "127.0.0.1");
const port = await new Promise((resolve) => server.once("listening", () => resolve(server.address().port)));
allowSmokeHttp(server);
const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
// /metrics is now guarded (Fix 6) — authenticate with the ops token.
const metricsRes = await fetch(`http://127.0.0.1:${port}/metrics`, {
  headers: { Authorization: `Bearer ${process.env.OYI_OPS_TOKEN}` },
});
const health = await healthRes.json();
const metricsText = await metricsRes.text();
server.close();

const runtime = runtimeHealthRegistry.summary();
const providers = providerHealthRegistry.snapshot();

const checks = [
  [envelope.operational_signal.id === "smoke:signal:1", "signal envelope created"],
  [envelope.operational_awareness?.related_signals.includes("smoke:signal:1") &&
    [...isolation.signals.values()][0].materialization.prepared.rows.awareness[0].awareness_key === envelope.operational_awareness.id,
    "real awareness generated and registered with canonical signal-scoped identity"],
  [envelope.materialization?.materializationComplete === true, "materialization port acknowledgement consumed"],
  [healthRes.status === 200 && health.status === "ok", "health endpoint healthy"],
  [metricsRes.status === 200 && metricsText.includes("http_requests_total"), "metrics endpoint exposed"],
  [metricsText.includes("oyi_signals_received_total"), "signal metrics exposed"],
  [metricsText.includes("oyi_runtime_stage_latency_ms"), "runtime latency metrics exposed"],
  [Array.isArray(runtime.runtime) && runtime.runtime.length > 0, "runtime stages recorded"],
  [Array.isArray(providers) && providers.length >= 10, "provider registry initialized"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, label] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

assertRuntimeIsolation({ signal: true });
process.exitCode = failures.length ? 1 : 0;
