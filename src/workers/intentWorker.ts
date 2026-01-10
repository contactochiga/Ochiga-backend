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

/**
 * ============================================
 * REDIS CONNECTION (BullMQ compatible)
 * ============================================
 */
const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
};

/**
 * ============================================
 * INTENT QUEUE
 * ⚠️ Queue name MUST NOT contain colon
 * ============================================
 */
export const intentQueue = new Queue<Intent>("intent_queue", {
  connection,
});

/**
 * ============================================
 * ENQUEUE INTENT
 * ============================================
 */
export async function enqueueIntent(intent: Intent) {
  await intentQueue.add("execute", intent, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false, // DLQ handles final failure
  });
}

/**
 * ============================================
 * INTENT WORKER
 * ============================================
 */
export function startIntentWorker() {
  const worker = new Worker<Intent>(
    "intent_queue",
    async (job: Job<Intent>) => {
      const intent = job.data;

      switch (intent.target) {
        case "notification":
          return handleNotificationIntent(intent as NotifyIntent);

        case "device":
          return handleDeviceIntent(intent as DeviceCommandIntent);

        default:
          throw new Error(`Unhandled intent target: ${intent.target}`);
      }
    },
    { connection }
  );

  /**
   * ============================================
   * DLQ HANDOFF (FINAL FAILURE ONLY)
   * ============================================
   */
  worker.on("failed", async (job) => {
    if (!job) return;

    const maxAttempts = job.opts.attempts ?? 1;

    if (job.attemptsMade >= maxAttempts) {
      await intentDlqQueue.add("dlq", job.data, {
        removeOnComplete: true,
      });
    }
  });

  worker.on("completed", (job) => {
    console.log("✅ Intent processed:", job.id);
  });

  worker.on("error", (err) => {
    console.error("❌ Intent worker error:", err.message);
  });

  return worker;
}

/**
 * ============================================
 * INTENT HANDLERS
 * ============================================
 */
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
      throw new Error(`Unhandled notification scope: ${scope}`);
  }
}

async function handleDeviceIntent(intent: DeviceCommandIntent) {
  const topic = `ochiga/device/${intent.deviceId}/set`;
  return publishDeviceAction(topic, intent.command);
}
