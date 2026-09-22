// src/workers/automationWorker.ts

import { Worker, Queue, Job } from "bullmq";
import IORedis from "ioredis";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { NotificationService } from "../services/NotificationService";
import { logger } from "../observability/logger";
import type { AuthUser } from "../middleware/auth";
import { permissionsForRole } from "../core/foundation";
import { authorizeDeviceCommand } from "../oyi-core/actions/DeviceCommandAuthority";
import { executeDeviceCommandForActor } from "../controllers/deviceCommandController";

/**
 * ============================================
 * REDIS CONNECTION (BullMQ expects plain config)
 * ============================================
 */
const connection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  }
);

/**
 * ============================================
 * AUTOMATION QUEUE
 * (⚠️ NO colon in name — BullMQ rule)
 * ============================================
 */
export const automationQueue = new Queue("automations", {
  connection,
});

/**
 * ============================================
 * ENQUEUE AUTOMATION JOB
 * ============================================
 */
export async function enqueueAutomation(automationId: string) {
  if (!automationId) {
    throw new Error("automationId is required");
  }

  await automationQueue.add(
    "run_automation",
    { automationId },
    {
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
}

/**
 * ============================================
 * WORKER PROCESSOR
 * ============================================
 */
export async function handleAutomationJob(job: Job<{ automationId: string }>) {
  const { automationId } = job.data;

  if (!automationId) {
    throw new Error("Invalid automation job payload");
  }

  // Fetch automation
  const { data: automation, error } = await supabaseAdmin
    .from("automations")
    .select("*")
    .eq("id", automationId)
    .single();

  if (error || !automation) {
    throw new Error(`Automation not found: ${automationId}`);
  }

  /**
   * ============================================
   * EXECUTE AUTOMATION ACTION
   * ============================================
   */
  if (automation.action?.type === "device") {
    const { device_id, command } = automation.action;

    if (!device_id || !command || typeof command !== "object") {
      logger.warn("automation_worker_denied_malformed", { automation_id: automation.id, job_id: job.id });
      return { ok: false, status: "denied", reason: "malformed_command" };
    }

    // Wave 5E -- converged physical authority/execution path. This
    // branch previously published straight to the MQTT device bridge
    // with no capability check, no canonical executor, no ledger, no
    // verification -- the same class of live bypass Wave 5D closed
    // for the signal/intent worker. The job payload here is only
    // {automationId}; there is no client-supplied actor to trust or
    // distrust, so the truthful actor is reconstructed the same way
    // Wave 5C's scheduled-automation path (scenes.ts's
    // claimAndRunAutomation) already does: the real stored users()
    // row for automation.created_by. If that user can't be found,
    // fail closed rather than fabricate an actor.
    const createdBy = automation.created_by;
    if (!createdBy) {
      logger.warn("automation_worker_denied_missing_actor", { automation_id: automation.id, job_id: job.id });
      return { ok: false, status: "denied", reason: "missing_actor" };
    }
    const { data: userRow } = await supabaseAdmin
      .from("users")
      .select("id, role, estate_id, home_id")
      .eq("id", createdBy)
      .maybeSingle();
    if (!userRow?.id) {
      logger.warn("automation_worker_denied_actor_not_found", { automation_id: automation.id, job_id: job.id, actor_id: createdBy });
      return { ok: false, status: "denied", reason: "actor_not_found" };
    }

    const actor: AuthUser = {
      id: userRow.id,
      role: userRow.role as any,
      estate_id: (userRow as any).estate_id || undefined,
      home_id: (userRow as any).home_id || undefined,
      permission_scopes: [],
      permissions: permissionsForRole(userRow.role as any, []),
    };

    // "automation" is the honest commandSource for this domain -- it
    // maps to the same "consumer" capability surface as "app" unless
    // the real actor's role is itself facility-ish, matching the same
    // role-based fallback Wave 5D's intentWorker.ts uses.
    const roleText = String(actor.role || "").toLowerCase();
    const commandSource = /facility|operator|admin|security|maintenance/.test(roleText) ? "facility" : "automation";

    const authority = authorizeDeviceCommand({
      actor,
      commandSource,
      estateId: actor.estate_id || null,
      homeId: actor.home_id || null,
      roomId: automation.room_id || null,
    });
    if (!authority.allowed) {
      logger.warn("automation_worker_denied_authority", {
        automation_id: automation.id,
        job_id: job.id,
        actor_id: actor.id,
        reason: authority.reason,
      });
      await NotificationService.sendToUser(String(automation.created_by), {
        title: "Automation failed",
        message: `${String(automation.name || "Automation")} could not run.`,
        type: "system",
        payload: {
          automation_id: String(automation.id),
          estate_id: String(automation.estate_id || ""),
          reason: authority.reason || "devices.power.control denied",
          kind: "automation.failed",
        },
        entityId: String(automation.id),
      });
      return { ok: false, status: "denied", reason: authority.reason || "devices.power.control denied" };
    }

    // job.id is stable across any BullMQ redelivery of this SAME job
    // (stalled-job recovery; this queue sets no explicit `attempts`,
    // which defaults to 1, but a worker crash mid-processing can still
    // cause BullMQ to redeliver) -- deriving command_execution_id from
    // it means a redelivered attempt reuses the identical canonical
    // execution row, and the existing LIFECYCLE_RANK monotonic-
    // transition guard in upsertDeviceCommandExecution makes that safe
    // against duplicate physical effects, with no new idempotency logic.
    const commandExecutionId = `automation:${job.id}`;

    let result: any;
    try {
      result = await executeDeviceCommandForActor({
        actor,
        deviceId: String(device_id),
        command,
        source: "automation" as any,
        scope: { estateId: actor.estate_id || undefined, homeId: actor.home_id || undefined },
        commandExecutionId,
      });
    } catch (execError: any) {
      const statusCode = Number(execError?.statusCode) || 0;
      if (statusCode === 403 || statusCode === 404) {
        // Permanent scope/visibility denials that resolveCommandTarget
        // (deviceCommandController.ts) already throws -- this queue has
        // no retry configured, but a stalled-job redelivery would never
        // change this outcome either, so it is returned (not re-thrown)
        // rather than left to retry uselessly.
        logger.warn("automation_worker_denied_scope", {
          automation_id: automation.id,
          job_id: job.id,
          actor_id: actor.id,
          status: statusCode,
          reason: execError?.message,
        });
        await NotificationService.sendToUser(String(automation.created_by), {
          title: "Automation failed",
          message: `${String(automation.name || "Automation")} could not run.`,
          type: "system",
          payload: {
            automation_id: String(automation.id),
            estate_id: String(automation.estate_id || ""),
            reason: execError?.message || "device_not_visible",
            kind: "automation.failed",
          },
          entityId: String(automation.id),
        });
        return { ok: false, status: "denied", reason: execError?.message || "device_not_visible" };
      }
      // Anything else (provider unavailable, unexpected errors)
      // propagates so the existing worker "failed" event/notification
      // handling below applies, unchanged from before this slice.
      throw execError;
    }

    await NotificationService.sendToUser(String(automation.created_by), {
      title: "Automation completed",
      message: `${String(automation.name || "Automation")} ran successfully.`,
      type: "system",
      payload: {
        automation_id: String(automation.id),
        estate_id: String(automation.estate_id || ""),
        device_id: String(device_id),
        command,
        kind: "automation.completed",
      },
      entityId: String(automation.id),
    });

    return { ok: result?.ok !== false, status: result?.status || "dispatched", command_execution_id: result?.command_execution_id || commandExecutionId };
  } else {
    console.warn(
      `Unsupported automation action type: ${automation.action?.type}`
    );
    await NotificationService.sendToUser(String(automation.created_by), {
      title: "Automation unsupported",
      message: `${String(automation.name || "Automation")} uses an unsupported action type.`,
      type: "system",
      payload: {
        automation_id: String(automation.id),
        estate_id: String(automation.estate_id || ""),
        action_type: automation.action?.type || null,
        kind: "automation.unsupported",
      },
      entityId: String(automation.id),
    });
  }
}

export function startAutomationWorker() {
  const worker = new Worker(
    "automations",
    handleAutomationJob,
    {
      connection,
    }
  );

  /**
   * ============================================
   * WORKER EVENTS
   * ============================================
   */
  worker.on("completed", (job) => {
    console.log("✅ Automation completed:", job.id);
  });

  worker.on("failed", (job, err) => {
    console.error("❌ Automation failed:", job?.id, err.message);
  });

  worker.on("failed", async (job, err) => {
    try {
      const automationId = String(job?.data?.automationId || "");
      if (!automationId) return;
      const { data: automation } = await supabaseAdmin
        .from("automations")
        .select("id,name,created_by,estate_id")
        .eq("id", automationId)
        .maybeSingle();
      if (!automation?.created_by) return;

      await NotificationService.sendToUser(String(automation.created_by), {
        title: "Automation failed",
        message: `${String(automation.name || "Automation")} failed to run.`,
        type: "system",
        payload: {
          automation_id: String(automation.id),
          estate_id: String(automation.estate_id || ""),
          error: err?.message || "Unknown worker error",
          kind: "automation.failed",
        },
        entityId: String(automation.id),
      });
    } catch (notifyErr: any) {
      console.warn("automation failure notify failed:", notifyErr?.message || notifyErr);
    }
  });

  return worker;
}
