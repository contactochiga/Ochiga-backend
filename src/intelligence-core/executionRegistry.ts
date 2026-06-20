import type { AuthUser } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { publishSourceIntelligenceEvent } from "./sourceEventPublisher";

export type RegisteredExecutionAction = {
  id: "visitor.approve" | "visitor.revoke" | "visitor.expire" | "maintenance.assign" | "maintenance.complete" | "maintenance.cancel" | "device.on" | "device.off" | "device.toggle" | "community.approve" | "community.reject" | "service.assign" | "service.complete" | "wallet.approve" | "wallet.cancel";
  domain: string;
  confirmation_required: true;
  available: boolean;
  reason?: string;
};

export const EXECUTION_REGISTRY: RegisteredExecutionAction[] = [
  { id: "visitor.approve", domain: "visitors", confirmation_required: true, available: true },
  { id: "visitor.revoke", domain: "visitors", confirmation_required: true, available: true },
  { id: "visitor.expire", domain: "visitors", confirmation_required: true, available: true },
  { id: "maintenance.assign", domain: "maintenance", confirmation_required: true, available: true },
  { id: "maintenance.complete", domain: "maintenance", confirmation_required: true, available: true },
  { id: "maintenance.cancel", domain: "maintenance", confirmation_required: true, available: true },
  { id: "device.on", domain: "devices", confirmation_required: true, available: true },
  { id: "device.off", domain: "devices", confirmation_required: true, available: true },
  { id: "device.toggle", domain: "devices", confirmation_required: true, available: true },
  { id: "community.approve", domain: "community", confirmation_required: true, available: false, reason: "Use the existing community moderation workflow." },
  { id: "community.reject", domain: "community", confirmation_required: true, available: false, reason: "Use the existing community moderation workflow." },
  { id: "service.assign", domain: "services", confirmation_required: true, available: false, reason: "Use the existing service workflow." },
  { id: "service.complete", domain: "services", confirmation_required: true, available: false, reason: "Use the existing service workflow." },
  { id: "wallet.approve", domain: "wallet", confirmation_required: true, available: false, reason: "Wallet approval remains restricted to the existing payment workflow." },
  { id: "wallet.cancel", domain: "wallet", confirmation_required: true, available: false, reason: "Wallet cancellation remains restricted to the existing payment workflow." },
];

export function getRegisteredExecutionAction(id: string) {
  return EXECUTION_REGISTRY.find((action) => action.id === id) || null;
}

function safeFailure(reason: string) {
  return { ok: false, status: "failed", reason };
}

function operationalRole(actor: AuthUser) {
  return ["super_admin", "ochiga_admin", "estate_admin", "facility_manager", "security_operator", "admin", "manager", "security", "operator"].includes(String(actor.role || "").toLowerCase());
}

function inActorScope(actor: AuthUser, row: any) {
  if (actor.estate_id && row?.estate_id && String(actor.estate_id) !== String(row.estate_id)) return false;
  if (actor.home_id && row?.home_id && String(actor.home_id) !== String(row.home_id) && !operationalRole(actor)) return false;
  return true;
}

function missingUpdatedAtColumn(error: any) {
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  return /updated_at/.test(message) && /column|schema cache|could not find/.test(message);
}

async function updateVisitorAccessStatus(id: string, status: string) {
  const patch = { status, updated_at: new Date().toISOString() } as any;
  const first = await supabaseAdmin.from("visitor_access").update(patch).eq("id", id).select("*").single();
  if (!first.error || !missingUpdatedAtColumn(first.error)) return first;
  return supabaseAdmin.from("visitor_access").update({ status } as any).eq("id", id).select("*").single();
}

export async function executeRegisteredAction(input: { action_id: string; actor: AuthUser; entity_id?: string | null; command?: Record<string, unknown> | null; assignee?: string | null; source?: string; confirmed?: boolean }) {
  const action = getRegisteredExecutionAction(input.action_id);
  if (!action) return safeFailure("action_not_registered");
  if (!input.confirmed) return { ok: false, status: "confirmation_required", reason: "explicit_confirmation_required" };
  if (!input.entity_id) return safeFailure("entity_required");
  if (["visitor.approve", "visitor.revoke", "visitor.expire"].includes(action.id)) {
    const { data: visitor, error } = await supabaseAdmin.from("visitor_access").select("*").eq("id", input.entity_id).maybeSingle();
    if (error || !visitor) return safeFailure("visitor_lookup_failed");
    if (!inActorScope(input.actor, visitor)) return { ok: false, status: "denied", reason: "scope_mismatch" };
    if (!operationalRole(input.actor) && ![visitor.created_by, visitor.resident_id].map(String).includes(String(input.actor.id))) return { ok: false, status: "denied", reason: "visitor_operation_not_permitted" };
    const status = action.id === "visitor.approve" ? "approved" : action.id === "visitor.expire" ? "expired" : "denied";
    const { data: updated, error: updateError } = await updateVisitorAccessStatus(visitor.id, status);
    if (updateError) return { ok: false, status: "failed", reason: "visitor_access_update_failed" };
    void publishSourceIntelligenceEvent({ source: operationalRole(input.actor) ? "facility" : "consumer", surface: operationalRole(input.actor) ? "facility" : "consumer", event_type: `visitor_access.${status}`, category: "visitor", estate_id: updated.estate_id, home_id: updated.home_id, actor_id: input.actor.id, entity_type: "visitor_access", entity_id: updated.id, entity_label: updated.visitor_name || "Visitor", severity: status === "denied" ? "attention" : "info", title: `Visitor access ${status}`, summary: `${updated.visitor_name || "Visitor"} access is ${status}.`, payload: { status } }, { source_table: "visitor_access", source_event_id: `${updated.id}:visitor_access.${status}` });
    return { ok: true, status: "executed", result: updated };
  }
  if (["maintenance.complete", "maintenance.cancel", "maintenance.assign"].includes(action.id)) {
    const { data: request, error } = await supabaseAdmin.from("maintenance_requests").select("*").eq("id", input.entity_id).maybeSingle();
    if (error || !request) return safeFailure("maintenance_lookup_failed");
    if (!inActorScope(input.actor, request)) return { ok: false, status: "denied", reason: "scope_mismatch" };
    if (!operationalRole(input.actor) && !(action.id === "maintenance.cancel" && String(request.resident_id || "") === String(input.actor.id))) return { ok: false, status: "denied", reason: "maintenance_operation_not_permitted" };
    if (action.id === "maintenance.assign" && !String(input.assignee || "").trim()) return { ok: false, status: "validation_required", reason: "assignee_required" };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (action.id === "maintenance.complete") patch.status = "completed";
    if (action.id === "maintenance.cancel") patch.status = "cancelled";
    if (action.id === "maintenance.assign") { patch.status = "assigned"; patch.assigned_to = String(input.assignee); }
    const { data: updated, error: updateError } = await supabaseAdmin.from("maintenance_requests").update(patch as any).eq("id", request.id).select("*").single();
    if (updateError) return safeFailure("maintenance_update_failed");
    const eventType = `maintenance.${updated.status || "updated"}`;
    void publishSourceIntelligenceEvent({ source: "facility", surface: "facility", event_type: eventType, category: "maintenance", estate_id: updated.estate_id, home_id: updated.home_id, actor_id: input.actor.id, entity_type: "maintenance_request", entity_id: updated.id, entity_label: updated.title || "Maintenance request", severity: "info", title: updated.title || "Maintenance request updated", summary: `Maintenance request is ${updated.status || "updated"}.`, payload: { status: updated.status, assigned_to: updated.assigned_to || null } }, { source_table: "maintenance_requests", source_event_id: `${updated.id}:${eventType}` });
    return { ok: true, status: "executed", result: updated };
  }
  if (!action.available) return { ok: false, status: "validation_required", reason: action.reason || "action_not_available" };
  if (!input.command) return safeFailure("command_required");
  try {
    // Load the legacy command boundary only for a confirmed device action.
    const { executeDeviceCommandForActor } = await import("../controllers/deviceCommandController");
    const result = await executeDeviceCommandForActor({ actor: input.actor, deviceId: input.entity_id, command: input.command as Record<string, any>, source: (input.source || "app") as any });
    return { ok: Boolean(result?.ok), status: result?.status || "failed", result };
  } catch (error: any) {
    return safeFailure("execution_failed");
  }
}
