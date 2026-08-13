import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase-b-smoke-service-role-key";
const registryModule = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityRegistry.js"));
const rollout = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityRollout.js"));
const serviceModule = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityService.js"));
const readModules = await import(path.join(root, "dist/oyi-core/capabilities/ReadCapabilityModules.js"));
const parser = await import(path.join(root, "dist/oyi-core/interpretation/SemanticFrameParser.js"));
const orchestratorModule = await import(path.join(root, "dist/oyi-core/orchestration/ConversationOrchestrator.js"));

function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(() => console.log(`PASS ${name}`)).catch((error) => {
        console.error(`FAIL ${name}`);
        throw error;
      });
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

for (const capability of readModules.buildPhaseBReadCapabilities()) {
  registryModule.capabilityRegistry.register(capability);
}

const resident = {
  id: "resident-1",
  role: "resident",
  estate_id: "estate-1",
  home_id: "home-1",
  permissions: ["devices.read", "wallets.read", "services.read", "homes.read", "community.read", "notifications.read"],
};

const facility = {
  id: "facility-1",
  role: "facility_manager",
  estate_id: "estate-1",
  permissions: ["devices.read", "homes.read", "wallets.read", "services.read", "community.read", "support.read"],
};

const publicActor = {
  id: "public-1",
  role: "guest",
  permissions: [],
};

const consumerContext = {
  actor_id: "resident-1",
  surface: "consumer",
  role: "resident",
  permissions: resident.permissions,
  organization_id: null,
  portfolio_id: null,
  account_id: null,
  deployment_id: null,
  estate_id: "estate-1",
  home_id: "home-1",
  module: "home",
  target: null,
  estate: null,
  home: null,
  available_estates: [],
  available_homes: [],
  resolved_at: new Date().toISOString(),
};

await check("enabled capabilities have handlers, evidence requirements, presentation and authority metadata", () => {
  const enabled = registryModule.capabilityRegistry.enabled();
  assert.ok(enabled.some((item) => item.key === "devices.status.read"));
  assert.ok(enabled.some((item) => item.key === "wallet.transactions.read"));
  for (const capability of enabled) {
    assert.equal(rollout.capabilityEnabled(capability), true);
    assert.equal(typeof capability.resolve, "function");
    assert.equal(typeof capability.collectEvidence, "function");
    assert.equal(typeof capability.buildReadResponse, "function");
    assert.ok(capability.presentation_policy);
    if (capability.key !== "global.capabilities.read") assert.ok((capability.evidence_requirements || []).length > 0, `${capability.key} missing evidence requirements`);
  }
});

await check("sensitive action capability cannot be enabled without verification", () => {
  assert.throws(() => registryModule.capabilityRegistry.register({
    key: "wallet.funding.execute",
    domain: "wallet",
    rolloutStatus: "enabled",
    risk_class: "sensitive_action",
    supports: () => true,
    resolve: async () => ({ supported: true, reason: null }),
    collectEvidence: async () => [],
    execute: async () => ({ status: "sent", execution_id: "exec-1" }),
  }), /no verification adapter/);
});

await check("consumer own home device read is allowed and foreign home is denied", () => {
  const allowed = serviceModule.capabilityService.canUse("devices.status.read", {
    actor: resident,
    oisContext: consumerContext,
    surface: "consumer",
    scope: { estate_id: "estate-1", building_id: null, home_id: "home-1", room_id: null },
  });
  assert.equal(allowed.allowed, true);
  const denied = serviceModule.capabilityService.canUse("devices.status.read", {
    actor: resident,
    oisContext: consumerContext,
    surface: "consumer",
    scope: { estate_id: "estate-1", building_id: null, home_id: "home-2", room_id: null },
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "home_scope_not_owned_by_actor");
});

await check("wallet authority is consumer-home scoped and facility resident-private wallet is denied", () => {
  const consumerWallet = serviceModule.capabilityService.canUse("wallet.transactions.read", {
    actor: resident,
    oisContext: consumerContext,
    surface: "consumer",
    scope: { estate_id: "estate-1", building_id: null, home_id: "home-1", room_id: null },
  });
  assert.equal(consumerWallet.allowed, true);
  const facilityWallet = serviceModule.capabilityService.canUse("wallet.transactions.read", {
    actor: facility,
    oisContext: { ...consumerContext, surface: "facility", role: "facility_manager", actor_id: "facility-1", home_id: null },
    surface: "facility",
    scope: { estate_id: "estate-1", building_id: "building-1", home_id: "home-1", room_id: null },
  });
  assert.equal(facilityWallet.allowed, false);
});

await check("public and office surfaces cannot use operational device capabilities", () => {
  const publicDenied = serviceModule.capabilityService.canUse("devices.status.read", {
    actor: publicActor,
    oisContext: null,
    surface: "public_corporate",
    scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
  });
  assert.equal(publicDenied.allowed, false);
  const officeDenied = serviceModule.capabilityService.canUse("devices.status.read", {
    actor: { id: "staff-1", role: "ochiga_staff", permissions: ["office.read"] },
    oisContext: null,
    surface: "office_internal",
    scope: { estate_id: "estate-1", building_id: null, home_id: "home-1", room_id: null },
  });
  assert.equal(officeDenied.allowed, false);
});

await check("registry advertising differs by surface and includes only enabled authorised capabilities", () => {
  const consumer = serviceModule.capabilityService.listForActor({ actor: resident, oisContext: consumerContext, surface: "consumer" });
  assert.ok(consumer.some((item) => item.key === "devices.status.read"));
  assert.ok(consumer.some((item) => item.key === "wallet.transactions.read"));
  assert.ok(consumer.every((item) => item.rollout_status === "enabled" && item.authority.allowed));
  const publicList = serviceModule.capabilityService.listForActor({ actor: publicActor, oisContext: null, surface: "public_corporate" });
  assert.deepEqual(publicList.map((item) => item.key), ["global.capabilities.read"]);
});

await check("semantic wallet typo resolves to enabled wallet transaction capability", () => {
  const frame = parser.parseSemanticFrame("Show wallet histry");
  const selection = serviceModule.capabilityService.resolve({
    actor: resident,
    oisContext: consumerContext,
    input: { message: "Show wallet histry", surface: "consumer", estate_id: "estate-1", home_id: "home-1", context: consumerContext },
    resolvedTurn: {
      request_id: "req-1",
      correlation_id: "req-1",
      runtime_id: "runtime-1",
      thread_id: null,
      actor: resident,
      semantic_frame: frame,
      operation: frame.operation,
      capability_key: "wallet.history",
      domain: frame.domain,
      scope: { estate_id: "estate-1", building_id: null, home_id: "home-1", room_id: null },
      target: null,
      target_source: "none",
      active_workflow_id: null,
      authority: { allowed: true, tier: 0, approval_required: false, secure_review_required: false, required_permissions: [], denial_reason: null },
      temporal_scope: frame.temporalScope,
      presentation_policy: { primary: "table", allowed_supporting_blocks: ["text", "table"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "current_state_snapshot", auto_navigation: false },
      context: consumerContext,
    },
  });
  assert.equal(selection.capability?.key, "wallet.transactions.read");
  assert.equal(selection.authority?.allowed, true);
});

await check("what can you do uses capability owner without legacy fallback", async () => {
  const response = await orchestratorModule.conversationOrchestrator.run({
    actor: resident,
    oisContext: consumerContext,
    input: { message: "What can you do?", surface: "consumer", estate_id: "estate-1", home_id: "home-1", context: consumerContext },
  });
  assert.equal(response.execution.orchestrator_v2.capability_key, "global.capabilities.read");
  assert.equal(response.execution.orchestrator_v2.legacy_fallback_used, false);
  assert.match(response.answer, /enabled capability registry/i);
  assert.match(response.answer, /device status/i);
  assert.doesNotMatch(response.answer, /maintenance requests/i);
});

await check("enabled capability requests do not leak internal wallet references in source", () => {
  const source = fs.readFileSync(path.join(root, "src/oyi-core/domains/wallet/walletEvidence.ts"), "utf8");
  assert.match(source, /residentWalletDescription/);
  assert.doesNotMatch(source, /metadata\.description \|\| metadata\.service_name \|\| metadata\.title \|\| row\.reference \|\| row\.type/);
});

await check("internal capability introspection route is admin protected", () => {
  const routes = fs.readFileSync(path.join(root, "src/routes/oyiRoutes.ts"), "utf8");
  assert.match(routes, /\/runtime\/internal\/capabilities/);
  assert.match(routes, /permissions\.includes\("system\.admin"\)/);
});

console.log("oyi capability phase-b smoke passed");
