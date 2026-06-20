import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitAuditEvent } from "../core/foundation";
import { updateDeviceRuntimeSession } from "./deviceRuntimeSessionsService";
import { publishSourceIntelligenceEvent } from "../intelligence-core";

type DeviceEventSource =
  | "app"
  | "physical_switch"
  | "provider_reported"
  | "provider_app"
  | "watch"
  | "automation"
  | "scene"
  | "facility"
  | "system";

type Confidence = "confirmed" | "probable" | "possible" | "unknown";

type Importance = "low" | "normal" | "attention" | "critical";

export type RecordDeviceEventInput = {
  deviceId: string;
  estateId?: string | null;
  homeId?: string | null;
  roomId?: string | null;
  userId?: string | null;
  eventType: string;
  previousState?: Record<string, any> | null;
  newState?: Record<string, any> | null;
  source: DeviceEventSource | string;
  confidence?: Confidence;
  actorId?: string | null;
  occurredAt?: string;
  latencyMs?: number | null;
  providerEventId?: string | null;
  metadata?: Record<string, any>;
  title?: string;
  summary?: string;
  importance?: Importance;
};

function boolValue(value: any): boolean | null {
  if (value === true || value === false) return value;
  const text = String(value ?? "").toLowerCase();
  if (["true", "on", "1", "yes", "open", "active"].includes(text)) return true;
  if (["false", "off", "0", "no", "closed", "inactive"].includes(text)) return false;
  return null;
}

function firstSwitchState(state: any): boolean | null {
  if (!state || typeof state !== "object") return null;
  for (const key of ["switch", "power", "on", "running", "enabled", "power_state"]) {
    const next = boolValue(state[key]);
    if (next !== null) return next;
  }
  if (state.last_command && typeof state.last_command === "object") return firstSwitchState(state.last_command);
  for (const [key, value] of Object.entries(state)) {
    if (/^switch(_\d+)?$/i.test(key)) {
      const next = boolValue(value);
      if (next !== null) return next;
    }
  }
  return null;
}

function normalizeSource(source: string): DeviceEventSource {
  const text = String(source || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (/physical|wall|manual|local|button/.test(text)) return "physical_switch";
  if (/watch/.test(text)) return "watch";
  if (/automation/.test(text)) return "automation";
  if (/scene/.test(text)) return "scene";
  if (/facility|operator|admin/.test(text)) return "facility";
  if (/smart_life|tuya_app|provider_app/.test(text)) return "provider_app";
  if (/provider|tuya|mqtt|report/.test(text)) return "provider_reported";
  if (/oyi|consumer|app|user/.test(text)) return "app";
  return "system";
}

function confidenceFor(source: DeviceEventSource, explicit?: Confidence): Confidence {
  if (explicit) return explicit;
  if (["app", "watch", "scene", "automation", "facility"].includes(source)) return "confirmed";
  if (source === "physical_switch") return "confirmed";
  if (source === "provider_app" || source === "provider_reported") return "probable";
  return "unknown";
}

function eventTitle(input: RecordDeviceEventInput, source: DeviceEventSource) {
  if (input.title) return input.title;
  const name = String(input.metadata?.device_name || "Device");
  if (/offline/.test(input.eventType)) return `${name} went offline.`;
  if (/online/.test(input.eventType)) return `${name} came back online.`;
  const next = firstSwitchState(input.newState);
  if (next === true) return `${name} turned on.`;
  if (next === false) return `${name} turned off.`;
  if (source === "provider_reported") return `${name} reported a state change.`;
  return `${name} updated.`;
}

function eventImportance(type: string, input?: Importance): Importance {
  if (input) return input;
  if (/failure|failed|offline/.test(type)) return "attention";
  return "normal";
}

async function loadCounter(deviceId: string) {
  const { data } = await supabaseAdmin
    .from("device_usage_counters")
    .select("*")
    .eq("device_id", deviceId)
    .maybeSingle();
  return data || {};
}

function num(value: any) {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

function computeStability(counter: any) {
  const offline = num(counter.offline_count);
  const failures = num(counter.failure_count) + num(counter.command_failure_count);
  const success = num(counter.command_success_count);
  const events = Math.max(1, offline + failures + success);
  return Math.max(0, Math.min(100, Math.round(100 - ((offline + failures) / events) * 100)));
}

async function updateCounters(input: RecordDeviceEventInput, source: DeviceEventSource) {
  const current = await loadCounter(input.deviceId);
  const now = input.occurredAt || new Date().toISOString();
  const nextSwitch = firstSwitchState(input.newState);
  const prevSwitch = firstSwitchState(input.previousState);
  const toggled = nextSwitch !== null && prevSwitch !== null && nextSwitch !== prevSwitch;
  const patch: Record<string, any> = {
    device_id: input.deviceId,
    estate_id: input.estateId || current.estate_id || null,
    home_id: input.homeId || current.home_id || null,
    room_id: input.roomId || current.room_id || null,
    last_source: source,
    updated_at: new Date().toISOString(),
  };

  if (toggled) patch.total_toggles = num(current.total_toggles) + 1;
  if (nextSwitch === true && toggled) patch.on_count = num(current.on_count) + 1;
  if (nextSwitch === false && toggled) patch.off_count = num(current.off_count) + 1;
  if (["app", "facility"].includes(source)) patch.app_control_count = num(current.app_control_count) + 1;
  if (source === "watch") patch.watch_control_count = num(current.watch_control_count) + 1;
  if (source === "scene") patch.scene_control_count = num(current.scene_control_count) + 1;
  if (source === "automation") patch.automation_control_count = num(current.automation_control_count) + 1;
  if (source === "provider_reported" || source === "provider_app") patch.provider_report_count = num(current.provider_report_count) + 1;
  if (source === "physical_switch") patch.physical_possible_count = num(current.physical_possible_count) + 1;
  if (/offline/.test(input.eventType)) {
    patch.offline_count = num(current.offline_count) + 1;
    patch.last_offline_at = now;
  }
  if (/online/.test(input.eventType)) {
    patch.online_count = num(current.online_count) + 1;
    patch.last_online_at = now;
  }
  if (/failure|failed/.test(input.eventType)) {
    patch.failure_count = num(current.failure_count) + 1;
    patch.command_failure_count = num(current.command_failure_count) + 1;
  }
  if (/success|executed|queued|state/.test(input.eventType) && !/failed|failure/.test(input.eventType)) {
    patch.command_success_count = num(current.command_success_count) + 1;
  }
  if (input.latencyMs !== null && input.latencyMs !== undefined && Number.isFinite(Number(input.latencyMs))) {
    const existingAvg = num(current.average_response_ms);
    const existingCount = Math.max(0, num(current.command_success_count) + num(current.command_failure_count));
    patch.average_response_ms = Math.round(((existingAvg * existingCount) + Number(input.latencyMs)) / Math.max(1, existingCount + 1));
  }
  if (toggled || /command|state|online|offline/.test(input.eventType)) patch.last_used_at = now;
  patch.stability_score = computeStability({ ...current, ...patch });

  await supabaseAdmin
    .from("device_usage_counters")
    .upsert(patch as any, { onConflict: "device_id" });
}

export async function recordDeviceEvent(input: RecordDeviceEventInput) {
  const deviceId = String(input.deviceId || "").trim();
  if (!deviceId) return { ok: false, error: "device_id_required" };
  const source = normalizeSource(String(input.source || "system"));
  const confidence = confidenceFor(source, input.confidence);
  const occurredAt = input.occurredAt || new Date().toISOString();
  const title = eventTitle(input, source);
  const summary = input.summary || title;
  const importance = eventImportance(input.eventType, input.importance);

  await supabaseAdmin.from("device_events").insert({
    device_id: deviceId,
    estate_id: input.estateId || null,
    home_id: input.homeId || null,
    room_id: input.roomId || null,
    user_id: input.userId || null,
    event_type: input.eventType,
    previous_state: input.previousState || {},
    new_state: input.newState || {},
    source,
    confidence_level: confidence,
    actor_id: input.actorId || null,
    occurred_at: occurredAt,
    latency_ms: input.latencyMs ?? null,
    provider_event_id: input.providerEventId || null,
    metadata: input.metadata || {},
  } as any).then(({ error }) => {
    if (error) console.warn("[device_events] write failed", error.message);
  });

  await supabaseAdmin.from("home_timeline").insert({
    user_id: input.userId || null,
    estate_id: input.estateId || null,
    home_id: input.homeId || null,
    source: "devices",
    event_type: input.eventType,
    category: "Devices",
    importance,
    title,
    summary,
    severity: importance === "critical" ? "critical" : importance === "attention" ? "attention" : "info",
    metadata: {
      ...(input.metadata || {}),
      device_id: deviceId,
      source,
      confidence_level: confidence,
    },
    occurred_at: occurredAt,
  } as any).then(({ error }) => {
    if (error) console.warn("[home_timeline] device write failed", error.message);
  });

  await updateCounters(input, source).catch((error) => console.warn("[device_usage_counters] update failed", error?.message || String(error)));
  await updateDeviceRuntimeSession({
    deviceId,
    estateId: input.estateId || null,
    homeId: input.homeId || null,
    roomId: input.roomId || null,
    source,
    previousState: input.previousState || null,
    newState: input.newState || null,
    occurredAt,
  }).catch((error) => console.warn("[device_runtime_sessions] update failed", error?.message || String(error)));

  // The operational write above is authoritative; intelligence publishing is best effort.
  void publishSourceIntelligenceEvent({
    source: "edge",
    surface: "consumer",
    event_type: input.eventType,
    category: /offline|failed|failure/i.test(input.eventType) ? "device" : "operational",
    estate_id: input.estateId || null,
    home_id: input.homeId || null,
    actor_id: input.actorId || input.userId || null,
    entity_type: "device",
    entity_id: deviceId,
    entity_label: String(input.metadata?.device_name || "Device"),
    severity: /offline|failed|failure/i.test(input.eventType) ? "attention" : "normal",
    title,
    summary,
    payload: { source, previous_state: input.previousState || {}, new_state: input.newState || {}, metadata: input.metadata || {} },
    occurred_at: occurredAt,
  }, { source_table: "device_events", source_event_id: input.providerEventId || `${deviceId}:${input.eventType}:${occurredAt}` });

  return { ok: true, source, confidence, title };
}

export async function recordPossiblePowerEvent(input: {
  estateId?: string | null;
  homeId?: string | null;
  userId?: string | null;
  deviceIds?: string[];
  affectedDeviceIds?: string[];
  roomIds?: string[];
  occurredAt?: string;
  metadata?: Record<string, any>;
}) {
  const ids = Array.from(new Set([...(input.deviceIds || []), ...(input.affectedDeviceIds || [])].map(String).filter(Boolean)));
  if (ids.length < 3) return { ok: false, skipped: true };
  const occurredAt = input.occurredAt || new Date().toISOString();
  const rooms = Array.from(new Set((input.roomIds || []).map(String).filter(Boolean)));
  const title = `Several devices went offline around ${new Date(occurredAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`;
  await supabaseAdmin.from("home_timeline").insert({
    user_id: input.userId || null,
    estate_id: input.estateId || null,
    home_id: input.homeId || null,
    source: "devices",
    event_type: "power_event_possible",
    category: "Devices",
    importance: "attention",
    title,
    summary: "This may indicate a power or network interruption.",
    severity: "attention",
    metadata: { ...(input.metadata || {}), affected_device_count: ids.length, affected_device_ids: ids, affected_rooms: rooms },
    occurred_at: occurredAt,
  } as any);
  return { ok: true };
}
