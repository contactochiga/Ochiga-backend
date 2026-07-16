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
assert.ok(shaped.suggested_actions.some((action) => action.label === "Relationships"));

const successShape = runtime.canonicalObjectConversationForTest({
  message: "Turn it on",
  object: { ...object, current_state: "on" },
  response: { message: "I could not complete that request.", execution: { status: "executed", results: [{ status: "executed", new_state: "on" }] } },
});
assert.match(successShape.message, /Done/i);
assert.match(successShape.message, /Bedroom Light/i);
assert.doesNotMatch(successShape.message, /could not|failed|unable/i);

const partialShape = runtime.canonicalObjectConversationForTest({
  message: "Turn it on",
  object,
  response: { message: "Provider acknowledgement missing.", execution: { status: "partial_confirmation" } },
});
assert.match(partialShape.message, /waiting for confirmation from the controller/i);
assert.doesNotMatch(partialShape.message, /provider|acknowledgement|runtime|backend|telemetry/i);

const confirmationShape = runtime.canonicalObjectConversationForTest({
  message: "Proceed",
  object,
  response: { message: "Proceed?", requiresConfirmation: true, execution: { status: "pending_confirmation" }, confirmations: [{ summary: "Turning this on will energize Bedroom Light." }] },
});
assert.match(confirmationShape.message, /Bedroom Light/i);
assert.match(confirmationShape.message, /Would you like me to continue/i);
assert.doesNotMatch(confirmationShape.message, /^Proceed\??$/i);

const unsupportedShape = runtime.canonicalObjectConversationForTest({
  message: "Dim it",
  object,
  response: { message: "Unsupported capability.", execution: { status: "unsupported", reason: "unsupported capability" } },
});
assert.match(unsupportedShape.message, /doesn.t support that feature/i);
assert.doesNotMatch(unsupportedShape.message, /unsupported capability|runtime|provider|backend|api/i);

const wallet = {
  ...object,
  object_type: "wallet",
  canonical_id: "wallet-1",
  label: "Main Wallet",
  source_module: "wallet",
  capabilities: ["transactions", "receipt"],
  current_state: "available",
  relationships: { transactions: [{ id: "txn-1", title: "Wallet funding" }] },
};
const walletShape = runtime.canonicalObjectConversationForTest({
  message: "What can you do?",
  object: wallet,
  response: { message: "I can help with devices.", execution: { status: "read_only" } },
});
assert.match(walletShape.message, /balance|funding|charges|receipts|payment/i);
assert.doesNotMatch(walletShape.message, /device/i);
assert.ok(walletShape.suggested_actions.some((action) => action.label === "Receipt"));

const visitor = {
  ...object,
  object_type: "visitor",
  canonical_id: "visitor-1",
  label: "David Musa",
  source_module: "visitors",
  capabilities: ["approve", "extend"],
  current_state: "waiting",
  relationships: { arrival_history: [{ id: "visit-1" }] },
};
const visitorShape = runtime.canonicalObjectConversationForTest({
  message: "Who is this?",
  object: visitor,
  response: { message: "There are 12 visitors.", execution: { status: "read_only" } },
});
assert.match(visitorShape.message, /David Musa/i);
assert.doesNotMatch(visitorShape.message, /12 visitors/i);
assert.ok(visitorShape.suggested_actions.some((action) => action.label === "Approve"));

const evidenceShape = runtime.canonicalObjectConversationForTest({
  message: "How do you know?",
  object,
  response: { message: "Runtime unavailable.", execution: { status: "read_only" }, sources: [{ id: "activity-1" }] },
});
assert.match(evidenceShape.message, /checked 1 relevant record/i);
assert.doesNotMatch(evidenceShape.message, /runtime|backend|api|telemetry|provider/i);

const alreadyOnShape = runtime.canonicalObjectConversationForTest({
  message: "Turn it on",
  object: { ...object, current_state: "on" },
  response: { message: "Command completed.", execution: { status: "read_only" } },
});
assert.match(alreadyOnShape.message, /already ON/i);
assert.match(alreadyOnShape.message, /Nothing needed to change/i);

const occupiedRoomShape = runtime.canonicalObjectConversationForTest({
  message: "Turn everything off",
  object: { ...object, object_type: "room", canonical_id: "room-1", label: "Living Room", current_state: "active" },
  response: { message: "Command completed.", execution: { status: "read_only" } },
  request: { relationships: { occupied_rooms: [{ id: "room-1", name: "Living Room" }] } },
});
assert.match(occupiedRoomShape.message, /still occupied/i);
assert.match(occupiedRoomShape.message, /unoccupied areas/i);

const reasonShape = runtime.canonicalObjectConversationForTest({
  message: "Why did it turn on?",
  object: { ...object, current_state: "on" },
  response: { message: "Recommendation generated.", execution: { status: "read_only" } },
  request: {
    active_automations: [{ id: "auto-1", name: "Evening Arrival" }],
    relationships: { sensors: [{ id: "sensor-1", name: "Bedroom Motion Sensor" }] },
    memory_summary: { summary: "Motion was detected less than two minutes ago." },
  },
});
assert.match(reasonShape.message, /Evening Arrival|Bedroom Motion Sensor|Motion was detected/i);
assert.doesNotMatch(reasonShape.message, /Recommendation generated/i);

const predictionShape = runtime.canonicalObjectConversationForTest({
  message: "What is happening?",
  object: { ...object, current_state: "on" },
  response: { message: "I can help.", execution: { status: "read_only" } },
  request: { predictive_findings: [{ summary: "energy usage has increased for the last four evenings" }] },
});
assert.match(predictionShape.message, /Based on recent activity/i);
assert.match(predictionShape.message, /energy usage has increased/i);

const building = {
  ...object,
  object_type: "building",
  canonical_id: "building-a",
  label: "Building A",
  building_id: "building-a",
  home_id: null,
  room_id: null,
  source_module: "estate",
  capabilities: ["spatial_reasoning"],
  current_state: "active",
  health: "attention",
  relationships: {
    estate_name: "Ochiga Estate",
    floors: [{ id: "floor-1", name: "First Floor" }, { id: "floor-2", name: "Second Floor" }],
    rooms: [{ id: "room-1", name: "Bedroom", occupancy: "occupied" }],
    devices: [
      { id: "dev-1", name: "Bedroom Light", type: "light", state: "on", room_name: "Bedroom" },
      { id: "dev-2", name: "Corridor Camera", type: "camera", health: "offline" },
    ],
  },
};
const buildingShape = runtime.canonicalObjectConversationForTest({
  message: "Show me Building A",
  object: building,
  response: { message: "There are 27 devices connected.", execution: { status: "read_only" } },
});
assert.match(buildingShape.message, /Building A contains 2 floors, 1 room, 2 devices/i);
assert.doesNotMatch(buildingShape.message, /27 devices/i);

const lightsOnShape = runtime.canonicalObjectConversationForTest({
  message: "Which rooms still have lights on?",
  object: building,
  response: { message: "I can help.", execution: { status: "read_only" } },
});
assert.match(lightsOnShape.message, /Bedroom still has lights on/i);

const offlineAreaShape = runtime.canonicalObjectConversationForTest({
  message: "Which areas are offline?",
  object: building,
  response: { message: "I can help.", execution: { status: "read_only" } },
});
assert.match(offlineAreaShape.message, /offline or degraded/i);
assert.match(offlineAreaShape.message, /Corridor Camera/i);

const transformer = {
  ...object,
  object_type: "infrastructure_asset",
  canonical_id: "asset-transformer-a",
  label: "Transformer A",
  building_id: "building-a",
  home_id: null,
  room_id: null,
  source_module: "infrastructure",
  capabilities: ["spatial_reasoning", "dependency_reasoning"],
  current_state: "offline",
  health: "critical",
  relationships: {
    estate_name: "Ochiga Estate",
    building_name: "Building A",
    dependencies: [{ id: "grid", name: "Grid Supply" }],
    dependent_devices: [{ id: "db-a", name: "Distribution Board A" }, { id: "pump-a", name: "Water Pump A" }],
    affected_areas: [{ id: "floor-1", name: "First Floor" }, { id: "room-1", name: "Bedroom" }],
  },
};
const transformerShape = runtime.canonicalObjectConversationForTest({
  message: "What is affected if this fails?",
  object: transformer,
  response: { message: "Recommendation generated.", execution: { status: "read_only" } },
});
assert.match(transformerShape.message, /Distribution Board A|Water Pump A/i);
assert.match(transformerShape.message, /First Floor|Bedroom/i);
assert.doesNotMatch(transformerShape.message, /Recommendation generated/i);

const cameraLocationShape = runtime.canonicalObjectConversationForTest({
  message: "Which entrance is this camera protecting?",
  object: { ...object, object_type: "camera", canonical_id: "camera-1", label: "North Gate Camera", source_module: "security", relationships: { estate_name: "Ochiga Estate", building_name: "Gate House", room_name: "North Entrance" } },
  response: { message: "I can help.", execution: { status: "read_only" } },
});
assert.match(cameraLocationShape.message, /North Gate Camera sits in Ochiga Estate → Gate House → North Entrance/i);

console.log("canonical truth smoke ok");
