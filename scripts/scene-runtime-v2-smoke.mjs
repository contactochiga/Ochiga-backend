#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scenesRoute = fs.readFileSync(path.join(root, "src/routes/scenes.ts"), "utf8");

const required = [
  ["canonical action validator", "canonicalizeSceneAction"],
  ["Runtime V2 frontend contract", "summarizeDeviceFrontendContract"],
  ["canonical command controller", "executeDeviceCommandForActor"],
  ["scene run identity", "sceneRunId"],
  ["stable action execution identity", "stableActionExecutionId"],
  ["per-action idempotency", "sceneActionIdempotencyKey"],
  ["bounded concurrency", "SCENE_ACTION_CONCURRENCY"],
  ["scene action timeout", "SCENE_ACTION_TIMEOUT_MS"],
  ["multi-gang ambiguity rejection", "ambiguous_multi_gang_scene_action"],
  ["smart lock scene mutation block", "lock_scene_action_blocked"],
  ["IR scene mutation block", "ir_scene_action_blocked"],
  ["private scene lifecycle", "resident_device_private"],
  ["scene run requested audit", "scene.run.requested"],
  ["scene run history route", 'router.get("/:id/runs"'],
  ["automation canonical action validation", "Automation contains an unavailable or unsafe device action"],
  ["structured scene validation payload", "sceneActionErrorPayload"],
  ["invalid channel structured code", "SCENE_CHANNEL_NOT_EXPOSED"],
  ["invalid action index", "action_index"],
  ["invalid action device id", "canonical_device_id"],
  ["invalid action command key", "command_key"],
];

const missing = required.filter(([, needle]) => !scenesRoute.includes(needle));
if (missing.length) {
  console.error("Scene Runtime V2 smoke failed. Missing invariants:");
  for (const [label, needle] of missing) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

if (/safeSceneCommand/.test(scenesRoute)) {
  console.error("Scene Runtime V2 smoke failed: hardcoded safeSceneCommand allowlist is still present.");
  process.exit(1);
}

if (!/source:\s*"scene"/.test(scenesRoute) || !/commandExecutionId:\s*actionExecutionId/.test(scenesRoute)) {
  console.error("Scene Runtime V2 smoke failed: scene actions are not routed through canonical command execution with explicit action IDs.");
  process.exit(1);
}

console.log("Scene Runtime V2 backend smoke passed.");
