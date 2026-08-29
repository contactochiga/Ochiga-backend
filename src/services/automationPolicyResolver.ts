// PHASE 3 (Milestone 1) -- the real, server-authoritative counterpart to
// Facility's client-side lib/safeAutomationRuntime.ts (which only ever
// shapes conversational text and never touches Backend at all -- confirmed
// during the Phase 3 Phase 0 audit). This resolver is the thing that
// actually decides whether a specific registered action may run for a
// specific Facility/actor, and it is the only thing consulted before any
// execution happens through this milestone's pipeline.
//
// A frontend toggle can never be the authorization boundary -- this file
// is that boundary. Every call here is server-side, reads persisted policy
// (facility_automation_policy), and cross-checks the actor's real RBAC
// permission (hasPermission) plus the static safety allowlist that already
// exists in intelligence-core/executionRegistry.ts. It does not duplicate
// that allowlist -- it only adds the missing "who/which Facility may run
// this without a human clicking approve" layer on top of it.
import { supabaseAdmin } from "../supabase/supabaseClient";
import { hasPermission, type PermissionKey } from "../core/foundation/permissions";
import { getRegisteredExecutionAction } from "../intelligence-core/executionRegistry";

export type AutomationExecutionLevel =
  | "observe"
  | "recommend"
  | "approval_required"
  | "auto_allowed"
  | "manual_only"
  | "unsupported";

// The permission a human actor must hold to ever approve/execute this
// action, regardless of the Facility's configured execution level --
// mirrors the domain groupings already used by
// intelligence-core/executionRegistry.ts (EXECUTION_REGISTRY[].domain).
const REQUIRED_PERMISSION: Record<string, PermissionKey> = {
  "visitor.approve": "visitors.manage",
  "visitor.revoke": "visitors.manage",
  "visitor.expire": "visitors.manage",
  "maintenance.assign": "support.assign",
  "maintenance.complete": "support.assign",
  "maintenance.cancel": "support.assign",
  "device.on": "devices.control",
  "device.off": "devices.control",
  "device.toggle": "devices.control",
  // Cross-Domain Operational Automation -- matches
  // NotificationService.sendToRole/sendToUser/sendToHome/sendToEstate's
  // real underlying permission expectation (notifications.manage is the
  // dedicated key for triggering notification sends, distinct from
  // notifications.read).
  "notification.notify": "notifications.manage",
};

// Conservative-by-design: every in-scope action defaults to
// approval_required, never auto_allowed, until a Facility explicitly opts
// in via a persisted facility_automation_policy row. No admin UI to create
// that override row ships this milestone (see docs/architecture note in
// PHASE3_AUTOMATION_MILESTONE_1.md), so in practice every resolution below
// returns approval_required or manual_only/unsupported today -- that is
// intentional, not a bug.
const DEFAULT_EXECUTION_LEVEL: AutomationExecutionLevel = "approval_required";

export type PolicyResolution = {
  actionId: string;
  executionLevel: AutomationExecutionLevel;
  requiredPermission: PermissionKey | null;
  reason: string;
};

export async function resolveAutomationPolicy(input: {
  estateId: string;
  actorRole: string | null;
  actorPermissionScopes?: string[] | null;
  actionId: string;
}): Promise<PolicyResolution> {
  const requiredPermission = REQUIRED_PERMISSION[input.actionId] || null;

  const registered = getRegisteredExecutionAction(input.actionId);
  if (!registered) {
    return { actionId: input.actionId, executionLevel: "unsupported", requiredPermission, reason: "Action is not registered in the canonical execution registry." };
  }
  if (!registered.available) {
    return { actionId: input.actionId, executionLevel: "manual_only", requiredPermission, reason: registered.reason || "This action is deliberately excluded from automated execution." };
  }
  if (!requiredPermission) {
    return { actionId: input.actionId, executionLevel: "unsupported", requiredPermission: null, reason: "No automation policy is defined for this action." };
  }

  const { data: override } = await supabaseAdmin
    .from("facility_automation_policy")
    .select("execution_level")
    .eq("estate_id", input.estateId)
    .eq("action_id", input.actionId)
    .maybeSingle();

  const executionLevel = (override?.execution_level as AutomationExecutionLevel | undefined) || DEFAULT_EXECUTION_LEVEL;

  return {
    actionId: input.actionId,
    executionLevel,
    requiredPermission,
    reason: override ? "Facility-configured policy." : "Conservative platform default (no Facility override configured).",
  };
}

// Actor-scoped check used at approve-time and at any direct-execution
// attempt: does this specific human actually hold the permission this
// action requires, on top of whatever executionLevel the resolver above
// returned? A pending_approval-level action still requires the approving
// human to hold the real permission -- the approval queue is not itself
// an authorization bypass.
export function actorMayActOnAction(actorRole: string | null | undefined, actionId: string): boolean {
  const requiredPermission = REQUIRED_PERMISSION[actionId];
  if (!requiredPermission) return false;
  return hasPermission({ role: actorRole || undefined }, requiredPermission);
}

export function registeredActionRequiredPermission(actionId: string): PermissionKey | null {
  return REQUIRED_PERMISSION[actionId] || null;
}
