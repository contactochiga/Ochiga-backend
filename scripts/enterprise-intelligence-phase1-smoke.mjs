import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const parser = await import(path.join(root, "dist/oyi-core/interpretation/SemanticFrameParser.js"));
const workflow = await import(path.join(root, "dist/oyi-core/workflows/WorkflowStateMachine.js"));
const actions = await import(path.join(root, "dist/oyi-core/actions/ActionStateMachine.js"));
const idempotency = await import(path.join(root, "dist/oyi-core/actions/ActionIdempotency.js"));
const freshness = await import(path.join(root, "dist/oyi-core/contracts/freshness.js"));
const policy = await import(path.join(root, "dist/oyi-core/domains/devices/deviceObservationPolicy.js"));
const registry = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityRegistry.js"));
const deviceAdapter = await import(path.join(root, "dist/oyi-core/domains/devices/DeviceDomainAdapter.js"));
const firewall = await import(path.join(root, "dist/oyi-core/presentation/FallbackFirewall.js"));

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check("semantic frame keeps living room as device constraint", () => {
  const frame = parser.parseSemanticFrame("Turn off living room light");
  assert.equal(frame.domain, "devices");
  assert.equal(frame.operation, "device.power.off");
  assert.equal(frame.primaryEntity.type, "device");
  assert.ok(frame.constraints.some((constraint) => constraint.type === "room" && /living room/i.test(constraint.normalizedText)));
});

check("wallet typo variants normalize to the same semantic route", () => {
  const correct = parser.parseSemanticFrame("Show wallet history");
  const typo = parser.parseSemanticFrame("Show wallet histry");
  const spaced = parser.parseSemanticFrame("Show wallet transaction s");
  assert.equal(correct.operation, "wallet.history");
  assert.equal(typo.operation, "wallet.history");
  assert.equal(spaced.domain, "wallet");
});

check("workflow transitions are explicit and invalid skips are blocked", () => {
  assert.equal(workflow.canTransitionWorkflow("collecting_inputs", "awaiting_clarification"), true);
  assert.equal(workflow.canTransitionWorkflow("awaiting_clarification", "ready_for_review"), true);
  assert.equal(workflow.canTransitionWorkflow("collecting_inputs", "completed"), false);
  assert.throws(() => workflow.assertWorkflowTransition("collecting_inputs", "completed"), /Invalid workflow transition/);
});

check("action transitions protect terminal non-reuse", () => {
  assert.equal(actions.canTransitionAction("awaiting_confirmation", "approved"), true);
  assert.equal(actions.canTransitionAction("confirmed", "approved"), false);
  assert.equal(actions.isTerminalActionStatus("confirmed"), true);
  assert.throws(() => actions.assertActionTransition("confirmed", "approved"), /Invalid action transition/);
});

check("action idempotency is stable for repeated requests", () => {
  const input = {
    actorId: "actor-1",
    threadId: "thread-1",
    target: { object_type: "device", canonical_id: "device-1", label: "Lamp", channel_code: "switch_1" },
    operation: "device.power.off",
    requestedState: false,
  };
  assert.equal(idempotency.actionIdempotencyKey(input), idempotency.actionIdempotencyKey({ ...input }));
});

check("device freshness policies have distinct inactive and viewed thresholds", () => {
  const viewed = policy.DEVICE_OBSERVATION_POLICIES.currently_viewed_switch;
  const inactive = policy.DEVICE_OBSERVATION_POLICIES.inactive_switch;
  assert.ok(viewed.expired_after_ms < inactive.expired_after_ms);
  const old = new Date(Date.now() - 5 * 60_000).toISOString();
  assert.equal(freshness.classifyFreshness(viewed, old), "expired");
  assert.equal(freshness.classifyFreshness(inactive, old), "fresh");
});

check("capability registry enforces enabled adapter functions", () => {
  assert.throws(() => registry.capabilityRegistry.register({
    key: "broken.enabled",
    domain: "home",
    rolloutStatus: "enabled",
    supports: () => true,
    resolve: async () => ({ supported: true, reason: null }),
    collectEvidence: async () => [],
  }), /no executable adapter/);
});

check("device adapter is executable and supports device frames", () => {
  const frame = parser.parseSemanticFrame("Is this channel on?");
  assert.equal(deviceAdapter.deviceDomainAdapter.supports(frame), true);
  assert.equal(typeof deviceAdapter.deviceDomainAdapter.buildReadResponse, "function");
});

check("generic fallback firewall blocks unevidenced success", () => {
  assert.throws(() => firewall.assertNoUnverifiedGenericSuccess("Done. Home completed the request successfully.", 0), /blocked/);
  assert.doesNotThrow(() => firewall.assertNoUnverifiedGenericSuccess("I cannot verify that yet.", 0));
});

check("routes use orchestrator and legacy adapter owns direct canonical runtime import", () => {
  const routes = fs.readFileSync(path.join(root, "src/routes/oyiRoutes.ts"), "utf8");
  const legacy = fs.readFileSync(path.join(root, "src/oyi-core/legacy/LegacyConversationAdapter.ts"), "utf8");
  assert.match(routes, /conversationOrchestrator\.run/);
  assert.doesNotMatch(routes, /runCanonicalConversation/);
  assert.match(legacy, /runCanonicalConversation/);
});

check("internal device runtime audit endpoint is protected", () => {
  const routes = fs.readFileSync(path.join(root, "src/routes/oyiRoutes.ts"), "utf8");
  assert.match(routes, /\/runtime\/internal\/device-runtime-audit/);
  assert.match(routes, /permissions\.includes\("system\.admin"\)/);
});

console.log("enterprise-intelligence-phase1-smoke passed");
