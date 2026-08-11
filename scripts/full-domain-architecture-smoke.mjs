import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const language = await import(path.join(root, "dist/oyi-core/runtime/languageUnderstanding.js"));
const registry = await import(path.join(root, "dist/oyi-core/runtime/domainCapabilityRegistry.js"));
const workflow = await import(path.join(root, "dist/oyi-core/runtime/conversationWorkflowRuntime.js"));
const runtimeSource = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalConversationRuntime.ts"), "utf8");
const persistenceSource = fs.readFileSync(path.join(root, "src/oyi-core/persistence/canonicalConversationPersistence.ts"), "utf8");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check("language normalization corrects common operational typos without mutating custom names", () => {
  const turn = language.normalizeUserTurn("Show wallet histry and transation s for this month");
  assert.equal(turn.normalized_text.includes("history"), true);
  assert.equal(turn.normalized_text.includes("transactions"), true);
  assert.equal(turn.domain, "wallet");
  assert.equal(turn.operation, "list");
  assert.ok(turn.corrections.length >= 2);
});

check("global and utility turns classify before inherited device resolution can run", () => {
  const global = language.normalizeUserTurn("What can u do?");
  assert.equal(global.domain, "global");
  assert.equal(global.operation, "inform");
  assert.equal(global.mutation_intent, false);

  const utility = language.normalizeUserTurn("How much have I spent on utilities this month?");
  assert.equal(utility.domain, "utilities");
  assert.equal(utility.operation, "summarize");
  assert.equal(utility.temporal_scope.mode, "current_month");
});

check("room aliases are normalized into room-domain turns", () => {
  const lounge = language.normalizeUserTurn("What changed recently in lounge?");
  assert.equal(lounge.normalized_text.includes("living room"), true);
  assert.equal(lounge.domain, "rooms");
});

check("capability registry covers every required domain", () => {
  const required = [
    "home",
    "rooms",
    "devices",
    "visitors",
    "access",
    "maintenance",
    "wallet",
    "transactions",
    "utilities",
    "services",
    "community",
    "messages",
    "scenes",
    "automations",
    "cameras",
    "notifications",
    "incidents",
  ];
  for (const domain of required) {
    const capability = registry.getDomainCapability(domain);
    assert.ok(capability, domain);
    assert.ok(capability.supported_operations.length, domain);
    assert.ok(Array.isArray(capability.inline_reads), domain);
    assert.ok(Array.isArray(capability.semantic_destinations), domain);
  }
});

check("authority tiers distinguish read-only from sensitive financial actions", () => {
  const read = registry.decideAuthorityForTurn(language.normalizeUserTurn("Show wallet history."));
  assert.equal(read.allowed, true);
  assert.equal(read.approval_required, false);

  const buy = registry.decideAuthorityForTurn(language.normalizeUserTurn("Buy electricity for 20000."));
  assert.equal(buy.allowed, true);
  assert.equal(buy.tier, 3);
  assert.equal(buy.approval_required, true);
  assert.equal(buy.secure_review_required, true);
});

check("durable workflow supports clarification cancellation and terminal action state", () => {
  const authority = { allowed: true, tier: 1, approval_required: true, secure_review_required: false, required_permissions: [], denial_reason: null };
  const created = workflow.createWorkflow({
    thread_id: "thread-1",
    request_id: "request-1",
    capability_key: "devices.action",
    domain: "devices",
    operation: "propose_mutation",
    target: { object_type: "device", canonical_id: "device-1", label: "Living room light" },
    unresolved_inputs: ["channel"],
    authority_decision: authority,
  });
  assert.equal(created.status, "awaiting_clarification");
  assert.equal(workflow.cancelWorkflow(created).status, "cancelled");

  const ready = workflow.createWorkflow({
    thread_id: "thread-1",
    request_id: "request-2",
    capability_key: "devices.action",
    domain: "devices",
    operation: "propose_mutation",
    target: { object_type: "device", canonical_id: "device-1", label: "Living room light" },
    authority_decision: authority,
    proposed_action: { desired_state: "off" },
  });
  const action = workflow.createAction({
    workflow: ready,
    target: { object_type: "device", canonical_id: "device-1", label: "Living room light" },
    requested_operation: "turn_off",
    requested_state: false,
  });
  const terminal = workflow.transitionAction(action, "confirmed", { state_confirmed: true });
  assert.equal(terminal.status, "confirmed");
  assert.ok(terminal.completed_at);
});

check("canonical runtime persists normalized turn workflow action and resolved turn metadata through one owner", () => {
  for (const token of [
    "oyi_turn_normalized",
    "oyi_turn_resolved",
    "oyi_capability_selected",
    "oyi_workflow_created",
    "oyi_presentation_policy_applied",
    "persistCanonicalAuthoritativeMessages",
  ]) {
    assert.match(runtimeSource, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const token of [
    "normalized_turn: normalizedTurnMetadata",
    "resolved_oyi_turn: resolvedOyiTurnMetadata",
    "workflow: workflowMetadata",
    "action: actionMetadata",
  ]) {
    assert.match(persistenceSource, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

console.log("full-domain-architecture-smoke passed");
