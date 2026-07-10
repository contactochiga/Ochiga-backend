#!/usr/bin/env node
const { enrichDeviceProviderState, summarizeDeviceFrontendContract } = await import("../dist/device/runtime/deviceStateEnrichment.js");

function assert(pass, label) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) process.exitCode = 1;
}

const acSwitch = summarizeDeviceFrontendContract(
  {
    name: "Room 2 AC Switch",
    type: "switch",
    category: "switch",
    metadata: { product_name: "2 Gang Wall Switch" },
  },
  {
    status: enrichDeviceProviderState({
      state: { switch_1: false, switch_2: true, online: true },
      functions: [{ code: "switch_1" }, { code: "switch_2" }],
      metadata: { product_name: "2 Gang Wall Switch" },
      device: { name: "Room 2 AC Switch", type: "switch", category: "switch" },
      provider: "tuya",
      adapter: "tuya",
    }),
  },
);

const heaterRelay = summarizeDeviceFrontendContract(
  {
    name: "Water Heater Relay",
    type: "relay",
    category: "switch",
    metadata: { product_name: "Power Relay" },
  },
  {
    status: enrichDeviceProviderState({
      state: { switch: true, online: true },
      functions: [{ code: "switch" }, { code: "countdown_1" }],
      metadata: { product_name: "Power Relay" },
      device: { name: "Water Heater Relay", type: "relay", category: "switch" },
      provider: "tuya",
      adapter: "tuya",
    }),
  },
);

const multiGang = enrichDeviceProviderState({
  state: { switch_1: true, switch_2: false, switch_3: true, online: true },
  functions: [{ code: "switch_1" }, { code: "switch_2" }, { code: "switch_3" }],
  metadata: { channel_names: { switch_1: "Main", switch_2: "Wall", switch_3: "Lamp" } },
  device: { name: "Living Room 3 Gang", type: "switch", category: "switch" },
  provider: "tuya",
  adapter: "tuya",
});

assert(acSwitch.control_profile === "switch", "AC-named switch remains a switch");
assert(acSwitch.device_family === "switch", "AC-named switch keeps switch family");
assert(heaterRelay.control_profile === "switch", "water-heater relay remains a switch");
assert(Array.isArray(multiGang.channel_definitions) && multiGang.channel_definitions.length === 3, "multi-gang switch exposes independent channels");
assert(multiGang.channel_definitions?.[1]?.name === "Wall", "channel overrides are preserved");
