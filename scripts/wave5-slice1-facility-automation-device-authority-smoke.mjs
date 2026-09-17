#!/usr/bin/env node
// Intelligence Convergence, Wave 5 Slice 1 -- canonical device capability
// authority for Facility Automation. The Wave 5 read-only audit found
// that Facility Automation's only physical-device actions (device.on,
// device.off, device.toggle -- the sole registered action ids that fall
// through executionRegistry.ts's executeRegisteredAction() to
// executeDeviceCommandForActor()) never consulted
// DeviceCommandAuthority.authorizeDeviceCommand() / capabilityService
// .canUse("devices.power.control"), so the canonical rollout/kill-switch
// that already governs direct HTTP, conversational, Spatial, Office
// automation, Watch scene, and commandRouter device_command/run_scene
// had zero effect on Facility Automation.
//
// Facility Automation's own automation policy (resolveAutomationPolicy)
// and human approval (actorMayActOnAction) answer "may this automation
// mode run" and "did a human approve this operation" -- neither is
// capability authority ("is this physical capability allowed right
// now"). This slice inserts the SAME, unmodified canonical gate every
// other Wave 4B path already uses, immediately before physical dispatch,
// using the actor already passed into executeRegisteredAction() (no
// synthetic actor introduced -- that provenance question is Wave 5
// Slice 2's concern) and scope derived from the real resolved device
// (never trusted from the action payload).
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "wave5-slice1-smoke-service-role-key";

import { readFileSync } from "node:fs";

const { authorizeDeviceCommand, DEVICE_COMMAND_CAPABILITY_KEY } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");
const { capabilityRegistry } = await import("../dist/oyi-core/capabilities/CapabilityRegistry.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const registrySource = readFileSync(new URL("../src/intelligence-core/executionRegistry.ts", import.meta.url), "utf8");

const facilityActor = { id: "facility-manager-1", role: "facility_manager", home_id: null, estate_id: "estate-1", permissions: ["devices.control"] };

// ============================= 1. Authorized physical action with capability enabled -> existing executor may run =============================

const allowed = authorizeDeviceCommand({ actor: facilityActor, commandSource: "facility", estateId: "estate-1", homeId: "home-1", roomId: null });
need(allowed.allowed === true, `1. a permitted, in-scope facility actor with the capability enabled must be allowed -- existing device.on/off/toggle execution must keep working, got: ${JSON.stringify(allowed)}`);

// ============================= 2. Kill switch: capability disabled -> executeDeviceCommandForActor/provider never called =============================

const capabilityModule = capabilityRegistry.get(DEVICE_COMMAND_CAPABILITY_KEY);
need(capabilityModule !== null, "2. devices.power.control must be registered after the first authorizeDeviceCommand call");
const originalRolloutStatus = capabilityModule.rolloutStatus;
need(originalRolloutStatus === "enabled", `2. sanity: capability must normally be enabled, got: ${originalRolloutStatus}`);

capabilityModule.rolloutStatus = "disabled";
const deniedByKillSwitch = authorizeDeviceCommand({ actor: facilityActor, commandSource: "facility", estateId: "estate-1", homeId: "home-1", roomId: null });
need(deniedByKillSwitch.allowed === false && deniedByKillSwitch.reason === "capability_disabled", `2. a platform-wide capability kill-switch must deny an otherwise fully-permitted, in-scope Facility Automation device action, got: ${JSON.stringify(deniedByKillSwitch)}`);

// ============================= 3. Fresh execution-time authority: no stored proposal-time decision can override current authority =============================

capabilityModule.rolloutStatus = originalRolloutStatus;
const allowedAfterRestore = authorizeDeviceCommand({ actor: facilityActor, commandSource: "facility", estateId: "estate-1", homeId: "home-1", roomId: null });
need(allowedAfterRestore.allowed === true, "3. restoring the capability's rollout status must restore normal allow behaviour -- proves the decision is freshly re-evaluated on every call, not cached from proposal time");

// ============================= 4. Scope enforcement remains intact =============================

const deniedWrongHome = authorizeDeviceCommand({ actor: { ...facilityActor, home_id: "home-1", role: "resident" }, commandSource: "facility", estateId: "estate-1", homeId: "home-2", roomId: null });
need(deniedWrongHome.allowed === false && deniedWrongHome.reason === "home_scope_not_owned_by_actor", `4. a device belonging to a different home must still be denied for a resident-scoped actor, got: ${JSON.stringify(deniedWrongHome)}`);
const deniedNoScope = authorizeDeviceCommand({ actor: facilityActor, commandSource: "facility", estateId: "estate-1", homeId: null, roomId: null });
// facilityActor has no home_id set and no scope_requirements home check
// failure expected here since homeId is legitimately null for an
// estate-wide facility action AND facilityActor.home_id is also null --
// scope_requirements requires home presence, so this must be denied.
need(deniedNoScope.allowed === false && deniedNoScope.reason === "home_scope_required", `4. missing home scope must still be denied even for a facility actor, got: ${JSON.stringify(deniedNoScope)}`);

// ============================= Structural: placement, all three device actions share one gate, denial semantics =============================

const fnStart = registrySource.indexOf("export async function executeRegisteredAction(");
need(fnStart > 0, "structural: executeRegisteredAction must exist");
const fnBody = registrySource.slice(fnStart);

need((fnBody.match(/authorizeDeviceCommand\(\{/g) || []).length === 1, "5. exactly one authorizeDeviceCommand call site must gate the shared device.on/device.off/device.toggle fallthrough -- all three actions share it since none has its own dedicated branch");
need(registrySource.includes('"device.on" | "device.off" | "device.toggle"'), "5. device.on/device.off/device.toggle remain the only physical-device action ids in the type union");

const availableCheckIdx = fnBody.indexOf("if (!action.available) return");
const resolveDeviceIdx = fnBody.indexOf('const { resolveVisibleDevice } = await import("../services/deviceRuntimeService");');
const deviceResolvedIdx = fnBody.indexOf("const device = await resolveVisibleDevice(input.actor, String(input.entity_id));");
const authorityImportIdx = fnBody.indexOf('const { authorizeDeviceCommand } = await import("../oyi-core/actions/DeviceCommandAuthority");');
const authorityCallIdx = fnBody.indexOf("authorizeDeviceCommand({");
const denyReturnIdx = fnBody.indexOf("if (!authority.allowed) return");
const executeImportIdx = fnBody.indexOf('const { executeDeviceCommandForActor } = await import("../controllers/deviceCommandController");');
const dispatchCallIdx = fnBody.indexOf("const result = await executeDeviceCommandForActor({");

need(availableCheckIdx > 0 && resolveDeviceIdx > availableCheckIdx, "structural: device resolution must happen after the available-action gate, in the shared device fallthrough only");
need(deviceResolvedIdx > resolveDeviceIdx, "structural: the real device must be resolved before any authority decision");
need(authorityImportIdx > deviceResolvedIdx && authorityCallIdx > authorityImportIdx, "authority placement: authorizeDeviceCommand must be called after the real device is resolved (scope is derived from it, not the action payload)");
need(denyReturnIdx > authorityCallIdx && denyReturnIdx < dispatchCallIdx, "9. a denial must return before executeDeviceCommandForActor is ever reached -- provider/Edge must never run on denial");
need(executeImportIdx > authorityCallIdx && dispatchCallIdx > executeImportIdx, "authority placement: executeDeviceCommandForActor must run only after authority is decided");
need(fnBody.slice(authorityCallIdx, dispatchCallIdx).includes("estateId: (device as any).estate_id || input.actor.estate_id || null") && fnBody.slice(authorityCallIdx, dispatchCallIdx).includes("homeId: (device as any).home_id || input.actor.home_id || null"), "6. scope must be derived from the real resolved device, not trusted from the action payload");
need(fnBody.slice(authorityCallIdx, dispatchCallIdx).includes("actor: input.actor,"), "6. the actor already passed into executeRegisteredAction() must be reused -- no synthetic actor introduced in this slice");

// 9. Denial reuses the existing failure/denied result shape -- no new
// approval status invented, no false success/verified state possible
// (the function returns before dispatch, so `result` -- which is what
// feeds ai_execution/verification state downstream -- is never created).
need(fnBody.slice(denyReturnIdx, denyReturnIdx + 120).includes('status: "denied"') && fnBody.slice(denyReturnIdx, denyReturnIdx + 120).includes("authority.reason"), "9. denial must use the existing { ok: false, status: \"denied\", reason } shape, matching sibling denial branches (e.g. scope_mismatch) already in this file, and must preserve the real capability denial reason");
need(fnBody.slice(deviceResolvedIdx, authorityImportIdx).includes('return safeFailure("device_not_found");'), "device-not-found must reuse the existing safeFailure helper, matching sibling lookup-failure branches (visitor_lookup_failed, maintenance_lookup_failed)");

// ============================= 6. Non-device actions are structurally untouched =============================

const visitorBranchIdx = fnBody.indexOf('if (["visitor.approve", "visitor.revoke", "visitor.expire"].includes(action.id)) {');
const maintenanceBranchIdx = fnBody.indexOf('if (["maintenance.complete", "maintenance.cancel", "maintenance.assign"].includes(action.id)) {');
const notificationBranchIdx = fnBody.indexOf('if (action.id === "notification.notify") {');
const nonDeviceBranchesEnd = availableCheckIdx;
need(visitorBranchIdx > 0 && maintenanceBranchIdx > visitorBranchIdx && notificationBranchIdx > maintenanceBranchIdx, "6. sanity: all non-device branches must still exist, unmodified in position");
need(!fnBody.slice(visitorBranchIdx, nonDeviceBranchesEnd).includes("authorizeDeviceCommand"), "6. no non-device registered action branch (visitor/maintenance/maintenance.create/community/security/notification) may reference the new device authority gate");

// Wave 4B boundaries remain untouched by this slice.
const officeExportSource = readFileSync(new URL("../src/routes/officeExport.ts", import.meta.url), "utf8");
const scenesSource = readFileSync(new URL("../src/routes/scenes.ts", import.meta.url), "utf8");
const watchAdapterSource = readFileSync(new URL("../src/services/watchAdapterService.ts", import.meta.url), "utf8");
const commandRouterSource = readFileSync(new URL("../src/ai/commandRouter.ts", import.meta.url), "utf8");
need(officeExportSource.includes("officeDeviceCommandAuthority: true"), "7. Slice 1 (Wave 4B)'s Office automation-test authority boundary must remain intact");
need(scenesSource.includes('officeDeviceCommandAuthority: surface === "office",'), "7. Slice 2 (Wave 4B)'s scheduler authority boundary must remain intact");
need(watchAdapterSource.includes('commandSource: "watch",'), "7. Slice 3 (Wave 4B)'s Watch scene authority boundary must remain intact");
need((commandRouterSource.match(/authorizeDeviceCommand\(\{/g) || []).length === 3, "7. Wave 4B Slices 4-5's commandRouter.ts authority call sites (device_command proposal + confirmed, run_scene preflight helper) must remain exactly as before");

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS a permitted, in-scope facility actor with the capability enabled is allowed -- existing device.on/off/toggle execution keeps working");
console.log("PASS a live capability rollout-status kill-switch denies an otherwise fully-permitted, in-scope Facility Automation device action");
console.log("PASS restoring the capability's rollout status restores normal behaviour -- the decision is freshly re-evaluated on every call, not cached from proposal/approval time");
console.log("PASS wrong/missing home scope remains denied");
console.log("PASS device.on/device.off/device.toggle all share exactly one authority gate, placed after real device resolution and before physical dispatch, using the existing actor and device-derived scope");
console.log("PASS denial returns before executeDeviceCommandForActor/provider, using the existing denied-result shape with the real capability denial reason preserved");
console.log("PASS non-device registered action branches and all Wave 4B authority boundaries remain untouched by this slice");
console.log("wave5-slice1-facility-automation-device-authority-smoke passed");
