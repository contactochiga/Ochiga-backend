#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

function readEnvFile() {
  const full = path.join(process.cwd(), ".env");
  if (!fs.existsSync(full)) return {};
  return Object.fromEntries(
    fs.readFileSync(full, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx), line.slice(idx + 1)];
      }),
  );
}

const fileEnv = readEnvFile();
const url = process.env.SUPABASE_URL || fileEnv.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("FAIL device schema smoke requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const cliVerified = new Set();
const cliColumnSets = {
  devices: ["parent_device_id", "is_virtual", "external_id"],
  wallet_transactions: ["reference", "status", "metadata"],
  notifications: ["delivery_channel"],
};

function cliColumnCheck(table, column) {
  if (cliVerified.has(`${table}:${column}`)) {
    console.log(`PASS ${table}.${column} (linked project)`);
    return;
  }
  const columns = cliColumnSets[table] || [column];
  execFileSync(
    "supabase",
    ["db", "query", "--linked", "-o", "csv", `select ${columns.join(", ")} from public.${table} limit 1;`],
    { cwd: process.cwd(), stdio: "pipe" },
  );
  columns.forEach((name) => cliVerified.add(`${table}:${name}`));
  console.log(`PASS ${table}.${column} (linked project)`);
}

async function ensureColumn(table, column) {
  let error = null;
  try {
    ({ error } = await Promise.race([
      supabase.from(table).select(column).limit(1),
      new Promise((_, reject) => setTimeout(() => reject(new Error("schema_check_timeout")), 5000)),
    ]));
  } catch (nextError) {
    error = nextError;
  }
  if (error) {
    const message = String(error.message || "");
    if (/invalid api key/i.test(message) || /jwt/i.test(message) || /not authenticated/i.test(message)) {
      try {
        cliColumnCheck(table, column);
        return;
      } catch (cliError) {
        console.error(`FAIL required column missing or unavailable: ${table}.${column}`);
        console.error(`  ${message}`);
        process.exit(1);
      }
    }
    console.error(`FAIL required column missing or unavailable: ${table}.${column}`);
    console.error(`  ${message}`);
    process.exit(1);
  }
  console.log(`PASS ${table}.${column}`);
}

await ensureColumn("devices", "parent_device_id");
await ensureColumn("devices", "is_virtual");
await ensureColumn("devices", "external_id");
await ensureColumn("wallet_transactions", "reference");
await ensureColumn("wallet_transactions", "status");
await ensureColumn("wallet_transactions", "metadata");
await ensureColumn("notifications", "delivery_channel");
