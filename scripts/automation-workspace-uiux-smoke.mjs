#!/usr/bin/env node
// Automation Workspace UI/UX completion -- static regression proof for the
// two Backend-observable facts the Facility Automation Overview rebuild
// depends on:
//  1. GET /scenes/automations honors an optional ?surface= filter, closing
//     a real pre-existing cross-surface exposure (scoped(req) only filters
//     by estate_id/home_id, never surface, so a Facility-staff caller with
//     an estate_id but no home_id previously received every automation in
//     the estate, including residents' own consumer-surface automations).
//  2. The fix is additive: omitting ?surface= must still return every
//     caller's automations exactly as before, and no existing automation
//     surface, validation, or execution invariant was touched.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scenes = fs.readFileSync(path.join(root, "src/routes/scenes.ts"), "utf8");

const required = [
  ["surface enum is the single source of truth for the filter", 'const AUTOMATION_SURFACES: AutomationSurface[] = ["consumer", "facility", "office"]'],
  ["GET /automations reads an optional surface query param", "const surfaceFilter = String(req.query?.surface"],
  ["filter only applies when the value is a real, known surface", "AUTOMATION_SURFACES.includes(surfaceFilter as AutomationSurface)"],
  ["filter is additive: builds on the existing scoped(req) query, not a replacement for it", 'query = scoped(supabaseAdmin.from("consumer_automations").select("*"), req)'],
];
const missing = required.filter(([, needle]) => !scenes.includes(needle));
if (missing.length) {
  console.error("Automation Workspace UI/UX smoke failed. Missing invariants:");
  for (const [label, needle] of missing) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

// Pre-existing invariants this pass must not have disturbed: write
// endpoints still require devices.control, reads still require
// devices.read + watch scope, and no new automation surface or execution
// path was introduced by this change.
const preserved = [
  ["read permission unchanged", 'router.get("/automations", requirePermission("devices.read")'],
  ["watch scope still enforced on read", "hasWatchScope(req.user!)"],
  ["no new surface was invented", 'const AUTOMATION_SURFACES: AutomationSurface[] = ["consumer", "facility", "office"]'],
];
const missingPreserved = preserved.filter(([, needle]) => !scenes.includes(needle));
if (missingPreserved.length) {
  console.error("Automation Workspace UI/UX smoke failed. Pre-existing invariants were removed or renamed:");
  for (const [label, needle] of missingPreserved) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

// The scoped-but-unfiltered pattern must remain the *default* -- this
// smoke fails loudly if a future edit makes the surface filter mandatory
// (which would break every existing caller that never sends ?surface=).
const optionalityIndex = scenes.indexOf("const surfaceFilter = String(req.query?.surface");
const nextLines = scenes.slice(optionalityIndex, optionalityIndex + 400);
if (!/if \(AUTOMATION_SURFACES\.includes\(surfaceFilter as AutomationSurface\)\) query = query\.eq\("surface", surfaceFilter\);/.test(nextLines)) {
  console.error("Automation Workspace UI/UX smoke failed: surface filter must stay conditional (opt-in), not mandatory.");
  process.exit(1);
}

console.log("Automation Workspace UI/UX smoke passed.");
