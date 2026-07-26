#!/usr/bin/env node
import { performance } from "node:perf_hooks";

process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "runtime-v2-smoke-service-role-key";

const { DeviceRuntimeStateService } = await import("../dist/services/deviceRuntimeStateService.js");

const checks = [];
const check = (passed, label) => checks.push([Boolean(passed), label]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let now = Date.parse("2026-07-16T10:00:00.000Z");
let providerReads = 0;
let activeReads = 0;
let peakReads = 0;
let snapshotLoads = 0;
const persisted = [];
const broadcasts = [];
const snapshotRows = new Map();

const devices = Array.from({ length: 12 }, (_, index) => ({
  id: `device-${index + 1}`,
  name: `Device ${index + 1}`,
  estate_id: "estate-1",
  home_id: "home-1",
  room_id: index % 2 ? "room-2" : "room-1",
  external_id: `tuya-${index + 1}`,
  vendor: "tuya",
  adapter: "tuya",
  category: "switch",
  type: "switch",
  metadata: { device_family: "switch", control_profile: "switch" },
}));

snapshotRows.set("device-1", {
  device_id: "device-1",
  status: { switch: false, online: true, normalized_state: { power: false, online: true } },
  last_seen: new Date(now).toISOString(),
  updated_at: new Date(now).toISOString(),
});

const runtime = new DeviceRuntimeStateService({
  now: () => now,
  resolveDevice: async (deviceId) => devices.find((device) => device.id === deviceId) || null,
  loadSnapshots: async (deviceIds) => {
    snapshotLoads += 1;
    return deviceIds.map((id) => snapshotRows.get(id)).filter(Boolean);
  },
  readProviderState: async (device) => {
    providerReads += 1;
    activeReads += 1;
    peakReads = Math.max(peakReads, activeReads);
    await wait(20);
    activeReads -= 1;
    return {
      switch: device.id === "device-1" ? false : true,
      online: true,
      normalized_state: { power: device.id !== "device-1", online: true },
      primary_state: device.id === "device-1" ? "off" : "on",
      supported_controls: ["power"],
      control_profile: "switch",
      device_family: "switch",
      health_status: "stable",
      provider_health: "online",
      capability_codes: ["switch"],
      telemetry_summary: {},
      activity_summary: "Everything looks normal.",
    };
  },
  persistSnapshot: async (entry) => { persisted.push(entry.device_id); },
  broadcast: (_entry, payload) => { broadcasts.push(payload); },
  emitSignal: async () => {},
}, 5);

const hydrated = await runtime.getOrHydrate(devices[0]);
check(hydrated?.freshness === "fresh", "persistent snapshot hydrates into fresh runtime cache");
check(providerReads === 0, "cache hydration performs no provider request");
check(snapshotLoads === 1, "cold runtime hydration uses one batched snapshot query");

now += 11_000;
const stale = runtime.get("device-1");
check(stale?.freshness === "stale" && stale.stale === true, "10-60 second state is returned as stale");

now += 50_000;
const expired = runtime.get("device-1");
check(expired?.freshness === "expired", "state older than 60 seconds is returned as expired");
runtime.refreshActiveEntries();
await wait(0);
check(providerReads === 0, "cold-start expired persisted snapshots are not immediately provider-due");
check(runtime.get("device-1")?.next_refresh_at, "expired persisted snapshots receive a jittered future refresh deadline");

const concurrentSameDevice = Array.from({ length: 20 }, () => runtime.refresh(devices[0], "high", "dedupe_test"));
await Promise.all(concurrentSameDevice);
check(providerReads === 1, "concurrent refreshes for one device collapse to one provider read");
check(persisted.filter((id) => id === "device-1").length === 1, "successful refresh persists one snapshot");
check(broadcasts.filter((payload) => payload.device_id === "device-1").length === 1, "successful refresh emits one websocket update");
check(broadcasts[0]?.normalized_state && "primary_state" in broadcasts[0], "websocket payload exposes normalized runtime contract");

const beforeBatchReads = providerReads;
await runtime.refreshMany(devices.slice(1), "normal", "concurrency_test");
check(providerReads - beforeBatchReads === 11, "batch refresh reads every requested device once");
check(peakReads <= 5, "provider refresh queue enforces concurrency five");
check(runtime.stats().refresh_queue.peak === 5, "refresh queue reaches but does not exceed configured concurrency");

const dashboardStarted = performance.now();
const snapshotLoadsBeforeDashboard = snapshotLoads;
await runtime.hydrateMany(devices);
const dashboard = devices.map((device) => runtime.get(device.id));
const dashboardLatency = performance.now() - dashboardStarted;
check(dashboard.every(Boolean), "dashboard runtime returns cached summaries for all devices");
check(dashboardLatency < 300, "cached dashboard assembly completes under 300ms");
check(providerReads === beforeBatchReads + 11, "dashboard runtime performs no provider requests");
check(snapshotLoads - snapshotLoadsBeforeDashboard <= 1, "dashboard runtime avoids N+1 snapshot queries");
check(runtime.stats().currently_viewed === 0, "dashboard cached reads create zero currently-viewed leases");
const viewed = runtime.markViewed("device-1", { ttlMs: 45_000, source: "smoke_panel", estateId: "estate-1", homeId: "home-1", actorId: "resident-1" });
check(Boolean(viewed?.viewed_until_at) && runtime.stats().currently_viewed === 1, "explicit panel lease marks exactly one device currently viewed");
const reused = runtime.markViewed("device-1", { ttlMs: 45_000, source: "smoke_panel", estateId: "estate-1", homeId: "home-1", actorId: "resident-1" });
check(reused?.viewed_until_at === viewed?.viewed_until_at && runtime.stats().currently_viewed === 1, "active panel lease is reused without duplicating or extending every read");
now += 30_000;
const renewed = runtime.markViewed("device-1", { ttlMs: 45_000, source: "smoke_panel", estateId: "estate-1", homeId: "home-1", actorId: "resident-1" });
check(renewed?.viewed_until_at !== viewed?.viewed_until_at && runtime.stats().currently_viewed === 1, "near-expiry panel lease renews as one logical viewed device");
const released = runtime.releaseViewed("device-1", { source: "smoke_panel", estateId: "estate-1", homeId: "home-1", actorId: "resident-1" });
check(released?.viewed_until_at === null && runtime.stats().currently_viewed === 0, "explicit panel close releases the viewed lease immediately");
const reopened = runtime.markViewed("device-1", { ttlMs: 45_000, source: "smoke_panel", estateId: "estate-1", homeId: "home-1", actorId: "resident-1" });
check(Boolean(reopened?.viewed_until_at) && runtime.stats().currently_viewed === 1, "reopened panel creates one fresh logical lease after release");
runtime.releaseViewed("device-1", { source: "smoke_panel", estateId: "estate-1", homeId: "home-1", actorId: "resident-1" });
const secondLease = runtime.markViewed("device-2", { ttlMs: 45_000, source: "smoke_panel", estateId: "estate-1", homeId: "home-1", actorId: "resident-1" });
check(Boolean(secondLease?.viewed_until_at) && runtime.stats().currently_viewed === 1, "one open panel on another device reports one viewed lease");
runtime.releaseViewed("device-2", { source: "smoke_panel", estateId: "estate-1", homeId: "home-1", actorId: "resident-1" });
runtime.markViewed("device-3", { ttlMs: 45_000, source: "smoke_panel", estateId: "estate-1", homeId: "home-1", actorId: "resident-1" });
now += 46_000;
check(runtime.stats().currently_viewed === 0, "view lease expires back to zero after the short TTL");

runtime.markDirty("device-1");
const dirty = runtime.get("device-1");
check(dirty?.dirty === true && dirty.freshness === "expired", "command-triggered dirty state requests high-priority confirmation");
runtime.scheduleRefresh(devices[0], { priority: "high", reason: "command_test" });
await wait(50);
check(providerReads === beforeBatchReads + 12, "command scheduling refreshes asynchronously");

const confirmationSignals = [];
const confirmationRuntime = new DeviceRuntimeStateService({
  now: () => now,
  readProviderState: async () => ({
    switch_1: true,
    online: true,
    normalized_state: { power: true, online: true, switches: { switch_1: true } },
    primary_state: "on",
    supported_controls: ["power", "switch_1"],
    control_profile: "switch",
    device_family: "switch",
    health_status: "stable",
    provider_health: "online",
    capability_codes: ["switch_1"],
    telemetry_summary: {},
    activity_summary: "Device 1 is active.",
  }),
  persistSnapshot: async () => {},
  broadcast: () => {},
  emitSignal: async (signal) => { confirmationSignals.push(signal); },
});
confirmationRuntime.set(devices[0], {
  switch_1: false,
  online: true,
  normalized_state: { power: false, online: true, switches: { switch_1: false } },
  primary_state: "off",
  supported_controls: ["power", "switch_1"],
  control_profile: "switch",
  device_family: "switch",
  health_status: "stable",
  provider_health: "online",
  capability_codes: ["switch_1"],
  telemetry_summary: {},
  activity_summary: "Device 1 is idle.",
  _oyi_pending_command: {
    command: { switch_1: true },
    source: "app",
    confirmation: "pending",
    command_execution_id: "command-execution-smoke-1",
    actor_id: "resident-1",
    actor_role: "resident",
    home_id: "home-1",
    estate_id: "estate-1",
    ownership_class: "resident_owned",
  },
}, { dirty: true });
const confirmed = await confirmationRuntime.refresh(devices[0], "high", "command_confirmation_test");
await wait(0);
check(confirmed?.state?._oyi_command_confirmation?.confirmation === "confirmed", "background state read confirms the pending command");
check(confirmed?.state?._oyi_command_confirmation?.command_execution_id === "command-execution-smoke-1", "background state confirmation preserves the original command execution id");
check(confirmationSignals[0]?.eventType === "device.command.executed", "confirmed command continues through the canonical operational signal path");
check(confirmationSignals[0]?.providerEventId === "device.command.executed:command-execution-smoke-1", "confirmed command signal uses the deterministic command execution lifecycle id");
check(confirmationSignals[0]?.extraMetadata?.command_execution_id === "command-execution-smoke-1", "confirmed command signal carries command_execution_id in metadata");

await confirmationRuntime.acceptProviderState(devices[0], { switch_1: true, online: true }, {
  providerTimestamp: "2026-07-16T10:00:00.000Z",
  emitSignal: false,
});
await confirmationRuntime.acceptProviderState(devices[0], { switch_1: false, online: true }, {
  providerTimestamp: "2026-07-16T09:59:00.000Z",
  emitSignal: false,
});
const afterOutOfOrder = confirmationRuntime.get("device-1");
check(afterOutOfOrder?.state?.switch_1 === true, "older provider events cannot overwrite newer runtime state");

for (const [passed, label] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
if (checks.some(([passed]) => !passed)) process.exit(1);
