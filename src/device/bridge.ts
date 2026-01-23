// src/device/bridge.ts
import mqtt from "mqtt";
import { supabaseAdmin } from "../supabase/supabaseClient";

// ✅ Use IO registry (prevents circular imports)
import { getIO } from "../realtime/io";

// ✅ Convert incoming telemetry into control-plane signals
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import type { Signal } from "../core/control-plane/contracts/signal.types";

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

function safeJson(payload: Buffer) {
  const msg = payload.toString();
  try {
    return JSON.parse(msg);
  } catch {
    return { raw: msg };
  }
}

function emitLegacyDeviceUpdate(estateId: string | null, deviceId: string, state: any, topic: string) {
  // ✅ Keep backward compatibility for any existing dashboards listening to device:update
  const io = getIO();
  if (!io) return;

  if (estateId) {
    io.to(`estate:${estateId}`).emit("device:update", { deviceId, state, topic });
  } else {
    io.to(`device:${deviceId}`).emit("device:update", { deviceId, state, topic });
  }
}

function buildDeviceStateSignal(args: {
  estateId?: string | null;
  deviceId: string;
  state: any;
  source?: string;
}): Signal {
  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: args.source ?? "mqtt",
    type: "device.state.reported",
    timestamp: new Date().toISOString(),

    // payload (contract uses deviceId + state)
    deviceId: args.deviceId,
    state: args.state,

    // routing context (helps realtime subscriber target rooms)
    estateId: args.estateId ?? undefined,
  } as any;
}

export async function initMqttBridge() {
  return new Promise<void>((resolve) => {
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

      // ✅ Subscribe to both conventions:
      // 1) preferred: ochiga/estate/:estateId/device/:deviceId/state
      // 2) fallback older: ochiga/+/device/+/state
      client?.subscribe("ochiga/estate/+/device/+/state", { qos: 0 }, (err) => {
        if (err) console.error("MQTT subscribe error", err);
      });
      client?.subscribe("ochiga/+/device/+/state", { qos: 0 }, (err) => {
        if (err) console.error("MQTT subscribe error", err);
      });

      resolve();
    });

    client.on("message", async (topic, payload) => {
      try {
        const parsedTopic = parseTopic(topic);
        let estateId = parsedTopic.estateId;
        const deviceId = parsedTopic.deviceId;
        if (!deviceId) return;

        const status = safeJson(payload);

        // ✅ Persist state
        await supabaseAdmin
          .from("device_states")
          .upsert(
            {
              device_id: deviceId,
              status,
              last_seen: new Date().toISOString(),
            },
            { onConflict: "device_id" }
          );

        // If estate missing from topic, resolve it once
        if (!estateId) {
          const { data: device } = await supabaseAdmin
            .from("devices")
            .select("estate_id")
            .eq("id", deviceId)
            .limit(1)
            .single();

          estateId = device?.estate_id ?? null;
        }

        // ✅ 1) Emit legacy websocket event (backwards compatible)
        emitLegacyDeviceUpdate(estateId, deviceId, status, topic);

        // ✅ 2) Emit as Control-Plane signal (single truth)
        // This will also trigger your realtimeSubscriber (signal stream)
        await handleSignal(
          buildDeviceStateSignal({
            estateId,
            deviceId,
            state: status,
            source: "mqtt",
          })
        );
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
