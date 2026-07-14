// src/mqtt.ts
import mqtt, { MqttClient } from "mqtt";

/* ---------------------------------------
 * ENV VALIDATION (FAIL FAST)
 * ------------------------------------- */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`❌ Missing required env var: ${name}`);
  }
  return value;
}

function requireNumber(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (!raw && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`❌ Env var ${name} must be a number`);
  }
  return value;
}

const MQTT_HOST = requireEnv("MQTT_HOST");
const MQTT_PORT = requireNumber("MQTT_PORT", 8883);
const MQTT_USERNAME = requireEnv("MQTT_USERNAME");
const MQTT_PASSWORD = requireEnv("MQTT_PASSWORD");
const MQTT_CLIENT_ID =
  process.env.MQTT_CLIENT_ID || "ochiga_event_processor";

/* ---------------------------------------
 * CONNECTION URL (RECOMMENDED)
 * ------------------------------------- */
const MQTT_URL = `mqtts://${MQTT_HOST}:${MQTT_PORT}`;

// Security: TLS certificate verification behavior lives in src/config/mqttTls.ts
// so other modules (e.g. device/bridge.ts) can import it without triggering the
// env-validating side effects of this module.
export { resolveMqttTlsOptions } from "./config/mqttTls";
import { resolveMqttTlsOptions } from "./config/mqttTls";

/* ---------------------------------------
 * CLIENT (NO AUTO RECONNECT IN DEV)
 * ------------------------------------- */
export const mqttClient: MqttClient = mqtt.connect(MQTT_URL, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  clientId: MQTT_CLIENT_ID,

  // ⛔ disable silent infinite loops
  reconnectPeriod: 0,

  // Fail fast
  connectTimeout: 15_000,

  // TLS for HiveMQ Cloud (certificate verification enforced in production)
  ...resolveMqttTlsOptions(),
});

/* ---------------------------------------
 * EVENTS
 * ------------------------------------- */
mqttClient.on("connect", () => {
  console.log(`🟢 MQTT connected → ${MQTT_URL}`);
});

mqttClient.on("error", (err) => {
  console.error("🔴 MQTT connection error:", err.message);
  mqttClient.end(true); // stop completely
});

mqttClient.on("close", () => {
  console.warn("🟠 MQTT connection closed");
});
