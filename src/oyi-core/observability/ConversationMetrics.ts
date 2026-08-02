import { operationalMetrics } from "../../observability/metrics";

export function observeConversationStage(stage: string, durationMs: number, labels: Record<string, string | null | undefined>) {
  operationalMetrics.observe("oyi_conversation_stage_latency_ms", durationMs, {
    stage,
    domain: labels.domain || "unknown",
    operation: labels.operation || "unknown",
    capability: labels.capability || "unknown",
  });
}

export function incrementLegacyFallback(reason: string, domain: string | null, operation: string | null) {
  operationalMetrics.increment("oyi_conversation_legacy_fallback_total", {
    reason,
    domain: domain || "unknown",
    operation: operation || "unknown",
  });
}
