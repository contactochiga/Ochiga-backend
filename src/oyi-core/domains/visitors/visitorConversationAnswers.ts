import type {
  OperationalObject,
  OperationalObjectType,
} from "../../contracts/canonicalConversation";
import { redactAccessCredentialForConversation } from "./visitorEvidence";

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

export function visitorObjectProfile(objectType: OperationalObjectType): { role: string; diagnostics: string[]; actions: string[] } {
  if (objectType === "access_pass") {
    return {
      role: "I track this access pass, its holder, validity, usage, and security state.",
      diagnostics: ["validity", "usage", "holder", "security"],
      actions: ["extend", "cancel", "review usage"],
    };
  }
  return {
    role: "I track this visitor's identity, access state, arrival history, and safe approval path.",
    diagnostics: ["identity", "access status", "arrival history", "approval state"],
    actions: ["approve", "extend", "deny", "review history"],
  };
}

export function visitorObjectVoice() {
  return {
    healthy: "No unusual access activity is visible.",
    unavailable: "I can't verify the access record right now.",
    next: "Would you like access history or the current pass status?",
  };
}

export function visitorRecommendation() {
  return "I recommend reviewing access history before making changes.";
}

export function visitorConfirmationReply(object: OperationalObject, response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const confirmations = Array.isArray(response.confirmations) ? response.confirmations.map(recordOf) : [];
  const pending = confirmations[0] || recordOf((Array.isArray(execution.results) ? execution.results : []).map(recordOf).find((row) => row.status === "pending_confirmation"));
  const summary = text(pending.summary || pending.title || execution.summary || response.understood);
  return summary
    ? `${naturalizeUserCopy(summary)} Should I apply that access change?`
    : `This changes access for ${object.label}. Should I continue?`;
}

export function visitorContextualActions(object: OperationalObject) {
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
    action("Status", "Who is this?"),
    action("Approve", "Approve this visitor", "approval"),
    action("Extend", "Extend access by 30 minutes", "approval"),
    action("History", "Has this visitor been here before?"),
  ];
}

export function visitorCredentialSummary(value: unknown) {
  return redactAccessCredentialForConversation(value);
}
