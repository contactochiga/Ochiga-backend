import crypto from "crypto";
import { executeDeviceCommandForActor } from "../controllers/deviceCommandController";
import { logger } from "../observability/logger";

export const RESIDENT_ACTION_BATCH_CONCURRENCY = 3;
export const RESIDENT_ACTION_TIMEOUT_MS = 15_000;

export type ResidentCanonicalAction = {
  device_id: string;
  command: Record<string, any>;
  label?: string | null;
  action_label: string;
  device_name: string;
  command_code: string;
};

export type ResidentActionBatchKind = "scene" | "automation";

function prefix(kind: ResidentActionBatchKind) {
  return kind === "automation" ? "automation_action" : "scene_action";
}

export function stableResidentActionExecutionId(kind: ResidentActionBatchKind, runId: string, index: number, action: ResidentCanonicalAction) {
  const hash = crypto.createHash("sha256").update(`${kind}:${runId}:${index}:${action.device_id}:${action.command_code}`).digest("hex").slice(0, 24);
  return `${prefix(kind)}:${hash}`;
}

export function residentActionIdempotencyKey(kind: ResidentActionBatchKind, runId: string, index: number, action: ResidentCanonicalAction) {
  return `${kind}:${runId}:action:${index}:${action.device_id}:${action.command_code}`;
}

function actionReq(req: any, kind: ResidentActionBatchKind, commandKey: string, executionId: string, actionIndex: number, requestedAt: string) {
  return {
    ...req,
    headers: {
      ...(req.headers || {}),
      "idempotency-key": commandKey,
    },
    body: {
      ...(req.body || {}),
      source: kind,
      command_source: kind,
      idempotency_key: commandKey,
      command_key: commandKey,
      command_execution_id: executionId,
      tap_sequence: actionIndex + 1,
      client_tap_timestamp: Date.parse(requestedAt),
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, kind: ResidentActionBatchKind) {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error: any = new Error(`${kind === "automation" ? "Automation" : "Scene"} action timed out.`);
          error.statusCode = 504;
          error.code = `${kind}_action_timed_out`;
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

export function residentBatchStatus(results: Array<{ status: string }>, kind: ResidentActionBatchKind) {
  const failed = results.filter((item) => ["failed", "denied", "skipped", "timed_out"].includes(item.status)).length;
  if (!results.length || failed === results.length) return kind === "automation" ? "failed" : "failed";
  if (failed > 0) return kind === "automation" ? "partially_succeeded" : "partially_completed";
  return kind === "automation" ? "succeeded" : "completed";
}

export function residentBatchCounts(results: Array<{ status: string }>) {
  return {
    total: results.length,
    completed: results.filter((item) => ["completed", "accepted", "pending_confirmation", "executed"].includes(item.status)).length,
    failed: results.filter((item) => ["failed", "denied", "skipped", "timed_out"].includes(item.status)).length,
  };
}

export async function executeResidentActionBatch(input: {
  kind: ResidentActionBatchKind;
  actor: any;
  req: any;
  runId: string;
  actions: ResidentCanonicalAction[];
  requestedAt: string;
  scope: { estateId?: string | null; homeId?: string | null };
}) {
  const { kind, actor, req, runId, actions, requestedAt, scope } = input;
  return mapWithConcurrency(actions, RESIDENT_ACTION_BATCH_CONCURRENCY, async (action, index) => {
    const commandKey = residentActionIdempotencyKey(kind, runId, index, action);
    const actionExecutionId = stableResidentActionExecutionId(kind, runId, index, action);
    const scopedReq = actionReq(req, kind, commandKey, actionExecutionId, index, requestedAt);
    logger.info(`${kind}_action_execution_started`, {
      [`${kind}_run_id`]: runId,
      action_index: index,
      canonical_device_id: action.device_id,
      command_key: action.command_code,
      idempotency_key: commandKey,
    });
    try {
      const result: any = await withTimeout(executeDeviceCommandForActor({
        actor,
        deviceId: action.device_id,
        command: action.command,
        source: kind,
        scope: { estateId: scope.estateId || undefined, homeId: scope.homeId || undefined },
        req: scopedReq as any,
        commandExecutionId: actionExecutionId,
      }), RESIDENT_ACTION_TIMEOUT_MS, kind);
      const status = result?.confirmation_strategy === "provider_ack_only"
        ? "accepted"
        : result?.execution_status === "partial_confirmation" || result?.status === "command_partial_confirmation"
          ? "pending_confirmation"
          : result?.ok === true
            ? kind === "automation" ? "executed" : "completed"
            : "failed";
      const completed = {
        action_index: index,
        [`${kind}_action_execution_id`]: actionExecutionId,
        idempotency_key: commandKey,
        command_execution_id: result?.command_execution_id || actionExecutionId,
        device_id: action.device_id,
        canonical_device_id: action.device_id,
        device_name: action.device_name,
        command_key: action.command_code,
        command: action.command,
        action_label: action.action_label,
        status,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        error: null,
      };
      logger.info(`${kind}_action_execution_completed`, {
        [`${kind}_run_id`]: runId,
        action_index: index,
        canonical_device_id: action.device_id,
        command_key: action.command_code,
        status,
      });
      return completed;
    } catch (runError: any) {
      const status = Number(runError?.statusCode) === 403 ? "denied" : Number(runError?.statusCode) === 504 ? "timed_out" : "failed";
      logger.warn(`${kind}_action_execution_failed`, {
        [`${kind}_run_id`]: runId,
        action_index: index,
        canonical_device_id: action.device_id,
        command_key: action.command_code,
        status,
        reason: runError?.code || runError?.message || "command_failed",
      });
      return {
        action_index: index,
        [`${kind}_action_execution_id`]: actionExecutionId,
        idempotency_key: commandKey,
        command_execution_id: actionExecutionId,
        device_id: action.device_id,
        canonical_device_id: action.device_id,
        device_name: action.device_name,
        command_key: action.command_code,
        command: action.command,
        action_label: action.action_label,
        status,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        error: runError?.message || "command_failed",
      };
    }
  });
}
