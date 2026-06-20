import type { IntelligenceAgentId } from "./types";
import { createWorkflow, transitionWorkflow, type WorkflowPriority, type WorkflowStatus } from "./workflows";
import type { SourceIntelligenceEvent } from "./sourceEventPublisher";
import { supabaseAdmin } from "../supabase/supabaseClient";

type WorkflowRule = {
  workflow_type: string;
  origin_agent: IntelligenceAgentId;
  responsible_agent: IntelligenceAgentId;
  priority: WorkflowPriority;
  status?: WorkflowStatus;
};

function ruleFor(event: SourceIntelligenceEvent): WorkflowRule | null {
  const type = String(event.event_type || "").toLowerCase();
  if (/visitor_access\.(created|active|approved|used|entered)/.test(type)) return { workflow_type: "visitor_access", origin_agent: "oyi", responsible_agent: "facility", priority: "medium", status: /used|entered/.test(type) ? "completed" : "created" };
  if (/maintenance\.created/.test(type)) return { workflow_type: "maintenance", origin_agent: "oyi", responsible_agent: "facility", priority: event.severity === "critical" ? "critical" : "high", status: "created" };
  if (/maintenance\.(assigned)/.test(type)) return { workflow_type: "maintenance", origin_agent: "facility", responsible_agent: "facility", priority: "high", status: "assigned" };
  if (/maintenance\.(completed|resolved)/.test(type)) return { workflow_type: "maintenance", origin_agent: "facility", responsible_agent: "facility", priority: "high", status: "completed" };
  if (/maintenance\.cancelled/.test(type)) return { workflow_type: "maintenance", origin_agent: "facility", responsible_agent: "facility", priority: "medium", status: "cancelled" };
  if (/device\.command\.requested/.test(type)) return { workflow_type: "device_action", origin_agent: "oyi", responsible_agent: "oyi", priority: "medium", status: "created" };
  if (/device\.command\.(executed|queued)/.test(type)) return { workflow_type: "device_action", origin_agent: "oyi", responsible_agent: "oyi", priority: "medium", status: "completed" };
  if (/device\..*(offline|failed|failure)/.test(type)) return { workflow_type: "security_incident", origin_agent: "edge", responsible_agent: "facility", priority: "high", status: "created" };
  if (/community\.report\.created/.test(type)) return { workflow_type: "community_moderation", origin_agent: "facility", responsible_agent: "facility", priority: "medium", status: "created" };
  if (/(lead\.|office\.).*(assigned|qualified|support)/.test(type)) return { workflow_type: /support/.test(type) ? "office_support" : "office_lead", origin_agent: "oma", responsible_agent: "osa", priority: "medium", status: "created" };
  return null;
}

export function workflowRuleForTest(event: SourceIntelligenceEvent) {
  return ruleFor(event);
}

function stableSourceId(event: SourceIntelligenceEvent, rule: WorkflowRule) {
  return `${rule.workflow_type}:${event.entity_id || event.event_type}:${event.estate_id || "global"}:${event.home_id || ""}`;
}

/** Converts durable source events into idempotent operational workflows. */
export async function orchestrateWorkflowForSourceEvent(event: SourceIntelligenceEvent) {
  const rule = ruleFor(event);
  if (!rule) return { ok: true, skipped: true, reason: "no_workflow_rule" };
  const sourceEventId = stableSourceId(event, rule);
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("ochiga_workflows")
    .select("*")
    .eq("source_event_id", sourceEventId)
    .maybeSingle();
  if (lookupError) return { ok: false, reason: lookupError.message };
  const summary = event.summary || event.title;
  if (!existing) {
    const created = await createWorkflow({
      workflow_type: rule.workflow_type,
      title: event.title,
      summary,
      priority: rule.priority,
      origin_agent: rule.origin_agent,
      responsible_agent: rule.responsible_agent,
      estate_id: event.estate_id || null,
      home_id: event.home_id || null,
      source_event_id: sourceEventId,
      recommended_action: rule.workflow_type === "maintenance" ? "Review and assign the maintenance request." : rule.workflow_type === "visitor_access" ? "Review visitor access status." : "Review the operational workflow.",
      metadata: { source_event_type: event.event_type, source: event.source, entity_type: event.entity_type || null, entity_id: event.entity_id || null },
    });
    if (!created.ok || !created.workflow || !rule.status || rule.status === "created") return created;
    return transitionWorkflow({ workflow: created.workflow, status: rule.status, agent_id: rule.responsible_agent, summary });
  }
  if (!rule.status || existing.workflow_status === rule.status) return { ok: true, skipped: true, workflow: existing, reason: "workflow_already_current" };
  return transitionWorkflow({ workflow: existing, status: rule.status, agent_id: rule.responsible_agent, summary, metadata: { source_event_type: event.event_type } });
}
