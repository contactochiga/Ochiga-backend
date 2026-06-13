import { Request } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { AuthUser } from "../middleware/auth";
import { NotificationService } from "./NotificationService";
import { emitAuditEvent } from "../core/foundation";

export type ProximityState = "unknown" | "home" | "near_home" | "leaving_home" | "away" | "returning" | "approaching_estate";

const ALLOWED_RADII = new Set([20, 100, 500, 1000]);
const ALLOWED_STATES = new Set<ProximityState>(["unknown", "home", "near_home", "leaving_home", "away", "returning", "approaching_estate"]);
const NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000;

type ProximitySettings = {
  enabled: boolean;
  radius_meters: number;
  home_id: string | null;
  estate_id: string | null;
  home_lat: number | null;
  home_lng: number | null;
  estate_lat: number | null;
  estate_lng: number | null;
  last_state: ProximityState | null;
  last_distance: number | null;
  last_direction: string | null;
  last_notified_state: ProximityState | null;
  last_notification_at: string | null;
  session_id: string | null;
  last_event_at: string | null;
};

function finiteNumber(value: any): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function normalizeRadius(value: any, fallback = 100) {
  const radius = Number(value);
  if (!ALLOWED_RADII.has(radius)) return fallback;
  return radius;
}

function coord(value: any, kind: "lat" | "lng") {
  const next = finiteNumber(value);
  if (next === null) return null;
  if (kind === "lat" && (next < -90 || next > 90)) return null;
  if (kind === "lng" && (next < -180 || next > 180)) return null;
  return next;
}

function userHomeId(user: AuthUser) {
  return user.home_id ? String(user.home_id) : null;
}

function userEstateId(user: AuthUser) {
  return user.estate_id ? String(user.estate_id) : null;
}

function defaultSettings(user: AuthUser): ProximitySettings {
  return {
    enabled: false,
    radius_meters: 100,
    home_id: userHomeId(user),
    estate_id: userEstateId(user),
    home_lat: null,
    home_lng: null,
    estate_lat: null,
    estate_lng: null,
    last_state: null,
    last_distance: null,
    last_direction: null,
    last_notified_state: null,
    last_notification_at: null,
    session_id: null,
    last_event_at: null,
  };
}

function toSettings(row: any, user: AuthUser): ProximitySettings {
  const fallback = defaultSettings(user);
  return {
    enabled: row?.enabled === true,
    radius_meters: normalizeRadius(row?.radius_meters, fallback.radius_meters),
    home_id: row?.home_id ? String(row.home_id) : fallback.home_id,
    estate_id: row?.estate_id ? String(row.estate_id) : fallback.estate_id,
    home_lat: coord(row?.home_lat, "lat"),
    home_lng: coord(row?.home_lng, "lng"),
    estate_lat: coord(row?.estate_lat, "lat"),
    estate_lng: coord(row?.estate_lng, "lng"),
    last_state: ALLOWED_STATES.has(row?.last_state) ? row.last_state : null,
    last_distance: finiteNumber(row?.last_distance),
    last_direction: row?.last_direction || null,
    last_notified_state: ALLOWED_STATES.has(row?.last_notified_state) ? row.last_notified_state : null,
    last_notification_at: row?.last_notification_at || null,
    session_id: row?.session_id || null,
    last_event_at: row?.last_event_at || null,
  };
}

async function selectSettingsRow(user: AuthUser) {
  const homeId = userHomeId(user);
  let query = supabaseAdmin
    .from("resident_proximity_settings")
    .select("*")
    .eq("user_id", user.id)
    .limit(1);

  if (homeId) query = query.eq("home_id", homeId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function upsertSettingsRow(user: AuthUser, patch: Record<string, any>) {
  const row = {
    user_id: user.id,
    home_id: userHomeId(user),
    estate_id: userEstateId(user),
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("resident_proximity_settings")
    .upsert(row, { onConflict: "user_id,home_id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function loadScopedCoordinates(user: AuthUser) {
  const out: Pick<ProximitySettings, "home_lat" | "home_lng" | "estate_lat" | "estate_lng"> = {
    home_lat: null,
    home_lng: null,
    estate_lat: null,
    estate_lng: null,
  };

  if (user.home_id) {
    const { data } = await supabaseAdmin.from("homes").select("*").eq("id", user.home_id).maybeSingle();
    out.home_lat = coord((data as any)?.lat ?? (data as any)?.latitude, "lat");
    out.home_lng = coord((data as any)?.lng ?? (data as any)?.longitude, "lng");
  }

  if (user.estate_id) {
    const { data } = await supabaseAdmin.from("estates").select("*").eq("id", user.estate_id).maybeSingle();
    out.estate_lat = coord((data as any)?.lat ?? (data as any)?.latitude, "lat");
    out.estate_lng = coord((data as any)?.lng ?? (data as any)?.longitude, "lng");
  }

  return out;
}

export async function getProximitySettings(user: AuthUser) {
  const existing = await selectSettingsRow(user).catch(() => null);
  const saved = toSettings(existing, user);
  const scoped = await loadScopedCoordinates(user).catch(() => ({ home_lat: null, home_lng: null, estate_lat: null, estate_lng: null }));

  return {
    ...saved,
    home_lat: saved.home_lat ?? scoped.home_lat,
    home_lng: saved.home_lng ?? scoped.home_lng,
    estate_lat: saved.estate_lat ?? scoped.estate_lat,
    estate_lng: saved.estate_lng ?? scoped.estate_lng,
    available: true,
  };
}

export async function updateProximitySettings(user: AuthUser, body: any, req?: Request) {
  const current = await getProximitySettings(user);
  const patch: Record<string, any> = {};

  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  if (body?.radius_meters !== undefined) patch.radius_meters = normalizeRadius(body.radius_meters, current.radius_meters);

  const homeLat = coord(body?.home_lat, "lat");
  const homeLng = coord(body?.home_lng, "lng");
  const estateLat = coord(body?.estate_lat, "lat");
  const estateLng = coord(body?.estate_lng, "lng");

  if (homeLat !== null) patch.home_lat = homeLat;
  if (homeLng !== null) patch.home_lng = homeLng;
  if (estateLat !== null) patch.estate_lat = estateLat;
  if (estateLng !== null) patch.estate_lng = estateLng;

  const row = await upsertSettingsRow(user, patch);

  void emitAuditEvent({
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: "proximity.settings.updated",
    resourceType: "proximity_awareness",
    resourceId: user.id,
    estateId: userEstateId(user) || undefined,
    homeId: userHomeId(user) || undefined,
    status: "success",
    metadata: {
      enabled_changed: typeof body?.enabled === "boolean",
      radius_meters: patch.radius_meters,
      location_updated: homeLat !== null || homeLng !== null || estateLat !== null || estateLng !== null,
    },
    req,
  });

  return { ...toSettings(row, user), available: true };
}

function isActiveDeviceState(row: any) {
  const state = row?.status && typeof row.status === "object" ? row.status : {};
  const candidates = [state.switch, state.power, state.on, state.running, state.enabled, state.power_state, state.value];
  if (candidates.some((value) => value === true || String(value).toLowerCase() === "on")) return true;
  return Object.entries(state).some(([key, value]) => /^switch(_\d+)?$/i.test(key) && value === true);
}

async function countActiveDevices(user: AuthUser) {
  if (!user.home_id) return null;
  const { data: devices, error: devicesErr } = await supabaseAdmin
    .from("devices")
    .select("id")
    .eq("home_id", user.home_id)
    .limit(200);
  if (devicesErr) return null;
  const ids = (devices || []).map((row: any) => String(row.id)).filter(Boolean);
  if (!ids.length) return 0;
  const { data: states, error: statesErr } = await supabaseAdmin
    .from("device_states")
    .select("device_id,status")
    .in("device_id", ids);
  if (statesErr) return null;
  return (states || []).filter(isActiveDeviceState).length;
}

async function countActiveVisitors(user: AuthUser) {
  if (!user.home_id) return null;
  const { data, error } = await supabaseAdmin
    .from("visitors")
    .select("id,status")
    .eq("home_id", user.home_id)
    .in("status", ["active", "approved", "checked_in", "arrived", "pending"])
    .limit(100);
  if (error) return null;
  return (data || []).length;
}

async function countAttentionNotifications(user: AuthUser) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id,type,title,payload,status")
    .eq("user_id", user.id)
    .neq("status", "read")
    .limit(100);
  if (error) return null;
  return (data || []).filter((row: any) => {
    const text = `${row?.type || ""} ${row?.title || ""} ${row?.payload?.severity || ""} ${row?.payload?.kind || ""}`.toLowerCase();
    return /urgent|critical|security|alert|maintenance|visitor/.test(text);
  }).length;
}

function distanceBucket(distance: any) {
  const meters = finiteNumber(distance);
  if (meters === null) return null;
  if (meters < 100) return "under_100m";
  if (meters < 500) return "under_500m";
  if (meters < 1000) return "under_1km";
  return "over_1km";
}

async function awarenessMessage(user: AuthUser, state: ProximityState) {
  const [activeDevices, activeVisitors, attention] = await Promise.all([
    countActiveDevices(user),
    countActiveVisitors(user),
    countAttentionNotifications(user),
  ]);

  if (state === "leaving_home") {
    if (typeof activeDevices === "number" && activeDevices > 0) return `You left home. ${activeDevices} device${activeDevices === 1 ? " is" : "s are"} still on.`;
    return "You left home. Your home status is available in Oyi.";
  }

  if (state === "approaching_estate") {
    if (typeof activeVisitors === "number" && activeVisitors > 0) return `You're close to the estate. ${activeVisitors} visitor pass${activeVisitors === 1 ? " is" : "es are"} still active.`;
    return "You're close to the estate. Your home status is available in Oyi.";
  }

  if (state === "away") {
    if (typeof attention === "number" && attention > 0) return `You're away from home. ${attention} update${attention === 1 ? " needs" : "s need"} attention.`;
    return "You're away from home. No urgent issues detected.";
  }

  if (state === "returning") return "You're heading home. Oyi is checking your home status.";
  if (state === "home") return "You're home. No action required.";

  if (typeof attention === "number" && attention > 0) return `You're near home. ${attention} update${attention === 1 ? " needs" : "s need"} attention.`;
  return "You're near home. Everything looks normal.";
}

function directionFrom(previous: number | null, current: number | null) {
  if (previous === null || current === null) return null;
  if (current > previous + 15) return "increasing";
  if (current < previous - 15) return "decreasing";
  return "stable";
}

function shouldNotifyProximity(settings: ProximitySettings, state: ProximityState, direction: string | null, distance: number | null, sessionId: string, now: Date) {
  if (state === "unknown" || state === "home") return { notify: false, reason: "non_attention_state" };
  if (state === "leaving_home" && settings.last_distance !== null && direction !== "increasing") return { notify: false, reason: "leaving_not_confirmed" };
  if (state === "returning" && settings.last_distance !== null && direction !== "decreasing") return { notify: false, reason: "returning_not_confirmed" };
  if ((state === "near_home" || state === "approaching_estate") && settings.last_notified_state === state && settings.session_id === sessionId) return { notify: false, reason: "already_notified_this_session" };

  const lastNotificationAt = settings.last_notification_at ? new Date(settings.last_notification_at).getTime() : 0;
  if (Number.isFinite(lastNotificationAt) && now.getTime() - lastNotificationAt < NOTIFICATION_COOLDOWN_MS && settings.last_notified_state === state) {
    return { notify: false, reason: "cooldown_duplicate" };
  }

  if (state === "away" && distance !== null && settings.last_state === "away" && settings.last_notified_state === "away") return { notify: false, reason: "already_away" };
  return { notify: true, reason: "state_transition" };
}

export async function recordProximityEvent(user: AuthUser, body: any, req?: Request) {
  const settings = await getProximitySettings(user);
  if (!settings.enabled) return { ok: true, skipped: true, state: settings.last_state, reason: "disabled" };

  const state = String(body?.state || "") as ProximityState;
  if (!ALLOWED_STATES.has(state)) throw Object.assign(new Error("Invalid proximity state"), { statusCode: 400 });

  const eventHomeId = body?.home_id ? String(body.home_id) : settings.home_id;
  const eventEstateId = body?.estate_id ? String(body.estate_id) : settings.estate_id;
  if (settings.home_id && eventHomeId && String(eventHomeId) !== String(settings.home_id)) {
    throw Object.assign(new Error("Home context mismatch"), { statusCode: 403 });
  }
  if (settings.estate_id && eventEstateId && String(eventEstateId) !== String(settings.estate_id)) {
    throw Object.assign(new Error("Estate context mismatch"), { statusCode: 403 });
  }

  const now = new Date();
  const distance = finiteNumber(body?.distance_meters);
  const direction = directionFrom(settings.last_distance, distance);
  const sessionId = String(body?.session_id || settings.session_id || `${user.id}:${settings.home_id || "home"}:${now.toISOString().slice(0, 10)}`);
  const decision = shouldNotifyProximity(settings, state, direction, distance, sessionId, now);
  const message = await awarenessMessage(user, state);

  await upsertSettingsRow(user, {
    last_state: state,
    last_distance: distance,
    last_direction: direction,
    last_notified_state: decision.notify ? state : settings.last_notified_state,
    last_notification_at: decision.notify ? now.toISOString() : settings.last_notification_at,
    session_id: sessionId,
    last_event_at: now.toISOString(),
  });

  void emitAuditEvent({
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: "proximity.awareness.checked",
    resourceType: "proximity_awareness",
    resourceId: user.id,
    estateId: settings.estate_id || undefined,
    homeId: settings.home_id || undefined,
    status: "success",
    metadata: {
      state,
      distance_bucket: distanceBucket(body?.distance_meters),
      direction,
      notified: decision.notify,
      decision_reason: decision.reason,
    },
    req,
  });

  if (decision.notify) {
    await NotificationService.sendToUser(user.id, {
      title: "Home awareness",
      type: "home",
      message,
      payload: {
        kind: `proximity.${state}`,
        source: "proximity_awareness",
        state,
        home_id: settings.home_id,
        estate_id: settings.estate_id,
        distance_bucket: distanceBucket(body?.distance_meters),
      },
    });
  }

  return { ok: true, state, message, notified: decision.notify, decision_reason: decision.reason };
}
