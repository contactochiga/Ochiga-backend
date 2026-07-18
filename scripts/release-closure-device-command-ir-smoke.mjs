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
assert(/shortReplayWindow/.test(commandController) && !/Math\.random\(\)/.test(commandController), "implicit command idempotency uses a stable replay window instead of randomness");
assert(/void\s+executeDeviceCommandForActor/.test(commandController), "POST /devices/:id/command starts provider execution asynchronously");
assert(/res\.status\(202\)\.json/.test(commandController), "POST /devices/:id/command returns 202 Accepted");

assert(!/router\.get\(["']\/info\/:id["'][^;]+requirePermission\(["']visitors\.manage["']/.test(visitorRoutes), "visitor detail route does not require visitors.manage before ownership scope validation");

assert(/listIrRemotes\?/.test(deviceAdapter), "device adapter contract exposes bound IR remote discovery");
assert(/listIrRemoteKeys\?/.test(deviceAdapter), "device adapter contract exposes IR key discovery");
assert(/executeIrRemoteCommand\?/.test(deviceAdapter), "device adapter contract exposes IR remote command dispatch");

assert(/\/infrareds\/\$\{encodeURIComponent\(infraredId\)\}\/remotes/.test(tuyaAdapter), "Tuya adapter calls the real infrared remote endpoints");
assert(/key_list/.test(tuyaAdapter), "Tuya adapter parses the real IR key_list response");
assert(/\/air-conditioners\/\$\{encodeURIComponent\(remoteId\)\}\/command/.test(tuyaAdapter), "Tuya adapter routes AC single commands through the dedicated air-conditioner command endpoint");
assert(/\/air-conditioners\/\$\{encodeURIComponent\(remoteId\)\}\/scenes\/command/.test(tuyaAdapter), "Tuya adapter routes AC multi-field commands through the dedicated air-conditioner scenes endpoint");
assert(!/\/remotes\/\$\{encodeURIComponent\(remoteId\)\}\/ac\/command/.test(tuyaAdapter), "Tuya adapter does not use the obsolete generic remote AC command route");
assert(/category_id/.test(tuyaAdapter) && /key_id/.test(tuyaAdapter) && /raw\/command/.test(tuyaAdapter), "Tuya raw IR commands carry the v2 raw command identity fields");
assert(/executeIrRemoteCommand/.test(tuyaAdapter), "Tuya adapter routes virtual remote commands through the IR command handler");
assert(/if \(!res\.data\?\.success\)/.test(tuyaClient) && /throw error/.test(tuyaClient) && /tuyaResultAccepted/.test(tuyaAdapter), "Tuya IR command acceptance requires provider success and accepted result");
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
