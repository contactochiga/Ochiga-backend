// src/device/bridge.ts
import mqtt from "mqtt";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { NotificationService } from "../services/NotificationService";
import { emitAuditEvent } from "../core/foundation";

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

function isTruthySwitch(status: any) {
  if (!status || typeof status !== "object") return false;
  for (const key of ["switch", "power", "on", "running", "enabled"]) {
    if ((status as any)[key] === true) return true;
  }
  if (status.last_command && typeof status.last_command === "object") {
    return isTruthySwitch(status.last_command);
  }
  return Object.entries(status).some(([key, value]) => /^switch(_\d+)?$/i.test(String(key)) && value === true);
}

function normalizeSource(value: any): "oyi_app" | "physical_switch" | "provider_app" | "watch" | "automation" | "scene" | "facility" | "system" {
  const text = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (/physical|wall|manual|local|button/.test(text)) return "physical_switch";
  if (/smart_life|tuya_app|provider_app|provider|tuya/.test(text)) return "provider_app";
  if (/watch|watchos/.test(text)) return "watch";
  if (/automation/.test(text)) return "automation";
  if (/scene/.test(text)) return "scene";
  if (/facility|operator|admin/.test(text)) return "facility";
  if (/oyi|consumer|app|user/.test(text)) return "oyi_app";
  return "system";
}

function sourceFromPayload(status: any, topic: string) {
  const meta = status?.metadata || status?.meta || {};
  return normalizeSource(
    status?.source ||
    status?.control_source ||
    status?.event_source ||
    status?.origin ||
    meta?.source ||
    meta?.control_source ||
    topic
  );
}

function didMeaningfulStateChange(prev: any, next: any) {
  const prevOn = isTruthySwitch(prev);
  const nextOn = isTruthySwitch(next);
  if (prevOn !== nextOn) {
    return {
      changed: true,
      title: nextOn ? "Device turned on" : "Device turned off",
      message: nextOn ? "A connected device is now active." : "A connected device is no longer active.",
      kind: nextOn ? "device.state.on" : "device.state.off",
    };
  }

  const prevOnline = prev?.online;
  const nextOnline = next?.online;
  if (typeof prevOnline === "boolean" && typeof nextOnline === "boolean" && prevOnline !== nextOnline) {
    return {
      changed: true,
      title: nextOnline ? "Device back online" : "Device offline",
      message: nextOnline ? "A connected device is reporting again." : "A connected device has gone offline.",
      kind: nextOnline ? "device.state.online" : "device.state.offline",
    };
  }

  return { changed: false };
}

async function recentDeviceActivityExists(userId: string, deviceId: string, kind: string) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id,payload")
    .eq("user_id", userId)
    .eq("type", "device")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return false;
  return (data || []).some((row: any) => {
    const payload = row?.payload || {};
    return String(payload?.device_id || "") === String(deviceId) && String(payload?.kind || "") === kind;
  });
}

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
  homeId?: string | null;
  roomId?: string | null;
  event?: Record<string, any>;
}): Signal {
  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: args.source ?? "mqtt",
    type: "device.state.reported",
    timestamp: new Date().toISOString(),

    // payload (contract uses deviceId + state)
    deviceId: args.deviceId,
    state: args.state,
    homeId: args.homeId ?? undefined,
    roomId: args.roomId ?? undefined,
    event: args.event,

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
        const occurredAt = new Date().toISOString();
        const eventSource = sourceFromPayload(status, topic);
        const providerEventId = String(status?.provider_event_id || status?.event_id || status?.id || "");
        const { data: previousState } = await supabaseAdmin
          .from("device_states")
          .select("status")
          .eq("device_id", deviceId)
          .maybeSingle();

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

        const { data: device } = await supabaseAdmin
          .from("devices")
          .select("id,name,estate_id,home_id,room_id,category,type,external_id")
          .eq("id", deviceId)
          .limit(1)
          .single();

        if (!estateId) {
          estateId = device?.estate_id ?? null;
        }

        const previousStatus = previousState?.status || {};
        const change = didMeaningfulStateChange(previousStatus, status);
        const normalizedEvent = {
          device_id: String(deviceId),
          home_id: String(device?.home_id || ""),
          room_id: String(device?.room_id || ""),
          event_type: String((change as any).kind || "device.state.reported"),
          previous_state: previousStatus,
          new_state: status,
          source: eventSource,
          actor_id: null,
          occurred_at: occurredAt,
          latency_ms: null,
          provider_event_id: providerEventId || null,
          metadata: {
            topic,
            estate_id: String(device?.estate_id || estateId || ""),
            device_name: String(device?.name || ""),
            category: String(device?.category || device?.type || ""),
          },
        };

        if (change.changed && device?.home_id) {
          const { data: homeUsers } = await supabaseAdmin
            .from("users")
            .select("id")
            .eq("home_id", device.home_id);

          for (const row of homeUsers || []) {
            const userId = String((row as any)?.id || "");
            if (!userId) continue;
            const alreadySent = await recentDeviceActivityExists(userId, deviceId, String((change as any).kind || ""));
            if (alreadySent) continue;
            await NotificationService.sendToUser(userId, {
              title: String((change as any).title || "Device activity"),
              message: `${String(device?.name || "A device")} ${String((change as any).message || "").toLowerCase()}`,
              type: "device",
              payload: {
                device_id: String(deviceId),
                estate_id: String(device?.estate_id || estateId || ""),
                home_id: String(device?.home_id || ""),
                room_id: String(device?.room_id || ""),
                kind: String((change as any).kind || "device.state.changed"),
                state: status,
                previous_state: previousStatus,
                source: eventSource,
                control_source: eventSource,
                provider_event_id: providerEventId || null,
                normalized_event: normalizedEvent,
              },
              entityId: String(deviceId),
            });
          }
          void emitAuditEvent({
            actorId: null,
            actorEmail: "",
            actorRole: eventSource,
            action: String((change as any).kind || "device.state.changed"),
            resourceType: "device",
            resourceId: String(deviceId),
            estateId: String(device?.estate_id || estateId || "") || undefined,
            homeId: String(device?.home_id || "") || undefined,
            status: "success",
            metadata: normalizedEvent,
          } as any);
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
            homeId: device?.home_id || null,
            roomId: device?.room_id || null,
            source: eventSource,
            event: normalizedEvent,
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
