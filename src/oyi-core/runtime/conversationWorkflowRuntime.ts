import { randomUUID } from "crypto";
import type { AuthorityDecision } from "./domainCapabilityRegistry";
import type { OyiDomain, OyiOperation } from "./languageUnderstanding";

export type WorkflowStatus =
  | "collecting_inputs"
  | "awaiting_clarification"
  | "ready_for_review"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | "superseded";

export type CanonicalTarget = {
  object_type: string;
  canonical_id: string;
  label: string | null;
  parent_id?: string | null;
  channel_code?: string | null;
};

export type OyiWorkflow = {
  workflow_id: string;
  thread_id: string;
  request_id: string;
  capability_key: string;
  domain: OyiDomain;
  operation: OyiOperation;
  status: WorkflowStatus;
  target: CanonicalTarget | null;
  inputs: Record<string, { value: unknown; source: string; validated: boolean }>;
  unresolved_inputs: string[];
  authority_decision: AuthorityDecision | null;
  proposed_action: Record<string, unknown> | null;
  execution_record: Record<string, unknown> | null;
  evidence: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

export type OyiActionStatus =
  | "draft"
  | "awaiting_confirmation"
  | "cancelled"
  | "approved"
  | "queued"
  | "sent"
  | "provider_accepted"
  | "provider_rejected"
  | "verifying"
  | "confirmed"
  | "unobservable"
  | "timed_out"
  | "failed"
  | "superseded";

export type OyiAction = {
  action_id: string;
  workflow_id: string;
  domain: OyiDomain;
  target: CanonicalTarget;
  requested_operation: string;
  requested_state: unknown;
  status: OyiActionStatus;
  approved_at: string | null;
  executed_at: string | null;
  completed_at: string | null;
  result: Record<string, unknown> | null;
  evidence: Array<Record<string, unknown>>;
};

function nowIso() {
  return new Date().toISOString();
}

export function restoreWorkflowFromMetadata(metadata: unknown): OyiWorkflow | null {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  const workflow = record.active_workflow && typeof record.active_workflow === "object" && !Array.isArray(record.active_workflow)
    ? record.active_workflow as Record<string, unknown>
    : null;
  if (!workflow || !workflow.workflow_id || !workflow.thread_id) return null;
  return workflow as OyiWorkflow;
}

export function createWorkflow(input: {
  thread_id: string;
  request_id: string;
  capability_key: string;
  domain: OyiDomain;
  operation: OyiOperation;
  target: CanonicalTarget | null;
  unresolved_inputs?: string[];
  authority_decision?: AuthorityDecision | null;
  proposed_action?: Record<string, unknown> | null;
  ttl_ms?: number | null;
}): OyiWorkflow {
  const now = nowIso();
  const unresolved = input.unresolved_inputs || [];
  return {
    workflow_id: randomUUID(),
    thread_id: input.thread_id,
    request_id: input.request_id,
    capability_key: input.capability_key,
    domain: input.domain,
    operation: input.operation,
    status: unresolved.length ? "awaiting_clarification" : input.proposed_action ? "ready_for_review" : "completed",
    target: input.target,
    inputs: {},
    unresolved_inputs: unresolved,
    authority_decision: input.authority_decision || null,
    proposed_action: input.proposed_action || null,
    execution_record: null,
    evidence: [],
    created_at: now,
    updated_at: now,
    expires_at: input.ttl_ms ? new Date(Date.now() + input.ttl_ms).toISOString() : null,
  };
}

export function advanceWorkflow(workflow: OyiWorkflow, patch: Partial<OyiWorkflow>): OyiWorkflow {
  if (["completed", "failed", "cancelled", "expired", "superseded"].includes(workflow.status)) return workflow;
  return { ...workflow, ...patch, workflow_id: workflow.workflow_id, thread_id: workflow.thread_id, updated_at: nowIso() };
}

export function cancelWorkflow(workflow: OyiWorkflow, reason = "user_cancelled"): OyiWorkflow {
  return advanceWorkflow(workflow, {
    status: "cancelled",
    evidence: workflow.evidence.concat([{ type: "workflow_cancelled", reason, observed_at: nowIso() }]),
  });
}

export function createAction(input: {
  workflow: OyiWorkflow;
  target: CanonicalTarget;
  requested_operation: string;
  requested_state: unknown;
}): OyiAction {
  return {
    action_id: randomUUID(),
    workflow_id: input.workflow.workflow_id,
    domain: input.workflow.domain,
    target: input.target,
    requested_operation: input.requested_operation,
    requested_state: input.requested_state,
    status: "awaiting_confirmation",
    approved_at: null,
    executed_at: null,
    completed_at: null,
    result: null,
    evidence: [],
  };
}

export function transitionAction(action: OyiAction, status: OyiActionStatus, result: Record<string, unknown> | null = null): OyiAction {
  const now = nowIso();
  return {
    ...action,
    status,
    approved_at: status === "approved" ? now : action.approved_at,
    executed_at: ["queued", "sent", "provider_accepted", "provider_rejected"].includes(status) ? now : action.executed_at,
    completed_at: ["confirmed", "unobservable", "timed_out", "failed", "cancelled", "superseded"].includes(status) ? now : action.completed_at,
    result,
  };
}

