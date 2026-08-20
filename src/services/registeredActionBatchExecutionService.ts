import crypto from "crypto";
import { executeRegisteredAction } from "../intelligence-core/executionRegistry";
import { logger } from "../observability/logger";

// Shared Automation Runtime PR 2 (Facility) — the registered-action
// counterpart to residentActionBatchExecutionService.ts's device-command
// batch. Same bounded-concurrency/timeout shape, different dispatch
// target: executeRegisteredAction (visitor.*/maintenance.* today), which
// already owns its own scope/permission enforcement and observability
// (publishSourceIntelligenceEvent) — this file adds no new authorization
// logic of its own, only the batch/timeout scaffolding around it.
export const REGISTERED_ACTION_BATCH_CONCURRENCY = 3;
export const REGISTERED_ACTION_TIMEOUT_MS = 15_000;

export type RegisteredCanonicalAction = {
  action_id: string;
  entity_id: string;
  assignee?: string | null;
  label?: string | null;
  action_label: string;
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

export function stableRegisteredActionExecutionId(runId: string, index: number, action: RegisteredCanonicalAction) {
  const hash = crypto.createHash("sha256").update(`registered:${runId}:${index}:${action.action_id}:${action.entity_id}`).digest("hex").slice(0, 24);
  return `automation_registered_action:${hash}`;
}

export async function executeRegisteredActionBatch(input: {
  actor: any;
  runId: string;
  actions: RegisteredCanonicalAction[];
  requestedAt: string;
}) {
  const { actor, runId, actions, requestedAt } = input;
  return mapWithConcurrency(actions, REGISTERED_ACTION_BATCH_CONCURRENCY, async (action, index) => {
    const actionExecutionId = stableRegisteredActionExecutionId(runId, index, action);
    logger.info("automation_action_execution_started", {
      automation_run_id: runId,
      action_index: index,
      action_type: "registered_action",
      registered_action_id: action.action_id,
      entity_id: action.entity_id,
    });
    try {
      const result = await withTimeout(
        executeRegisteredAction({
          action_id: action.action_id,
          actor,
          entity_id: action.entity_id,
          assignee: action.assignee || undefined,
          source: "automation",
          confirmed: true,
        }),
        REGISTERED_ACTION_TIMEOUT_MS,
      );
      const status = result?.ok === true ? "executed" : result?.status === "denied" ? "denied" : "failed";
      const completed = {
        action_index: index,
        automation_action_execution_id: actionExecutionId,
        command_execution_id: null,
        action_type: "registered_action",
        registered_action_id: action.action_id,
        entity_id: action.entity_id,
        action_label: action.action_label,
        status,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        error: status === "executed" ? null : (result as any)?.reason || "registered_action_failed",
      };
      logger.info("automation_action_execution_completed", {
        automation_run_id: runId,
        action_index: index,
        registered_action_id: action.action_id,
        status,
      });
      return completed;
    } catch (runError: any) {
      const status = Number(runError?.statusCode) === 504 ? "timed_out" : "failed";
      logger.warn("automation_action_execution_failed", {
        automation_run_id: runId,
        action_index: index,
        registered_action_id: action.action_id,
        status,
        reason: runError?.code || runError?.message || "registered_action_failed",
      });
      return {
        action_index: index,
        automation_action_execution_id: actionExecutionId,
        command_execution_id: null,
        action_type: "registered_action",
        registered_action_id: action.action_id,
        entity_id: action.entity_id,
        action_label: action.action_label,
        status,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        error: runError?.message || "registered_action_failed",
      };
    }
  });
}
