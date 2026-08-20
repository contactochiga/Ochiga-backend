#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scenes = fs.readFileSync(path.join(root, "src/routes/scenes.ts"), "utf8");
const workflowBatch = fs.readFileSync(path.join(root, "src/services/workflowActionBatchExecutionService.ts"), "utf8");

const required = [
  ["workflow_action creation gated to office surface", "workflow_action_surface_mismatch"],
  ["workflow_type restricted to WORKFLOW_CONTRACTS, not free text", "workflowContractFor"],
  ["status restricted to WORKFLOW_STATUSES, not free text", "WORKFLOW_STATUSES"],
  ["dispatch reuses createWorkflow, not a new Task-domain writer", "createWorkflow"],
  ["dispatch reuses transitionWorkflow, not a new Task-domain writer", "transitionWorkflow"],
  ["dispatch reuses getWorkflow (handles text workflow_id), not a raw query", "getWorkflow"],
  ["office actor stays the synthetic pattern from PR1, not a new identity model", "officeAutomationActor"],
  ["automations stay homogeneous across all three action types", "isWorkflowActionAutomation"],
];

const combined = [scenes, workflowBatch].join("\n");
for (const [label, needle] of required) {
  if (!combined.includes(needle)) {
    console.error(`Shared Automation Runtime PR3 (Office) smoke failed. Missing invariant: ${label}: ${needle}`);
    process.exit(1);
  }
}

if (/from\(["']crm_tasks["']\)/.test(workflowBatch)) {
  console.error("Shared Automation Runtime PR3 smoke failed: workflowActionBatchExecutionService.ts must not query/write crm_tasks (Office's CRM store stays untouched by this runtime path).");
  process.exit(1);
}

// Backward compatibility: PR1's device_command lane and PR2's
// registered_action lane must both still be reachable, completely
// unchanged, alongside the new workflow_action lane.
const preserved = [
  ["existing device dispatch untouched", "executeResidentActionBatch"],
  ["existing facility registered-action dispatch untouched", "executeRegisteredActionBatch"],
  ["existing surface enforcement points untouched", "isAutomationSurfaceEnabled"],
  ["existing CAS claim untouched", '.eq("next_run_at", scheduledFor)'],
  ["existing facility allowlist untouched", "FACILITY_REGISTERED_ACTION_IDS"],
];
const missingPreserved = preserved.filter(([, needle]) => !scenes.includes(needle));
if (missingPreserved.length) {
  console.error("Shared Automation Runtime PR3 smoke failed. Pre-existing invariants were removed or renamed:");
  for (const [label, needle] of missingPreserved) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

console.log("Shared Automation Runtime PR3 (Office) smoke passed.");
