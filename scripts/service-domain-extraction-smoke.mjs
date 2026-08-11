import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const runtimeSource = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const serviceAnswers = read("src/oyi-core/domains/services/serviceConversationAnswers.ts");
const serviceEvidence = read("src/oyi-core/domains/services/serviceEvidence.ts");
const utilityEvidence = read("src/oyi-core/domains/utilities/utilityEvidence.ts");
const walletEvidence = read("src/oyi-core/domains/wallet/walletEvidence.ts");
const targetCandidates = read("src/oyi-core/context/conversationTargetCandidates.ts");
const hydrationRegistry = read("src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts");
const servicesController = read("src/controllers/servicesController.ts");
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

const serviceAccount = {
  object_type: "service_account",
  canonical_id: "service-1",
  label: "Cleaning Service",
  estate_id: "estate-1",
  building_id: "building-1",
  home_id: "home-1",
  room_id: null,
  parent_id: null,
  source_module: "services",
  capabilities: ["services.read", "services.request"],
  current_state: "scheduled",
  health: "pending",
  permissions: ["services.read"],
  relationships: {
    service_requests: [
      { id: "service-1", service_key: "cleaning", status: "scheduled", home_id: "home-1" },
      { id: "service-2", service_key: "cleaning", status: "completed", home_id: "home-1" },
    ],
    service_transactions: [{ id: "tx-1", service_key: "cleaning", status: "completed", amount: 10000 }],
  },
  evidence_references: [],
  metadata: {},
  freshness: "fresh",
};

check("services domain owns service account and meter voice, recommendations, actions and evidence normalization", () => {
  assert.match(serviceAnswers, /serviceObjectProfile/);
  assert.match(serviceAnswers, /serviceObjectVoice/);
  assert.match(serviceAnswers, /serviceRecommendation/);
  assert.match(serviceAnswers, /serviceConfirmationReply/);
  assert.match(serviceAnswers, /serviceContextualActions/);
  assert.match(serviceEvidence, /serviceRecordsFromContext/);
  assert.match(serviceEvidence, /serviceStatus/);
  assert.match(serviceEvidence, /serviceFinancialReference/);
  assert.doesNotMatch(runtimeSource, /I track this service account's provider/);
  assert.doesNotMatch(runtimeSource, /I track this meter's service binding/);
  assert.equal(runtimeSource.includes('add("Tariff", "What is my tariff?");'), false);
});

check("services targets use shared target candidate and hydration architecture", () => {
  assert.match(targetCandidates, /object_type: "service_account"/);
  assert.match(targetCandidates, /service_account_id/);
  assert.match(hydrationRegistry, /service_account: \{ table: "home_service_accounts"/);
  assert.match(runtimeSource, /resolveConversationTarget/);
  assert.match(runtimeSource, /hydrateOperationalObjectCandidate/);
});

check("consumer service read rejects stale device inheritance", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "What services are available?",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(result.resolved_turn.domain, "services");
  assert.equal(result.contract.intent, "domain_list");
  assert.equal(result.contract.operation_class, "list");
  assert.notEqual(result.contract.target.object_type, "device");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "What services are available?", object: staleDevice }), false);
});

check("facility service read remains a scope-authorized surface over shared Oyi Core", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Show service requests this week.",
    object: null,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.equal(result.resolved_turn.domain, "services");
  assert.equal(result.contract.intent, "domain_list");
  assert.equal(result.resolved_turn.authority.allowed, true);
});

check("service status questions are read-only and service actions remain governed", () => {
  const status = runtime.canonicalResolvedTurnForTest({
    message: "What's the status of my cleaning request?",
    object: serviceAccount,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(status.resolved_turn.domain, "services");
  assert.equal(status.contract.operation_class, "list");
  assert.equal(status.contract.mutation.requested, false);

  for (const message of ["Book cleaning for tomorrow.", "Cancel my service.", "Reschedule it."]) {
    const result = runtime.canonicalResolvedTurnForTest({
      message,
      object: serviceAccount,
      surface: "consumer",
      request: { estate_id: "estate-1", home_id: "home-1" },
    });
    assert.equal(result.resolved_turn.domain, "services", message);
    assert.equal(result.contract.intent, "service_operation", message);
    assert.notEqual(result.contract.operation_class, "execute_mutation", message);
    assert.equal(result.contract.mutation.requested, false, message);
  }
  assert.doesNotMatch(runtimeSource, /executeService|dispatchService|bookService/i);
});

check("maintenance and services keep their domain boundary", () => {
  const maintenance = runtime.canonicalResolvedTurnForTest({
    message: "Report that the AC is broken.",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(maintenance.resolved_turn.domain, "maintenance");
  assert.equal(maintenance.contract.intent, "maintenance_operation");

  const service = runtime.canonicalResolvedTurnForTest({
    message: "Book AC servicing.",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(service.resolved_turn.domain, "services");
  assert.equal(service.contract.intent, "service_operation");
});

check("service thread continuation is preserved while broad service queries clear exact service context", () => {
  const followUp = runtime.canonicalResolvedTurnForTest({
    message: "Has it been confirmed?",
    object: serviceAccount,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(followUp.resolved_turn.domain, "services");
  assert.equal(followUp.contract.scope_mode, "exact_target");
  assert.equal(followUp.contract.target.object_type, "service_account");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Has it been confirmed?", object: serviceAccount }), true);

  const broad = runtime.canonicalResolvedTurnForTest({
    message: "Show all my service requests.",
    object: serviceAccount,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(broad.resolved_turn.domain, "services");
  assert.equal(broad.contract.scope_mode, "home_scope");
  assert.notEqual(broad.contract.target.object_type, "service_account");
});

check("services controller preserves scope and financial truth boundaries", () => {
  assert.match(servicesController, /home_service_accounts/);
  assert.match(servicesController, /service_transactions/);
  assert.match(servicesController, /assertCanManageEstate/);
  assert.match(servicesController, /service_account_mismatch/);
  assert.match(utilityEvidence, /loadUtilitySpendingFacts/);
  assert.match(walletEvidence, /wallet_transactions/);
});

console.log("service-domain-extraction-smoke passed");
