import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const runtimeSource = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const maintenanceAnswers = read("src/oyi-core/domains/maintenance/maintenanceConversationAnswers.ts");
const maintenanceEvidence = read("src/oyi-core/domains/maintenance/maintenanceEvidence.ts");
const targetCandidates = read("src/oyi-core/context/conversationTargetCandidates.ts");
const runtime = await import(path.join(root, "dist/oyi-core/testing/canonicalConversationTestSupport.js"));

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
  canonical_id: "device-living-room-tv",
  label: "Living Room TV",
  estate_id: "estate-1",
  home_id: "home-1",
  room_id: "living-room",
  source_module: "device",
  capabilities: ["power"],
  current_state: "off",
  health: "healthy",
  permissions: ["devices.read"],
  relationships: {},
  evidence_references: [],
  metadata: {},
  freshness: "fresh",
};

const maintenanceRequest = {
  object_type: "maintenance_request",
  canonical_id: "maintenance-1",
  label: "Bedroom AC repair",
  estate_id: "estate-1",
  building_id: "building-1",
  home_id: "home-1",
  room_id: "bedroom-2",
  source_module: "maintenance",
  capabilities: ["support.read", "support.assign"],
  current_state: "open",
  health: "pending",
  permissions: ["support.read"],
  relationships: {
    assignee_name: "Ade",
    maintenance_requests: [
      { id: "maintenance-1", title: "Bedroom AC repair", status: "open", room_id: "bedroom-2" },
      { id: "maintenance-2", title: "Resolved leak", status: "resolved", room_id: "bedroom-2" },
    ],
  },
  evidence_references: [],
  metadata: {},
  freshness: "fresh",
};

check("maintenance domain owns exact request voice, recommendations, actions and linked evidence normalization", () => {
  assert.match(maintenanceAnswers, /maintenanceObjectProfile/);
  assert.match(maintenanceAnswers, /maintenanceObjectVoice/);
  assert.match(maintenanceAnswers, /maintenanceRecommendation/);
  assert.match(maintenanceAnswers, /maintenanceConfirmationReply/);
  assert.match(maintenanceAnswers, /maintenanceContextualActions/);
  assert.match(maintenanceAnswers, /maintenanceLinkedIssueSummary/);
  assert.match(maintenanceEvidence, /maintenanceRecordsFromContext/);
  assert.match(maintenanceEvidence, /unresolvedMaintenanceRecordsForContext/);
  assert.doesNotMatch(runtimeSource, /I track this maintenance request through issue/);
  assert.doesNotMatch(runtimeSource, /Should I update this request/);
  assert.equal(runtimeSource.includes('add("Assignee", "Who is handling it?");'), false);
});

check("maintenance targets use shared target candidate architecture", () => {
  assert.match(targetCandidates, /maintenance_request/);
  assert.match(targetCandidates, /maintenance_id/);
  assert.match(runtimeSource, /resolveConversationTarget/);
  assert.match(runtimeSource, /hydrateOperationalObjectCandidate/);
});

check("consumer maintenance read rejects stale device inheritance", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "What maintenance requests are open?",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(result.resolved_turn.domain, "maintenance");
  assert.equal(result.contract.intent, "domain_list");
  assert.notEqual(result.contract.target.object_type, "device");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "What maintenance requests are open?", object: staleDevice }), false);
});

check("facility maintenance read remains a building-authorized surface over Oyi Core", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Show maintenance issues this week.",
    object: null,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.equal(result.resolved_turn.domain, "maintenance");
  assert.equal(result.contract.intent, "domain_list");
  assert.equal(result.resolved_turn.authority.allowed, true);
});

check("exact maintenance follow-up preserves legitimate inherited request context", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "What about that one?",
    object: maintenanceRequest,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1", room_id: "bedroom-2" },
  });
  assert.equal(result.resolved_turn.domain, "maintenance");
  assert.equal(result.contract.scope_mode, "exact_target");
  assert.equal(result.contract.target.object_type, "maintenance_request");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "What about that one?", object: maintenanceRequest }), true);
});

check("maintenance action requests stay governed and do not execute from read path", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Report a problem with the bedroom AC.",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1", room_id: "bedroom-2" },
  });
  assert.equal(result.resolved_turn.domain, "maintenance");
  assert.notEqual(result.contract.operation_class, "execute_mutation");
  assert.doesNotMatch(runtimeSource, /executeMaintenance|dispatchMaintenance/i);
});

console.log("maintenance-domain-extraction-smoke passed");
