import crypto from "crypto";
import type { AuthUser } from "../middleware/auth";
import { communicationRuntime } from "./communicationRuntime/CommunicationRuntime";
import type { CommunicationChannelSelector } from "../contracts/communication";
import { resolveRecipientByQuery } from "./recipientResolutionService";
import { logger } from "../observability/logger";

// Shared Automation Runtime -- the Communication action shape (Phase M/N
// of the Communication Runtime programme). Dispatches through the SAME
// CommunicationRuntime.plan/authorize/dispatch the conversational
// propose/confirm path uses (ConversationOrchestrator.ts's
// handleCommunicationTurn) -- no second execution mechanism. An
// automation's own confirmed governance scope (it was created and
// enabled by a staff member who already passed tasks.manage) is what
// authorizes pre_authorized: true here, per Phase D's "no redundant
// second confirmation for an already-approved automation" rule.
export const COMMUNICATION_ACTION_BATCH_CONCURRENCY = 3;
export const COMMUNICATION_ACTION_TIMEOUT_MS = 15_000;

export type CommunicationCanonicalAction = {
  channel: CommunicationChannelSelector;
  recipient_email?: string | null;
  recipient_phone?: string | null;
  // Phase 15 -- "email the Head of Sales every Monday" stores the ROLE,
  // not a person, so a personnel change is picked up automatically:
  // resolved fresh against the staff directory at EACH run, never at
  // creation time. Mutually exclusive with recipient_email/phone in
  // practice (validateCommunicationActions requires exactly one kind of
  // recipient) -- "email Daniel every Monday" instead stores Daniel's
  // own stable recipient_email/phone, unaffected by staff changes.
  recipient_role_query?: string | null;
  subject?: string | null;
  body: string;
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

export function stableCommunicationActionExecutionId(runId: string, index: number, action: CommunicationCanonicalAction) {
  const hash = crypto
    .createHash("sha256")
    .update(`communication:${runId}:${index}:${action.channel}:${action.recipient_email || action.recipient_phone || ""}`)
    .digest("hex")
    .slice(0, 24);
  return `automation_communication_action:${hash}`;
}

async function runOne(actor: AuthUser, action: CommunicationCanonicalAction, runId: string) {
  let recipientEmail = action.recipient_email || null;
  let recipientPhone = action.recipient_phone || null;
  if (!recipientEmail && !recipientPhone && action.recipient_role_query) {
    // Dynamic role resolution -- freshly queried against the staff
    // directory on EVERY run, so a personnel change is picked up
    // automatically without editing the automation.
    const roleResult = await resolveRecipientByQuery(action.recipient_role_query, "role");
    if (roleResult.status !== "resolved") {
      return { ok: false, reason: roleResult.status === "ambiguous" ? "role_recipient_ambiguous" : "role_recipient_unresolved" };
    }
    recipientEmail = roleResult.recipient.email;
    recipientPhone = roleResult.recipient.phone || roleResult.recipient.whatsapp;
  }
  const plan = await communicationRuntime.plan({
    actor_id: actor.id,
    surface: "automation",
    source: "automation",
    source_record_type: "automation",
    source_record_id: runId,
    intent: "automation_action",
    channel: action.channel,
    recipient_hint: { email: recipientEmail, phone: recipientPhone, whatsapp_phone: recipientPhone },
    subject: action.subject || null,
    body: action.body,
    pre_authorized: true,
  });
  if (plan.status !== "ready") {
    return { ok: false, reason: plan.status === "rejected" ? plan.reason : "recipient_or_body_missing" };
  }
  const authorized = communicationRuntime.authorize(plan.record, { confirmed: true });
  const { result } = await communicationRuntime.dispatch(authorized);
  return result.status === "sent" ? { ok: true, provider_message_id: result.provider_message_id } : { ok: false, reason: result.failure_reason || "send_failed" };
}

export async function executeCommunicationActionBatch(input: {
  actor: AuthUser;
  runId: string;
  actions: CommunicationCanonicalAction[];
  requestedAt: string;
}) {
  const { actor, runId, actions, requestedAt } = input;
  return mapWithConcurrency(actions, COMMUNICATION_ACTION_BATCH_CONCURRENCY, async (action, index) => {
    const actionExecutionId = stableCommunicationActionExecutionId(runId, index, action);
    logger.info("automation_action_execution_started", {
      automation_run_id: runId,
      action_index: index,
      action_type: "communication_action",
      channel: action.channel,
    });
    try {
      const result = await withTimeout(runOne(actor, action, runId), COMMUNICATION_ACTION_TIMEOUT_MS);
      const status = result.ok ? "executed" : "failed";
      const completed = {
        action_index: index,
        automation_action_execution_id: actionExecutionId,
        command_execution_id: null,
        action_type: "communication_action",
        channel: action.channel,
        recipient: action.recipient_email || action.recipient_phone || null,
        action_label: action.label || `Send ${action.channel}`,
        status,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        error: result.ok ? null : (result as any).reason || "communication_action_failed",
      };
      logger.info("automation_action_execution_completed", { automation_run_id: runId, action_index: index, status });
      return completed;
    } catch (runError: any) {
      const status = Number(runError?.statusCode) === 504 ? "timed_out" : "failed";
      logger.warn("automation_action_execution_failed", {
        automation_run_id: runId,
        action_index: index,
        status,
        reason: runError?.code || runError?.message || "communication_action_failed",
      });
      return {
        action_index: index,
        automation_action_execution_id: actionExecutionId,
        command_execution_id: null,
        action_type: "communication_action",
        channel: action.channel,
        recipient: action.recipient_email || action.recipient_phone || null,
        action_label: action.label || `Send ${action.channel}`,
        status,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        error: runError?.message || "communication_action_failed",
      };
    }
  });
}
