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

export function buildSecurityIncidentsAnswer(facts: IntelligenceFact[]) {
  if (facts.some((fact) => fact.truth_state === "unavailable")) {
    return "Security incident evidence is unavailable right now. I did not treat that as no incidents.";
  }
  if (!facts.length) return "I do not see any security incidents for this scope.";
  const unresolved = facts.filter((fact) => {
    const status = text(recordOf(fact.value).status).toLowerCase();
    return status !== "resolved" && status !== "closed";
  });
  const latest = facts[0];
  const latestValue = recordOf(latest.value);
  const latestLine = `Most recent: ${text(latestValue.title)} (${text(latestValue.severity)} severity, ${text(latestValue.status)}).`;
  return `${facts.length} security incident${facts.length === 1 ? "" : "s"} on record, ${unresolved.length} unresolved. ${latestLine}`;
}

function naturalizeUserCopy(value: string) {
  return value
    .replace(/\bentity\b/gi, "record")
    .replace(/\btool\b/gi, "action")
    .replace(/\bworkflow\b/gi, "request")
    .replace(/\s+/g, " ")
    .trim();
}

export function securityObjectProfile(objectType: OperationalObjectType): { role: string; diagnostics: string[]; actions: string[] } {
  if (objectType === "access_point") {
    return {
      role: "I track this access point's location, protected area, activity, cameras, and security state.",
      diagnostics: ["access state", "protected area", "recent activity", "linked cameras"],
      actions: ["show access history", "check camera", "review security"],
    };
  }
  if (objectType === "camera") {
    return {
      role: "I can use this camera's health and event evidence for security context, without exposing private streams here.",
      diagnostics: ["live state", "motion events", "connection", "coverage"],
      actions: ["show events", "check connection", "review incident"],
    };
  }
  return {
    role: "I track this incident's cause, affected objects, recovery, and recommended action.",
    diagnostics: ["cause", "duration", "affected objects", "recovery"],
    actions: ["show evidence", "show affected", "review recovery"],
  };
}

export function securityObjectVoice(objectType: OperationalObjectType) {
  if (objectType === "camera") {
    return {
      healthy: "The camera record is available.",
      unavailable: "I can't verify the camera right now.",
      next: "Would you like recent events or a connection check?",
    };
  }
  if (objectType === "access_point") {
    return {
      healthy: "No unusual access-point activity is visible.",
      unavailable: "I can't verify the access point right now.",
      next: "Would you like access history or linked camera evidence?",
    };
  }
  return {
    healthy: "No unresolved security incident is visible.",
    unavailable: "I can't verify the incident right now.",
    next: "Would you like evidence, affected objects, or recovery status?",
  };
}

export function securityRecommendation(object: OperationalObject) {
  if (object.object_type === "camera") return "I recommend reviewing event evidence before opening a live view.";
  if (object.object_type === "access_point") return "I recommend reviewing access history with linked camera evidence where authorized.";
  return "I recommend reviewing evidence and recovery status before closing this incident.";
}

export function securityConfirmationReply(object: OperationalObject, response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const confirmations = Array.isArray(response.confirmations) ? response.confirmations.map(recordOf) : [];
  const pending = confirmations[0] || recordOf((Array.isArray(execution.results) ? execution.results : []).map(recordOf).find((row) => row.status === "pending_confirmation"));
  const summary = text(pending.summary || pending.title || execution.summary || response.understood);
  return summary
    ? `${naturalizeUserCopy(summary)} Should I continue with this security action?`
    : `This changes security handling for ${object.label}. Should I continue?`;
}

export function securityContextualActions(object: OperationalObject) {
  const action = (label: string, prompt: string, risk = "read") => ({
    label,
    prompt,
    risk,
    operational_object: {
      object_type: object.object_type as OperationalObjectType,
      canonical_id: object.canonical_id,
    },
  });
  if (object.object_type === "camera") {
    return [
      action("Live State", "Is this camera working?"),
      action("Events", "Show recent events"),
      action("Diagnose", "Check connection"),
    ];
  }
  if (object.object_type === "access_point") {
    return [
      action("Access History", "Show access history"),
      action("Linked Cameras", "Show linked cameras"),
      action("Review Security", "Review security"),
    ];
  }
  return [
    action("Evidence", "Show evidence"),
    action("Affected Objects", "Show affected objects"),
    action("Recovery", "Was it resolved?"),
    action("Escalate", "Escalate this issue", "approval"),
  ];
}
