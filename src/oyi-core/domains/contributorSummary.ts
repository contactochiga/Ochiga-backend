import type { IntelligenceFact } from "../contracts/canonicalConversation";

// Aligned with CanonicalTruth.severity's already-established 5-level scale
// (canonicalConversationTruth.ts / objectFallbackPresentation.ts) rather
// than inventing a second scale — "none" is this contract's own addition
// for "nothing to report", everything else maps 1:1 onto the existing
// canonical vocabulary.
export type ContributorSeverity = "none" | "info" | "attention" | "warning" | "critical";

export type ContributorStatus = "answered" | "empty" | "unavailable" | "permission_restricted" | "unsupported" | "stale";

export type FreshnessBucket = "fresh" | "recent" | "stale" | "historical" | "unknown" | "unavailable";

export type Coverage = "full" | "partial" | "none";

export type SourceHealth = "healthy" | "degraded" | "unavailable";

export type ContributorSummary = {
  domain: string;
  status: ContributorStatus;
  summary: string;
  facts: IntelligenceFact[];
  attention_items: IntelligenceFact[];
  severity: ContributorSeverity;
  freshness: FreshnessBucket;
  object_refs: Array<{ object_type: string; canonical_id: string; label: string }>;
  coverage: Coverage;
  source_health: SourceHealth;
};

// Per-domain freshness expectations — a device being 2 hours stale is
// meaningfully different from a maintenance request being 2 hours old.
// Domains not listed use DEFAULT_FRESHNESS_POLICY. Values are the boundary
// in minutes/hours before a fact moves from fresh->recent->stale.
const DOMAIN_FRESHNESS_POLICY: Record<string, { freshMinutes: number; recentHours: number }> = {
  devices: { freshMinutes: 15, recentHours: 6 },
  security: { freshMinutes: 60, recentHours: 24 },
  automations: { freshMinutes: 60, recentHours: 24 },
  maintenance: { freshMinutes: 24 * 60, recentHours: 24 * 7 },
  visitors: { freshMinutes: 24 * 60, recentHours: 24 * 7 },
  scenes: { freshMinutes: 24 * 60, recentHours: 24 * 7 },
  community: { freshMinutes: 24 * 60, recentHours: 24 * 7 },
  utilities: { freshMinutes: 24 * 60, recentHours: 24 * 7 },
  services: { freshMinutes: 24 * 60, recentHours: 24 * 7 },
};
const DEFAULT_FRESHNESS_POLICY = { freshMinutes: 60, recentHours: 24 };

function text(value: unknown) {
  return String(value ?? "").trim();
}

// Wallet facts (and any other inherently-historical record) are legitimately
// "historical" forever — they are not stale, they are a ledger entry.
const HISTORICAL_DOMAINS = new Set(["wallet"]);

export function classifyFreshness(domain: string, rawFreshness: unknown, now: number): FreshnessBucket {
  const raw = text(rawFreshness).toLowerCase();
  if (!raw) return "unknown";
  if (raw === "unavailable") return "unavailable";
  if (raw === "unknown") return "unknown";
  if (raw === "historical" || HISTORICAL_DOMAINS.has(domain)) return "historical";
  const parsed = new Date(text(rawFreshness));
  if (Number.isNaN(parsed.getTime())) return "unknown";
  const ageMs = now - parsed.getTime();
  if (ageMs < 0) return "fresh";
  const policy = DOMAIN_FRESHNESS_POLICY[domain] || DEFAULT_FRESHNESS_POLICY;
  if (ageMs <= policy.freshMinutes * 60_000) return "fresh";
  if (ageMs <= policy.recentHours * 3_600_000) return "recent";
  return "stale";
}

function coverageForStatus(status: ContributorStatus): Coverage {
  if (status === "answered" || status === "empty") return "full";
  if (status === "stale") return "partial";
  return "none";
}

function sourceHealthForStatus(status: ContributorStatus): SourceHealth {
  if (status === "answered" || status === "empty" || status === "stale") return "healthy";
  if (status === "permission_restricted" || status === "unsupported") return "degraded";
  return "unavailable";
}

// Used when a contributor's own loader throws (network/DB failure) rather
// than returning a normal unavailable-fact sentinel — the aggregator must
// isolate this per §31 ("domain failures must be isolated") rather than let
// one contributor's exception fail the whole Room/Home answer.
export function unavailableContributorSummary(domain: string, reason: string): ContributorSummary {
  return {
    domain,
    status: "unavailable",
    summary: `${domain} evidence is unavailable right now.`,
    facts: [],
    attention_items: [],
    severity: "none",
    freshness: "unavailable",
    object_refs: [],
    coverage: "none",
    source_health: "unavailable",
  };
}

// Domain-agnostic shape used by Room/Home contributor aggregation (see
// src/oyi-core/domains/roomHome/). Any mature domain's already-loaded facts
// are converted here without re-querying source tables — this function
// never talks to a database itself.
export function buildContributorSummary(input: {
  domain: string;
  facts: IntelligenceFact[];
  summary: string;
  status?: ContributorStatus;
  isAttention?: (fact: IntelligenceFact) => boolean;
  severityFor?: (attentionItems: IntelligenceFact[], facts: IntelligenceFact[]) => ContributorSeverity;
  now?: number;
}): ContributorSummary {
  const { domain, facts, summary, isAttention, severityFor } = input;
  const now = input.now ?? Date.now();
  if (input.status === "permission_restricted" || input.status === "unsupported") {
    const status = input.status;
    return {
      domain,
      status,
      summary,
      facts: [],
      attention_items: [],
      severity: "none",
      freshness: "unavailable",
      object_refs: [],
      coverage: coverageForStatus(status),
      source_health: sourceHealthForStatus(status),
    };
  }
  if (facts.some((fact) => fact.truth_state === "unavailable")) {
    const status: ContributorStatus = "unavailable";
    return {
      domain,
      status,
      summary: `${domain} evidence is unavailable right now.`,
      facts: [],
      attention_items: [],
      severity: "none",
      freshness: "unavailable",
      object_refs: [],
      coverage: coverageForStatus(status),
      source_health: sourceHealthForStatus(status),
    };
  }
  const attention_items = isAttention ? facts.filter(isAttention) : [];
  const severity = severityFor ? severityFor(attention_items, facts) : (attention_items.length ? "warning" : "none");
  const freshness = classifyFreshness(domain, facts[0]?.freshness, now);
  const status: ContributorStatus = freshness === "stale" && facts.length ? "stale" : facts.length ? "answered" : "empty";
  const object_refs = facts
    .filter((fact) => fact.object)
    .slice(0, 10)
    .map((fact) => ({ object_type: fact.object!.object_type, canonical_id: fact.object!.canonical_id, label: fact.object!.label }));
  return {
    domain,
    status,
    summary,
    facts,
    attention_items,
    severity,
    freshness,
    object_refs,
    coverage: coverageForStatus(status),
    source_health: sourceHealthForStatus(status),
  };
}
