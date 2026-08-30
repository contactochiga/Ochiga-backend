// src/config/env.ts
import dotenv from "dotenv";
dotenv.config();

export type EnvValidationRule = {
  name: string;
  required: boolean;
  description: string;
  enabledWhen?: () => boolean;
};

// Safely read environment variables
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.warn(`⚠️ Environment variable ${name} is missing.`);
    return "";
  }
  return value;
}

// -------------------------------------------
// PORT CONFIG — safe and strict
// -------------------------------------------
export const PORT: number = process.env.PORT
  ? Number(process.env.PORT)
  : 5000;

// -------------------------------------------
// SUPABASE CONFIG
// -------------------------------------------
export const SUPABASE_URL = requireEnv("SUPABASE_URL");
export const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
export const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// -------------------------------------------
// JWT
// -------------------------------------------
export const APP_JWT_SECRET = requireEnv("APP_JWT_SECRET");

export const ENV_VALIDATION_RULES: EnvValidationRule[] = [
  { name: "APP_JWT_SECRET", required: true, description: "JWT signing and verification secret" },
  { name: "SUPABASE_URL", required: true, description: "Supabase project URL" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, description: "Supabase service role key" },
  {
    name: "RESEND_API_KEY",
    required: false,
    description: "Resend mail delivery API key",
    enabledWhen: () =>
      String(process.env.MAIL_ENABLED || "").toLowerCase() === "true" ||
      String(process.env.EMAIL_DELIVERY_PROVIDER || "").toLowerCase() === "resend",
  },
  {
    name: "REDIS_URL",
    required: false,
    description: "Redis queue/runtime cache connection string",
    enabledWhen: () => String(process.env.REDIS_ENABLED || "true").toLowerCase() !== "false",
  },
  {
    name: "TUYA_ACCESS_ID",
    required: false,
    description: "Tuya access id",
    enabledWhen: () =>
      String(process.env.TUYA_ENABLED || "").toLowerCase() === "true" ||
      Boolean(process.env.TUYA_ACCESS_SECRET || process.env.TUYA_BASE_URL),
  },
  {
    name: "TUYA_ACCESS_SECRET",
    required: false,
    description: "Tuya access secret",
    enabledWhen: () =>
      String(process.env.TUYA_ENABLED || "").toLowerCase() === "true" ||
      Boolean(process.env.TUYA_ACCESS_ID || process.env.TUYA_BASE_URL),
  },
  {
    name: "TUYA_BASE_URL",
    required: false,
    description: "Tuya base URL",
    enabledWhen: () =>
      String(process.env.TUYA_ENABLED || "").toLowerCase() === "true" ||
      Boolean(process.env.TUYA_ACCESS_ID || process.env.TUYA_ACCESS_SECRET),
  },
  {
    name: "MQTT_URL",
    required: false,
    description: "MQTT broker URL",
    enabledWhen: () =>
      String(process.env.MQTT_ENABLED || "").toLowerCase() === "true" ||
      Boolean(process.env.MQTT_URL),
  },
  {
    name: "WEATHER_API_KEY",
    required: false,
    description: "OpenWeatherMap API key for Facility Environment weather (src/services/weather). Absence is handled gracefully -- Environment reports weather as unavailable rather than failing.",
  },
];

export function getEnvValidationReport() {
  const report = ENV_VALIDATION_RULES.map((rule) => {
    const active = rule.required || (rule.enabledWhen ? rule.enabledWhen() : false);
    const value = String(process.env[rule.name] || "").trim();
    return {
      name: rule.name,
      description: rule.description,
      active,
      present: Boolean(value),
      required: rule.required,
    };
  });

  return {
    ok: report.every((item) => !item.active || item.present),
    items: report,
  };
}

export function validateRuntimeEnv(options: { strict?: boolean } = {}) {
  const report = getEnvValidationReport();
  const missing = report.items.filter((item) => item.active && !item.present);
  if (missing.length && options.strict) {
    throw new Error(`Missing required environment variables: ${missing.map((item) => item.name).join(", ")}`);
  }
  return report;
}

// -------------------------------------------
// UTILITY — consistent port log
// -------------------------------------------
export function logPortBinding(port: number) {
  console.log(`🚀 Ochiga backend is listening on http://0.0.0.0:${port}`);
}
