#!/usr/bin/env node
const { buildDeviceRelationshipSummary } = await import("../dist/services/deviceIntelligenceService.js");

function assert(pass, label) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) process.exitCode = 1;
}

const summary = buildDeviceRelationshipSummary({
  device: { room_name: "Living Room" },
  parent: { id: "hub-1", name: "Living Room IR Hub" },
  children: [
    { id: "tv-1", name: "Living Room TV", metadata: { control_profile: "tv" } },
    { id: "fan-1", name: "Living Room Fan", metadata: { control_profile: "ir_remote" } },
  ],
  scenes: [{ id: "scene-1", name: "Movie Night", enabled: true }],
  automations: [{ id: "auto-1", name: "Good Night", enabled: true }],
});

assert(summary.parent_device?.name === "Living Room IR Hub", "relationship summary includes parent hubs");
assert(summary.child_devices.length === 2, "relationship summary includes virtual children");
assert(summary.affected_if_offline.length >= 2, "relationship summary explains downstream impact");
