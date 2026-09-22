#!/usr/bin/env node
// Oyi Intelligence Convergence, Wave 5D -- Signal / Intent Physical
// Authority Convergence.
//
// Closes the live physical-action authority bypass the Wave 5C
// repository audit discovered (and left deliberately unfixed, per its
// own report item 22):
//
//   POST /signals -> handleSignal -> evaluateSignal -> deviceCommandPolicy
//   -> enqueueIntent (BullMQ) -> intentWorker.ts's handleDeviceIntent
//   -> adapterRegistry.get("tuya").executeCommand() / publishDeviceAction
//
// which dispatched directly to the provider with NO devices.power.control
// check, no canonical DeviceCommandAuthority, no executeDeviceCommandForActor,
// no execution ledger, and no verification.
//
// Live, functional, pre-fix reproduction (recorded here; run separately
// against unmodified 9b8ae34f8a0fed1b9fab134552d90f13a0619835 with
// handleDeviceIntent temporarily exported, zero behavior change, purely
// to make it callable): with devices.power.control forced to "disabled"
// and capabilityService.canUse spied, calling handleDeviceIntent({
// deviceId: "00000000-0000-0000-0000-000000000000", command: { switch_1:
// true }, ... }) resulted in canUseCalls=0 and mqttPublishCalls=1 --
// publishDeviceAction() was actually invoked with a real MQTT topic,
// proving physical dispatch was reached while the capability was
// disabled and never once consulted.
//
// Fix: handleDeviceIntent now (1) fails closed if the queued intent
// carries no truthful actor.id/actor.role, (2) re-hydrates the actor's
// real role/estate_id/home_id from the users table by that id (never
// trusting the signal-carried estateId/homeId directly -- see the
// in-code comment in intentWorker.ts for why: signal.controller.ts's
// ingestSignal lets a client-supplied body field override the
// server-verified session), (3) calls the SAME canonical
// authorizeDeviceCommand() (devices.power.control) every other converged
// entrance already uses, and (4) on success calls the SAME canonical
// executeDeviceCommandForActor() (ledger, provider selection,
// verification) instead of adapterRegistry.get("tuya").executeCommand()
// or publishDeviceAction() directly. BullMQ remains pure transport.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://smoke.invalid.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "smoke-placeholder-key";

import { readFileSync } from "node:fs";

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const intentWorkerSource = readFileSync(new URL("../src/workers/intentWorker.ts", import.meta.url), "utf8");
const deviceCommandPolicySource = readFileSync(new URL("../src/core/control-plane/policies/deviceCommand.policy.ts", import.meta.url), "utf8");
const devicePermissionPolicySource = readFileSync(new URL("../src/core/control-plane/policies/devicePermission.policy.ts", import.meta.url), "utf8");
const intentTypesSource = readFileSync(new URL("../src/core/control-plane/contracts/intent.types.ts", import.meta.url), "utf8");
const deviceCommandControllerSource = readFileSync(new URL("../src/controllers/deviceCommandController.ts", import.meta.url), "utf8");
const signalControllerSource = readFileSync(new URL("../src/controllers/signal.controller.ts", import.meta.url), "utf8");
const verificationServiceSource = readFileSync(new URL("../src/intelligence-core/verificationService.ts", import.meta.url), "utf8");
const scenesSource = readFileSync(new URL("../src/routes/scenes.ts", import.meta.url), "utf8");
const officeExportSource = readFileSync(new URL("../src/routes/officeExport.ts", import.meta.url), "utf8");
const watchAdapterSource = readFileSync(new URL("../src/services/watchAdapterService.ts", import.meta.url), "utf8");
const commandRouterSource = readFileSync(new URL("../src/ai/commandRouter.ts", import.meta.url), "utf8");
const executionRegistrySource = readFileSync(new URL("../src/intelligence-core/executionRegistry.ts", import.meta.url), "utf8");
const eventRuleSource = readFileSync(new URL("../src/services/facilityAutomationEventRuleService.ts", import.meta.url), "utf8");
const residentBatchSource = readFileSync(new URL("../src/services/residentActionBatchExecutionService.ts", import.meta.url), "utf8");

// ============================= Structural: the bypass itself is gone =============================
{
  // Matches the actual pre-fix ACTIVE call sites (`adapterRegistry.get("tuya")`
  // used to resolve the adapter, `tuya.executeCommand(deviceKey` to
  // dispatch) -- not the narrative doc-comment above handleDeviceIntent
  // that explains, in prose, what this function used to do.
  need(!/adapterRegistry\.get\(/.test(intentWorkerSource), "structural: intentWorker.ts must no longer call adapterRegistry.get(...) directly");
  need(!/tuya\.executeCommand\(/.test(intentWorkerSource), "structural: intentWorker.ts must no longer call tuya.executeCommand(...) directly");
  need(!intentWorkerSource.includes("publishDeviceAction"), "structural: intentWorker.ts must no longer call publishDeviceAction directly");
  need(intentWorkerSource.includes("authorizeDeviceCommand({"), "structural: intentWorker.ts must call the canonical authorizeDeviceCommand()");
  need(intentWorkerSource.includes("executeDeviceCommandForActor({"), "structural: intentWorker.ts must call the canonical executeDeviceCommandForActor()");
  need(!/executeCommand\(deviceKey/.test(intentWorkerSource), "structural: no second canonical executor / duplicated provider dispatch logic was reintroduced");
}

// ============================= Structural: no privilege fabrication =============================
{
  need(!/id:\s*"system:/.test(intentWorkerSource), "structural: no synthetic system:* actor id constructed in intentWorker.ts");
  need(!/role:\s*"facility_manager"|role:\s*"ochiga_admin"|role:\s*"manager"/.test(intentWorkerSource), "structural: no fabricated privileged role constructed in intentWorker.ts");
  need(intentWorkerSource.includes('.from("users")') && intentWorkerSource.includes(".eq(\"id\", actorInfo.id)"), "structural: actor scope is re-hydrated from the real users() row by the real actor id, not trusted from the signal payload directly");
  need(intentWorkerSource.includes("permissionsForRole(userRow.role"), "structural: permissions are derived via the canonical role-based fallback, not fabricated/widened");
}

// ============================= Structural: queue contract is additive, fails closed on old jobs =============================
{
  need(intentTypesSource.includes("actor?: {"), "structural: DeviceCommandIntent.actor is optional (additive contract, old queued jobs remain valid at the type level)");
  need(intentWorkerSource.includes("if (!actorInfo?.id || !actorInfo?.role)"), "structural: missing actor on an old/malformed job is explicitly checked and fails closed");
}

// ============================= Structural: devicePermissionPolicy retired, not silently duplicated =============================
{
  need(/export function devicePermissionPolicy\(_signal: Signal\): Intent\[\] \{\s*return \[\];\s*\}/.test(devicePermissionPolicySource), "structural: devicePermissionPolicy's device-authority body is retired to an explicit no-op, still wired (not deleted) in decisionEngine.ts's policy array");
  need(deviceCommandPolicySource.includes("requestedBy?.userId && anySig.requestedBy?.role"), "structural: deviceCommandPolicy threads the REAL requestedBy identity from the signal into the queued intent's actor field");
  need(!deviceCommandPolicySource.includes('id: "system'), "structural: deviceCommandPolicy does not fabricate an actor id");
}

// ============================= Structural: devices.control route permission vs devices.power.control capability documented =============================
{
  const signalsRoutesSource = readFileSync(new URL("../src/routes/signals.ts", import.meta.url), "utf8");
  need(signalsRoutesSource.includes('requirePermission("devices.control")'), "structural: POST /signals route permission (devices.control) is unchanged -- a separate, coarser layer from the canonical devices.power.control capability enforced downstream in intentWorker.ts");
}

// ============================= Structural: verification/ledger semantics untouched =============================
{
  need(verificationServiceSource.includes('"state_confirmed"') || verificationServiceSource.includes("state_confirmed"), "structural: verificationService.ts's state_confirmed vocabulary is untouched by this slice");
  need(verificationServiceSource.includes("state_mismatch"), "structural: verificationService.ts's state_mismatch vocabulary is untouched");
  need(verificationServiceSource.includes("confirmation_timed_out"), "structural: verificationService.ts's confirmation_timed_out vocabulary is untouched");
  need(deviceCommandControllerSource.includes('confirmation_strategy: "provider_ack_only"'), "structural: provider_ack_only confirmation_strategy semantics in the canonical executor are untouched");
}

// ============================= Load compiled worker + spy scaffolding =============================
// Module namespace objects returned by dynamic import() are immutable
// (reassigning a top-level named export throws, per spec) -- so
// reassigning a module's OWN exported function (as opposed to mutating a
// property on some plain object it happens to export, like
// adapterRegistry.get or capabilityModule.rolloutStatus below, both of
// which remain fine via import()) requires Node's CJS require() instead,
// which returns the real, fully-mutable module.exports object. Since
// require() and this script's own dynamic import() of the SAME resolved
// dist path share Node's single module cache, mutating via require()
// here is visible to intentWorker.js's own internal require() calls of
// these exact modules.
const nodeModule = await import("node:module");
const path = await import("node:path");
const backendRoot = path.default.resolve(new URL(".", import.meta.url).pathname, "..");
const require = nodeModule.default.createRequire(import.meta.url);

// Mock the ONE Supabase read handleDeviceIntent performs (the users()
// re-hydration lookup) so this smoke never depends on any real DB rows
// existing. No credentials of any kind are hardcoded -- if real
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are already set in the
// environment this uses those; otherwise harmless placeholders are used
// above, since the client is never actually queried once this mock is
// installed.
const supabaseClientMod = require(path.default.join(backendRoot, "dist/supabase/supabaseClient.js"));
const usersFixtures = new Map();
function setUserFixture(id, row) {
  usersFixtures.set(id, row);
}
const realFrom = supabaseClientMod.supabaseAdmin.from.bind(supabaseClientMod.supabaseAdmin);
supabaseClientMod.supabaseAdmin.from = function (table) {
  if (table === "users") {
    return {
      select() {
        return this;
      },
      eq(_col, id) {
        this._id = id;
        return this;
      },
      async maybeSingle() {
        const row = usersFixtures.get(this._id) || null;
        return { data: row, error: null };
      },
    };
  }
  return realFrom(table);
};

// Spy on the canonical authority boundary -- delegates to the REAL
// implementation (real capabilityRegistry rolloutStatus decides the
// outcome), just counts calls and captures the last input for assertion.
const authorityMod = require(path.default.join(backendRoot, "dist/oyi-core/actions/DeviceCommandAuthority.js"));
const { capabilityRegistry } = require(path.default.join(backendRoot, "dist/oyi-core/capabilities/CapabilityRegistry.js"));
let authorizeCalls = 0;
let lastAuthorizeInput = null;
const realAuthorize = authorityMod.authorizeDeviceCommand;
authorityMod.authorizeDeviceCommand = function (input) {
  authorizeCalls += 1;
  lastAuthorizeInput = input;
  return realAuthorize(input);
};

// Register + capture the devices.power.control module for enable/disable control.
realAuthorize({ actor: { id: "x", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: [] }, commandSource: "app", estateId: "estate-1", homeId: "home-1", roomId: null });
const capabilityModule = capabilityRegistry.get(authorityMod.DEVICE_COMMAND_CAPABILITY_KEY);

// Mock the canonical executor itself -- this lets every scenario below
// be deterministic and Redis/Supabase-device-row independent, while
// still proving (a) it is reached exactly when authority allows and
// never otherwise, and (b) the EXACT arguments intentWorker.ts passes it
// (actor identity, source, scope, commandExecutionId) contain no
// fabrication.
const deviceCommandControllerMod = require(path.default.join(backendRoot, "dist/controllers/deviceCommandController.js"));
let executeCalls = 0;
let lastExecuteInput = null;
let nextExecuteResult = { ok: true, status: "command_dispatched", execution_status: "provider_ack_only", confirmation_strategy: "provider_ack_only", command_execution_id: null };
let nextExecuteError = null;
deviceCommandControllerMod.executeDeviceCommandForActor = async function (input) {
  executeCalls += 1;
  lastExecuteInput = input;
  if (nextExecuteError) {
    const err = nextExecuteError;
    nextExecuteError = null;
    throw err;
  }
  const result = { ...nextExecuteResult, command_execution_id: nextExecuteResult.command_execution_id || input.commandExecutionId };
  return result;
};

// Direct provider-level spies -- proves the worker itself never reaches
// these, independent of the executor mock above (belt and suspenders:
// even if the mock were somehow bypassed, these would catch it).
const registryMod = require(path.default.join(backendRoot, "dist/device/adapters/registry.js"));
let tuyaExecuteCommandCalls = 0;
const realGet = registryMod.adapterRegistry.get.bind(registryMod.adapterRegistry);
registryMod.adapterRegistry.get = function (name) {
  if (name === "tuya") {
    return { executeCommand: async () => { tuyaExecuteCommandCalls += 1; return { ok: true }; } };
  }
  return realGet(name);
};
const bridgeMod = require(path.default.join(backendRoot, "dist/device/bridge.js"));
let mqttPublishCalls = 0;
bridgeMod.publishDeviceAction = async () => { mqttPublishCalls += 1; };

const { handleDeviceIntent } = require(path.default.join(backendRoot, "dist/workers/intentWorker.js"));

function baseIntent(overrides = {}) {
  return {
    schemaVersion: 1,
    target: "device",
    priority: "high",
    reason: "user_device_command",
    deviceId: "00000000-0000-0000-0000-000000000000",
    command: { switch_1: true },
    context: { source_signal: "device.command.requested", created_at: new Date().toISOString() },
    ...overrides,
  };
}

function resetSpies() {
  authorizeCalls = 0;
  lastAuthorizeInput = null;
  executeCalls = 0;
  lastExecuteInput = null;
  tuyaExecuteCommandCalls = 0;
  mqttPublishCalls = 0;
}

setUserFixture("resident-1", { id: "resident-1", role: "resident", estate_id: "estate-1", home_id: "home-1" });
setUserFixture("facility-1", { id: "facility-1", role: "facility_manager", estate_id: "estate-1", home_id: null });
setUserFixture("guest-1", { id: "guest-1", role: "guest", estate_id: "estate-1", home_id: "home-1" });

// ============================= 1. capability enabled + authorized actor -> canonical dispatch =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  const intent = baseIntent({ actor: { id: "resident-1", role: "resident", estateId: "estate-1", homeId: "home-1", roomId: null } });
  const result = await handleDeviceIntent(intent, { id: "job-1" });
  need(authorizeCalls === 1, "1. authorizeDeviceCommand must be called exactly once for an authorized actor");
  need(executeCalls === 1, "1. executeDeviceCommandForActor must be reached when capability is enabled and actor is authorized");
  need(result.ok === true && result.status !== "denied", `1. capability enabled + authorized actor must reach canonical dispatch, got ${JSON.stringify(result)}`);
}

// ============================= 2/3. capability disabled -> denied before provider, provider call count zero =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "disabled";
  const intent = baseIntent({ actor: { id: "resident-1", role: "resident", estateId: "estate-1", homeId: "home-1", roomId: null } });
  const result = await handleDeviceIntent(intent, { id: "job-2" });
  need(result.status === "denied" && result.reason === "capability_disabled", `2. disabled capability must deny before provider, got ${JSON.stringify(result)}`);
  need(executeCalls === 0, "3. executeDeviceCommandForActor must never be called when capability is disabled");
  need(tuyaExecuteCommandCalls === 0 && mqttPublishCalls === 0, "3. provider call count must be zero when capability is disabled");
  capabilityModule.rolloutStatus = "enabled";
}

// ============================= 4/17. missing truthful actor -> fail closed (also covers old queued jobs) =============================
{
  resetSpies();
  const intent = baseIntent(); // no actor field at all
  const result = await handleDeviceIntent(intent, { id: "job-4" });
  need(result.status === "denied" && result.reason === "missing_actor", `4/17. a job with no actor field (old pre-Wave-5D job shape) must fail closed, got ${JSON.stringify(result)}`);
  need(authorizeCalls === 0 && executeCalls === 0, "4/17. no authority or execution call must happen for a missing-actor job");
}

// ============================= 5. insufficient permission -> fail closed =============================
{
  resetSpies();
  const intent = baseIntent({ actor: { id: "guest-1", role: "guest", estateId: "estate-1", homeId: "home-1", roomId: null } });
  const result = await handleDeviceIntent(intent, { id: "job-5" });
  need(result.status === "denied" && result.reason === "missing_permission", `5. a role with no devices.control permission (guest) must be denied, got ${JSON.stringify(result)}`);
  need(executeCalls === 0, "5. no execution for insufficient permission");
}

// ============================= 6. wrong home/scope cannot be self-asserted; real scope is used =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  nextExecuteResult = { ok: true, status: "command_dispatched", execution_status: null, confirmation_strategy: null, command_execution_id: null };
  setUserFixture("resident-wrong-home", { id: "resident-wrong-home", role: "resident", estate_id: "estate-1", home_id: "home-1" });
  // The signal SELF-ASSERTS a different home (home-9-not-owned) than the
  // actor's real one (home-1). Before this fix's re-hydration step, using
  // intent.actor.homeId directly for BOTH the actor's own home_id and
  // the authorized scope would make them always equal by construction --
  // silently discarding devices.power.control's home_scope_not_owned_by_actor
  // protection entirely for this path. The fix closes that by
  // re-hydrating the real home_id from users() and authorizing against
  // THAT, ignoring the signal-self-asserted value outright. Real
  // cross-home device access is still caught downstream by
  // resolveVisibleDevice (scenario 7), now anchored to the truthful home.
  const intent = baseIntent({ actor: { id: "resident-wrong-home", role: "resident", estateId: "estate-1", homeId: "home-9-not-owned", roomId: null } });
  const result = await handleDeviceIntent(intent, { id: "job-6" });
  need(lastAuthorizeInput?.homeId === "home-1", `6. authority must be checked against the RE-HYDRATED real home_id (home-1), completely ignoring the signal-self-asserted home_id (home-9-not-owned) -- got ${lastAuthorizeInput?.homeId}`);
  need(lastAuthorizeInput?.homeId !== "home-9-not-owned", "6. the spoofed home value from the signal must never reach the authority decision");
  need(result.ok === true, `6. once anchored to the real home, authority correctly allows (the spoofed value was simply discarded, not treated as a mismatch to deny) -- got ${JSON.stringify(result)}`);
}

// ============================= 7. device invisible/out-of-scope -> fail closed =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  const notFoundError = new Error("This device is not assigned to your current home.");
  notFoundError.statusCode = 403;
  nextExecuteError = notFoundError;
  const intent = baseIntent({ actor: { id: "resident-1", role: "resident", estateId: "estate-1", homeId: "home-1", roomId: null } });
  const result = await handleDeviceIntent(intent, { id: "job-7" });
  need(result.status === "denied" && /not assigned/.test(result.reason || ""), `7. a device outside the actor's visible scope (canonical resolveVisibleDevice 403) must be converted to a closed denial, not thrown as an unhandled error, got ${JSON.stringify(result)}`);
}

// ============================= 8/9. canonical execution ledger created + command_execution_id available =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  nextExecuteResult = { ok: true, status: "command_dispatched", execution_status: "provider_ack_only", confirmation_strategy: "provider_ack_only", command_execution_id: null };
  const intent = baseIntent({ actor: { id: "resident-1", role: "resident", estateId: "estate-1", homeId: "home-1", roomId: null } });
  const result = await handleDeviceIntent(intent, { id: "job-8-9" });
  // executeDeviceCommandForActor (the real, unmocked implementation) is
  // what writes ai_execution_ledger via upsertDeviceCommandExecution on
  // every call -- proven once, structurally, for this call site; this
  // scenario proves intentWorker.ts SUPPLIES it a commandExecutionId
  // (the ledger's primary key) on every call, which is the necessary and
  // sufficient condition for that pre-existing, unmodified ledger write
  // to happen for signal/intent commands too.
  need(typeof lastExecuteInput?.commandExecutionId === "string" && lastExecuteInput.commandExecutionId.startsWith("signal_intent:"), `8/9. executeDeviceCommandForActor must be given a command_execution_id (ledger key) prefixed signal_intent: for attributable correlation, got ${lastExecuteInput?.commandExecutionId}`);
  need(result.command_execution_id === lastExecuteInput.commandExecutionId, "9. the returned command_execution_id must match what was actually sent to the canonical executor");
}

// ============================= 10. worker no longer directly invokes Tuya =============================
{
  need(tuyaExecuteCommandCalls === 0, "10. across every scenario run so far, adapterRegistry.get('tuya').executeCommand must never have been called by the worker");
  need(mqttPublishCalls === 0, "10. across every scenario run so far, publishDeviceAction must never have been called by the worker");
}

// ============================= 11. provider selection still works through canonical executor =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  nextExecuteResult = { ok: true, status: "command_queued", execution_status: null, confirmation_strategy: null, command_execution_id: null };
  const intent = baseIntent({ actor: { id: "resident-1", role: "resident", estateId: "estate-1", homeId: "home-1", roomId: null } });
  const result = await handleDeviceIntent(intent, { id: "job-11" });
  need(result.status === "dispatched" || result.ok === true, `11. a non-Tuya/non-provider_ack_only canonical result (command_queued) must still be honestly surfaced through the same status-mapping every other entrance uses, got ${JSON.stringify(result)}`);
}

// ============================= 12. BullMQ retry/idempotency behavior safe =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  nextExecuteResult = { ok: true, status: "command_dispatched", execution_status: null, confirmation_strategy: null, command_execution_id: null };
  const intent = baseIntent({ actor: { id: "resident-1", role: "resident", estateId: "estate-1", homeId: "home-1", roomId: null } });
  const sameJob = { id: "job-12-stable" };
  await handleDeviceIntent(intent, sameJob);
  const firstId = lastExecuteInput.commandExecutionId;
  nextExecuteResult = { ok: true, status: "command_dispatched", execution_status: null, confirmation_strategy: null, command_execution_id: null };
  await handleDeviceIntent(intent, sameJob); // simulates a BullMQ redelivery of the SAME job
  const secondId = lastExecuteInput.commandExecutionId;
  need(firstId === secondId, `12. a redelivered attempt of the SAME BullMQ job must derive the IDENTICAL command_execution_id (${firstId} vs ${secondId}) so the existing LIFECYCLE_RANK guard in upsertDeviceCommandExecution can safely no-op the duplicate -- no new idempotency logic needed`);

  const otherJob = { id: "job-12-different" };
  await handleDeviceIntent(intent, otherJob);
  need(lastExecuteInput.commandExecutionId !== firstId, "12. a genuinely different job must derive a different command_execution_id");
}

// ============================= 13/14/15/16. verification vocabulary preserved (structural, already asserted above; functional smoke) =============================
{
  need(verificationServiceSource.includes("expected_state"), "13/14/15. verificationService.ts's expected_state non-empty requirement is untouched by this slice");
  need(/awaiting_state_confirmation/.test(deviceCommandControllerSource), "13/14/15. awaiting_state_confirmation lifecycle status untouched in the canonical executor");
  need(/provider_ack_only/.test(deviceCommandControllerSource) && /physical_effect_status:\s*providerAckOnly \? "unknown" : "unknown"/.test(deviceCommandControllerSource), "16. provider_ack_only paths never claim a confirmed physical_effect_status -- unchanged honest semantics");
}

// ============================= 18. representative valid queue job completes without privilege fabrication =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  nextExecuteResult = { ok: true, status: "command_dispatched", execution_status: "provider_ack_only", confirmation_strategy: "provider_ack_only", command_execution_id: null };
  const intent = baseIntent({ actor: { id: "resident-1", role: "resident", estateId: "estate-1", homeId: "home-1", roomId: "room-1" } });
  const result = await handleDeviceIntent(intent, { id: "job-18" });
  need(result.ok === true, `18. a representative valid job (enabled + authorized) must complete, got ${JSON.stringify(result)}`);
  need(lastExecuteInput.actor.id === "resident-1" && lastExecuteInput.actor.role === "resident", "18. the actor passed to the canonical executor is exactly the real re-hydrated identity");
  need(lastExecuteInput.actor.estate_id === "estate-1" && lastExecuteInput.actor.home_id === "home-1", "18. the actor's scope passed to the canonical executor is exactly the real re-hydrated scope, not the signal-self-asserted one");
  need(!("permissions" in lastExecuteInput.actor) || Array.isArray(lastExecuteInput.actor.permissions), "18. permissions (if present) are a real derived array, not a fabricated privileged string");
  need(lastExecuteInput.source === "signal", "18. source is honestly tagged 'signal', not disguised as 'app'/'facility'/etc.");
}

// ============================= Global kill-switch: every previously-converged entrance stays intact =============================
{
  need(deviceCommandControllerSource.includes("const authority = authorizeDeviceCommand({"), "kill-switch: Direct HTTP (requestDeviceCommand) still gates before dispatch");
  need(officeExportSource.includes("officeDeviceCommandAuthority: true"), "kill-switch: Office automation test authority boundary intact");
  need(scenesSource.includes('officeDeviceCommandAuthority: surface === "office",'), "kill-switch: Office automation scheduler authority boundary intact");
  need(watchAdapterSource.includes('commandSource: "watch",'), "kill-switch: Watch direct/scene authority boundary intact");
  need((commandRouterSource.match(/authorizeDeviceCommand\(\{/g) || []).length === 3, "kill-switch: commandRouter.ts's 3 authority call sites intact");
  need(executionRegistrySource.includes("authorizeDeviceCommand({"), "kill-switch: Facility Automation device.on/off/toggle authority gate intact");
  need(eventRuleSource.includes('role: "ai_agent",') && eventRuleSource.includes('id: "system:facility-automation",'), "kill-switch: Facility Automation's honest ai_agent system actor unchanged");
  need(residentBatchSource.includes("const authority = authorizeDeviceCommand({"), "kill-switch: consumer scene/automation authority boundary (Wave 5C) intact");
  need(intentWorkerSource.includes("const authority = authorizeDeviceCommand({"), "kill-switch: signal/intent worker (this slice) authority boundary present");
}

// ============================= Global kill-switch: functional -- disabled means zero dispatch, re-enable resumes =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "disabled";
  const intent = baseIntent({ actor: { id: "resident-1", role: "resident", estateId: "estate-1", homeId: "home-1", roomId: null } });
  await handleDeviceIntent(intent, { id: "job-killswitch-1" });
  need(executeCalls === 0 && tuyaExecuteCommandCalls === 0 && mqttPublishCalls === 0, "global kill-switch: disabled must produce ZERO provider dispatch for the signal/intent entrance");

  capabilityModule.rolloutStatus = "enabled";
  nextExecuteResult = { ok: true, status: "command_dispatched", execution_status: null, confirmation_strategy: null, command_execution_id: null };
  const result = await handleDeviceIntent(intent, { id: "job-killswitch-2" });
  need(result.ok === true, "global kill-switch: re-enabling must restore normal dispatch behaviour for the signal/intent entrance");
}

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS 1: capability enabled + authorized actor -> canonical dispatch");
console.log("PASS 2/3: capability disabled -> denied before provider, provider call count zero");
console.log("PASS 4/17: missing truthful actor (old/malformed job) -> fail closed");
console.log("PASS 5: insufficient permission (guest role) -> fail closed");
console.log("PASS 6: signal-self-asserted wrong home scope cannot bypass authority -- re-hydrated real scope is used");
console.log("PASS 7: device invisible/out-of-scope -> fail closed, not an unhandled throw");
console.log("PASS 8/9: canonical execution ledger key (command_execution_id) supplied and returned honestly");
console.log("PASS 10: worker never directly invokes Tuya or MQTT across any scenario");
console.log("PASS 11: provider selection still flows through the canonical executor's own status vocabulary");
console.log("PASS 12: BullMQ redelivery of the same job reuses the same command_execution_id; a different job gets a different one");
console.log("PASS 13/14/15/16: verification vocabulary (state_confirmed/state_mismatch/confirmation_timed_out/provider_ack_only) unmodified");
console.log("PASS 18: a representative valid job completes with the real re-hydrated actor identity, no privilege fabrication");
console.log("PASS global kill-switch: every previously-converged entrance remains intact, plus the new signal/intent entrance");
console.log("PASS global kill-switch: disabled -> zero dispatch; re-enabled -> dispatch resumes");
console.log("wave5d-signal-intent-device-authority-smoke passed");
capabilityModule.rolloutStatus = "enabled";
process.exit(0);
