import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Math.max(1, Math.min(50_000, Number(limitArg?.split("=")[1] || 10_000)));

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error(JSON.stringify({ ok: false, error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required" }, null, 2));
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function text(value) {
  const next = String(value ?? "").trim();
  return next || null;
}

function accountPayload(home, serviceKey, identifier, existing) {
  const existingMetadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
  const meterId = serviceKey === "internet_service" ? null : identifier;
  return {
    estate_id: home.estate_id,
    home_id: home.id,
    service_key: serviceKey,
    provider: text(existing?.provider),
    account_ref: text(existing?.account_ref) || identifier,
    meter_id: text(existing?.meter_id) || meterId,
    plan: text(existing?.plan),
    status: text(existing?.status) || "active",
    linked: true,
    metadata: {
      ...existingMetadata,
      provisioned_from: existingMetadata.provisioned_from || "legacy_home_identifier_backfill",
      legacy_home_identifier_backfill_seen_at: new Date().toISOString(),
      provider_integration_mode:
        serviceKey === "utility_token"
          ? existingMetadata.provider_integration_mode || "authorized_vending_provider"
          : existingMetadata.provider_integration_mode || null,
    },
    updated_at: new Date().toISOString(),
  };
}

function expectedForHome(home) {
  const rows = [];
  const electricity = text(home.electricity_meter);
  const water = text(home.water_meter);
  const internet = text(home.internet_id);
  if (electricity) rows.push({ serviceKey: "utility_token", identifier: electricity });
  if (water) rows.push({ serviceKey: "water_service", identifier: water });
  if (internet) rows.push({ serviceKey: "internet_service", identifier: internet });
  rows.push({ serviceKey: "service_charge", identifier: String(home.id) });
  rows.push({ serviceKey: "other_facility_fees", identifier: String(home.id) });
  return rows;
}

const { data: homes, error: homesError } = await supabase
  .from("homes")
  .select("id, estate_id, name, block, unit, resident_id, electricity_meter, water_meter, internet_id")
  .limit(limit);

if (homesError) {
  console.error(JSON.stringify({ ok: false, error: homesError.message, code: homesError.code }, null, 2));
  process.exit(1);
}

const homeIds = (homes || []).map((home) => home.id).filter(Boolean);
let accounts = [];
if (homeIds.length) {
  const { data, error } = await supabase
    .from("home_service_accounts")
    .select("id, home_id, service_key, provider, account_ref, meter_id, plan, status, linked, metadata")
    .in("home_id", homeIds);
  if (error) {
    console.error(JSON.stringify({ ok: false, error: error.message, code: error.code }, null, 2));
    process.exit(1);
  }
  accounts = data || [];
}

const byHomeKey = new Map(accounts.map((account) => [`${account.home_id}:${account.service_key}`, account]));
const planned = [];
const conflicts = [];

for (const home of homes || []) {
  for (const expected of expectedForHome(home)) {
    const existing = byHomeKey.get(`${home.id}:${expected.serviceKey}`);
    const existingIdentifier = text(existing?.meter_id) || text(existing?.account_ref);
    if (existingIdentifier && existingIdentifier !== expected.identifier) {
      conflicts.push({
        home_id: home.id,
        estate_id: home.estate_id,
        service_key: expected.serviceKey,
        legacy_identifier_present: true,
        canonical_identifier_present: true,
      });
      continue;
    }
    if (!existing || !existingIdentifier || existing.linked !== true) {
      planned.push(accountPayload(home, expected.serviceKey, expected.identifier, existing));
    }
  }
}

let repaired = 0;
if (apply && planned.length) {
  const { data, error } = await supabase
    .from("home_service_accounts")
    .upsert(planned, { onConflict: "home_id,service_key" })
    .select("id");
  if (error) {
    console.error(JSON.stringify({ ok: false, error: error.message, code: error.code, planned: planned.length }, null, 2));
    process.exit(1);
  }
  repaired = data?.length || planned.length;
}

console.log(JSON.stringify({
  ok: true,
  mode: apply ? "apply" : "dry_run",
  homes_checked: homes?.length || 0,
  planned_repairs: planned.length,
  repaired,
  conflicts: conflicts.length,
  conflict_samples: conflicts.slice(0, 25),
}, null, 2));
