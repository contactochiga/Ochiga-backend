// src/workers/intentWorker.ts
import { Worker, Queue, Job } from "bullmq";
import IORedis from "ioredis";
import {
  Intent,
  NotifyIntent,
  DeviceCommandIntent,
  UniversalIntent,
} from "../core/control-plane/contracts/intent.types";
import { NotificationService } from "../services/NotificationService";
import { intentDlqQueue } from "./intentDlqWorker";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { publishSourceIntelligenceEvent } from "../intelligence-core";
import { logger } from "../observability/logger";
import type { AuthUser } from "../middleware/auth";
import { permissionsForRole } from "../core/foundation";
import { authorizeDeviceCommand } from "../oyi-core/actions/DeviceCommandAuthority";
import { executeDeviceCommandForActor } from "../controllers/deviceCommandController";

const connection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  }
);

// -----------------------------
// Intent Queue
// -----------------------------
export const intentQueue = new Queue<Intent>("intents", { connection });

// -----------------------------
// Enqueue Intent
// -----------------------------
export async function enqueueIntent(intent: Intent) {
  await intentQueue.add("execute", intent, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}

// -----------------------------
// Worker
// -----------------------------
export function startIntentWorker() {
  const worker = new Worker<Intent>(
    "intents",
    async (job: Job<Intent>) => {
      const intent = job.data;

      if (isNotificationIntent(intent)) {
        return handleNotificationIntent(intent);
      }

      if (isDeviceIntent(intent)) {
        return handleDeviceIntent(intent, job);
      }

      if (isUniversalIntent(intent)) {
        return handleUniversalIntent(intent);
      }

      throw new Error("Unhandled intent shape");
    },
    { connection }
  );

  // -----------------------------
  // DLQ handoff
  // -----------------------------
  worker.on("failed", async (job) => {
    if (!job) return;

    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await intentDlqQueue.add("dlq", job.data);
    }
  });

  return worker;
}

// -----------------------------
// Type Guards
// -----------------------------
function isNotificationIntent(intent: Intent): intent is NotifyIntent {
  return (intent as NotifyIntent).payload !== undefined;
}

function isDeviceIntent(intent: Intent): intent is DeviceCommandIntent {
  return (intent as DeviceCommandIntent).deviceId !== undefined;
}

function isUniversalIntent(intent: Intent): intent is UniversalIntent {
  return (intent as UniversalIntent).target === "intelligence" && typeof (intent as UniversalIntent).intent === "string";
}

// -----------------------------
// Handlers
// -----------------------------
async function handleNotificationIntent(intent: NotifyIntent) {
  const { scope, referenceId, payload } = intent;

  switch (scope) {
    case "user":
      return NotificationService.sendToUser(referenceId, payload);
    case "home":
      return NotificationService.sendToHome(referenceId, payload);
    case "estate":
      return NotificationService.sendToEstate(referenceId, payload);
    case "region":
      return NotificationService.sendToRole(referenceId, "resident", payload);
    default:
      throw new Error("Unhandled notification scope");
  }
}

// Wave 5D -- converged physical authority/execution path. This function
// previously resolved the Tuya adapter and dispatched to it directly
// (or fell back to a legacy MQTT publish) with no capability check, no canonical
// executor, no ledger, and no verification -- a live bypass of
// devices.power.control found by the Wave 5C repository audit. It now
// runs the SAME canonical gate every other physical-command entrance in
// Oyi already runs through: authorizeDeviceCommand() (devices.power.control)
// then executeDeviceCommandForActor() (ai_execution_ledger, provider
// selection, verification). BullMQ remains pure transport -- it queues
// and retries this call, it does not itself decide or perform physical
// execution.
export async function handleDeviceIntent(intent: DeviceCommandIntent, job: Job<Intent>) {
  const rawRef = String(intent.deviceId || "").trim();

  if (!rawRef || !intent.command || typeof intent.command !== "object") {
    logger.warn("signal_intent_denied_malformed", { job_id: job.id, device_id: rawRef || null });
    return { ok: false, status: "denied", reason: "malformed_command", deviceId: rawRef || null };
  }

  // Fail closed -- queued intents from before this slice (or any future
  // malformed producer) carry no `actor`. There is no truthful identity
  // to authorize against, so we never dispatch and never fabricate one.
  const actorInfo = intent.actor;
  if (!actorInfo?.id || !actorInfo?.role) {
    logger.warn("signal_intent_denied_missing_actor", { job_id: job.id, device_id: rawRef });
    return { ok: false, status: "denied", reason: "missing_actor", deviceId: rawRef };
  }

  // Re-hydrate the actor's role/estate/home from the users table by the
  // real userId, rather than trusting intent.actor.estateId/homeId
  // directly for the authority decision. Why this matters: signal.
  // controller.ts's ingestSignal enriches a signal's estateId/homeId as
  // `raw.homeId || raw.home_id || req.oisContext?.home_id || req.user?.home_id`
  // -- the CLIENT-supplied body field takes priority over the
  // server-verified session, unlike every other converged entrance
  // (requestDeviceCommand derives scope only from
  // req.oisContext?.home_id / user.home_id, never req.body). Since
  // intent.actor.estateId/homeId traces back to that same signal field,
  // using it directly here would let a caller self-assert a home/estate
  // scope different from their own to pass the
  // home_scope_not_owned_by_actor check. A fresh users() lookup by the
  // real userId is immune to that -- the same server-side re-derivation
  // every authenticated request already goes through in auth.ts's
  // hydrateAuthUser. If the user no longer exists, fail closed rather
  // than fall back to the unverified signal-carried value.
  const { data: userRow } = await supabaseAdmin
    .from("users")
    .select("id, role, estate_id, home_id")
    .eq("id", actorInfo.id)
    .maybeSingle();
  if (!userRow?.id) {
    logger.warn("signal_intent_denied_actor_not_found", { job_id: job.id, device_id: rawRef, actor_id: actorInfo.id });
    return { ok: false, status: "denied", reason: "actor_not_found", deviceId: rawRef };
  }

  // Permissions are derived the same canonical way auth.ts hydrates them
  // on every authenticated request (permissionsForRole), never
  // fabricated or widened.
  const actor: AuthUser = {
    id: userRow.id,
    role: userRow.role as any,
    estate_id: (userRow as any).estate_id || undefined,
    home_id: (userRow as any).home_id || undefined,
    permission_scopes: [],
    permissions: permissionsForRole(userRow.role as any, []),
  };

  // commandSource classification for the authority pre-check, mirroring
  // deviceCommandController.ts's own commandSourceFor() role fallback.
  // Duplicated inline rather than imported: commandSourceFor is not
  // exported and this is a single, stable, one-line heuristic.
  // executeDeviceCommandForActor (below) independently re-derives its
  // own `source` via that same function when given source: "signal", so
  // this duplication is only ever used for this upstream pre-check's
  // facility-vs-consumer surface classification.
  const roleText = String(actor.role || "").toLowerCase();
  const commandSource = /facility|operator|admin|security|maintenance/.test(roleText) ? "facility" : "app";

  const authority = authorizeDeviceCommand({
    actor,
    commandSource,
    estateId: actor.estate_id || null,
    homeId: actor.home_id || null,
    roomId: actorInfo.roomId || null,
  });
  if (!authority.allowed) {
    logger.warn("signal_intent_denied_authority", {
      job_id: job.id,
      device_id: rawRef,
      actor_id: actor.id,
      reason: authority.reason,
    });
    return { ok: false, status: "denied", reason: authority.reason || "devices.power.control denied", deviceId: rawRef };
  }

  // job.id is stable across BullMQ's own retries of this SAME job
  // (attempts: 3, exponential backoff in enqueueIntent), so deriving
  // command_execution_id from it means a redelivered attempt reuses the
  // identical canonical execution row -- the existing LIFECYCLE_RANK
  // monotonic-transition guard in upsertDeviceCommandExecution
  // (deviceCommandExecutionStore.ts) then makes a queue-level retry safe
  // against duplicate physical effects, with no new idempotency logic.
  const commandExecutionId = `signal_intent:${job.id}`;

  try {
    const result: any = await executeDeviceCommandForActor({
      actor,
      deviceId: rawRef,
      command: intent.command,
      source: "signal" as any,
      scope: { estateId: actor.estate_id || undefined, homeId: actor.home_id || undefined },
      commandExecutionId,
    });
    // Same outcome mapping executeResidentActionBatch already uses
    // (residentActionBatchExecutionService.ts) -- reused for consistency
    // rather than inventing new status vocabulary. Distinguishes queue
    // completion from physical truth: "dispatched"/"pending_confirmation"
    // mean the canonical executor accepted and is tracking confirmation,
    // not that physical state was observed.
    const status = result?.confirmation_strategy === "provider_ack_only"
      ? "accepted"
      : result?.execution_status === "partial_confirmation" || result?.status === "command_partial_confirmation"
        ? "pending_confirmation"
        : result?.ok === true
          ? "dispatched"
          : "failed";
    return {
      ok: result?.ok !== false,
      status,
      command_execution_id: result?.command_execution_id || commandExecutionId,
      deviceId: rawRef,
    };
  } catch (execError: any) {
    const statusCode = Number(execError?.statusCode) || 0;
    if (statusCode === 403 || statusCode === 404) {
      // Permanent scope/visibility denials that resolveCommandTarget
      // (deviceCommandController.ts) already throws -- retrying will
      // never change the outcome, so this is returned (not re-thrown)
      // to avoid a useless BullMQ retry storm on a denial.
      logger.warn("signal_intent_denied_scope", {
        job_id: job.id,
        device_id: rawRef,
        actor_id: actor.id,
        status: statusCode,
        reason: execError?.message,
      });
      return { ok: false, status: "denied", reason: execError?.message || "device_not_visible", deviceId: rawRef };
    }
    // Anything else (provider unavailable, unexpected errors) propagates
    // so BullMQ's existing retry/backoff/DLQ semantics apply, unchanged
    // from before this slice.
    throw execError;
  }
}

async function handleUniversalIntent(intent: UniversalIntent) {
  // Classification is durable and observable; execution remains with the registered tool boundary.
  await publishSourceIntelligenceEvent({
    source: intent.surface as any,
    surface: intent.surface as any,
    event_type: `intent.${intent.intent}.${intent.action}`,
    category: intent.intent === "report" ? "operational" : "workflow",
    estate_id: intent.context.estate_id || null,
    entity_type: intent.domain,
    entity_id: intent.entity_id || null,
    title: `Oyi ${intent.intent} intent`,
    summary: `Oyi classified a ${intent.domain} ${intent.action} request.`,
    payload: { intent: intent.intent, action: intent.action, workflow_id: intent.workflow_id || null },
  }, { source_table: "intents", source_event_id: `${intent.surface}:${intent.intent}:${intent.domain}:${intent.context.created_at}` });
  return { ok: true, classified: true, intent: intent.intent, domain: intent.domain, action: intent.action };
}
