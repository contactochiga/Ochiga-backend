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
  /CapabilityStatus[\s\S]*temporarily_unavailable[\s\S]*permission_denied[\s\S]*setup_incomplete[\s\S]*provider_declared_only[\s\S]*mapping_missing[\s\S]*verification_required/,
  "capability states must distinguish declared, readable, executable and verification states",
);
expect(
  "src/services/smartAccessCapabilityService.ts",
  /declaredByProvider[\s\S]*readableByOyi[\s\S]*executableByOyi[\s\S]*liveVerified/,
  "capability evidence must preserve declaration, readability, executability and live verification",
);
expect(
  "src/services/smartAccessCapabilityService.ts",
  /remoteUnlockExecutableCode[\s\S]*mapping_missing[\s\S]*Provider schema declares unlock methods/,
  "remote unlock must be mapping_missing when only provider schema declares it",
);
{
  const smartAccessService = read("src/services/smartAccessCapabilityService.ts");
  if (
    !/lockOperationMatrix[\s\S]*remote_unlock[\s\S]*custom_pin[\s\S]*time_limited_pin[\s\S]*one_time_pin[\s\S]*fingerprint_enrol_delete/.test(smartAccessService) ||
    !/native_sdk_required/.test(smartAccessService) ||
    !/physical_confirmation_required/.test(smartAccessService)
  ) {
    failures.push("src/services/smartAccessCapabilityService.ts: smart-lock operation matrix must separate cloud executable, native/BLE and physical-interaction requirements");
  }
}
expect(
  "src/services/smartAccessCapabilityService.ts",
  /smartAccessSupportedControls[\s\S]*executableByOyi === true[\s\S]*readableByOyi === true/,
  "supported controls must be derived from executable/readable evidence, not code presence",
);
expect(
  "src/services/smartAccessCapabilityService.ts",
  /residual_electricity[\s\S]*batteryPercentage <= 20[\s\S]*critical/,
  "battery-low handling must map residual_electricity into normalized critical state",
);
expect(
  "src/device/runtime/deviceStateEnrichment.ts",
  /Sensitive access controls are exposed only by the Smart Access evidence/,
  "generic runtime enrichment must not expose lock/unlock controls from schema presence",
);
expect(
  "src/device/adapters/tuya/TuyaAdapter.ts",
  /desiredLocked[\s\S]*\? \["lock", "remote_lock"\][\s\S]*: \["unlock", "remote_unlock"\]/,
  "Tuya lock commands must only target explicit remote lock/unlock mappings",
);
expect(
  "src/controllers/smartAccessController.ts",
  /resolveScopedDevice[\s\S]*home_id[\s\S]*This device is outside the active home/,
  "smart-access routes must enforce active home scope server-side",
);
expect(
  "src/controllers/smartAccessController.ts",
  /loadDeviceStateRow[\s\S]*device_states[\s\S]*getSmartAccessProfileForDevice\(device, \{ refresh,[\s\S]*stateRow/,
  "smart-access routes must enrich profiles from the latest runtime state row",
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
  "src/routes/signals.ts",
  /resolveRequestContext[\s\S]*requestDeviceCommand/,
  "legacy signal device-command route must delegate into the canonical device command runtime",
);
expect(
  "src/controllers/deviceCommandController.ts",
  /assertContextPayloadMatches[\s\S]*COMMAND_HOME_CONTEXT_MISMATCH[\s\S]*accepted: false/,
  "device commands must reject stale scope and return a non-accepted envelope",
);
expect(
  "src/services/deviceOperationalSignalService.ts",
  /privateDeviceDomain[\s\S]*ownership_class[\s\S]*hasHomeScope[\s\S]*smart_access_private[\s\S]*resident_device_private/,
  "routine resident smart-access events must use canonical home/ownership scope for the private smart-access domain",
);
expect(
  "src/oyi-core/runtime/universalSignalRuntime.ts",
  /smart_access_private[\s\S]*resident_device_private[\s\S]*return \["activity"\]/,
  "routine resident-owned device events must avoid facility registry, reports and digital twin outputs",
);
expect(
  "src/services/deviceRuntimeStateService.ts",
  /estate_id: device\?\.estate_id[\s\S]*home_id: device\?\.home_id[\s\S]*ownership_class/,
  "Runtime V2 state signals must carry canonical device scope into private-routing policy",
);
expect(
  "src/oyi-core/service.ts",
  /oyi_signal_duplicates_prevented_total[\s\S]*signal_rejected_before_reasoning|signal_rejected_before_reasoning[\s\S]*oyi_signal_duplicates_prevented_total/,
  "duplicate signals must be rejected before reasoning and side effects",
);
expect(
  "src/core/control-plane/index.ts",
  /runtimeEnvelope\?\.receipt\?\.accepted === false[\s\S]*return runtimeEnvelope/,
  "control-plane dispatch must stop before subscribers for rejected duplicate signals",
);
expect(
  "supabase/migrations/20260725165000_presence_home_scope_conflict_repair.sql",
  /user_presence_user_home_key[\s\S]*unique \(user_id, home_id\)/,
  "presence migration must add a real home-scoped unique constraint for upsert",
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

const skipLinked = process.argv.includes("--skip-linked") || process.env.SMART_ACCESS_SKIP_LINKED === "1";
if (skipLinked) {
  console.log("Smart Access runtime smoke passed.");
  process.exit(0);
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
