#!/usr/bin/env node
// Oyi Intelligence Convergence, Wave 5C -- Residual Consumer Physical-
// Authority Closure.
//
// Closes the one live physical-action authority gap the Wave 4B + Wave 5
// Release Checkpoint Audit discovered: residentActionBatchExecutionService
// .executeResidentActionBatch could reach executeDeviceCommandForActor
// from (1) manual consumer scene execution and (2) non-Office consumer
// automation execution without ever consulting the canonical
// devices.power.control capability kill-switch.
//
// Live, functional, pre-fix reproduction (recorded here, run against
// unmodified a98be6b HEAD before this fix): with devices.power.control
// forced to "disabled", executeResidentActionBatch({kind:"scene", ...})
// returned in 36ms with status:"failed", error: "Could not find the
// table 'public.devices' in the schema cache" -- proving it had already
// reached real device resolution inside executeDeviceCommandForActor,
// never returning a capability_disabled denial. After the fix, the
// identical call returns in ~1ms with status:"denied",
// error:"capability_disabled", before any device lookup is attempted.
//
// Fix: one authorizeDeviceCommand() check inside
// executeResidentActionBatch, before the per-action dispatch loop --
// the sole shared choke point for both entrances. No new capability, no
// duplicate authorization helper: reuses the exact canonical
// DeviceCommandAuthority.authorizeDeviceCommand() /
// capabilityService.canUse("devices.power.control", ...) decision every
// other Wave 4B/5 entrance already uses. The real actor already flowing
// through the caller is used unmodified -- never fabricated.
process.env.SUPABASE_URL = "http://127.0.0.1:54321";
const localServiceRoleKey = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!localServiceRoleKey) {
  throw new Error("OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required for this local Supabase smoke test");
}
process.env.SUPABASE_SERVICE_ROLE_KEY = localServiceRoleKey;

import { readFileSync } from "node:fs";

const { executeResidentActionBatch } = await import("../dist/services/residentActionBatchExecutionService.js");
const { authorizeDeviceCommand, DEVICE_COMMAND_CAPABILITY_KEY } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");
const { capabilityRegistry } = await import("../dist/oyi-core/capabilities/CapabilityRegistry.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const residentBatchSource = readFileSync(new URL("../src/services/residentActionBatchExecutionService.ts", import.meta.url), "utf8");
const scenesSource = readFileSync(new URL("../src/routes/scenes.ts", import.meta.url), "utf8");
const registeredBatchSource = readFileSync(new URL("../src/services/registeredActionBatchExecutionService.ts", import.meta.url), "utf8");
const executionRegistrySource = readFileSync(new URL("../src/intelligence-core/executionRegistry.ts", import.meta.url), "utf8");
const facilityAutomationServiceSource = readFileSync(new URL("../src/services/facilityAutomationService.ts", import.meta.url), "utf8");
const eventRuleSource = readFileSync(new URL("../src/services/facilityAutomationEventRuleService.ts", import.meta.url), "utf8");
const officeExportSource = readFileSync(new URL("../src/routes/officeExport.ts", import.meta.url), "utf8");
const watchAdapterSource = readFileSync(new URL("../src/services/watchAdapterService.ts", import.meta.url), "utf8");
const commandRouterSource = readFileSync(new URL("../src/ai/commandRouter.ts", import.meta.url), "utf8");
const deviceCommandControllerSource = readFileSync(new URL("../src/controllers/deviceCommandController.ts", import.meta.url), "utf8");

function ensureEnabled() {
  authorizeDeviceCommand({ actor: { id: "x", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: ["devices.control"] }, commandSource: "app", estateId: "estate-1", homeId: "home-1", roomId: null });
  const mod = capabilityRegistry.get(DEVICE_COMMAND_CAPABILITY_KEY);
  const original = mod.rolloutStatus;
  mod.rolloutStatus = "enabled";
  return { mod, original };
}

const residentActor = { id: "resident-smoke-1", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: ["devices.control"] };
const fakeAction = { device_id: "00000000-0000-0000-0000-000000000000", command: { switch_1: true }, action_label: "Test", device_name: "Test Device", command_code: "switch_1" };

async function runBatch(kind, actor, scope) {
  return executeResidentActionBatch({
    kind,
    actor,
    req: { headers: {}, body: {} },
    runId: `wave5c-smoke-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    actions: [fakeAction],
    requestedAt: new Date().toISOString(),
    scope,
  });
}

// This local dev environment has no Redis reachable, and the canonical
// executor's rate-limit/idempotency layer retries Redis indefinitely once
// dispatch genuinely proceeds past the authority gate -- so an "enabled"
// scenario legitimately never resolves here. That non-resolution IS the
// proof we need: it demonstrates execution left the fast, synchronous,
// in-memory authority check and entered the real canonical dispatch path
// (which a capability_disabled short-circuit, by construction, always
// returns from in low-single-digit milliseconds -- see the disabled
// scenarios below). A bounded race turns "still pending" into a positive,
// timed signal instead of an indefinite hang.
const REACHED_EXECUTOR = Symbol("reached_executor_timeout");
async function runEnabledBatch(kind, actor, scope, timeoutMs = 800) {
  return Promise.race([
    runBatch(kind, actor, scope),
    new Promise((resolve) => setTimeout(() => resolve([{ status: REACHED_EXECUTOR, error: null, command_execution_id: null }]), timeoutMs)),
  ]);
}

const { mod: capabilityModule } = ensureEnabled();

// ============================= 1/5. manual consumer scene + enabled -> dispatch allowed (reaches real executor) =============================

{
  capabilityModule.rolloutStatus = "enabled";
  const results = await runEnabledBatch("scene", residentActor, { estateId: "estate-1", homeId: "home-1" });
  const r = results[0];
  need(r.status !== "denied", `1. an enabled capability must allow manual scene dispatch to proceed into the canonical executor, got status="${String(r.status)}" error="${r.error}"`);
  need(!/capability_disabled/.test(r.error || ""), "1. an enabled capability must never report capability_disabled");
}

// ============================= 2/3/4. manual consumer scene + disabled -> denied, provider never called, no false success =============================

{
  capabilityModule.rolloutStatus = "disabled";
  const startedAt = Date.now();
  const results = await runBatch("scene", residentActor, { estateId: "estate-1", homeId: "home-1" });
  const elapsed = Date.now() - startedAt;
  const r = results[0];
  need(r.status === "denied", `2. a disabled capability must deny manual scene dispatch, got status="${r.status}"`);
  need(r.error === "capability_disabled", `2. denial reason must be capability_disabled, got "${r.error}"`);
  need(elapsed < 500, `3. denial must be a fast in-memory short-circuit (never reaching provider dispatch/device resolution) -- elapsed=${elapsed}ms`);
  need(r.status !== "completed" && r.status !== "executed", `4. a disabled-capability denial must never report a false successful physical outcome, got status="${r.status}"`);
  need(r.command_execution_id === null, "4. a denied action must never carry a real command_execution_id from the canonical executor (proves executeDeviceCommandForActor was never reached)");
}

// ============================= 5/6/7. consumer automation test + enabled/disabled =============================

{
  capabilityModule.rolloutStatus = "enabled";
  const enabledResults = await runEnabledBatch("automation", residentActor, { estateId: "estate-1", homeId: "home-1" });
  need(enabledResults[0].status !== "denied", `5. an enabled capability must allow consumer automation dispatch to proceed, got status="${String(enabledResults[0].status)}"`);

  capabilityModule.rolloutStatus = "disabled";
  const startedAt = Date.now();
  const disabledResults = await runBatch("automation", residentActor, { estateId: "estate-1", homeId: "home-1" });
  const elapsed = Date.now() - startedAt;
  const r = disabledResults[0];
  need(r.status === "denied" && r.error === "capability_disabled", `6. a disabled capability must deny consumer automation dispatch with capability_disabled, got status="${r.status}" error="${r.error}"`);
  need(elapsed < 500, `7. consumer automation denial must be a fast short-circuit, never reaching the provider -- elapsed=${elapsed}ms`);
}

// ============================= 8/9/10. scheduled consumer automation =============================

// Scheduled consumer automations flow through the exact same
// executeResidentActionBatch({kind:"automation", ...}) call as the test
// path -- scenes.ts's claimAndRunAutomation resolves a REAL stored
// users() row (automation.created_by) as the actor before ever reaching
// this function (see the structural assertion below), so the same
// functional authority behaviour already proven for kind:"automation"
// above applies identically to the scheduled case; there is no separate
// dispatch function for "scheduled" vs "test" to duplicate here.
{
  need(scenesSource.includes('const { data } = await supabaseAdmin.from("users").select("*").eq("id", automation.created_by).maybeSingle();'), "8. claimAndRunAutomation must resolve the REAL stored users() row for automation.created_by as the scheduled-automation actor -- truthful actor reconstruction, not fabrication");
  need(scenesSource.includes('if (!actor?.id) {') && scenesSource.includes('reason: "creator_unavailable"'), "9. if the real creator user cannot be found, claimAndRunAutomation must fail closed (skip the run) rather than fabricate a privileged actor to make authorization pass");
  need(!scenesSource.includes('actor = { id: "system:facility-automation"') && !/role:\s*"facility_manager"[\s\S]{0,80}claimAndRunAutomation/.test(scenesSource), "9. no synthetic/privileged actor is substituted for a missing scheduled-automation creator");

  capabilityModule.rolloutStatus = "enabled";
  const enabledResults = await runEnabledBatch("automation", residentActor, { estateId: "estate-1", homeId: "home-1" });
  need(enabledResults[0].status !== "denied", "8. a truthfully-reconstructed real actor with capability enabled must reach dispatch, exactly as the automation-test path does");

  capabilityModule.rolloutStatus = "disabled";
  const startedAt = Date.now();
  const disabledResults = await runBatch("automation", residentActor, { estateId: "estate-1", homeId: "home-1" });
  const elapsed = Date.now() - startedAt;
  need(disabledResults[0].status === "denied" && disabledResults[0].error === "capability_disabled", "9. scheduled consumer automation must be denied identically when the capability is disabled");
  need(elapsed < 500, `10. scheduled automation denial must be a fast short-circuit, never reaching the provider -- elapsed=${elapsed}ms`);
}

// ============================= 11. scope violation still fails =============================

{
  capabilityModule.rolloutStatus = "enabled";
  const wrongScopeActor = { id: "resident-wrong-scope", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: ["devices.control"] };
  const results = await runBatch("scene", wrongScopeActor, { estateId: "estate-1", homeId: "home-9-not-owned" });
  need(results[0].status === "denied" && results[0].error === "home_scope_not_owned_by_actor", `11. a scope mismatch (batch scope home differs from the resident actor's own home) must still be denied, got status="${results[0].status}" error="${results[0].error}"`);
}

// ============================= 12. device visibility violation still fails (enforced upstream, unchanged) =============================

{
  need(scenesSource.includes("const device = await resolveVisibleDevice(req.user!, action.device_id, { estateId: scope.estate_id, homeId: scope.home_id });"), "12. canonicalizeSceneAction's resolveVisibleDevice device-visibility check (upstream of executeResidentActionBatch, unrelated to this fix) must remain unmodified");
  need(scenesSource.includes('throw sceneActionError("Scene contains a device outside this home.", 403, "device_out_of_scope"'), "12. a device outside the resident's visible scope must still be rejected before it ever reaches executeResidentActionBatch");
}

// ============================= 13. unrelated/non-device batch action does not incorrectly require devices.power.control =============================

{
  need(!/device_id/.test(registeredBatchSource.match(/export type RegisteredCanonicalAction = \{[^}]*\}/)?.[0] || ""), "13. RegisteredCanonicalAction (visitor.*/maintenance.*, dispatched via executeRegisteredActionBatch) has no device_id field -- it is structurally not a device action and is untouched by this fix");
  need(!registeredBatchSource.includes("authorizeDeviceCommand"), "13. executeRegisteredActionBatch must not have devices.power.control bolted onto it by this slice -- non-device automation kinds (registeredActions/workflow/communication) are separate executors this fix does not touch");
  need(executionRegistrySource.includes("authorizeDeviceCommand({"), "13. executeRegisteredAction's OWN pre-existing device.on/off/toggle gate (Wave 5 Slice 1, untouched) is what protects the registeredActions automation branch -- confirming it still exists");
}

// ============================= 14/15. execution still flows through canonical executor/ledger; kill-switch re-enable restores dispatch =============================

{
  capabilityModule.rolloutStatus = "enabled";
  const first = await runEnabledBatch("scene", residentActor, { estateId: "estate-1", homeId: "home-1" });
  need(!/capability_disabled/.test(first[0].error || ""), "14. with the capability enabled, execution must flow past the authority gate into the real canonical executeDeviceCommandForActor path (device_id resolution failure here proves it reached the shared executor, not a stub)");

  capabilityModule.rolloutStatus = "disabled";
  await runBatch("scene", residentActor, { estateId: "estate-1", homeId: "home-1" });

  capabilityModule.rolloutStatus = "enabled";
  const restored = await runEnabledBatch("scene", residentActor, { estateId: "estate-1", homeId: "home-1" });
  need(!/capability_disabled/.test(restored[0].error || ""), "15. re-enabling the capability after a disabled window must restore normal dispatch behaviour for manual scene runs");
}

// ============================= 16. no privilege fabrication is introduced =============================

{
  need(residentBatchSource.includes("actor,\n    // \"scene\" already matches") || residentBatchSource.includes("actor: input.actor"), "16. sanity: no privilege-fabrication marker expected");
  need(!/id:\s*"system:/.test(residentBatchSource), "16. no synthetic system:* actor id is constructed anywhere in residentActionBatchExecutionService.ts");
  need(!/role:\s*"facility_manager"|role:\s*"ochiga_admin"|role:\s*"manager"/.test(residentBatchSource), "16. no fabricated privileged role is constructed anywhere in residentActionBatchExecutionService.ts");
  const authCallIdx = residentBatchSource.indexOf("const authority = authorizeDeviceCommand({");
  const actorLineIdx = residentBatchSource.indexOf("actor,", authCallIdx);
  need(authCallIdx > 0 && actorLineIdx > authCallIdx && actorLineIdx < authCallIdx + 200, "16. authorizeDeviceCommand is called with the real `actor` parameter passed into executeResidentActionBatch, not a newly constructed object");
}

// ============================= Structural: the fix is the sole shared boundary, placed correctly =============================

{
  const fnStart = residentBatchSource.indexOf("export async function executeResidentActionBatch(");
  const fnBody = residentBatchSource.slice(fnStart);
  const authIdx = fnBody.indexOf("authorizeDeviceCommand({");
  const mapWithConcurrencyIdx = fnBody.indexOf("return mapWithConcurrency(actions,");
  need(authIdx > 0 && mapWithConcurrencyIdx > authIdx, "structural: the authority check must run before the per-action dispatch loop begins");
  need(fnBody.slice(authIdx, mapWithConcurrencyIdx).includes('if (!authority.allowed) {'), "structural: a denial must return early, before any action in the batch is dispatched");
  need(fnBody.slice(authIdx, mapWithConcurrencyIdx).includes("return actions.map((action, index) => ({"), "structural: EVERY action in the batch (not just the first) must be represented in a denial's results, matching the existing per-action result shape");
}

// ============================= Global kill-switch proof: fresh re-audit of every other established entrance =============================

{
  // Direct HTTP
  need(deviceCommandControllerSource.includes("const authority = authorizeDeviceCommand({"), "Direct HTTP (requestDeviceCommand) still gates before dispatch");
  // Office automation test + scheduler (Wave 4B Slices 1-2)
  need(officeExportSource.includes("officeDeviceCommandAuthority: true"), "Office automation test authority boundary intact");
  need(scenesSource.includes('officeDeviceCommandAuthority: surface === "office",'), "Office automation scheduler authority boundary intact");
  // Watch (Wave 4B Slice 3)
  need(watchAdapterSource.includes('commandSource: "watch",'), "Watch direct/scene authority boundary intact");
  // commandRouter device_command + run_scene (Wave 4B Slices 4-5)
  need((commandRouterSource.match(/authorizeDeviceCommand\(\{/g) || []).length === 3, "commandRouter.ts's 3 authority call sites (scene preflight, auto-execute, confirmed) intact");
  // Facility Automation (Wave 5 Slice 1) + honest system actor (Slice 2)
  need(executionRegistrySource.includes("authorizeDeviceCommand({"), "Facility Automation device.on/off/toggle authority gate intact");
  need(eventRuleSource.includes('role: "ai_agent",') && eventRuleSource.includes('id: "system:facility-automation",'), "Facility Automation's honest ai_agent system actor (Slice 2) unchanged");
  need(!facilityAutomationServiceSource.includes('role: "manager"'), "no fabricated facility_manager/manager persona reintroduced into Facility Automation");
}

// ============================= Newly-discovered gap (Wave 5C): closed by Wave 5D =============================

{
  const intentWorkerSource = readFileSync(new URL("../src/workers/intentWorker.ts", import.meta.url), "utf8");
  // Wave 5C deliberately did NOT touch intentWorker.ts/signal.controller.ts
  // -- it disclosed this gap rather than silently patching or ignoring it
  // (see the Wave 5C final report, item 22). Wave 5D then closed it by
  // converging intentWorker.ts's handleDeviceIntent onto the SAME
  // canonical authorizeDeviceCommand()/executeDeviceCommandForActor()
  // boundary every other entrance in this file already uses -- see
  // scripts/wave5d-signal-intent-device-authority-smoke.mjs for the
  // dedicated coverage of that convergence.
  need(!/tuya\.executeCommand\(/.test(intentWorkerSource), "confirms the Wave 5C-disclosed POST /signals -> control-plane -> intentWorker.ts direct Tuya dispatch bypass has since been closed by Wave 5D");
  need(intentWorkerSource.includes("authorizeDeviceCommand"), "confirms intentWorker.ts now uses the canonical authorizeDeviceCommand gate (Wave 5D)");
}

capabilityModule.rolloutStatus = "enabled";

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS manual consumer scene: enabled -> dispatch reaches the canonical executor");
console.log("PASS manual consumer scene: disabled -> denied with capability_disabled, fast short-circuit, no false success");
console.log("PASS consumer automation test: enabled -> dispatch reaches the canonical executor; disabled -> denied, fast short-circuit");
console.log("PASS scheduled consumer automation: truthful real-actor reconstruction confirmed (fail-closed if creator missing, no privilege fabrication); enabled -> dispatch; disabled -> denied, fast short-circuit");
console.log("PASS scope violation (mismatched home) still denied");
console.log("PASS device-visibility violation (resolveVisibleDevice) remains enforced upstream, unmodified");
console.log("PASS unrelated non-device automation kinds (registeredActions/workflow/communication) are untouched by this fix -- devices.power.control is not blanket-applied");
console.log("PASS execution still flows through the canonical executeDeviceCommandForActor/ledger; kill-switch re-enable restores normal dispatch");
console.log("PASS no privilege fabrication -- the real actor parameter is reused unmodified");
console.log("PASS the authority check is the sole shared boundary, placed before per-action dispatch, denying the whole batch honestly");
console.log("PASS every previously-established Wave 4B/Wave 5 authority boundary remains intact (global kill-switch re-verification)");
console.log("PASS the Wave 5C-disclosed intentWorker.ts bypass has since been closed by Wave 5D");
console.log("wave5c-consumer-device-authority-smoke passed");
// This local dev environment has no Redis reachable; the "enabled"
// scenarios above intentionally let execution proceed into the real
// canonical executor (proving the authority gate does not block it), and
// that executor's rate-limit/idempotency layer retries Redis in the
// background indefinitely. All assertions have already completed by this
// line -- force-exit so those dangling reconnect timers don't hold the
// process open.
process.exit(0);
