import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { Intent } from "../core/control-plane/intent.types";
import { NotificationService } from "../services/NotificationService";
import { publishDeviceAction } from "../device/bridge";

const connection = new IORedis(process.env.REDIS_URL!);

export const intentQueue = new Queue<Intent>("intents", { connection });

export async function enqueueIntent(intent: Intent) {
  await intentQueue.add("execute", intent, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
}

export function startIntentWorker() {
  return new Worker<Intent>(
    "intents",
    async (job) => {
      const intent = job.data;

      switch (intent.target) {
        case "notification":
          return NotificationService.sendToHome(
            intent.referenceId,
            intent.payload
          );

        case "device":
          return publishDeviceAction(
            `ochiga/device/${intent.deviceId}/set`,
            intent.command
          );

        default:
          throw new Error("Unknown intent target");
      }
    },
    { connection }
  );
}
