// src/workers/intentWorker.ts

import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";

import { Intent } from "../core/control-plane/contracts/intent.types";
import { NotificationService } from "../services/NotificationService";
import { publishDeviceAction } from "../device/bridge";

const connection = new IORedis(process.env.REDIS_URL!);

export const intentQueue = new Queue<Intent>("intents", {
  connection,
});

/**
 * Enqueue an Intent for execution
 */
export async function enqueueIntent(intent: Intent) {
  await intentQueue.add("execute", intent, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false, // keep failed jobs for DLQ inspection
  });
}

/**
 * Start Intent Worker (Execution Plane)
 */
export function startIntentWorker() {
  return new Worker<Intent>(
    "intents",
    async (job) => {
      const intent = job.data;

      switch (intent.target) {
        case "notification": {
          // scope routing handled by NotificationService
          return NotificationService.sendToHome(
            intent.referenceId,
            intent.payload
          );
        }

        case "device": {
          return publishDeviceAction(
            `ochiga/device/${intent.deviceId}/set`,
            intent.command
          );
        }

        default: {
          // Exhaustiveness guard (future-proof)
          const _exhaustive: never = intent;
          throw new Error(`Unhandled intent target`);
        }
      }
    },
    { connection }
  );
}
