#!/usr/bin/env node

process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "runtime-payload-budget-smoke-service-role-key";

const {
  DEVICE_RUNTIME_PAYLOAD_BYTE_LIMIT,
  buildCompactRuntimeDashboardDevice,
} = await import("../dist/controllers/deviceRuntimeStateController.js");

const checks = [];
const check = (passed, label) => checks.push([Boolean(passed), label]);

const now = "2026-07-26T18:00:00.000Z";
const verboseEvidence = Object.fromEntries(
  Array.from({ length: 24 }, (_, index) => [`provider_evidence_${index}`, {
    code: `provider_code_${index}`,
    description: "Verbose provider evidence must not be shipped in the inventory contract.",
    values: Array.from({ length: 8 }, (_unused, item) => ({ item, status: "declared_only" })),
  }]),
);

function irKeys() {
  return [
    ["power", "Power", 101],
    ["mute", "Mute", 106],
    ["volume_up", "Volume +", 115],
    ["volume_down", "Volume -", 114],
    ["up", "Up", 201],
    ["down", "Down", 202],
    ["left", "Left", 203],
    ["right", "Right", 204],
    ["ok", "OK", 205],
    ["back", "Back", 206],
    ["home", "Home", 207],
    ["menu", "Menu", 208],
    ["source", "Source", 209],
  ].map(([canonical, label, id]) => ({
    canonical_key: canonical,
    key: label,
    key_code: label,
    provider_key: label,
    key_id: id,
    label,
    raw_provider_payload: verboseEvidence,
  }));
}

function device(index, patch = {}) {
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    name: `Runtime Device ${index}`,
    estate_id: "estate-runtime",
    home_id: "home-runtime",
    room_id: `room-${index}`,
    room_name: index === 1 ? "Bedroom" : `Room ${index}`,
    external_id: `tuya-device-${index}`,
    provider: "tuya",
    vendor: "tuya",
    adapter: "tuya",
    type: "switch",
    category: "switch",
    capabilities: ["switch", "online", "countdown", "relay_status", "verbose_unused_capability"],
    metadata: {
      device_family: "switch",
      control_profile: "switch",
      ownership_class: "resident_owned",
      projection_policy: "resident_private",
      raw: verboseEvidence,
      ...patch.metadata,
    },
    last_seen_at: now,
    updated_at: now,
    ...patch,
  };
}

function runtimeFor(deviceRow, patch = {}) {
  const family = patch.device_family || deviceRow.metadata?.device_family || "switch";
  const profile = patch.control_profile || deviceRow.metadata?.control_profile || "switch";
  const normalized = patch.normalized_state || { online: true, power: indexPower(deviceRow.id) };
  const canonicalState = {
    availability: patch.availability || "online",
    availabilityReason: "provider_reports_online",
    lastSeenAt: now,
    lastProviderSyncAt: now,
    staleAfterMs: 10_000,
    primaryState: patch.primaryState || { key: "power", value: normalized.power, label: normalized.power ? "On" : "Off" },
    secondaryState: patch.secondaryState || null,
    batteryPercentage: patch.batteryPercentage ?? null,
    batteryLevel: patch.batteryLevel || "unknown",
    alerts: patch.alerts || [],
    supportedActions: patch.supportedActions || ["power"],
    executableActions: patch.executableActions || ["power"],
    providerEvidence: verboseEvidence,
  };
  return {
    state: {
      online: normalized.online,
      power: normalized.power,
      switch: normalized.power,
      switch_1: normalized.switches?.switch_1,
      switch_2: normalized.switches?.switch_2,
      switch_3: normalized.switches?.switch_3,
      residual_electricity: patch.batteryPercentage,
      normalized_state: normalized,
      raw_provider_payload: verboseEvidence,
    },
    summary: {
      normalized_state: normalized,
      canonical_state: canonicalState,
      primary_state: patch.primary_state || canonicalState.primaryState.label.toLowerCase(),
      health_status: patch.health_status || "stable",
      provider_health: patch.provider_health || "healthy",
      supported_controls: patch.supported_controls || canonicalState.supportedActions,
      capabilities: ["switch", "online", "verbose_unused_capability"],
      channel_definitions: patch.channel_definitions || [],
      control_profile: profile,
      device_family: family,
      activity_summary: patch.activity_summary || canonicalState.primaryState.label,
      capability_codes: patch.capability_codes || ["switch", "online"],
      telemetry_summary: verboseEvidence,
    },
    provider_timestamp: now,
    runtime_timestamp: now,
    last_refresh: now,
    ttl: 10_000,
    stale: patch.stale ?? false,
    freshness: patch.freshness || "fresh",
    dirty: false,
    source: "persistent_snapshot",
    provider_error: patch.provider_error || null,
    authorization_state: patch.authorization_state || "authorized",
    provider_warning: patch.provider_warning || null,
    retry_after: patch.retry_after || null,
    last_successful_refresh: now,
  };
}

function indexPower(id) {
  return Number(String(id).slice(-1)) % 2 === 0;
}

const rows = [
  device(1, { name: "Bedroom Light" }),
  device(2, { name: "Kitchen Socket", metadata: { device_family: "plug", control_profile: "plug" } }),
  device(3, {
    name: "Living Room Switch",
    metadata: { device_family: "switch", control_profile: "multi_gang_switch" },
  }),
  device(4, {
    name: "Television",
    is_virtual: true,
    parent_device_id: "hub-1",
    type: "television",
    category: "infrared_tv",
    metadata: {
      device_family: "television",
      control_profile: "ir_tv",
      ir_appliance: {
        infrared_id: "bfeb1c4cca85f36998a4ku",
        remote_id: "bfe368d241e5e073b9ar1o",
        category_id: "tv",
        brand_id: "samsung",
        supported_keys: irKeys(),
      },
    },
  }),
  device(5, {
    name: "Bedroom AC",
    is_virtual: true,
    parent_device_id: "hub-1",
    type: "air_conditioner",
    category: "infrared_ac",
    metadata: {
      device_family: "climate",
      control_profile: "ir_ac",
      ir_appliance: {
        infrared_id: "bfeb1c4cca85f36998a4ku",
        remote_id: "ac-remote",
        category_id: "ac",
        brand_id: "lg",
        supported_keys: irKeys().slice(0, 6),
      },
    },
  }),
  device(6, {
    name: "Bedroom Door Lock",
    type: "lock",
    category: "jtmspro",
    metadata: { device_family: "lock", control_profile: "lock" },
  }),
  device(7, { name: "Hall Sensor", type: "sensor", category: "motion", metadata: { device_family: "sensor", control_profile: "sensor" } }),
  device(8, { name: "Water Heater", metadata: { device_family: "switch", control_profile: "switch" } }),
  device(9, { name: "Curtain", type: "curtain", category: "curtain", metadata: { device_family: "curtain", control_profile: "curtain" } }),
];

const runtimes = rows.map((row, index) => {
  if (index === 2) {
    return runtimeFor(row, {
      control_profile: "multi_gang_switch",
      normalized_state: { online: true, switches: { switch_1: true, switch_2: false, switch_3: true }, power: true },
      supported_controls: ["switch_1", "switch_2", "switch_3"],
      channel_definitions: [
        { index: 1, code: "switch_1", name: "Left", state: true, controllable: true, last_update: now },
        { index: 2, code: "switch_2", name: "Middle", state: false, controllable: true, last_update: now },
        { index: 3, code: "switch_3", name: "Right", state: true, controllable: true, last_update: now },
      ],
      capability_codes: ["switch_1", "switch_2", "switch_3"],
      primaryState: { key: "switches", value: "partial", label: "2 of 3 channels on" },
    });
  }
  if (index === 3) return runtimeFor(row, { device_family: "television", control_profile: "ir_tv", primaryState: { key: "remote", value: "ready", label: "Remote ready" }, supported_controls: ["remote_control"], executableActions: ["remote_control"] });
  if (index === 4) return runtimeFor(row, { device_family: "climate", control_profile: "ir_ac", primaryState: { key: "remote", value: "ready", label: "Remote ready" }, supported_controls: ["power", "temperature", "mode", "fan"], executableActions: ["power", "temperature", "mode", "fan"] });
  if (index === 5) return runtimeFor(row, { device_family: "lock", control_profile: "lock", batteryPercentage: 17, batteryLevel: "critical", primaryState: { key: "lock_state", value: "locked", label: "Locked" }, supported_controls: ["lock_state", "battery_level", "operation_history"], executableActions: [] });
  return runtimeFor(row);
});

const compactDevices = rows.map((row, index) => buildCompactRuntimeDashboardDevice(row, runtimes[index]));
const body = {
  devices: compactDevices,
  count: compactDevices.length,
  generated_at: now,
  source: "oyi_device_runtime_v2",
  provider_requests: 0,
  provider_requests_sync: 0,
  provider_requests_deferred: 0,
  provider_refreshes_scheduled: 0,
  dashboard_mode: "compact_cache_only",
  runtime: { cache_entries: 9, currently_viewed: 0 },
  freshness_counts: { fresh: 9, stale: 0, expired: 0, unknown: 0 },
  payload_budget_bytes: DEVICE_RUNTIME_PAYLOAD_BYTE_LIMIT,
};

const serialized = JSON.stringify(body);
const responseBytes = Buffer.byteLength(serialized, "utf8");
const legacyBody = JSON.stringify({
  ...body,
  devices: compactDevices.map((device, index) => ({
    ...device,
    canonicalState: device.canonical_state,
    presentation: device.canonical_presentation,
    normalized_state: runtimes[index].summary.normalized_state,
    capabilities: runtimes[index].summary.capabilities,
    telemetry_summary: verboseEvidence,
    providerEvidence: verboseEvidence,
  })),
});
const legacyBytes = Buffer.byteLength(legacyBody, "utf8");

check(responseBytes < DEVICE_RUNTIME_PAYLOAD_BYTE_LIMIT, `representative nine-device runtime payload is below ${DEVICE_RUNTIME_PAYLOAD_BYTE_LIMIT} bytes (${responseBytes})`);
check(legacyBytes > responseBytes, `compact inventory is smaller than legacy duplicated inventory (${legacyBytes} -> ${responseBytes})`);
check(compactDevices[3].metadata?.ir_appliance?.supported_keys?.some((key) => key.key_id === 106), "TV IR key evidence, including mute key_id 106, is preserved");
check(compactDevices[2].channel_definitions?.length === 3, "multi-gang channel definitions are preserved");
check(compactDevices[5].canonical_state?.batteryPercentage === 17, "smart-lock read-only battery presentation is preserved");
check(!serialized.includes("Verbose provider evidence"), "verbose provider evidence is not shipped in inventory response");

console.log(`runtime_payload_bytes_before=${legacyBytes}`);
console.log(`runtime_payload_bytes_after=${responseBytes}`);
for (const [passed, label] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
if (checks.some(([passed]) => !passed)) process.exit(1);
