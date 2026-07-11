import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const runtime = await import("../dist/oyi-core/runtime/canonicalConversationRuntime.js");

assert.equal(runtime.canonicalTruthStateForTest({ status: "pending_confirmation" }), "pending_confirmation");
assert.equal(runtime.canonicalTruthStateForTest({ status: "denied" }), "permission_restricted");
assert.equal(runtime.canonicalTruthStateForTest({ status: "validation_required" }), "unsupported");
assert.equal(runtime.canonicalTruthStateForTest({ status: "executed" }), "confirmed");
assert.equal(runtime.canonicalTruthStateForTest({ hasAwareness: true, severity: "warning" }), "observed");
assert.equal(runtime.canonicalTruthStateForTest({ hasSources: true }), "observed");
assert.equal(runtime.canonicalTruthStateForTest({}), "inferred");

const object = {
  object_type: "device",
  canonical_id: "device-1",
  label: "Bedroom Light",
  estate_id: "estate-1",
  building_id: null,
  home_id: "home-1",
  room_id: "room-1",
  parent_id: null,
  source_module: "devices",
  capabilities: ["switch"],
  current_state: "off",
  health: "healthy",
  permissions: [],
  relationships: { room_name: "Bedroom" },
  evidence_references: [],
  metadata: {},
  freshness: "2026-07-11T10:00:00.000Z",
};
const shaped = runtime.canonicalObjectConversationForTest({
  message: "Is it working?",
  object,
  response: { message: "There are 27 devices connected.", execution: { status: "read_only" } },
  request: { primary_state: "off", memory_summary: { summary: "It was turned off 12 minutes ago." } },
});
assert.match(shaped.message, /Bedroom Light is off/i);
assert.doesNotMatch(shaped.message, /27 devices/i);
assert.ok(shaped.suggested_actions.some((action) => action.label === "Turn On"));

console.log("canonical truth smoke ok");
