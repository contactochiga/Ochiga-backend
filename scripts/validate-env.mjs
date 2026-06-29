#!/usr/bin/env node
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const cwd = process.cwd();
const sources = [".env", ".env.local"].map((name) => path.join(cwd, name)).filter((file) => fs.existsSync(file));
for (const file of sources) dotenv.config({ path: file, override: false });

function enabled(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "off", "no"].includes(raw);
}

const rules = [
  { name: "APP_JWT_SECRET", required: true, reason: "JWT signing and verification" },
  { name: "SUPABASE_URL", required: true, reason: "Supabase connectivity" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, reason: "Supabase privileged access" },
  {
    name: "RESEND_API_KEY",
    required: enabled("MAIL_ENABLED") || String(process.env.EMAIL_DELIVERY_PROVIDER || "").toLowerCase() === "resend",
    reason: "mail delivery when resend is enabled",
  },
  {
    name: "REDIS_URL",
    required: enabled("REDIS_ENABLED", true),
    reason: "queue/runtime cache connectivity",
  },
  {
    name: "TUYA_ACCESS_ID",
    required: enabled("TUYA_ENABLED") || Boolean(process.env.TUYA_ACCESS_SECRET || process.env.TUYA_BASE_URL),
    reason: "Tuya provider enablement",
  },
  {
    name: "TUYA_ACCESS_SECRET",
    required: enabled("TUYA_ENABLED") || Boolean(process.env.TUYA_ACCESS_ID || process.env.TUYA_BASE_URL),
    reason: "Tuya provider enablement",
  },
  {
    name: "TUYA_BASE_URL",
    required: enabled("TUYA_ENABLED") || Boolean(process.env.TUYA_ACCESS_ID || process.env.TUYA_ACCESS_SECRET),
    reason: "Tuya provider enablement",
  },
  {
    name: "MQTT_URL",
    required: enabled("MQTT_ENABLED") || Boolean(process.env.MQTT_URL),
    reason: "MQTT bridge enablement",
  },
];

const checks = rules.map((rule) => {
  const value = String(process.env[rule.name] || "").trim();
  const present = Boolean(value);
  const valid =
    !rule.required ||
    present;
  return { ...rule, present, valid };
});

const criticalFailures = [];
for (const check of checks) {
  const state = check.valid ? "PASS" : "FAIL";
  console.log(`${state} ${check.name} ${check.required ? "(required)" : "(optional)"} - ${check.reason}`);
  if (!check.valid) criticalFailures.push(check.name);
}

if (String(process.env.APP_JWT_SECRET || "").trim() && String(process.env.APP_JWT_SECRET || "").trim().length < 24) {
  console.log("FAIL APP_JWT_SECRET length - should be at least 24 characters");
  criticalFailures.push("APP_JWT_SECRET:length");
}

if (!String(process.env.MQTT_URL || "").trim() && (String(process.env.MQTT_USERNAME || "").trim() || String(process.env.MQTT_PASSWORD || "").trim())) {
  console.log("WARN MQTT credentials are present without MQTT_URL; bridge will remain disabled until a broker URL is set.");
}

process.exit(criticalFailures.length ? 1 : 0);
