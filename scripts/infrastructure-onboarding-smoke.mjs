#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260716234055_infrastructure_onboarding_engine.sql");
const service = read("src/infrastructure-onboarding/service.ts");
const providers = read("src/infrastructure-onboarding/providerRegistry.ts");
const routes = read("src/routes/infrastructureOnboarding.routes.ts");
const facilityRoutes = read("src/routes/facility.routes.ts");
const documentation = read("docs/infrastructure-onboarding-engine.md");

const checks = [
  ["staged session schema", /create table if not exists infrastructure_onboarding_sessions/i.test(migration)],
  ["candidate schema", /create table if not exists infrastructure_discovery_candidates/i.test(migration)],
  ["provider connection schema", /create table if not exists infrastructure_provider_connections/i.test(migration)],
  ["verification evidence schema", /create table if not exists infrastructure_onboarding_verifications/i.test(migration)],
  ["compatibility memory schema", /create table if not exists infrastructure_compatibility_observations/i.test(migration)],
  ["candidate identity uniqueness", /unique\s*\(session_id,\s*identity_key\)/i.test(migration)],
  ["provider connection uniqueness", /unique\s*\(estate_id,\s*provider_key,\s*connection_key\)/i.test(migration)],
  ["canonical building relationship", /homes[\s\S]*building_id uuid references estate_buildings\(id\)/i.test(migration)],
  ["service-role-only onboarding tables", /revoke all on table infrastructure_discovery_candidates from anon, authenticated/i.test(migration)],
  ["server role retains onboarding access", /grant select, insert, update, delete on table infrastructure_discovery_candidates to service_role/i.test(migration)],
  ["secret metadata sanitization", /pass\(word\)\?\|secret\|token\|credential\(\?!_ref\)/.test(service)],
  ["Edge credential references", /edge_credential_reference/.test(service) && /credential_ref/.test(service)],
  ["duplicate-safe candidate staging", /onConflict:\s*"session_id,identity_key"/.test(service)],
  ["canonical device promotion", /upsertCanonicalDeviceIdentity/.test(service)],
  ["Runtime V2 handoff", /deviceRuntimeStateService\.scheduleRefresh/.test(service)],
  ["verification gate", /candidate\.discovery_status !== "verified"/.test(service)],
  ["verification does not execute commands", !/verifyInfrastructureCandidate[\s\S]{0,9000}executeCommand\s*\(/.test(service)],
  ["Oyi Core signal emission", /emitSignal\(makeBaseSignal/.test(service)],
  ["partner attribution", /partner_id/.test(service) && /installer_id/.test(service)],
  ["Tuya active provider", /key:\s*"tuya"[\s\S]{0,200}implementation:\s*"active"/.test(providers)],
  ["ONVIF Edge provider", /key:\s*"onvif"[\s\S]{0,300}requires_edge:\s*true/.test(providers)],
  ["future providers explicit", ["matter", "homekit", "mqtt", "esphome", "modbus", "bacnet", "knx"].every((key) => providers.includes(`key: "${key}"`))],
  ["discovery lifecycle routes", ["/discover", "/import", "/verify", "/promote"].every((route) => routes.includes(route))],
  ["existing Facility route mount", /router\.use\("\/infrastructure\/onboarding"/.test(facilityRoutes)],
  ["no Deployment primary navigation", /does not add a `Deployment` navigation surface/.test(documentation)],
];

let failures = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failures += 1;
}

if (failures) {
  console.error(`Infrastructure onboarding smoke failed: ${failures} check(s).`);
  process.exit(1);
}

function readEnvFile() {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

const fileEnv = readEnvFile();
const supabaseUrl = process.env.SUPABASE_URL || fileEnv.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;
const liveColumns = [
  ["homes", "building_id"],
  ["infrastructure_partners", "id"],
  ["infrastructure_partner_members", "id"],
  ["infrastructure_onboarding_sessions", "onboarding_ref"],
  ["infrastructure_provider_connections", "authentication_status"],
  ["infrastructure_discovery_candidates", "identity_key"],
  ["infrastructure_onboarding_verifications", "checks"],
  ["infrastructure_onboarding_events", "event_type"],
  ["infrastructure_compatibility_observations", "outcome"],
];

let linkedFallbackRequired = !supabaseUrl || !serviceRoleKey;
if (!linkedFallbackRequired) {
  for (const [table, column] of liveColumns) {
    try {
      const response = await fetch(`${String(supabaseUrl).replace(/\/$/, "")}/rest/v1/${encodeURIComponent(table)}?select=${encodeURIComponent(column)}&limit=1`, {
        headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) {
        const detail = await response.text();
        if ([401, 403].includes(response.status)) {
          linkedFallbackRequired = true;
          break;
        }
        throw new Error(`${response.status} ${detail.slice(0, 160)}`);
      }
      console.log(`PASS live schema access ${table}.${column}`);
    } catch (error) {
      if (/timeout|fetch|network|abort/i.test(String(error?.message || error))) {
        linkedFallbackRequired = true;
        break;
      }
      console.error(`FAIL live schema access ${table}.${column}: ${error?.message || error}`);
      process.exit(1);
    }
  }
}

if (linkedFallbackRequired) {
  const predicates = liveColumns.map(([table, column]) => `(table_name = '${table}' and column_name = '${column}')`).join(" or ");
  try {
    const output = execFileSync(
      "supabase",
      ["db", "query", "--linked", "-o", "csv", `select table_name, column_name from information_schema.columns where table_schema = 'public' and (${predicates}) order by table_name, column_name;`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 },
    );
    for (const [table, column] of liveColumns) {
      if (!output.includes(table) || !output.includes(column)) throw new Error(`${table}.${column} was not returned by the linked schema`);
      console.log(`PASS live schema access ${table}.${column} (linked project)`);
    }
  } catch (error) {
    console.error(`FAIL linked infrastructure onboarding schema check: ${error?.message || error}`);
    process.exit(1);
  }
}

console.log(`Infrastructure onboarding smoke passed: ${checks.length} architecture checks and ${liveColumns.length} live schema checks.`);
