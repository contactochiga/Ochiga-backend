#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(pass, label) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) process.exitCode = 1;
}

const commandController = read("src/controllers/deviceCommandController.ts");
const visitorRoutes = read("src/routes/visitors.ts");
const deviceAdapter = read("src/device/adapters/DeviceAdapter.ts");
const tuyaAdapter = read("src/device/adapters/tuya/TuyaAdapter.ts");
const tuyaClient = read("src/device/adapters/tuya/tuyaClient.ts");
const irController = read("src/controllers/deviceIrController.ts");
const runtimeStateService = read("src/services/deviceRuntimeStateService.ts");
const serviceProvisioning = read("src/services/homeServiceProvisioning.ts");
const servicesController = read("src/controllers/servicesController.ts");

assert(!/from\s+["']\.\.\/services\/oyiRuntimeEventBus["']/.test(commandController), "device command controller no longer imports the runtime event bus directly");
assert(!/publishSourceIntelligenceEvent\s*\(/.test(commandController), "device command controller does not emit a second source-intelligence command signal");
assert(/emitOperationalDeviceSignal\s*\(/.test(commandController), "device command controller emits through the canonical operational signal path");
assert(/commandIdempotencyKey/.test(commandController) && /commandAcceptances/.test(commandController), "device command acceptance has an explicit idempotency guard");
assert(/headers\["x-command-key"\]/.test(commandController) && /req\.body\?\.command_key/.test(commandController), "non-IR commands can use client command_key as the idempotency identity");
assert(/headers\["x-tap-sequence"\]/.test(commandController) && /headers\["x-client-tap-sequence"\]/.test(commandController), "non-IR commands accept explicit tap sequence headers");
assert(/function commandClientTimestamp/.test(commandController) && /client_tap_timestamp/.test(commandController), "device commands preserve client tap timestamps");
assert(/shortReplayWindow/.test(commandController) && !/Math\.random\(\)/.test(commandController), "implicit command idempotency uses a stable replay window instead of randomness");
assert(/providerAckOnly[\s\S]*executeDeviceCommandForActor[\s\S]*res\.status\(200\)\.json/.test(commandController), "IR provider-ack commands dispatch synchronously and return 200 after provider acceptance");
assert(/void\s+executeDeviceCommandForActor/.test(commandController), "observable-state commands still start provider execution asynchronously");
assert(/res\.status\(202\)\.json/.test(commandController), "observable-state command acceptance still returns 202 Accepted");

assert(!/router\.get\(["']\/info\/:id["'][^;]+requirePermission\(["']visitors\.manage["']/.test(visitorRoutes), "visitor detail route does not require visitors.manage before ownership scope validation");

assert(/listIrRemotes\?/.test(deviceAdapter), "device adapter contract exposes bound IR remote discovery");
assert(/listIrRemoteKeys\?/.test(deviceAdapter), "device adapter contract exposes IR key discovery");
assert(/executeIrRemoteCommand\?/.test(deviceAdapter), "device adapter contract exposes IR remote command dispatch");
assert(/auditIrHubCapabilities\?/.test(deviceAdapter), "device adapter contract exposes read-only IR hub capability audit");

assert(/\/infrareds\/\$\{encodeURIComponent\(infraredId\)\}\/remotes/.test(tuyaAdapter), "Tuya adapter calls the real infrared remote endpoints");
assert(/key_list/.test(tuyaAdapter), "Tuya adapter parses the real IR key_list response");
assert(/\/air-conditioners\/\$\{encodeURIComponent\(binding\.remote_id\)\}\/command/.test(tuyaAdapter), "Tuya adapter routes AC single commands through the dedicated air-conditioner command endpoint");
assert(/\/air-conditioners\/\$\{encodeURIComponent\(binding\.remote_id\)\}\/scenes\/command/.test(tuyaAdapter), "Tuya adapter routes AC multi-field commands through the dedicated air-conditioner scenes endpoint");
assert(!/\/remotes\/\$\{encodeURIComponent\(remoteId\)\}\/ac\/command/.test(tuyaAdapter), "Tuya adapter does not use the obsolete generic remote AC command route");
assert(/category_id/.test(tuyaAdapter) && /key_id/.test(tuyaAdapter) && /raw\/command/.test(tuyaAdapter), "Tuya raw IR commands carry the v2 raw command identity fields");
assert(/executeIrRemoteCommand/.test(tuyaAdapter), "Tuya adapter routes virtual remote commands through the IR command handler");
assert(/unsupportedIrCommandError/.test(tuyaAdapter) && /IR_KEY_NOT_SUPPORTED/.test(tuyaAdapter), "Tuya adapter rejects buttons absent from the bound remote catalogue before provider dispatch");
assert(/if \(!res\.data\?\.success\)/.test(tuyaClient) && /throw error/.test(tuyaClient) && /tuyaResultAccepted/.test(tuyaAdapter), "Tuya IR command acceptance requires provider success and accepted result");
assert(/tuya_ir_endpoint_compatibility/.test(tuyaAdapter) && /provider_code.*20001/.test(tuyaAdapter) && /preferred_version: "v1\.0"/.test(tuyaAdapter), "Tuya IR endpoint compatibility remembers v1 after recognized v2 incompatibility");
assert(/classified\.provider_code === "20001"[\s\S]*fallback: "v1\.0"[\s\S]*continue/.test(tuyaAdapter), "Tuya IR v2 incompatibility code 20001 always falls through to the working v1 endpoint");
assert(/ir_provider_endpoint_selected/.test(tuyaAdapter) && /ir_provider_response_received/.test(tuyaAdapter) && /ir_provider_accepted/.test(tuyaAdapter) && /ir_provider_rejected/.test(tuyaAdapter) && /ir_dispatch_unconfirmed/.test(tuyaAdapter), "Tuya IR dispatch logs endpoint selection, response, acceptance, rejection and unconfirmed evidence");
assert(/tuya_ir_standard_command_fallback_to_raw/.test(tuyaAdapter) && /endpointKind: "raw_remote_command"/.test(tuyaAdapter) && /endpointIncompatible/.test(tuyaAdapter), "Tuya standard remote endpoint incompatibility can fall back to exact raw key dispatch");
assert(/auditIrHubCapabilities/.test(tuyaAdapter) && /"categories"/.test(tuyaAdapter) && /"bound_remotes"/.test(tuyaAdapter) && /"add_remote"/.test(tuyaAdapter), "Tuya adapter records IR hub onboarding feasibility without mutating provider state");
assert(/confirmation_strategy: "provider_ack_only"/.test(tuyaAdapter) && /provider_ack_only[\s\S]*return \{[\s\S]*confirmation_strategy: "provider_ack_only"/.test(commandController), "TV IR commands use provider_ack_only and return before fake state confirmation");
assert(/irCommandLanes/.test(commandController) && /runInIrCommandLane/.test(commandController) && /IR_DISPATCH_SPACING_MS/.test(commandController), "TV IR commands use a bounded per-remote FIFO dispatch lane");
assert(/commandClientSequence/.test(commandController) && /ir_backend_received/.test(commandController) && /ir_response_sent/.test(commandController), "TV IR commands propagate tap sequence diagnostics through backend receipt and response");
assert(/device_command_request_created/.test(commandController), "generic device commands use device_command_request_created observability");
assert(/command_key: clientCommandKey/.test(commandController) && /tap_sequence: clientTapSequence/.test(commandController) && /client_tap_timestamp: clientTapTimestamp/.test(commandController), "generic command acceptance returns and logs client command identity");
assert(/_oyi_pending_command[\s\S]*command_key: clientCommandKey[\s\S]*tap_sequence: clientTapSequence/.test(commandController), "pending runtime state carries command identity for later confirmation reconciliation");
assert(/if \(providerAckOnly\) \{[\s\S]*logger\.info\("ir_request_created"/.test(commandController), "ir_request_created is emitted only for provider-ack IR commands");
assert(/commandExecutionId/.test(commandController) && /command_execution_id: executionId/.test(commandController), "device command acceptance creates and returns a canonical command execution id");
assert(!/await NotificationService\.sendToUser\(String\(user\.id\), \{[\s\S]{0,600}kind: "device\.command\.requested"/.test(commandController), "successful routine device commands do not directly push confirmation-pending notifications");
assert(!/providerAckOnly[\s\S]{0,220}scheduleRefresh/.test(commandController), "provider_ack_only TV IR commands do not schedule observable-state confirmation refreshes");
assert(/Add or sync an appliance profile before using this remote/.test(tuyaAdapter), "Tuya adapter fails honestly when a virtual remote is missing provider binding");
assert(/family === "tv" \|\| family === "ir"/.test(commandController) && /type: c\.type \|\| "tv_remote"/.test(commandController), "TV and generic IR commands keep remote command shape instead of switch payloads");
assert(/profile === "air_conditioner"/.test(commandController) && /type: c\.type \|\| "ac_remote"/.test(commandController), "AC commands keep air-conditioner command shape instead of switch payloads");

assert(/listIrRemotes/.test(irController), "IR controller discovers provider-bound remotes");
assert(/const providerProfileId = profile\.remote_id \|\| profile\.remote_index \|\| null/.test(irController) && /buildIrExternalId\(hub,\s*profileKey,\s*providerProfileId\)/.test(irController), "IR children use stable parent plus remote identity");
assert(!/available_profiles:\s*Object\.values\(PROFILE_LIBRARY\)/.test(irController), "IR profile list is not fabricated from a static frontend catalog");
assert(/control_profile: "television"/.test(irController) && /device_family: "television"/.test(irController), "IR TV children use canonical television contract");
assert(/control_profile: "air_conditioner"/.test(irController) && /fan_speed/.test(irController), "IR AC children expose canonical air-conditioner controls");

assert(/private readonly refreshes = new Map/.test(runtimeStateService), "Runtime V2 has an in-flight refresh map");
assert(/const existing = this\.refreshes\.get\(deviceId\)/.test(runtimeStateService), "Runtime V2 coalesces duplicate refreshes for the same device");
assert(/this\.scheduleRefresh\(entry\.device,\s*\{ priority: "high", reason: "command_confirmation"/.test(runtimeStateService), "command confirmation schedules Runtime V2 refresh without blocking HTTP acceptance");
assert(/SCHEDULER_TICK_MS = 15_000/.test(runtimeStateService) && /ACTIVE_REFRESH_INTERVAL_MS = 30_000/.test(runtimeStateService), "Runtime V2 background refresh uses adaptive release cadence");
assert(/oyi_device_runtime_refresh_coalesced_total/.test(runtimeStateService), "Runtime V2 records coalesced refreshes separately from dispatches");

assert(/readExistingHomeServiceAccounts/.test(serviceProvisioning) && /existingAccounts\.entries/.test(serviceProvisioning), "home service provisioning preserves and reassigns existing canonical service accounts");
assert(/resolveHomeForUser\(user,\s*\{[\s\S]*homeId: String\(req\.query\.home_id/.test(servicesController) && /listServiceAccountsForScope\(\{ estateId, homeId: String\(home\.id\) \}\)/.test(servicesController), "resident service accounts are read from the validated active home scope");
