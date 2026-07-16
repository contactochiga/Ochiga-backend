#!/usr/bin/env node

process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "tuya-authorization-smoke-service-role-key";

const { DeviceRuntimeStateService } = await import("../dist/services/deviceRuntimeStateService.js");
const { classifyProviderError, ProviderRequestError } = await import("../dist/device/runtime/providerErrors.js");

const checks = [];
const check = (passed, label) => checks.push([Boolean(passed), label]);
const state = {
  switch: false,
  online: true,
  normalized_state: { power: false, online: true, switches: { switch: false } },
  primary_state: "off",
  supported_controls: ["power"],
  control_profile: "switch",
  device_family: "switch",
  health_status: "stable",
  provider_health: "healthy",
  capability_codes: ["switch"],
  telemetry_summary: { online: true, power_state: false },
  activity_summary: "Test switch is idle.",
};
const device = {
  id: "device-authorization-test",
  name: "Test switch",
  external_id: "bf-authorized-device",
  estate_id: "estate-1",
  home_id: "home-1",
  room_id: "room-1",
  vendor: "tuya",
  provider: "tuya",
  adapter: "tuya",
  category: "switch",
  type: "switch",
  metadata: {
    device_family: "switch",
    control_profile: "switch",
    context: { userId: "user-1", tuyaUid: "tuya-uid-1" },
    oyi: { integration_owner_user_id: "user-1", provider_available: true },
    raw: { id: "bf-authorized-device", owner_id: "owner-1", category: "kg" },
  },
};

function permissionError() {
  return new ProviderRequestError({
    provider: "tuya",
    providerCode: 1106,
    providerMessage: "permission deny",
    operation: "getLiveState",
  });
}

let now = Date.parse("2026-07-16T12:00:00.000Z");
let successfulReads = 0;
const successfulRuntime = new DeviceRuntimeStateService({
  now: () => now,
  readProviderState: async () => {
    successfulReads += 1;
    return state;
  },
  persistSnapshot: async () => {},
  broadcast: () => {},
  emitSignal: async () => {},
});
const successful = await successfulRuntime.refresh(device, "high", "successful_refresh_test");
check(successfulReads === 1, "valid Tuya authorization performs one normal provider read");
check(successful?.authorization_state === "authorized", "successful provider read marks authorization as authorized");
check(successful?.provider_error === null && !successfulRuntime.isRefreshSuppressed(device.id), "valid devices receive no authorization backoff");

const signals = [];
const persisted = [];
let providerReads = 0;
let shouldFail = true;
const runtime = new DeviceRuntimeStateService({
  now: () => now,
  readProviderState: async () => {
    providerReads += 1;
    if (shouldFail) throw permissionError();
    return state;
  },
  persistSnapshot: async (entry) => { persisted.push(JSON.parse(JSON.stringify(entry.state))); },
  broadcast: () => {},
  emitSignal: async (signal) => { signals.push(signal); },
});
runtime.set(device, state);

const cachedFailure = await runtime.refresh(device, "high", "permission_test");
check(cachedFailure?.state?.normalized_state?.online === true, "Tuya 1106 preserves cached online state");
check(cachedFailure?.state?.primary_state === "off", "Tuya 1106 preserves the last physical primary state");
check(cachedFailure?.provider_error?.classification === "permission_denied", "Tuya 1106 is classified as permission_denied");
check(cachedFailure?.provider_warning === "This device needs its Tuya connection refreshed.", "Tuya 1106 exposes the safe frontend warning");
check(cachedFailure?.summary?.health_status !== "offline", "Tuya 1106 does not create a false physical offline state");
check(cachedFailure?.retry_after === new Date(now + 5 * 60_000).toISOString(), "first Tuya 1106 suppresses retries for five minutes");
check(signals.filter((signal) => signal.eventType === "device.provider.authorization_required").length === 1, "first Tuya 1106 emits one integration attention signal");

await runtime.refresh(device, "high", "screen_reopen_test");
check(providerReads === 1, "screen reopen during backoff does not call Tuya again");
check(signals.filter((signal) => signal.eventType === "device.provider.authorization_required").length === 1, "suppressed retries do not duplicate attention signals");

now = new Date(cachedFailure.retry_after).getTime() + 1;
const secondFailure = await runtime.refresh(device, "high", "backoff_retry_test");
check(providerReads === 2, "provider is retried after the suppression window");
check(secondFailure?.provider_error?.failure_count === 2, "repeated Tuya 1106 increments the authorization failure count");
check(new Date(secondFailure.retry_after).getTime() - now === 10 * 60_000, "authorization retry backoff doubles to ten minutes");
check(signals.filter((signal) => signal.eventType === "device.provider.authorization_required").length === 1, "attention remains deduplicated after a later failed retry");

let latestFailure = secondFailure;
for (let attempt = 0; attempt < 4; attempt += 1) {
  now = new Date(latestFailure.retry_after).getTime() + 1;
  latestFailure = await runtime.refresh(device, "high", "backoff_cap_test");
}
check(new Date(latestFailure.retry_after).getTime() - now === 60 * 60_000, "authorization retry backoff is capped at one hour");

await runtime.clearAuthorizationSuppressionForDevices([device]);
check(!runtime.isRefreshSuppressed(device.id), "integration relink clears authorization retry suppression");
shouldFail = false;
const recovered = await runtime.refresh(device, "high", "relink_recovery_test");
check(recovered?.authorization_state === "authorized" && recovered.provider_error === null, "successful read after relink clears the provider error");
check(recovered?.provider_warning === null && recovered.retry_after === null, "successful recovery clears warning and retry metadata");
check(signals.filter((signal) => signal.eventType === "device.provider.sync").length === 1, "authorization recovery emits one provider recovery signal");
check(signals.every((signal) => signal.eventType !== "device.state.changed"), "authorization metadata changes do not emit duplicate device state-change signals");
check(persisted.length > 0, "authorization error and recovery state are persisted");

const noCacheSignals = [];
const noCacheRuntime = new DeviceRuntimeStateService({
  now: () => now,
  readProviderState: async () => { throw permissionError(); },
  persistSnapshot: async () => {},
  broadcast: () => {},
  emitSignal: async (signal) => { noCacheSignals.push(signal); },
});
const noCacheFailure = await noCacheRuntime.refresh(device, "high", "no_cache_permission_test");
check(Boolean(noCacheFailure), "Tuya 1106 without cached state still returns a runtime snapshot");
check(noCacheFailure?.state?.normalized_state?.online == null, "Tuya 1106 without cached state remains unknown rather than offline");
check(noCacheFailure?.summary?.health_status !== "offline", "missing cached state does not fabricate an offline health state");
check(noCacheSignals.length === 1, "no-cache Tuya 1106 emits one attention signal");

const malformedDevice = { id: "bad-row", external_id: "68f7d2f9-d38a-496d-9d95-000f86cba00c", metadata: {} };
check(classifyProviderError(permissionError(), { provider: "tuya", device }).classification === "permission_denied", "well-formed Tuya 1106 maps to permission_denied");
check(classifyProviderError(permissionError(), { provider: "tuya", device: malformedDevice }).classification === "device_not_linked", "malformed registry identity maps Tuya 1106 to device_not_linked");
check(classifyProviderError(new Error("access token expired"), { provider: "tuya" }).classification === "integration_expired", "expired integration errors are classified");
check(classifyProviderError({ response: { status: 503 }, message: "service unavailable" }, { provider: "tuya" }).classification === "provider_unavailable", "provider outages are classified");
check(classifyProviderError({ response: { status: 429 }, message: "too many requests" }, { provider: "tuya" }).classification === "rate_limited", "provider rate limits are classified");
check(classifyProviderError(new ProviderRequestError({ provider: "tuya", providerCode: 1004, providerMessage: "sign invalid" }), { provider: "tuya" }).classification === "authentication_failed", "credential failures are classified");
check(classifyProviderError(new Error("unexpected provider response"), { provider: "tuya" }).classification === "unknown_provider_error", "unknown provider failures remain explicit");

for (const [passed, label] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
if (checks.some(([passed]) => !passed)) process.exit(1);

