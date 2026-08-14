import type { IntelligenceFact } from "../contracts/canonicalConversation";

export type ContributorSeverity = "none" | "info" | "warning" | "critical";

export type ContributorSummary = {
  domain: string;
  status: "answered" | "empty" | "unavailable";
  summary: string;
  facts: IntelligenceFact[];
  attention_items: IntelligenceFact[];
  severity: ContributorSeverity;
  freshness: string;
  object_refs: Array<{ object_type: string; canonical_id: string; label: string }>;
};

// Domain-agnostic shape used by future Home/Room contributor aggregation
// (Phase F/G, not built in this pass). Any mature domain's already-loaded
// facts can be converted here without re-querying source tables.
export function buildContributorSummary(input: {
  domain: string;
  facts: IntelligenceFact[];
  summary: string;
  isAttention?: (fact: IntelligenceFact) => boolean;
  severityFor?: (attentionItems: IntelligenceFact[], facts: IntelligenceFact[]) => ContributorSeverity;
}): ContributorSummary {
  const { domain, facts, summary, isAttention, severityFor } = input;
  if (facts.some((fact) => fact.truth_state === "unavailable")) {
    return {
      domain,
      status: "unavailable",
      summary: `${domain} evidence is unavailable right now.`,
      facts: [],
      attention_items: [],
      severity: "none",
      freshness: "unavailable",
      object_refs: [],
    };
  }
  const attention_items = isAttention ? facts.filter(isAttention) : [];
  const severity = severityFor ? severityFor(attention_items, facts) : (attention_items.length ? "warning" : "none");
  const freshness = facts[0]?.freshness || "unavailable";
  const object_refs = facts
    .filter((fact) => fact.object)
    .slice(0, 10)
    .map((fact) => ({ object_type: fact.object!.object_type, canonical_id: fact.object!.canonical_id, label: fact.object!.label }));
  return {
    domain,
    status: facts.length ? "answered" : "empty",
    summary,
    facts,
    attention_items,
    severity,
    freshness,
    object_refs,
  };
}
