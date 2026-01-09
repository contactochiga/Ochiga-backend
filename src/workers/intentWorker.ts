// src/workers/intentWorker.ts
import { Worker, Queue, Job } from "bullmq";
import {
  Intent,
  NotifyIntent,
  DeviceCommandIntent,
} from "../core/control-plane/contracts/intent.types";

import { NotificationService } from "../services/NotificationService";
import { publishDeviceAction } from "../device/bridge";
import { intentDlqQueue } from "./intentDlqWorker";

// ------------------------------------
// Redis connection (BullMQ SAFE)
// ------------------------------------
const connection = {
  url: process.env.REDIS_URL!,
};

// ------------------------------------
// Intent Queue
// ------------------------------------
export const intentQueue = new Queue<Intent>("intents", {
  connection,
});

// ------------------------------------
// Enqueue Intent
// ------------------------------------
export async function enqueueIntent(intent: Intent) {
  await intentQueue.add(intent, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false, // REQUIRED for DLQ
  });
}

// ------------------------------------
// Worker (Execution Plane)
// ------------------------------------
export function startIntentWorker() {
  const worker = new Worker<Intent>(
    "intents",
    async (job: Job<Intent>) => {
      const intent = job.data;

      switch (intent.target) {
        case "notification":
          return handleNotificationIntent(intent);

        case "device":
          return handleDeviceIntent(intent);

        default: {
          const _never: never = intent;
          throw new Error("Unhandled intent target");
        }
      }
    },
    { connection }
  );

  // ------------------------------------
  // DLQ HANDOFF
  // ------------------------------------
  worker.on("failed", async (job) => {
    if (!job) return;

    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await intentDlqQueue.add(job.data, {
        removeOnComplete: true,
      });
    }
  });

  return worker;
}

// ------------------------------------
// Notification Handler
// ------------------------------------
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

    default: {
      const _never: never = scope;
      throw new Error("Unhandled notification scope");
    }
  }
}

// ------------------------------------
// Device Handler
// ------------------------------------
async function handleDeviceIntent(intent: DeviceCommandIntent) {
  const topic = `ochiga/device/${intent.deviceId}/set`;
  return publishDeviceAction(topic, intent.command);
}
