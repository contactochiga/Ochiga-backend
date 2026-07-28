import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const visibility = read("src/services/deviceInventoryVisibility.ts");
const tuyaSync = read("src/services/tuyaRegistrySyncService.ts");
const irController = read("src/controllers/deviceIrController.ts");
const runtimeController = read("src/controllers/deviceRuntimeStateController.ts");
const estateController = read("src/controllers/deviceEstateController.ts");
const runtimeService = read("src/services/deviceRuntimeService.ts");
const stateService = read("src/services/deviceRuntimeStateService.ts");
const stateController = read("src/controllers/deviceStateController.ts");
const canonicalReadResolver = read("src/services/canonicalDeviceReadResolver.ts");
const migration = read("supabase/migrations/20260722093000_tuya_ir_inventory_stabilization.sql");
const tuyaAdapter = read("src/device/adapters/tuya/TuyaAdapter.ts");
const enrichment = read("src/device/runtime/deviceStateEnrichment.ts");

assert(/isTuyaProviderVirtualRemote/.test(visibility), "technical Tuya provider virtual remotes are classified centrally");
assert(/isObsoleteIrChild/.test(visibility), "obsolete IR child devices are classified centrally");
assert(/resolveCanonicalIrChildForProviderRemote/.test(visibility), "stale provider remote rows can resolve to canonical IR children");

assert(/provider_virtual_remote/.test(tuyaSync), "Tuya sync marks provider virtual remotes as technical records");
assert(/isProviderVirtualRemoteDiscovery/.test(tuyaSync), "Tuya sync detects raw infrared_tv/infrared_ac discoveries");
assert(/existing as any\)\?\.is_virtual/.test(tuyaSync), "Tuya sync does not mark synthetic IR children unavailable during top-level reconciliation");

assert(/sync_state:\s*hub\.home_id \? "assigned" : "available_unassigned"/.test(irController), "IR child sync restores assigned sync state");
assert(/is_managed_disabled:\s*false/.test(irController), "IR child sync keeps canonical appliances resident-visible");
assert(/remote_id:\s*profile\.remote_id/.test(irController), "IR children persist provider remote_id");

assert(/isTechnicalDeviceHiddenFromResidents/.test(runtimeController), "Runtime dashboard hides technical IR records from resident runtime inventory");
assert(/isTechnicalDeviceHiddenFromResidents/.test(estateController), "Estate device list hides technical IR records from resident inventory");
assert(/resolveCanonicalIrChildForProviderRemote/.test(runtimeService), "Command resolution can recover stale provider remote targets");
assert(/provider_virtual:\s*true/.test(stateService), "Runtime refresh avoids provider reads for virtual IR appliances");
assert(/resolveCanonicalDeviceForRead/.test(stateController), "State reads use the canonical device read resolver");
assert(/resolveCanonicalIrChildForProviderRemote/.test(canonicalReadResolver), "Canonical state reads resolve stale provider remote rows to canonical children");

assert(/infrared_tv/.test(migration) && /infrared_ac/.test(migration), "Migration repairs existing raw Tuya IR TV/AC remote rows");
assert(/obsolete_ir_profile/.test(migration), "Migration marks unbound historical IR child profiles obsolete");
assert(/resident_visible', true/.test(migration), "Migration restores canonical IR children as resident-visible");
assert(/jtmspro:\s*"lock"/.test(tuyaAdapter), "Tuya discovery maps jtmspro smart-lock category to lock family");
assert(/jtmspro:\s*"lock"/.test(enrichment), "Runtime enrichment maps jtmspro smart-lock category to lock family");

if (process.exitCode) process.exit(process.exitCode);
