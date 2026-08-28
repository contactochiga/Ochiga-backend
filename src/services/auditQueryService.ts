// Phase 2 commercial-hardening: a general-purpose, TENANT-SCOPED audit
// listing -- distinct from securityObservability.ts's getSecurityObservability
// (which only surfaces denied/failed events for the security-denials feed)
// and from superAdminController.listAuditLogs (platform-wide,
// super_admin/ochiga_admin only, queries the separate super_admin_audit_logs
// table). This one queries the real audit_events table that emitAuditEvent()
// writes to everywhere in the app, always filtered by the caller's own
// estate_id -- there is no code path in this function that can return
// another tenant's events.
import { supabaseAdmin } from "../supabase/supabaseClient";

function boundedLimit(value: unknown, fallback = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(200, Math.floor(parsed))) : fallback;
}

function safeAuditEvent(event: any) {
  return {
    id: event.id,
    occurred_at: event.created_at,
    action: event.action,
    resource_type: event.resource_type,
    resource_id: event.resource_id || null,
    actor_id: event.actor_id || null,
    actor_role: event.actor_role || null,
    status: event.status,
    metadata: event.metadata || {},
  };
}

export async function getEstateAuditLog(input: {
  estateId: string;
  limit?: number;
  before?: string | null;
  action?: string | null;
}) {
  if (!input.estateId) return { ok: false as const, error: "estate_id_required" };
  const limit = boundedLimit(input.limit);

  let query = supabaseAdmin
    .from("audit_events")
    .select("id,created_at,action,resource_type,resource_id,actor_id,actor_role,status,metadata")
    // The one non-negotiable line in this whole function: every query this
    // service ever issues is scoped to exactly one estate.
    .eq("estate_id", input.estateId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.before) query = query.lt("created_at", input.before);
  if (input.action) query = query.ilike("action", `%${input.action}%`);

  const { data, error } = await query;
  if (error) return { ok: false as const, error: "audit_log_unavailable" };

  return {
    ok: true as const,
    estate_id: input.estateId,
    events: (data || []).map(safeAuditEvent),
  };
}
