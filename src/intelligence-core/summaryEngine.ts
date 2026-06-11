import type { AuthUser } from "../middleware/auth";
import { normalizeIntelligenceCategory, summarizeIntelligenceEvents } from "./eventBus";
import { filterEventsForActor, getIntelligencePermissionPolicy } from "./permissionEngine";

export type IntelligenceSummaryType = "consumer" | "facility" | "office" | "watch" | "camera" | "edge";

function countBy(events: any[], key: string) {
  return events.reduce<Record<string, number>>((acc, event) => {
    const value = String(event[key] || "unknown");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function latestTitles(events: any[], max = 5) {
  return events.slice(0, max).map((event) => ({
    title: event.title,
    summary: event.summary,
    category: normalizeIntelligenceCategory(event.category),
    agent_id: event.agent_id,
    occurred_at: event.occurred_at || event.created_at,
  }));
}

function attentionItems(events: any[]) {
  return events
    .filter((event) => ["security", "maintenance", "camera"].includes(normalizeIntelligenceCategory(event.category)))
    .slice(0, 5)
    .map((event) => ({ title: event.title, summary: event.summary, category: normalizeIntelligenceCategory(event.category) }));
}

export function inferSummaryType(actor?: AuthUser | null): IntelligenceSummaryType {
  const role = getIntelligencePermissionPolicy(actor).role;
  if (role === "resident") return "consumer";
  if (role === "security_operator" || role === "facility_manager" || role === "estate_admin") return "facility";
  if (role === "oma" || role === "osa" || role === "ochiga_admin" || role === "super_admin") return "office";
  return "consumer";
}

export function buildIntelligenceSummary(type: IntelligenceSummaryType, eventsInput: any[], actor?: AuthUser | null) {
  const events = filterEventsForActor(eventsInput, actor);
  const base = summarizeIntelligenceEvents(events);
  const attention = attentionItems(events);
  const byCategory = countBy(events.map((event) => ({ ...event, category: normalizeIntelligenceCategory(event.category) })), "category");
  const byAgent = countBy(events, "agent_id");

  const titleByType: Record<IntelligenceSummaryType, string> = {
    consumer: "Home Intelligence Summary",
    facility: "Facility Intelligence Summary",
    office: "Office Intelligence Summary",
    watch: "Watch Intelligence Summary",
    camera: "Camera Intelligence Summary",
    edge: "Edge Intelligence Summary",
  };

  const suggestedActions: Record<IntelligenceSummaryType, string[]> = {
    consumer: attention.length ? ["Open Activity", "Review attention items"] : ["Open Activity for the full timeline"],
    facility: attention.length ? ["Review facility alerts", "Check camera and maintenance queues"] : ["Review estate operations timeline"],
    office: ["Review lead and sales handoff events", "Keep resident memory separate"],
    watch: attention.length ? ["Show urgent items first"] : ["Keep glance compact"],
    camera: attention.length ? ["Review camera events", "Check stream health"] : ["Monitor camera health"],
    edge: ["Check Edge health", "Review camera runtime status"],
  };

  return {
    type,
    title: titleByType[type],
    health: attention.length ? "attention" : "normal",
    total_events: events.length,
    attention_count: attention.length,
    by_category: byCategory,
    by_agent: byAgent,
    latest: latestTitles(events, type === "watch" ? 3 : 6),
    attention_items: attention,
    suggested_actions: suggestedActions[type],
    role_policy: getIntelligencePermissionPolicy(actor),
    raw_summary: base,
  };
}
