import { randomUUID } from "crypto";
import type { OyiAction, OyiActionStatus } from "../contracts/action";
import type { OyiWorkflow } from "../contracts/workflow";
import type { CanonicalTarget } from "../contracts/target";
import { actionIdempotencyKey } from "./ActionIdempotency";
import { assertActionTransition, isTerminalActionStatus } from "./ActionStateMachine";
import type { ActionRepository } from "./ActionRepository";
import { InMemoryActionRepository, SupabaseActionRepository } from "./ActionRepository";
import { logger } from "../../observability/logger";

function nowIso() {
  return new Date().toISOString();
}

export function createActionForWorkflow(input: {
  workflow: OyiWorkflow;
  actorId: string | null;
  target: CanonicalTarget;
  requestedOperation: string;
  requestedState: unknown;
}): OyiAction {
  const now = nowIso();
  return {
    action_id: randomUUID(),
    workflow_id: input.workflow.workflow_id,
    thread_id: input.workflow.thread_id,
    actor_id: input.actorId,
    capability_key: input.workflow.capability_key,
    domain: input.workflow.domain,
    target: input.target,
    requested_operation: input.requestedOperation,
    requested_state: input.requestedState,
    status: "awaiting_confirmation",
    idempotency_key: actionIdempotencyKey({
      actorId: input.actorId,
      threadId: input.workflow.thread_id,
      target: input.target,
      operation: input.requestedOperation,
      requestedState: input.requestedState,
    }),
    revision: 1,
    approved_at: null,
    queued_at: null,
    sent_at: null,
    provider_accepted_at: null,
    verification_started_at: null,
    executed_at: null,
    completed_at: null,
    execution_id: null,
    verification_id: null,
    executor_reference: null,
    result: null,
    safe_error: null,
    evidence: [],
    created_at: now,
    updated_at: now,
  };
}

export function transitionAction(action: OyiAction, status: OyiActionStatus, result: Record<string, unknown> | null = null): OyiAction {
  if (isTerminalActionStatus(action.status)) return action;
  assertActionTransition(action.status, status);
  const now = nowIso();
  return {
    ...action,
    status,
    revision: action.revision + 1,
    approved_at: status === "approved" ? now : action.approved_at,
    queued_at: status === "queued" ? now : action.queued_at,
    sent_at: status === "sent" ? now : action.sent_at,
    provider_accepted_at: status === "provider_accepted" ? now : action.provider_accepted_at,
    verification_started_at: status === "verifying" ? now : action.verification_started_at,
    executed_at: ["queued", "sent", "provider_accepted", "provider_rejected"].includes(status) ? now : action.executed_at,
    completed_at: isTerminalActionStatus(status) ? now : action.completed_at,
    updated_at: now,
    result,
  };
}

export type DomainActionAdapterExecution = {
  status: "provider_accepted" | "provider_rejected" | "confirmed" | "unobservable" | "failed" | "timed_out";
  executor_reference?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  evidence?: Array<Record<string, unknown>>;
  safe_error?: Record<string, unknown> | null;
};

export interface OyiDomainActionAdapter {
  domain: string;
  execute(action: OyiAction): Promise<DomainActionAdapterExecution>;
  verify?(action: OyiAction, execution: DomainActionAdapterExecution): Promise<DomainActionAdapterExecution>;
}

export class ActionService {
  constructor(private readonly repository: ActionRepository) {}

  async create(input: {
    workflow: OyiWorkflow;
    actorId: string | null;
    target: CanonicalTarget;
    requestedOperation: string;
    requestedState: unknown;
  }) {
    const draft = createActionForWorkflow(input);
    const existing = await this.repository.findActiveEquivalent(draft.idempotency_key);
    if (existing) {
      logger.info("oyi_action_reused", {
        thread_id: existing.thread_id,
        workflow_id: existing.workflow_id,
        action_id: existing.action_id,
        capability_key: existing.capability_key,
        domain: existing.domain,
        status: existing.status,
        revision: existing.revision,
      });
      return existing;
    }
    const saved = await this.repository.save(draft);
    await this.repository.recordEvent?.({ action: saved, event_type: "action_created", to_status: saved.status, summary: "Action created and awaiting explicit confirmation." });
    logger.info("oyi_action_created", {
      thread_id: saved.thread_id,
      workflow_id: saved.workflow_id,
      action_id: saved.action_id,
      capability_key: saved.capability_key,
      domain: saved.domain,
      target_type: saved.target.object_type,
      status: saved.status,
      revision: saved.revision,
    });
    return saved;
  }

  async get(actionId: string) {
    return this.repository.get(actionId);
  }

  async transition(action: OyiAction, status: OyiActionStatus, result: Record<string, unknown> | null = null, patch: Partial<OyiAction> = {}) {
    const transitioned = { ...transitionAction(action, status, result), ...patch };
    const saved = await this.repository.save(transitioned, { expectedRevision: action.revision });
    await this.repository.recordEvent?.({
      action: saved,
      event_type: "action_transitioned",
      from_status: action.status,
      to_status: saved.status,
      summary: `Action transitioned from ${action.status} to ${saved.status}.`,
    });
    logger.info("oyi_action_transitioned", {
      thread_id: saved.thread_id,
      workflow_id: saved.workflow_id,
      action_id: saved.action_id,
      capability_key: saved.capability_key,
      domain: saved.domain,
      from_status: action.status,
      to_status: saved.status,
      revision: saved.revision,
    });
    return saved;
  }

  async approve(action: OyiAction, actorId: string | null) {
    const saved = await this.transition(action, "approved");
    await this.repository.recordEvent?.({ action: saved, event_type: "action_approved", from_status: action.status, to_status: saved.status, actor_id: actorId, summary: "Explicit user approval received." });
    logger.info("oyi_action_approved", { action_id: saved.action_id, actor_id: actorId, revision: saved.revision });
    return saved;
  }

  async cancel(action: OyiAction, actorId: string | null, reason = "user_cancelled") {
    const saved = await this.transition(action, "cancelled", { reason });
    await this.repository.recordEvent?.({ action: saved, event_type: "action_cancelled", from_status: action.status, to_status: saved.status, actor_id: actorId, summary: "Action cancelled before execution.", metadata: { reason } });
    return saved;
  }

  async supersede(action: OyiAction, reason = "new_request") {
    const saved = await this.transition(action, "superseded", { reason });
    await this.repository.recordEvent?.({ action: saved, event_type: "action_superseded", from_status: action.status, to_status: saved.status, summary: "Action superseded before execution.", metadata: { reason } });
    return saved;
  }

  async executeWithAdapter(action: OyiAction, adapter: OyiDomainActionAdapter) {
    if (action.status !== "approved") {
      const error: any = new Error("Action must be approved before execution");
      error.code = "ACTION_NOT_APPROVED";
      throw error;
    }
    let current = await this.transition(action, "queued");
    current = await this.transition(current, "sent");
    logger.info("oyi_action_executor_called", {
      thread_id: current.thread_id,
      workflow_id: current.workflow_id,
      action_id: current.action_id,
      capability_key: current.capability_key,
      domain: current.domain,
      target_type: current.target.object_type,
      revision: current.revision,
    });
    const execution = await adapter.execute(current);
    const providerStatus: OyiActionStatus = execution.status === "provider_accepted" || execution.status === "confirmed" || execution.status === "unobservable"
      ? "provider_accepted"
      : execution.status === "provider_rejected" ? "provider_rejected" : "failed";
    current = await this.transition(current, providerStatus, execution.result || null, {
      executor_reference: execution.executor_reference || current.executor_reference,
      safe_error: execution.safe_error || null,
      evidence: [...current.evidence, ...(execution.evidence || [])],
    });
    if (providerStatus === "provider_rejected" || providerStatus === "failed") return current;
    current = await this.transition(current, "verifying");
    logger.info("oyi_action_verification_started", { action_id: current.action_id, revision: current.revision });
    const verified = adapter.verify ? await adapter.verify(current, execution) : execution;
    const terminal: OyiActionStatus =
      verified.status === "confirmed" ? "confirmed" :
        verified.status === "unobservable" ? "unobservable" :
          verified.status === "timed_out" ? "timed_out" :
            verified.status === "provider_rejected" ? "provider_rejected" :
              verified.status === "failed" ? "failed" : "unobservable";
    current = await this.transition(current, terminal, verified.result || execution.result || null, {
      executor_reference: verified.executor_reference || execution.executor_reference || current.executor_reference,
      safe_error: verified.safe_error || execution.safe_error || null,
      evidence: [...current.evidence, ...(verified.evidence || [])],
    });
    await this.repository.recordEvidence?.(current.action_id, current.evidence);
    logger.info(terminal === "confirmed" || terminal === "unobservable" ? "oyi_action_verified" : "oyi_action_failed", {
      action_id: current.action_id,
      status: current.status,
      revision: current.revision,
    });
    return current;
  }
}

export function createDefaultActionService() {
  const useMemory = /^(1|true|yes)$/i.test(String(process.env.OYI_ACTION_MEMORY_REPOSITORY || ""));
  return new ActionService(useMemory ? new InMemoryActionRepository() : new SupabaseActionRepository());
}
