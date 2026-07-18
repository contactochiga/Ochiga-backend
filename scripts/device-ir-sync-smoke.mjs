#!/usr/bin/env node
const { summarizeDeviceFrontendContract } = await import("../dist/device/runtime/deviceStateEnrichment.js");

function assert(pass, label) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) process.exitCode = 1;
}

const child = summarizeDeviceFrontendContract(
  {
    id: "ir-child-1",
    name: "Bedroom AC",
    type: "ir_virtual_device",
    category: "remote",
    metadata: {
      virtual_device: true,
      control_profile: "air_conditioner",
      device_family: "climate",
      supported_controls: ["power", "temperature", "mode", "fan_speed"],
      ir_appliance: { appliance_type: "air_conditioner", profile: "ac" },
    },
  },
  {
    status: {
      switch: true,
      online: true,
      temperature: 24,
    },
  },
);

assert(child.control_profile === "air_conditioner", "IR AC child preserves air-conditioner profile");
assert(child.device_family === "climate", "IR AC child preserves climate family");
assert(Array.isArray(child.supported_controls) && child.supported_controls.includes("temperature"), "IR AC child preserves supported commands");
assert(child.supported_controls.includes("fan_speed"), "IR AC child exposes canonical fan-speed control");
