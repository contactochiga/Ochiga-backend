import type { OyiTarget } from "../../types/oisContext";
import type { CanonicalTruth, OperationalObject } from "../contracts/canonicalConversation";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanLabel(value: unknown, fallback: string) {
  const next = text(value);
  return next || fallback;
}

function severityFor(value: unknown): CanonicalTruth["severity"] {
  const raw = text(value).toLowerCase();
  if (raw === "critical") return "critical";
  if (raw === "warning") return "warning";
  if (raw === "attention") return "attention";
  if (raw === "info") return "info";
  return "normal";
}

export function truthStateFromCompatibility(response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const status = text(execution.status).toLowerCase();
  if (status === "pending_confirmation") return "pending_confirmation" as const;
  if (status === "permission_denied" || status === "denied") return "permission_restricted" as const;
  if (status === "unsupported" || status === "validation_required") return "unsupported" as const;
  if (status === "failed") return "observed" as const;
  if (status === "executed" || status === "processed") return "confirmed" as const;
  if (response.awareness && severityFor(recordOf(response.awareness).severity) !== "normal") return "observed" as const;
  if (Array.isArray(response.sources) && response.sources.length) return "observed" as const;
  return "inferred" as const;
}

export function canonicalTruthFor(response: Record<string, unknown>, operationalObject: OperationalObject | null): CanonicalTruth {
  const awareness = recordOf(response.awareness);
  const execution = recordOf(response.execution);
  const title = cleanLabel(
    awareness.headline || response.understood || operationalObject?.label || response.intent,
    "Oyi update",
  );
  const body = cleanLabel(response.reply || response.message, "Oyi reviewed the current operational context.");
  return {
    title,
    body,
    truth_state: truthStateFromCompatibility(response),
    severity: severityFor(awareness.severity || execution.status),
    source_event: text(recordOf(response.execution).providerEventId || recordOf(response.execution).provider_event_id) || null,
    confidence: typeof response.confidence === "number" ? Number(response.confidence) : null,
    object: operationalObject,
    occurred_at: text(awareness.generated_at) || null,
    freshness: text(awareness.generated_at) || operationalObject?.freshness || null,
    recommended_actions: Array.isArray(response.suggested_actions) ? response.suggested_actions as Array<Record<string, unknown>> : [],
    active_execution: Object.keys(execution).length ? execution : null,
    target: recordOf(response.target) as OyiTarget | null,
    technical_details: {
      intent: response.intent || null,
      display_mode: response.display_mode || null,
      execution_status: execution.status || null,
    },
  };
}
