import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtimeSource = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalConversationRuntime.ts"), "utf8");
const intentRoutingSource = fs.readFileSync(path.join(root, "src/oyi-core/interpretation/conversationIntentRouting.ts"), "utf8");
const unifiedSource = fs.readFileSync(path.join(root, "src/services/oyiUnifiedIntelligenceService.ts"), "utf8");
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";
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

const channel3 = {
  object_type: "device_channel",
  canonical_id: "11111111-1111-4111-8111-111111111111:switch_3",
  label: "3Gang Living room · Channel 3",
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

check("offline devices is canonical home inventory, not generic current state", () => {
  const contract = runtime.canonicalIntelligenceContractForTest({ message: "Show offline devices.", object: channel3 });
  assert.equal(contract.intent, "device_availability_inventory");
  assert.equal(contract.operation_class, "report");
  assert.equal(contract.scope_mode, "home_scope");
  assert.equal(contract.answer_builder, "device_availability_inventory");
});

check("home summary is a canonical home operational summary", () => {
  const contract = runtime.canonicalIntelligenceContractForTest({ message: "What's happening in my home?", object: channel3 });
  assert.equal(contract.intent, "home_operational_summary");
  assert.equal(contract.operation_class, "report");
  assert.equal(contract.scope_mode, "home_scope");
  assert.equal(contract.answer_builder, "home_operational_summary");
});

check("pronoun/reference exact channel remains exact", () => {
  const contract = runtime.canonicalIntelligenceContractForTest({ message: "Is it on?", object: channel3 });
  assert.equal(contract.intent, "current_state");
  assert.equal(contract.scope_mode, "exact_target");
  assert.equal(contract.target.canonical_id, channel3.canonical_id);
  assert.equal(contract.target.channel_code, "switch_3");
});

check("explicit channel replacement overrides inherited selected channel", () => {
  const contract = runtime.canonicalIntelligenceContractForTest({ message: "Turn on Channel 1.", object: channel3 });
  assert.equal(contract.intent, "device_control");
  assert.equal(contract.operation_class, "execute_mutation");
  assert.equal(contract.target.canonical_id, "11111111-1111-4111-8111-111111111111:switch_1");
  assert.equal(contract.target.channel_code, "switch_1");
});

check("turn interpretation and context layers are persisted", () => {
  assert.match(runtimeSource, /export type TurnInterpretation/);
  assert.match(runtimeSource, /export type ConversationContextLayers/);
  assert.match(runtimeSource, /turn_interpretation: turnInterpretation/);
  assert.match(runtimeSource, /conversation_context_layers: contextLayers/);
  assert.match(runtimeSource, /conversation_turn_interpreted/);
});

check("broad turns construct a canonical home object instead of no exact object", () => {
  assert.match(runtimeSource, /function constructBroadScopeObject/);
  assert.match(runtimeSource, /object_type: "home"/);
  assert.match(runtimeSource, /source: "current_turn_explicit_scope"/);
  assert.match(runtimeSource, /conversation_explicit_scope_applied/);
});

check("thread list returns preview, message count, stable ordering and last scope", () => {
  assert.match(unifiedSource, /function threadMessageSummary/);
  assert.match(unifiedSource, /message_count/);
  assert.match(unifiedSource, /preview/);
  assert.match(unifiedSource, /last_scope/);
  assert.match(unifiedSource, /\.order\("created_at", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\)/);
  assert.match(unifiedSource, /\.filter\(\(thread\) => Number\(thread\.message_count \|\| 0\) > 0\)/);
});

check("thread turn persistence is verified before a saved thread id is returned", () => {
  assert.match(unifiedSource, /verifyThreadTurnPersistence\(threadId, 2\)/);
  assert.match(unifiedSource, /cleanupOrphanConversationThread\(threadId\)/);
  assert.match(unifiedSource, /response\.thread_id = null/);
  assert.match(runtimeSource, /verifyCanonicalCurrentTurnPersistence\(threadId, userMessageId, assistantId, contract\.conversation_request_id\)/);
  assert.match(runtimeSource, /const assistantId = randomUUID\(\)/);
  assert.match(runtimeSource, /responseIdentifier\(response, contract\.conversation_request_id\)/);
  assert.match(runtimeSource, /failedStage = "thread_upsert"/);
  assert.match(runtimeSource, /failedStage = "user_message_insert"/);
  assert.match(runtimeSource, /failedStage = "assistant_message_insert"/);
  assert.match(runtimeSource, /failedStage = "current_turn_verification"/);
  assert.match(runtimeSource, /failedStage = "thread_summary_update"/);
  assert.match(runtimeSource, /conversation_persistence_stage_completed/);
  assert.match(runtimeSource, /conversation_turn_persist_verified/);
  assert.match(runtimeSource, /cleanupCanonicalTurnRows\(\{ threadId, userMessageId, assistantMessageId: assistantId, deleteThread: newlyCreatedThread \}\)/);
  assert.match(runtimeSource, /conversation_turn_compensation_failed/);
  assert.match(runtimeSource, /thread_id: persistedThreadId \|\| null/);
});

check("canonical runtime is the only persistence owner for compatibility fallback", () => {
  assert.match(unifiedSource, /persist\?: boolean/);
  assert.match(unifiedSource, /effectiveInput\.persist !== false/);
  assert.match(runtimeSource, /persist: false/);
  assert.match(runtimeSource, /runOyiUnifiedChat\(actor, compatibilityInput\)/);
  assert.match(runtimeSource, /persistCanonicalAuthoritativeMessages\(actor, input, \{ \.\.\.shapedCompatibility/);
  assert.doesNotMatch(runtimeSource, /await persistCanonicalShapedAssistantMessage\(threadId, shapedCompatibility/);
});

check("thread continuation does not force generic titles", () => {
  assert.match(runtimeSource, /currentThreadTitle/);
  assert.match(runtimeSource, /genericThreadTitle/);
  assert.match(runtimeSource, /titleFromTurn/);
  assert.match(runtimeSource, /conversation_thread_continued/);
});

check("module navigation and domain list operations override inherited exact targets", () => {
  const openDevices = runtime.canonicalIntelligenceContractForTest({ message: "Open devices", object: channel3 });
  assert.equal(openDevices.intent, "module_navigation");
  assert.equal(openDevices.operation_class, "navigate");
  assert.equal(openDevices.scope_mode, "home_scope");
  assert.equal(openDevices.answer_builder, "semantic_navigation");

  const showWallet = runtime.canonicalIntelligenceContractForTest({ message: "Show wallet", object: channel3 });
  assert.equal(showWallet.intent, "domain_list");
  assert.equal(showWallet.operation_class, "list");
  assert.equal(showWallet.scope_mode, "home_scope");
  assert.equal(showWallet.answer_builder, "domain_list");

  const openVisitor = runtime.canonicalIntelligenceContractForTest({ message: "Open visitor", object: channel3 });
  assert.equal(openVisitor.intent, "module_navigation");
  assert.equal(openVisitor.operation_class, "navigate");
  assert.equal(openVisitor.scope_mode, "home_scope");
});

check("current-turn authority rejects stale inherited targets for global, room and show/list turns", () => {
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "What can you do?", object: channel3 }), false);
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "What should I check first?", object: channel3 }), false);
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "What is happening in Bedroom 2?", object: channel3 }), false);
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Show offline devices", object: channel3 }), false);
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Is this channel on?", object: channel3 }), true);
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({
    message: "Show activity for this selected device",
    object: channel3,
    request: { scope_mode_hint: "exact_target", intent_hint: "activity_history" },
  }), true);
});

check("builder registry routes exact device requests to specialist builders", () => {
  const activity = runtime.canonicalIntelligenceContractForTest({ message: "Show activity for this selected device", object: channel3 });
  assert.equal(activity.intent, "activity_history");
  assert.equal(activity.scope_mode, "exact_target");
  assert.equal(activity.answer_builder, "recent_changes");
  assert.match(runtimeSource, /type ConversationBuilderKey/);
  assert.match(runtimeSource, /function selectConversationBuilder/);
  assert.match(runtimeSource, /conversation_builder_selected/);
  assert.match(runtimeSource, /device_activity/);

  const failures = runtime.canonicalIntelligenceContractForTest({ message: "Show failures for this selected device", object: channel3 });
  assert.equal(failures.intent, "failure_history");
  assert.equal(failures.answer_builder, "failure_history");

  const diagnosis = runtime.canonicalIntelligenceContractForTest({ message: "Diagnose this selected device", object: channel3 });
  assert.equal(diagnosis.intent, "diagnosis");
  assert.equal(diagnosis.answer_builder, "device_diagnosis");

  const relationships = runtime.canonicalIntelligenceContractForTest({ message: "View relationships for this selected device", object: channel3 });
  assert.equal(relationships.intent, "relationships");
  assert.equal(relationships.answer_builder, "device_relationships");
});

check("named device resolution and clarification lifecycle are first-class", () => {
  assert.match(runtimeSource, /type DeviceResolutionResult/);
  assert.match(runtimeSource, /function namedDevicePhraseFromControlMessage/);
  assert.match(runtimeSource, /resolveNamedDeviceForRead/);
  assert.match(runtimeSource, /current_turn_named_device_ambiguous/);
  assert.match(runtimeSource, /current_turn_named_device_not_found/);
  assert.match(runtimeSource, /operationClass = "clarify"/);
  assert.match(runtimeSource, /resolved_turn: resolvedConversationTurnFromContract/);
});

check("semantic destination registry is canonical and surface-routed", () => {
  assert.match(intentRoutingSource, /const SEMANTIC_DESTINATIONS/);
  assert.match(intentRoutingSource, /devices\.module/);
  assert.match(intentRoutingSource, /devices\.detail/);
  assert.match(intentRoutingSource, /rooms\.detail/);
  assert.match(intentRoutingSource, /wallet\.summary/);
  assert.match(intentRoutingSource, /camera\.private_live_view/);
  assert.match(intentRoutingSource, /digital_twin\.object/);
  assert.match(intentRoutingSource, /function routeForSemanticDestination/);
  assert.match(runtimeSource, /interpretSemanticOperationForRouting/);
  assert.match(runtimeSource, /semanticOperationActionForRouting/);
  assert.match(runtimeSource, /semanticOperationAction/);
});

check("room navigation resolves as a room destination instead of selected device fallback", () => {
  const turn = runtime.canonicalResolvedTurnForTest({ message: "Open Bedroom 2", object: channel3 });
  assert.equal(turn.contract.intent, "module_navigation");
  assert.equal(turn.contract.operation_class, "navigate");
  assert.equal(turn.contract.scope_mode, "room_scope");
  assert.equal(turn.resolved_turn.operation, "navigate_object");
  assert.equal(turn.resolved_turn.scope, "room");
  assert.equal(turn.resolved_turn.destination.key, "rooms.detail");
  assert.equal(turn.resolved_turn.destination.parameters.room_name, "Bedroom 2");
});

check("room intelligence binds room phrases before inherited context", () => {
  assert.match(runtimeSource, /function roomPhraseFromMessage/);
  assert.match(runtimeSource, /resolveRoomForRead/);
  assert.match(runtimeSource, /current_turn_room_reference/);
  assert.match(runtimeSource, /contract\.scope_mode === "room_scope" && scope\.room_id/);
  const roomSummary = runtime.canonicalIntelligenceContractForTest({
    message: "What is happening in Bedroom 2?",
    object: { ...channel3, object_type: "room", canonical_id: "room-2", label: "Bedroom 2", parent_id: "home-1", source_module: "rooms" },
  });
  assert.equal(roomSummary.scope_mode, "room_scope");
  assert.equal(roomSummary.intent, "home_operational_summary");
});

check("resolved turn exposes operation, authority, destination and presentation policy", () => {
  const nav = runtime.canonicalResolvedTurnForTest({ message: "Open devices", object: channel3 });
  assert.equal(nav.resolved_turn.operation, "navigate_module");
  assert.equal(nav.resolved_turn.domain, "devices");
  assert.equal(nav.resolved_turn.destination.key, "devices.module");
  assert.equal(nav.resolved_turn.authority.allowed, true);
  assert.equal(nav.presentation_policy.primary, "navigation_transition");
  assert.equal(nav.presentation_policy.auto_navigation, true);
  assert.deepEqual(nav.presentation_policy.allowed_supporting_blocks, ["navigation_action", "handoff"]);

  const inventory = runtime.canonicalResolvedTurnForTest({ message: "Show offline devices.", object: channel3 });
  assert.equal(inventory.resolved_turn.operation, "list");
  assert.equal(inventory.resolved_turn.scope, "home");
  assert.equal(inventory.presentation_policy.primary, "table");
  assert.equal(inventory.presentation_policy.auto_navigation, false);
  assert.equal(inventory.presentation_policy.suppress_equivalent_awareness, true);
  assert.equal(inventory.presentation_policy.suppress_context_chips, true);
});

check("structured table blocks persist snapshot metadata for historical and inventory answers", () => {
  const inventory = runtime.canonicalConversationTableBlockForTest({
    message: "Show offline devices.",
    facts: [{
      id: "device-1",
      fact_id: "availability-1",
      fact_type: "device_availability",
      statement: "Bedroom switch is stale",
      value: { availability: "stale", device_family: "switch", room_name: "Bedroom 2" },
      object: { object_type: "device", canonical_id: "device-1", label: "Bedroom switch" },
      scope: { device_id: "device-1", device_name: "Bedroom switch", room_name: "Bedroom 2" },
      observed_at: new Date().toISOString(),
      occurred_at: new Date().toISOString(),
      freshness: "stale",
      confidence: 0.9,
      truth_state: "observed",
    }],
  });
  assert.equal(inventory.type, "table");
  assert.equal(inventory.snapshot.snapshot_mode, "current_state_snapshot");
  assert.equal(inventory.snapshot.scope, "home_scope");

  const changes = runtime.canonicalConversationTableBlockForTest({
    message: "What changed recently?",
    facts: [{
      id: "change-1",
      fact_id: "change-1",
      fact_type: "device_command",
      statement: "Switch changed",
      value: { result: "confirmed", action: "Turned off" },
      object: { object_type: "device", canonical_id: "device-1", label: "Bedroom switch" },
      scope: { device_id: "device-1", device_name: "Bedroom switch", room_name: "Bedroom 2" },
      observed_at: new Date().toISOString(),
      occurred_at: new Date().toISOString(),
      freshness: "fresh",
      confidence: 0.9,
      truth_state: "confirmed",
    }],
  });
  assert.equal(changes.snapshot.snapshot_mode, "historical");
});

check("offline inventory presentation suppresses redundant awareness and source chips", () => {
  assert.match(runtimeSource, /const suppressAwareness = Boolean\(presentationPolicy\.suppress_equivalent_awareness\) && presentationPolicy\.primary === "table"/);
  assert.match(runtimeSource, /sources: suppressSources \? \[\] :/);
  assert.match(runtimeSource, /label: "Open Devices"/);
});

check("approval and action policy remains separated from read-only presentation", () => {
  const mutation = runtime.canonicalResolvedTurnForTest({ message: "Turn on Channel 1.", object: channel3 });
  assert.equal(mutation.contract.operation_class, "execute_mutation");
  assert.equal(mutation.resolved_turn.operation, "control");
  assert.equal(mutation.resolved_turn.authority.confirmation_required, true);
  assert.equal(mutation.presentation_policy.primary, "approval");
  assert.deepEqual(mutation.presentation_policy.allowed_supporting_blocks, ["approval", "command_result"]);
});

check("conversation time truth never renders Invalid Date and labels known calendar context", () => {
  assert.equal(runtime.canonicalTimeLabelForTest(null), "Time unavailable");
  assert.equal(runtime.canonicalTimeLabelForTest("not-a-date"), "Time unavailable");
  assert.doesNotMatch(runtime.canonicalTimeLabelForTest(new Date().toISOString()), /Invalid Date/);
  const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  assert.match(runtime.canonicalTimeLabelForTest(yesterday), /Yesterday|[A-Z][a-z]{2}\s+\d{1,2}/);
});

console.log("conversation-foundation-smoke passed");
