#!/usr/bin/env node
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";

const { providerHealthRegistry } = await import("../dist/observability/providerHealth.js");
const { initAdaptersOnce } = await import("../dist/device/adapters/initAdapters.js");

initAdaptersOnce();

providerHealthRegistry.heartbeat("mqtt", { latencyMs: 42, note: "smoke_event", wired: true });
providerHealthRegistry.failure("mqtt", new Error("smoke_failure"));
providerHealthRegistry.reconnect("mqtt");

const snapshot = providerHealthRegistry.snapshot();
const mqtt = snapshot.find((item) => item.provider === "mqtt");
const tuya = snapshot.find((item) => item.provider === "tuya");
const onvif = snapshot.find((item) => item.provider === "onvif");
const placeholders = ["matter", "ble", "thread", "zigbee", "modbus", "bacnet", "knx", "ir"]
  .map((provider) => snapshot.find((item) => item.provider === provider))
  .filter(Boolean);

const checks = [
  [Boolean(mqtt?.lastSuccessAt), "mqtt last success tracked"],
  [Boolean(mqtt?.lastFailureAt), "mqtt last failure tracked"],
  [Number(mqtt?.reconnects || 0) >= 1, "mqtt reconnect tracked"],
  [Number(mqtt?.failures || 0) >= 1, "mqtt failure count tracked"],
  [typeof mqtt?.healthScore === "number", "mqtt health score tracked"],
  [Boolean(tuya), "tuya provider registered"],
  [Boolean(onvif), "onvif provider registered"],
  [placeholders.length === 8 && placeholders.every((item) => item?.wired === false), "placeholder providers initialized"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, label] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failures.length) process.exit(1);
