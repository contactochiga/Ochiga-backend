// src/workers/intentDlqWorker.ts

import { Worker, Queue, Job } from "bullmq";
import { Intent } from "../core/control-plane/contracts/intent.types";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { publishSourceIntelligenceEvent } from "../intelligence-core";

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
 * ⚠️ BullMQ queue names MUST NOT contain :
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
        reason: job.failedReason ?? "unknown",
        attempts: job.attemptsMade,
        intent, // log full payload safely
      });

      await supabaseAdmin.from("failed_intents").insert({
        intent, // store full intent object
        reason: job.failedReason ?? "unknown",
        attempts: job.attemptsMade,
        failed_at: new Date().toISOString(),
      });

      void publishSourceIntelligenceEvent({
        source: "edge",
        surface: "api",
        event_type: "execution.failed",
        category: "workflow",
        estate_id: (intent as any)?.context?.estate_id || null,
        entity_type: String((intent as any)?.target || "intent"),
        entity_id: String((job as any)?.id || "") || null,
        entity_label: String((intent as any)?.reason || "Failed intent"),
        severity: "attention",
        title: "Operational execution failed",
        summary: "A queued operational action failed and was sent to the retry queue.",
        payload: { tool: (intent as any)?.target || null, reason: job.failedReason ?? "unknown", attempts: job.attemptsMade, surface: (intent as any)?.surface || null, workflow_id: (intent as any)?.workflow_id || null },
      }, { source_table: "failed_intents", source_event_id: String((job as any)?.id || `${Date.now()}`) });

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
