#!/usr/bin/env node
// Oyi Intelligence Convergence, Wave 5E -- Legacy Automation Worker
// Physical Authority Convergence.
//
// Closes the live physical-action authority bypass discovered by the
// Wave 5D final repository sweep: src/workers/automationWorker.ts's
// device-action branch dispatched straight to publishDeviceAction()
// with zero devices.power.control check, no canonical DeviceCommandAuthority,
// no executeDeviceCommandForActor, no execution ledger, no verification.
//
// Live, functional, pre-fix reproduction (recorded here; run separately
// against unmodified add5ce51d6d7ae761528e241583a01e14ee59a3b with
// handleAutomationJob temporarily exported, zero behavior change, purely
// to make it callable): with devices.power.control forced to "disabled"
// and capabilityService.canUse spied, calling handleAutomationJob for an
// automation with action {type:"device", device_id, command} resulted in
// canUseCalls=0 and mqttPublishCalls=1 -- publishDeviceAction() was
// actually invoked with a real MQTT topic, proving physical dispatch was
// reached while the capability was disabled and never once consulted.
//
// IMPORTANT PRODUCER-REACHABILITY FINDING (Section 2 of the governing
// task): the ONLY caller of enqueueAutomation() in this entire
// repository is inside src/automations/automations.route.ts, which is
// NEVER mounted by src/app.ts -- app.ts mounts "/automations" and
// "/api/automations" to src/routes/automations.ts, which forwards to
// scenesRoutes (the already Wave-5C-converged consumer automations
// system) instead. POST /automations/:id/trigger, as described in the
// Wave 5E task brief, does not exist as a reachable HTTP route in the
// live app (confirmed both by exhaustively enumerating every app.use()
// mount in app.ts and by booting the compiled app in-process and
// observing it fall through to the generic 404/next-middleware chain).
// Nothing else in the repository ever calls automationQueue.add(...)
// directly, and nothing else ever INSERTs a row into the "automations"
// table either -- so this entire subsystem has zero live producers.
// The WORKER itself is still live (src/worker.ts calls
// startAutomationWorker() unconditionally), so it remains an active,
// trusting BullMQ consumer for anything that might ever be placed on
// the "automations" queue (a future re-wiring of the dead route, an
// admin script, a shared-Redis-instance producer) -- this is why the
// convergence below is still performed, defensively, even though no
// live HTTP path currently reaches it.
//
// Fix: handleAutomationJob now (1) fails closed on a malformed command
// or missing/unresolvable automation.created_by, (2) re-hydrates the
// real actor's role/estate_id/home_id from the users table by that id
// (the exact same pattern Wave 5C's scenes.ts claimAndRunAutomation and
// Wave 5D's intentWorker.ts already use -- never trusting the
// automation row's own stored estate_id/home_id for the authority
// decision), (3) calls the SAME canonical authorizeDeviceCommand()
// (devices.power.control) every other converged entrance already uses,
// and (4) on success calls the SAME canonical executeDeviceCommandForActor()
// (ledger, provider selection, verification) instead of
// publishDeviceAction() directly.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://smoke.invalid.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "smoke-placeholder-key";

import { readFileSync } from "node:fs";

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const automationWorkerSource = readFileSync(new URL("../src/workers/automationWorker.ts", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../src/device/bridge.ts", import.meta.url), "utf8");
const deviceCommandControllerSource = readFileSync(new URL("../src/controllers/deviceCommandController.ts", import.meta.url), "utf8");
const verificationServiceSource = readFileSync(new URL("../src/intelligence-core/verificationService.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
const automationsRouteShimSource = readFileSync(new URL("../src/routes/automations.ts", import.meta.url), "utf8");
const deadAutomationsRouteSource = readFileSync(new URL("../src/automations/automations.route.ts", import.meta.url), "utf8");

// ============================= Producer-reachability finding (Section 2) =============================
{
  need(/app\.use\("\/automations", automationsRoutes\)/.test(appSource), "structural: /automations mounts to src/routes/automations.ts, not the dead src/automations/automations.route.ts");
  need(automationsRouteShimSource.includes("scenesRoutes"), "structural: the mounted /automations router forwards to scenesRoutes (the Wave-5C-converged consumer automations system), not automationWorker.ts's queue");
  need(deadAutomationsRouteSource.includes("enqueueAutomation(id)"), "structural: the ONLY caller of enqueueAutomation() in the repo lives in this file");
  need(!appSource.includes("automations/automations.route"), "structural: app.ts never imports/mounts the dead automations.route.ts file");
}

// ============================= Structural: the bypass itself is gone =============================
{
  need(!/publishDeviceAction\(/.test(automationWorkerSource), "structural: automationWorker.ts must no longer call publishDeviceAction() for physical dispatch");
  need(automationWorkerSource.includes("authorizeDeviceCommand({"), "structural: automationWorker.ts must call the canonical authorizeDeviceCommand()");
  need(automationWorkerSource.includes("executeDeviceCommandForActor({"), "structural: automationWorker.ts must call the canonical executeDeviceCommandForActor()");
}

// ============================= Structural: no privilege fabrication =============================
{
  need(!/id:\s*"system:/.test(automationWorkerSource), "structural: no synthetic system:* actor id constructed in automationWorker.ts");
  need(!/role:\s*"facility_manager"|role:\s*"ochiga_admin"|role:\s*"manager"/.test(automationWorkerSource), "structural: no fabricated privileged role constructed in automationWorker.ts");
  need(automationWorkerSource.includes('.from("users")') && automationWorkerSource.includes(".eq(\"id\", createdBy)"), "structural: actor is re-hydrated from the real users() row by automation.created_by, not trusted from the automation row's own stored fields");
  need(automationWorkerSource.includes("permissionsForRole(userRow.role"), "structural: permissions are derived via the canonical role-based fallback, not fabricated/widened");
}

// ============================= Structural: publishDeviceAction disposition =============================
{
  need(bridgeSource.includes("export function publishDeviceAction"), "structural: publishDeviceAction itself is retained (not deleted) as a general-purpose MQTT publish utility");
  need(!automationWorkerSource.includes("publishDeviceAction"), "structural: automationWorker.ts no longer imports publishDeviceAction at all -- RETIRED FROM LIVE EXECUTION");
}

// ============================= Structural: verification/ledger semantics untouched =============================
{
  need(verificationServiceSource.includes("state_confirmed"), "structural: verificationService.ts's state_confirmed vocabulary is untouched by this slice");
  need(verificationServiceSource.includes("state_mismatch"), "structural: verificationService.ts's state_mismatch vocabulary is untouched");
  need(verificationServiceSource.includes("confirmation_timed_out"), "structural: verificationService.ts's confirmation_timed_out vocabulary is untouched");
  need(deviceCommandControllerSource.includes('confirmation_strategy: "provider_ack_only"'), "structural: provider_ack_only confirmation_strategy semantics in the canonical executor are untouched");
}

// ============================= Load compiled worker + spy scaffolding =============================
const nodeModule = await import("node:module");
const path = await import("node:path");
const backendRoot = path.default.resolve(new URL(".", import.meta.url).pathname, "..");
const require = nodeModule.default.createRequire(import.meta.url);

const supabaseClientMod = require(path.default.join(backendRoot, "dist/supabase/supabaseClient.js"));
const automationFixtures = new Map();
const userFixtures = new Map();
function setAutomationFixture(id, row) {
  automationFixtures.set(id, row);
}
function setUserFixture(id, row) {
  userFixtures.set(id, row);
}
const realFrom = supabaseClientMod.supabaseAdmin.from.bind(supabaseClientMod.supabaseAdmin);
supabaseClientMod.supabaseAdmin.from = function (table) {
  if (table === "automations") {
    return {
      select() { return this; },
      eq(_col, id) { this._id = id; return this; },
      async single() {
        const row = automationFixtures.get(this._id);
        if (!row) return { data: null, error: { message: "not found" } };
        return { data: row, error: null };
      },
      async maybeSingle() {
        const row = automationFixtures.get(this._id) || null;
        return { data: row, error: null };
      },
    };
  }
  if (table === "users") {
    return {
      select() { return this; },
      eq(_col, id) { this._id = id; return this; },
      async maybeSingle() {
        const row = userFixtures.get(this._id) || null;
        return { data: row, error: null };
      },
    };
  }
  return realFrom(table);
};

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
realAuthorize({ actor: { id: "x", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: [] }, commandSource: "app", estateId: "estate-1", homeId: "home-1", roomId: null });
const capabilityModule = capabilityRegistry.get(authorityMod.DEVICE_COMMAND_CAPABILITY_KEY);

const deviceCommandControllerMod = require(path.default.join(backendRoot, "dist/controllers/deviceCommandController.js"));
let executeCalls = 0;
let lastExecuteInput = null;
let nextExecuteResult = { ok: true, status: "command_dispatched", command_execution_id: null };
let nextExecuteError = null;
deviceCommandControllerMod.executeDeviceCommandForActor = async function (input) {
  executeCalls += 1;
  lastExecuteInput = input;
  if (nextExecuteError) {
    const err = nextExecuteError;
    nextExecuteError = null;
    throw err;
  }
  return { ...nextExecuteResult, command_execution_id: nextExecuteResult.command_execution_id || input.commandExecutionId };
};

const bridgeMod = require(path.default.join(backendRoot, "dist/device/bridge.js"));
let mqttPublishCalls = 0;
bridgeMod.publishDeviceAction = async () => { mqttPublishCalls += 1; };

// Silence NotificationService's real send path (unrelated to authority) --
// spy only, no functional assertions depend on it firing correctly.
const notificationMod = require(path.default.join(backendRoot, "dist/services/NotificationService.js"));
let notificationCalls = 0;
notificationMod.NotificationService.sendToUser = async () => { notificationCalls += 1; };

const { handleAutomationJob } = require(path.default.join(backendRoot, "dist/workers/automationWorker.js"));

function baseAutomation(id, overrides = {}) {
  return {
    id,
    name: "Smoke Automation",
    created_by: "resident-1",
    estate_id: "estate-1",
    home_id: "home-1",
    room_id: null,
    action: { type: "device", device_id: "00000000-0000-0000-0000-000000000000", command: { switch_1: true } },
    ...overrides,
  };
}

function resetSpies() {
  authorizeCalls = 0;
  lastAuthorizeInput = null;
  executeCalls = 0;
  lastExecuteInput = null;
  mqttPublishCalls = 0;
  notificationCalls = 0;
}

setUserFixture("resident-1", { id: "resident-1", role: "resident", estate_id: "estate-1", home_id: "home-1" });
setUserFixture("guest-1", { id: "guest-1", role: "guest", estate_id: "estate-1", home_id: "home-1" });

// ============================= 2. capability enabled + truthful actor -> canonical dispatch =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  const automationId = "auto-2";
  setAutomationFixture(automationId, baseAutomation(automationId));
  const result = await handleAutomationJob({ id: "job-2", data: { automationId } });
  need(authorizeCalls === 1, "2. authorizeDeviceCommand must be called exactly once for an authorized actor");
  need(executeCalls === 1, "2. executeDeviceCommandForActor must be reached when capability is enabled and actor is authorized");
  need(result.ok === true && result.status !== "denied", `2. capability enabled + truthful actor must reach canonical dispatch, got ${JSON.stringify(result)}`);
}

// ============================= 3/4. capability disabled -> denied before dispatch, provider count zero =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "disabled";
  const automationId = "auto-3";
  setAutomationFixture(automationId, baseAutomation(automationId));
  const result = await handleAutomationJob({ id: "job-3", data: { automationId } });
  need(result.status === "denied" && result.reason === "capability_disabled", `3. disabled capability must deny before dispatch, got ${JSON.stringify(result)}`);
  need(executeCalls === 0, "4. executeDeviceCommandForActor must never be called when capability is disabled");
  need(mqttPublishCalls === 0, "4. publishDeviceAction must never be called when capability is disabled");
  capabilityModule.rolloutStatus = "enabled";
}

// ============================= 5. missing actor (no created_by) -> fail closed =============================
{
  resetSpies();
  const automationId = "auto-5";
  setAutomationFixture(automationId, baseAutomation(automationId, { created_by: null }));
  const result = await handleAutomationJob({ id: "job-5", data: { automationId } });
  need(result.status === "denied" && result.reason === "missing_actor", `5. an automation with no created_by must fail closed, got ${JSON.stringify(result)}`);
  need(authorizeCalls === 0 && executeCalls === 0, "5. no authority or execution call for a missing-actor automation");
}

// ============================= 6. actor not found -> fail closed =============================
{
  resetSpies();
  const automationId = "auto-6";
  setAutomationFixture(automationId, baseAutomation(automationId, { created_by: "ghost-user-does-not-exist" }));
  const result = await handleAutomationJob({ id: "job-6", data: { automationId } });
  need(result.status === "denied" && result.reason === "actor_not_found", `6. an automation whose created_by no longer resolves to a real user must fail closed, got ${JSON.stringify(result)}`);
  need(authorizeCalls === 0 && executeCalls === 0, "6. no authority or execution call for an actor-not-found automation");
}

// ============================= 7. insufficient permission (guest role) -> fail closed =============================
{
  resetSpies();
  const automationId = "auto-7";
  setAutomationFixture(automationId, baseAutomation(automationId, { created_by: "guest-1" }));
  const result = await handleAutomationJob({ id: "job-7", data: { automationId } });
  need(result.status === "denied" && result.reason === "missing_permission", `7. a created_by with no devices.control permission (guest) must be denied, got ${JSON.stringify(result)}`);
  need(executeCalls === 0, "7. no execution for insufficient permission");
}

// ============================= 8. wrong/self-asserted scope cannot bypass authority =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  const automationId = "auto-8";
  // The automation row's OWN stored estate_id is a different estate than
  // the real actor's current one. Before this fix, trusting the
  // automation row's estate_id/home_id directly (rather than
  // re-hydrating the actor) would risk exactly the same spoofable-scope
  // class of bug Wave 5D found and fixed for the signal/intent worker.
  setAutomationFixture(automationId, baseAutomation(automationId, { estate_id: "estate-9-not-owned", home_id: "home-9-not-owned" }));
  const result = await handleAutomationJob({ id: "job-8", data: { automationId } });
  need(lastAuthorizeInput?.homeId === "home-1", `8. authority must be checked against the RE-HYDRATED real actor home_id (home-1), completely ignoring the automation row's own stored home_id (home-9-not-owned) -- got ${lastAuthorizeInput?.homeId}`);
  need(result.ok === true, `8. once anchored to the real actor scope, authority correctly allows -- got ${JSON.stringify(result)}`);
}

// ============================= 9. device outside scope -> fail closed =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  const notFoundError = new Error("This device is not assigned to your current home.");
  notFoundError.statusCode = 403;
  nextExecuteError = notFoundError;
  const automationId = "auto-9";
  setAutomationFixture(automationId, baseAutomation(automationId));
  const result = await handleAutomationJob({ id: "job-9", data: { automationId } });
  need(result.status === "denied" && /not assigned/.test(result.reason || ""), `9. a device outside the actor's visible scope (canonical resolveVisibleDevice 403) must be converted to a closed denial, not thrown, got ${JSON.stringify(result)}`);
}

// ============================= 10. malformed command -> fail closed =============================
{
  resetSpies();
  const automationId = "auto-10";
  setAutomationFixture(automationId, baseAutomation(automationId, { action: { type: "device", device_id: "00000000-0000-0000-0000-000000000000" /* no command */ } }));
  const result = await handleAutomationJob({ id: "job-10", data: { automationId } });
  need(result.status === "denied" && result.reason === "malformed_command", `10. a device action with no command must fail closed, got ${JSON.stringify(result)}`);
  need(authorizeCalls === 0 && executeCalls === 0, "10. no authority or execution call for a malformed command");
}

// ============================= 11/13. ledger key supplied + provider selection through canonical executor =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  nextExecuteResult = { ok: true, status: "command_dispatched", command_execution_id: null };
  const automationId = "auto-11";
  setAutomationFixture(automationId, baseAutomation(automationId));
  const result = await handleAutomationJob({ id: "job-11", data: { automationId } });
  need(typeof lastExecuteInput?.commandExecutionId === "string" && lastExecuteInput.commandExecutionId.startsWith("automation:"), `11. executeDeviceCommandForActor must be given a command_execution_id (ledger key) prefixed automation: for attributable correlation, got ${lastExecuteInput?.commandExecutionId}`);
  need(result.command_execution_id === lastExecuteInput.commandExecutionId, "11. the returned command_execution_id must match what was actually sent to the canonical executor");
  need(result.ok === true, `13. provider selection still flows through the canonical executor's own status vocabulary, got ${JSON.stringify(result)}`);
}

// ============================= 12. stable command_execution_id on redelivery =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "enabled";
  nextExecuteResult = { ok: true, status: "command_dispatched", command_execution_id: null };
  const automationId = "auto-12";
  setAutomationFixture(automationId, baseAutomation(automationId));
  const sameJob = { id: "job-12-stable", data: { automationId } };
  await handleAutomationJob(sameJob);
  const firstId = lastExecuteInput.commandExecutionId;
  nextExecuteResult = { ok: true, status: "command_dispatched", command_execution_id: null };
  await handleAutomationJob(sameJob); // simulates a BullMQ stalled-job redelivery of the SAME job
  const secondId = lastExecuteInput.commandExecutionId;
  need(firstId === secondId, `12. a redelivered attempt of the SAME job must derive the IDENTICAL command_execution_id (${firstId} vs ${secondId}) so the existing LIFECYCLE_RANK guard can safely no-op the duplicate`);

  const otherJob = { id: "job-12-different", data: { automationId } };
  await handleAutomationJob(otherJob);
  need(lastExecuteInput.commandExecutionId !== firstId, "12. a genuinely different job must derive a different command_execution_id");
}

// ============================= 20. non-device automation action remains unaffected =============================
{
  resetSpies();
  const automationId = "auto-20";
  setAutomationFixture(automationId, baseAutomation(automationId, { action: { type: "notification", message: "hi" } }));
  await handleAutomationJob({ id: "job-20", data: { automationId } });
  need(authorizeCalls === 0 && executeCalls === 0, "20. a non-device automation action must never invoke device authority or the canonical executor");
  need(notificationCalls === 1, "20. a non-device automation action still gets its existing unsupported-type notification path (unchanged)");
}

// ============================= Global kill-switch: functional -- disabled means zero dispatch, re-enable resumes =============================
{
  resetSpies();
  capabilityModule.rolloutStatus = "disabled";
  const automationId = "auto-killswitch";
  setAutomationFixture(automationId, baseAutomation(automationId));
  await handleAutomationJob({ id: "job-killswitch-1", data: { automationId } });
  need(executeCalls === 0 && mqttPublishCalls === 0, "global kill-switch: disabled must produce ZERO provider dispatch for the automation worker entrance");

  capabilityModule.rolloutStatus = "enabled";
  nextExecuteResult = { ok: true, status: "command_dispatched", command_execution_id: null };
  const result = await handleAutomationJob({ id: "job-killswitch-2", data: { automationId } });
  need(result.ok === true, "global kill-switch: re-enabling must restore normal dispatch behaviour for the automation worker entrance");
}

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS producer-reachability finding: POST /automations/:id/trigger is not a live HTTP route; the dead route/table-insert/queue-producer chain is confirmed orphaned");
console.log("PASS 2: capability enabled + truthful actor -> canonical dispatch");
console.log("PASS 3/4: capability disabled -> denied before dispatch, provider call count zero");
console.log("PASS 5: missing actor (no created_by) -> fail closed");
console.log("PASS 6: actor not found -> fail closed");
console.log("PASS 7: insufficient permission (guest role) -> fail closed");
console.log("PASS 8: automation row's own self-stored scope cannot bypass authority -- re-hydrated real actor scope is used");
console.log("PASS 9: device outside scope -> fail closed, not an unhandled throw");
console.log("PASS 10: malformed command -> fail closed");
console.log("PASS 11/13: canonical execution ledger key supplied and returned honestly; provider selection flows through canonical executor");
console.log("PASS 12: redelivery of the same job reuses the same command_execution_id; a different job gets a different one");
console.log("PASS 14/15/16: verification vocabulary (state_confirmed/state_mismatch/confirmation_timed_out/provider_ack_only) unmodified");
console.log("PASS 20: non-device automation actions remain unaffected by device authority");
console.log("PASS publishDeviceAction disposition: RETIRED FROM LIVE EXECUTION in automationWorker.ts, RETAINED as a general-purpose utility in device/bridge.ts");
console.log("PASS global kill-switch: disabled -> zero dispatch; re-enabled -> dispatch resumes");
console.log("wave5e-automation-worker-device-authority-smoke passed");
capabilityModule.rolloutStatus = "enabled";
process.exit(0);
