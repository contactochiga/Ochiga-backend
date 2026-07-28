import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const registry = await import("../dist/oyi-core/runtime/canonicalTargetHydrationRegistry.js");

function validVisibleState(overrides = {}) {
  const fetchedAt = new Date().toISOString();
  return {
    source: "device_runtime_v2",
    object_type: "device",
    object_id: "device-a",
    home_id: "home-a",
    fetched_at: fetchedAt,
    freshness: "fresh",
    current_state: "off",
    health: "online",
    summary: {
      source: "device_runtime_v2",
      object_id: "device-a",
      canonical_device_id: "device-a",
      home_id: "home-a",
      fetched_at: fetchedAt,
      device_family: "switch",
      control_profile: "switch",
      supported_controls: ["power"],
      capability_codes: ["switch_1", "switch_2"],
      channel_definitions: [
        { code: "switch_1", label: "Channel 1", controllable: true },
        { code: "switch_2", label: "Channel 2", controllable: true },
      ],
      channel_states: { switch_1: "off", switch_2: "on" },
    },
    ...overrides,
  };
}

function runQueryErrorTruth() {
  const queryError = registry.checkedMaybeSingleOutcomeForTest({
    data: null,
    error: { code: "42703", message: "column devices.health_status does not exist" },
  });
  assert.equal(queryError.status, "query_failed");
  assert.equal(queryError.error_code, "42703");

  const noRow = registry.checkedMaybeSingleOutcomeForTest({ data: null, error: null });
  assert.equal(noRow.status, "not_found");

  const row = registry.checkedMaybeSingleOutcomeForTest({ data: { id: "row-1" }, error: null });
  assert.equal(row.status, "hydrated");
}

function runPanelMapping() {
  const mapped = registry.mapDevicePanelToHydrationForTest({
    source: "runtime_cache",
    panel: {
      device_id: "device-a",
      name: "2nd bedroom Light switch",
      home_id: "home-a",
      room_id: "room-a",
      device_family: "switch",
      control_profile: "switch",
      supported_controls: ["power"],
      capability_codes: ["switch_1", "switch_2"],
      primary_state: "Off",
      health_status: "online",
      freshness: { state: "fresh" },
      channel_definitions: [
        { code: "switch_1", label: "Channel 1" },
        { code: "switch_2", label: "Channel 2" },
      ],
      normalized_state: { switches: { switch_1: false, switch_2: true } },
    },
    device: { id: "device-a" },
  });
  assert.equal(mapped.object.object_type, "device");
  assert.equal(mapped.object.canonical_id, "device-a");
  assert.ok(mapped.capabilities.includes("switch_1"));
  assert.deepEqual(mapped.channel_keys.sort(), ["switch_1", "switch_2"]);

  const parsed = registry.parseDeviceChannelTargetForTest("device-a:switch_2");
  assert.equal(parsed.parent_device_id, "device-a");
  assert.equal(parsed.channel_code, "switch_2");
}

function runVisibleFallback() {
  const device = registry.validateVisibleStateFallbackForTest({
    homeId: "home-a",
    target: {
      objectType: "device",
      objectId: "device-a",
      objectName: "2nd bedroom Light switch",
      source: "active_page_object",
      confidence: 0.95,
      ambiguous: false,
    },
    visibleState: validVisibleState(),
  });
  assert.equal(device.status, "hydrated");
  assert.equal(device.source, "validated_visible_state");

  const channel = registry.validateVisibleStateFallbackForTest({
    homeId: "home-a",
    target: {
      objectType: "device_channel",
      objectId: "device-a:switch_2",
      objectName: "2nd bedroom Light switch · Channel 2",
      source: "selected_subobject",
      confidence: 0.96,
      ambiguous: false,
    },
    visibleState: validVisibleState({ object_type: "device_channel", object_id: "device-a:switch_2", parent_device_id: "device-a" }),
  });
  assert.equal(channel.status, "hydrated");
  assert.equal(channel.object.current_state, "on");

  const wrongHome = registry.validateVisibleStateFallbackForTest({
    homeId: "home-b",
    target: {
      objectType: "device",
      objectId: "device-a",
      objectName: "2nd bedroom Light switch",
      source: "active_page_object",
      confidence: 0.95,
      ambiguous: false,
    },
    visibleState: validVisibleState(),
  });
  assert.equal(wrongHome.status, "not_found");

  const unsupportedChannel = registry.validateVisibleStateFallbackForTest({
    homeId: "home-a",
    target: {
      objectType: "device_channel",
      objectId: "device-a:switch_3",
      objectName: "2nd bedroom Light switch · Channel 3",
      source: "selected_subobject",
      confidence: 0.96,
      ambiguous: false,
    },
    visibleState: validVisibleState({ object_type: "device_channel", object_id: "device-a:switch_3", parent_device_id: "device-a" }),
  });
  assert.equal(unsupportedChannel.status, "unsupported");
}

runQueryErrorTruth();
runPanelMapping();
runVisibleFallback();

console.log("canonical-target-hydration-smoke passed");
