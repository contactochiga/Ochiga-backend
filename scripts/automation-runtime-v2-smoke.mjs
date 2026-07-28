#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scenes = fs.readFileSync(path.join(root, "src/routes/scenes.ts"), "utf8");
const batch = fs.readFileSync(path.join(root, "src/services/residentActionBatchExecutionService.ts"), "utf8");
const schedule = fs.readFileSync(path.join(root, "src/services/automationScheduleService.ts"), "utf8");
const migration = fs.readdirSync(path.join(root, "supabase/migrations")).filter((file) => file.includes("automation_runtime_v2_completion")).map((file) => fs.readFileSync(path.join(root, "supabase/migrations", file), "utf8")).join("\n");
const server = fs.readFileSync(path.join(root, "src/server.ts"), "utf8");

const required = [
  ["schedule trigger validation", "validateAutomationTrigger"],
  ["daily next run", 'schedule_type: "daily"'],
  ["weekday next run", 'schedule_type: "weekdays"'],
  ["one-time next run", 'schedule_type: "once"'],
  ["IANA timezone validation", "Intl.DateTimeFormat"],
  ["manual test route", 'router.post("/automations/:id/test"'],
  ["run history route", 'router.get("/automations/:id/runs"'],
  ["shared action executor", "executeResidentActionBatch"],
  ["canonical command controller", "executeDeviceCommandForActor"],
  ["automation action idempotency", "residentActionIdempotencyKey"],
  ["bounded concurrency", "RESIDENT_ACTION_BATCH_CONCURRENCY"],
  ["scheduler start", "startAutomationRuntimeV2Scheduler"],
  ["scheduler tick log", "automation_scheduler_tick"],
  ["due trigger log", "automation_trigger_due"],
  ["duplicate suppression", "automation_run_duplicate_suppressed"],
  ["automation run ledger", "consumer_automation_runs"],
  ["unique occurrence constraint", "consumer_automation_runs_occurrence_unique"],
  ["next run column", "next_run_at"],
  ["last run status column", "last_run_status"],
  ["server starts scheduler", "startAutomationRuntimeV2Scheduler()"],
  ["server stops scheduler", "stopAutomationRuntimeV2Scheduler()"],
  ["smart lock block preserved", "lock_scene_action_blocked"],
  ["IR block preserved", "ir_scene_action_blocked"],
  ["private routing", "resident_device_private"],
];

const combined = [scenes, batch, schedule, migration, server].join("\n");
const missing = required.filter(([, needle]) => !combined.includes(needle));
if (missing.length) {
  console.error("Automation Runtime V2 smoke failed. Missing invariants:");
  for (const [label, needle] of missing) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

if (/from\("automations"\)|from\('automations'\)/.test(scenes)) {
  console.error("Automation Runtime V2 smoke failed: resident automation routes must not use legacy automations table.");
  process.exit(1);
}

console.log("Automation Runtime V2 backend smoke passed.");
