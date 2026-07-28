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
const { correlateIncident } = await import("../dist/oyi-core/runtime/incidentCorrelation.js");
const { reasoningPolicyFor } = await import("../dist/oyi-core/runtime/domainReasoningPolicies.js");
const { classifyPredictionPayload } = await import("../dist/oyi-core/runtime/predictionTruth.js");
const { buildModuleFacts } = await import("../dist/oyi-core/runtime/moduleFactAdapters.js");
const { resolveConversationTarget } = await import("../dist/oyi-core/runtime/conversationTargetResolver.js");

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

  const commandIncident = correlateIncident(first.signal, null);
  const offline = universalSignalRuntime.receive({
    id: "device-offline",
    source: "tuya",
    type: "telemetry",
    domain: "device_availability",
    provider: "tuya",
    estate_id: "estate-a",
    metadata: { home_id: "home-a", availability: "offline" },
    entity: { id: "switch-a", type: "device", status: "offline" },
    severity: "warning",
    confidence: 0.88,
  }).signal;
  const recovery = universalSignalRuntime.receive({
    id: "device-recovery",
    source: "tuya",
    type: "telemetry",
    domain: "device_availability",
    provider: "tuya",
    estate_id: "estate-a",
    metadata: { home_id: "home-a", availability: "online" },
    entity: { id: "switch-a", type: "device", status: "online" },
    severity: "info",
    confidence: 0.92,
  }).signal;
  check("command lifecycle does not create independent incident", () => {
    assert.equal(commandIncident, null);
  });
  check("offline signal creates durable incident key and recovery resolves same entity", () => {
    const offlineIncident = correlateIncident(offline, null);
    const recoveryIncident = correlateIncident(recovery, null);
    assert.ok(offlineIncident?.incidentKey.includes("switch-a"));
    assert.equal(recoveryIncident?.status, "resolved");
    assert.equal(recoveryIncident?.incidentKey, offlineIncident?.incidentKey);
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
  const target = resolveConversationTarget({
    query: "Why is this unavailable?",
    pageObject: { object_type: "device", object_id: "device-b", object_name: "Bedroom switch" },
    threadTarget: { object_type: "device", object_id: "stale-device", object_name: "Old target" },
    context: deviceContext,
  });
  const facts = buildModuleFacts(deviceContext, { channel_definitions: [{ code: "switch_2" }] });
  check("conversation target resolver prefers current page object over stale thread target", () => {
    assert.equal(target.objectId, "device-b");
    assert.equal(target.source, "page_object");
  });
  check("module adapter returns facts only and preserves channel metadata", () => {
    assert.equal(facts.adapter, "device");
    assert.deepEqual(facts.facts.channel_definitions, [{ code: "switch_2" }]);
    assert.equal(facts.facts.recommendation_policy, "oyi_core_only");
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
  const classified = classifyPredictionPayload({ method: "template_forecast", evidence: [{ id: "one" }], horizon: "24h" });
  check("unsupported template forecast is downgraded below forecast without evidence window/outcome", () => {
    assert.equal(classified.prediction_type, "rule");
    assert.equal(classified.user_facing_label, "Rule-based notice");
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
  check("domain reasoning policy distinguishes provider ack from physical confirmation", () => {
    const policy = reasoningPolicyFor("device_command_lifecycle");
    assert.match(policy.verificationRule, /Provider acknowledgement is not physical confirmation/i);
    assert.match(policy.excludedEvidence.join(","), /audit\.recorded/);
  });
}

if (process.exitCode) process.exit(process.exitCode);
