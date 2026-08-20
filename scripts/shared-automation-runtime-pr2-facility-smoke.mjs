#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scenes = fs.readFileSync(path.join(root, "src/routes/scenes.ts"), "utf8");
const registeredBatch = fs.readFileSync(path.join(root, "src/services/registeredActionBatchExecutionService.ts"), "utf8");
const registry = fs.readFileSync(path.join(root, "src/intelligence-core/executionRegistry.ts"), "utf8");

const required = [
  ["facility action allowlist is narrower than the full registry", "FACILITY_REGISTERED_ACTION_IDS"],
  ["device.on/off/toggle excluded from the registered_action lane", "device.on/off/toggle (devices already go through"],
  ["structural, non-mutating validation at save time", "Structural validation only"],
  ["assignee required for maintenance.assign", "assignee_required"],
  ["registered_action creation gated to facility surface", "registered_action_surface_mismatch"],
  ["dispatch reuses executeRegisteredAction, not a new authorization path", "executeRegisteredActionBatch"],
  ["automations stay homogeneous: mixed action types are not silently merged", "isRegisteredActionAutomation"],
  ["maintenance_operator recognized as an operational role", '"maintenance_operator"'],
  ["fix is explained, not silent", "Found via Shared Automation Runtime PR 2 verification"],
];

const combined = [scenes, registeredBatch, registry].join("\n");
const missing = required.filter(([, needle]) => !combined.includes(needle));
if (missing.length) {
  console.error("Shared Automation Runtime PR2 (Facility) smoke failed. Missing invariants:");
  for (const [label, needle] of missing) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

// Backward compatibility: PR1's device_command lane must still be
// reachable completely unchanged for any automation with no
// action_type on its items.
const preserved = [
  ["existing device dispatch untouched", "executeResidentActionBatch"],
  ["existing scene/device validation untouched", "canonicalizeSceneActions"],
  ["existing surface enforcement points untouched", "isAutomationSurfaceEnabled"],
  ["existing CAS claim untouched", '.eq("next_run_at", scheduledFor)'],
];
const missingPreserved = preserved.filter(([, needle]) => !scenes.includes(needle));
if (missingPreserved.length) {
  console.error("Shared Automation Runtime PR2 smoke failed. Pre-existing invariants were removed or renamed:");
  for (const [label, needle] of missingPreserved) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

// The registry must never silently grow to cover actions this pass
// explicitly declined to wire (community/service/wallet remain
// available:false; report/service-config are not registry entries at all).
if (/id: "community\.approve", domain: "community", confirmation_required: true, available: true/.test(registry)) {
  console.error("Shared Automation Runtime PR2 smoke failed: community.approve must not have been silently marked available.");
  process.exit(1);
}

console.log("Shared Automation Runtime PR2 (Facility) smoke passed.");
