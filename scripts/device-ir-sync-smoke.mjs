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
      control_profile: "climate",
      device_family: "climate",
      supported_controls: ["power", "temperature", "fan"],
      ir_appliance: { appliance_type: "ac", profile: "ac" },
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

assert(child.control_profile === "climate", "IR AC child preserves climate profile");
assert(child.device_family === "climate", "IR AC child preserves climate family");
assert(Array.isArray(child.supported_controls) && child.supported_controls.includes("temperature"), "IR AC child preserves supported commands");
