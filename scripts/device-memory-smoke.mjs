#!/usr/bin/env node
const { buildDeviceMemorySummary } = await import("../dist/services/deviceIntelligenceService.js");

function assert(pass, label) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) process.exitCode = 1;
}

const summary = buildDeviceMemorySummary({
  deviceName: "Kitchen Switch",
  counter: {
    last_used_at: new Date().toISOString(),
    total_toggles: 12,
    last_source: "physical_switch",
  },
  recentEvents: [{ source: "physical_switch" }],
});

assert(summary.headline.length > 0, "memory summary exposes a headline");
assert(summary.patterns.common_source === "manual", "physical source is translated into manual usage memory");
assert(summary.evidence.some((line) => /recorded switch/i.test(line)), "memory evidence includes usage facts");
