import { supabaseAdmin } from "../supabase/supabaseClient";
import type { AuthUser } from "../middleware/auth";
import type { IntelligenceEvent, IntelligenceEventCategory } from "./types";
import { normalizeIntelligenceEvent } from "./timeline";

export type IntelligenceEventFilters = {
  actor?: AuthUser | null;
  agent_id?: string | null;
  category?: string | null;
  estate_id?: string | null;
  home_id?: string | null;
  camera_id?: string | null;
  limit?: number;
};

export type IntelligenceEventPublishOptions = {
  source_table?: string | null;
  source_event_id?: string | null;
};

const VALID_CATEGORIES: IntelligenceEventCategory[] = [
  "operational",
  "security",
  "maintenance",
  "visitor",
  "community",
  "marketing",
  "sales",
  "camera",
  "edge",
  "system",
];

function clampLimit(limit: unknown, fallback = 50) {
  const n = Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(200, n));
}

function isMissingIntelligenceTable(error: any) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("ochiga_intelligence_events") && (msg.includes("does not exist") || msg.includes("could not find") || msg.includes("relation"));
}

export function normalizeIntelligenceCategory(category: unknown): IntelligenceEventCategory {
  const raw = String(category || "operational").trim().toLowerCase().replace(/\s+/g, "_");
  if (raw.includes("security") || raw.includes("incident") || raw.includes("alert")) return "security";
  if (raw.includes("maint")) return "maintenance";
  if (raw.includes("visitor") || raw.includes("invite") || raw.includes("access")) return "visitor";
  if (raw.includes("community") || raw.includes("notice") || raw.includes("announcement")) return "community";
  if (raw.includes("market")) return "marketing";
  if (raw.includes("sales") || raw.includes("lead")) return "sales";
  if (raw.includes("camera") || raw.includes("vision")) return "camera";
  if (raw.includes("edge") || raw.includes("runtime")) return "edge";
  if (raw.includes("system") || raw.includes("watch") || raw.includes("profile") || raw.includes("notification")) return "system";
  return VALID_CATEGORIES.includes(raw as IntelligenceEventCategory) ? (raw as IntelligenceEventCategory) : "operational";
}

export function normalizeCoreBusEvent(
  input: Partial<IntelligenceEvent> & Pick<IntelligenceEvent, "agent_id" | "surface" | "event_type" | "title">
): IntelligenceEvent {
  const event = normalizeIntelligenceEvent(input as any);
  return {
    ...event,
    category: normalizeIntelligenceCategory(event.category),
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {},
  };
}

export async function publishIntelligenceEvent(eventInput: IntelligenceEvent, options: IntelligenceEventPublishOptions = {}) {
  const event = normalizeCoreBusEvent(eventInput as any);
  const row = {
    actor_id: event.actor_id || null,
    agent_id: event.agent_id,
    surface: event.surface,
    estate_id: event.estate_id || null,
    home_id: event.home_id || null,
    office_id: event.office_id || null,
    camera_id: event.camera_id || null,
    event_type: event.event_type,
    category: normalizeIntelligenceCategory(event.category),
    title: event.title,
    summary: event.summary,
    confidence: event.confidence,
    source: event.source,
    source_table: options.source_table || null,
    source_event_id: options.source_event_id || null,
    metadata: event.metadata || {},
    occurred_at: event.occurred_at,
  };

  const { data, error } = await supabaseAdmin
    .from("ochiga_intelligence_events")
    .insert(row as any)
    .select("*")
    .single();

  if (error) {
    if (isMissingIntelligenceTable(error)) return { ok: false, skipped: true, reason: "intelligence_events_table_missing" };
    if ((error as any)?.code === "23505") return { ok: true, skipped: true, reason: "intelligence_event_already_recorded" };
    return { ok: false, reason: error.message };
  }

  return { ok: true, event: data || row };
}

export async function listPersistedIntelligenceEvents(filters: IntelligenceEventFilters = {}) {
  const actor = filters.actor || null;
  const limit = clampLimit(filters.limit);
  let query = supabaseAdmin
    .from("ochiga_intelligence_events")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  const estateId = filters.estate_id || actor?.estate_id || null;
  const homeId = filters.home_id || actor?.home_id || null;

  if (filters.agent_id) query = query.eq("agent_id", filters.agent_id);
  if (filters.category) query = query.eq("category", normalizeIntelligenceCategory(filters.category));
  if (filters.camera_id) query = query.eq("camera_id", filters.camera_id);
  if (estateId) query = query.eq("estate_id", estateId);
  if (homeId) query = query.eq("home_id", homeId);

  const { data, error } = await query;
  if (error) {
    if (isMissingIntelligenceTable(error)) return { events: [], warning: "intelligence_events_table_missing" };
    return { events: [], warning: error.message };
  }
  return { events: data || [] };
}

export function summarizeIntelligenceEvents(events: any[]) {
  const byCategory: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const attention = events.filter((event) => ["security", "maintenance", "camera"].includes(String(event.category || ""))).length;

  for (const event of events) {
    const category = normalizeIntelligenceCategory(event.category);
    const agent = String(event.agent_id || "unknown");
    byCategory[category] = (byCategory[category] || 0) + 1;
    byAgent[agent] = (byAgent[agent] || 0) + 1;
  }

  return {
    total: events.length,
    attention,
    by_category: byCategory,
    by_agent: byAgent,
    latest: events[0] || null,
  };
}
