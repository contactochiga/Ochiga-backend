import type { IntelligenceFact } from "../contracts/canonicalConversation";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const OPEN_STATUSES = new Set(["open", "unresolved", "pending", "active", "in_progress"]);

// Grounded "why" answer, following the required hierarchy: (1) a
// source-authored reason/error field, (2) a deterministic timeline/state
// fact (opened-but-never-resolved), (3) the bare recorded status, (4) an
// honest "no reason recorded" — never an invented causal story.
export function buildExplainAnswer(fact: IntelligenceFact | null): string {
  if (!fact) return "I could not confirm which item you mean, so I cannot explain it safely.";
  const value = recordOf(fact.value);
  const label = fact.object?.label || "This";
  const explicitReason = text(value.reason || value.failure_reason || value.error_message || value.blocking_reason || value.safe_failure_message);
  if (explicitReason) return `${label}: ${explicitReason}.`;

  const status = text(value.status || value.last_run_status).toLowerCase();
  const openedAt = safeDate(value.opened_at || fact.occurred_at);
  const resolvedAt = safeDate(value.resolved_at || value.closed_at || value.completed_at || value.acknowledged_at);
  if (status === "failed" || status === "error") {
    const errorCode = text(value.error_code);
    return errorCode
      ? `${label} is marked failed with error code ${errorCode}. No further error detail is recorded.`
      : `${label} is marked failed. No further error detail is recorded.`;
  }
  if (OPEN_STATUSES.has(status) && !resolvedAt) {
    return openedAt
      ? `${label} has remained ${status} since ${openedAt.toLocaleDateString()} and no completion or resolution event is recorded.`
      : `${label} is recorded as ${status}, with no resolution event on file.`;
  }
  if (status) return `${label} is recorded as ${status}.`;
  return "I do not have a recorded reason for that — the source data does not include an explanation.";
}

export function buildStatusCheckAnswer(fact: IntelligenceFact | null): string {
  if (!fact) return "I could not confirm which item you mean, so I cannot check its status.";
  const value = recordOf(fact.value);
  const label = fact.object?.label || "That";
  const status = text(value.status || value.last_run_status || value.arrival_status || value.account_status);
  if (!status) return `${label} has no recorded status.`;
  return `${label}: recorded status is ${status}.`;
}

export function buildFieldAnswer(fact: IntelligenceFact | null, field: "who" | "when" | "where" | "amount"): string {
  if (!fact) return "I could not confirm which item you mean.";
  const value = recordOf(fact.value);
  const label = fact.object?.label || "That";
  if (field === "amount") {
    const amount = value.amount ?? value.unit_cost ?? value.balance;
    const currency = text(value.currency) || "NGN";
    return amount !== undefined && amount !== null && Number.isFinite(Number(amount))
      ? `${label}: ${currency} ${Number(amount).toLocaleString()}.`
      : "I do not have a recorded amount for that.";
  }
  if (field === "where") {
    const location = text(value.location || value.room || value.address);
    return location ? `${label}: recorded location is ${location}.` : "I do not have a recorded location for that.";
  }
  if (field === "when") {
    const when = safeDate(fact.occurred_at || value.completed_at || value.opened_at || value.created_at);
    return when ? `${label}: recorded at ${when.toLocaleString()}.` : "I do not have a recorded time for that.";
  }
  const who = text(value.visitor_name || value.assigned_to || value.author || value.reported_by || value.actor || value.provider);
  return who ? `${label}: ${who}.` : "I do not have a recorded person for that.";
}
