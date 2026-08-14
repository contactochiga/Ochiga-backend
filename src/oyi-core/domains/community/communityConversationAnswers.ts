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

// Facts arrive official-first (see loadCommunityPostFacts) — this only
// presents that ordering, it does not re-rank.
export function buildCommunityLatestAnswer(facts: IntelligenceFact[]) {
  if (facts.some((fact) => fact.truth_state === "unavailable")) {
    return "Community updates are unavailable right now. I did not treat that as no announcements.";
  }
  if (!facts.length) return "I do not see any community updates for this estate.";
  const official = facts.filter((fact) => Boolean(recordOf(fact.value).is_official));
  if (!official.length) return `I see ${facts.length} community post${facts.length === 1 ? "" : "s"}, but nothing from management or an official category recently.`;
  const lines = official.slice(0, 3).map((fact) => text(recordOf(fact.value).title)).filter(Boolean);
  return `${official.length} official update${official.length === 1 ? "" : "s"} recently: ${lines.join("; ")}.`;
}

function naturalizeUserCopy(value: string) {
  return value
    .replace(/\bentity\b/gi, "record")
    .replace(/\btool\b/gi, "action")
    .replace(/\bworkflow\b/gi, "request")
    .replace(/\s+/g, " ")
    .trim();
}

export function communityObjectProfile(objectType: OperationalObjectType): { role: string; diagnostics: string[]; actions: string[] } {
  if (objectType === "message_thread") {
    return {
      role: "I track this community or direct message thread as an operational communication target, separate from Oyi conversation history.",
      diagnostics: ["participants", "latest message", "read state", "linked records"],
      actions: ["summarize", "draft reply", "open thread"],
    };
  }
  return {
    role: "I track this community item, audience, responses, and follow-up state.",
    diagnostics: ["audience", "responses", "status"],
    actions: ["summarize", "draft reply", "review activity"],
  };
}

export function communityObjectVoice(objectType: OperationalObjectType) {
  if (objectType === "message_thread") {
    return {
      healthy: "The message thread record is available.",
      unavailable: "I can't verify this message thread right now.",
      next: "Would you like a summary, unread status, or a drafted reply?",
    };
  }
  return {
    healthy: "The community item is available.",
    unavailable: "I can't verify this community item right now.",
    next: "Would you like a summary, recent replies, or to open Community?",
  };
}

export function communityRecommendation(object: OperationalObject) {
  if (object.object_type === "message_thread") return "I recommend summarizing the latest message before drafting a reply.";
  return "I recommend reviewing the latest replies before drafting a community response.";
}

export function communityConfirmationReply(object: OperationalObject, response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const confirmations = Array.isArray(response.confirmations) ? response.confirmations.map(recordOf) : [];
  const pending = confirmations[0] || recordOf((Array.isArray(execution.results) ? execution.results : []).map(recordOf).find((row) => row.status === "pending_confirmation"));
  const summary = text(pending.summary || pending.title || execution.summary || response.understood);
  return summary
    ? `${naturalizeUserCopy(summary)} Should I continue with this message draft?`
    : `This prepares a communication for ${object.label}. Should I continue?`;
}

export function communityContextualActions(object: OperationalObject) {
  const action = (label: string, prompt: string, risk = "read") => ({
    label,
    prompt,
    risk,
    operational_object: {
      object_type: object.object_type as OperationalObjectType,
      canonical_id: object.canonical_id,
    },
  });
  if (object.object_type === "message_thread") {
    return [
      action("Summarize", "Summarize this thread"),
      action("Unread", "Do I have unread messages here?"),
      action("Draft Reply", "Draft a reply", "approval"),
      action("Open", "Open this message thread"),
    ];
  }
  return [
    action("Summarize", "Summarize this community post"),
    action("Replies", "Show recent replies"),
    action("Draft Reply", "Draft a reply", "approval"),
    action("Open", "Open Community"),
  ];
}

export function buildCommunityReadAnswer(records: Array<Record<string, unknown>>, options: { domain: "community" | "messages"; broad: boolean }) {
  const label = options.domain === "messages" ? "messages" : "community updates";
  if (!records.length) {
    return options.domain === "messages"
      ? "I do not see any authorized message threads in the current context."
      : "I do not see any authorized community updates in the current context.";
  }
  const unread = records.filter((record) => Boolean(record.unread)).length;
  const lines = records
    .slice(0, 3)
    .map((record) => {
      const title = text(record.title || record.sender || record.id) || (options.domain === "messages" ? "Message thread" : "Community update");
      const preview = text(record.preview);
      return preview ? `${title}: ${preview}` : title;
    });
  const prefix = unread
    ? `I found ${records.length} authorized ${label}, including ${unread} unread.`
    : `I found ${records.length} authorized ${label}.`;
  return `${prefix} ${lines.join(" ")}`.trim();
}
