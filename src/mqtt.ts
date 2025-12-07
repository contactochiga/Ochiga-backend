// src/mqtt.ts
import mqtt from "mqtt";

const host = process.env.MQTT_HOST;
const port = Number(process.env.MQTT_PORT || 8883);
const username = process.env.MQTT_USERNAME;
const password = process.env.MQTT_PASSWORD;
const clientId = process.env.MQTT_CLIENT_ID || "ochiga_event_processor";

if (!host) {
  console.error("❌ MQTT_HOST is missing in environment variables");
}

export const mqttClient = mqtt.connect({
  host,
  port,
  protocol: "mqtts",        // TLS required for HiveMQ Cloud
  username,
  password,
  clientId,
  reconnectPeriod: 2000,
  connectTimeout: 30000,
});

mqttClient.on("connect", () => {
  console.log(`✅ Connected to HiveMQ Cloud MQTT at ${host}:${port}`);
});

mqttClient.on("error", (err) => {
  console.error("❌ MQTT client error:", err.message);
});

mqttClient.on("reconnect", () => {
  console.log("🔄 Reconnecting to HiveMQ Cloud...");
});
