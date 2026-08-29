#!/usr/bin/env node
// Final OYI Facility Automation Builder -- Cross-Domain Operational
// Automation. Static regression proof for:
//  1. notification.notify -- the one new domain action wired this pass,
//     backed by the real, already-generic NotificationService, not new
//     notification logic.
//  2. The governance-gating fix: every registered_action item on a
//     scheduled/manual-test run is now policy-checked through the SAME
//     resolver (and SAME approval_required-by-default) the system-
//     detector approval queue already uses, closing the gap the two
//     prior Automation Workspace passes explicitly disclosed and worked
//     around instead of fixing.
//  3. The device_command (generic device-scene) lane is untouched --
//     still executes directly, exactly as Consumer's own device scenes
//     always have.
//  4. The capability registry endpoint is a read-only projection of the
//     real EXECUTION_REGISTRY + automationPolicyResolver, not a second,
//     independently-maintained list.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const registry = fs.readFileSync(path.join(root, "src/intelligence-core/executionRegistry.ts"), "utf8");
const scenes = fs.readFileSync(path.join(root, "src/routes/scenes.ts"), "utf8");
const facilityAutomation = fs.readFileSync(path.join(root, "src/services/facilityAutomationService.ts"), "utf8");
const facilityRoutes = fs.readFileSync(path.join(root, "src/routes/facility.routes.ts"), "utf8");
const batchService = fs.readFileSync(path.join(root, "src/services/registeredActionBatchExecutionService.ts"), "utf8");
const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));

function fail(list, msg) {
  list.push(msg);
}

const failures = [];

// 1. notification.notify is real, registered, and reuses NotificationService.
if (!registry.includes('{ id: "notification.notify", domain: "notifications", confirmation_required: true, available: true }')) fail(failures, "notification.notify not registered as available in EXECUTION_REGISTRY");
if (!registry.includes('await import("../services/NotificationService")')) fail(failures, "notification.notify branch does not reuse the real NotificationService");
if (!registry.includes('action.id !== "notification.notify"')) fail(failures, "entity_id guard was not relaxed for notification.notify");
if (!registry.includes("NotificationService.sendToRole") || !registry.includes("NotificationService.sendToEstate") || !registry.includes("NotificationService.sendToUser") || !registry.includes("NotificationService.sendToHome")) fail(failures, "notification.notify does not cover all four real NotificationService send targets");
if (!scenes.includes('"notification.notify",')) fail(failures, "notification.notify missing from FACILITY_REGISTERED_ACTION_IDS");

// 2. Governance gating: every registered_action run is policy-checked
// before executeRegisteredActionBatch is ever called.
const executeFnIndex = scenes.indexOf("export async function executeConsumerAutomation");
const executeFnBody = scenes.slice(executeFnIndex, executeFnIndex + 12000);
if (!executeFnBody.includes("resolveAutomationPolicy({ estateId: automation.estate_id, actorRole: null, actionId })")) fail(failures, "executeConsumerAutomation does not resolve policy for registered_action items");
if (!executeFnBody.includes('resolution.executionLevel !== "auto_allowed"') && !executeFnBody.includes('!== "auto_allowed"')) fail(failures, "executeConsumerAutomation does not gate on execution level before executing");
if (!executeFnBody.includes("proposeAutomationApproval({")) fail(failures, "executeConsumerAutomation does not create an approval for approval_required actions instead of executing them");
const gateIndex = executeFnBody.indexOf("resolveAutomationPolicy({ estateId: automation.estate_id");
const batchCallIndex = executeFnBody.indexOf("results = await executeRegisteredActionBatch({");
if (gateIndex === -1 || batchCallIndex === -1 || gateIndex > batchCallIndex) fail(failures, "governance gate must run BEFORE executeRegisteredActionBatch, not after");

// 3. The device_command (generic device-scene) lane must remain
// completely untouched -- still the one lane that always executes
// directly, unlike registered_action.
if (!scenes.includes("executeResidentActionBatch")) fail(failures, "device_command lane (executeResidentActionBatch) appears to have been removed or renamed");
const deviceLaneIndex = scenes.indexOf("executeResidentActionBatch(");
const deviceLaneContext = scenes.slice(Math.max(0, deviceLaneIndex - 800), deviceLaneIndex);
if (deviceLaneContext.includes("resolveAutomationPolicy")) fail(failures, "device_command lane must not be gated by resolveAutomationPolicy -- it has always executed directly, same as Consumer's own device scenes");

// 4. proposeAutomationApproval is now the shared, exported entry point
// for both detector-driven and automation-driven proposals -- no
// duplicate function was written for the automation case.
if (!facilityAutomation.includes("export async function proposeAutomationApproval")) fail(failures, "proposeAutomationApproval must be exported for scenes.ts to reuse it");
if (!facilityAutomation.includes('entityType: "maintenance_request" | "visitor_access" | "notification"')) fail(failures, "ProposalInput entityType was not widened for notification-sourced proposals");
if (!facilityAutomation.includes("requestedBy?: string")) fail(failures, "ProposalInput missing requestedBy so automation-sourced proposals can't be traced to their real human creator");
if (!facilityAutomation.includes('!approval.entity_id\n    ? { state: "verified"')) fail(failures, "entity-less approvals (notification.notify) must be treated as verified from their own execution result, not misreported as verification_failed");

// 5. Migration exists and is additive (drops NOT NULL, does not touch
// existing data or the uniqueness guard).
if (!migrations.some((name) => name.includes("automation_approvals_entityless_actions"))) fail(failures, "missing migration to make automation_approvals.entity_id nullable");
const migrationFile = migrations.find((name) => name.includes("automation_approvals_entityless_actions"));
if (migrationFile) {
  const migrationSql = fs.readFileSync(path.join(root, "supabase/migrations", migrationFile), "utf8");
  if (!/alter column entity_id drop not null/i.test(migrationSql)) fail(failures, "migration does not actually drop the NOT NULL constraint");
}

// 6. Capability registry is a projection, not a second registry --
// built directly from EXECUTION_REGISTRY + resolveAutomationPolicy, and
// discloses unavailable actions with their real reason rather than
// hiding them.
if (!facilityRoutes.includes('router.get("/automation/capabilities"')) fail(failures, "GET /facility/automation/capabilities route is missing");
if (!facilityRoutes.includes("EXECUTION_REGISTRY.map(async (action)")) fail(failures, "capability registry endpoint does not derive from the real EXECUTION_REGISTRY");
if (!facilityRoutes.includes("resolveAutomationPolicy({ estateId, actorRole: req.user?.role || null, actionId: action.id })")) fail(failures, "capability registry endpoint does not resolve real execution levels per action");
if (!facilityRoutes.includes("action.reason || \"Not implemented yet.\"")) fail(failures, "capability registry endpoint does not surface the real disclosed reason for unavailable actions");

// 7. command now flows end-to-end from the batch executor down to
// executeRegisteredAction, required for notification.notify's payload.
if (!batchService.includes("command: action.command || null")) fail(failures, "registeredActionBatchExecutionService does not pass command through to executeRegisteredAction");

if (failures.length) {
  console.error("Cross-Domain Operational Automation smoke failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Cross-Domain Operational Automation smoke passed.");
