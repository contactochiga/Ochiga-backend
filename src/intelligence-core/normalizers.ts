import { supabaseAdmin } from "../supabase/supabaseClient";
import type { AuthUser } from "../middleware/auth";
import type { IntelligenceEvent } from "./types";
import { normalizeCoreBusEvent, normalizeIntelligenceCategory, type IntelligenceEventFilters } from "./eventBus";
import { authenticatedActorScope } from "../security/actorScope";

function clampLimit(limit: unknown, fallback = 50) {
  const n = Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(200, n));
}

function text(value: unknown, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function titleFromEvent(raw: string) {
  return text(raw, "update").replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function confidenceFromSeverity(value: unknown): IntelligenceEvent["confidence"] {
  const raw = String(value || "").toLowerCase();
  if (["critical", "high", "success", "confirmed"].includes(raw)) return "confirmed";
  if (["warning", "medium", "attention", "probable"].includes(raw)) return "probable";
  if (["low", "possible"].includes(raw)) return "possible";
  return "unknown";
}

async function safeSelect(table: string, select: string, apply: (query: any) => any) {
  try {
    const query = apply(supabaseAdmin.from(table).select(select));
    const { data, error } = await query;
    if (error) return { rows: [], warning: `${table}: ${error.message}` };
    return { rows: data || [] };
  } catch (err: any) {
    return { rows: [], warning: `${table}: ${err?.message || "query failed"}` };
  }
}

function scopedQuery(query: any, actor: AuthUser | null, filters: IntelligenceEventFilters) {
  const scope = actor ? authenticatedActorScope(actor) : filters;
  const estateId = scope.estate_id || null;
  const homeId = scope.home_id || null;
  if (estateId) query = query.eq("estate_id", estateId);
  if (homeId) query = query.eq("home_id", homeId);
  return query;
}

function normalizeHomeTimeline(row: any): IntelligenceEvent {
  return normalizeCoreBusEvent({
    id: row.id,
    actor_id: row.user_id || null,
    agent_id: "oyi",
    surface: "api",
    estate_id: row.estate_id || null,
    home_id: row.home_id || null,
    event_type: text(row.event_type, "home.timeline"),
    category: normalizeIntelligenceCategory(row.category || row.source || "operational"),
    title: text(row.title, titleFromEvent(row.event_type)),
    summary: text(row.summary, row.title || "Home update"),
    confidence: confidenceFromSeverity(row.severity || row.importance),
    source: text(row.source, "home_timeline"),
    metadata: { ...(row.metadata || {}), source_table: "home_timeline", source_event_id: row.id },
    occurred_at: row.occurred_at || row.created_at || new Date().toISOString(),
  });
}

function normalizeDeviceEvent(row: any): IntelligenceEvent {
  return normalizeCoreBusEvent({
    id: row.id,
    actor_id: row.actor_id || row.user_id || null,
    agent_id: "oyi",
    surface: "api",
    estate_id: row.estate_id || null,
    home_id: row.home_id || null,
    event_type: text(row.event_type, "device.event"),
    category: "operational",
    title: text(row.metadata?.title, titleFromEvent(row.event_type)),
    summary: text(row.metadata?.summary, `${titleFromEvent(row.event_type)} recorded for a device.`),
    confidence: confidenceFromSeverity(row.confidence_level),
    source: text(row.source, "device_events"),
    metadata: {
      source_table: "device_events",
      source_event_id: row.id,
      device_id: row.device_id || null,
      room_id: row.room_id || null,
      previous_state: row.previous_state || {},
      new_state: row.new_state || {},
      ...(row.metadata || {}),
    },
    occurred_at: row.occurred_at || row.created_at || new Date().toISOString(),
  });
}

function normalizeCameraEvent(row: any): IntelligenceEvent {
  const confidenceScore = Number(row.confidence);
  return normalizeCoreBusEvent({
    id: row.id,
    actor_id: row.created_by || null,
    agent_id: "camera",
    surface: "camera",
    estate_id: row.estate_id || null,
    camera_id: row.camera_id || null,
    event_type: text(row.event_type, "camera.event"),
    category: "camera",
    title: text(row.metadata?.core_event?.title, titleFromEvent(row.event_type)),
    summary: text(row.message || row.metadata?.core_event?.summary, `${titleFromEvent(row.event_type)} detected.`),
    confidence: Number.isFinite(confidenceScore) && confidenceScore >= 0.8 ? "confirmed" : Number.isFinite(confidenceScore) && confidenceScore >= 0.5 ? "probable" : "possible",
    source: text(row.metadata?.source, "camera_events"),
    metadata: { ...(row.metadata || {}), source_table: "camera_events", source_event_id: row.id, snapshot_url: row.snapshot_url || null },
    occurred_at: row.created_at || new Date().toISOString(),
  });
}

function normalizeMaintenance(row: any): IntelligenceEvent {
  return normalizeCoreBusEvent({
    id: row.id,
    actor_id: row.user_id || null,
    agent_id: "oyi",
    surface: "api",
    estate_id: row.estate_id || null,
    home_id: row.home_id || null,
    event_type: `maintenance.${text(row.status, "open")}`,
    category: "maintenance",
    title: text(row.title, "Maintenance request"),
    summary: text(row.description, `Maintenance request is ${text(row.status, "open")}.`),
    confidence: "confirmed",
    source: "maintenance_requests",
    metadata: { source_table: "maintenance_requests", source_event_id: row.id, status: row.status || null, room_id: row.room_id || null },
    occurred_at: row.updated_at || row.created_at || new Date().toISOString(),
  });
}

function normalizeVisitor(row: any): IntelligenceEvent {
  return normalizeCoreBusEvent({
    id: row.id,
    actor_id: null,
    agent_id: "oyi",
    surface: "api",
    estate_id: row.estate_id || null,
    home_id: row.home_id || null,
    event_type: `visitor.${text(row.status, "updated")}`,
    category: "visitor",
    title: text(row.full_name, "Visitor update"),
    summary: `${text(row.full_name, "A visitor")} is ${text(row.status, "updated")}.`,
    confidence: "confirmed",
    source: "visitors",
    metadata: { source_table: "visitors", source_event_id: row.id, status: row.status || null },
    occurred_at: row.updated_at || row.created_at || new Date().toISOString(),
  });
}

function normalizeVisitorAccess(row: any): IntelligenceEvent {
  const name = text(row.visitor_name || row.full_name, "Visitor access");
  const status = text(row.status, "updated");
  return normalizeCoreBusEvent({
    id: row.id,
    actor_id: row.created_by || row.resident_id || null,
    agent_id: "facility",
    surface: "facility",
    estate_id: row.estate_id || null,
    home_id: row.home_id || null,
    event_type: `visitor_access.${status}`,
    category: "visitor",
    title: name,
    summary: `${name} access is ${status}.`,
    confidence: "confirmed",
    source: "visitor_access",
    metadata: { source_table: "visitor_access", source_event_id: row.id, status: row.status || null, purpose: row.purpose || null, expires_at: row.expires_at || null },
    occurred_at: row.updated_at || row.created_at || new Date().toISOString(),
  });
}

function normalizeNotification(row: any): IntelligenceEvent {
  return normalizeCoreBusEvent({
    id: row.id,
    actor_id: row.user_id || null,
    agent_id: "oyi",
    surface: "api",
    estate_id: row.estate_id || row.payload?.estate_id || null,
    home_id: row.payload?.home_id || null,
    event_type: `notification.${text(row.type, "update")}`,
    category: normalizeIntelligenceCategory(row.type || row.payload?.category || "system"),
    title: text(row.title, "Notification"),
    summary: text(row.message, row.title || "Notification update"),
    confidence: row.status === "unread" ? "probable" : "confirmed",
    source: "notifications",
    metadata: { source_table: "notifications", source_event_id: row.id, status: row.status || null, payload: row.payload || {} },
    occurred_at: row.created_at || new Date().toISOString(),
  });
}

function normalizeActivity(row: any): IntelligenceEvent {
  return normalizeCoreBusEvent({
    id: row.id,
    actor_id: row.actor_id || null,
    agent_id: "facility",
    surface: "api",
    estate_id: row.estate_id || null,
    home_id: row.home_id || null,
    event_type: text(row.action, "activity.recorded"),
    category: normalizeIntelligenceCategory(row.resource_type || row.action || "system"),
    title: titleFromEvent(row.action || row.resource_type || "Activity recorded"),
    summary: text(row.metadata?.summary, `${titleFromEvent(row.action || "Activity")} recorded.`),
    confidence: confidenceFromSeverity(row.status),
    source: "audit_events",
    metadata: { ...(row.metadata || {}), source_table: "audit_events", source_event_id: row.id, resource_type: row.resource_type || null, resource_id: row.resource_id || null },
    occurred_at: row.created_at || new Date().toISOString(),
  });
}

export async function loadNormalizedTimelineEvents(filters: IntelligenceEventFilters = {}) {
  const actor = filters.actor || null;
  const limit = clampLimit(filters.limit, 50);
  const warnings: string[] = [];

  const [home, devices, cameras, maintenance, visitors, visitorAccess, notifications, audit] = await Promise.all([
    safeSelect("home_timeline", "*", (q) => scopedQuery(q.order("occurred_at", { ascending: false }).limit(limit), actor, filters)),
    safeSelect("device_events", "*", (q) => scopedQuery(q.order("occurred_at", { ascending: false }).limit(limit), actor, filters)),
    safeSelect("camera_events", "*", (q) => {
      let query = q.order("created_at", { ascending: false }).limit(limit);
      const estateId = (actor ? authenticatedActorScope(actor) : filters).estate_id || null;
      if (estateId) query = query.eq("estate_id", estateId);
      if (filters.camera_id) query = query.eq("camera_id", filters.camera_id);
      return query;
    }),
    safeSelect("maintenance_requests", "*", (q) => scopedQuery(q.order("updated_at", { ascending: false }).limit(limit), actor, filters)),
    safeSelect("visitors", "*", (q) => scopedQuery(q.order("updated_at", { ascending: false }).limit(limit), actor, filters)),
    safeSelect("visitor_access", "*", (q) => scopedQuery(q.order("updated_at", { ascending: false }).limit(limit), actor, filters)),
    safeSelect("notifications", "id,user_id,estate_id,title,message,type,payload,status,created_at", (q) => {
      let query = q.order("created_at", { ascending: false }).limit(limit);
      if (actor?.id) query = query.eq("user_id", actor.id);
      const estateId = (actor ? authenticatedActorScope(actor) : filters).estate_id || null;
      if (estateId) query = query.eq("estate_id", estateId);
      return query;
    }),
    safeSelect("audit_events", "*", (q) => scopedQuery(q.order("created_at", { ascending: false }).limit(limit), actor, filters)),
  ]);

  for (const result of [home, devices, cameras, maintenance, visitors, visitorAccess, notifications, audit]) {
    if (result.warning) warnings.push(result.warning);
  }

  const events = [
    ...home.rows.map(normalizeHomeTimeline),
    ...devices.rows.map(normalizeDeviceEvent),
    ...cameras.rows.map(normalizeCameraEvent),
    ...maintenance.rows.map(normalizeMaintenance),
    ...visitors.rows.map(normalizeVisitor),
    ...visitorAccess.rows.map(normalizeVisitorAccess),
    ...notifications.rows.map(normalizeNotification),
    ...audit.rows.map(normalizeActivity),
  ]
    .filter((event) => !filters.category || event.category === normalizeIntelligenceCategory(filters.category))
    .filter((event) => !filters.agent_id || event.agent_id === filters.agent_id)
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, limit);

  return { events, warnings };
}
