import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const runtimeSource = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const securityAnswers = read("src/oyi-core/domains/security/securityConversationAnswers.ts");
const securityEvidence = read("src/oyi-core/domains/security/securityEvidence.ts");
const visitorAnswers = read("src/oyi-core/domains/visitors/visitorConversationAnswers.ts");
const targetCandidates = read("src/oyi-core/context/conversationTargetCandidates.ts");
const hydrationRegistry = read("src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts");
const capabilityRegistry = read("src/oyi-core/runtime/domainCapabilityRegistry.ts");
const cameraStreamController = read("src/controllers/cameraStreamController.ts");
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

const securityIncident = {
  object_type: "operational_incident",
  canonical_id: "incident-1",
  label: "Gate alert",
  estate_id: "estate-1",
  building_id: "building-1",
  home_id: "home-1",
  room_id: null,
  source_module: "security",
  capabilities: ["security.read", "security.escalate"],
  current_state: "open",
  health: "critical",
  permissions: ["security.read"],
  relationships: {
    incidents: [
      { id: "incident-1", title: "Gate alert", status: "open", severity: "warning" },
      { id: "incident-2", title: "Resolved access alert", status: "resolved", severity: "info" },
    ],
  },
  evidence_references: [],
  metadata: {},
  freshness: "fresh",
};

const cameraObject = {
  object_type: "camera",
  canonical_id: "camera-1",
  label: "Front Gate Camera",
  estate_id: "estate-1",
  building_id: "building-1",
  home_id: null,
  room_id: null,
  source_module: "cameras",
  capabilities: ["cameras.read"],
  current_state: "online",
  health: "healthy",
  permissions: ["cameras.read"],
  relationships: { cameras: [{ id: "camera-1", status: "online" }] },
  evidence_references: [],
  metadata: {},
  freshness: "fresh",
};

check("security domain owns access-point, camera-context and incident answer behavior", () => {
  assert.match(securityAnswers, /securityObjectProfile/);
  assert.match(securityAnswers, /securityObjectVoice/);
  assert.match(securityAnswers, /securityRecommendation/);
  assert.match(securityAnswers, /securityConfirmationReply/);
  assert.match(securityAnswers, /securityContextualActions/);
  assert.doesNotMatch(runtimeSource, /I track this access point's location/);
  assert.doesNotMatch(runtimeSource, /I monitor this camera's live state/);
  assert.doesNotMatch(runtimeSource, /I track this incident's cause/);
});

check("security evidence owns risk gating and sensitive value redaction", () => {
  assert.match(securityEvidence, /securityRecordsFromContext/);
  assert.match(securityEvidence, /securityRiskAllowed/);
  assert.match(securityEvidence, /redactSecuritySensitiveValue/);
  assert.match(securityEvidence, /\[redacted security-sensitive value\]/);
  assert.doesNotMatch(runtimeSource, /function securityRiskAllowed/);
});

check("security targets use shared target candidate and hydration architecture", () => {
  assert.match(targetCandidates, /object_type: "access_point"/);
  assert.match(targetCandidates, /object_type: "operational_incident"/);
  assert.match(hydrationRegistry, /operational_incident: \{ table: "operational_incidents"/);
  assert.match(hydrationRegistry, /camera: \{ table: "facility_cameras"/);
  assert.match(runtimeSource, /resolveConversationTarget/);
  assert.match(runtimeSource, /hydrateOperationalObjectCandidate/);
});

check("consumer security read rejects stale device inheritance", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Are there any security alerts?",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(result.resolved_turn.domain, "security");
  assert.equal(result.contract.intent, "domain_list");
  assert.equal(result.contract.operation_class, "list");
  assert.notEqual(result.contract.target.object_type, "device");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Are there any security alerts?", object: staleDevice }), false);
});

check("facility security read remains a building-authorized surface over shared Oyi Core", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Show unresolved security incidents.",
    object: null,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.equal(result.resolved_turn.domain, "security");
  assert.equal(result.contract.intent, "domain_list");
  assert.equal(result.resolved_turn.authority.allowed, true);
});

check("security status questions are read-only and security actions remain governed", () => {
  const status = runtime.canonicalResolvedTurnForTest({
    message: "Is the front door locked?",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(status.resolved_turn.domain, "security");
  assert.equal(status.contract.operation_class, "list");
  assert.equal(status.contract.mutation.requested, false);

  const action = runtime.canonicalResolvedTurnForTest({
    message: "Escalate this issue.",
    object: securityIncident,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.equal(action.resolved_turn.domain, "security");
  assert.equal(action.contract.intent, "security_operation");
  assert.notEqual(action.contract.operation_class, "execute_mutation");
  assert.equal(action.contract.mutation.requested, false);
  assert.doesNotMatch(runtimeSource, /executeSecurity|dispatchSecurity|acknowledgeIncident/i);
});

check("incident continuation is preserved while broad security queries clear exact incident context", () => {
  const followUp = runtime.canonicalResolvedTurnForTest({
    message: "Was it resolved?",
    object: securityIncident,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.equal(followUp.resolved_turn.domain, "security");
  assert.equal(followUp.contract.scope_mode, "exact_target");
  assert.equal(followUp.contract.target.object_type, "operational_incident");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Was it resolved?", object: securityIncident }), true);

  const broad = runtime.canonicalResolvedTurnForTest({
    message: "Show all unresolved security alerts.",
    object: securityIncident,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.equal(broad.resolved_turn.domain, "security");
  assert.equal(broad.contract.scope_mode, "home_scope");
  assert.notEqual(broad.contract.target.object_type, "operational_incident");
});

check("visitor/access and camera boundaries remain distinct", () => {
  assert.match(visitorAnswers, /visitorConfirmationReply/);
  assert.match(capabilityRegistry, /domain: "visitors"/);
  assert.match(capabilityRegistry, /domain: "cameras"/);
  assert.match(capabilityRegistry, /domain: "security"/);
  assert.match(cameraStreamController, /issueCameraPlaybackToken/);

  const cameraStatus = runtime.canonicalResolvedTurnForTest({
    message: "Is this camera working?",
    object: cameraObject,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.notEqual(cameraStatus.resolved_turn.domain, "security");

  const cameraSecurity = runtime.canonicalResolvedTurnForTest({
    message: "Review security for this camera.",
    object: cameraObject,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.equal(cameraSecurity.resolved_turn.domain, "security");
});

console.log("security-domain-extraction-smoke passed");
