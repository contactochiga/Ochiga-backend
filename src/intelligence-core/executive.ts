import type { AuthUser } from "../middleware/auth";
import { getIntelligencePermissionPolicy } from "./permissionEngine";
import { loadNormalizedTimelineEvents } from "./normalizers";
import { listPersistedIntelligenceEvents, summarizeIntelligenceEvents } from "./eventBus";
import { listIntelligencePredictions, summarizePredictions } from "./predictionEngine";
import { getCollaborationHints } from "./collaboration";
import { getOrganizationSummary } from "./organization";

function canViewExecutive(actor?: AuthUser | null) {
  const role = getIntelligencePermissionPolicy(actor).role;
  return ["super_admin", "ochiga_admin", "estate_admin", "facility_manager"].includes(role);
}

function mergeEvents(persisted: any[], normalized: any[], limit: number) {
  const byKey = new Map<string, any>();
  for (const event of [...persisted, ...normalized]) {
    const key = String(event.id || `${event.metadata?.source_table || event.source}:${event.metadata?.source_event_id || event.occurred_at}:${event.title}`);
    if (!byKey.has(key)) byKey.set(key, event);
  }
  return Array.from(byKey.values())
    .sort((a, b) => new Date(b.occurred_at || b.created_at).getTime() - new Date(a.occurred_at || a.created_at).getTime())
    .slice(0, limit);
}

export async function getExecutiveIntelligence(actor?: AuthUser | null) {
  if (!canViewExecutive(actor)) return { ok: false, error: "Executive intelligence requires management access" };
  const filters = {
    actor,
    estate_id: actor?.estate_id || null,
    home_id: null,
    limit: 100,
  };
  const [persisted, normalized, predictions, organization] = await Promise.all([
    listPersistedIntelligenceEvents(filters),
    loadNormalizedTimelineEvents(filters),
    listIntelligencePredictions({ actor, estate_id: actor?.estate_id || null, status: "open", limit: 50 }),
    getOrganizationSummary(actor),
  ]);
  const events = mergeEvents(persisted.events || [], normalized.events || [], 100);
  const eventSummary = summarizeIntelligenceEvents(events);
  const predictionSummary = summarizePredictions(predictions.predictions || []);
  return {
    ok: true,
    agent_id: "ochiga_executive",
    purpose: "Cross-system executive awareness through summarized Oyi, Facility, OMA, OSA, Camera, Edge, Watch, and prediction signals.",
    memory_boundary: "Executive Intelligence reads summarized intelligence only. It does not directly read resident-private memory or CRM notes.",
    focus: predictionSummary.top_predictions?.[0]?.title || eventSummary.latest?.title || "No high-priority executive focus item is visible from current intelligence sources.",
    summary: {
      events: eventSummary,
      predictions: predictionSummary,
      organization: organization.ok ? organization.counts : null,
    },
    collaboration_hints: getCollaborationHints(events),
    recommended_actions: Array.from(new Set([...(predictionSummary.recommended_actions || []), "Review observability for failing agents", "Review collaboration handoffs that remain unresolved"])).slice(0, 6),
    warnings: [persisted.warning, ...(normalized.warnings || []), predictions.warning, ...(organization.warnings || [])].filter(Boolean),
  };
}
