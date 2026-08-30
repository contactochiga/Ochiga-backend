import { publishIntelligenceEvent } from "./eventBus";
import type { IntelligenceAgentId, IntelligenceEventCategory, IntelligenceSurface } from "./types";
import { orchestrateWorkflowForSourceEvent } from "./workflowOrchestrator";

export type SourceIntelligenceEvent = {
  source: IntelligenceSurface;
  agent_id?: IntelligenceAgentId;
  surface?: IntelligenceSurface;
  event_type: string;
  category: IntelligenceEventCategory | string;
  estate_id?: string | null;
  home_id?: string | null;
  organization_id?: string | null;
  actor_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_label?: string | null;
  severity?: "normal" | "info" | "attention" | "warning" | "critical" | string;
  title: string;
  summary?: string | null;
  payload?: Record<string, unknown> | null;
  occurred_at?: string;
  // Facility Automation -- Cross-Domain Fabric Closure loop protection. Set
  // true only when this event is itself the direct result of an automation
  // action executing (see intelligence-core/executionRegistry.ts's
  // input.source === "automation"). The event-driven trigger matcher
  // (facilityAutomationEventRuleService.ts) refuses to match rules against
  // any event carrying this flag, so an automation-caused mutation can
  // never re-enter the matcher and chain into further automation --
  // zero-hop chaining by construction, not by convention.
  automation_origin?: boolean;
};

const VALID_SEVERITIES = new Set(["normal", "info", "attention", "warning", "critical"]);
const SOURCE_AGENT: Partial<Record<IntelligenceSurface, IntelligenceAgentId>> = {
  consumer: "oyi", facility: "facility", office: "oma", oma: "oma", osa: "osa", edge: "edge", camera: "camera", watch: "watch", twin: "twin", plan_studio: "plan_studio",
};

function value(input: unknown, max = 500) {
  return String(input ?? "").trim().slice(0, max);
}

function normalizedSeverity(input: unknown) {
  const severity = value(input, 30).toLowerCase();
  return VALID_SEVERITIES.has(severity) ? severity : "info";
}

/**
 * Best-effort write-time publishing. A failure is observable but must never
 * alter the successful result of a visitor, device, maintenance, or payment operation.
 */
export function publishSourceIntelligenceEvent(input: SourceIntelligenceEvent, options: { source_table?: string; source_event_id?: string } = {}) {
  const source = value(input.source, 40).toLowerCase() as IntelligenceSurface;
  const eventType = value(input.event_type, 160);
  const title = value(input.title, 180);
  if (!source || !eventType || !title) {
    console.warn("[intelligence-event] skipped invalid source event", { source, event_type: eventType, title: Boolean(title) });
    return Promise.resolve({ ok: false, skipped: true, reason: "invalid_source_event" });
  }

  const metadata = {
    canonical_envelope: true,
    organization_id: input.organization_id || null,
    entity_type: input.entity_type || null,
    entity_id: input.entity_id || null,
    entity_label: input.entity_label || null,
    severity: normalizedSeverity(input.severity),
    payload: input.payload || {},
    automation_origin: Boolean(input.automation_origin),
  };

  return publishIntelligenceEvent({
    actor_id: input.actor_id || null,
    agent_id: input.agent_id || SOURCE_AGENT[source] || "oyi",
    surface: input.surface || source,
    estate_id: input.estate_id || null,
    home_id: input.home_id || null,
    event_type: eventType,
    category: input.category,
    title,
    summary: value(input.summary || title, 500),
    confidence: normalizedSeverity(input.severity) === "critical" ? "confirmed" : "probable",
    source,
    metadata,
    occurred_at: input.occurred_at || new Date().toISOString(),
  }, options).then(async (result) => {
    if (!result.ok && !result.skipped) console.warn("[intelligence-event] publish failed", { source, event_type: eventType, reason: result.reason || "unknown" });
    if (result.ok) {
      const workflow = await orchestrateWorkflowForSourceEvent({ ...input, source, event_type: eventType, title }).catch((error: any) => ({ ok: false, reason: error?.message || "workflow_orchestration_failed" }));
      const workflowResult = workflow as any;
      if (!workflowResult.ok && !workflowResult.skipped) console.warn("[intelligence-event] workflow orchestration failed", { source, event_type: eventType, reason: workflowResult.reason || workflowResult.error || "unknown" });
    }
    return result;
  }).catch((error: any) => {
    console.warn("[intelligence-event] publish exception", { source, event_type: eventType, reason: error?.message || String(error) });
    return { ok: false, reason: "publish_exception" };
  });
}
