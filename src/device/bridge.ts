// src/device/bridge.ts
import mqtt from "mqtt";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { NotificationService } from "../services/NotificationService";
import { emitAuditEvent } from "../core/foundation";
import { recordDeviceEvent, recordPossiblePowerEvent } from "../services/deviceAnalyticsService";

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

function boolValue(value: any): boolean | null {
  if (value === true || value === false) return value;
  const text = String(value ?? "").toLowerCase();
  if (["true", "on", "1", "yes", "active"].includes(text)) return true;
  if (["false", "off", "0", "no", "inactive"].includes(text)) return false;
  return null;
}

function switchSnapshot(status: any) {
  const out: Record<string, boolean> = {};
  if (!status || typeof status !== "object") return out;
  const keys = ["switch", "power", "on", "running", "enabled"];
  for (const key of keys) {
    const value = boolValue(status[key]);
    if (value !== null) out[key] = value;
  }
  for (const [key, value] of Object.entries(status)) {
    if (/^switch(_\d+)?$/i.test(String(key))) {
      const next = boolValue(value);
      if (next !== null) out[String(key)] = next;
    }
  }
  if (status.last_command && typeof status.last_command === "object") {
    Object.assign(out, switchSnapshot(status.last_command));
  }
  return out;
}

type DeviceStateSource = "app" | "physical_switch" | "provider_reported" | "provider_app" | "watch" | "automation" | "scene" | "facility" | "system";

function normalizeSource(value: any): DeviceStateSource {
  const text = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (/physical|wall|manual|local|button/.test(text)) return "physical_switch";
  if (/smart_life|tuya_app|provider_app/.test(text)) return "provider_app";
  if (/provider|tuya|mqtt|state/.test(text)) return "provider_reported";
  if (/watch|watchos/.test(text)) return "watch";
  if (/automation/.test(text)) return "automation";
  if (/scene/.test(text)) return "scene";
  if (/facility|operator|admin/.test(text)) return "facility";
  if (/oyi|consumer|app|user/.test(text)) return "app";
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
  const prevSwitches = switchSnapshot(prev);
  const nextSwitches = switchSnapshot(next);
  const switchKeys = Array.from(new Set([...Object.keys(prevSwitches), ...Object.keys(nextSwitches)]));
  for (const key of switchKeys) {
    if (prevSwitches[key] !== undefined && nextSwitches[key] !== undefined && prevSwitches[key] !== nextSwitches[key]) {
      return {
        changed: true,
        title: nextSwitches[key] ? "Device turned on" : "Device turned off",
        message: nextSwitches[key] ? "A connected device is now active." : "A connected device is no longer active.",
        kind: nextSwitches[key] ? "device.state.on" : "device.state.off",
      };
    }
  }

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

async function shouldPushDeviceStateNotification(args: {
  userId: string;
  homeId: string;
  device: any;
  kind: string;
  source: string;
}) {
  const metadata = args.device?.metadata && typeof args.device.metadata === "object" ? args.device.metadata : {};
  const watched = Boolean(metadata.strict_alerts || metadata.strictAlert || metadata.watchlist || metadata.watched || metadata.important);
  const kind = String(args.kind || "").toLowerCase();
  const critical = /critical|security|camera|intrusion|alert/.test(kind);
  const offline = /offline|failure|failed/.test(kind);
  if (critical || offline) return true;

  const { data } = await supabaseAdmin
    .from("resident_proximity_settings")
    .select("enabled,last_state")
    .eq("user_id", args.userId)
    .eq("home_id", args.homeId)
    .maybeSingle();

  if (data?.enabled !== true) return false;
  const state = String((data as any)?.last_state || "").toLowerCase();
  const awayLike = ["away", "leaving_home", "approaching_estate"].includes(state);
  return watched && awayLike;
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

function providerReportedAt(status: any) {
  const values = [
    status?._oyi_timeline?.provider_reported_at,
    status?.provider_reported_at,
    status?.providerReportedAt,
    status?.reported_at,
    status?.reportedAt,
    status?.event_time,
    status?.eventTime,
    status?.timestamp,
    status?.time,
  ];
  for (const value of values) {
    const text = String(value || "").trim();
    if (text && !Number.isNaN(new Date(text).getTime())) return text;
  }
  return null;
}

function scopeValue(...values: any[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return null;
}

async function resolveDeviceForStateEvent(input: {
  ref: string;
  estateId?: string | null;
}) {
  const ref = String(input.ref || "").trim();
  if (!ref) return null;
  const select = "id,name,estate_id,home_id,room_id,category,type,external_id,metadata";

  let byId = supabaseAdmin.from("devices").select(select).eq("id", ref);
  if (input.estateId) byId = byId.eq("estate_id", input.estateId);
  const { data: idMatch } = await byId.limit(1).maybeSingle();
  if (idMatch) return idMatch;

  let byExternal = supabaseAdmin.from("devices").select(select).eq("external_id", ref);
  if (input.estateId) byExternal = byExternal.eq("estate_id", input.estateId);
  const { data: externalMatch } = await byExternal.limit(1).maybeSingle();
  return externalMatch || null;
}

function emitLegacyDeviceUpdate(args: {
  estateId: string | null;
  homeId?: string | null;
  roomId?: string | null;
  deviceId: string;
  externalDeviceId?: string | null;
  state: any;
  topic: string;
  source: DeviceStateSource;
  providerEventId?: string | null;
  occurredAt?: string;
  event?: Record<string, any>;
}) {
  // ✅ Keep backward compatibility for any existing dashboards listening to device:update
  const io = getIO();
  if (!io) return;
  const payload = {
    deviceId: args.deviceId,
    device_id: args.deviceId,
    external_device_id: args.externalDeviceId || null,
    estate_id: args.estateId || null,
    estateId: args.estateId || null,
    home_id: args.homeId || null,
    homeId: args.homeId || null,
    room_id: args.roomId || null,
    roomId: args.roomId || null,
    state: args.state,
    topic: args.topic,
    source: args.source,
    provider_event_id: args.providerEventId || null,
    occurred_at: args.occurredAt || new Date().toISOString(),
    event: args.event || null,
  };

  let target = io.to(`device:${args.deviceId}`);
  if (args.estateId) target = target.to(`estate:${args.estateId}`);
  if (args.homeId) target = target.to(`home:${args.homeId}`);
  target.emit("device:update", payload);
  target.emit("device.status.updated", payload);
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
        const incomingDeviceId = parsedTopic.deviceId;
        if (!incomingDeviceId) return;

        const status = safeJson(payload);
        const occurredAt = new Date().toISOString();
        const reportedAt = providerReportedAt(status);
        const persistedStatus = {
          ...(status && typeof status === "object" ? status : { raw: status }),
          _oyi_timeline: {
            received_at: occurredAt,
            provider_reported_at: reportedAt,
            source: sourceFromPayload(status, topic),
          },
        };
        const eventSource = sourceFromPayload(status, topic);
        const providerEventId = String(status?.provider_event_id || status?.event_id || status?.id || "");
        const device = await resolveDeviceForStateEvent({ ref: incomingDeviceId, estateId });
        const deviceId = String(device?.id || incomingDeviceId);
        const externalDeviceId = scopeValue(device?.external_id, device?.metadata?.external_id, incomingDeviceId);
        if (!estateId) estateId = device?.estate_id ?? null;

        console.info("[device-bridge] provider state event", {
          incoming_device_id: incomingDeviceId,
          device_id: deviceId,
          estate_id: estateId || null,
          home_id: device?.home_id || null,
          source: eventSource,
          provider_event_id: providerEventId || null,
          keys: status && typeof status === "object" ? Object.keys(status).slice(0, 12) : [],
        });

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
              status: persistedStatus,
              last_seen: occurredAt,
            },
            { onConflict: "device_id" }
          );

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
            incoming_device_id: incomingDeviceId,
            external_device_id: externalDeviceId,
            estate_id: String(device?.estate_id || estateId || ""),
            device_name: String(device?.name || ""),
            category: String(device?.category || device?.type || ""),
          },
        };

        if (change.changed && device?.id) {
          const analyticsKind = String((change as any).kind || "device.state.reported");
          const analyticsTitle = analyticsKind.includes("offline")
            ? `${String(device?.name || "Device")} went offline`
            : analyticsKind.includes("online")
              ? `${String(device?.name || "Device")} came back online`
              : `${String(device?.name || "Device")} ${String((change as any).title || "updated").replace(/^Device /i, "").toLowerCase()}`;
          void recordDeviceEvent({
            deviceId: String(device.id),
            estateId: device?.estate_id || estateId || null,
            homeId: device?.home_id || null,
            roomId: device?.room_id || null,
            userId: null,
            actorId: null,
            eventType: analyticsKind,
            previousState: previousStatus,
            newState: status,
            source: eventSource,
            confidence: eventSource === "physical_switch" ? "confirmed" : eventSource === "system" ? "unknown" : "probable",
            providerEventId: providerEventId || null,
            metadata: { topic, incoming_device_id: incomingDeviceId, external_device_id: externalDeviceId, device_name: String(device?.name || ""), category: String(device?.category || device?.type || "") },
            title: analyticsTitle,
            summary: `${String(device?.name || "Device")} ${String((change as any).message || "updated.").replace(/^A connected device /i, "")}`,
          });

          if (analyticsKind === "device.state.offline" && device?.home_id) {
            const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const { data: recentOffline } = await supabaseAdmin
              .from("device_events")
              .select("device_id")
              .eq("home_id", device.home_id)
              .eq("event_type", "device.state.offline")
              .gte("occurred_at", since)
              .limit(20);
            const affected = Array.from(new Set((recentOffline || []).map((row: any) => String(row?.device_id || "")).filter(Boolean)));
            await recordPossiblePowerEvent({
              estateId: device?.estate_id || estateId || null,
              homeId: device?.home_id || null,
              affectedDeviceIds: affected,
              occurredAt,
              metadata: { source: "provider_reported", window_minutes: 5 },
            });
          }
        }

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
            const shouldPush = await shouldPushDeviceStateNotification({
              userId,
              homeId: String(device.home_id),
              device,
              kind: String((change as any).kind || "device.state.changed"),
              source: eventSource,
            });
            if (!shouldPush) continue;
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
        emitLegacyDeviceUpdate({
          estateId,
          homeId: device?.home_id || null,
          roomId: device?.room_id || null,
          deviceId,
          externalDeviceId,
          state: status,
          topic,
          source: eventSource,
          providerEventId: providerEventId || null,
          occurredAt,
          event: normalizedEvent,
        });

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
