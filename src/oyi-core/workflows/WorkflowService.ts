import { randomUUID } from "crypto";
import type { OyiWorkflow, WorkflowStatus } from "../contracts/workflow";
import type { ResolvedTurn } from "../contracts/resolvedTurn";
import { assertWorkflowTransition, isTerminalWorkflowStatus } from "./WorkflowStateMachine";
import type { WorkflowRepository } from "./WorkflowRepository";
import { InMemoryWorkflowRepository, SupabaseWorkflowRepository } from "./WorkflowRepository";
import { logger } from "../../observability/logger";
import { operationalMetrics } from "../../observability/metrics";

function nowIso() {
  return new Date().toISOString();
}

export function createWorkflowForTurn(turn: ResolvedTurn, status: WorkflowStatus = "collecting_inputs"): OyiWorkflow {
  const now = nowIso();
  return {
    workflow_id: randomUUID(),
    thread_id: turn.thread_id || randomUUID(),
    request_id: turn.request_id,
    actor_id: turn.actor?.id || null,
    surface: String((turn.context as any)?.surface || "consumer"),
    capability_key: turn.capability_key,
    domain: (turn.domain || "global") as OyiWorkflow["domain"],
    operation: turn.operation,
    status,
    target: turn.target,
    inputs: {},
    unresolved_inputs: [],
    authority_decision: turn.authority,
    proposed_action: null,
    execution_record: null,
    evidence: [],
    metadata: {},
    action_id: null,
    revision: 1,
    created_at: now,
    updated_at: now,
    expires_at: null,
    completed_at: null,
    cancelled_at: null,
    superseded_at: null,
  };
}

export function transitionWorkflow(workflow: OyiWorkflow, status: WorkflowStatus): OyiWorkflow {
  if (isTerminalWorkflowStatus(workflow.status)) return workflow;
  assertWorkflowTransition(workflow.status, status);
  const now = nowIso();
  return {
    ...workflow,
    status,
    revision: workflow.revision + 1,
    updated_at: now,
    completed_at: status === "completed" || status === "answered" ? now : workflow.completed_at,
    cancelled_at: status === "cancelled" ? now : workflow.cancelled_at,
    superseded_at: status === "superseded" ? now : workflow.superseded_at,
  };
}

export class WorkflowService {
  constructor(private readonly repository: WorkflowRepository) {}

  async create(turn: ResolvedTurn, status: WorkflowStatus = "collecting_inputs", patch: Partial<OyiWorkflow> = {}) {
    const workflow = { ...createWorkflowForTurn(turn, status), ...patch, revision: patch.revision || 1 };
    const saved = await this.repository.save(workflow);
    logger.info("oyi_workflow_created", {
      request_id: saved.request_id,
      thread_id: saved.thread_id,
      workflow_id: saved.workflow_id,
      capability_key: saved.capability_key,
      domain: saved.domain,
      status: saved.status,
      revision: saved.revision,
    });
    return saved;
  }

  async get(workflowId: string) {
    return this.repository.get(workflowId);
  }

  async restoreActive(input: { threadId?: string | null; actorId?: string | null }) {
    if (!input.threadId) return null;
    const workflow = await this.repository.getActive(input.threadId, input.actorId);
    if (workflow?.expires_at && new Date(workflow.expires_at).getTime() <= Date.now()) {
      await this.expire(workflow).catch((error) => {
        logger.warn("oyi_workflow_expire_failed", {
          thread_id: input.threadId,
          workflow_id: workflow.workflow_id,
          error: (error as any)?.message || String(error),
        });
      });
      return null;
    }
    if (workflow) {
      logger.info("oyi_workflow_restored", {
        thread_id: input.threadId,
        workflow_id: workflow.workflow_id,
        capability_key: workflow.capability_key,
        domain: workflow.domain,
        status: workflow.status,
        revision: workflow.revision,
      });
      operationalMetrics.increment("oyi_workflow_restored_total", { domain: workflow.domain, source: "thread", status: workflow.status });
    }
    return workflow;
  }

  async restoreReferenced(input: {
    workflowId?: string | null;
    threadId?: string | null;
    actorId?: string | null;
    surface?: string | null;
    estateId?: string | null;
    homeId?: string | null;
  }) {
    if (!input.workflowId) return null;
    const workflow = await this.repository.get(input.workflowId);
    if (!workflow) return null;
    const deniedReason = !input.threadId || workflow.thread_id !== input.threadId
      ? "thread_mismatch"
      : !input.actorId || workflow.actor_id !== input.actorId
      ? "actor_mismatch"
      : input.surface && workflow.surface !== input.surface
        ? "surface_mismatch"
        : input.homeId && workflow.target?.home_id && workflow.target.home_id !== input.homeId
          ? "home_mismatch"
          : input.estateId && workflow.target?.estate_id && workflow.target.estate_id !== input.estateId
            ? "estate_mismatch"
            : isTerminalWorkflowStatus(workflow.status)
              ? "terminal_workflow"
              : workflow.expires_at && new Date(workflow.expires_at).getTime() <= Date.now()
                ? "expired_workflow"
                : null;
    if (deniedReason) {
      logger.info("oyi_workflow_reference_rejected", {
        workflow_id: workflow.workflow_id,
        thread_id: workflow.thread_id,
        actor_id: input.actorId || null,
        surface: input.surface || null,
        status: workflow.status,
        reason: deniedReason,
      });
      operationalMetrics.increment("oyi_workflow_reference_rejected_total", { domain: workflow.domain, reason: deniedReason });
      return null;
    }
    logger.info("oyi_workflow_restored", {
      thread_id: workflow.thread_id,
      workflow_id: workflow.workflow_id,
      capability_key: workflow.capability_key,
      domain: workflow.domain,
      status: workflow.status,
      revision: workflow.revision,
      restore_strategy: "explicit_workflow_reference",
    });
    operationalMetrics.increment("oyi_workflow_restored_total", { domain: workflow.domain, source: "explicit_reference", status: workflow.status });
    return workflow;
  }

  async saveInput(workflow: OyiWorkflow, input: { input_key: string; value: unknown; source?: string; validated?: boolean }) {
    await this.repository.saveInput?.(workflow.workflow_id, {
      input_key: input.input_key,
      value: input.value,
      source: input.source || "user",
      validated: Boolean(input.validated),
    });
    const next: OyiWorkflow = {
      ...workflow,
      inputs: { ...workflow.inputs, [input.input_key]: { value: input.value, source: input.source || "user", validated: Boolean(input.validated) } },
      revision: workflow.revision + 1,
      updated_at: nowIso(),
    };
    const saved = await this.repository.save(next, { expectedRevision: workflow.revision });
    logger.info("oyi_workflow_input_saved", {
      thread_id: saved.thread_id,
      workflow_id: saved.workflow_id,
      input_key: input.input_key,
      status: saved.status,
      revision: saved.revision,
    });
    return saved;
  }

  async transition(workflow: OyiWorkflow, status: WorkflowStatus, patch: Partial<OyiWorkflow> = {}) {
    const transitioned = { ...transitionWorkflow(workflow, status), ...patch };
    const saved = await this.repository.save(transitioned, { expectedRevision: workflow.revision });
    logger.info("oyi_workflow_transitioned", {
      thread_id: saved.thread_id,
      workflow_id: saved.workflow_id,
      capability_key: saved.capability_key,
      domain: saved.domain,
      from_status: workflow.status,
      to_status: saved.status,
      revision: saved.revision,
    });
    return saved;
  }

  async update(workflow: OyiWorkflow, patch: Partial<OyiWorkflow>) {
    const next: OyiWorkflow = {
      ...workflow,
      ...patch,
      revision: workflow.revision + 1,
      updated_at: nowIso(),
    };
    const saved = await this.repository.save(next, { expectedRevision: workflow.revision });
    logger.info("oyi_workflow_input_saved", {
      thread_id: saved.thread_id,
      workflow_id: saved.workflow_id,
      capability_key: saved.capability_key,
      domain: saved.domain,
      status: saved.status,
      revision: saved.revision,
      updated_fields: Object.keys(patch).filter((key) => key !== "metadata" && key !== "evidence"),
    });
    return saved;
  }

  async cancel(workflow: OyiWorkflow, reason = "user_cancelled") {
    const next = await this.transition(workflow, "cancelled", {
      evidence: workflow.evidence.concat([{ type: "workflow_cancelled", reason, observed_at: nowIso() }]),
    });
    logger.info("oyi_workflow_cancelled", { workflow_id: next.workflow_id, reason, revision: next.revision });
    return next;
  }

  async expire(workflow: OyiWorkflow) {
    const next = await this.transition(workflow, "expired");
    logger.info("oyi_workflow_expired", { workflow_id: next.workflow_id, revision: next.revision });
    return next;
  }

  async supersede(workflow: OyiWorkflow, reason = "new_request") {
    const next = await this.transition(workflow, "superseded", {
      evidence: workflow.evidence.concat([{ type: "workflow_superseded", reason, observed_at: nowIso() }]),
    });
    logger.info("oyi_workflow_superseded", { workflow_id: next.workflow_id, reason, revision: next.revision });
    return next;
  }

  async attachAction(workflow: OyiWorkflow, actionId: string) {
    const next = { ...workflow, action_id: actionId, revision: workflow.revision + 1, updated_at: nowIso() };
    return this.repository.save(next, { expectedRevision: workflow.revision });
  }
}

export function createDefaultWorkflowService() {
  const useMemory = /^(1|true|yes)$/i.test(String(process.env.OYI_WORKFLOW_MEMORY_REPOSITORY || ""));
  return new WorkflowService(useMemory ? new InMemoryWorkflowRepository() : new SupabaseWorkflowRepository());
}
