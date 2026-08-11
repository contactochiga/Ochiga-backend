import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const source = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalConversationRuntime.ts"), "utf8");
const targetCandidatesSource = fs.readFileSync(path.join(root, "src/oyi-core/context/conversationTargetCandidates.ts"), "utf8");
const persistenceSource = fs.readFileSync(path.join(root, "src/oyi-core/persistence/canonicalConversationPersistence.ts"), "utf8");
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

const channel3 = {
  object_type: "device_channel",
  canonical_id: "11111111-1111-4111-8111-111111111111:switch_3",
  label: "Channel 3",
  estate_id: "estate-1",
  building_id: null,
  home_id: "home-1",
  room_id: "room-1",
  parent_id: "11111111-1111-4111-8111-111111111111",
  source_module: "device",
  capabilities: ["power"],
  current_state: "off",
  health: "healthy",
  permissions: ["devices.read"],
  relationships: {},
  evidence_references: [],
  metadata: { channel_code: "switch_3" },
  freshness: "fresh",
};

const baseFact = {
  fact_id: "fact-1",
  domain: "devices",
  fact_type: "command_execution",
  scope: { estate_id: "estate-1", home_id: "home-1", room_id: "room-1" },
  object: { object_type: "device_channel", canonical_id: "dev-1:switch_3", label: "Room switch Channel 3" },
  statement: "Channel 3 Off was confirmed.",
  value: { status: "state_confirmed", command: { switch_3: false }, channel_code: "switch_3", room_name: "Bedroom" },
  previous_value: null,
  occurred_at: new Date(Date.now() - 60_000).toISOString(),
  observed_at: new Date().toISOString(),
  source_type: "execution_ledger",
  source_id: "exec-1",
  truth_state: "confirmed",
  confidence: 0.94,
  freshness: "fresh",
  privacy_class: "resident_device_private",
  permissions: ["read"],
  evidence: [],
};

check("conversation containers are rejected before operational hydration", () => {
  assert.equal(runtime.isConversationContainerObject({ object_type: "message_thread", canonical_id: "thread-1" }), true);
  assert.equal(runtime.isConversationContainerObject({ target_type: "message", target_id: "thread-1" }), true);
  assert.match(targetCandidatesSource, /conversation_container_removed_from_target_resolution/);
});

check("current home scope wins over inherited exact channel", () => {
  const contract = runtime.canonicalIntelligenceContractForTest({
    message: "What's happening in my home?",
    object: channel3,
    request: { home_id: "home-1", scope_mode_hint: "exact_target" },
  });
  assert.equal(contract.intent, "home_operational_summary");
  assert.equal(contract.scope_mode, "home_scope");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "What's happening in my home?", object: channel3 }), false);
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Is this channel on?", object: channel3 }), true);
  assert.match(targetCandidatesSource, /object_type: "home"/);
});

check("global and non-device turns reject stale inherited device context", () => {
  for (const message of [
    "What can you do?",
    "What can u do?",
    "What should I check first?",
    "What should I cheek first?",
    "How much have I spent on utilities this month?",
    "Show wallet history.",
    "Open utility details.",
  ]) {
    const authority = runtime.canonicalCurrentTurnAuthorityForTest({ message, object: channel3, request: { home_id: "home-1" } });
    assert.equal(authority.mayUseInheritedExactTarget, false, message);
    assert.ok(authority.rejectionReason, message);
  }
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Is it on?", object: channel3 }), true);
});

check("wallet and utility prompts select inline domain builders", () => {
  const wallet = runtime.canonicalResolvedTurnForTest({ message: "Show wallet histry.", object: channel3, request: { home_id: "home-1" } });
  assert.equal(wallet.contract.intent, "wallet_operation");
  assert.equal(wallet.contract.answer_builder, "wallet_history");
  assert.equal(wallet.resolved_turn.domain, "wallet");
  assert.equal(wallet.presentation_policy.primary, "table");

  const utilities = runtime.canonicalResolvedTurnForTest({ message: "How much have I spent on utilities this month?", object: channel3, request: { home_id: "home-1" } });
  assert.equal(utilities.contract.intent, "wallet_operation");
  assert.equal(utilities.contract.answer_builder, "utility_spending");
  assert.equal(utilities.resolved_turn.domain, "utilities");
  assert.equal(utilities.contract.temporal_scope.mode, "custom");

  const openUtility = runtime.canonicalResolvedTurnForTest({ message: "Open utility details.", object: channel3, request: { home_id: "home-1" } });
  assert.equal(openUtility.contract.intent, "module_navigation");
  assert.equal(openUtility.resolved_turn.destination.key, "utilities.module");
  assert.notEqual(openUtility.resolved_turn.domain, "devices");
});

check("room prompts are room-scoped and room tables are titled by room", () => {
  const roomObject = { ...channel3, object_type: "room", canonical_id: "room-2", label: "Bedroom 2", parent_id: "home-1", source_module: "rooms" };
  const summary = runtime.canonicalResolvedTurnForTest({ message: "What's happening in Bedroom 2?", object: roomObject, request: { home_id: "home-1", room_id: "room-2", room_name: "Bedroom 2" } });
  assert.equal(summary.contract.intent, "home_operational_summary");
  assert.equal(summary.contract.scope_mode, "room_scope");
  assert.equal(summary.resolved_turn.scope, "room");

  const roomFact = { ...baseFact, scope: { ...baseFact.scope, room_id: "room-2" }, value: { ...baseFact.value, room_name: "Bedroom 2" } };
  const table = runtime.canonicalConversationTableBlockForTest({ facts: [roomFact], message: "What changed recently in Bedroom 2?", object: roomObject, request: { home_id: "home-1", room_id: "room-2", room_name: "Bedroom 2" } });
  assert.equal(table.title, "Recent Bedroom 2 changes");
});

check("offline inventory is not exact-channel current state", () => {
  const contract = runtime.canonicalIntelligenceContractForTest({
    message: "Show offline devices.",
    object: channel3,
    request: { home_id: "home-1" },
  });
  assert.equal(contract.intent, "device_availability_inventory");
  assert.equal(contract.answer_builder, "device_availability_inventory");
  assert.equal(contract.scope_mode, "home_scope");
});

check("explicit channel wording stays exact", () => {
  const contract = runtime.canonicalIntelligenceContractForTest({
    message: "What changed recently for this channel?",
    object: channel3,
  });
  assert.equal(contract.intent, "recent_changes");
  assert.equal(contract.scope_mode, "exact_target");
  assert.equal(contract.target.channel_code, "switch_3");
});

check("recent changes return concise copy and a table block", () => {
  const answer = runtime.canonicalRecentChangesAnswerForTest({ facts: [baseFact], message: "What changed recently?" });
  assert.match(answer, /meaningful change/);
  assert.doesNotMatch(answer, /proximity\.awareness\.checked|I did not treat proximity/);
  const table = runtime.canonicalConversationTableBlockForTest({ facts: [baseFact], message: "What changed recently?" });
  assert.equal(table.type, "table");
  assert.equal(table.rows[0].device_name, "Room switch");
  assert.equal(table.rows[0].channel_label, "Channel 3");
});

check("internal proximity events are suppressed from historical reads", () => {
  const noisy = { ...baseFact, fact_id: "noise", statement: "proximity.awareness.checked was recorded", value: { action: "proximity.awareness.checked" }, source_id: "noise" };
  const answer = runtime.canonicalRecentChangesAnswerForTest({ facts: [noisy], message: "What changed recently?" });
  assert.doesNotMatch(answer, /proximity|suspicious access/i);
});

check("offline inventory distinguishes expired from offline", () => {
  const offline = { ...baseFact, fact_id: "dev-offline", fact_type: "device_availability", object: { object_type: "device", canonical_id: "dev-offline", label: "Lamp" }, value: { availability: "offline", room_name: "Bedroom", device_family: "switch" }, statement: "Lamp: offline." };
  const expired = { ...baseFact, fact_id: "dev-expired", fact_type: "device_availability", object: { object_type: "device", canonical_id: "dev-expired", label: "TV" }, value: { availability: "expired", room_name: "Living Room", device_family: "ir" }, statement: "TV: expired." };
  const answer = runtime.canonicalDeviceAvailabilityAnswerForTest({ facts: [expired], message: "Show offline devices." });
  assert.match(answer, /do not see devices that are confirmed offline/i);
  const table = runtime.canonicalConversationTableBlockForTest({ facts: [offline, expired], message: "Show offline devices." });
  assert.equal(table.type, "table");
  assert.deepEqual(table.rows.map((row) => row.status), ["offline", "expired"]);
});

check("wallet and utility table blocks use one canonical table title", () => {
  const walletFact = {
    ...baseFact,
    fact_id: "wallet-1",
    fact_type: "wallet_transaction",
    domain: "wallet",
    object: { object_type: "transaction", canonical_id: "tx-1", label: "Electricity top-up" },
    value: { description: "Electricity top-up", type: "electricity", direction: "debit", amount: 30000, status: "completed", category: "electricity" },
    occurred_at: new Date().toISOString(),
  };
  const walletTable = runtime.canonicalConversationTableBlockForTest({ facts: [walletFact], message: "Show wallet history." });
  assert.equal(walletTable.title, "Wallet history");
  assert.equal(walletTable.rows[0].amount, "-₦30,000");
  const utilityTable = runtime.canonicalConversationTableBlockForTest({ facts: [walletFact], message: "How much have I spent on utilities this month?" });
  assert.equal(utilityTable.title, "Utility spending");
  assert.equal(utilityTable.rows[0].category, "Electricity");
});

check("clarification continuation preserves pending device operation", () => {
  const pending = {
    clarification_id: "clarify-1",
    thread_id: "thread-1",
    original_user_message: "Turn off living room light.",
    operation: "execute_mutation",
    domain: "devices",
    requested_action: "off",
    requested_state: "off",
    requested_phrase: "living room light",
    candidate_ids: ["dev-1", "dev-2"],
    candidates: [
      { device_id: "dev-1", label: "3Gang living room", room_label: "Living Room" },
      { device_id: "dev-2", label: "Living room lamp", room_label: "Living Room", channel_code: "switch_1" },
    ],
    selected_candidate_id: null,
    unresolved_fields: ["target"],
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  const response = runtime.canonicalClarificationContinuationForTest({ message: "3Gang living room.", pending });
  assert.ok(response);
  assert.match(response.message, /Which channel should I turn off|Confirm to turn off/i);
  assert.equal(response.execution.current_turn_execution, false);
});

check("resident device projection avoids raw Device and Air labels", () => {
  const tv = { ...baseFact, fact_id: "tv", fact_type: "device_availability", object: { object_type: "device", canonical_id: "tv", label: "TV" }, value: { availability: "expired", device_family: "ir_tv", room_name: "Bedroom", is_virtual: true, parent_device_name: "Smart IR Hub" } };
  const unnamed = { ...baseFact, fact_id: "air", fact_type: "device_availability", object: { object_type: "device", canonical_id: "air", label: "Air" }, value: { availability: "unknown", device_family: "ac", room_name: "Bedroom", is_virtual: true } };
  const table = runtime.canonicalConversationTableBlockForTest({ facts: [tv, unnamed], message: "Show offline devices." });
  assert.match(table.rows[0].name, /controlled through Smart IR Hub/);
  assert.notEqual(table.rows[1].name, "Air");
});

check("semantic dedupe and table persistence hooks exist", () => {
  assert.match(source, /normalizedCopy/);
  assert.match(source, /tableBlockForContract/);
  assert.match(persistenceSource, /cards: Array\.isArray\(response\.cards\) \? response\.cards : \[\]/);
  assert.doesNotMatch(source, /summary: safeAnswer, items: deduped\.slice/);
});

console.log("conversation-final-correction-smoke passed");
