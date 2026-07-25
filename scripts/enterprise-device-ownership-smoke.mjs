import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

function expect(file, pattern, message) {
  const body = read(file);
  if (!pattern.test(body)) failures.push(`${file}: ${message}`);
}

expect(
  "supabase/migrations/20260725113000_enterprise_provider_connections_device_projection.sql",
  /create table if not exists public\.provider_connections[\s\S]*home_id uuid not null[\s\S]*provider_connections_active_home_account_uniq/,
  "provider connections must be home-scoped and unique per active provider account",
);
expect(
  "supabase/migrations/20260725113000_enterprise_provider_connections_device_projection.sql",
  /create table if not exists public\.device_access_grants[\s\S]*grant_type text not null/,
  "device access grants must exist for explicit view/control sharing",
);
expect(
  "src/services/tuyaRegistrySyncService.ts",
  /getHomeProviderConnection[\s\S]*provider_connection_id[\s\S]*ownership_class/,
  "Tuya sync must stamp provider connection and ownership metadata",
);
expect(
  "src/controllers/deviceCommandController.ts",
  /assertUnlockConfirmed[\s\S]*LOCK_UNLOCK_CONFIRMATION_REQUIRED/,
  "remote unlock must require explicit confirmation",
);
expect(
  "src/device/adapters/tuya/TuyaAdapter.ts",
  /wantsLock[\s\S]*remote_unlock[\s\S]*lock_switch/,
  "Tuya adapter must map lock commands before generic power commands",
);
expect(
  "src/server.ts",
  /socket\.on\("scope:replace"[\s\S]*socket\.leave\(room\)[\s\S]*home:/,
  "Socket scope replacement must leave previous home/estate rooms",
);
expect(
  "src/controllers/messagesController.ts",
  /onConflict: scope\.homeId \? "user_id,home_id" : "user_id"/,
  "Presence writes must be home-scoped when active home exists",
);

if (failures.length) {
  console.error("Enterprise device ownership smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Enterprise device ownership smoke passed.");
