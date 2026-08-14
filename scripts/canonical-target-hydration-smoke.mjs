import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const registry = await import("../dist/oyi-core/runtime/canonicalTargetHydrationRegistry.js");
const panelHydrationSource = await readFile(new URL("../src/services/canonicalDevicePanelHydrationService.ts", import.meta.url), "utf8");
const panelControllerSource = await readFile(new URL("../src/controllers/deviceStateController.ts", import.meta.url), "utf8");
const readResolverSource = await readFile(new URL("../src/services/canonicalDeviceReadResolver.ts", import.meta.url), "utf8");
const hydrationRegistrySource = await readFile(new URL("../src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts", import.meta.url), "utf8");

async function runPhantomTableDefectRegression() {
  // meter/infrastructure_asset previously pointed at utility_meters/
  // facility_assets, neither of which exists in any migration — every
  // hydration attempt for these types issued a doomed query. They must now
  // resolve to "unsupported" without touching the database at all (no
  // config entry means genericExactLoader short-circuits before querying).
  assert.doesNotMatch(hydrationRegistrySource, /"utility_meters"/);
  assert.doesNotMatch(hydrationRegistrySource, /"facility_assets"/);
  const meterResult = await registry.hydrateCanonicalTarget({
    target: { objectType: "meter", objectId: "meter-1", ambiguous: false },
    homeId: "home-a",
    estateId: "estate-a",
  });
  assert.equal(meterResult.status, "unsupported");
  const assetResult = await registry.hydrateCanonicalTarget({
    target: { objectType: "infrastructure_asset", objectId: "asset-1", ambiguous: false },
    homeId: "home-a",
    estateId: "estate-a",
  });
  assert.equal(assetResult.status, "unsupported");

  // wallet_transactions has no currency column (it lives in
  // metadata.currency) — selecting it made every transaction hydration
  // fail with a "column does not exist" query error.
  assert.doesNotMatch(hydrationRegistrySource, /transaction:\s*\{[^}]*\bcurrency\b/);
}

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

function runScopeParityGuards() {
  assert.match(panelHydrationSource, /resolveCanonicalDeviceForRead/);
  assert.match(panelControllerSource, /resolveCanonicalDeviceForRead/);
  assert.doesNotMatch(panelHydrationSource, /\.eq\("estate_id",\s*estateId\)/);
  assert.doesNotMatch(panelControllerSource, /\.eq\("estate_id",\s*input\.estateId\)/);
  assert.match(readResolverSource, /\.from\("devices"\)\.select\(selection\)/);
  assert.match(readResolverSource, /homeBelongsToEstate/);
  assert.match(readResolverSource, /device_outside_active_home/);
  assert.match(readResolverSource, /technical_provider_object_hidden/);
}

runQueryErrorTruth();
runPanelMapping();
runVisibleFallback();
runScopeParityGuards();

console.log("canonical-target-hydration-smoke passed");
