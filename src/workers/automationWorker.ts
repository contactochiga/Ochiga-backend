// src/workers/automationWorker.ts
import { Worker, Queue, Job } from "bullmq";
import IORedis from "ioredis";
import { supabaseAdmin } from "../supabase/client";
import { publishDeviceAction } from "../device/bridge";

// ------------------------------------
// Redis connection (BullMQ compatible)
// ------------------------------------
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379");

// ------------------------------------
// Automation Queue
// ------------------------------------
export const automationQueue = new Queue("automations", {
  connection,
});

// ------------------------------------
// Enqueue automation
// ------------------------------------
export async function enqueueAutomation(automationId: string) {
  await automationQueue.add(
    "run_automation",
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
    async (job: Job<{ automationId: string }>) => {
      const { automationId } = job.data;

      const { data: automation, error } = await supabaseAdmin
        .from("automations")
        .select("*")
        .eq("id", automationId)
        .single();

      if (error || !automation) {
        throw new Error("Automation not found");
      }

      // Only device automations supported for now
      if (automation.action?.type === "device") {
        const { device_id, command, topic } = automation.action;

        const deviceTopic =
          topic ||
          `ochiga/estate/${automation.estate_id}/device/${device_id}/set`;

        publishDeviceAction(deviceTopic, command);

        await supabaseAdmin.from("device_events").insert([
          {
            device_id,
            user_id: automation.created_by,
            action: "automation_run",
            params: command,
          },
        ]);
      } else {
        console.warn("Unsupported automation action", automation.action);
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
