// src/workers/automationWorker.ts
import { Worker, Queue, Job } from "bullmq";
import { supabaseAdmin } from "../supabase/client";
import { publishDeviceAction } from "../device/bridge";

// ------------------------------------
// Redis connection (BullMQ SAFE)
// ------------------------------------
const connection = {
  url: process.env.REDIS_URL!,
};

// ------------------------------------
// Queue
// ------------------------------------
export const automationQueue = new Queue("automations", { connection });

// ------------------------------------
// Enqueue automation
// ------------------------------------
export async function enqueueAutomation(automationId: string) {
  await automationQueue.add(
    "run",
    { automationId },
    {
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
}

// ------------------------------------
// Worker
// ------------------------------------
export function startAutomationWorker() {
  const worker = new Worker(
    "automations",
    async (job: Job) => {
      const { automationId } = job.data;

      const { data: automation, error } = await supabaseAdmin
        .from("automations")
        .select("*")
        .eq("id", automationId)
        .single();

      if (error || !automation) {
        throw new Error("Automation not found");
      }

      // Only device actions supported
      if (automation.action?.type === "device") {
        const { device_id, command, topic } = automation.action;

        const deviceTopic =
          topic ||
          `ochiga/estate/${automation.estate_id}/device/${device_id}/set`;

        // Publish to device
        publishDeviceAction(deviceTopic, command);

        // Log event
        await supabaseAdmin.from("device_events").insert({
          device_id,
          user_id: automation.created_by,
          action: "automation_run",
          params: command,
        });
      } else {
        console.warn(
          "Unsupported automation action:",
          automation.action?.type
        );
      }
    },
    { connection }
  );

  worker.on("completed", (job) => {
    console.log("✅ Automation completed:", job.id);
  });

  worker.on("failed", (job, err) => {
    console.error("❌ Automation failed:", job?.id, err);
  });

  return worker;
}
