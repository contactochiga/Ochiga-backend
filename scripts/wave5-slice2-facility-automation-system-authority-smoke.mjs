#!/usr/bin/env node
// Intelligence Convergence, Wave 5 Slice 2 -- replace the fabricated
// Facility Automation authority subject. The auto_allowed event-rule
// path previously constructed { id: "system:automation", role: "manager" }
// -- AuthUser's legacy alias for the real PlatformRole facility_manager --
// solely to inherit that role's blanket permission set so some
// registered action would pass. That is the automation runtime
// pretending to be a human facility manager: auto_allowed must mean
// "this action has explicitly been authorized for autonomous execution
// under this estate's automation policy," never "pretend a human
// approved it."
//
// Fix: automationSystemActorFor() (src/services/facilityAutomationEventRuleService.ts)
// now constructs an honest, non-human actor reusing the real,
// already-existing "ai_agent" PlatformRole (the same pattern Wave 4B
// Slices 1-2 already established for the analogous Office automation-
// runtime identity problem) -- a role whose own role-derived permission
// set is deliberately narrow and read-only, so simply holding it grants
// nothing. The actor's ONLY authority is a single, explicit permission
// (REQUIRED_PERMISSION[action_id], via automationPolicyResolver.ts's
// already-exported registeredActionRequiredPermission), scoped to the
// one specific action about to run -- never a blanket role grant, never
// cascading to any other action. automationSystemActorMayActOnAction()
// checks this via the same canonical hasPermission() function
// actorMayActOnAction() (the human path) already wraps. If the
// automation principal is not explicitly authorized, the proposal is
// simply left pending_approval for a real human to review -- no
// authority is fabricated, no new terminal status invented.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "wave5-slice2-smoke-service-role-key";

import { readFileSync } from "node:fs";

const { hasPermission } = await import("../dist/core/foundation/permissions.js");
const { registeredActionRequiredPermission } = await import("../dist/services/automationPolicyResolver.js");
const { authorizeDeviceCommand, DEVICE_COMMAND_CAPABILITY_KEY } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");
const { capabilityRegistry } = await import("../dist/oyi-core/capabilities/CapabilityRegistry.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const eventRuleSource = readFileSync(new URL("../src/services/facilityAutomationEventRuleService.ts", import.meta.url), "utf8");
const facilityAutomationServiceSource = readFileSync(new URL("../src/services/facilityAutomationService.ts", import.meta.url), "utf8");
const automationPolicyResolverSource = readFileSync(new URL("../src/services/automationPolicyResolver.ts", import.meta.url), "utf8");

// ============================= 1. No more fabricated facility_manager/manager =============================

need(!eventRuleSource.includes('return { id: "system:automation", role: "manager", estate_id: estateId };'), "1. the fabricated facility_manager/manager persona (role: \"manager\") must no longer be constructed anywhere in this file");
need(!eventRuleSource.includes("function systemActor(estateId: string): AuthUser {"), "1. the old systemActor() function must be replaced, not merely renamed to still produce a human-role identity");
need(eventRuleSource.includes('role: "ai_agent",'), "1. the automation actor must use the real, existing, honest non-human ai_agent PlatformRole");
need(eventRuleSource.includes('id: "system:facility-automation",'), "1. the automation actor's id must honestly self-identify as a system/automation principal, not a human user id");

// ============================= 2. Synthetic actor cannot execute merely by inheriting human-role permissions =============================

const deviceControlPermission = registeredActionRequiredPermission("device.on");
need(deviceControlPermission === "devices.control", "sanity: device.on's required permission must still be devices.control");

const bareAiAgent = { id: "system:facility-automation", role: "ai_agent", permissions: [], permission_scopes: [], estate_id: "estate-1" };
need(hasPermission(bareAiAgent, deviceControlPermission) === false, `2. role "ai_agent" alone (no explicit permission grant) must NOT satisfy devices.control -- ai_agent's own role-derived permissions must remain read-only/blank, proving no blanket role-based authority is inherited`);

const authorizedAiAgent = { id: "system:facility-automation", role: "ai_agent", permissions: [deviceControlPermission], permission_scopes: [], estate_id: "estate-1" };
need(hasPermission(authorizedAiAgent, deviceControlPermission) === true, "2. the SAME actor, with the explicit action-specific permission granted, must be authorized -- proving authority comes only from the explicit grant, never the role");

// ============================= 3. Authority is action-specific, not cascading =============================

const visitorPermission = registeredActionRequiredPermission("visitor.approve");
need(visitorPermission === "visitors.manage", "sanity: visitor.approve's required permission must still be visitors.manage");
need(hasPermission(authorizedAiAgent, visitorPermission) === false, "3. an actor explicitly granted only devices.control must NOT also be authorized for a different action's permission (visitors.manage) -- the grant must be action-specific, never cascading to unrelated actions");

// ============================= 4. Building (estate) scope flows through the real event/rule, not hardcoded =============================

need(eventRuleSource.includes("function automationSystemActorFor(estateId: string, homeId: string | null, requiredPermission: PermissionKey): AuthUser {"), "4. the automation actor constructor must take the real estate (and home) scope as parameters, not a hardcoded value");
need(eventRuleSource.includes("automationSystemActorFor(event.estate_id, event.home_id, requiredPermission)"), "4. the automation actor must be built from the REAL triggering event's estate_id/home_id, not a fabricated or default scope");

// ============================= 5. Unauthorized action fails before executeRegisteredAction side effects =============================

const matchFnStart = eventRuleSource.indexOf("export async function matchEventDrivenAutomationRules(");
const matchFnBody = eventRuleSource.slice(matchFnStart);
const autoAllowedIdx = matchFnBody.indexOf('if (policy.executionLevel === "auto_allowed") {');
const authorityCheckIdx = matchFnBody.indexOf("automationSystemActorMayActOnAction(automationActor, rule.action_id)");
const executeCallIdx = matchFnBody.indexOf("void executeApprovalRow(proposal, automationActor,");
const elseWarnIdx = matchFnBody.indexOf("console.warn(", executeCallIdx);
need(autoAllowedIdx > 0 && authorityCheckIdx > autoAllowedIdx, "5. the action-specific authority check must run inside the auto_allowed branch");
need(executeCallIdx > authorityCheckIdx, "5. executeApprovalRow (which leads to executeRegisteredAction's side effects) must only be reachable after the authority check");
need(elseWarnIdx > executeCallIdx, "5. an unauthorized automation principal must fall through to a no-op warning branch, never reaching executeApprovalRow");
need(!matchFnBody.slice(autoAllowedIdx, executeCallIdx).includes("} else {\n          void executeApprovalRow"), "5. sanity: executeApprovalRow must not be reachable from the denial branch");

// ============================= 6/7. Physical device action: Slice 1's DeviceCommandAuthority still governs, including the kill switch =============================

const deviceAuthorityActor = { id: "system:facility-automation", role: "ai_agent", permissions: ["devices.control"], permission_scopes: [], estate_id: "estate-1", home_id: "home-1" };
const deviceAllowed = authorizeDeviceCommand({ actor: deviceAuthorityActor, commandSource: "facility", estateId: "estate-1", homeId: "home-1", roomId: null });
need(deviceAllowed.allowed === true, `6. an honestly-authorized automation principal (ai_agent + explicit devices.control) must still pass Slice 1's DeviceCommandAuthority gate for a physical device action, got: ${JSON.stringify(deviceAllowed)}`);

const capabilityModule = capabilityRegistry.get(DEVICE_COMMAND_CAPABILITY_KEY);
need(capabilityModule !== null, "7. devices.power.control must be registered after the first authorizeDeviceCommand call");
const originalRolloutStatus = capabilityModule.rolloutStatus;
capabilityModule.rolloutStatus = "disabled";
const deviceDeniedByKillSwitch = authorizeDeviceCommand({ actor: deviceAuthorityActor, commandSource: "facility", estateId: "estate-1", homeId: "home-1", roomId: null });
need(deviceDeniedByKillSwitch.allowed === false && deviceDeniedByKillSwitch.reason === "capability_disabled", `7. the platform-wide capability kill-switch must still deny autonomous physical device execution even for an honestly-authorized automation principal, got: ${JSON.stringify(deviceDeniedByKillSwitch)}`);
capabilityModule.rolloutStatus = originalRolloutStatus;

// ============================= 8. Human approval path is completely unchanged =============================

need(facilityAutomationServiceSource.includes("if (!actorMayActOnAction(input.actor.role, approval.action_id)) {"), "8. decideAutomationApproval must still gate on the real human actor's role via the unchanged actorMayActOnAction");
need(facilityAutomationServiceSource.includes("return executeApprovalRow(approval, input.actor, input.note);"), "8. decideAutomationApproval must still execute using the real authenticated human actor, unchanged");
need(automationPolicyResolverSource.includes("export function actorMayActOnAction(actorRole: string | null | undefined, actionId: string): boolean {"), "8. actorMayActOnAction itself must remain unmodified -- this slice does not redesign human approval");

// ============================= 9. created_by remains provenance, never impersonated =============================

need(eventRuleSource.includes("created_by: input.actorId,"), "9. rule creation must still record created_by as real provenance");
need(!matchFnBody.includes("rule.created_by") , "9. autonomous execution must never read/impersonate rule.created_by as the executing actor identity");
need(!eventRuleSource.includes("id: rule.created_by"), "9. the automation actor's id must never be set to the rule creator's id");

// ============================= 10. approval_required behaviour is unchanged =============================

need(matchFnBody.includes('if (policy.executionLevel !== "approval_required" && policy.executionLevel !== "auto_allowed") continue;'), "10. the approval_required/auto_allowed policy gate must be unchanged");
need(matchFnBody.includes("const proposal = await proposeAutomationApproval({"), "10. proposeAutomationApproval must still be called unconditionally for both approval_required and auto_allowed -- only subsequent auto-execution is gated");
const proposalCallIdx = matchFnBody.indexOf("const proposal = await proposeAutomationApproval({");
need(proposalCallIdx > 0 && proposalCallIdx < autoAllowedIdx, "10. the proposal must still be created before the auto_allowed branch runs, exactly as before -- approval_required rules still simply stop here, unexecuted");

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS the fabricated facility_manager/manager persona is gone -- the automation actor honestly self-identifies as a system/automation principal (ai_agent role, system:facility-automation id)");
console.log("PASS role alone grants nothing -- ai_agent's own role-derived permissions remain read-only; only an explicit per-action grant authorizes anything");
console.log("PASS authority is action-specific -- an explicit grant for one action does not cascade to a different action's permission");
console.log("PASS the automation actor's building/estate scope is derived from the real triggering event/rule, never hardcoded");
console.log("PASS an unauthorized automation principal never reaches executeApprovalRow/executeRegisteredAction -- the proposal is left pending for human review instead");
console.log("PASS an honestly-authorized automation principal still passes Slice 1's DeviceCommandAuthority gate for physical device actions");
console.log("PASS the devices.power.control kill-switch still denies autonomous physical device execution even when the automation principal is otherwise authorized");
console.log("PASS the human approval path (decideAutomationApproval/actorMayActOnAction) is completely unchanged");
console.log("PASS created_by remains rule-creation provenance only and is never read as the executing actor's identity");
console.log("PASS approval_required behaviour (proposal creation, policy gate) is unchanged");
console.log("wave5-slice2-facility-automation-system-authority-smoke passed");
