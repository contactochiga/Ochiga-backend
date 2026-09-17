#!/usr/bin/env node
// Wave 4B -- Intelligence Convergence, Slice 4. Closes the material gap
// Slice 3 established for commandRouter.ts's device_command tool:
// routeAiCommand -> executeDeviceCommandTool already had a real actor,
// a real hasPermission(actor, "devices.control") check, real device
// resolution/scope (findDeviceForPrompt -> resolveVisibleDevice), and
// real risk/confirmation semantics -- but never consulted
// capabilityRegistry, so a canonical devices.power.control
// rollout-status kill-switch had no effect on this legacy path.
//
// Fix: both physical-dispatch points now call the SAME, unmodified
// DeviceCommandAuthority.authorizeDeviceCommand() gate every other
// Wave 4/4B device-command path uses, with the real actor (no synthetic
// identity):
//   1. executeDeviceCommandTool's low-risk auto-execute lane (proposal
//      time immediate execution).
//   2. executeConfirmedWorker's device_command branch (confirmed
//      execution, run later, potentially after an arbitrary delay) --
//      this is a FRESH call, not a cached decision from proposal time,
//      so a capability disabled between "Unlock the door?" being
//      proposed and the user confirming it correctly denies at confirm
//      time too.
// Risk classification (low/medium/high/read) and the existing
// hasPermission/scope checks are completely unchanged -- this slice
// adds exactly one more layer, run immediately before each dispatch
// point, never replacing what was already there.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "wave4b-slice4-smoke-service-role-key";

import { readFileSync } from "node:fs";

const { authorizeDeviceCommand, DEVICE_COMMAND_CAPABILITY_KEY } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");
const { capabilityRegistry } = await import("../dist/oyi-core/capabilities/CapabilityRegistry.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const commandRouterSource = readFileSync(new URL("../src/ai/commandRouter.ts", import.meta.url), "utf8");

const residentActor = { id: "resident-1", role: "resident", home_id: "home-1", estate_id: "estate-1", permissions: ["devices.control"] };

// ============================= 1. Low risk, permission+scope ok, capability enabled -> allowed =============================

const allowed = authorizeDeviceCommand({ actor: residentActor, commandSource: "app", estateId: "estate-1", homeId: "home-1", roomId: null });
need(allowed.allowed === true, `1. a permitted, in-scope actor with the capability enabled must be allowed -- existing execution must keep working, got: ${JSON.stringify(allowed)}`);

// ============================= 2. Kill switch: permission+scope ok, capability disabled -> denied =============================

// Trigger the real, lazy capability registration (same path
// executeDeviceCommandTool/executeConfirmedWorker exercise), then flip
// the REAL registered module's rolloutStatus off -- proving the actual
// production kill-switch mechanism, not a re-derived approximation of it.
const capabilityModule = capabilityRegistry.get(DEVICE_COMMAND_CAPABILITY_KEY);
need(capabilityModule !== null, "2. devices.power.control must be registered after the first authorizeDeviceCommand call");
const originalRolloutStatus = capabilityModule.rolloutStatus;
need(originalRolloutStatus === "enabled", `2. sanity: capability must normally be enabled, got: ${originalRolloutStatus}`);

capabilityModule.rolloutStatus = "disabled";
const deniedByKillSwitch = authorizeDeviceCommand({ actor: residentActor, commandSource: "app", estateId: "estate-1", homeId: "home-1", roomId: null });
need(deniedByKillSwitch.allowed === false, `2. a platform-wide capability kill-switch must deny an otherwise fully-permitted, in-scope actor, got: ${JSON.stringify(deniedByKillSwitch)}`);
need(deniedByKillSwitch.reason === "capability_disabled", `2. denial reason must be capability_disabled, got: ${deniedByKillSwitch.reason}`);

capabilityModule.rolloutStatus = originalRolloutStatus;
const allowedAfterRestore = authorizeDeviceCommand({ actor: residentActor, commandSource: "app", estateId: "estate-1", homeId: "home-1", roomId: null });
need(allowedAfterRestore.allowed === true, "2. restoring the capability's rollout status must restore normal allow behaviour -- proves this is a live, re-evaluated decision, not a cached one-time check");

// ============================= 3. Scope: wrong device/home -> denied, existing behaviour intact =============================

const deniedWrongHome = authorizeDeviceCommand({ actor: residentActor, commandSource: "app", estateId: "estate-1", homeId: "home-2", roomId: null });
need(deniedWrongHome.allowed === false && deniedWrongHome.reason === "home_scope_not_owned_by_actor", `3. a device belonging to a different home must still be denied, got: ${JSON.stringify(deniedWrongHome)}`);
const deniedNoScope = authorizeDeviceCommand({ actor: residentActor, commandSource: "app", estateId: "estate-1", homeId: null, roomId: null });
need(deniedNoScope.allowed === false && deniedNoScope.reason === "home_scope_required", `3. missing home scope must still be denied, got: ${JSON.stringify(deniedNoScope)}`);

// The existing device resolution/scope layer (findDeviceForPrompt ->
// resolveVisibleDevice, deviceWithinActorScope in the confirmed path)
// must remain completely unmodified by this slice -- the new gate is
// additive, not a replacement.
need(commandRouterSource.includes("const device = await findDeviceForPrompt(actor, prompt, args);"), "3. executeDeviceCommandTool's existing device resolution must be unchanged");
need(commandRouterSource.includes("if (!device || !deviceWithinActorScope(actor, device, deviceRuntimeScope(actor, args))) {"), "3. executeConfirmedWorker's existing scope check must be unchanged");

// ============================= 4/5. Placement: fresh re-authorization before EACH physical dispatch point =============================

const proposalFnStart = commandRouterSource.indexOf("async function executeDeviceCommandTool(");
const proposalFnEnd = commandRouterSource.indexOf("\nasync function insertSupportTicket", proposalFnStart);
const proposalFnBody = commandRouterSource.slice(proposalFnStart, proposalFnEnd > 0 ? proposalFnEnd : commandRouterSource.length);

need(proposalFnBody.includes("import { authorizeDeviceCommand }") === false, "sanity: import lives at module top, not inside the function body");
need((proposalFnBody.match(/authorizeDeviceCommand\(\{/g) || []).length === 1, "4. executeDeviceCommandTool must call authorizeDeviceCommand exactly once, in its low-risk auto-execute lane");

const offlineCheckIdx = proposalFnBody.indexOf("if (deviceOffline(device)) {");
const proposalAuthorityIdx = proposalFnBody.indexOf("authorizeDeviceCommand({");
const proposalDenyReturnIdx = proposalFnBody.indexOf("if (!authority.allowed) {");
const proposalExecuteIdx = proposalFnBody.indexOf("const result = await executeDeviceCommandForActor({");
need(offlineCheckIdx > 0 && proposalAuthorityIdx > offlineCheckIdx, "4. authority must be decided after device resolution/offline check (needs the real resolved device's scope)");
need(proposalDenyReturnIdx > proposalAuthorityIdx && proposalDenyReturnIdx < proposalExecuteIdx, "4. a denial must return before executeDeviceCommandForActor in the low-risk lane");
need(proposalExecuteIdx > proposalAuthorityIdx, "4. authorization must run before physical dispatch in the proposal/low-risk lane");

// The medium-risk confirmation-creation branch (writes a
// pending_confirmation ledger row, no execution) must NOT be gated by
// authorizeDeviceCommand -- nothing physical happens there yet, and
// gating it would be pointless since the confirmed-execution path
// re-authorizes fresh anyway (see below). Risk classification and the
// high-risk denial remain first, unmodified, and untouched by this slice.
const highRiskIdx = proposalFnBody.indexOf('if (classification.risk === "high") {');
const mediumConfirmIdx = proposalFnBody.indexOf('if (classification.risk === "medium" || oyiMutation) {');
const pendingConfirmationReturnIdx = proposalFnBody.indexOf('status: "pending_confirmation", confirmation_required: true');
need(highRiskIdx > 0 && highRiskIdx < mediumConfirmIdx, "5. high-risk denial must still run first, unmodified");
need(mediumConfirmIdx > 0 && mediumConfirmIdx < proposalAuthorityIdx, "5. medium-risk confirmation-creation must run, and return, before the authority gate -- creating a pending_confirmation ledger row is not physical dispatch");
need(pendingConfirmationReturnIdx > mediumConfirmIdx && pendingConfirmationReturnIdx < proposalAuthorityIdx, "5. the medium-risk branch must still return its own pending_confirmation result without ever reaching authorizeDeviceCommand");

const confirmedFnStart = commandRouterSource.indexOf("async function executeConfirmedWorker(");
const confirmedFnEnd = commandRouterSource.indexOf("\n  return {\n    ok: false,\n    status: \"failed\"", confirmedFnStart);
const confirmedFnBody = commandRouterSource.slice(confirmedFnStart, confirmedFnEnd > 0 ? confirmedFnEnd : commandRouterSource.length);

need((confirmedFnBody.match(/authorizeDeviceCommand\(\{/g) || []).length === 1, "4. executeConfirmedWorker must call authorizeDeviceCommand exactly once, freshly, in its device_command branch");
const workerNotAllowedIdx = confirmedFnBody.indexOf('error: "worker_not_allowed"');
const confirmedAuthorityIdx = confirmedFnBody.indexOf("authorizeDeviceCommand({");
const confirmedDenyIdx = confirmedFnBody.indexOf("if (!authority.allowed) {");
const confirmedExecuteIdx = confirmedFnBody.indexOf("const result = await executeDeviceCommandForActor({");
need(workerNotAllowedIdx > 0 && confirmedAuthorityIdx > workerNotAllowedIdx, "4. the confirmed-path authority check must run after the existing worker_not_allowed classification check");
need(confirmedDenyIdx > confirmedAuthorityIdx && confirmedDenyIdx < confirmedExecuteIdx, "4. a denial must return before executeDeviceCommandForActor in the confirmed-execution lane -- provider is never called on denial");
need(confirmedExecuteIdx > confirmedAuthorityIdx, "4. re-authorization must run immediately before confirmed physical dispatch");

// This is the concrete "must not bypass the new kill switch" proof:
// the confirmed path's authorizeDeviceCommand call must be a genuinely
// independent, fresh invocation -- not reading any cached/stored
// allowed value from record/metadata (which would let a capability
// disabled after proposal still execute at confirm time).
const confirmedCallStart = confirmedFnBody.indexOf("authorizeDeviceCommand({");
const confirmedCallEnd = confirmedFnBody.indexOf("});", confirmedCallStart);
const confirmedCallText = confirmedFnBody.slice(confirmedCallStart, confirmedCallEnd);
need(!/record\.(allowed|authority|capability)/.test(confirmedCallText) && !/metadata\.(allowed|authority|capability)/.test(confirmedCallText), "4. the confirmed re-authorization must not reuse any stored proposal-time authority result");

// A denial in either lane must produce the same, existing denial shape
// (status: "denied"/error, no fabricated device/provider failure) --
// not a fake "device_offline"/"device_command_failed" outcome.
need(proposalFnBody.slice(proposalAuthorityIdx, proposalExecuteIdx).includes('status: "denied"'), "capability denial in the proposal lane must use the existing 'denied' status, not a fabricated device/provider failure");
need(confirmedFnBody.slice(confirmedAuthorityIdx, confirmedExecuteIdx).includes('status: "denied" as AiCommandStatus'), "capability denial in the confirmed lane must use the existing 'denied' status, not a fabricated device/provider failure");

// ============================= 6. Adjacent run_scene / other slices' boundaries are unchanged =============================

const runSceneFnStart = commandRouterSource.indexOf("async function executeRunSceneTool(");
const runSceneFnEnd = commandRouterSource.indexOf("\nasync function createMaintenanceRequestTool", runSceneFnStart);
const executeSceneFnStart = commandRouterSource.indexOf("async function executeScene(");
const executeSceneFnEnd = commandRouterSource.indexOf("\nasync function executeRunSceneTool", executeSceneFnStart);
need(!commandRouterSource.slice(runSceneFnStart, runSceneFnEnd).includes("authorizeDeviceCommand"), "6. run_scene's proposal path (executeRunSceneTool) must not be touched by this slice");
need(!commandRouterSource.slice(executeSceneFnStart, executeSceneFnEnd).includes("authorizeDeviceCommand"), "6. executeScene (the real device dispatch behind run_scene) must not be touched by this slice");
const confirmedRunSceneIdx = confirmedFnBody.indexOf('if (tool.tool_id === "run_scene") {');
need(confirmedRunSceneIdx > 0 && !confirmedFnBody.slice(confirmedRunSceneIdx).includes("authorizeDeviceCommand"), "6. executeConfirmedWorker's confirmed run_scene branch must not be touched by this slice -- migrating confirmed run_scene is explicitly deferred");

// Slices 1-3's own boundaries remain intact.
const officeExportSource = readFileSync(new URL("../src/routes/officeExport.ts", import.meta.url), "utf8");
const scenesSource = readFileSync(new URL("../src/routes/scenes.ts", import.meta.url), "utf8");
const watchAdapterSource = readFileSync(new URL("../src/services/watchAdapterService.ts", import.meta.url), "utf8");
need(officeExportSource.includes("officeDeviceCommandAuthority: true"), "6. Slice 1's officeExport.ts automation-test authority boundary must remain intact");
need(scenesSource.includes('officeDeviceCommandAuthority: surface === "office",'), "6. Slice 2's scheduler authority boundary must remain intact");
need(watchAdapterSource.includes('commandSource: "watch",'), "6. Slice 3's Watch scene authority boundary must remain intact");

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS a permitted, in-scope actor with the capability enabled is allowed -- existing low-risk execution keeps working");
console.log("PASS a live capability rollout-status kill-switch denies an otherwise fully-permitted, in-scope actor, and restoring it restores normal behaviour");
console.log("PASS wrong/missing home scope is still denied -- existing scope enforcement is unchanged");
console.log("PASS both physical-dispatch points (proposal-time low-risk auto-execute, and confirmed-execution) authorize freshly, after existing checks, immediately before executeDeviceCommandForActor -- denial always returns before dispatch, using the existing 'denied' status");
console.log("PASS high-risk denial and medium-risk confirmation-creation are unmodified and run entirely before the new authority gate");
console.log("PASS run_scene (proposal, executeScene, and confirmed) and Slices 1-3's authority boundaries are all untouched by this slice");
console.log("wave4b-slice4-commandrouter-device-command-authority-smoke passed");
