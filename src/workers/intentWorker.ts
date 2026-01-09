// src/workers/intentWorker.ts
import { Worker, Queue, Job } from "bullmq";
import IORedis from "ioredis";
import { NotificationService } from "../services/NotificationService";
import { publishDeviceAction } from "../device/bridge";
import { Intent } from "../core/control-plane/intent.types";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379");

export const intentQueue = new Queue("intents", { connection });

export async function enqueueIntent(intent: Intent) {
  await intentQueue.add("execute_intent", intent, {
    removeOnComplete: true,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
}

export async function startIntentWorker() {
  const worker = new Worker(
    "intents",
    async (job: Job) => {
      const intent: Intent = job.data;

      switch (intent.target) {
        case "notification":
          await handleNotificationIntent(intent);
          break;

        case "device":
          await handleDeviceIntent(intent);
          break;

        default:
          console.warn("Unknown intent target:", intent);
      }
    },
    { connection }
  );

  worker.on("completed", (job) => {
    console.log("✅ Intent executed:", job.id);
  });

  worker.on("failed", (job, err) => {
    console.error("❌ Intent failed:", job?.id, err);
  });

  return worker;
}

// ---------------------------
// Intent handlers
// ---------------------------

async function handleNotificationIntent(intent: any) {
  const { audience, scope, referenceId, payload } = intent;

  if (scope === "user") {
    await NotificationService.sendToUser(referenceId, payload);
  }

  if (scope === "home") {
    await NotificationService.sendToHome(referenceId, payload);
  }

  if (scope === "estate") {
    await NotificationService.sendToEstate(referenceId, payload);
  }
}

async function handleDeviceIntent(intent: any) {
  const { deviceId, command } = intent;
  const topic = `ochiga/device/${deviceId}/set`;

  publishDeviceAction(topic, command);
}
