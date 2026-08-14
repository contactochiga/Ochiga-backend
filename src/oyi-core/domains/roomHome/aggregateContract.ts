import type { IntelligenceFact } from "../../contracts/canonicalConversation";
import type { ContributorSeverity, ContributorSummary } from "../contributorSummary";

export type AggregateOverallState = "stable" | "attention_needed" | "warning" | "critical" | "partial";

export type AggregateOperation = "status" | "attention" | "activity" | "summary";

export type AggregateObjectRef = {
  object_type: string;
  canonical_id: string;
  label: string;
  domain: string;
};

export type AttentionItem = {
  domain: string;
  severity: ContributorSeverity;
  summary: string;
  object_ref: AggregateObjectRef | null;
  dedup_key: string;
};

export type CoverageSummary = {
  requested: number;
  answered: number;
  empty: number;
  degraded: number;
  unavailable: number;
};

export type AggregateResult = {
  scope_type: "home" | "room";
  scope_ref: { estate_id: string | null; home_id: string | null; room_id: string | null; label: string };
  operation: AggregateOperation;
  status: "answered" | "partial" | "unavailable";
  coverage: CoverageSummary;
  contributors: ContributorSummary[];
  attention_items: AttentionItem[];
  facts: IntelligenceFact[];
  object_refs: AggregateObjectRef[];
  overall_severity: ContributorSeverity;
  overall_state: AggregateOverallState;
  summary: string;
};

const SEVERITY_RANK: Record<ContributorSeverity, number> = { none: 0, info: 1, attention: 2, warning: 3, critical: 4 };

export function maxSeverity(values: ContributorSeverity[]): ContributorSeverity {
  let winner: ContributorSeverity = "none";
  for (const value of values) {
    if (SEVERITY_RANK[value] > SEVERITY_RANK[winner]) winner = value;
  }
  return winner;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

// A single underlying object should not generate more than one attention
// item just because two contributors both happened to surface it — collapse
// by (object_type, canonical_id), keeping the highest-severity entry. Two
// genuinely different objects are never collapsed, even in the same domain.
export function dedupeAttentionItems(items: AttentionItem[]): AttentionItem[] {
  const byKey = new Map<string, AttentionItem>();
  for (const item of items) {
    const existing = byKey.get(item.dedup_key);
    if (!existing || SEVERITY_RANK[item.severity] > SEVERITY_RANK[existing.severity]) {
      byKey.set(item.dedup_key, item);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

export function attentionItemsFromContributor(contributor: ContributorSummary): AttentionItem[] {
  return contributor.attention_items.map((fact) => ({
    domain: contributor.domain,
    severity: contributor.severity,
    summary: text(fact.statement) || contributor.summary,
    object_ref: fact.object ? { object_type: fact.object.object_type, canonical_id: fact.object.canonical_id, label: fact.object.label, domain: contributor.domain } : null,
    dedup_key: fact.object ? `${fact.object.object_type}:${fact.object.canonical_id}` : `${contributor.domain}:${fact.fact_id}`,
  }));
}

export function coverageFromContributors(contributors: ContributorSummary[]): CoverageSummary {
  const coverage: CoverageSummary = { requested: contributors.length, answered: 0, empty: 0, degraded: 0, unavailable: 0 };
  for (const contributor of contributors) {
    if (contributor.status === "answered" || contributor.status === "stale") coverage.answered += 1;
    else if (contributor.status === "empty") coverage.empty += 1;
    else if (contributor.status === "permission_restricted" || contributor.status === "unsupported") coverage.degraded += 1;
    else coverage.unavailable += 1;
  }
  return coverage;
}

// "Partial" represents an honest coverage gap, not a real finding — it only
// applies when nothing alarming was found in what COULD be checked, per
// §11/§37: never say "everything is fine" when some domain went unchecked.
// A genuine critical/warning finding always wins, even alongside a coverage
// gap (the gap still shows up in the summary text, just not the state).
export function overallStateFor(overallSeverity: ContributorSeverity, coverage: CoverageSummary): AggregateOverallState {
  if (overallSeverity === "critical") return "critical";
  if (overallSeverity === "warning") return "warning";
  if (overallSeverity === "attention") return "attention_needed";
  if (coverage.degraded + coverage.unavailable > 0) return "partial";
  return "stable";
}

export function objectRefsFromContributors(contributors: ContributorSummary[]): AggregateObjectRef[] {
  const refs: AggregateObjectRef[] = [];
  for (const contributor of contributors) {
    for (const ref of contributor.object_refs) {
      refs.push({ ...ref, domain: contributor.domain });
    }
  }
  return refs;
}

export function factsFromContributors(contributors: ContributorSummary[]): IntelligenceFact[] {
  return contributors.flatMap((contributor) => contributor.facts);
}

const DOMAIN_LABELS: Record<string, string> = {
  devices: "device",
  maintenance: "maintenance",
  visitors: "visitor",
  security: "security",
  utilities: "utility",
  wallet: "wallet",
  services: "service",
  community: "community",
  scenes: "scene",
  automations: "automation",
};

export function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] || domain;
}

export function coverageGapClause(contributors: ContributorSummary[]): string | null {
  const gaps = contributors.filter((c) => c.status === "unavailable" || c.status === "permission_restricted" || c.status === "unsupported");
  if (!gaps.length) return null;
  const names = gaps.map((c) => domainLabel(c.domain)).join(", ");
  return gaps.length === 1
    ? `I could not confirm current ${names} data.`
    : `I could not confirm current ${names} data.`;
}
