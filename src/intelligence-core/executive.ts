import type { AuthUser } from "../middleware/auth";
import type { OisContext } from "../types/oisContext";
import { getIntelligencePermissionPolicy, filterCameraProtectedEvents, loadCameraAccessLookup } from "./permissionEngine";
import { loadNormalizedTimelineEvents } from "./normalizers";
import { listPersistedIntelligenceEvents, summarizeIntelligenceEvents } from "./eventBus";
import { listIntelligencePredictions, summarizePredictions } from "./predictionEngine";
import { getCollaborationHints } from "./collaboration";
import { getOrganizationSummary } from "./organization";
import { getAgentObservabilitySummary } from "./observability";
import { getWorkflowSummary } from "./workflows";
import { buildAmbientAwarenessProjection } from "../oyi-core/read/facilityConsumerAmbientAwarenessAdapter";
import { logger } from "../observability/logger";

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

// Wave 6 Slice 6B -- summary.events (total/attention/by_category/latest) and
// focus are this endpoint's CURRENT_AWARENESS content -- "what does the
// executive dashboard consider live right now" -- and are the only fields
// this slice migrates. summary.predictions/organization/workflows,
// collaboration_hints (an advisory agent-routing hint derived from recent
// activity, not a claim about current operational state), recommended_actions,
// and warnings are PREDICTION/ORGANIZATIONAL_FACT/WORKFLOW/WORKFLOW/
// PRESENTATION/OBSERVABILITY respectively, not awareness, and stay on their
// existing legacy/event sources exactly as before.
export async function getExecutiveIntelligence(actor?: AuthUser | null, oisContext?: OisContext | null) {
  if (!canViewExecutive(actor)) return { ok: false, error: "Executive intelligence requires management access" };
  const filters = {
    actor,
    estate_id: actor?.estate_id || null,
    home_id: null,
    limit: 100,
  };
  const [persisted, normalized, predictions, organization, workflows, projection] = await Promise.all([
    listPersistedIntelligenceEvents(filters),
    loadNormalizedTimelineEvents(filters),
    listIntelligencePredictions({ actor, estate_id: actor?.estate_id || null, status: "open", limit: 50 }),
    getOrganizationSummary(actor),
    getWorkflowSummary(actor),
    actor ? buildAmbientAwarenessProjection(actor, oisContext || null, "executive") : Promise.resolve(null),
  ]);
  const mergedEvents = mergeEvents(persisted.events || [], normalized.events || [], 100);
  // Wave 6 Slice 1 -- this executive digest does not run the rest of
  // filterEventsForActor's role/category gating (management roles here
  // legitimately see cross-department counts that a narrower role would
  // not), but it still must not let eventSummary.latest/focus surface raw
  // title/summary text from a camera the viewing actor could not access
  // directly. Camera privacy is not optional the way category breadth is.
  const cameraLookup = await loadCameraAccessLookup(mergedEvents);
  const events = filterCameraProtectedEvents(mergedEvents, actor, cameraLookup);
  const eventSummary = summarizeIntelligenceEvents(events);
  const predictionSummary = summarizePredictions(predictions.predictions || []);

  // Section 6/15/16 -- canonical is tried first; EMPTY (ok:true, zero
  // items) is a real, complete answer and never triggers legacy awareness
  // calls (there are none to trigger -- eventSummary above is only ever
  // used as the explicit fallback shape, computed unconditionally because
  // collaboration_hints legitimately still needs the same `events` array
  // regardless of which awareness source answers). Legacy is used only
  // when canonical itself could not answer, and is always marked
  // explicitly -- never blended with canonical output.
  let awarenessSummary: { total: number; attention: number; by_category: Record<string, number>; by_agent: Record<string, number>; latest: { title: string; summary: string; category: string; agent_id: string | null; occurred_at: string | null } | null };
  let canonicalStatus: "complete" | "partial" | "unavailable";
  let legacyFallbackUsed = false;
  let fallbackReason: string | null = null;

  if (projection && projection.ok) {
    const needsAttention = projection.attentionItems.filter((item) => item.urgency === "act" || item.urgency === "urgent");
    const byCategory: Record<string, number> = {};
    for (const bucket of projection.domainSummary) byCategory[bucket.domain] = bucket.count;
    const latest = needsAttention.length
      ? needsAttention.reduce((mostRecent, item) => (item.generatedAt > mostRecent.generatedAt ? item : mostRecent))
      : null;
    awarenessSummary = {
      total: projection.totalItems,
      attention: needsAttention.length,
      by_category: byCategory,
      by_agent: {},
      latest: latest ? { title: latest.title, summary: latest.summary, category: latest.domain, agent_id: null, occurred_at: latest.generatedAt } : null,
    };
    canonicalStatus = projection.canonicalStatus;
  } else {
    logger.warn("executive_intelligence_canonical_fallback", { reason: projection?.reason || "unknown" });
    legacyFallbackUsed = true;
    fallbackReason = "canonical_coverage_gap";
    canonicalStatus = "unavailable";
    awarenessSummary = eventSummary;
  }

  return {
    ok: true,
    agent_id: "ochiga_executive",
    purpose: "Cross-system executive awareness through summarized Oyi, Facility, OMA, OSA, Camera, Edge, Watch, and prediction signals.",
    memory_boundary: "Executive Intelligence reads summarized intelligence only. It does not directly read resident-private memory or CRM notes.",
    canonical_status: canonicalStatus,
    legacy_fallback_used: legacyFallbackUsed,
    fallback_reason: fallbackReason,
    focus: predictionSummary.top_predictions?.[0]?.title || awarenessSummary.latest?.title || "No high-priority executive focus item is visible from current intelligence sources.",
    summary: {
      events: awarenessSummary,
      predictions: predictionSummary,
      organization: organization.ok ? organization.counts : null,
      workflows: workflows.ok ? workflows.summary : null,
    },
    collaboration_hints: getCollaborationHints(events),
    recommended_actions: Array.from(new Set([...(predictionSummary.recommended_actions || []), "Review open workflows", "Review observability for failing agents", "Review collaboration handoffs that remain unresolved"])).slice(0, 6),
    warnings: [persisted.warning, ...(normalized.warnings || []), predictions.warning, ...(organization.warnings || []), workflows.warning].filter(Boolean),
  };
}

// Wave 6 Slice 6 -- the four fields below (camera_alerts, maintenance_risks,
// estate_health.attention_events, estate_health.latest_signal) are the
// brief's actual AMBIENT_AWARENESS content -- "what currently needs
// attention" -- and are the only fields this slice migrates. lead_activity/
// sales_activity (Office/CRM business counts), predictions, workflow_status,
// and agent_health are DIRECT_DOMAIN_FACT/PREDICTION/WORKFLOW/OBSERVABILITY
// respectively, not awareness, and are explicitly out of this slice's scope
// per its own mission (Section 0, Section 10) -- left computed from the
// existing legacy event/prediction/workflow/observability sources exactly
// as before.
export async function getExecutiveBrief(actor?: AuthUser | null, oisContext?: OisContext | null) {
  if (!canViewExecutive(actor)) return { ok: false, error: "Executive brief requires management access" };
  const filters = {
    actor,
    estate_id: actor?.estate_id || null,
    home_id: null,
    limit: 100,
  };
  const [persisted, normalized, predictions, workflows, observability, projection] = await Promise.all([
    listPersistedIntelligenceEvents(filters),
    loadNormalizedTimelineEvents(filters),
    listIntelligencePredictions({ actor, estate_id: actor?.estate_id || null, status: "open", limit: 50 }),
    getWorkflowSummary(actor),
    getAgentObservabilitySummary(100),
    actor ? buildAmbientAwarenessProjection(actor, oisContext || null, "executive") : Promise.resolve(null),
  ]);
  const mergedEvents = mergeEvents(persisted.events || [], normalized.events || [], 100);
  const cameraLookup = await loadCameraAccessLookup(mergedEvents);
  const events = filterCameraProtectedEvents(mergedEvents, actor, cameraLookup);
  const eventSummary = summarizeIntelligenceEvents(events);
  const predictionSummary = summarizePredictions(predictions.predictions || []);
  const byCategory = eventSummary.by_category || {};

  // Section 11/16 -- canonical is tried first; EMPTY (ok:true, zero items)
  // is a real, complete answer, never a fallback trigger. Legacy
  // (byCategory/eventSummary computed above, already privacy-filtered) is
  // used only when canonical itself could not answer, and the fallback is
  // always explicit -- never blended with canonical output.
  let ambient: { camera_alerts: number; maintenance_risks: number; attention_events: number; latest_signal: { title: string; summary: string; category: string; occurred_at: string | null } | null };
  let canonicalStatus: "complete" | "partial" | "unavailable";
  let legacyFallbackUsed = false;
  let fallbackReason: string | null = null;

  if (projection && projection.ok) {
    const needsAttention = projection.attentionItems.filter((item) => item.urgency === "act" || item.urgency === "urgent");
    const cameraBucket = projection.domainSummary.find((bucket) => bucket.domain === "camera");
    const maintenanceBucket = projection.domainSummary.find((bucket) => bucket.domain === "maintenance");
    const latest = needsAttention.length
      ? needsAttention.reduce((mostRecent, item) => (item.generatedAt > mostRecent.generatedAt ? item : mostRecent))
      : null;
    ambient = {
      camera_alerts: cameraBucket?.count || 0,
      maintenance_risks: maintenanceBucket?.count || 0,
      attention_events: needsAttention.length,
      latest_signal: latest ? { title: latest.title, summary: latest.summary, category: latest.domain, occurred_at: latest.generatedAt } : null,
    };
    canonicalStatus = projection.canonicalStatus;
  } else {
    logger.warn("executive_brief_canonical_fallback", { reason: projection?.reason || "unknown" });
    legacyFallbackUsed = true;
    fallbackReason = "canonical_coverage_gap";
    canonicalStatus = "unavailable";
    ambient = {
      camera_alerts: byCategory.camera || 0,
      maintenance_risks: byCategory.maintenance || 0,
      attention_events: eventSummary.attention,
      latest_signal: eventSummary.latest,
    };
  }

  return {
    ok: true,
    agent_id: "ochiga_executive",
    title: "Daily Executive Brief",
    memory_boundary: "This brief uses summarized operational intelligence only. It does not expose raw resident memory, private CRM notes, camera credentials, or private streams.",
    canonical_status: canonicalStatus,
    legacy_fallback_used: legacyFallbackUsed,
    fallback_reason: fallbackReason,
    summary: {
      predictions: predictionSummary,
      camera_alerts: ambient.camera_alerts,
      maintenance_risks: ambient.maintenance_risks,
      lead_activity: byCategory.marketing || 0,
      sales_activity: byCategory.sales || 0,
      workflow_status: workflows.ok ? workflows.summary : null,
      agent_health: observability,
      estate_health: {
        attention_events: ambient.attention_events,
        latest_signal: ambient.latest_signal,
      },
    },
    recommended_actions: Array.from(new Set([...(predictionSummary.recommended_actions || []), "Review critical and overdue workflows", "Check failed agent observations", "Review camera and maintenance risks"])).slice(0, 6),
    warnings: [persisted.warning, ...(normalized.warnings || []), predictions.warning, workflows.warning, observability.warning].filter(Boolean),
  };
}
