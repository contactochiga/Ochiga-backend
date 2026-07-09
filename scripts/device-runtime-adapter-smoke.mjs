#!/usr/bin/env node
const {
  enrichDeviceProviderState,
  diffEnrichedDeviceState,
  summarizeDeviceFrontendContract,
} = await import("../dist/device/runtime/deviceStateEnrichment.js");

const previous = enrichDeviceProviderState({
  state: {
    switch: false,
    online: true,
    _oyi_timeline: {
      source: "provider_reported",
    },
  },
  functions: [{ code: "switch" }, { code: "countdown_1" }],
  metadata: { product_name: "Wall Switch" },
  device: {
    name: "Bedroom Light",
    type: "switch",
    category: "light",
    provider: "tuya",
    adapter: "tuya",
  },
  provider: "tuya",
  adapter: "tuya",
});

const next = enrichDeviceProviderState({
  state: {
    switch: true,
    online: true,
    bright_value: 70,
    _oyi_timeline: {
      source: "provider_reported",
    },
  },
  functions: [{ code: "switch" }, { code: "bright_value" }, { code: "countdown_1" }],
  metadata: { product_name: "Wall Switch" },
  device: {
    name: "Bedroom Light",
    type: "switch",
    category: "light",
    provider: "tuya",
    adapter: "tuya",
  },
  provider: "tuya",
  adapter: "tuya",
});

const change = diffEnrichedDeviceState(previous, next);
const contract = summarizeDeviceFrontendContract(
  {
    id: "device-1",
    name: "Bedroom Light",
    type: "switch",
    category: "light",
    capabilities: ["switch"],
    provider: "tuya",
    adapter: "tuya",
    metadata: { product_name: "Wall Switch" },
  },
  {
    status: next,
    last_seen: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
);

const checks = [
  [next.normalized_state?.power === true, "power state normalized"],
  [next.control_profile === "switch", "control profile inferred"],
  [Array.isArray(next.supported_controls) && next.supported_controls.includes("power"), "supported controls include power"],
  [change.event_type === "device.power.on", "state diff detects power-on event"],
  [Array.isArray(change.changed_keys) && change.changed_keys.length > 0, "changed keys are captured"],
  [contract.primary_state === "on", "frontend contract exposes primary state"],
  [contract.health_status === "stable", "frontend contract exposes health status"],
  [Array.isArray(contract.capabilities) && contract.capabilities.includes("switch"), "frontend contract preserves capabilities"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, label] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failures.length) process.exit(1);
