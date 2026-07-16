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

const tvRemote = summarizeDeviceFrontendContract(
  {
    name: "Living Room TV",
    category: "unknown",
    metadata: {
      raw: { category: "wnykq", product_name: "Universal IR Remote", model: "IR-01" },
      device_family: "ir_remote",
      control_profile: "ir_remote",
      product_name: "Universal IR Remote",
      model: "IR-01",
    },
  },
  {
    status: enrichDeviceProviderState({
      state: { power: false, online: true },
      functions: [{ code: "power" }, { code: "key_code" }],
      metadata: {
        raw: { category: "wnykq", product_name: "Universal IR Remote", model: "IR-01" },
        device_family: "ir_remote",
        control_profile: "ir_remote",
        product_name: "Universal IR Remote",
        model: "IR-01",
      },
      device: { name: "Living Room TV", category: "wnykq", type: "wnykq" },
      provider: "tuya",
      adapter: "tuya",
    }),
  },
);

const acRemote = summarizeDeviceFrontendContract(
  {
    name: "Bedroom AC Remote",
    category: "thermostat",
    metadata: {
      raw: { category: "kt", product_name: "AC Remote", model: "AC-IR" },
      device_family: "climate",
      control_profile: "climate",
      product_name: "AC Remote",
      model: "AC-IR",
    },
  },
  {
    status: enrichDeviceProviderState({
      state: { power: true, temp_set: 24, mode: "cool", fan_speed: "auto", swing: false, online: true },
      functions: [{ code: "power" }, { code: "temp_set" }, { code: "mode" }, { code: "fan_speed" }, { code: "swing" }],
      metadata: {
        raw: { category: "kt", product_name: "AC Remote", model: "AC-IR" },
        device_family: "climate",
        control_profile: "climate",
        product_name: "AC Remote",
        model: "AC-IR",
      },
      device: { name: "Bedroom AC Remote", category: "kt", type: "kt" },
      provider: "tuya",
      adapter: "tuya",
    }),
  },
);

const smartPlug = summarizeDeviceFrontendContract(
  {
    name: "Smart Plug",
    category: "socket",
    metadata: {
      raw: { category: "cz", product_name: "Smart Plug" },
      device_family: "plug",
      control_profile: "plug",
    },
  },
  {
    status: enrichDeviceProviderState({
      state: { switch: true, online: true },
      functions: [{ code: "switch" }],
      metadata: { raw: { category: "cz", product_name: "Smart Plug" }, device_family: "plug", control_profile: "plug" },
      device: { name: "Smart Plug", category: "cz", type: "cz" },
      provider: "tuya",
      adapter: "tuya",
    }),
  },
);

assert(acSwitch.control_profile === "switch", "AC-named switch remains a switch");
assert(acSwitch.device_family === "switch", "AC-named switch keeps switch family");
assert(heaterRelay.control_profile === "switch", "water-heater relay remains a switch");
assert(Array.isArray(multiGang.channel_definitions) && multiGang.channel_definitions.length === 3, "multi-gang switch exposes independent channels");
assert(multiGang.channel_definitions?.[1]?.name === "Wall", "channel overrides are preserved");
assert(tvRemote.device_family === "ir_remote", "Tuya IR TV remote preserves IR family");
assert(tvRemote.control_profile === "ir_remote", "Tuya IR TV remote preserves IR profile");
assert(tvRemote.supported_controls.includes("remote"), "Tuya IR TV remote supports remote control");
assert(tvRemote.supported_controls.includes("power"), "Tuya IR TV remote can expose remote power without becoming a switch");
assert(!["switch", "plug"].includes(tvRemote.control_profile), "Tuya IR TV remote is not rendered as switch or plug");
assert(acRemote.device_family === "climate", "Tuya AC remote preserves climate family");
assert(acRemote.control_profile === "climate", "Tuya AC remote preserves climate profile");
assert(["power", "temperature", "mode", "fan", "swing"].every((control) => acRemote.supported_controls.includes(control)), "Tuya AC remote exposes climate controls");
assert(smartPlug.device_family === "plug", "Tuya smart plug preserves plug family");
assert(smartPlug.control_profile === "plug", "Tuya smart plug preserves plug profile");
