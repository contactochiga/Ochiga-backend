import fs from "fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
}

const provisioning = read("src/services/homeServiceProvisioning.ts");
const servicesController = read("src/controllers/servicesController.ts");
const migration = read("supabase/migrations/20260718125719_repair_home_service_account_provisioning.sql");
const backfill = read("scripts/backfill-home-service-accounts.mjs");

assert(/create unique index if not exists idx_home_service_accounts_home_service_key_uniq/i.test(migration), "repair migration enforces home/service account identity");
assert(/legacy_home_identifier_backfill/i.test(migration), "repair migration backfills legacy home identifiers");
assert(/where not exists \([\s\S]*home_service_assignments existing/i.test(migration), "repair migration avoids duplicate assignment rows");
assert(/on conflict \(home_id, service_key\) do update/i.test(migration), "repair migration updates missing canonical account identifiers idempotently");

assert(/expectedForHome\(home\)/.test(backfill), "operational backfill derives expected accounts from homes");
assert(/mode: apply \? "apply" : "dry_run"/.test(backfill), "operational backfill defaults to dry-run mode");
assert(/upsert\(planned, \{ onConflict: "home_id,service_key" \}\)/.test(backfill), "operational backfill uses canonical home/service upsert");
assert(/conflict_samples/.test(backfill), "operational backfill reports identifier conflicts");

assert(/readExistingHomeServiceAccounts/.test(provisioning), "home provisioning preserves existing canonical accounts");
assert(/readHomeProvisioningRecord/.test(provisioning), "home provisioning can read stored home identifiers from canonical home records");
assert(/service_charge[\s\S]*other_facility_fees/.test(provisioning), "home provisioning includes fee service accounts");
assert(/provisioned_from: "home_workflow"/.test(provisioning), "home provisioning marks canonical workflow metadata");

assert(/consumer_services_scope_resolution/.test(servicesController), "resident service reads emit scoped provisioning diagnostics");
assert(/service_accounts_unavailable/.test(servicesController), "service account failures return typed public errors");
assert(/readHomeServiceAccountsSafe/.test(servicesController), "home registry tolerates secondary service-account read failures");

if (process.exitCode) process.exit(process.exitCode);
