// Facility Automation -- Cross-Domain Fabric Closure.
//
// Event-driven rule CRUD + the matcher that turns a real, durably-recorded
// intelligence event into an automation_approvals proposal (or, for
// auto_allowed policy, straight into execution via the same
// executeApprovalRow every human approval already goes through). This adds
// NO second automation engine: it is a new way to REACH the existing
// governed pipeline (resolveAutomationPolicy -> proposeAutomationApproval
// -> executeApprovalRow), not a parallel one.
import type { AuthUser } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { getRegisteredExecutionAction } from "../intelligence-core/executionRegistry";
import { isRegisteredTriggerEventType } from "../intelligence-core/triggerRegistry";
import { hasPermission, type PermissionKey } from "../core/foundation/permissions";
import { evaluateAutomationConditions, type AutomationCondition } from "./automationConditionEvaluator";
import { resolveAutomationPolicy, registeredActionRequiredPermission } from "./automationPolicyResolver";
import { proposeAutomationApproval, executeApprovalRow, emitFacilityAutomationRealtime } from "./facilityAutomationService";

export type FacilityAutomationEventRule = {
  id: string;
  estate_id: string;
  name: string;
  trigger_event_type: string;
  conditions: AutomationCondition[];
  action_id: string;
  action_params: Record<string, unknown>;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function validateRuleInput(input: { trigger_event_type: string; action_id: string; conditions?: unknown }) {
  if (!isRegisteredTriggerEventType(input.trigger_event_type)) {
    return { ok: false as const, error: `"${input.trigger_event_type}" is not a registered trigger event type.` };
  }
  const action = getRegisteredExecutionAction(input.action_id);
  if (!action || !action.available) {
    return { ok: false as const, error: `"${input.action_id}" is not an available registered action.` };
  }
  if (input.conditions !== undefined && !Array.isArray(input.conditions)) {
    return { ok: false as const, error: "conditions must be an array." };
  }
  return { ok: true as const };
}

export async function createEventRule(input: {
  estateId: string;
  actorId: string | null;
  name: string;
  triggerEventType: string;
  conditions: AutomationCondition[];
  actionId: string;
  actionParams: Record<string, unknown>;
}) {
  const validation = validateRuleInput({ trigger_event_type: input.triggerEventType, action_id: input.actionId, conditions: input.conditions });
  if (!validation.ok) throw new Error(validation.error);

  const { data, error } = await supabaseAdmin
    .from("facility_automation_event_rules")
    .insert({
      estate_id: input.estateId,
      name: input.name.slice(0, 200),
      trigger_event_type: input.triggerEventType,
      conditions: input.conditions,
      action_id: input.actionId,
      action_params: input.actionParams || {},
      created_by: input.actorId,
    })
    .select("*")
    .single();
  if (error) throw error;
  emitFacilityAutomationRealtime(input.estateId, "rule.created", { rule_id: data.id, name: data.name });
  return data as FacilityAutomationEventRule;
}

export async function listEventRules(estateId: string) {
  const { data, error } = await supabaseAdmin
    .from("facility_automation_event_rules")
    .select("*")
    .eq("estate_id", estateId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as FacilityAutomationEventRule[];
}

export async function updateEventRule(id: string, estateId: string, patch: Partial<{ name: string; triggerEventType: string; conditions: AutomationCondition[]; actionId: string; actionParams: Record<string, unknown>; enabled: boolean }>) {
  if (patch.triggerEventType && !isRegisteredTriggerEventType(patch.triggerEventType)) throw new Error(`"${patch.triggerEventType}" is not a registered trigger event type.`);
  if (patch.actionId) {
    const action = getRegisteredExecutionAction(patch.actionId);
    if (!action || !action.available) throw new Error(`"${patch.actionId}" is not an available registered action.`);
  }
  if (patch.conditions !== undefined && !Array.isArray(patch.conditions)) throw new Error("conditions must be an array.");
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) dbPatch.name = patch.name.slice(0, 200);
  if (patch.triggerEventType !== undefined) dbPatch.trigger_event_type = patch.triggerEventType;
  if (patch.conditions !== undefined) dbPatch.conditions = patch.conditions;
  if (patch.actionId !== undefined) dbPatch.action_id = patch.actionId;
  if (patch.actionParams !== undefined) dbPatch.action_params = patch.actionParams;
  if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;

  const { data, error } = await supabaseAdmin
    .from("facility_automation_event_rules")
    .update(dbPatch)
    .eq("id", id)
    .eq("estate_id", estateId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  emitFacilityAutomationRealtime(estateId, patch.enabled !== undefined ? (patch.enabled ? "rule.enabled" : "rule.disabled") : "rule.updated", { rule_id: data.id, name: data.name });
  return data as FacilityAutomationEventRule;
}

export async function deleteEventRule(id: string, estateId: string) {
  const { data, error } = await supabaseAdmin
    .from("facility_automation_event_rules")
    .delete()
    .eq("id", id)
    .eq("estate_id", estateId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (data) emitFacilityAutomationRealtime(estateId, "rule.deleted", { rule_id: id });
  return Boolean(data);
}

// Wave 5 Slice 2 -- explicit, honest automation-system authority subject.
// Previously this constructed { id: "system:automation", role: "manager" }
// -- AuthUser's legacy alias for the real PlatformRole facility_manager --
// solely to inherit that role's blanket permission set (visitors.manage,
// support.assign, devices.control, notifications.manage,
// community.manage_announcements) so SOME registered action would pass.
// That is the automation runtime pretending to be a facility manager:
// auto_allowed must mean "this action has explicitly been authorized for
// autonomous execution under this estate's automation policy," never
// "pretend a human approved it."
//
// This reuses "ai_agent" -- a real, already-existing PlatformRole
// (src/core/foundation/permissions.ts) meant for exactly this: a
// non-human system actor. Its own role-derived permission set is
// deliberately narrow and read-only (no write permissions at all), so
// unlike the old actor, simply HOLDING this role grants nothing. The
// only authority this actor carries is the single, explicit permission
// automationSystemActorMayActOnAction grants below -- scoped to the one
// specific registered action about to run, never a blanket role grant.
// This is the same honest, non-fabricating pattern Wave 4B Slices 1-2
// already established for the analogous Office automation-runtime
// identity problem.
function automationSystemActorFor(estateId: string, homeId: string | null, requiredPermission: PermissionKey): AuthUser {
  return {
    id: "system:facility-automation",
    role: "ai_agent",
    permissions: [requiredPermission],
    permission_scopes: [],
    estate_id: estateId,
    home_id: homeId || undefined,
  } as unknown as AuthUser;
}

// Mirrors automationPolicyResolver.ts's actorMayActOnAction, which this
// cannot reuse directly: that function only ever accepts a bare role
// string and derives permissions purely from ROLE_PERMISSIONS, so it can
// never see an actor's explicit `permissions` array. This automation
// actor deliberately carries no role-derived write permissions -- its
// authority lives entirely in that explicit array -- so the real,
// canonical hasPermission() check (the same function actorMayActOnAction
// wraps) is called directly against the full actor object instead.
function automationSystemActorMayActOnAction(actor: AuthUser, actionId: string): boolean {
  const requiredPermission = registeredActionRequiredPermission(actionId);
  if (!requiredPermission) return false;
  return hasPermission(actor, requiredPermission);
}

type IntelligenceEventRow = {
  id: string;
  estate_id: string | null;
  home_id: string | null;
  event_type: string;
  occurred_at: string;
  metadata: { severity?: string; payload?: Record<string, unknown>; automation_origin?: boolean } | null;
};

// The dispatcher. Called (fire-and-forget) from eventBus.ts's
// publishIntelligenceEvent immediately after a genuinely-new insert.
// Idempotency is inherited for free: a duplicate/replayed event never
// reaches here at all, because eventBus.ts's own unique-constraint catch
// short-circuits to skipped:true before this function is ever called.
export async function matchEventDrivenAutomationRules(event: IntelligenceEventRow) {
  try {
    if (!event.estate_id) return;
    if (event.metadata?.automation_origin === true) return; // loop protection -- zero-hop chaining
    if (!isRegisteredTriggerEventType(event.event_type)) return; // not a catalogued trigger -- ignore silently, do not error

    const { data: rules } = await supabaseAdmin
      .from("facility_automation_event_rules")
      .select("*")
      .eq("estate_id", event.estate_id)
      .eq("trigger_event_type", event.event_type)
      .eq("enabled", true);
    if (!rules || !rules.length) return;

    const firingEvent = { estate_id: event.estate_id, home_id: event.home_id, severity: event.metadata?.severity || "info", metadata: { payload: event.metadata?.payload || {} }, occurred_at: event.occurred_at };

    for (const rule of rules as FacilityAutomationEventRule[]) {
      const evaluation = await evaluateAutomationConditions(rule.conditions || [], firingEvent);
      if (!evaluation.ok) continue;

      const policy = await resolveAutomationPolicy({ estateId: event.estate_id, actorRole: null, actionId: rule.action_id });
      if (policy.executionLevel !== "approval_required" && policy.executionLevel !== "auto_allowed") continue;

      const params = (rule.action_params || {}) as { entity_id?: string | null; entity_type?: string; target_label?: string; command?: Record<string, unknown> | null };
      const proposal = await proposeAutomationApproval({
        estateId: event.estate_id,
        detectorId: `event_rule:${rule.id}`,
        actionId: rule.action_id,
        entityType: (params.entity_type as any) || "none",
        entityId: params.entity_id || null,
        targetLabel: params.target_label || rule.name,
        reason: `Triggered by "${rule.name}" (${event.event_type}).`,
        evidence: [{ type: "intelligence_event", id: event.id, event_type: event.event_type, occurred_at: event.occurred_at, payload: event.metadata?.payload || {} }],
        command: params.command || null,
      });
      if (!proposal) continue; // duplicate-suppressed by the existing one-pending-per-target index, or policy denied it

      if (policy.executionLevel === "auto_allowed") {
        // Action-specific, building-scoped authority: this automation
        // principal may autonomously request THIS action, for THIS
        // estate, because it explicitly holds the one real permission
        // REQUIRED_PERMISSION[action_id] demands -- not because it
        // claims a privileged human role. Fails closed if that
        // permission isn't (or can no longer be) established: the
        // proposal simply stays pending_approval rather than either
        // fabricating authority or inventing a new terminal status --
        // a human can still review and approve it through the existing,
        // unchanged decideAutomationApproval path.
        const requiredPermission = registeredActionRequiredPermission(rule.action_id);
        const automationActor = requiredPermission ? automationSystemActorFor(event.estate_id, event.home_id, requiredPermission) : null;
        if (automationActor && automationSystemActorMayActOnAction(automationActor, rule.action_id)) {
          void executeApprovalRow(proposal, automationActor, `Auto-allowed by Facility automation policy (rule: ${rule.name}).`);
        } else {
          console.warn("[facility-automation-event-rules] auto_allowed skipped -- automation system actor is not explicitly authorized for this action; proposal left pending for human review", { rule_id: rule.id, action_id: rule.action_id, estate_id: event.estate_id });
        }
      }
    }
  } catch (error: any) {
    // Best-effort, same posture as every other detector in this codebase --
    // must never affect the caller (publishIntelligenceEvent) that fired it.
    console.warn("[facility-automation-event-rules] match failed", error?.message || String(error));
  }
}
