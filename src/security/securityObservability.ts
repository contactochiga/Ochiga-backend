import { supabaseAdmin } from "../supabase/supabaseClient";

type SecurityObservabilityFilters = {
  estateId?: string | null;
  limit?: number;
};

function boundedLimit(value: unknown, fallback = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : fallback;
}

function classify(event: any) {
  const action = String(event.action || "").toLowerCase();
  const reason = String(event.metadata?.reason || "").toLowerCase();
  if (action.includes("prediction") && event.status === "denied") return "prediction_authorization_denial";
  if (action.includes("workflow") && event.status === "denied") return "workflow_visibility_denial";
  if (reason.includes("scope") || reason.includes("estate") || reason.includes("home")) return "scope_mismatch";
  if (event.status === "denied" || action.includes("permission.denied") || action.includes("auth.failed")) return "unauthorized_attempt";
  return "failed_operation";
}

function safeEvent(event: any) {
  return {
    id: event.id,
    occurred_at: event.created_at || event.occurred_at,
    category: classify(event),
    action: event.action,
    resource_type: event.resource_type,
    resource_id: event.resource_id || null,
    estate_id: event.estate_id || null,
    home_id: event.home_id || null,
    actor_role: event.actor_role || null,
    status: event.status,
  };
}

export async function getSecurityAuditReport() {
  const { data, error } = await supabaseAdmin.rpc("oyi_security_audit_report");
  if (error) return { ok: false, error: "Security audit report is unavailable" };
  return { ok: true, report: data || {} };
}

export async function getSecurityObservability(filters: SecurityObservabilityFilters = {}) {
  const limit = boundedLimit(filters.limit);
  let query = supabaseAdmin
    .from("audit_events")
    .select("id,created_at,action,resource_type,resource_id,estate_id,home_id,actor_role,status,metadata")
    .in("status", ["denied", "failed"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (filters.estateId) query = query.eq("estate_id", filters.estateId);
  const { data, error } = await query;
  if (error) return { ok: false, error: "Security observability is unavailable" };

  const events = (data || []).map(safeEvent);
  const counts = events.reduce<Record<string, number>>((result, event) => {
    result[event.category] = (result[event.category] || 0) + 1;
    return result;
  }, {});
  return { ok: true, generated_at: new Date().toISOString(), counts, events };
}
