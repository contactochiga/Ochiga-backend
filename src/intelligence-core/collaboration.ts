import { supabaseAdmin } from "../supabase/supabaseClient";
import type { AuthUser } from "../middleware/auth";
import type { IntelligenceAgentId } from "./types";
import { normalizeIntelligenceCategory, publishIntelligenceEvent } from "./eventBus";

export type AgentCollaborationRule = {
  id: string;
  from: IntelligenceAgentId;
  to: IntelligenceAgentId;
  trigger: string;
  event_type: string;
  purpose: string;
  enabled: boolean;
};

export const AGENT_COLLABORATION_RULES: AgentCollaborationRule[] = [
  {
    id: "oma_osa_customer_converted",
    from: "oma",
    to: "osa",
    trigger: "customer_converted",
    event_type: "customer_converted",
    purpose: "OMA qualifies or converts a lead; OSA owns sales follow-up and commercial handoff.",
    enabled: true,
  },
  {
    id: "osa_facility_deployment_required",
    from: "osa",
    to: "facility",
    trigger: "deployment_required",
    event_type: "deployment_required",
    purpose: "OSA identifies a customer/deployment need; Facility prepares operational onboarding context.",
    enabled: true,
  },
  {
    id: "facility_edge_camera_runtime_required",
    from: "facility",
    to: "edge",
    trigger: "camera_runtime_required",
    event_type: "camera_runtime_required",
    purpose: "Facility needs local Edge runtime support for camera/DVR streaming or health checks.",
    enabled: true,
  },
  {
    id: "camera_facility_security_event_detected",
    from: "camera",
    to: "facility",
    trigger: "security_event_detected",
    event_type: "security_event_detected",
    purpose: "Camera agent reports a security-relevant event; Facility reviews and decides operational response.",
    enabled: true,
  },
  {
    id: "watch_oyi_resident_status_changed",
    from: "watch",
    to: "oyi",
    trigger: "resident_status_changed",
    event_type: "resident_status_changed",
    purpose: "Watch sends compact resident/home status change; Oyi owns resident-facing explanation.",
    enabled: true,
  },
  {
    id: "edge_camera_stream_restored",
    from: "edge",
    to: "camera",
    trigger: "stream_restored",
    event_type: "stream_restored",
    purpose: "Edge reports restored stream health; Camera agent updates camera readiness context.",
    enabled: true,
  },
  {
    id: "prediction_executive_high_priority_prediction",
    from: "facility",
    to: "ochiga_executive",
    trigger: "high_priority_prediction",
    event_type: "high_priority_prediction",
    purpose: "Prediction engine exposes high-priority risk summaries to Executive Intelligence without raw private memory.",
    enabled: true,
  },
];

export function getCollaborationHints(events: any[]) {
  const hints = new Set<string>();
  for (const event of events) {
    const category = normalizeIntelligenceCategory(event.category);
    const agent = String(event.agent_id || "");
    const eventType = String(event.event_type || "");
    if (agent === "camera" || category === "camera" || /security|camera/i.test(eventType)) hints.add("camera_facility_security_event_detected");
    if (agent === "oma" || category === "marketing") hints.add("oma_osa_customer_converted");
    if (agent === "osa" || category === "sales") hints.add("osa_facility_deployment_required");
    if (agent === "facility" || category === "edge") hints.add("facility_edge_camera_runtime_required");
    if (agent === "watch" || String(event.surface || "") === "watch") hints.add("watch_oyi_resident_status_changed");
    if (agent === "edge" || /stream_restored/i.test(eventType)) hints.add("edge_camera_stream_restored");
    if (/prediction|risk|critical|warning/i.test(`${eventType} ${event.title || ""}`)) hints.add("prediction_executive_high_priority_prediction");
  }
  return AGENT_COLLABORATION_RULES.filter((rule) => hints.has(rule.id));
}

export async function listAgentCollaborations(actor?: AuthUser | null, limit = 100) {
  let query = supabaseAdmin
    .from("ochiga_agent_collaborations")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));
  if (actor?.estate_id) query = query.or(`estate_id.is.null,estate_id.eq.${actor.estate_id}`);
  const { data, error } = await query;
  return {
    ok: !error,
    contracts: AGENT_COLLABORATION_RULES,
    collaborations: data || [],
    warning: error?.message || null,
    memory_boundary: "Collaboration events carry summarized handoff metadata only. They must not contain raw resident memory, private CRM notes, camera credentials, or tokens.",
  };
}

export async function recordAgentCollaboration(input: {
  workflow_id: string;
  from_agent: IntelligenceAgentId;
  to_agent: IntelligenceAgentId;
  event_type: string;
  title: string;
  summary: string;
  actor?: AuthUser | null;
  estate_id?: string | null;
  home_id?: string | null;
  department_id?: string | null;
  team_id?: string | null;
  source_event_id?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const row = {
    workflow_id: input.workflow_id,
    from_agent: input.from_agent,
    to_agent: input.to_agent,
    event_type: input.event_type,
    title: input.title,
    summary: input.summary,
    actor_id: input.actor?.id || null,
    estate_id: input.estate_id || input.actor?.estate_id || null,
    home_id: input.home_id || input.actor?.home_id || null,
    department_id: input.department_id || null,
    team_id: input.team_id || null,
    source_event_id: input.source_event_id || null,
    metadata: input.metadata || {},
  };

  const { data, error } = await supabaseAdmin.from("ochiga_agent_collaborations").insert(row as any).select("*").single();
  if (error) return { ok: false, error: error.message };

  const bus = await publishIntelligenceEvent(
    {
      actor_id: row.actor_id,
      agent_id: input.to_agent,
      surface: "api",
      estate_id: row.estate_id,
      home_id: row.home_id,
      event_type: `collaboration.${input.event_type}`,
      category: "operational",
      title: input.title,
      summary: input.summary,
      confidence: "confirmed",
      source: "ochiga_agent_collaborations",
      metadata: { ...row.metadata, workflow_id: input.workflow_id, from_agent: input.from_agent, to_agent: input.to_agent, collaboration_id: data?.id || null },
      occurred_at: data?.occurred_at || new Date().toISOString(),
    },
    { source_table: "ochiga_agent_collaborations", source_event_id: String(data?.id || "") }
  );

  return { ok: true, collaboration: data, intelligence_event: bus };
}
