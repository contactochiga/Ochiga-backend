// src/workers/intentDlqWorker.ts

import { Worker, Queue, Job } from "bullmq";
import IORedis from "ioredis";

import { Intent } from "../core/control-plane/contracts/intent.types";
import { supabaseAdmin } from "../supabase/supabaseClient";

// ------------------------------------
// Redis connection
// ------------------------------------
const connection = new IORedis(process.env.REDIS_URL!);

// ------------------------------------
// DLQ Queue
// ------------------------------------
export const intentDlqQueue = new Queue<Intent>("intents:dlq", {
  connection,
});

// ------------------------------------
// DLQ Worker
// ------------------------------------
export function startIntentDlqWorker() {
  return new Worker<Intent>(
    "intents:dlq",
    async (job: Job<Intent>) => {
      const intent = job.data;

      console.error("🧨 INTENT MOVED TO DLQ", {
        intent,
        reason: job.failedReason,
        attempts: job.attemptsMade,
      });

      // 1️⃣ Persist failed intent for audit & replay
      await supabaseAdmin.from("failed_intents").insert({
        intent,
        reason: job.failedReason,
        attempts: job.attemptsMade,
        failed_at: new Date().toISOString(),
      });

      // 2️⃣ (Optional) Notify ops / admins
      // await notifyOpsTeam(intent);

      return true;
    },
    { connection }
  );
}
