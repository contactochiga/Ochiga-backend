// PHASE 3 (Milestone 1) -- wires the canonical, already-real pieces into a
// single Facility automation loop: narrow detector finds a concrete,
// parameter-complete candidate -> automationPolicyResolver decides the
// execution level -> a real human approves -> executeRegisteredAction
// (intelligence-core/executionRegistry.ts, unchanged, already real) runs
// it -> verificationService (unchanged, already real) confirms the
// resulting state -> emitAuditEvent (unchanged) records it ->
// NotificationService.sendToUser (unchanged) notifies eligible operators.
//
// This file adds NO new execution engine, NO new verification logic and
// NO new notification engine -- every one of those five steps calls an
// existing, already-shipped function. The only genuinely new pieces are:
// the two narrow detectors below, the automation_approvals persistence,
// and the glue that calls the existing pieces in the right order.
//
// Deliberately NOT reused: oyi-core's AutomationPlan (safeAutomation.ts).
// That type's actionType vocabulary (verify_power, assign_owner,
// schedule_preventive_inspection, ...) is abstract/advisory and does not
// carry a concrete entity_id + zero-ambiguity action the way
// EXECUTION_REGISTRY requires. Forcing a generic mapping from that
// vocabulary onto EXECUTION_REGISTRY would mean inventing behavior no
// human asked for (e.g. guessing a maintenance assignee). Recommendations
// stay Review/Dismiss-only; only these two narrow, explicit, human-
// legible detectors ever produce something executable this milestone.
import type { AuthUser } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitAuditEvent } from "../core/foundation";
import { NotificationService } from "./NotificationService";
import { rankOfMembershipRole } from "./estateMembershipRoles";
import { executeRegisteredAction } from "../intelligence-core/executionRegistry";
import { verifyVisitorStatus, verifyMaintenanceStatus, verifyDeviceAction } from "../intelligence-core/verificationService";
import { resolveAutomationPolicy, actorMayActOnAction, registeredActionRequiredPermission } from "./automationPolicyResolver";

const APPROVAL_EXPIRY_HOURS = 24;
const DUPLICATE_WINDOW_HOURS = 72;
const VISITOR_STALE_GRACE_HOURS = 2;

type ProposalInput = {
  estateId: string;
  detectorId: string;
  actionId: string;
  entityType: "maintenance_request" | "visitor_access";
  entityId: string;
  targetLabel: string;
  reason: string;
  evidence: Record<string, unknown>[];
  expectedStatus: string;
};

async function listEligibleApproverIds(estateId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("estate_memberships")
    .select("user_id, role, status")
    .eq("estate_id", estateId)
    .eq("status", "active");
  return (data || [])
    .filter((m: any) => rankOfMembershipRole(String(m.role || "")) >= 50)
    .map((m: any) => String(m.user_id))
    .filter(Boolean);
}

async function notifyApprovers(estateId: string, title: string, message: string, payload: Record<string, unknown>) {
  const approverIds = await listEligibleApproverIds(estateId);
  await Promise.all(
    approverIds.map((userId) =>
      NotificationService.sendToUser(userId, {
        title,
        message,
        type: "intelligence",
        payload: { ...payload, source_type: "automation" },
        routing: { source_type: "workflow", destination: "queue" },
      }).catch(() => null)
    )
  );
}

// Creates a proposal only if the resolved policy actually reaches
// approval_required or auto_allowed -- a manual_only/unsupported/observe/
// recommend resolution never creates a row here at all, matching "the
// operation exists but Oyi must not execute" from the spec's execution-
// level taxonomy. Relies on the DB's automation_approvals_one_pending_per_
// target unique index for idempotency against duplicate detector runs.
async function proposeAutomationApproval(input: ProposalInput) {
  const policy = await resolveAutomationPolicy({ estateId: input.estateId, actorRole: null, actionId: input.actionId });
  if (policy.executionLevel !== "approval_required" && policy.executionLevel !== "auto_allowed") return null;

  const planSnapshot = {
    action_id: input.actionId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    expected_status: input.expectedStatus,
    proposed_at: new Date().toISOString(),
  };
  const expiresAt = new Date(Date.now() + APPROVAL_EXPIRY_HOURS * 3600 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("automation_approvals")
    .insert({
      estate_id: input.estateId,
      detector_id: input.detectorId,
      action_id: input.actionId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      target_label: input.targetLabel,
      reason: input.reason,
      evidence: input.evidence,
      plan_snapshot: planSnapshot,
      status: "pending_approval",
      requested_by: "system",
      expires_at: expiresAt,
    })
    .select("*")
    .maybeSingle();

  // A unique-violation here means another detector run already proposed
  // the same (estate, action, entity) while pending -- not an error, just
  // the idempotency guard doing its job.
  if (error) {
    if (/duplicate key|unique/i.test(error.message || "")) return null;
    throw error;
  }
  if (data) {
    void emitAuditEvent({
      actorId: null,
      actorRole: "system",
      action: "automation.approval.requested",
      resourceType: "automation_approval",
      resourceId: data.id,
      estateId: input.estateId,
      status: "success",
      metadata: { action_id: input.actionId, entity_type: input.entityType, entity_id: input.entityId, detector_id: input.detectorId },
    } as any);
    void notifyApprovers(input.estateId, "Automation approval requested", `${input.reason} (${input.targetLabel})`, { approval_id: data.id, action_id: input.actionId, entity_id: input.entityId });
  }
  return data;
}

// Detector 1 (event-driven, per spec Section 19's preference for event
// triggers over polling): call this right after a new maintenance_request
// is inserted. Looks for another still-open request on the SAME home
// created within the last DUPLICATE_WINDOW_HOURS -- if found, proposes
// cancelling the NEW (just-created) one as a likely duplicate, matching
// the spec's explicit "prevent duplicate work orders" Maintenance example.
export async function detectDuplicateMaintenanceRequest(request: { id: string; estate_id: string; home_id: string | null; category: string | null; title: string | null; created_at: string }) {
  if (!request.home_id) return null;
  try {
    const since = new Date(Date.now() - DUPLICATE_WINDOW_HOURS * 3600 * 1000).toISOString();
    const { data: candidates } = await supabaseAdmin
      .from("maintenance_requests")
      .select("id, status, category, title, created_at")
      .eq("estate_id", request.estate_id)
      .eq("home_id", request.home_id)
      .not("status", "in", "(completed,cancelled)")
      .neq("id", request.id)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(5);

    const original = (candidates || []).find((row: any) => {
      if (request.category && row.category) return String(row.category).toLowerCase() === String(request.category).toLowerCase();
      return String(row.title || "").trim().toLowerCase() === String(request.title || "").trim().toLowerCase();
    });
    if (!original) return null;

    return proposeAutomationApproval({
      estateId: request.estate_id,
      detectorId: "duplicate_maintenance_request",
      actionId: "maintenance.cancel",
      entityType: "maintenance_request",
      entityId: request.id,
      targetLabel: request.title || "Maintenance request",
      reason: `Likely duplicate of an already-open request ("${original.title || original.id}") for the same home, opened ${DUPLICATE_WINDOW_HOURS}h apart or less.`,
      evidence: [{ type: "maintenance_request", id: original.id, title: original.title, created_at: original.created_at }],
      expectedStatus: "cancelled",
    });
  } catch {
    // Detection is best-effort and must never block the maintenance
    // request creation it's attached to.
    return null;
  }
}

// Detector 2 (lazy/on-read, not a background scheduler -- see the Phase 3
// final report for why: OYI_PROACTIVE_SCHEDULER_ENABLED is off and there
// is no confirmed separate worker deployment this milestone touches).
// Called when the Automation workspace loads its recommendations/
// approvals; scans for visitor_access rows still "active" past their own
// expires_at, and proposes formally expiring them.
export async function scanStaleVisitorAuthorizations(estateId: string) {
  try {
    const cutoff = new Date(Date.now() - VISITOR_STALE_GRACE_HOURS * 3600 * 1000).toISOString();
    const { data: stale } = await supabaseAdmin
      .from("visitor_access")
      .select("id, visitor_name, expires_at, status")
      .eq("estate_id", estateId)
      .eq("status", "active")
      .not("expires_at", "is", null)
      .lt("expires_at", cutoff)
      .limit(25);

    for (const visitor of stale || []) {
      await proposeAutomationApproval({
        estateId,
        detectorId: "stale_visitor_authorization",
        actionId: "visitor.expire",
        entityType: "visitor_access",
        entityId: (visitor as any).id,
        targetLabel: (visitor as any).visitor_name || "Visitor",
        reason: `Visitor authorization window closed ${(visitor as any).expires_at} and has not been formally expired.`,
        evidence: [{ type: "visitor_access", id: (visitor as any).id, expires_at: (visitor as any).expires_at }],
        expectedStatus: "expired",
      });
    }
  } catch {
    // Best-effort scan; never block the caller.
  }
}

// Marks any pending_approval row past its own expires_at as expired.
// Lazy, called at the top of every list/decide call -- no scheduler needed.
async function expireOverdueApprovals(estateId: string) {
  await supabaseAdmin
    .from("automation_approvals")
    .update({ status: "expired" })
    .eq("estate_id", estateId)
    .eq("status", "pending_approval")
    .lt("expires_at", new Date().toISOString());
}

export async function listAutomationApprovals(estateId: string, status?: string) {
  await expireOverdueApprovals(estateId);
  let query = supabaseAdmin.from("automation_approvals").select("*").eq("estate_id", estateId).order("created_at", { ascending: false }).limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// PHASE 3 (Milestone 1) -- pre-execution validation (spec Section 7).
// executeRegisteredAction re-reads the target row before mutating it, but
// applies the action's patch unconditionally once scope/role checks pass
// -- it does not itself check whether the target is STILL in a state
// where this specific action still makes sense (e.g. a human may have
// already completed a maintenance request between proposal and approval).
// Rather than modify that shared function (used by the consumer surface
// too), this precondition check runs here, immediately before execution,
// so "the recommendation existed five minutes ago" is never treated as
// sufficient justification on its own.
async function validatePrecondition(actionId: string, entityId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (actionId === "visitor.expire" || actionId === "visitor.revoke") {
    const { data, error } = await supabaseAdmin.from("visitor_access").select("status").eq("id", entityId).maybeSingle();
    if (error || !data) return { ok: false, reason: "target_not_found" };
    if (String(data.status) !== "active") return { ok: false, reason: `conflicting_state: visitor is already ${data.status}` };
    return { ok: true };
  }
  if (actionId === "visitor.approve") {
    const { data, error } = await supabaseAdmin.from("visitor_access").select("status").eq("id", entityId).maybeSingle();
    if (error || !data) return { ok: false, reason: "target_not_found" };
    if (!["active", "pending"].includes(String(data.status))) return { ok: false, reason: `conflicting_state: visitor is already ${data.status}` };
    return { ok: true };
  }
  if (actionId === "maintenance.cancel" || actionId === "maintenance.complete" || actionId === "maintenance.assign") {
    const { data, error } = await supabaseAdmin.from("maintenance_requests").select("status").eq("id", entityId).maybeSingle();
    if (error || !data) return { ok: false, reason: "target_not_found" };
    if (["completed", "cancelled"].includes(String(data.status))) return { ok: false, reason: `conflicting_state: request is already ${data.status}` };
    return { ok: true };
  }
  if (actionId.startsWith("device.")) {
    const { data } = await supabaseAdmin.from("device_states").select("status,last_seen,updated_at").eq("device_id", entityId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!data) return { ok: false, reason: "device_state_unavailable" };
    return { ok: true };
  }
  return { ok: true };
}

function expectedStatusFor(actionId: string) {
  if (actionId === "visitor.approve") return "approved";
  if (actionId === "visitor.revoke") return "denied";
  if (actionId === "visitor.expire") return "expired";
  if (actionId === "maintenance.complete") return "completed";
  if (actionId === "maintenance.cancel") return "cancelled";
  if (actionId === "maintenance.assign") return "assigned";
  return null;
}

async function runVerification(actionId: string, entityId: string, expectedStatus: string) {
  if (actionId.startsWith("visitor.")) return verifyVisitorStatus({ visitor_id: entityId, expected_status: expectedStatus });
  if (actionId.startsWith("maintenance.")) return verifyMaintenanceStatus({ request_id: entityId, expected_status: expectedStatus });
  if (actionId.startsWith("device.")) return verifyDeviceAction({ device_id: entityId, expected_state: {} });
  return { state: "timeout" as const, summary: "No verification strategy for this action.", metadata: {} };
}

// The one place approval decisions are made. APPROVE immediately attempts
// execution (matching the spec's "Approve & Execute" framing) -- there is
// no separate "approved but not yet executed" human step in this
// milestone, since every in-scope action is fast/synchronous already.
export async function decideAutomationApproval(input: {
  approvalId: string;
  estateId: string;
  actor: AuthUser;
  decision: "approve" | "reject";
  note?: string | null;
}) {
  await expireOverdueApprovals(input.estateId);

  const { data: approval, error } = await supabaseAdmin
    .from("automation_approvals")
    .select("*")
    .eq("id", input.approvalId)
    .maybeSingle();
  if (error) throw error;
  // 404-shaped, not 403 -- never confirm a foreign-tenant approval exists.
  if (!approval || String(approval.estate_id) !== String(input.estateId)) return { ok: false, code: "not_found" as const };
  if (approval.status !== "pending_approval") return { ok: false, code: "not_pending" as const, status: approval.status };

  if (!actorMayActOnAction(input.actor.role, approval.action_id)) {
    void emitAuditEvent({ actorId: input.actor.id, actorRole: input.actor.role, action: "automation.approval.denied", resourceType: "automation_approval", resourceId: approval.id, estateId: input.estateId, status: "denied", metadata: { reason: "insufficient_permission", action_id: approval.action_id } } as any);
    return { ok: false, code: "forbidden" as const };
  }

  if (input.decision === "reject") {
    const { data: updated } = await supabaseAdmin
      .from("automation_approvals")
      .update({ status: "rejected", approver_id: input.actor.id, approver_role: input.actor.role, decision_note: input.note || null, decided_at: new Date().toISOString() })
      .eq("id", approval.id)
      .select("*")
      .maybeSingle();
    void emitAuditEvent({ actorId: input.actor.id, actorRole: input.actor.role, action: "automation.approval.rejected", resourceType: "automation_approval", resourceId: approval.id, estateId: input.estateId, status: "success", metadata: { action_id: approval.action_id, note: input.note || null } } as any);
    return { ok: true, approval: updated };
  }

  // Re-resolve policy at decision time, not just at proposal time -- if a
  // Facility's policy or the underlying registry changed since the
  // proposal was created, an already-pending row must not silently ride
  // on stale authority.
  const policy = await resolveAutomationPolicy({ estateId: input.estateId, actorRole: input.actor.role, actionId: approval.action_id });
  if (policy.executionLevel !== "approval_required" && policy.executionLevel !== "auto_allowed") {
    await supabaseAdmin.from("automation_approvals").update({ status: "rejected", approver_id: input.actor.id, approver_role: input.actor.role, decision_note: "policy_no_longer_permits_execution", decided_at: new Date().toISOString() }).eq("id", approval.id);
    void emitAuditEvent({ actorId: input.actor.id, actorRole: input.actor.role, action: "automation.approval.rejected", resourceType: "automation_approval", resourceId: approval.id, estateId: input.estateId, status: "denied", metadata: { reason: "policy_changed", execution_level: policy.executionLevel } } as any);
    return { ok: false, code: "policy_denied" as const, reason: policy.reason };
  }

  const precondition = await validatePrecondition(approval.action_id, approval.entity_id);
  if (!precondition.ok) {
    await supabaseAdmin.from("automation_approvals").update({ status: "failed", approver_id: input.actor.id, approver_role: input.actor.role, decision_note: input.note || null, decided_at: new Date().toISOString() }).eq("id", approval.id);
    void emitAuditEvent({ actorId: input.actor.id, actorRole: input.actor.role, action: "automation.execution.failed", resourceType: "automation_approval", resourceId: approval.id, estateId: input.estateId, status: "failed", metadata: { action_id: approval.action_id, reason: precondition.reason } } as any);
    void notifyApprovers(input.estateId, "Automation execution skipped", `${approval.target_label || "Action"} was not executed: ${precondition.reason}.`, { approval_id: approval.id });
    return { ok: false, code: "execution_failed" as const, reason: precondition.reason };
  }

  const executionId = `automation_approval:${approval.id}`;
  await supabaseAdmin.from("automation_approvals").update({ status: "executing", approver_id: input.actor.id, approver_role: input.actor.role, decision_note: input.note || null, decided_at: new Date().toISOString(), execution_id: executionId }).eq("id", approval.id);

  const expectedStatus = expectedStatusFor(approval.action_id) || (approval.plan_snapshot as any)?.expected_status;
  const result = await executeRegisteredAction({
    action_id: approval.action_id,
    actor: input.actor,
    entity_id: approval.entity_id,
    source: "automation",
    confirmed: true,
  });

  if (!result.ok) {
    await supabaseAdmin.from("automation_approvals").update({ status: "failed" }).eq("id", approval.id);
    void emitAuditEvent({ actorId: input.actor.id, actorRole: input.actor.role, action: "automation.execution.failed", resourceType: "automation_approval", resourceId: approval.id, estateId: input.estateId, status: "failed", metadata: { action_id: approval.action_id, reason: (result as any).reason || result.status } } as any);
    void notifyApprovers(input.estateId, "Automation execution failed", `${approval.target_label || "Action"} could not be executed: ${(result as any).reason || result.status}.`, { approval_id: approval.id });
    return { ok: false, code: "execution_failed" as const, reason: (result as any).reason || result.status };
  }

  const verification = expectedStatus ? await runVerification(approval.action_id, approval.entity_id, expectedStatus) : { state: "pending" as const, summary: "No expected status to verify against.", metadata: {} };
  const verified = verification.state === "verified";

  await supabaseAdmin
    .from("automation_approvals")
    .update({ status: verified ? "succeeded" : "verification_failed", verification, executed_at: new Date().toISOString() })
    .eq("id", approval.id);

  void emitAuditEvent({
    actorId: input.actor.id,
    actorRole: input.actor.role,
    action: verified ? "automation.execution.succeeded" : "automation.execution.verification_failed",
    resourceType: "automation_approval",
    resourceId: approval.id,
    estateId: input.estateId,
    status: verified ? "success" : "failed",
    metadata: { action_id: approval.action_id, entity_id: approval.entity_id, verification, execution_id: executionId },
  } as any);
  void notifyApprovers(
    input.estateId,
    verified ? "Automation action executed" : "Automation action executed, verification failed",
    `${approval.target_label || "Action"}: ${approval.action_id} ${verified ? "completed and verified" : "completed but could not be verified"}.`,
    { approval_id: approval.id, execution_id: executionId }
  );

  return { ok: true, approval: { ...approval, status: verified ? "succeeded" : "verification_failed", verification, execution_id: executionId } };
}

export function requiredPermissionForAction(actionId: string) {
  return registeredActionRequiredPermission(actionId);
}
