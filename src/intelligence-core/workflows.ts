import { supabaseAdmin } from "../supabase/supabaseClient";
import type { AuthUser } from "../middleware/auth";
import type { IntelligenceAgentId } from "./types";
import { publishIntelligenceEvent } from "./eventBus";
import { getIntelligencePermissionPolicy } from "./permissionEngine";
import { recordAgentObservation } from "./observability";

export type WorkflowStatus = "created" | "reviewed" | "assigned" | "in_progress" | "blocked" | "completed" | "cancelled" | "escalated";
export type WorkflowPriority = "low" | "medium" | "high" | "critical";

export const WORKFLOW_STATUSES: WorkflowStatus[] = ["created", "reviewed", "assigned", "in_progress", "blocked", "completed", "cancelled", "escalated"];
export const WORKFLOW_PRIORITIES: WorkflowPriority[] = ["low", "medium", "high", "critical"];

export const WORKFLOW_CONTRACTS = [
  { workflow_type: "customer_converted", origin_agent: "oma", responsible_agent: "osa" },
  { workflow_type: "proposal_accepted", origin_agent: "oma", responsible_agent: "osa" },
  { workflow_type: "meeting_requested", origin_agent: "oma", responsible_agent: "osa" },
  { workflow_type: "deployment_required", origin_agent: "osa", responsible_agent: "facility" },
  { workflow_type: "customer_onboarding", origin_agent: "osa", responsible_agent: "facility" },
  { workflow_type: "edge_required", origin_agent: "facility", responsible_agent: "edge" },
  { workflow_type: "camera_runtime_required", origin_agent: "facility", responsible_agent: "edge" },
  { workflow_type: "camera_validation_required", origin_agent: "facility", responsible_agent: "camera" },
  { workflow_type: "security_event_detected", origin_agent: "camera", responsible_agent: "facility" },
  { workflow_type: "camera_offline", origin_agent: "camera", responsible_agent: "facility" },
  { workflow_type: "camera_tamper", origin_agent: "camera", responsible_agent: "facility" },
  { workflow_type: "prediction_requires_attention", origin_agent: "ochiga_executive", responsible_agent: "ochiga_executive" },
  { workflow_type: "resident_status_changed", origin_agent: "watch", responsible_agent: "oyi" },
] as const;

export const AGENT_RESPONSIBILITY_CONTRACTS = [
  { agent_id: "oyi", responsibility: "Resident-facing home intelligence and approved resident guidance" },
  { agent_id: "facility", responsibility: "Estate operations, deployments, residents, maintenance, visitors, and facility review" },
  { agent_id: "oma", responsibility: "Marketing qualification, lead capture, and handoff recommendations" },
  { agent_id: "osa", responsibility: "Sales follow-up, proposal/demo workflow tracking, and deployment handoff" },
  { agent_id: "camera", responsibility: "Camera event interpretation, validation needs, and security signal handoff" },
  { agent_id: "edge", responsibility: "Local runtime, Edge health, stream health, and camera/DVR runtime support" },
  { agent_id: "watch", responsibility: "Compact resident awareness and Watch-to-Oyi status handoff" },
  { agent_id: "ochiga_executive", responsibility: "Executive summaries, workflow oversight, escalations, and recommended focus areas" },
];

const FORBIDDEN_ACTIONS = ["control_devices", "approve_payments", "create_visitors", "modify_wallets", "modify_permissions", "modify_access_control"];
const ALLOWED_ACTIONS = ["create_workflows", "assign_workflows", "track_workflows", "escalate_workflows", "recommend_actions"];

function canViewWorkflows(actor?: AuthUser | null) {
  const role = getIntelligencePermissionPolicy(actor).role;
  return ["super_admin", "ochiga_admin", "estate_admin", "facility_manager", "security_operator"].includes(role);
}

export function dueAtForPriority(priority: WorkflowPriority, now = new Date()) {
  const hours = priority === "critical" ? 4 : priority === "high" ? 24 : priority === "medium" ? 72 : 24 * 7;
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function escalationAtForPriority(priority: WorkflowPriority, now = new Date()) {
  return dueAtForPriority(priority, now);
}

function normalizePriority(input: any): WorkflowPriority {
  return WORKFLOW_PRIORITIES.includes(String(input) as WorkflowPriority) ? (String(input) as WorkflowPriority) : "medium";
}

async function recordWorkflowEvent(input: { workflow_id: string; workflow_record_id?: string | null; event_type: string; from_status?: string | null; to_status?: string | null; agent_id?: string | null; actor?: AuthUser | null; duration_ms?: number | null; success?: boolean; summary?: string; metadata?: Record<string, unknown> }) {
  const row = {
    workflow_id: input.workflow_id,
    workflow_record_id: input.workflow_record_id || null,
    event_type: input.event_type,
    from_status: input.from_status || null,
    to_status: input.to_status || null,
    agent_id: input.agent_id || null,
    actor_id: input.actor?.id || null,
    duration_ms: input.duration_ms ?? null,
    success: input.success !== false,
    summary: input.summary || null,
    metadata: input.metadata || {},
  };
  const { data, error } = await supabaseAdmin.from("ochiga_workflow_events").insert(row as any).select("*").single();
  return { ok: !error, event: data || null, warning: error?.message || null };
}

export async function createWorkflow(input: {
  workflow_type: string;
  title: string;
  summary: string;
  priority?: WorkflowPriority;
  origin_agent: IntelligenceAgentId;
  responsible_agent: IntelligenceAgentId;
  actor?: AuthUser | null;
  estate_id?: string | null;
  home_id?: string | null;
  workflow_owner?: string | null;
  workflow_assignee?: string | null;
  source_event_id?: string | null;
  source_prediction_id?: string | null;
  recommended_action?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const priority = normalizePriority(input.priority);
  const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    workflow_id: workflowId,
    workflow_type: input.workflow_type,
    workflow_status: "created",
    workflow_priority: priority,
    workflow_owner: input.workflow_owner || input.origin_agent,
    workflow_assignee: input.workflow_assignee || input.responsible_agent,
    workflow_due_at: dueAtForPriority(priority),
    workflow_escalation_at: escalationAtForPriority(priority),
    origin_agent: input.origin_agent,
    responsible_agent: input.responsible_agent,
    title: input.title,
    summary: input.summary,
    recommended_action: input.recommended_action || null,
    actor_id: input.actor?.id || null,
    estate_id: input.estate_id || input.actor?.estate_id || null,
    home_id: input.home_id || input.actor?.home_id || null,
    source_event_id: input.source_event_id || null,
    source_prediction_id: input.source_prediction_id || null,
    metadata: { ...(input.metadata || {}), safety: { allowed_actions: ALLOWED_ACTIONS, forbidden_actions: FORBIDDEN_ACTIONS } },
  };
  const { data, error } = await supabaseAdmin.from("ochiga_workflows").insert(row as any).select("*").single();
  if (error) return { ok: false, error: error.message };
  await recordWorkflowEvent({ workflow_id: workflowId, workflow_record_id: data?.id || null, event_type: "workflow_created", to_status: "created", agent_id: input.origin_agent, actor: input.actor, summary: input.summary });
  await recordAgentObservation({ agent_id: input.origin_agent, action: "workflow_created", tool: "intelligence:workflow", surface: "api", actor: input.actor || null, success: true, workflow_id: workflowId });
  await publishIntelligenceEvent({ actor_id: input.actor?.id || null, agent_id: input.responsible_agent, surface: "api", estate_id: row.estate_id, home_id: row.home_id, event_type: `workflow.${input.workflow_type}`, category: "operational", title: input.title, summary: input.summary, confidence: "confirmed", source: "ochiga_workflows", metadata: { workflow_id: workflowId, workflow_type: input.workflow_type, origin_agent: input.origin_agent, responsible_agent: input.responsible_agent }, occurred_at: new Date().toISOString() }, { source_table: "ochiga_workflows", source_event_id: String(data?.id || workflowId) });
  return { ok: true, workflow: data };
}

export async function listWorkflows(actor?: AuthUser | null, filters: { status?: string | null; escalated?: boolean; limit?: number } = {}) {
  if (!canViewWorkflows(actor)) return { ok: false, error: "Workflow access requires an operational or executive role", workflows: [] };
  let query = supabaseAdmin.from("ochiga_workflows").select("*").order("created_at", { ascending: false }).limit(Math.max(1, Math.min(200, Number(filters.limit || 100))));
  if (actor?.estate_id && getIntelligencePermissionPolicy(actor).role !== "super_admin") query = query.or(`estate_id.is.null,estate_id.eq.${actor.estate_id}`);
  if (filters.status) query = query.eq("workflow_status", filters.status);
  if (filters.escalated) query = query.eq("workflow_status", "escalated");
  const { data, error } = await query;
  return { ok: !error, workflows: data || [], warning: error?.message || null };
}

export async function getWorkflow(id: string, actor?: AuthUser | null) {
  if (!canViewWorkflows(actor)) return { ok: false, error: "Workflow access requires an operational or executive role" };
  const { data, error } = await supabaseAdmin.from("ochiga_workflows").select("*").or(`id.eq.${id},workflow_id.eq.${id}`).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Workflow not found" };
  const policy = getIntelligencePermissionPolicy(actor);
  if (actor?.estate_id && policy.role !== "super_admin" && data.estate_id && data.estate_id !== actor.estate_id) {
    return { ok: false, error: "Workflow not found" };
  }
  const events = await supabaseAdmin.from("ochiga_workflow_events").select("*").eq("workflow_id", data.workflow_id).order("occurred_at", { ascending: false }).limit(100);
  return { ok: true, workflow: data, events: events.data || [], warning: events.error?.message || null };
}

export async function escalateDueWorkflows(actor?: AuthUser | null) {
  if (!canViewWorkflows(actor)) return { ok: false, error: "Workflow escalation requires an operational or executive role" };
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("ochiga_workflows")
    .select("*")
    .lte("workflow_escalation_at", now)
    .in("workflow_status", ["created", "reviewed", "assigned", "in_progress", "blocked"])
    .limit(50);
  if (error) return { ok: false, error: error.message };
  const escalated = [];
  for (const workflow of data || []) {
    const patch = await supabaseAdmin.from("ochiga_workflows").update({ workflow_status: "escalated", updated_at: now, escalated_at: now } as any).eq("id", workflow.id).select("*").single();
    if (!patch.error && patch.data) {
      escalated.push(patch.data);
      await recordWorkflowEvent({ workflow_id: workflow.workflow_id, workflow_record_id: workflow.id, event_type: "workflow_escalated", from_status: workflow.workflow_status, to_status: "escalated", agent_id: workflow.responsible_agent, actor, summary: `Workflow ${workflow.workflow_id} escalated by SLA rule.` });
      await recordAgentObservation({ agent_id: workflow.responsible_agent || "ochiga_executive", action: "workflow_escalated", tool: "intelligence:workflow", surface: "api", actor: actor || null, success: true, workflow_id: workflow.workflow_id });
      await publishIntelligenceEvent({ actor_id: actor?.id || null, agent_id: "ochiga_executive", surface: "api", estate_id: workflow.estate_id, home_id: workflow.home_id, event_type: "workflow.escalated", category: "operational", title: "Workflow escalated", summary: `Workflow ${workflow.title || workflow.workflow_id} requires attention.`, confidence: "confirmed", source: "ochiga_workflows", metadata: { workflow_id: workflow.workflow_id, workflow_type: workflow.workflow_type }, occurred_at: now }, { source_table: "ochiga_workflows", source_event_id: `${workflow.id}:escalated` });
    }
  }
  return { ok: true, escalated_count: escalated.length, workflows: escalated };
}

export function summarizeWorkflows(workflows: any[]) {
  const now = Date.now();
  const open = workflows.filter((w) => !["completed", "cancelled"].includes(String(w.workflow_status))).length;
  const escalated = workflows.filter((w) => w.workflow_status === "escalated").length;
  const critical = workflows.filter((w) => w.workflow_priority === "critical").length;
  const overdue = workflows.filter((w) => w.workflow_due_at && new Date(w.workflow_due_at).getTime() < now && !["completed", "cancelled"].includes(String(w.workflow_status))).length;
  return { open_workflows: open, overdue_workflows: overdue, escalated_workflows: escalated, critical_workflows: critical, total_workflows: workflows.length, top_workflows: workflows.slice(0, 5) };
}

export async function getWorkflowSummary(actor?: AuthUser | null) {
  const result = await listWorkflows(actor, { limit: 200 });
  return { ok: result.ok, summary: summarizeWorkflows(result.workflows || []), warning: result.warning || (result as any).error || null };
}

export async function getOpenWorkflows(actor?: AuthUser | null, limit = 100) {
  const result = await listWorkflows(actor, { limit });
  const workflows = (result.workflows || []).filter((workflow: any) => !["completed", "cancelled"].includes(String(workflow.workflow_status)));
  return { ok: result.ok, workflows, summary: summarizeWorkflows(workflows), warning: result.warning || (result as any).error || null };
}

export async function getEscalatedWorkflows(actor?: AuthUser | null, limit = 100) {
  return listWorkflows(actor, { limit, escalated: true });
}

export async function getAgentResponsibilities(actor?: AuthUser | null) {
  let rows: any[] = [];
  const { data } = await supabaseAdmin.from("ochiga_agent_responsibilities").select("*").order("agent_id", { ascending: true }).limit(200);
  rows = data || [];
  return { ok: true, responsibilities: rows.length ? rows : AGENT_RESPONSIBILITY_CONTRACTS.map((item) => ({ ...item, allowed_actions: ALLOWED_ACTIONS, forbidden_actions: FORBIDDEN_ACTIONS })), memory_boundary: "Responsibilities authorize workflow coordination only, not autonomous high-risk execution." };
}
