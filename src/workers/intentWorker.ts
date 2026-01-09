// src/workers/intentWorker.ts

import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";

import {
  Intent,
  NotifyIntent,
  DeviceCommandIntent,
} from "../core/control-plane/contracts/intent.types";

import { NotificationService } from "../services/NotificationService";
import { publishDeviceAction } from "../device/bridge";

// ------------------------------------
// Redis connection (Execution Plane)
// ------------------------------------
const connection = new IORedis(process.env.REDIS_URL!);

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
  await intentQueue.add("execute", intent, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false, // DLQ-ready
  });
}

// ------------------------------------
// Intent Worker
// ------------------------------------
export function startIntentWorker() {
  return new Worker<Intent>(
    "intents",
    async (job) => {
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
}

// ------------------------------------
// Handlers
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
      return NotificationService.sendToRegion(referenceId, payload);

    default: {
      const _never: never = scope;
      throw new Error("Unhandled notification scope");
    }
  }
}

async function handleDeviceIntent(intent: DeviceCommandIntent) {
  const topic = `ochiga/device/${intent.deviceId}/set`;
  return publishDeviceAction(topic, intent.command);
}
