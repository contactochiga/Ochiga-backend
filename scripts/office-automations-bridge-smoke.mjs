#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const officeExport = fs.readFileSync(path.join(root, "src/routes/officeExport.ts"), "utf8");
const scenes = fs.readFileSync(path.join(root, "src/routes/scenes.ts"), "utf8");
const migrationFiles = fs.readdirSync(path.join(root, "supabase/migrations")).filter((file) => file.includes("automation_owner_label"));
const migration = migrationFiles.map((file) => fs.readFileSync(path.join(root, "supabase/migrations", file), "utf8")).join("\n");

const required = [
  ["surface hardcoded to office server-side, not client-supplied", 'OFFICE_AUTOMATION_SURFACE: AutomationSurface = "office"'],
  ["every route filters by surface, can never see/touch consumer or facility rows", '.eq("surface", OFFICE_AUTOMATION_SURFACE)'],
  ["create/update reuse scenes.ts's own validation, not a re-implementation", "validateWorkflowActions"],
  ["create/update reuse scenes.ts's own action cleaning, not a re-implementation", "cleanWorkflowActions"],
  ["create/update reuse scenes.ts's own trigger validation, not a re-implementation", "validateAutomationTrigger"],
  ["manual test reuses the shared executor, not a second execution path", "executeConsumerAutomation"],
  ["manual test reuses the same synthetic actor pattern from PR1/PR3", "officeAutomationActor"],
  ["gated by the same office-only credential as every other Office route", "requireOfficeExportKey"],
  ["single-workflow detail route added, wraps existing getWorkflow", 'router.get("/workflows/:id"'],
  ["owner column is additive, not a behavioral change to existing surfaces", "owner text"],
];

const combined = [officeExport, migration].join("\n");
const missing = required.filter(([, needle]) => !combined.includes(needle));
if (missing.length) {
  console.error("Office automations bridge smoke failed. Missing invariants:");
  for (const [label, needle] of missing) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

// This bridge must never gain its own scheduler, executor, or table —
// only route handlers around the existing shared runtime.
const forbidden = [
  ["no new scheduler in the Office bridge file", /setInterval/],
  ["no direct device-command dispatch bypassing the shared executor", /executeDeviceCommandForActor/],
];
const violations = forbidden.filter(([, pattern]) => pattern.test(officeExport));
if (violations.length) {
  console.error("Office automations bridge smoke failed. Found signs of a second automation engine:");
  for (const [label] of violations) console.error(`- ${label}`);
  process.exit(1);
}

// Exported surface used by officeExport.ts must actually exist in scenes.ts.
const exportsRequired = [
  "export type CleanWorkflowAction",
  "export function isWorkflowActionItem",
  "export function cleanWorkflowActions",
  "export function validateWorkflowActions",
  "export type AutomationSurface",
  "export function isAutomationSurfaceEnabled",
  "export function officeAutomationActor",
  "export async function executeConsumerAutomation",
];
const missingExports = exportsRequired.filter((needle) => !scenes.includes(needle));
if (missingExports.length) {
  console.error("Office automations bridge smoke failed. scenes.ts is missing expected exports:");
  for (const needle of missingExports) console.error(`- ${needle}`);
  process.exit(1);
}

console.log("Office automations bridge smoke passed.");
