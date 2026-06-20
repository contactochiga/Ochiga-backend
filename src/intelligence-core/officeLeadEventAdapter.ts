import { publishSourceIntelligenceEvent } from "./sourceEventPublisher";

export type OfficeLeadEventInput = {
  event_type: string;
  lead_id?: string | null;
  organization_id?: string | null;
  actor_id?: string | null;
  title?: string | null;
  summary?: string | null;
  payload?: Record<string, unknown> | null;
  occurred_at?: string;
};

/** Lightweight bridge for the existing Office lead-agent runtime. It accepts
 * the Office event contract without coupling that runtime to Core internals. */
export function publishOfficeLeadIntelligenceEvent(input: OfficeLeadEventInput) {
  const type = String(input.event_type || "lead.updated").trim();
  const isSales = /proposal|meeting|qualified|won|lost|conversion/i.test(type);
  return publishSourceIntelligenceEvent({
    source: "office",
    agent_id: isSales ? "osa" : "oma",
    surface: "office",
    event_type: type,
    category: isSales ? "sales" : "lead",
    organization_id: input.organization_id || null,
    actor_id: input.actor_id || null,
    entity_type: "lead",
    entity_id: input.lead_id || null,
    title: input.title || "Lead update",
    summary: input.summary || "A commercial lead record changed.",
    payload: input.payload || {},
    occurred_at: input.occurred_at,
  }, { source_table: "office_leads", source_event_id: input.lead_id ? `${input.lead_id}:${type}` : undefined });
}
