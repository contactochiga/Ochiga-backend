import crypto from "crypto";
import type { AuthUser } from "../middleware/auth";
import { createWorkflow, getWorkflow, transitionWorkflow, WORKFLOW_CONTRACTS, type WorkflowStatus } from "../intelligence-core/workflows";
import { logger } from "../observability/logger";

// Shared Automation Runtime PR 3 (Office) — the Task-domain counterpart
// to PR 2's registered-action batch. Dispatches into the exact same
// createWorkflow/transitionWorkflow/getWorkflow functions the Oyi
// Runtime Contract Task-domain bridge (officeExport.ts) already calls
// in production — no new workflow logic, no new table, no crm_tasks
// interaction. This file only adds batch/timeout scaffolding and a
// narrow, existing-contract-derived allowlist around them.
export const WORKFLOW_ACTION_BATCH_CONCURRENCY = 3;
export const WORKFLOW_ACTION_TIMEOUT_MS = 15_000;

const WORKFLOW_CONTRACT_BY_TYPE = new Map<string, (typeof WORKFLOW_CONTRACTS)[number]>(
  WORKFLOW_CONTRACTS.map((contract) => [contract.workflow_type, contract]),
);

export function workflowContractFor(workflowType: string) {
  return WORKFLOW_CONTRACT_BY_TYPE.get(workflowType) || null;
}

export type WorkflowCanonicalAction = {
  operation: "create" | "transition";
  workflow_type?: string | null;
  workflow_id?: string | null;
  status?: string | null;
  title?: string | null;
  summary?: string | null;
  label?: string | null;
};

async function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error: any = new Error("Automation action timed out.");
          error.statusCode = 504;
          error.code = "automation_action_timed_out";
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export function stableWorkflowActionExecutionId(runId: string, index: number, action: WorkflowCanonicalAction) {
  const hash = crypto.createHash("sha256").update(`workflow:${runId}:${index}:${action.operation}:${action.workflow_type || action.workflow_id || ""}`).digest("hex").slice(0, 24);
  return `automation_workflow_action:${hash}`;
}

async function runOne(actor: AuthUser, action: WorkflowCanonicalAction, scope: { estateId?: string | null; homeId?: string | null }) {
  if (action.operation === "create") {
    const contract = workflowContractFor(action.workflow_type || "");
    if (!contract) return { ok: false, reason: "unsupported_workflow_type" };
    const result = await createWorkflow({
      workflow_type: contract.workflow_type,
      title: action.title || contract.workflow_type,
      summary: action.summary || `Automation-created ${contract.workflow_type} workflow.`,
      origin_agent: contract.origin_agent as any,
      responsible_agent: contract.responsible_agent as any,
      actor,
      estate_id: scope.estateId || null,
      home_id: scope.homeId || null,
      metadata: { created_via: "shared_automation_runtime", surface: "office" },
    });
    return result.ok ? { ok: true, workflow: result.workflow } : { ok: false, reason: result.error || "workflow_create_failed" };
  }

  // transition
  const existing = await getWorkflow(String(action.workflow_id || ""), actor);
  if (!existing.ok || !existing.workflow) return { ok: false, reason: existing.error || "workflow_not_found" };
  const result = await transitionWorkflow({
    workflow: existing.workflow,
    status: (action.status || "in_progress") as WorkflowStatus,
    actor,
    summary: action.summary || undefined,
  });
  return result.ok ? { ok: true, workflow: result.workflow } : { ok: false, reason: result.error || "workflow_transition_failed" };
}

export async function executeWorkflowActionBatch(input: {
  actor: AuthUser;
  runId: string;
  actions: WorkflowCanonicalAction[];
  requestedAt: string;
  scope: { estateId?: string | null; homeId?: string | null };
}) {
  const { actor, runId, actions, requestedAt, scope } = input;
  return mapWithConcurrency(actions, WORKFLOW_ACTION_BATCH_CONCURRENCY, async (action, index) => {
    const actionExecutionId = stableWorkflowActionExecutionId(runId, index, action);
    logger.info("automation_action_execution_started", {
      automation_run_id: runId,
      action_index: index,
      action_type: "workflow_action",
      operation: action.operation,
      workflow_type: action.workflow_type || null,
      workflow_id: action.workflow_id || null,
    });
    try {
      const result = await withTimeout(runOne(actor, action, scope), WORKFLOW_ACTION_TIMEOUT_MS);
      const status = result.ok ? "executed" : "failed";
      const completed = {
        action_index: index,
        automation_action_execution_id: actionExecutionId,
        command_execution_id: null,
        action_type: "workflow_action",
        operation: action.operation,
        workflow_type: action.workflow_type || null,
        workflow_id: (result as any).workflow?.workflow_id || action.workflow_id || null,
        action_label: action.label || action.operation,
        status,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        error: result.ok ? null : (result as any).reason || "workflow_action_failed",
      };
      logger.info("automation_action_execution_completed", {
        automation_run_id: runId,
        action_index: index,
        operation: action.operation,
        status,
      });
      return completed;
    } catch (runError: any) {
      const status = Number(runError?.statusCode) === 504 ? "timed_out" : "failed";
      logger.warn("automation_action_execution_failed", {
        automation_run_id: runId,
        action_index: index,
        operation: action.operation,
        status,
        reason: runError?.code || runError?.message || "workflow_action_failed",
      });
      return {
        action_index: index,
        automation_action_execution_id: actionExecutionId,
        command_execution_id: null,
        action_type: "workflow_action",
        operation: action.operation,
        workflow_type: action.workflow_type || null,
        workflow_id: action.workflow_id || null,
        action_label: action.label || action.operation,
        status,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        error: runError?.message || "workflow_action_failed",
      };
    }
  });
}
