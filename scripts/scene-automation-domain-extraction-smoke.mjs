import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const runtimeSource = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const sceneAnswers = read("src/oyi-core/domains/automations/sceneAutomationConversationAnswers.ts");
const sceneEvidence = read("src/oyi-core/domains/automations/sceneAutomationEvidence.ts");
const targetCandidates = read("src/oyi-core/context/conversationTargetCandidates.ts");
const hydrationRegistry = read("src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts");
const scenesRoute = read("src/routes/scenes.ts");
const batchService = read("src/services/residentActionBatchExecutionService.ts");
const capabilityRegistry = read("src/oyi-core/runtime/domainCapabilityRegistry.ts");
const runtime = await import(path.join(root, "dist/oyi-core/runtime/canonicalConversationRuntime.js"));

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const staleDevice = {
  object_type: "device",
  canonical_id: "device-living-room-light",
  label: "Living Room Light",
  estate_id: "estate-1",
  home_id: "home-1",
  room_id: "living-room",
  source_module: "devices",
  capabilities: ["power"],
  current_state: "on",
  health: "healthy",
  permissions: ["devices.read"],
  relationships: {},
  evidence_references: [],
  metadata: {},
  freshness: "fresh",
};

const sceneObject = {
  object_type: "scene",
  canonical_id: "scene-good-night",
  label: "Good Night",
  estate_id: "estate-1",
  home_id: "home-1",
  room_id: null,
  source_module: "scenes",
  capabilities: ["scenes.read", "scenes.run"],
  current_state: "enabled",
  health: "ready",
  permissions: ["scenes.read"],
  relationships: {
    scenes: [{ id: "scene-good-night", name: "Good Night", enabled: true, actions: [{ device_id: "device-1", command: { switch_1: false } }] }],
  },
  evidence_references: [],
  metadata: { actions: [{ device_id: "device-1", command: { switch_1: false } }] },
  freshness: "fresh",
};

const automationObject = {
  object_type: "automation",
  canonical_id: "automation-morning",
  label: "Morning Routine",
  estate_id: "estate-1",
  home_id: "home-1",
  room_id: null,
  source_module: "automations",
  capabilities: ["automations.read", "automations.manage"],
  current_state: "enabled",
  health: "completed",
  permissions: ["automations.read"],
  relationships: {
    automations: [{ id: "automation-morning", name: "Morning Routine", enabled: true, trigger: { type: "schedule" }, last_run_status: "completed" }],
  },
  evidence_references: [],
  metadata: { trigger: { type: "schedule", schedule_type: "daily", local_time: "07:00" }, actions: [{ device_id: "device-1", command: { switch_1: true } }] },
  freshness: "fresh",
};

check("scene and automation domains own object behavior and evidence normalization", () => {
  assert.match(sceneAnswers, /sceneAutomationObjectProfile/);
  assert.match(sceneAnswers, /sceneAutomationObjectVoice/);
  assert.match(sceneAnswers, /sceneAutomationRecommendation/);
  assert.match(sceneAnswers, /sceneAutomationContextualActions/);
  assert.match(sceneAnswers, /buildSceneAutomationReviewAnswer/);
  assert.match(sceneEvidence, /sceneAutomationRecordsFromContext/);
  assert.match(sceneEvidence, /sceneAutomationExecutionBoundary/);
  assert.doesNotMatch(runtimeSource, /I coordinate the devices and conditions attached to this scene\./);
  assert.doesNotMatch(runtimeSource, /I track this automation's trigger, conditions, actions, and last execution\./);
});

check("scene and automation targets use shared target and hydration architecture", () => {
  assert.match(targetCandidates, /scene: "scene"/);
  assert.match(targetCandidates, /automation: "automation"/);
  assert.match(hydrationRegistry, /scene: \{ table: "consumer_scenes"/);
  assert.match(hydrationRegistry, /automation: \{ table: "consumer_automations"/);
  assert.match(runtimeSource, /resolveConversationTarget/);
  assert.match(runtimeSource, /hydrateOperationalObjectCandidate/);
});

check("listing scenes and automations is read-only and rejects stale device inheritance", () => {
  for (const [message, domain] of [["Show scenes.", "scenes"], ["What automations are active?", "automations"]]) {
    const result = runtime.canonicalResolvedTurnForTest({
      message,
      object: staleDevice,
      surface: "consumer",
      request: { estate_id: "estate-1", home_id: "home-1" },
    });
    assert.equal(result.resolved_turn.domain, domain, message);
    assert.equal(result.contract.intent, "domain_list", message);
    assert.equal(result.contract.operation_class, "list", message);
    assert.equal(result.contract.mutation.requested, false, message);
    assert.notEqual(result.contract.target.object_type, "device", message);
  }
});

check("reading scene contents and automation status does not execute devices", () => {
  const scene = runtime.canonicalResolvedTurnForTest({
    message: "What devices does it control?",
    object: sceneObject,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(scene.resolved_turn.domain, "scenes");
  assert.equal(scene.contract.intent, "domain_list");
  assert.equal(scene.contract.mutation.requested, false);

  const automation = runtime.canonicalResolvedTurnForTest({
    message: "Is this automation disabled?",
    object: automationObject,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(automation.resolved_turn.domain, "automations");
  assert.equal(automation.contract.intent, "domain_list");
  assert.equal(automation.contract.mutation.requested, false);
});

check("scene execution and automation lifecycle changes become governed review work", () => {
  const run = runtime.canonicalResolvedTurnForTest({
    message: "Run it.",
    object: sceneObject,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(run.resolved_turn.domain, "scenes");
  assert.equal(run.contract.intent, "scene_execution");
  assert.equal(run.contract.operation_class, "compose");
  assert.equal(run.presentation_policy.primary, "review");
  assert.equal(run.contract.mutation.requested, false);

  for (const message of ["Disable the morning automation.", "Delete this automation.", "Turn that routine back on."]) {
    const result = runtime.canonicalResolvedTurnForTest({
      message,
      object: automationObject,
      surface: "consumer",
      request: { estate_id: "estate-1", home_id: "home-1" },
    });
    assert.equal(result.resolved_turn.domain, "automations", message);
    assert.equal(result.contract.intent, "automation_operation", message);
    assert.equal(result.contract.operation_class, "compose", message);
    assert.equal(result.contract.mutation.requested, false, message);
  }
});

check("automation creation is draft/proposal while immediate light command remains device control", () => {
  const scheduled = runtime.canonicalResolvedTurnForTest({
    message: "Turn lights off every night.",
    object: null,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(scheduled.resolved_turn.domain, "automations");
  assert.equal(scheduled.contract.intent, "automation_operation");
  assert.equal(scheduled.contract.operation_class, "compose");

  const immediate = runtime.canonicalResolvedTurnForTest({
    message: "Turn it off now.",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(immediate.resolved_turn.domain, "devices");
  assert.equal(immediate.contract.intent, "device_control");
});

check("broad automation queries clear exact inherited scene or automation targets while legitimate continuation works", () => {
  const followUp = runtime.canonicalResolvedTurnForTest({
    message: "Run it.",
    object: sceneObject,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(followUp.contract.scope_mode, "exact_target");
  assert.equal(followUp.contract.target.object_type, "scene");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Run it.", object: sceneObject }), true);

  const broad = runtime.canonicalResolvedTurnForTest({
    message: "Show all my automations.",
    object: automationObject,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(broad.resolved_turn.domain, "automations");
  assert.equal(broad.contract.intent, "domain_list");
  assert.notEqual(broad.contract.target.object_type, "automation");
});

check("scene and automation execution stay owned by scene routes and canonical device command pipeline", () => {
  assert.match(scenesRoute, /executeResidentActionBatch/);
  assert.match(scenesRoute, /canonicalizeSceneActions/);
  assert.match(scenesRoute, /consumer_automation_runs/);
  assert.match(scenesRoute, /scene\.run\.requested/);
  assert.match(batchService, /executeDeviceCommandForActor/);
  assert.match(batchService, /commandExecutionId/);
  assert.doesNotMatch(runtimeSource, /executeResidentActionBatch/);
  assert.doesNotMatch(runtimeSource, /consumer_automation_runs/);
});

check("scope, recommendation, and persistence boundaries remain explicit", () => {
  assert.match(scenesRoute, /hasWatchScope/);
  assert.match(scenesRoute, /requirePermission\("devices\.control"\)/);
  assert.match(capabilityRegistry, /domain: "scenes"/);
  assert.match(capabilityRegistry, /domain: "automations"/);
  assert.match(sceneEvidence, /oyi_conversation_threads/);
  assert.match(sceneEvidence, /consumer_scenes/);
  assert.match(sceneEvidence, /consumer_automations/);
  assert.match(sceneEvidence, /device_command_executions/);
});

console.log("scene-automation-domain-extraction-smoke passed");
