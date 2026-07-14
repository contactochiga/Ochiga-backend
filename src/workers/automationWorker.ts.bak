// src/workers/automationWorker.ts

import { Worker, Queue, Job } from "bullmq";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { publishDeviceAction } from "../device/bridge";
import { NotificationService } from "../services/NotificationService";
import { recordDeviceEvent } from "../services/deviceAnalyticsService";

/**
 * ============================================
 * REDIS CONNECTION (BullMQ expects plain config)
 * ============================================
 */
const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
};

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
export function startAutomationWorker() {
  const worker = new Worker(
    "automations",
    async (job: Job<{ automationId: string }>) => {
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
        const { device_id, command, topic } = automation.action;

        if (!device_id || !command) {
          throw new Error("Invalid device automation payload");
        }

        const deviceTopic =
          topic ||
          `ochiga/estate/${automation.estate_id}/device/${device_id}/set`;

        // Publish device command
        await publishDeviceAction(deviceTopic, command);

        // Device history / timeline
        await recordDeviceEvent({
          deviceId: String(device_id),
          estateId: automation.estate_id || null,
          homeId: automation.home_id || null,
          roomId: automation.room_id || null,
          userId: automation.created_by || null,
          actorId: automation.created_by || null,
          eventType: "automation.command.queued",
          previousState: null,
          newState: { last_command: command },
          source: "automation",
          confidence: "confirmed",
          metadata: { automation_id: automation.id, automation_name: automation.name, command },
          title: `${String(automation.name || "Automation")} ran`,
          summary: `${String(automation.name || "Automation")} sent a device command.`,
        });

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
    },
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
