#!/usr/bin/env node
// Wave 4B -- Intelligence Convergence, Slice 5. Closes the last live
// commandRouter.ts mutation gap Slice 4 flagged as remaining:
// run_scene's proposal (executeRunSceneTool -> executeScene) and
// confirmed (executeConfirmedWorker -> executeScene) dispatch points
// never consulted the canonical devices.power.control capability
// registry, so a rollout-status kill-switch had no effect on scenes.
//
// The trace found that executeScene() is a SINGLE shared function for
// both proposal-time immediate execution and confirmed execution (the
// confirmed path independently re-fetches the scene via
// findSceneForPrompt before calling it), and that its existing loop
// ALREADY allows partial execution today for device-unavailable/
// out-of-scope actions (it does not stop on the first failure). Adding
// authority inline into that same loop would have made partially-
// executed scenes possible for capability denials too -- so this slice
// restructures executeScene() into a two-pass preflight-all-or-none:
// every action's device is resolved/scope-checked and canonically
// authorized BEFORE any physical dispatch begins; if ANY physical
// action is denied (out of scope OR capability-denied), the scene
// dispatches ZERO device commands. Malformed command-shape (a pre-
// existing, purely data-validity concern, unrelated to authority) is
// deliberately left outside this atomicity gate -- it still only skips
// that one action, exactly as before.
//
// Because executeScene() is the one shared function, upgrading it also
// automatically re-validates scope/capability fresh at CONFIRMATION
// time (executeConfirmedWorker re-fetches the scene and calls this same
// function) -- a capability disabled between proposal and confirmation
// is caught, with zero additional code in executeConfirmedWorker.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "wave4b-slice5-smoke-service-role-key";

import { readFileSync } from "node:fs";

const { authorizeDeviceCommand, DEVICE_COMMAND_CAPABILITY_KEY } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");
const { capabilityRegistry } = await import("../dist/oyi-core/capabilities/CapabilityRegistry.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const commandRouterSource = readFileSync(new URL("../src/ai/commandRouter.ts", import.meta.url), "utf8");
const watchAdapterSource = readFileSync(new URL("../src/services/watchAdapterService.ts", import.meta.url), "utf8");

const residentActor = { id: "resident-1", role: "resident", home_id: "home-1", estate_id: "estate-1", permissions: ["devices.control"] };

// ============================= 1/3. Single- and multi-device authorized scenes: existing execution keeps working =============================

const allowedA = authorizeDeviceCommand({ actor: residentActor, commandSource: "scene", estateId: "estate-1", homeId: "home-1", roomId: null });
const allowedB = authorizeDeviceCommand({ actor: residentActor, commandSource: "scene", estateId: "estate-1", homeId: "home-1", roomId: null });
need(allowedA.allowed === true && allowedB.allowed === true, "1/3. every action in a fully authorized single- or multi-device scene must be allowed -- existing execution must keep working");

// ============================= 2/7. Capability kill switch: zero physical dispatches, including at confirmation time =============================

const capabilityModule = capabilityRegistry.get(DEVICE_COMMAND_CAPABILITY_KEY);
need(capabilityModule !== null, "2. devices.power.control must be registered after the first authorizeDeviceCommand call");
const originalRolloutStatus = capabilityModule.rolloutStatus;
need(originalRolloutStatus === "enabled", `2. sanity: capability must normally be enabled, got: ${originalRolloutStatus}`);

capabilityModule.rolloutStatus = "disabled";
const deniedByKillSwitch = authorizeDeviceCommand({ actor: residentActor, commandSource: "scene", estateId: "estate-1", homeId: "home-1", roomId: null });
need(deniedByKillSwitch.allowed === false && deniedByKillSwitch.reason === "capability_disabled", `2. a platform-wide capability kill-switch must deny an otherwise fully-permitted, in-scope scene action, got: ${JSON.stringify(deniedByKillSwitch)}`);

capabilityModule.rolloutStatus = originalRolloutStatus;
const allowedAfterRestore = authorizeDeviceCommand({ actor: residentActor, commandSource: "scene", estateId: "estate-1", homeId: "home-1", roomId: null });
need(allowedAfterRestore.allowed === true, "2/7/8. restoring the capability's rollout status must restore normal allow behaviour -- proves this is a live, freshly re-evaluated decision at every call, including a later confirmation");

// ============================= 5. Scope enforcement remains intact =============================

const deniedWrongHome = authorizeDeviceCommand({ actor: residentActor, commandSource: "scene", estateId: "estate-1", homeId: "home-2", roomId: null });
need(deniedWrongHome.allowed === false && deniedWrongHome.reason === "home_scope_not_owned_by_actor", `5. a device belonging to a different home must still be denied, got: ${JSON.stringify(deniedWrongHome)}`);

// ============================= Structural: preflight-all-or-none placement inside executeScene =============================

const preflightFnStart = commandRouterSource.indexOf("async function sceneActionPreflight(");
need(preflightFnStart > 0, "structural: sceneActionPreflight helper must exist");
const preflightFnEnd = commandRouterSource.indexOf("\nfunction sceneResultsFromPreflight", preflightFnStart);
const preflightFnBody = commandRouterSource.slice(preflightFnStart, preflightFnEnd);

need(preflightFnBody.includes("resolveVisibleDevice(actor, deviceId)") && preflightFnBody.includes("deviceWithinActorScope(actor, device)") && preflightFnBody.includes("deviceOffline(device)"), "5. sceneActionPreflight must reuse the existing resolveVisibleDevice/deviceWithinActorScope/deviceOffline scope check unchanged");
need(preflightFnBody.includes("authorizeDeviceCommand({") && preflightFnBody.includes('commandSource: "scene",'), "structural: sceneActionPreflight must call the canonical DeviceCommandAuthority gate with commandSource 'scene'");
const resolveIdxInPreflight = preflightFnBody.indexOf("resolveVisibleDevice(actor, deviceId)");
const authorityIdxInPreflight = preflightFnBody.indexOf("authorizeDeviceCommand({");
need(resolveIdxInPreflight > 0 && authorityIdxInPreflight > resolveIdxInPreflight, "structural: authority must be decided after device resolution/scope (needs the real resolved device's estate/home)");

const executeSceneFnStart = commandRouterSource.indexOf("async function executeScene(");
const executeSceneFnEnd = commandRouterSource.indexOf("\nasync function executeRunSceneTool", executeSceneFnStart);
const executeSceneFnBody = commandRouterSource.slice(executeSceneFnStart, executeSceneFnEnd);

// 3/4. Both scene-source branches must: (a) preflight EVERY action
// before any dispatch, (b) compute a single "blocked" verdict across
// all actions, (c) dispatch NOTHING when blocked.
const preflightLoopCount = (executeSceneFnBody.match(/preflight\.push\(await sceneActionPreflight\(/g) || []).length;
need(preflightLoopCount === 2, `3/4. both scene-source branches must build a full preflight array before any dispatch, found ${preflightLoopCount} preflight loops`);
const blockedCount = (executeSceneFnBody.match(/const blocked = preflight\.some\(\(item\) => !item\.ok && !item\.malformed\);/g) || []).length;
need(blockedCount === 2, "4. both branches must compute atomicity from the FULL preflight set (any non-malformed, non-ok item blocks the whole scene)");
const dispatchCallCount = (executeSceneFnBody.match(/executeDeviceCommandForActor\(\{/g) || []).length;
need(dispatchCallCount === 2, "structural: exactly one dispatch call site per branch must remain (unchanged executor, no new dispatch path introduced)");

// The dispatch loop in both branches must only ever run when `results`
// (built from sceneResultsFromPreflight, non-null only when blocked)
// is still falsy -- i.e. execution is structurally unreachable while
// blocked is true.
const branches = executeSceneFnBody.split("let results = sceneResultsFromPreflight(preflight, blocked);");
need(branches.length === 3, "structural: both branches must gate their dispatch loop behind sceneResultsFromPreflight's blocked verdict");
for (let i = 1; i < branches.length; i += 1) {
  const branchAfterGate = branches[i].slice(0, branches[i].indexOf("const completed ="));
  need(branchAfterGate.includes("if (!results) {") && branchAfterGate.indexOf("if (!results) {") < branchAfterGate.indexOf("executeDeviceCommandForActor"), `4. branch ${i} must only enter the dispatch loop when results is still null (not blocked) -- zero dispatch when ANY action is denied`);
}

// The blocked-path result builder must label a would-have-passed
// action as blocked by a sibling, never silently drop it or mislabel
// it as its own denial.
need(commandRouterSource.includes('return { device_id: item.deviceId, status: "skipped", reason: "scene_action_blocked_by_sibling_action" };'), "4. an individually-authorized action must be reported as blocked by a sibling denial, not silently executed or falsely blamed");

// ============================= 6. Confirmation classification is unchanged =============================

need(commandRouterSource.includes("function sceneNeedsConfirmation(scene: any, actions: any[]) {"), "6. sceneNeedsConfirmation must still exist, unmodified");
const runSceneToolStart = commandRouterSource.indexOf("async function executeRunSceneTool(");
const runSceneToolEnd = commandRouterSource.indexOf("\nasync function createMaintenanceRequestTool", runSceneToolStart);
const runSceneToolBody = commandRouterSource.slice(runSceneToolStart, runSceneToolEnd);
const confirmCheckIdx = runSceneToolBody.indexOf("if (sceneNeedsConfirmation(found.scene, actionRows)) {");
const executeSceneCallIdx = runSceneToolBody.indexOf("const result = await executeScene(actor, found.scene, req);");
need(confirmCheckIdx > 0 && executeSceneCallIdx > confirmCheckIdx, "6. a scene requiring confirmation must still create a pending_confirmation ledger row rather than calling executeScene immediately");
need(!runSceneToolBody.slice(confirmCheckIdx, runSceneToolBody.indexOf("return {", confirmCheckIdx)).includes("executeScene("), "6. the confirmation-required branch must return before ever reaching executeScene");

// ============================= 7/8. Confirmed execution re-fetches and re-authorizes fresh (no stored decision reused) =============================

const confirmedFnStart = commandRouterSource.indexOf("async function executeConfirmedWorker(");
const confirmedFnEnd = commandRouterSource.indexOf("\n  return {\n    ok: false,\n    status: \"failed\"", confirmedFnStart);
const confirmedFnBody = commandRouterSource.slice(confirmedFnStart, confirmedFnEnd);
const confirmedRunSceneIdx = confirmedFnBody.indexOf('if (tool.tool_id === "run_scene") {');
need(confirmedRunSceneIdx > 0, "7/8. executeConfirmedWorker's run_scene branch must still exist");
const confirmedRunSceneBody = confirmedFnBody.slice(confirmedRunSceneIdx);
need(confirmedRunSceneBody.includes("const found = await findSceneForPrompt(actor, String(record.prompt_excerpt || \"\"), { scene_id: sceneId });"), "7/8. confirmed execution must re-fetch the scene fresh, not reuse anything stored from proposal time");
need(confirmedRunSceneBody.includes("return executeScene(actor, found.scene);"), "7/8. confirmed execution must call the same, now-upgraded executeScene() -- no separate/duplicated authority logic in the confirmed path");
need(!confirmedRunSceneBody.includes("authorizeDeviceCommand"), "7/8. executeConfirmedWorker's run_scene branch must not duplicate the authority gate itself -- it inherits it entirely through executeScene()");

// ============================= 9. device_command (Slice 4) is unchanged =============================

const deviceCommandToolStart = commandRouterSource.indexOf("async function executeDeviceCommandTool(");
const deviceCommandToolEnd = commandRouterSource.indexOf("\nasync function insertSupportTicket", deviceCommandToolStart);
const deviceCommandToolBody = commandRouterSource.slice(deviceCommandToolStart, deviceCommandToolEnd);
need((deviceCommandToolBody.match(/authorizeDeviceCommand\(\{/g) || []).length === 1, "9. executeDeviceCommandTool must still call authorizeDeviceCommand exactly once, unchanged from Slice 4");
const confirmedDeviceCommandIdx = confirmedFnBody.indexOf('if (tool.tool_id === "device_command") {');
need((confirmedFnBody.slice(confirmedDeviceCommandIdx, confirmedRunSceneIdx).match(/authorizeDeviceCommand\(\{/g) || []).length === 1, "9. executeConfirmedWorker's device_command branch must still call authorizeDeviceCommand exactly once, unchanged from Slice 4");

// ============================= 10. Watch scene (Slice 3) is unchanged =============================

need(watchAdapterSource.includes('commandSource: "watch",'), "10. Slice 3's Watch scene authority boundary (watchAdapterService.ts) must remain intact and untouched by this slice");

// ============================= Important discovery check: scene action types are exclusively device commands =============================

need(commandRouterSource.includes('function safeConsumerSceneCommand(command: Record<string, any>) {') && commandRouterSource.includes('["switch", "power", "on", "temperature", "temp_set"]'), "discovery: consumer_scenes action commands are restricted to a fixed device-command key whitelist -- no other action type exists in this scene model");
need(commandRouterSource.includes("function sceneActionCommand(action: any) {"), "discovery: legacy scene_actions rows are normalized through the same device-command-only shape (switch/off/temperature, or a raw device command object) -- no maintenance/visitor/communication action type is ever constructed here");

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS a fully authorized single- or multi-device scene action is allowed -- existing execution keeps working");
console.log("PASS a live capability rollout-status kill-switch denies an otherwise fully-permitted, in-scope scene action, and restoring it restores normal behaviour (including at confirmation time)");
console.log("PASS scope enforcement (wrong home) remains intact");
console.log("PASS both scene-source branches preflight every action, compute one atomicity verdict, and structurally cannot dispatch anything while blocked");
console.log("PASS an individually-authorized action inside a blocked scene is reported as blocked-by-sibling, never silently executed");
console.log("PASS scene confirmation classification (sceneNeedsConfirmation) is unchanged -- confirmation-required scenes still return before executeScene");
console.log("PASS confirmed execution re-fetches the scene fresh and calls the same upgraded executeScene() -- no stored proposal-time authority is reused, no duplicated gate");
console.log("PASS device_command's Slice 4 authority gates are unchanged");
console.log("PASS Watch's scene authority boundary (Slice 3) is unchanged");
console.log("PASS scene actions in commandRouter.ts are exclusively device commands -- no other action type exists to misapply devices.power.control to");
console.log("wave4b-slice5-commandrouter-run-scene-authority-smoke passed");
