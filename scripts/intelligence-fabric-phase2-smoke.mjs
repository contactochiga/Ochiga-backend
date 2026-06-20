import assert from "node:assert/strict";

// Structural tests only: no database or device command is attempted.
process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-key";

const workflows = await import("../dist/intelligence-core/workflows.js");
const orchestrator = await import("../dist/intelligence-core/workflowOrchestrator.js");
const intents = await import("../dist/intelligence-core/intentRouter.js");
const execution = await import("../dist/intelligence-core/executionRegistry.js");
const awareness = await import("../dist/intelligence-core/awarenessWorkflowProvider.js");

assert.equal(workflows.WORKFLOW_STATUSES.includes("verified"), true);
assert.equal(workflows.WORKFLOW_STATUSES.includes("failed"), true);
assert.equal(orchestrator.workflowRuleForTest({ source: "consumer", event_type: "visitor_access.created", category: "visitor", title: "Visitor", entity_id: "visitor-1" })?.workflow_type, "visitor_access");
assert.equal(orchestrator.workflowRuleForTest({ source: "facility", event_type: "maintenance.created", category: "maintenance", title: "Repair", entity_id: "maintenance-1" })?.workflow_type, "maintenance");
assert.equal(intents.classifyUniversalIntent({ message: "Assign it to Ade", surface: "facility" }).intent, "assignment");
assert.equal(intents.classifyUniversalIntent({ message: "Show visitor access", surface: "consumer" }).domain, "visitor");
const universalDomainCases = [
  ["consumer", "Show rooms", "room"],
  ["consumer", "Show scenes", "scene"],
  ["consumer", "Show automations", "automation"],
  ["consumer", "Show wallet", "wallet"],
  ["consumer", "Show community updates", "community"],
  ["consumer", "Show notifications", "notification"],
  ["consumer", "Show activity", "activity"],
  ["consumer", "Show services", "service"],
  ["facility", "Show camera events", "camera"],
  ["facility", "Show infrastructure alerts", "infrastructure"],
  ["facility", "Show utility issues", "service"],
  ["facility", "Show sensors", "sensor"],
  ["facility", "Show traffic", "traffic"],
  ["facility", "Show staff", "staff"],
  ["facility", "Show estate structure", "estate"],
  ["facility", "Show reports", "report"],
  ["office", "Show leads", "lead"],
];
for (const [surface, message, expectedDomain] of universalDomainCases) {
  assert.equal(
    intents.classifyUniversalIntent({ message, surface }).domain,
    expectedDomain,
    `${surface} "${message}" should classify as ${expectedDomain}`,
  );
}
assert.equal(execution.getRegisteredExecutionAction("visitor.revoke")?.confirmation_required, true);
assert.equal(execution.getRegisteredExecutionAction("device.off")?.available, true);
assert.equal((await execution.executeRegisteredAction({ action_id: "visitor.revoke", actor: { id: "actor", role: "resident" }, entity_id: "visitor-1", confirmed: false })).status, "confirmation_required");
const ranked = awareness.rankActiveWorkflowsForAwareness([{ workflow_type: "maintenance", workflow_priority: "high", workflow_status: "created" }, { workflow_type: "security_incident", workflow_priority: "medium", workflow_status: "created" }]);
assert.equal(ranked[0].workflow_type, "security_incident");

console.log("intelligence fabric phase 2 workflow/execution/awareness smoke passed");
