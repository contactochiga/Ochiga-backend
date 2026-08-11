import type {
  OperationalObject,
  OperationalObjectType,
} from "../../runtime/canonicalConversationRuntime";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function naturalizeUserCopy(value: string) {
  return value
    .replace(/\bentity\b/gi, "record")
    .replace(/\btool\b/gi, "action")
    .replace(/\bworkflow\b/gi, "request")
    .replace(/\s+/g, " ")
    .trim();
}

export function maintenanceObjectProfile(): { role: string; diagnostics: string[]; actions: string[] } {
  return {
    role: "I track this maintenance request through issue, assignee, delay, escalation, and closure.",
    diagnostics: ["status", "assignee", "delay", "related incidents"],
    actions: ["assign", "escalate", "review history", "close"],
  };
}

export function maintenanceObjectVoice() {
  return {
    healthy: "The request is still trackable.",
    unavailable: "I can’t verify the maintenance record right now.",
    next: "Would you like the assignee, history, or escalation options?",
  };
}

export function maintenanceRecommendation() {
  return "I recommend checking the assignee and escalation path next.";
}

export function maintenanceConfirmationReply(object: OperationalObject, response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const confirmations = Array.isArray(response.confirmations) ? response.confirmations.map(recordOf) : [];
  const pending = confirmations[0] || recordOf((Array.isArray(execution.results) ? execution.results : []).map(recordOf).find((row) => row.status === "pending_confirmation"));
  const summary = text(pending.summary || pending.title || execution.summary || response.understood);
  return summary
    ? `${naturalizeUserCopy(summary)} Should I update this request?`
    : `This will update ${object.label}. Should I continue?`;
}

export function maintenanceLinkedIssueSummary(object: OperationalObject, unresolvedCount: number) {
  if (unresolvedCount) return `${unresolvedCount} unresolved ${unresolvedCount === 1 ? "maintenance item is" : "maintenance items are"} linked to ${object.label}.`;
  return `I don’t see unresolved maintenance linked to ${object.label}.`;
}

export function maintenanceContextualActions(object: OperationalObject) {
  const action = (label: string, prompt: string, risk = "read") => ({
    label,
    prompt,
    risk,
    operational_object: {
      object_type: object.object_type as OperationalObjectType,
      canonical_id: object.canonical_id,
    },
  });
  return [
    action("Status", "Why is this delayed?"),
    action("Assignee", "Who is handling it?"),
    action("Escalate", "Escalate it", "approval"),
    action("History", "Show history"),
  ];
}
