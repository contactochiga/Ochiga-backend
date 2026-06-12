import type { AuthUser } from "../middleware/auth";
import { getIntelligencePermissionPolicy } from "./permissionEngine";
import { loadNormalizedTimelineEvents } from "./normalizers";
import { listPersistedIntelligenceEvents, summarizeIntelligenceEvents } from "./eventBus";
import { listIntelligencePredictions, summarizePredictions } from "./predictionEngine";
import { getCollaborationHints } from "./collaboration";
import { getOrganizationSummary } from "./organization";
import { getAgentObservabilitySummary } from "./observability";
import { getWorkflowSummary } from "./workflows";

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
  const [persisted, normalized, predictions, organization, workflows] = await Promise.all([
    listPersistedIntelligenceEvents(filters),
    loadNormalizedTimelineEvents(filters),
    listIntelligencePredictions({ actor, estate_id: actor?.estate_id || null, status: "open", limit: 50 }),
    getOrganizationSummary(actor),
    getWorkflowSummary(actor),
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
      workflows: workflows.ok ? workflows.summary : null,
    },
    collaboration_hints: getCollaborationHints(events),
    recommended_actions: Array.from(new Set([...(predictionSummary.recommended_actions || []), "Review open workflows", "Review observability for failing agents", "Review collaboration handoffs that remain unresolved"])).slice(0, 6),
    warnings: [persisted.warning, ...(normalized.warnings || []), predictions.warning, ...(organization.warnings || []), workflows.warning].filter(Boolean),
  };
}

export async function getExecutiveBrief(actor?: AuthUser | null) {
  if (!canViewExecutive(actor)) return { ok: false, error: "Executive brief requires management access" };
  const filters = {
    actor,
    estate_id: actor?.estate_id || null,
    home_id: null,
    limit: 100,
  };
  const [persisted, normalized, predictions, workflows, observability] = await Promise.all([
    listPersistedIntelligenceEvents(filters),
    loadNormalizedTimelineEvents(filters),
    listIntelligencePredictions({ actor, estate_id: actor?.estate_id || null, status: "open", limit: 50 }),
    getWorkflowSummary(actor),
    getAgentObservabilitySummary(100),
  ]);
  const events = mergeEvents(persisted.events || [], normalized.events || [], 100);
  const eventSummary = summarizeIntelligenceEvents(events);
  const predictionSummary = summarizePredictions(predictions.predictions || []);
  const byCategory = eventSummary.by_category || {};

  return {
    ok: true,
    agent_id: "ochiga_executive",
    title: "Daily Executive Brief",
    memory_boundary: "This brief uses summarized operational intelligence only. It does not expose raw resident memory, private CRM notes, camera credentials, or private streams.",
    summary: {
      predictions: predictionSummary,
      camera_alerts: byCategory.camera || 0,
      maintenance_risks: byCategory.maintenance || 0,
      lead_activity: byCategory.marketing || 0,
      sales_activity: byCategory.sales || 0,
      workflow_status: workflows.ok ? workflows.summary : null,
      agent_health: observability,
      estate_health: {
        attention_events: eventSummary.attention,
        latest_signal: eventSummary.latest,
      },
    },
    recommended_actions: Array.from(new Set([...(predictionSummary.recommended_actions || []), "Review critical and overdue workflows", "Check failed agent observations", "Review camera and maintenance risks"])).slice(0, 6),
    warnings: [persisted.warning, ...(normalized.warnings || []), predictions.warning, workflows.warning, observability.warning].filter(Boolean),
  };
}
