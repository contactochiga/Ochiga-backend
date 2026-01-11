// src/workers/automationWorker.ts

import { Worker, Queue, Job } from "bullmq";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { publishDeviceAction } from "../device/bridge";

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

        // Audit log
        await supabaseAdmin.from("device_events").insert({
          device_id,
          user_id: automation.created_by,
          action: "automation_run",
          params: command,
        });
      } else {
        console.warn(
          `Unsupported automation action type: ${automation.action?.type}`
        );
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

  return worker;
}
