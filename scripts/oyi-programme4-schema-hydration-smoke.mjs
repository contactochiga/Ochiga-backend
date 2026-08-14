import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Programme 4 Phase L — regression guard for two real column-mismatch bugs
// found by direct migration inspection: maintenance_requests has no
// resident_id/category/priority columns (only user_id; verified against
// migrations/schema.sql and every later ALTER), and devices has no
// room_name column (it's derived via a join elsewhere, e.g.
// deviceEvidence.ts). Both selects previously always errored against real
// Postgres, silently degrading to "unavailable"/empty — existing smoke
// coverage uses fake Supabase mocks that don't enforce real column
// existence, which is exactly why these went undetected. This script
// checks the source text directly so it doesn't need a real database.

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

const maintenanceEvidence = await readFile(new URL("../src/oyi-core/domains/maintenance/maintenanceEvidence.ts", import.meta.url), "utf8");
const activityRoute = await readFile(new URL("../src/routes/activity.ts", import.meta.url), "utf8");

check("maintenance_requests select never re-requests the nonexistent resident_id/category/priority columns", () => {
  const selectMatch = maintenanceEvidence.match(/\.from\("maintenance_requests"\)\s*\.select\("([^"]+)"\)/);
  assert.ok(selectMatch, "expected to find the maintenance_requests select() call");
  const columns = selectMatch[1].split(",");
  assert.ok(columns.includes("user_id"), "expected user_id (the real column) to be selected");
  assert.ok(!columns.includes("resident_id"), "resident_id is not a real column on maintenance_requests");
  assert.ok(!columns.includes("category"), "category is not a real column on maintenance_requests");
  assert.ok(!columns.includes("priority"), "priority is not a real column on maintenance_requests");
});

check("devices select in the activity feed never re-requests the nonexistent room_name column", () => {
  const selectMatch = activityRoute.match(/safeSelect\("devices",[\s\S]{0,200}?\.select\("([^"]+)"\)/);
  assert.ok(selectMatch, "expected to find the devices select() call inside the activity feed's safeSelect(\"devices\", ...) block");
  const columns = selectMatch[1].split(",");
  assert.ok(columns.includes("room_id"), "expected room_id (the real FK column) to be selected");
  assert.ok(!columns.includes("room_name"), "room_name is not a real column on devices — it must be derived via a join, not selected directly");
});

if (process.exitCode === 1) {
  console.error("oyi-programme4-schema-hydration-smoke: FAILED");
  process.exit(1);
}
console.log("oyi-programme4-schema-hydration-smoke: PASS");
