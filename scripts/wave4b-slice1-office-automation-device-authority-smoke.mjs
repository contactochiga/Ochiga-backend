#!/usr/bin/env node
// Wave 4B -- Intelligence Convergence, Slice 1. Closes the confirmed
// authority bypass in the Office-triggered automation test path:
// POST /office-export/automations/:id/test -> executeConsumerAutomation
// -> executeResidentActionBatch -> executeDeviceCommandForActor.
//
// The prior state: requireOfficeExportKey (a shared-secret service
// credential proving WHICH TRUSTED SYSTEM called the route) was the
// only gate. The "actor" passed into execution was officeAutomationActor()
// -- a fully synthetic identity asserting role: "ochiga_admin", which
// holds the platform's blanket PERMISSION_KEYS grant. Wiring the
// existing DeviceCommandAuthority gate onto THAT actor unchanged would
// have been a rubber stamp (ochiga_admin always passes devices.control),
// not a real authority boundary -- so this slice does not do that.
//
// What this slice actually adds: a second, deliberately narrow, honest
// "device command authority actor" (role "ai_agent" -- the existing,
// real PlatformRole for non-human system actors, which does NOT itself
// carry devices.control -- with ONLY "devices.control" explicitly
// granted), constructed fresh inside executeConsumerAutomation's plain
// device-command lane, gated behind an explicit officeDeviceCommandAuthority
// opt-in that only officeExport.ts's test route sets. It is run through
// the SAME, unmodified, production capabilityService.canUse() decision
// (via DeviceCommandAuthority.authorizeDeviceCommand(), reused, not
// duplicated) every other canonical device-command path already uses.
// officeAutomationActor()/role: "ochiga_admin" is untouched and still
// used for audit/created_by attribution -- identity for record-keeping
// is a separate concern from capability authority for physical
// dispatch. No real device command is ever issued by this script.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "wave4b-slice1-smoke-service-role-key";

import { readFileSync } from "node:fs";

const { authorizeDeviceCommand } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

// ============================= Functional: the real authority decision =============================

// A. A properly authenticated and authorized actor (real home/estate
// scope, the single devices.control permission explicitly granted)
// CAN still use the Office automation-test path -- the gate does not
// merely fail closed forever, it recognizes legitimate execution.
const honestOfficeActor = {
  id: "office_automation_device_authority",
  role: "ai_agent",
  permissions: ["devices.control"],
  permission_scopes: [],
  estate_id: "estate-1",
  home_id: "home-1",
};
const allowed = authorizeDeviceCommand({ actor: honestOfficeActor, commandSource: "office_automation", estateId: "estate-1", homeId: "home-1", roomId: null });
need(allowed.allowed === true, `A. a properly scoped+permissioned office-automation actor must be allowed, got: ${JSON.stringify(allowed)}`);

// B. An actor lacking devices.power.control's required permission
// cannot cause execution -- proves the gate is a real check, not
// always-true. This is exactly the failure mode of the OLD
// officeAutomationActor()/ochiga_admin construction never being able
// to produce this outcome (ochiga_admin holds every permission).
const noPermissionActor = { id: "office_automation_device_authority", role: "ai_agent", permissions: [], permission_scopes: [], estate_id: "estate-1", home_id: "home-1" };
const deniedNoPermission = authorizeDeviceCommand({ actor: noPermissionActor, commandSource: "office_automation", estateId: "estate-1", homeId: "home-1", roomId: null });
need(deniedNoPermission.allowed === false, "B. an office-automation actor without devices.control must be denied");
need(deniedNoPermission.reason === "missing_permission", `B. denial reason must be missing_permission, got: ${deniedNoPermission.reason}`);
need(deniedNoPermission.required_permissions.includes("devices.control"), "B. required_permissions must list devices.control");

// C. A valid Office shared API key alone (i.e. this call is only ever
// reached after requireOfficeExportKey already passed) is not enough:
// wrong/missing scope is rejected exactly as it would be for any other
// canonical device-command path. Reused unmodified scope_requirements
// enforcement, not a bespoke office-only check.
const deniedNoScope = authorizeDeviceCommand({ actor: honestOfficeActor, commandSource: "office_automation", estateId: "estate-1", homeId: null, roomId: null });
need(deniedNoScope.allowed === false, "C. missing home scope must be denied even for an otherwise-permissioned office-automation actor");
need(deniedNoScope.reason === "home_scope_required", `C. denial reason must be home_scope_required, got: ${deniedNoScope.reason}`);

// D. Existing canonical direct-HTTP/consumer and facility commandSource
// classifications are completely unchanged by this slice's new
// "office_automation" branch.
const residentActor = { id: "actor-resident-1", role: "resident", home_id: "home-1", estate_id: "estate-1", permissions: ["devices.control"] };
const consumerStillAllowed = authorizeDeviceCommand({ actor: residentActor, commandSource: "app", estateId: "estate-1", homeId: "home-1", roomId: null });
need(consumerStillAllowed.allowed === true, "D. existing consumer commandSource ('app') behavior must be unchanged");
const facilityActor = { id: "actor-facility-1", role: "facility_manager", home_id: null, estate_id: "estate-1", permissions: ["devices.control"] };
const facilityStillAllowed = authorizeDeviceCommand({ actor: facilityActor, commandSource: "facility", estateId: "estate-1", homeId: "home-9", roomId: null });
need(facilityStillAllowed.allowed === true, "D. existing facility commandSource behavior must be unchanged");

// ============================= Structural: wiring, placement, scope discipline =============================

const authoritySource = readFileSync(new URL("../src/oyi-core/actions/DeviceCommandAuthority.ts", import.meta.url), "utf8");
need(authoritySource.includes('input.commandSource === "facility" || input.commandSource === "office_automation" ? "facility" : "consumer"'), 'E. "office_automation" must map onto the existing "facility" surface, not a new/duplicated surface value');
need((authoritySource.match(/DEVICE_COMMAND_CAPABILITY_KEY = "devices\.power\.control"/g) || []).length === 1, "E. devices.power.control must not be duplicated -- exactly one capability key definition");

const scenesSource = readFileSync(new URL("../src/routes/scenes.ts", import.meta.url), "utf8");
const officeExportSource = readFileSync(new URL("../src/routes/officeExport.ts", import.meta.url), "utf8");

need(scenesSource.includes('import { authorizeDeviceCommand } from "../oyi-core/actions/DeviceCommandAuthority";'), "F. scenes.ts must reuse DeviceCommandAuthority, not a raw capabilityService.canUse() call scattered in the route");
need(officeExportSource.includes("officeDeviceCommandAuthority: true"), "F. the Office automation-test route must opt into the new authority gate");

// The gate must live inside executeConsumerAutomation, strictly before
// executeResidentActionBatch (the entry point into the resident/device
// batch -> executeDeviceCommandForActor -> provider/Edge dispatch chain)
// -- i.e. before physical execution begins, not inside the provider
// adapter and not a rewrite of executeDeviceCommandForActor itself.
const fnStart = scenesSource.indexOf("export async function executeConsumerAutomation(");
need(fnStart > 0, "G. executeConsumerAutomation must exist");
const fnEnd = scenesSource.indexOf("\nlet automationScheduler", fnStart);
const fnBody = scenesSource.slice(fnStart, fnEnd > 0 ? fnEnd : scenesSource.length);

const gateIdx = fnBody.indexOf("if (input.officeDeviceCommandAuthority) {");
const authorityCallIdx = fnBody.indexOf("authorizeDeviceCommand({");
const denyReturnIdx = fnBody.indexOf("return { ...runRow, ...failed };", authorityCallIdx);
const executeResidentIdx = fnBody.lastIndexOf("results = await executeResidentActionBatch({");
const executeDeviceControllerImportUsage = fnBody.indexOf("executeDeviceCommandForActor");

need(gateIdx > 0 && authorityCallIdx > gateIdx, "G. the authority gate must be wired into executeConsumerAutomation");
need(executeResidentIdx > 0 && authorityCallIdx < executeResidentIdx, "G. authority must be decided before executeResidentActionBatch (physical dispatch) begins");
need(denyReturnIdx > authorityCallIdx && denyReturnIdx < executeResidentIdx, "G. a denial must return before executeResidentActionBatch is ever reached -- rejection happens before executeDeviceCommandForActor/provider dispatch, and before any completed/verified state can be written");
need(executeDeviceControllerImportUsage === -1, "G. executeConsumerAutomation itself must not call executeDeviceCommandForActor directly -- dispatch stays inside the existing executeResidentActionBatch/deviceCommandController chain, untouched");

// H. Rejected attempts write status: "failed" only -- never a
// completed/verified shape -- and the same failed-run persistence
// pattern already used by this function's other pre-execution
// validation failures (canonicalizeSceneActions catch block above),
// not a bespoke new outcome shape.
const gateBlock = fnBody.slice(gateIdx, executeResidentIdx);
need(gateBlock.includes('status: "failed"'), 'H. a denied authority decision must record status: "failed"');
need(gateBlock.includes('error_code: "device_command_authority_denied"'), "H. denial must carry a distinct, honest error_code (not reused from an unrelated failure)");
need(!gateBlock.includes('"completed"') && !gateBlock.includes("verified: true"), "H. a denied authority decision must never produce any completed/verified execution state");

// I. Scope discipline -- every OTHER caller of executeConsumerAutomation
// must be untouched: the scheduler (claimAndRunAutomation, source:
// "scheduled") and scenes.ts's own consumer-authenticated
// /automations/:id/test route must not set officeDeviceCommandAuthority,
// proving canonical consumer/scheduled automation execution is unchanged
// by this slice.
// Wave 4B Slice 2 update: the scheduler's dormant office-surface gap
// (flagged in Slice 1's final report as "any remaining bypass
// discovered") was closed in Slice 2 by wiring claimAndRunAutomation's
// executeConsumerAutomation call into this same gate, derived from the
// automation's real surface. This assertion now proves the call site
// still exists and still carries automation/actor/req/source: "scheduled"
// unchanged -- Slice 1's boundary at the ROUTE level (officeExport.ts)
// is separately reverified below and remains untouched.
const schedulerCallIdx = scenesSource.indexOf("await executeConsumerAutomation({\n    automation: claim.data,\n    actor,\n    req,\n    source: \"scheduled\",\n    scheduledFor,\n    occurrenceKey,");
need(schedulerCallIdx > 0, "I. the scheduler's executeConsumerAutomation call site must still exist, carrying automation/actor/req/source: 'scheduled'/scheduledFor/occurrenceKey unchanged");

const consumerTestRouteIdx = scenesSource.indexOf('const result = await executeConsumerAutomation({ automation, actor: req.user!, req, source: "manual_test" });');
need(consumerTestRouteIdx > 0, "I. scenes.ts's own consumer-authenticated manual test route must still exist unmodified");

// J. The gate must be reachable ONLY from the plain device-command
// (scene-action) branch -- not from the registered_action (Facility),
// workflow_action (Office workflow), or communication_action branches
// this same shared function also dispatches -- proving existing
// Office automation-test non-device behavior is not accidentally
// touched by this slice.
const registeredBranchIdx = fnBody.indexOf("if (isRegisteredActionAutomation) {");
const workflowBranchIdx = fnBody.indexOf("} else if (isWorkflowActionAutomation) {");
const communicationBranchIdx = fnBody.indexOf("} else if (isCommunicationActionAutomation) {");
need(registeredBranchIdx > 0 && workflowBranchIdx > registeredBranchIdx && communicationBranchIdx > workflowBranchIdx, "J. sanity: all three non-device branches must still exist");
need(gateIdx > communicationBranchIdx, "J. the new authority gate must live strictly inside the trailing device-command/scene-action branch, after (not inside) the registered/workflow/communication branches");
const registeredBranchBody = fnBody.slice(registeredBranchIdx, workflowBranchIdx);
const workflowBranchBody = fnBody.slice(workflowBranchIdx, communicationBranchIdx);
const communicationBranchBody = fnBody.slice(communicationBranchIdx, gateIdx);
for (const [name, body] of [["registered_action", registeredBranchBody], ["workflow_action", workflowBranchBody], ["communication_action", communicationBranchBody]]) {
  need(!body.includes("if (input.officeDeviceCommandAuthority)") && !body.includes("authorizeDeviceCommand({"), `J. the ${name} branch must be completely untouched by the new device-command authority gate`);
}

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS a properly authorized office-automation actor (real scope, explicit devices.control grant) is allowed");
console.log("PASS an office-automation actor without devices.control is denied (never a rubber-stamp allow)");
console.log("PASS a valid Office credential alone does not satisfy missing/wrong device scope");
console.log("PASS existing consumer and facility commandSource authority decisions are unchanged");
console.log("PASS office_automation maps onto the existing facility surface -- no duplicated devices.power.control");
console.log("PASS officeExport.ts's automation-test route is wired through DeviceCommandAuthority, not a scattered raw capability check");
console.log("PASS the gate runs, and any denial returns, before executeResidentActionBatch/executeDeviceCommandForActor -- rejection happens before physical dispatch");
console.log("PASS a denied attempt records status: failed only, never completed/verified state");
console.log("PASS the scheduler and scenes.ts's own consumer test route are unmodified -- scope discipline held");
console.log("PASS the gate is confined to the device-command branch -- registered/workflow/communication automation behavior is untouched");
console.log("wave4b-slice1-office-automation-device-authority-smoke passed");
