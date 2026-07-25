import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

function expect(file, pattern, message) {
  const body = read(file);
  if (!pattern.test(body)) failures.push(`${file}: ${message}`);
}

expect(
  "supabase/migrations/20260725143000_smart_access_device_capabilities.sql",
  /create table if not exists public\.smart_access_capability_snapshots[\s\S]*raw_fingerprint[\s\S]*smart_access_capability_snapshots_device_fingerprint_uidx/,
  "smart access capability snapshots must be versioned and idempotent",
);
expect(
  "supabase/migrations/20260725143000_smart_access_device_capabilities.sql",
  /create table if not exists public\.smart_access_records[\s\S]*home_id uuid[\s\S]*deduplication_key/,
  "access records must be home-scoped and deduplicated",
);
expect(
  "src/device/adapters/DeviceAdapter.ts",
  /discoverCapabilities\?[\s\S]*readSmartAccessState\?[\s\S]*createCredential\?/,
  "provider adapters must expose optional smart-access hooks through the canonical adapter interface",
);
expect(
  "src/device/adapters/tuya/TuyaAdapter.ts",
  /async discoverCapabilities[\s\S]*tuya_smart_access_capability_evidence[\s\S]*function_codes/,
  "Tuya smart-access capability evidence must stay behind the adapter",
);
expect(
  "src/services/smartAccessCapabilityService.ts",
  /CapabilityStatus[\s\S]*temporarily_unavailable[\s\S]*permission_denied[\s\S]*setup_incomplete/,
  "capability states must distinguish unknown, unavailable and permission/setup states",
);
expect(
  "src/services/smartAccessCapabilityService.ts",
  /media:\s*\{[\s\S]*live_view: status\(mediaCodes\.length \? providerStatus : "unsupported"/,
  "media must be unsupported unless provider evidence confirms it",
);
expect(
  "src/services/smartAccessCapabilityService.ts",
  /batteryPercentage[\s\S]*batteryPercentage <= 20/,
  "battery-low handling must use normalized smart-access state",
);
expect(
  "src/controllers/smartAccessController.ts",
  /resolveScopedDevice[\s\S]*home_id[\s\S]*This device is outside the active home/,
  "smart-access routes must enforce active home scope server-side",
);
expect(
  "src/controllers/smartAccessController.ts",
  /smart_access_media_unsupported/,
  "media sessions must fail honestly when unsupported",
);
expect(
  "src/routes/devices.ts",
  /:deviceId\/smart-access[\s\S]*:deviceId\/smart-access\/credentials[\s\S]*:deviceId\/command/,
  "smart-access routes must live under canonical devices before command/state fallthrough",
);
expect(
  "src/services/tuyaRegistrySyncService.ts",
  /persistSmartAccessSnapshot[\s\S]*tuya_registry_sync/,
  "Tuya discovery must refresh smart-access snapshots without duplicating the registry",
);

if (failures.length) {
  console.error("Smart Access runtime smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

for (const query of [
  "select id, device_id, capabilities, raw_fingerprint from public.smart_access_capability_snapshots limit 1;",
  "select id, device_id, event_type, home_id from public.smart_access_records limit 1;",
  "select id, device_id, credential_type, status from public.smart_access_credentials limit 1;",
]) {
  try {
    execFileSync("supabase", ["db", "query", "--linked", "-o", "csv", query], { cwd: root, stdio: "pipe" });
  } catch (error) {
    failures.push(`linked schema query failed: ${query}`);
  }
}

if (failures.length) {
  console.error("Smart Access runtime smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Smart Access runtime smoke passed.");
