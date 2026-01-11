// src/device/bridge.ts
import mqtt from "mqtt";
import { io } from "../server";
import { supabaseAdmin } from "../supabase/supabaseClient";

const MQTT_URL = process.env.MQTT_URL || "";
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined;

let client: mqtt.MqttClient | null = null;

function parseTopic(topic: string) {
  // expected topic: ochiga/estate/:estateId/device/:deviceId/state
  const parts = topic.split("/");
  const idx = parts.indexOf("estate");
  if (idx === -1) return { estateId: null, deviceId: null, channel: null };
  return {
    estateId: parts[idx + 1] || null,
    deviceId: parts[idx + 3] || null,
    channel: parts[parts.length - 1] || null,
  };
}

export async function initMqttBridge() {
  return new Promise<void>((resolve, reject) => {
    if (!MQTT_URL) {
      console.warn("MQTT_URL not set — MQTT bridge disabled");
      return resolve();
    }

    client = mqtt.connect(MQTT_URL, {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      reconnectPeriod: 3000,
    });

    client.on("connect", () => {
      console.log("MQTT connected to", MQTT_URL);
      // subscribe to convention
      client?.subscribe("ochiga/+/device/+/state", { qos: 0 }, (err) => {
        if (err) console.error("MQTT subscribe error", err);
      });
      resolve();
    });

    client.on("message", async (topic, payload) => {
      try {
        const parsedTopic = parseTopic(topic);
        const estateId = parsedTopic.estateId;
        const deviceId = parsedTopic.deviceId;
        if (!deviceId) return;
        const msg = payload.toString();
        let status: any;
        try {
          status = JSON.parse(msg);
        } catch {
          status = { raw: msg };
        }

        // upsert device_states
        await supabaseAdmin.from("device_states").upsert(
          {
            device_id: deviceId,
            status,
            last_seen: new Date().toISOString(),
          },
          { onConflict: "device_id" }
        );

        // emit to websocket clients in estate room
        if (estateId) {
          io.to(`estate:${estateId}`).emit("device:update", { deviceId, state: status, topic });
        } else {
          // fallback: try to find estate for device
          const { data: device } = await supabaseAdmin.from("devices").select("estate_id").eq("id", deviceId).limit(1).single();
          if (device?.estate_id) {
            io.to(`estate:${device.estate_id}`).emit("device:update", { deviceId, state: status, topic });
          }
        }
      } catch (err) {
        console.error("Error processing MQTT message", err);
      }
    });

    client.on("error", (err) => {
      console.error("MQTT error", err);
    });
  });
}

export function publishDeviceAction(topic: string, command: any) {
  if (!client) {
    console.warn("MQTT client not initialized; cannot publish", topic, command);
    return;
  }
  try {
    const payload = typeof command === "string" ? command : JSON.stringify(command);
    client.publish(topic, payload, { qos: 0 }, (err) => {
      if (err) console.error("Publish error", err);
    });
  } catch (err) {
    console.error("publishDeviceAction err", err);
  }
}
