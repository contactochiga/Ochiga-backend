// src/workers/intentDlqWorker.ts

import { Worker, Queue, Job } from "bullmq";
import { Intent } from "../core/control-plane/contracts/intent.types";
import { supabaseAdmin } from "../supabase/client";

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
 * DLQ QUEUE
 * ⚠️ NO colon allowed in BullMQ queue names
 * ============================================
 */
export const intentDlqQueue = new Queue<Intent>("intent_dlq", {
  connection,
});

/**
 * ============================================
 * DLQ WORKER
 * ============================================
 */
export function startIntentDlqWorker() {
  const worker = new Worker<Intent>(
    "intent_dlq",
    async (job: Job<Intent>) => {
      const intent = job.data;

      console.error("🧨 INTENT DLQ EVENT", {
        intentId: intent?.id,
        type: intent?.type,
        reason: job.failedReason,
        attempts: job.attemptsMade,
      });

      await supabaseAdmin.from("failed_intents").insert({
        intent,
        reason: job.failedReason || "unknown",
        attempts: job.attemptsMade,
        failed_at: new Date().toISOString(),
      });

      return true;
    },
    { connection }
  );

  worker.on("completed", (job) => {
    console.log("☑️ DLQ job processed:", job.id);
  });

  worker.on("failed", (job, err) => {
    console.error("❌ DLQ worker failed:", job?.id, err.message);
  });

  return worker;
}
