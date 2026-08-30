#!/usr/bin/env node
// Facility Automation -- Cross-Domain Fabric Closure. Static regression
// proof that: automation is genuinely event-driven now (not schedule-only),
// the condition engine is real but narrow, the same governed
// (policy resolver -> approvals -> executeRegisteredAction -> verify ->
// audit -> notify) pipeline is reused rather than duplicated, loop
// protection is real, the idempotency gap found during the audit is
// closed, and no fabricated action (generator/pump/meter-vending/PTZ/
// lockdown/wallet execution) was introduced.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const triggerRegistry = read("src/intelligence-core/triggerRegistry.ts");
const conditionEvaluator = read("src/services/automationConditionEvaluator.ts");
const eventRuleService = read("src/services/facilityAutomationEventRuleService.ts");
const automationService = read("src/services/facilityAutomationService.ts");
const eventBus = read("src/intelligence-core/eventBus.ts");
const executionRegistry = read("src/intelligence-core/executionRegistry.ts");
const sourceEventPublisher = read("src/intelligence-core/sourceEventPublisher.ts");
const facilityRoutes = read("src/routes/facility.routes.ts");
const automationsRoute = read("src/automations/automations.route.ts");
const communityController = read("src/controllers/communityController.ts");
const maintenanceController = read("src/controllers/maintenance.controller.ts");
const platformGapService = read("src/services/platformGapService.ts");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

// 1. Event-driven dispatch is real -- hooked into the one true canonical
// choke point (eventBus.ts's publishIntelligenceEvent), not a second,
// parallel event system, and not only the sourceEventPublisher wrapper
// (which would miss direct callers like camera detections).
need(eventBus.includes('import("../services/facilityAutomationEventRuleService")'), "publishIntelligenceEvent must dispatch to the event-driven automation matcher");
need(eventBus.includes("matchEventDrivenAutomationRules"), "the dispatcher must be matchEventDrivenAutomationRules");
need(!eventBus.includes("new WebSocket") && !eventBus.includes("setInterval"), "the dispatcher must not introduce a second polling/socket event system");

// 2. Trigger registry is a real, additive catalog -- not a fabricated
// domain list. Finance/Communications are deliberately excluded.
need(triggerRegistry.includes("weather.condition.observed"), "weather must be a registered trigger");
need(triggerRegistry.includes("device.online") && triggerRegistry.includes("device.offline"), "device connectivity must be a registered trigger");
need(triggerRegistry.includes("maintenance.created"), "maintenance creation must be a registered trigger");
need(triggerRegistry.includes("security.incident.created"), "security incident creation must be a registered trigger");
need(!triggerRegistry.includes('event_type: "wallet'), "Finance must not be fabricated into the trigger registry -- no safe paired action or overdue signal exists");

// 3. Condition engine is the smallest necessary set -- typed, not a
// generic expression language.
for (const kind of ["severity_at_least", "field_threshold", "time_window", "building_occupied", "indoor_sensor_threshold"]) {
  need(conditionEvaluator.includes(`"${kind}"`), `condition evaluator must support ${kind}`);
}
need(!conditionEvaluator.includes("eval(") && !conditionEvaluator.includes("new Function("), "condition evaluator must never execute arbitrary expressions");

// 4. Rules validate against the real, existing registries at write time --
// never persist a rule pointing at an unregistered trigger or an
// unavailable action.
need(eventRuleService.includes("isRegisteredTriggerEventType"), "event rule creation must validate trigger_event_type against the real trigger registry");
need(eventRuleService.includes("getRegisteredExecutionAction") && eventRuleService.includes("action.available"), "event rule creation must validate action_id against EXECUTION_REGISTRY and require it to be available");

// 5. No second automation engine -- the dispatcher reuses the EXISTING
// governed pipeline (resolveAutomationPolicy, proposeAutomationApproval,
// executeApprovalRow), it does not reimplement approval/execution.
need(eventRuleService.includes("resolveAutomationPolicy(") , "the dispatcher must resolve policy through the existing resolver, not a new governance enum");
need(eventRuleService.includes("proposeAutomationApproval("), "the dispatcher must create real approval rows through the existing proposal function");
need(eventRuleService.includes("executeApprovalRow("), "auto_allowed execution must reuse the same execute/verify/audit/notify function human approval uses, not a duplicate");
need(automationService.includes("export async function executeApprovalRow"), "executeApprovalRow must be extracted and shared, not duplicated inline in the dispatcher");
need(automationService.includes("return executeApprovalRow(approval, input.actor, input.note)"), "decideAutomationApproval must delegate to the shared executeApprovalRow, not its own copy of the execute sequence");

// 6. Loop protection -- automation-caused events must never re-enter the
// matcher (zero-hop chaining).
need(sourceEventPublisher.includes("automation_origin"), "the source event contract must carry an automation_origin flag");
need(eventRuleService.includes('event.metadata?.automation_origin === true) return'), "the dispatcher must refuse to match rules against automation-originated events");
need(executionRegistry.includes('automation_origin: input.source === "automation"'), "executeRegisteredAction's own publishes must tag automation-caused mutations so the loop guard actually has something to check");

// 7. Idempotency -- the pending->executing transition is a real
// compare-and-swap, not a read-then-write race.
need(automationService.includes('.eq("status", "pending_approval")') && automationService.includes('.update({ status: "executing"'), "the executing-transition must be a CAS guarded by the current status, closing the double-execution race");

// 7b. Found via live production verification: the CAS update's synthetic
// system actor (id "system:automation") isn't a valid UUID, but
// approver_id is a uuid FK column -- writing it directly caused a silent
// Postgres type-cast failure that was indistinguishable from a legitimate
// lost race (no error check, no audit trail). Both must now be fixed.
need(automationService.includes("approverFieldsFor(actor)"), "approver_id must never be written directly from a possibly-non-UUID actor.id -- auto-executed runs must record no approver, not a fabricated one");
need(automationService.includes("const { data: claimed, error: claimError }") && automationService.includes("if (claimError)"), "a genuine DB error on the claim update must be distinguished from a legitimate lost race, not silently swallowed as if no row matched");

// 8. The three new action adapters are real, extracted, facility-scoped
// primitives -- not the resident/staff-facing controller endpoints
// reused verbatim, and not fabricated.
need(communityController.includes("export async function postCommunityAnnouncement"), "community.post_announcement must have a real extracted function");
need(maintenanceController.includes("export async function createFacilityMaintenanceOrder"), "maintenance.create must have a real extracted function distinct from the resident complaint path");
need(!maintenanceController.match(/createFacilityMaintenanceOrder[\s\S]{0,400}resident_id:/), "a facility-initiated work order must never be attributed to a resident as the complainant");
need(platformGapService.includes("export async function createFacilityIncident"), "security.create_incident must have a real extracted function");
need(platformGapService.includes('event_type: "security.incident.created"'), "incident creation must now publish onto the intelligence bus, making it a real trigger source too");

for (const id of ["maintenance.create", "community.post_announcement", "security.create_incident"]) {
  need(executionRegistry.includes(`{ id: "${id}", domain:`) && new RegExp(`"${id.replace(".", "\\.")}"[^}]*available: true`).test(executionRegistry), `${id} must be registered and available:true`);
}

// 9b. Real bug found while wiring event-rule maintenance.assign support:
// executeApprovalRow never threaded a top-level `assignee` through to
// executeRegisteredAction (only `command`), so maintenance.assign
// silently failed for every approval-reached execution, not just this
// pass's new event-rule path. Fixed by reading command.assignee as a
// fallback.
need(executionRegistry.includes('(input.command as any)?.assignee'), "maintenance.assign must accept an assignee from command as well as the top-level field, since the approval/event-rule execution path only ever threads command");

// 9. Confirmed-fabricated capabilities must never be exposed as
// executable actions anywhere in this pass's new code.
for (const forbidden of ["generator.start", "generator.stop", "pump.control", "meter.vend", "camera.ptz", "security.lockdown", "wallet.debit", "wallet.charge"]) {
  need(!executionRegistry.includes(`"${forbidden}"`), `${forbidden} must never be registered -- confirmed no real adapter exists`);
}

// 10. Realtime closure -- facility:automation is actually emitted now,
// not just declared.
need(automationService.includes("export function emitFacilityAutomationRealtime"), "a real realtime emitter for facility:automation must exist");
need(automationService.includes('io.to(`estate:${estateId}`).emit("facility:automation"') || automationService.includes('io.to(`estate:${estateId}`).emit("facility:automation"'), "realtime must be emitted to the estate room, matching the existing getIO()/estate-room pattern");
need((automationService.match(/emitFacilityAutomationRealtime\(/g) || []).length >= 6, "realtime must be emitted at multiple real lifecycle points (queued, started, succeeded, failed, verification_failed, rejected), not just declared once");

// 11. Tenant-isolation fix on the legacy /automations router.
need(automationsRoute.includes("const record = { ...parsed, estate_id: estateId }"), "automation creation must derive estate_id from the session, never trust the request body");
need(automationsRoute.includes('String(automation.estate_id) !== String(estateId)'), "manual trigger must verify the automation actually belongs to the caller's own estate before enqueueing");

// 12. New routes exist and follow the existing RBAC convention (same
// permissions already used by /scenes/automations*, no new scheme).
need(facilityRoutes.includes('router.get("/automation/event-rules", requireAuth, requirePermission("devices.read")'), "event-rules list route must exist with the existing read permission");
need(facilityRoutes.includes('router.post("/automation/event-rules", requireAuth, requirePermission("devices.control")'), "event-rules create route must exist with the existing write permission");
need(facilityRoutes.includes("TRIGGER_REGISTRY.map"), "capabilities.triggers must now be derived from the real trigger registry, not a single hardcoded schedule literal");

if (failures.length) {
  console.error("Event-driven automation smoke failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Event-driven automation smoke passed.");
