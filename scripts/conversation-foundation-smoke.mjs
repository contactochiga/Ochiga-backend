import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtimeSource = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalConversationRuntime.ts"), "utf8");
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
  assert.equal(contract.scope_mode, "explicit_broad_scope");
  assert.equal(contract.answer_builder, "device_availability_inventory");
});

check("home summary is a canonical home operational summary", () => {
  const contract = runtime.canonicalIntelligenceContractForTest({ message: "What's happening in my home?", object: channel3 });
  assert.equal(contract.intent, "home_operational_summary");
  assert.equal(contract.operation_class, "report");
  assert.equal(contract.scope_mode, "explicit_broad_scope");
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
});

check("thread continuation does not force generic titles", () => {
  assert.match(runtimeSource, /currentThreadTitle/);
  assert.match(runtimeSource, /genericThreadTitle/);
  assert.match(runtimeSource, /titleFromTurn/);
  assert.match(runtimeSource, /conversation_thread_continued/);
});

console.log("conversation-foundation-smoke passed");
