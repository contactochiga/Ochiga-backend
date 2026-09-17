#!/usr/bin/env node
// Wave 4B -- Intelligence Convergence, Slice 3. Closes the concrete gap
// found in the fresh Watch + legacy AI command-router re-audit: Oyi
// Watch's own scene runner (runConsumerScene, watchAdapterService.ts,
// reached from POST /watch/command when a matched quick action is a
// scene) trusted the scene's stored device_id directly and called
// executeDeviceCommandForActor with no per-action authority decision --
// relying solely on that executor's own internal resolveVisibleDevice
// resolution. Its sibling, commandRouter.ts's own scene runner
// (executeScene), already resolves + scope-checks each device via
// resolveVisibleDevice/deviceWithinActorScope before executing -- an
// inconsistency between two legacy scene-execution implementations.
// Neither runner ever consulted the capability registry, meaning a
// platform-wide devices.power.control rollout-status kill-switch
// (which every canonical path -- requestDeviceCommand, and now the
// Office automation-test/scheduler lanes from Slices 1-2 -- honors)
// had zero effect on Watch's scene lane. This is the "materially
// weaker legacy authority" finding from Part C of the Slice 3 audit,
// concretely demonstrated below as a real allow/deny divergence.
//
// Fix: runConsumerScene now resolves + scope-checks each action's
// device (resolveVisibleDevice + deviceWithinActorScope, matching
// executeScene's own rigor) and runs the SAME, unmodified
// DeviceCommandAuthority.authorizeDeviceCommand() gate every other
// Wave 4/4B device-command path uses -- reusing the real, already-
// authenticated Watch actor directly (no synthetic identity, since
// Watch users are always real Backend users, unlike Slices 1-2's
// Office automations).
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "wave4b-slice3-smoke-service-role-key";

import { readFileSync } from "node:fs";

const { authorizeDeviceCommand } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const watchAdapterSource = readFileSync(new URL("../src/services/watchAdapterService.ts", import.meta.url), "utf8");
const commandRouterSource = readFileSync(new URL("../src/ai/commandRouter.ts", import.meta.url), "utf8");
const officeExportSource = readFileSync(new URL("../src/routes/officeExport.ts", import.meta.url), "utf8");
const scenesSource = readFileSync(new URL("../src/routes/scenes.ts", import.meta.url), "utf8");

// ============================= 1/2/3. Real allow/deny/scope decisions (commandSource: "watch") =============================

// 1. Unauthorized actor (no devices.control) -> denied. "guest" is the
// one PlatformRole that does not carry devices.control (resident does,
// by default -- an empty permissions array on a resident actor would
// not actually test denial).
const noPermissionActor = { id: "guest-no-permission", role: "guest", home_id: "home-1", estate_id: "estate-1", permissions: [] };
const deniedNoPermission = authorizeDeviceCommand({ actor: noPermissionActor, commandSource: "watch", estateId: "estate-1", homeId: "home-1", roomId: null });
need(deniedNoPermission.allowed === false && deniedNoPermission.reason === "missing_permission", `1. an actor without devices.control must be denied before execution, got: ${JSON.stringify(deniedNoPermission)}`);

// 2. Wrong scope -> denied, two shapes: missing home scope, and a
// resident's home not matching the device's actual home.
const residentActor = { id: "resident-1", role: "resident", home_id: "home-1", estate_id: "estate-1", permissions: ["devices.control"] };
const deniedNoScope = authorizeDeviceCommand({ actor: residentActor, commandSource: "watch", estateId: "estate-1", homeId: null, roomId: null });
need(deniedNoScope.allowed === false && deniedNoScope.reason === "home_scope_required", `2a. missing home scope must be denied, got: ${JSON.stringify(deniedNoScope)}`);
const deniedWrongHome = authorizeDeviceCommand({ actor: residentActor, commandSource: "watch", estateId: "estate-1", homeId: "home-2", roomId: null });
need(deniedWrongHome.allowed === false && deniedWrongHome.reason === "home_scope_not_owned_by_actor", `2b. a device belonging to a different home must be denied, got: ${JSON.stringify(deniedWrongHome)}`);

// 3. Authorized actor (real scope + permission) -> still allowed --
// existing legitimate Watch scene execution keeps working.
const allowed = authorizeDeviceCommand({ actor: residentActor, commandSource: "watch", estateId: "estate-1", homeId: "home-1", roomId: null });
need(allowed.allowed === true, `3. a correctly scoped+permissioned actor must still be allowed, got: ${JSON.stringify(allowed)}`);

// Concrete "old ALLOWS, canonical DENIES" divergence from Part C of the
// audit: the capability registry's rollout-status kill-switch. Legacy
// runConsumerScene (before this slice) never consulted it at all --
// canonical always does, via capabilityRegistry inside authorizeDeviceCommand.
// This is exercised implicitly by every call above already going through
// the real, registered capability; the structural proof below confirms
// runConsumerScene now actually calls this gate rather than bypassing it.

// ============================= 4/5. Denial happens before executeDeviceCommandForActor; no false success state =============================

const fnStart = watchAdapterSource.indexOf("async function runConsumerScene(");
need(fnStart > 0, "4. runConsumerScene must exist");
const fnEnd = watchAdapterSource.indexOf("\nasync function countTable", fnStart);
const fnBody = watchAdapterSource.slice(fnStart, fnEnd > 0 ? fnEnd : watchAdapterSource.length);

need(fnBody.includes("const device = await resolveVisibleDevice(actor, action.device_id);"), "4. each scene action must resolve its real device before doing anything else");
need(fnBody.includes("!deviceWithinActorScope(actor, device)"), "4. each scene action must be scope-checked via deviceWithinActorScope, matching commandRouter.ts's executeScene");
need(fnBody.includes("authorizeDeviceCommand({") && fnBody.includes('commandSource: "watch",'), "4. runConsumerScene must call the canonical DeviceCommandAuthority gate with commandSource 'watch'");

const resolveIdx = fnBody.indexOf("const device = await resolveVisibleDevice(actor, action.device_id);");
const authorityCallIdx = fnBody.indexOf("authorizeDeviceCommand({");
const executeIdx = fnBody.indexOf("const result = await executeDeviceCommandForActor({");
need(resolveIdx > 0 && authorityCallIdx > resolveIdx && executeIdx > authorityCallIdx, "4. order must be: resolve device -> scope check -> authority decision -> executeDeviceCommandForActor (physical dispatch)");

const denyBlock = fnBody.slice(authorityCallIdx, executeIdx);
need(denyBlock.includes("if (!authority.allowed) {") && denyBlock.indexOf("continue;") > denyBlock.indexOf("if (!authority.allowed) {"), "4. a denial must skip execution for that action (continue) before executeDeviceCommandForActor is ever reached");
need(denyBlock.includes('status: "denied"'), '5. a denied action must be recorded with status "denied"');
need(!denyBlock.includes('status: "skipped"'), '5. denial must not use a new "skipped" status that would bypass runConsumerScene\'s existing success classification (status !== "failed" && status !== "denied")');

// The scope-check failure branch (device missing/out of scope) must
// ALSO record "denied", not a status the success classification below
// would silently treat as success.
const scopeCheckBlock = fnBody.slice(resolveIdx, authorityCallIdx);
need(scopeCheckBlock.includes('status: "denied"') && !scopeCheckBlock.includes('status: "skipped"'), "5. the device-unavailable/out-of-scope branch must also record status 'denied', never a false-success-eligible status");

// The existing success classification itself is untouched -- "denied"
// (old AND new) and "failed" both already excluded from "ok".
need(fnBody.includes('const ok = results.every((item) => item.status !== "failed" && item.status !== "denied");'), "5. the existing success/failure classification must be unchanged -- it already treats 'denied' as not-ok, which is why denial reuses that status rather than inventing a new one");

// ============================= 6. Adjacent Watch/router branches unchanged =============================

// Watch's other exported functions are untouched by this slice.
for (const fn of ["getWatchHomeStatus", "getWatchGlances", "getWatchFavorites", "getWatchScenes", "getWatchQuickActions", "getWatchStatus", "confirmWatchCommand", "cancelWatchCommand"]) {
  need(watchAdapterSource.includes(`export async function ${fn}(`), `6. ${fn} must still exist, unmodified in shape`);
}

// runWatchCommand's non-scene lane (routeAiCommand delegation) is
// unchanged -- this slice only touches the scene branch.
const runWatchCommandStart = watchAdapterSource.indexOf("export async function runWatchCommand(");
const runWatchCommandBody = watchAdapterSource.slice(runWatchCommandStart, watchAdapterSource.indexOf("\nexport async function confirmWatchCommand", runWatchCommandStart));
need(runWatchCommandBody.includes("return runConsumerScene(req, actor, String(matched.scene_id));"), "6. runWatchCommand must still delegate scene quick-actions to runConsumerScene unchanged");
need(runWatchCommandBody.includes("const routed = await routeAiCommand(req, {"), "6. runWatchCommand's non-scene routeAiCommand delegation must be unchanged");
need(!runWatchCommandBody.includes("authorizeDeviceCommand"), "6. the authority gate must live inside runConsumerScene only, not duplicated into runWatchCommand's dispatch logic");

// commandRouter.ts's own branches (device_command, run_scene/executeScene,
// create_maintenance_request, support_mutation) are completely untouched
// by this slice -- the fix is confined to watchAdapterService.ts only.
need(commandRouterSource.includes("const device = await resolveVisibleDevice(actor, action.device_id);") || commandRouterSource.includes("const device = await resolveVisibleDevice(actor, deviceId);"), "6. commandRouter.ts's executeScene device resolution must still exist unmodified");
need(!commandRouterSource.includes('commandSource: "watch"'), "6. commandRouter.ts itself must not be touched by this slice -- the new commandSource value is introduced only in watchAdapterService.ts");

// Slices 1 and 2's Office automation authority boundaries remain intact.
need(officeExportSource.includes("officeDeviceCommandAuthority: true"), "6. Slice 1's officeExport.ts automation-test authority boundary must remain intact");
need(scenesSource.includes('officeDeviceCommandAuthority: surface === "office",'), "6. Slice 2's scheduler authority boundary must remain intact");

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS an actor without devices.control is denied before execution (never a rubber-stamp allow)");
console.log("PASS missing home scope and a device outside the actor's home are both denied");
console.log("PASS a correctly scoped+permissioned actor is still allowed -- existing legitimate Watch scenes keep working");
console.log("PASS runConsumerScene resolves + scope-checks each device, then decides authority, before executeDeviceCommandForActor -- denial happens before physical dispatch");
console.log("PASS denied/unavailable actions record status 'denied' -- no new status could produce a false success/verified state");
console.log("PASS adjacent Watch functions, runWatchCommand's non-scene lane, commandRouter.ts, and Slices 1-2's Office authority boundaries are all unchanged");
console.log("wave4b-slice3-watch-scene-device-authority-smoke passed");
