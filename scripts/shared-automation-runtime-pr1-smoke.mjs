#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scenes = fs.readFileSync(path.join(root, "src/routes/scenes.ts"), "utf8");
const migrationFiles = fs.readdirSync(path.join(root, "supabase/migrations")).filter((file) => file.includes("automation_surface_contract"));
const migration = migrationFiles.map((file) => fs.readFileSync(path.join(root, "supabase/migrations", file), "utf8")).join("\n");

const required = [
  ["surface column, defaults every existing row to consumer", "default 'consumer'"],
  ["surface constrained to the 3 known surfaces", "check (surface in ('consumer', 'facility', 'office'))"],
  ["surface-aware due index added, not replacing the existing one", "consumer_automations_surface_due_idx"],
  ["facility flag, default false", 'AUTOMATION_SURFACE_FACILITY_ENABLED || "false"'],
  ["office flag, default false", 'AUTOMATION_SURFACE_OFFICE_ENABLED || "false"'],
  ["consumer always enabled regardless of flags", 'const surfaces: AutomationSurface[] = ["consumer"]'],
  ["scheduler due-scan is surface-aware", '.in("surface", surfaces)'],
  ["scheduler tick logs which surfaces are live", "enabled_surfaces: surfaces"],
  ["claim path re-checks surface before running (defense in depth)", "reason: \"surface_disabled\""],
  ["shared executor also checked (covers manual test path too)", "automation_surface_disabled"],
  ["office actor is synthetic, not a users-table lookup", "function officeAutomationActor"],
  ["facility/consumer actor resolution unchanged (still a real users row)", 'from("users").select("*").eq("id", automation.created_by)'],
  ["create route rejects a disabled surface", "The ${surface} automation surface is not yet enabled."],
  ["patch route rejects switching to a disabled surface", "invalid_automation_surface"],
  ["surface threaded into run-created observability", 'surface: automation.surface || "consumer"'],
];

const missing = required.filter(([, needle]) => !scenes.includes(needle) && !migration.includes(needle));
if (missing.length) {
  console.error("Shared Automation Runtime PR1 smoke failed. Missing invariants:");
  for (const [label, needle] of missing) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

// Backward-compatibility invariants: nothing about the existing consumer
// path should have been removed or renamed by this pass.
const preserved = [
  ["existing due-scan window/order/limit untouched", '.lte("next_run_at", nowIso)'],
  ["existing CAS claim untouched", '.eq("next_run_at", scheduledFor)'],
  ["existing idempotent run key untouched", "automationOccurrenceKey"],
  ["existing device-action dispatch untouched", "canonicalizeSceneActions"],
  ["existing lock block preserved", "lock_scene_action_blocked"],
  ["existing IR block preserved", "ir_scene_action_blocked"],
  ["existing scheduler start/stop untouched", "startAutomationRuntimeV2Scheduler"],
];
const missingPreserved = preserved.filter(([, needle]) => !scenes.includes(needle));
if (missingPreserved.length) {
  console.error("Shared Automation Runtime PR1 smoke failed. Pre-existing Consumer invariants were removed or renamed:");
  for (const [label, needle] of missingPreserved) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

// A migration must exist and must be additive-only: no drop/rename/delete
// against consumer_automations, consumer_automation_runs, or consumer_scenes.
if (!migration.trim()) {
  console.error("Shared Automation Runtime PR1 smoke failed: no automation_surface_contract migration found.");
  process.exit(1);
}
if (/drop\s+(table|column)|rename\s+(table|column)|delete\s+from/i.test(migration)) {
  console.error("Shared Automation Runtime PR1 smoke failed: migration must be additive-only, not destructive.");
  process.exit(1);
}

console.log("Shared Automation Runtime PR1 (surface foundation) smoke passed.");
