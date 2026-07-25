#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

function expect(file, pattern, message) {
  const body = read(file);
  if (!pattern.test(body)) failures.push(`${file}: ${message}`);
}

function reject(file, pattern, message) {
  const body = read(file);
  if (pattern.test(body)) failures.push(`${file}: ${message}`);
}

expect(
  "src/device/runtime/deviceStateEnrichment.ts",
  /export type CanonicalDeviceAvailability[\s\S]*provider_disconnected[\s\S]*setup_incomplete[\s\S]*export type CanonicalDeviceState[\s\S]*availability[\s\S]*supportedActions[\s\S]*executableActions[\s\S]*providerEvidence/,
  "Runtime enrichment must expose the provider-neutral canonical device-state contract",
);
expect(
  "src/device/runtime/deviceStateEnrichment.ts",
  /state\.residual_electricity[\s\S]*state\.battery_value/,
  "Tuya lock residual_electricity must map into canonical battery state",
);
expect(
  "src/device/runtime/deviceStateEnrichment.ts",
  /function canonicalExecutableActions[\s\S]*battery_level[\s\S]*lock_state[\s\S]*operation_history[\s\S]*executableByOyi/,
  "Executable actions must be stricter than provider-declared/readable controls",
);
expect(
  "src/device/runtime/deviceStateEnrichment.ts",
  /canonicalAvailability[\s\S]*provider_disconnected[\s\S]*offline[\s\S]*stale[\s\S]*online/,
  "Availability must distinguish provider disconnect, offline, stale and online",
);
expect(
  "src/device/runtime/deviceStateEnrichment.ts",
  /const canonicalState = buildCanonicalDeviceState[\s\S]*canonical_state: canonicalState[\s\S]*canonical_presentation: buildCanonicalDevicePresentation/,
  "Frontend summaries must include one computed canonical_state and canonical_presentation",
);
expect(
  "src/device/runtime/deviceStateEnrichment.ts",
  /export type CanonicalDevicePresentation[\s\S]*availabilityReason[\s\S]*assignment[\s\S]*roomName[\s\S]*summary/,
  "Runtime enrichment must expose one canonical presentation contract for Consumer and Facility UI",
);
expect(
  "src/device/runtime/deviceStateEnrichment.ts",
  /function presentationSummary[\s\S]*Battery[\s\S]*Provider reports offline[\s\S]*Remote ready/,
  "Presentation summaries must be provider-neutral and device-specific",
);
expect(
  "src/services/deviceRuntimeStateService.ts",
  /room_name:[\s\S]*canonical_state: entry\.summary\.canonical_state[\s\S]*canonical_presentation: presentation/,
  "Runtime websocket payloads must carry canonical_state, canonical_presentation and room metadata",
);
expect(
  "src/services/deviceRuntimeStateService.ts",
  /deterministicJitterMs[\s\S]*refreshDeadline[\s\S]*provider_disconnected[\s\S]*nextRefreshAt[\s\S]*device_runtime_scheduler_tick[\s\S]*refresh_classes/,
  "Runtime scheduler must classify deadlines, jitter refreshes and log due/skipped behavior",
);
expect(
  "src/controllers/deviceRuntimeStateController.ts",
  /attachRoomNames[\s\S]*rooms[\s\S]*room_name[\s\S]*canonical_presentation: presentation/,
  "Runtime dashboard must resolve room names and return canonical presentation",
);
expect(
  "src/controllers/deviceStateController.ts",
  /withRoomName[\s\S]*room_name[\s\S]*canonical_presentation[\s\S]*presentation/,
  "Single-device state must resolve room names and return canonical presentation",
);
expect(
  "src/services/smartAccessCapabilityService.ts",
  /function lockOperationMatrix[\s\S]*bluetooth_unlock[\s\S]*fingerprint_enrol_delete[\s\S]*operation_matrix: lockOperationMatrix/,
  "Smart Access profiles must expose an operation matrix with native/physical blockers",
);
expect(
  "src/controllers/deviceRuntimeStateController.ts",
  /canonical_state: canonicalState[\s\S]*provider_requests: 0/,
  "Runtime dashboard must return canonical_state without provider reads",
);
expect(
  "src/controllers/deviceRuntimeStateController.ts",
  /isTechnicalDeviceHiddenFromResidents/,
  "Resident runtime dashboard must preserve technical-device hiding",
);
reject(
  "src/device/runtime/deviceStateEnrichment.ts",
  /deviceFamily === "lock"[\s\S]{0,160}controls\.add\("unlock"\)/,
  "Lock unlock must not be inferred directly from provider schema codes",
);

if (failures.length) {
  console.error("Device system enterprise smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Device system enterprise smoke passed.");
