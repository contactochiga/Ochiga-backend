import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const runtimeSource = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const visitorAnswers = read("src/oyi-core/domains/visitors/visitorConversationAnswers.ts");
const visitorEvidence = read("src/oyi-core/domains/visitors/visitorEvidence.ts");
const targetCandidates = read("src/oyi-core/context/conversationTargetCandidates.ts");
const hydrationRegistry = read("src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts");
const visitorController = read("src/controllers/visitorController.ts");
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

const visitorObject = {
  object_type: "visitor",
  canonical_id: "visitor-1",
  label: "John Visitor",
  estate_id: "estate-1",
  building_id: "building-1",
  home_id: "home-1",
  room_id: null,
  source_module: "visitors",
  capabilities: ["visitors.read", "visitors.manage"],
  current_state: "active",
  health: "valid",
  permissions: ["visitors.read"],
  relationships: { access_passes: [{ id: "pass-1", visitor_name: "John Visitor", status: "active", access_code: "123456" }] },
  evidence_references: [],
  metadata: {},
  freshness: "fresh",
};

check("visitor domain owns visitor/access voice, recommendations, actions and credential redaction", () => {
  assert.match(visitorAnswers, /visitorObjectProfile/);
  assert.match(visitorAnswers, /visitorObjectVoice/);
  assert.match(visitorAnswers, /visitorRecommendation/);
  assert.match(visitorAnswers, /visitorConfirmationReply/);
  assert.match(visitorAnswers, /visitorContextualActions/);
  assert.match(visitorEvidence, /visitorRecordsFromContext/);
  assert.match(visitorEvidence, /redactAccessCredentialForConversation/);
  assert.match(visitorEvidence, /\[redacted access credential\]/);
  assert.doesNotMatch(runtimeSource, /I track this visitor's identity/);
  assert.doesNotMatch(runtimeSource, /Should I apply that access change/);
  assert.equal(runtimeSource.includes('add("Approve", "Approve this visitor", "approval");'), false);
});

check("visitor/access targets use shared candidate and hydration architecture", () => {
  assert.match(targetCandidates, /object_type: "visitor"/);
  assert.match(targetCandidates, /visitor_id/);
  assert.match(hydrationRegistry, /visitor: \{ table: "visitors"/);
  assert.match(hydrationRegistry, /access_pass: \{ table: "visitor_access"/);
  assert.match(runtimeSource, /resolveConversationTarget/);
  assert.match(runtimeSource, /hydrateOperationalObjectCandidate/);
});

check("consumer visitor read rejects stale device inheritance", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Who is visiting me today?",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(result.resolved_turn.domain, "visitors");
  assert.equal(result.contract.intent, "domain_list");
  assert.notEqual(result.contract.target.object_type, "device");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Who is visiting me today?", object: staleDevice }), false);
});

check("facility visitor read remains an authorized surface over shared Oyi Core", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Show visitor access today.",
    object: null,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.equal(result.resolved_turn.domain, "visitors");
  assert.equal(result.contract.intent, "domain_list");
  assert.equal(result.resolved_turn.authority.allowed, true);
});

check("visitor status questions are read-only and broad visitor queries clear exact visitor context", () => {
  const status = runtime.canonicalResolvedTurnForTest({
    message: "Can John still come in?",
    object: staleDevice,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(status.resolved_turn.domain, "visitors");
  assert.equal(status.contract.operation_class, "list");
  assert.equal(status.contract.mutation.requested, false);

  const broad = runtime.canonicalResolvedTurnForTest({
    message: "Show me all visitors expected today.",
    object: visitorObject,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(broad.resolved_turn.domain, "visitors");
  assert.equal(broad.contract.scope_mode, "home_scope");
  assert.notEqual(broad.contract.target.object_type, "visitor");
});

check("visitor action requests remain governed and do not execute from canonical read path", () => {
  for (const message of ["Create a visitor code for John.", "Approve this visitor.", "Revoke their access.", "Extend the code."]) {
    const result = runtime.canonicalResolvedTurnForTest({
      message,
      object: visitorObject,
      surface: "consumer",
      request: { estate_id: "estate-1", home_id: "home-1" },
    });
    assert.equal(result.resolved_turn.domain, "visitors", message);
    assert.notEqual(result.contract.operation_class, "execute_mutation", message);
    assert.equal(result.contract.mutation.requested, false, message);
  }
  assert.doesNotMatch(runtimeSource, /executeVisitor|dispatchVisitor|createVisitorAccess/i);
});

check("legitimate visitor thread references preserve exact visitor context", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Has he arrived?",
    object: visitorObject,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(result.resolved_turn.domain, "visitors");
  assert.equal(result.contract.scope_mode, "exact_target");
  assert.equal(result.contract.target.object_type, "visitor");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Has he arrived?", object: visitorObject }), true);
});

check("visitor controller preserves resident home and estate operator boundaries", () => {
  assert.match(visitorController, /ESTATE_OPERATOR_ROLES/);
  assert.match(visitorController, /rowEstateId && rowEstateId !== String\(context\.estateId\)/);
  assert.match(visitorController, /rowHomeId !== String\(context\.homeId/);
  assert.match(visitorController, /access_code: String\(accessCode\)/);
});

console.log("visitor-domain-extraction-smoke passed");
