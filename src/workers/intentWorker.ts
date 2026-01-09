// src/workers/intentWorker.ts
import { Worker, Queue, Job } from "bullmq";
import IORedis from "ioredis";
import { NotificationService } from "../services/NotificationService";
import { publishDeviceAction } from "../device/bridge";
import {
  Intent,
  NotifyIntent,
  DeviceCommandIntent,
} from "../core/control-plane/intent.types";
import { supabaseAdmin } from "../supabase/client";

const connection = new IORedis(process.env.REDIS_URL!);

export const intentQueue = new Queue("intents", { connection });

export async function enqueueIntent(intent: Intent) {
  await intentQueue.add("execute_intent", intent, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
}

export async function startIntentWorker() {
  const worker = new Worker(
    "intents",
    async (job: Job<Intent>) => {
      const intent = job.data;

      if (intent.target === "notification") {
        await handleNotificationIntent(intent);
      }

      if (intent.target === "device") {
        await handleDeviceIntent(intent);
      }
    },
    { connection }
  );

  worker.on("failed", async (job, err) => {
    await supabaseAdmin.from("failed_intents").insert({
      intent: job?.data,
      error: err.message,
      failed_at: new Date().toISOString(),
    });
  });

  return worker;
}

async function handleNotificationIntent(intent: NotifyIntent) {
  if (intent.scope === "user")
    await NotificationService.sendToUser(intent.referenceId, intent.payload);

  if (intent.scope === "home")
    await NotificationService.sendToHome(intent.referenceId, intent.payload);

  if (intent.scope === "estate")
    await NotificationService.sendToEstate(intent.referenceId, intent.payload);
}

async function handleDeviceIntent(intent: DeviceCommandIntent) {
  publishDeviceAction(
    `ochiga/device/${intent.deviceId}/set`,
    intent.command
  );
}
