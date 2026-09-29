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

// Canonical terminal outcomes are not legacy-chat fallbacks.  Keep the old
// counter for dashboards that still read it, but give new telemetry a truthful
// vocabulary that describes the actual Core decision.
export function incrementCanonicalConversationOutcome(outcome: string, reason: string, domain: string | null, operation: string | null) {
  operationalMetrics.increment("oyi_conversation_terminal_outcome_total", {
    outcome,
    reason,
    domain: domain || "unknown",
    operation: operation || "unknown",
  });
}
