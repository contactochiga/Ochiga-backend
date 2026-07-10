#!/usr/bin/env node
const {
  buildDeviceMemorySummary,
  buildDeviceRelationshipSummary,
  buildDevicePredictiveFindings,
  buildDeviceConversationPrompt,
} = await import("../dist/services/deviceIntelligenceService.js");

function assert(pass, label) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) process.exitCode = 1;
}

const memory = buildDeviceMemorySummary({
  deviceName: "Bedroom Light",
  counter: {
    last_used_at: new Date().toISOString(),
    total_toggles: 8,
    failure_count: 2,
    command_failure_count: 1,
    last_source: "scene",
  },
  recentEvents: [
    { source: "scene", metadata: { scene_name: "Evening Scene" } },
    { source: "automation", metadata: { automation_name: "Good Morning" } },
  ],
});

const relationships = buildDeviceRelationshipSummary({
  device: { room_name: "Bedroom" },
  parent: { id: "hub-1", name: "Bedroom IR Hub" },
  children: [{ id: "child-1", name: "Bedroom TV", metadata: { control_profile: "tv" } }],
  scenes: [{ id: "scene-1", name: "Evening Scene", enabled: true }],
  automations: [{ id: "auto-1", name: "Sleep Routine", enabled: true }],
});

const findings = buildDevicePredictiveFindings({
  summary: {
    health_status: "offline",
    provider_health: "offline",
    telemetry_summary: { battery: 10 },
    supported_controls: ["power"],
  },
  memory,
  relationships,
  counter: { average_response_ms: 6200 },
});

const prompt = buildDeviceConversationPrompt({
  memory_summary: memory,
  relationships,
  predictive_findings: findings,
  recent_executions: [],
  active_scenes: relationships.active_scenes,
  active_automations: relationships.active_automations,
  conversation_context: {
    current_state: "Offline",
    health: "Offline",
    provider_availability: "Offline",
    room_name: "Bedroom",
    supported_controls: ["power"],
  },
});

assert(memory.patterns.failure_count === 3, "device memory aggregates failure patterns");
assert(relationships.child_devices.length === 1, "device relationships preserve child dependencies");
assert(findings.length >= 2, "predictive findings are produced from health and memory");
assert(/Evening Scene|offline|Bedroom/.test(prompt), "conversation prompt includes memory or dependency context");
