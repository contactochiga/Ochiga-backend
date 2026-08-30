import type { AuthUser } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { publishSourceIntelligenceEvent } from "./sourceEventPublisher";

export type RegisteredExecutionAction = {
  id: "visitor.approve" | "visitor.revoke" | "visitor.expire" | "maintenance.assign" | "maintenance.complete" | "maintenance.cancel" | "device.on" | "device.off" | "device.toggle" | "notification.notify" | "community.approve" | "community.reject" | "community.post_announcement" | "maintenance.create" | "security.create_incident" | "service.assign" | "service.complete" | "wallet.approve" | "wallet.cancel";
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
  // Cross-Domain Operational Automation -- the one new domain action this
  // pass wires. NotificationService.sendToRole/sendToUser/sendToHome/
  // sendToEstate (src/services/NotificationService.ts) is a real, already
  // generic, already-used-everywhere primitive -- not new notification
  // logic, only a new registered entry point onto it.
  { id: "notification.notify", domain: "notifications", confirmation_required: true, available: true },
  // Cross-Domain Fabric Closure -- the three new adapters this pass wires.
  // Each extracts a real, facility-staff/automation-scoped core function
  // (createFacilityMaintenanceOrder, postCommunityAnnouncement,
  // createFacilityIncident) distinct from the resident/staff-facing
  // req/res-coupled controller endpoint it sits alongside, exactly the
  // "real, scoped follow-up" the previous unavailable reasons here
  // described rather than promised.
  { id: "maintenance.create", domain: "maintenance", confirmation_required: true, available: true },
  { id: "community.post_announcement", domain: "community", confirmation_required: true, available: true },
  { id: "security.create_incident", domain: "security", confirmation_required: true, available: true },
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
  // "operator" here is the legacy UserRole alias (src/core/foundation/
  // permissions.ts LEGACY_ROLE_ALIASES) for maintenance_operator — the
  // real, current PlatformRole string ("maintenance_operator") was
  // missing from this list, which meant a genuine maintenance_operator
  // actor (e.g. Facility's own maintenance staff, per its dedicated
  // PATCH /facility/maintenance/:id route requiring support.assign)
  // could never pass this check despite having a real operational
  // role. Found via Shared Automation Runtime PR 2 verification.
  return ["super_admin", "ochiga_admin", "estate_admin", "facility_manager", "maintenance_operator", "security_operator", "admin", "manager", "security", "operator"].includes(String(actor.role || "").toLowerCase());
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
  // notification.notify and the three "create a new entity" actions below
  // have no single existing target row to reference -- they either address
  // a role/user/home/estate, or create the entity_id that will exist only
  // after execution.
  const ENTITY_LESS_ACTIONS = ["notification.notify", "maintenance.create", "community.post_announcement", "security.create_incident"];
  if (!input.entity_id && !ENTITY_LESS_ACTIONS.includes(action.id)) return safeFailure("entity_required");
  if (["visitor.approve", "visitor.revoke", "visitor.expire"].includes(action.id)) {
    const { data: visitor, error } = await supabaseAdmin.from("visitor_access").select("*").eq("id", input.entity_id).maybeSingle();
    if (error || !visitor) return safeFailure("visitor_lookup_failed");
    if (!inActorScope(input.actor, visitor)) return { ok: false, status: "denied", reason: "scope_mismatch" };
    if (!operationalRole(input.actor) && ![visitor.created_by, visitor.resident_id].map(String).includes(String(input.actor.id))) return { ok: false, status: "denied", reason: "visitor_operation_not_permitted" };
    const status = action.id === "visitor.approve" ? "approved" : action.id === "visitor.expire" ? "expired" : "denied";
    const { data: updated, error: updateError } = await updateVisitorAccessStatus(visitor.id, status);
    if (updateError) return { ok: false, status: "failed", reason: "visitor_access_update_failed" };
    void publishSourceIntelligenceEvent({ source: operationalRole(input.actor) ? "facility" : "consumer", surface: operationalRole(input.actor) ? "facility" : "consumer", event_type: `visitor_access.${status}`, category: "visitor", estate_id: updated.estate_id, home_id: updated.home_id, actor_id: input.actor.id, entity_type: "visitor_access", entity_id: updated.id, entity_label: updated.visitor_name || "Visitor", severity: status === "denied" ? "attention" : "info", title: `Visitor access ${status}`, summary: `${updated.visitor_name || "Visitor"} access is ${status}.`, payload: { status }, automation_origin: input.source === "automation" }, { source_table: "visitor_access", source_event_id: `${updated.id}:visitor_access.${status}` });
    return { ok: true, status: "executed", result: updated };
  }
  if (["maintenance.complete", "maintenance.cancel", "maintenance.assign"].includes(action.id)) {
    const { data: request, error } = await supabaseAdmin.from("maintenance_requests").select("*").eq("id", input.entity_id).maybeSingle();
    if (error || !request) return safeFailure("maintenance_lookup_failed");
    if (!inActorScope(input.actor, request)) return { ok: false, status: "denied", reason: "scope_mismatch" };
    if (!operationalRole(input.actor) && !(action.id === "maintenance.cancel" && String(request.resident_id || "") === String(input.actor.id))) return { ok: false, status: "denied", reason: "maintenance_operation_not_permitted" };
    // Fabric Closure fix -- executeApprovalRow (facilityAutomationService.ts)
    // only ever threads the approved plan_snapshot's `command` through to
    // this function, never a top-level `assignee` (that field only gets a
    // value on a direct executeRegisteredAction call, e.g. a synchronous
    // consumer-surface command, not the approval/event-rule path). Reading
    // command?.assignee as a fallback means maintenance.assign actually
    // works when reached via approval, not only when called directly.
    const assignee = String(input.assignee || (input.command as any)?.assignee || "").trim();
    if (action.id === "maintenance.assign" && !assignee) return { ok: false, status: "validation_required", reason: "assignee_required" };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (action.id === "maintenance.complete") patch.status = "completed";
    if (action.id === "maintenance.cancel") patch.status = "cancelled";
    if (action.id === "maintenance.assign") { patch.status = "assigned"; patch.assigned_to = assignee; }
    const { data: updated, error: updateError } = await supabaseAdmin.from("maintenance_requests").update(patch as any).eq("id", request.id).select("*").single();
    if (updateError) return safeFailure("maintenance_update_failed");
    const eventType = `maintenance.${updated.status || "updated"}`;
    void publishSourceIntelligenceEvent({ source: "facility", surface: "facility", event_type: eventType, category: "maintenance", estate_id: updated.estate_id, home_id: updated.home_id, actor_id: input.actor.id, entity_type: "maintenance_request", entity_id: updated.id, entity_label: updated.title || "Maintenance request", severity: "info", title: updated.title || "Maintenance request updated", summary: `Maintenance request is ${updated.status || "updated"}.`, payload: { status: updated.status, assigned_to: updated.assigned_to || null }, automation_origin: input.source === "automation" }, { source_table: "maintenance_requests", source_event_id: `${updated.id}:${eventType}` });
    return { ok: true, status: "executed", result: updated };
  }
  if (action.id === "maintenance.create") {
    if (!operationalRole(input.actor)) return { ok: false, status: "denied", reason: "maintenance_operation_not_permitted" };
    const estateId = input.actor.estate_id ? String(input.actor.estate_id) : null;
    if (!estateId) return safeFailure("estate_context_required");
    const command = (input.command || {}) as { title?: string; description?: string; priority?: string; category?: string; home_id?: string | null };
    const title = String(command.title || "").trim();
    if (!title) return safeFailure("maintenance_title_required");
    const { createFacilityMaintenanceOrder } = await import("../controllers/maintenance.controller");
    const request = await createFacilityMaintenanceOrder({ estateId, homeId: command.home_id || input.actor.home_id || null, title, description: command.description || null, priority: command.priority || "medium", category: command.category || null, actorId: input.actor.id, automationOrigin: input.source === "automation" });
    return { ok: true, status: "executed", result: request };
  }
  if (action.id === "community.post_announcement") {
    if (!operationalRole(input.actor)) return { ok: false, status: "denied", reason: "community_operation_not_permitted" };
    const estateId = input.actor.estate_id ? String(input.actor.estate_id) : null;
    if (!estateId) return safeFailure("estate_context_required");
    const command = (input.command || {}) as { title?: string; body?: string };
    const title = String(command.title || "").trim();
    if (!title) return safeFailure("announcement_title_required");
    const { postCommunityAnnouncement } = await import("../controllers/communityController");
    const post = await postCommunityAnnouncement({ estateId, actorId: input.actor.id, title, body: String(command.body || ""), notifyEstate: true, automationOrigin: input.source === "automation" });
    return { ok: true, status: "executed", result: post };
  }
  if (action.id === "security.create_incident") {
    if (!operationalRole(input.actor)) return { ok: false, status: "denied", reason: "security_operation_not_permitted" };
    const estateId = input.actor.estate_id ? String(input.actor.estate_id) : null;
    if (!estateId) return safeFailure("estate_context_required");
    const command = (input.command || {}) as { title?: string; description?: string; severity?: string; incident_type?: string; home_id?: string | null };
    const title = String(command.title || "").trim();
    if (!title) return safeFailure("incident_title_required");
    const { createFacilityIncident } = await import("../services/platformGapService");
    const incident = await createFacilityIncident({ estateId, homeId: command.home_id || input.actor.home_id || null, title, description: command.description || null, severity: command.severity || "medium", incidentType: command.incident_type || "operational", actorId: input.actor.id, automationOrigin: input.source === "automation" });
    return { ok: true, status: "executed", result: incident };
  }
  if (action.id === "notification.notify") {
    const command = (input.command || {}) as { target?: string; target_value?: string; title?: string; message?: string; notification_type?: string };
    const target = String(command.target || "").toLowerCase();
    const title = String(command.title || "").trim();
    const message = String(command.message || "").trim();
    if (!title || !message) return safeFailure("notification_title_and_message_required");
    const estateId = input.actor.estate_id ? String(input.actor.estate_id) : null;
    if (!estateId) return safeFailure("estate_context_required");
    if (!operationalRole(input.actor)) return { ok: false, status: "denied", reason: "notification_operation_not_permitted" };
    const NOTIFICATION_TYPES = ["visitor", "maintenance", "device", "room", "home", "estate", "community", "message", "security", "intelligence", "wallet", "system"];
    const notificationType = (NOTIFICATION_TYPES.includes(String(command.notification_type)) ? command.notification_type : "system") as any;
    const { NotificationService } = await import("../services/NotificationService");
    let sendError: any = null;
    if (target === "role") {
      const role = String(command.target_value || "").trim().toLowerCase();
      if (!role) return safeFailure("notification_role_required");
      ({ error: sendError } = await NotificationService.sendToRole(estateId, role, { title, message, type: notificationType }));
    } else if (target === "estate") {
      ({ error: sendError } = await NotificationService.sendToEstate(estateId, { title, message, type: notificationType }));
    } else if (target === "user") {
      const userId = String(command.target_value || "").trim();
      if (!userId) return safeFailure("notification_user_required");
      const { data: membership } = await supabaseAdmin.from("estate_memberships").select("user_id").eq("estate_id", estateId).eq("user_id", userId).eq("status", "active").maybeSingle();
      if (!membership) return { ok: false, status: "denied", reason: "scope_mismatch" };
      ({ error: sendError } = await NotificationService.sendToUser(userId, { title, message, type: notificationType }));
    } else if (target === "home") {
      const homeId = String(command.target_value || "").trim();
      if (!homeId) return safeFailure("notification_home_required");
      const { data: home } = await supabaseAdmin.from("homes").select("id, estate_id").eq("id", homeId).maybeSingle();
      if (!home || String(home.estate_id) !== estateId) return { ok: false, status: "denied", reason: "scope_mismatch" };
      ({ error: sendError } = await NotificationService.sendToHome(homeId, { title, message, type: notificationType }));
    } else {
      return safeFailure("notification_target_invalid");
    }
    if (sendError) return safeFailure("notification_send_failed");
    void publishSourceIntelligenceEvent({ source: "facility", surface: "facility", event_type: "notification.sent", category: "notification", estate_id: estateId, home_id: target === "home" ? String(command.target_value) : null, actor_id: input.actor.id, entity_type: "notification", entity_id: null, entity_label: title, severity: "info", title, summary: message, payload: { target, target_value: command.target_value || null }, automation_origin: input.source === "automation" }, { source_table: "notifications", source_event_id: `notify:${input.actor.id}:${estateId}:${target}:${command.target_value || ""}` });
    return { ok: true, status: "executed", result: { target, target_value: command.target_value || null, title, message } };
  }
  if (!action.available) return { ok: false, status: "validation_required", reason: action.reason || "action_not_available" };
  if (!input.command) return safeFailure("command_required");
  try {
    // Load the legacy command boundary only for a confirmed device action.
    const { executeDeviceCommandForActor } = await import("../controllers/deviceCommandController");
    const result = await executeDeviceCommandForActor({ actor: input.actor, deviceId: String(input.entity_id), command: input.command as Record<string, any>, source: (input.source || "app") as any });
    return { ok: Boolean(result?.ok), status: result?.status || "failed", result };
  } catch (error: any) {
    return safeFailure("execution_failed");
  }
}
