// src/workers/intentDlqWorker.ts
import { Worker, Queue, Job } from "bullmq";
import { Intent } from "../core/control-plane/contracts/intent.types";
import { supabaseAdmin } from "../supabase/supabaseClient";

// ------------------------------------
// Redis connection (BullMQ SAFE)
// ------------------------------------
const connection = {
  url: process.env.REDIS_URL!,
};

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

      await supabaseAdmin.from("failed_intents").insert({
        intent,
        reason: job.failedReason,
        attempts: job.attemptsMade,
        failed_at: new Date().toISOString(),
      });

      return true;
    },
    { connection }
  );
}
