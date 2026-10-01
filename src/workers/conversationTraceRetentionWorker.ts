// Intelligence System Visibility, Slice 7 -- trace retention job.
// Same pattern as cameraMediaRetentionWorker: worker process only,
// env kill switch (OYI_TRACE_RETENTION_ENABLED=false), interval
// OYI_TRACE_RETENTION_INTERVAL_MS (default hourly, minimum 60s), one
// bounded batch per run, failures logged as structured events.
import { cleanupExpiredConversationTraces } from "../oyi-core/observability/conversationTraceRetention";
import { operationalMetrics } from "../observability/metrics";

let timer: NodeJS.Timeout | null = null;

export function startConversationTraceRetentionWorker() {
  if (timer || process.env.OYI_TRACE_RETENTION_ENABLED === "false") return;
  const run = () =>
    cleanupExpiredConversationTraces()
      .then(({ deleted }) => operationalMetrics.increment("oyi_conversation_trace_retention_deleted_total", {}, deleted))
      .catch((error) => {
        operationalMetrics.increment("oyi_conversation_trace_retention_failures_total", {});
        console.error(JSON.stringify({ event: "conversation_trace_retention.failed", code: typeof error?.code === "string" ? error.code : "trace_store_unavailable" }));
      });
  void run();
  timer = setInterval(run, Math.max(60000, Number(process.env.OYI_TRACE_RETENTION_INTERVAL_MS || 3600000)));
  timer.unref();
}

export function stopConversationTraceRetentionWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
