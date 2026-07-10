#!/usr/bin/env node
const { buildDeviceConversationPrompt } = await import("../dist/services/deviceIntelligenceService.js");

function assert(pass, label) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) process.exitCode = 1;
}

const prompt = buildDeviceConversationPrompt({
  memory_summary: {
    headline: "Oyi recognizes a routine.",
    summary: "Bedroom Light is often controlled by Evening Scene.",
    evidence: ["Usually seen with Evening Scene"],
    patterns: {
      last_used_at: new Date().toISOString(),
      average_runtime_minutes: 12,
      common_source: "scene",
      common_scene: "Evening Scene",
      common_automation: null,
      failure_count: 0,
    },
  },
  relationships: {
    room_name: "Bedroom",
    parent_device: null,
    child_devices: [],
    active_scenes: [{ id: "scene-1", name: "Evening Scene" }],
    active_automations: [],
    affected_if_offline: ["scene Evening Scene"],
  },
  predictive_findings: [{
    id: "slow-response",
    title: "Response time is slower than normal",
    summary: "The provider is accepting commands, but confirmation is taking longer than expected.",
    severity: "info",
    confidence: 0.73,
    evidence: [],
    recommended_action: "Wait for confirmation or retry if the state does not update.",
    owner: "provider",
    expiry: null,
    safe_automation_eligible: true,
  }],
  recent_executions: [],
  active_scenes: [{ id: "scene-1", name: "Evening Scene" }],
  active_automations: [],
  conversation_context: {
    current_state: "Off",
    health: "Healthy",
    provider_availability: "Healthy",
    room_name: "Bedroom",
    supported_controls: ["power"],
  },
});

assert(/Evening Scene/.test(prompt), "conversation prompt includes scene context");
assert(/provider is accepting commands/i.test(prompt), "conversation prompt includes predictive context");
