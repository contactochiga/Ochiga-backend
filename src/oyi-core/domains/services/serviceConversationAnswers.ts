import type {
  IntelligenceFact,
  OperationalObject,
  OperationalObjectType,
} from "../../contracts/canonicalConversation";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function buildServicesActiveAnswer(facts: IntelligenceFact[]) {
  if (!facts.length) return "I do not see any registered services for this scope.";
  const active = facts.filter((fact) => Boolean(recordOf(fact.value).active));
  const requested = facts.filter((fact) => {
    const value = recordOf(fact.value);
    return Boolean(value.enabled) && !value.active && value.account_status !== "unknown";
  });
  const parts = [`${active.length} of ${facts.length} registered services are active`];
  if (requested.length) parts.push(`${requested.length} enabled but not yet linked`);
  return `${parts.join(", ")}.`;
}

function naturalizeUserCopy(value: string) {
  return value
    .replace(/\bentity\b/gi, "record")
    .replace(/\btool\b/gi, "action")
    .replace(/\bworkflow\b/gi, "request")
    .replace(/\s+/g, " ")
    .trim();
}

export function serviceObjectProfile(objectType: OperationalObjectType): { role: string; diagnostics: string[]; actions: string[] } {
  if (objectType === "meter") {
    return {
      role: "I track this meter's service binding, readings, tariff context, and settlement evidence.",
      diagnostics: ["readings", "service", "tariff", "last update"],
      actions: ["show readings", "check service", "review transactions"],
    };
  }
  return {
    role: "I track this service account's provider, tariff, billing, vending readiness, and transactions.",
    diagnostics: ["tariff", "billing", "provider readiness", "transactions"],
    actions: ["check vending", "show tariff", "show transactions", "report issue"],
  };
}

export function serviceObjectVoice() {
  return {
    healthy: "The service record is available.",
    unavailable: "I can't verify this service right now.",
    next: "Would you like tariff, billing, or recent transactions?",
  };
}

export function serviceRecommendation() {
  return "I recommend checking tariff, billing, and vending readiness next.";
}

export function serviceConfirmationReply(object: OperationalObject, response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const confirmations = Array.isArray(response.confirmations) ? response.confirmations.map(recordOf) : [];
  const pending = confirmations[0] || recordOf((Array.isArray(execution.results) ? execution.results : []).map(recordOf).find((row) => row.status === "pending_confirmation"));
  const summary = text(pending.summary || pending.title || execution.summary || response.understood);
  return summary
    ? `${naturalizeUserCopy(summary)} Should I continue with this service request?`
    : `This changes service handling for ${object.label}. Should I continue?`;
}

export function serviceContextualActions(object: OperationalObject) {
  const action = (label: string, prompt: string, risk = "read") => ({
    label,
    prompt,
    risk,
    operational_object: {
      object_type: object.object_type as OperationalObjectType,
      canonical_id: object.canonical_id,
    },
  });
  if (object.object_type === "meter") {
    return [
      action("Readings", "Show readings"),
      action("Service", "Check service"),
      action("Transactions", "Review transactions"),
    ];
  }
  return [
    action("Tariff", "What is my tariff?"),
    action("Vending", "Can I buy electricity?"),
    action("Transactions", "Show the last transaction"),
  ];
}
