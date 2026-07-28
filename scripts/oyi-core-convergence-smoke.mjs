#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";

const mode = process.argv[2] || "all";

const { universalSignalRuntime } = await import("../dist/oyi-core/runtime/universalSignalRuntime.js");
const { runtimeSubscriptionEngine } = await import("../dist/oyi-core/runtime/runtimeSubscriptions.js");
const { normalizeIntelligenceContextEnvelope } = await import("../dist/oyi-core/contracts/intelligenceContextEnvelope.js");
const { getRegisteredOperation, operationPlanType } = await import("../dist/oyi-core/runtime/operationRegistry.js");
const { resolveIntelligencePolicy, channelsForRuntimeDelivery } = await import("../dist/oyi-core/policy/intelligencePolicyResolver.js");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

function residentSignal(id = "resident-tv-command") {
  return {
    id,
    source: "tuya",
    type: "telemetry",
    domain: "resident_device_private",
    device_id: "device-private",
    estate_id: "estate-a",
    metadata: {
      home_id: "home-a",
      ownership_class: "resident_owned",
      privacy_class: "resident_device_private",
      status: "on",
    },
    entity: { id: "device-private", type: "device", status: "on" },
    actor: { id: "resident-a", role: "resident" },
    severity: "info",
  };
}

if (mode === "all" || mode === "privacy") {
  const receipt = universalSignalRuntime.receive(residentSignal("private-routing"));
  check("resident private output excludes Facility/infrastructure/digital twin/reporting", () => {
    assert.equal(receipt.accepted, true);
    assert.deepEqual(receipt.outputs.sort(), ["activity", "conversation"].sort());
    assert.equal(receipt.outputs.includes("infrastructure_registry"), false);
    assert.equal(receipt.outputs.includes("digital_twin"), false);
    assert.equal(receipt.outputs.includes("reports"), false);
    assert.equal(receipt.outputs.includes("executive_intelligence"), false);
  });
  const channels = channelsForRuntimeDelivery(receipt.signal, receipt.outputs, "signal", ["facility:signal"]);
  check("resident private signal fanout excludes Facility channels", () => {
    assert.equal(channels.some((channel) => channel.startsWith("facility:")), false);
    assert.equal(channels.includes("consumer:signal"), true);
  });
}

if (mode === "all" || mode === "lifecycle") {
  const first = universalSignalRuntime.receive(residentSignal("dedupe-signal"), "2026-07-28T10:00:00.000Z");
  const duplicate = universalSignalRuntime.receive(residentSignal("dedupe-signal"), "2026-07-28T10:00:03.000Z");
  check("lifecycle duplicate is rejected before side-effect publication", () => {
    assert.equal(first.accepted, true);
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.duplicate, true);
  });

  const delivered = [];
  const unsubscribe = runtimeSubscriptionEngine.register({
    id: "oyi-core-convergence-smoke",
    channels: ["facility:signal", "consumer:signal", "future:digital-twin"],
    onEvent: (delivery) => delivered.push(delivery),
  });
  runtimeSubscriptionEngine.publishSignal({ signal: first.signal, receipt: first, source: "smoke" });
  unsubscribe();
  check("subscription policy delivers one private consumer signal and no Facility twin event", () => {
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].channel, "consumer:signal");
  });
}

if (mode === "all" || mode === "contextual") {
  const deviceContext = normalizeIntelligenceContextEnvelope({
    surface: "consumer",
    module: "device",
    route: "/devices",
    estate_id: "estate-a",
    home_id: "home-a",
    object_type: "device_channel",
    object_id: "device-a:switch_2",
    object_name: "Kitchen Channel 2",
    selected_tab: "controls",
    timezone: "Africa/Lagos",
  }, { role: "resident", permissions: ["devices.read"] });
  const roomContext = normalizeIntelligenceContextEnvelope({
    surface: "consumer",
    module: "room",
    route: "/room/room-a",
    estate_id: "estate-a",
    home_id: "home-a",
    room_id: "room-a",
    object_type: "room",
    object_id: "room-a",
  }, { role: "resident" });
  check("context envelope preserves exact selected device channel target", () => {
    assert.equal(deviceContext.object_type, "device_channel");
    assert.equal(deviceContext.object_id, "device-a:switch_2");
    assert.equal(deviceContext.home_id, "home-a");
    assert.equal(deviceContext.module, "device");
  });
  check("new page context replaces stale target scope", () => {
    assert.equal(roomContext.module, "room");
    assert.equal(roomContext.object_id, "room-a");
    assert.notEqual(roomContext.object_id, deviceContext.object_id);
  });
}

if (mode === "all" || mode === "feedback") {
  const migration = await readFile(new URL("../supabase/migrations/20260728143000_oyi_core_convergence_canonical_storage.sql", import.meta.url), "utf8");
  check("canonical durable tables include feedback and outbox", () => {
    assert.match(migration, /create table if not exists public\.operational_signals/i);
    assert.match(migration, /create table if not exists public\.operational_incidents/i);
    assert.match(migration, /create table if not exists public\.operational_recommendations/i);
    assert.match(migration, /create table if not exists public\.intelligence_feedback/i);
    assert.match(migration, /create table if not exists public\.operational_delivery_outbox/i);
    assert.match(migration, /unique index if not exists idx_operational_signals_key/i);
  });
}

if (mode === "all" || mode === "convergence") {
  const policy = resolveIntelligencePolicy(universalSignalRuntime.receive({
    id: "building-outage",
    source: "edge_runtime",
    type: "infrastructure",
    domain: "building_operational",
    estate_id: "estate-a",
    building_id: "building-a",
    entity: { id: "generator-a", type: "infrastructure_asset", status: "warning" },
    severity: "warning",
  }).signal);
  check("building operational signal retains Facility projection eligibility", () => {
    assert.equal(policy.facilityProjectionPermitted, true);
    assert.equal(policy.allowedOutputs.includes("infrastructure_registry"), true);
    assert.equal(policy.allowedOutputs.includes("digital_twin"), true);
  });
  check("unregistered operations cannot become executable actions", () => {
    assert.equal(getRegisteredOperation("smart_access.remote_unlock"), null);
    assert.equal(operationPlanType("smart_access.remote_unlock"), "suggest_only");
    assert.equal(operationPlanType("infrastructure.request_verification"), "prepare_workflow");
  });
}

if (process.exitCode) process.exit(process.exitCode);
