import { supabaseAdmin } from "../supabase/supabaseClient";
import type { AuthUser } from "../middleware/auth";
import type { IntelligenceEvent } from "./types";

export function normalizeIntelligenceEvent(input: Partial<IntelligenceEvent> & {
  agent_id: IntelligenceEvent["agent_id"];
  surface: IntelligenceEvent["surface"];
  event_type: string;
  title: string;
}): IntelligenceEvent {
  const now = new Date().toISOString();
  return {
    actor_id: input.actor_id || null,
    agent_id: input.agent_id,
    surface: input.surface,
    estate_id: input.estate_id || null,
    home_id: input.home_id || null,
    office_id: input.office_id || null,
    camera_id: input.camera_id || null,
    event_type: String(input.event_type || "intelligence.event"),
    category: String(input.category || "Intelligence"),
    title: String(input.title || "Intelligence update").slice(0, 180),
    summary: String(input.summary || input.title || "Intelligence update").slice(0, 500),
    confidence: input.confidence || "confirmed",
    source: String(input.source || input.agent_id || "intelligence"),
    metadata: input.metadata || {},
    occurred_at: input.occurred_at || now,
    mode: input.mode ?? null,
    status: input.status ?? null,
    capability: input.capability ?? null,
    tool: input.tool ?? null,
    conversation_id: input.conversation_id ?? null,
    request_id: input.request_id ?? null,
    latency_ms: input.latency_ms ?? null,
  };
}

export function homeTimelineEventFromCore(actor: AuthUser, event: IntelligenceEvent) {
  return {
    user_id: actor.id,
    estate_id: event.estate_id || actor.estate_id || null,
    home_id: event.home_id || actor.home_id || null,
    source: event.source,
    event_type: event.event_type,
    category: event.category,
    title: event.title,
    summary: event.summary,
    severity: event.confidence === "unknown" ? "info" : "info",
    metadata: {
      ...event.metadata,
      core_id: "ochiga_intelligence_core",
      agent_id: event.agent_id,
      surface: event.surface,
      confidence: event.confidence,
      office_id: event.office_id || null,
      camera_id: event.camera_id || null,
    },
    occurred_at: event.occurred_at,
    created_at: new Date().toISOString(),
  };
}

export async function writeHomeTimelineFromCore(actor: AuthUser, event: IntelligenceEvent) {
  if (!actor.id || (!actor.home_id && !event.home_id)) {
    return { ok: false, skipped: true, reason: "home_scope_required" };
  }
  const row = homeTimelineEventFromCore(actor, event);
  const { error } = await supabaseAdmin.from("home_timeline").insert(row as any);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
