import { supabaseAdmin } from "../supabase/supabaseClient";
import type { AuthUser } from "../middleware/auth";
import { INTELLIGENCE_AGENTS, getIntelligenceAgent } from "./agentRegistry";
import { getAgentObservabilitySummary } from "./observability";
import { getIntelligencePermissionPolicy } from "./permissionEngine";

function canViewOrganizationObservability(actor?: AuthUser | null) {
  const role = getIntelligencePermissionPolicy(actor).role;
  return ["super_admin", "ochiga_admin", "estate_admin", "facility_manager"].includes(role);
}

export async function getExpandedObservability(actor?: AuthUser | null) {
  if (!canViewOrganizationObservability(actor)) return { ok: false, error: "Observability requires management access", summary: null, observations: [] };
  const summary = await getAgentObservabilitySummary(250);
  let query = supabaseAdmin
    .from("ochiga_agent_observability")
    .select("agent_id,action,tool,success,latency_ms,department_id,team_id,role_id,employee_id,estate_id,home_id,occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (actor?.estate_id && getIntelligencePermissionPolicy(actor).role !== "super_admin") {
    query = query.or(`estate_id.is.null,estate_id.eq.${actor.estate_id}`);
  }
  const { data, error } = await query;
  return { ok: !error, summary, observations: data || [], warning: error?.message || null };
}

export async function getAgentHealth(agentId: string, actor?: AuthUser | null) {
  if (!canViewOrganizationObservability(actor)) return { ok: false, error: "Agent health requires management access" };
  const agent = getIntelligenceAgent(agentId as any);
  if (!agent) return { ok: false, error: "Unknown intelligence agent" };
  let query = supabaseAdmin
    .from("ochiga_agent_observability")
    .select("agent_id,action,tool,success,latency_ms,department_id,team_id,role_id,employee_id,occurred_at")
    .eq("agent_id", agentId)
    .order("occurred_at", { ascending: false })
    .limit(100);
  const role = getIntelligencePermissionPolicy(actor).role;
  if (actor?.estate_id && role !== "super_admin" && role !== "ochiga_admin") {
    query = query.or(`estate_id.is.null,estate_id.eq.${actor.estate_id}`);
  }
  const { data, error } = await query;
  if (error) return { ok: false, agent, warning: error.message, readiness_score: 50 };
  const rows = data || [];
  const failures = rows.filter((row: any) => row.success === false).length;
  const latency = rows.map((row: any) => Number(row.latency_ms)).filter((n) => Number.isFinite(n));
  const readiness = rows.length ? Math.max(0, Math.round(100 - (failures / rows.length) * 60 - (latency.some((n) => n > 3000) ? 15 : 0))) : 75;
  return {
    ok: true,
    agent,
    readiness_score: readiness,
    observations: rows.length,
    failures,
    average_latency_ms: latency.length ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length) : null,
    recent: rows.slice(0, 10),
  };
}

export function listAgentHealthContracts() {
  return INTELLIGENCE_AGENTS.map((agent) => ({ id: agent.id, name: agent.name, risk_level: agent.risk_level, memory_scope: agent.memory_scope }));
}
