#!/usr/bin/env node
const { buildAwarenessFromSignal } = await import("../dist/oyi-core/runtime/contextAwareness.js");

function assert(pass, label) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) process.exitCode = 1;
}

const outage = buildAwarenessFromSignal({
  id: "signal:power-outage",
  source: "system",
  type: "telemetry",
  timestamp: new Date().toISOString(),
  domain: "infrastructure",
  entity: {
    id: "power_outage:home-1",
    type: "infrastructure_event",
    name: "Power Outage",
    status: "offline",
  },
  metadata: {
    infrastructure_event_kind: "power_outage",
    affected_device_count: 6,
    affected_rooms: ["Living Room", "Bedroom"],
  },
});

const recovery = buildAwarenessFromSignal({
  id: "signal:internet-restored",
  source: "system",
  type: "telemetry",
  timestamp: new Date().toISOString(),
  domain: "infrastructure",
  entity: {
    id: "internet_restored:home-1",
    type: "infrastructure_event",
    name: "Internet Restored",
    status: "recovered",
  },
  metadata: {
    infrastructure_event_kind: "internet_restored",
    affected_device_count: 4,
    recovered_count: 4,
    duration_minutes: 18,
    still_affected_count: 1,
  },
});

assert(outage.title === "Power appears to have been lost", "power outage awareness title is natural");
assert(/power was lost/i.test(outage.summary), "power outage awareness summary explains grouped outage");
assert(/check the router|review any device/i.test(recovery.recommended_action.toLowerCase()), "recovery awareness returns an operational action");
assert(/restored|recovered/i.test(recovery.summary.toLowerCase()), "recovery awareness summary explains restoration");
