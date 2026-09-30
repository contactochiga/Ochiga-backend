// Wave 9 Slice 1 -- the ONE Core knowledge retrieval contract (Section 11).
// Facility, Consumer, Oma, Osa, Executive are agent-AWARE callers of this
// single service, never separate omaKnowledgeService-style silos
// (Section 12/43).
import { logger } from "../../../observability/logger";
import { operationalMetrics } from "../../../observability/metrics";
import { authorityRank, type KnowledgeAgentRole, type KnowledgeAudience, type KnowledgeAuthorityClass, type KnowledgeItem, type RankedKnowledgeItem, type RetrieveKnowledgeRequest, type RetrieveKnowledgeResult } from "./knowledgeContracts";
import { buildKnowledgeIndex, type KnowledgeIndexSnapshot } from "./knowledgeIndex";

// Section 17 -- simplest truthful retrieval mechanism justified by the
// corpus's own real size (1,139 lines / 26 items, confirmed by direct read
// during this slice). Structured metadata filtering + lightweight lexical
// scoring; deliberately no embeddings/vector infrastructure (Section 17's
// own explicit instruction not to add them "merely because knowledge base
// sounds like RAG").
const CACHE_TTL_MS = Math.max(30_000, Number(process.env.OYI_KNOWLEDGE_CACHE_TTL_MS || 5 * 60_000));
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;
const CHAR_BUDGET = 6_000; // Section 30 -- a hard ceiling well under any single 27-file corpus dump.

let cached: { snapshot: KnowledgeIndexSnapshot; expiresAt: number } | null = null;

async function getIndex(): Promise<KnowledgeIndexSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  const snapshot = await buildKnowledgeIndex();
  // Section 31 -- a failed fetch is cached only very briefly, so a
  // transient Office outage doesn't wedge the corpus empty for the full TTL.
  const ttl = snapshot.sourceOk ? CACHE_TTL_MS : 15_000;
  cached = { snapshot, expiresAt: Date.now() + ttl };
  if (!snapshot.sourceOk) logger.warn("oyi_knowledge_source_unavailable", { reason: snapshot.sourceReason });
  return snapshot;
}

// Section 13 -- no retrieval result may widen the caller's authority.
const AUDIENCE_CEILING: Record<KnowledgeAudience, number> = { PUBLIC: 0, INTERNAL_COMMERCIAL: 1, INTERNAL_ONLY: 2 };

function audienceAllowed(itemAudience: KnowledgeAudience, callerCeiling: KnowledgeAudience): boolean {
  return AUDIENCE_CEILING[itemAudience] <= AUDIENCE_CEILING[callerCeiling];
}

function agentAllowed(item: KnowledgeItem, agentRole: KnowledgeAgentRole): boolean {
  return item.agentVisibility.includes(agentRole);
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) || [];
}

// Section 18 -- relevance is one input among several, not the sole one.
// Authority and freshness can outweigh a lexical match; a highly relevant
// marketing sentence must not outrank contradictory approved technical
// truth (Section 18/19's own explicit example).
function scoreItem(item: KnowledgeItem, queryTerms: string[], domains: Set<string> | null): { score: number; reason: string } {
  const haystack = tokenize(`${item.title} ${item.tags.join(" ")} ${item.content}`);
  const haystackSet = new Set(haystack);
  const termHits = queryTerms.filter((term) => haystackSet.has(term)).length;
  const lexical = queryTerms.length ? termHits / queryTerms.length : 0;

  const domainMatch = domains && domains.size ? (domains.has(item.domain) ? 1 : 0) : 0.5; // neutral if no domain hint supplied
  // Higher authority = lower rank index = higher weight.
  const authorityWeight = 1 - authorityRank(item.authorityClass) / 8;
  const freshnessWeight = item.freshnessClass === "evergreen" ? 1 : 0.85;

  const score = lexical * 0.45 + domainMatch * 0.25 + authorityWeight * 0.2 + freshnessWeight * 0.1;
  const reasonParts = [`lexical=${lexical.toFixed(2)}`, `domain=${domainMatch.toFixed(2)}`, `authority=${item.authorityClass}`, `freshness=${item.freshnessClass}`];
  return { score, reason: reasonParts.join(",") };
}

// Section 30 -- bounds by BOTH item count and character budget, whichever
// is reached first, so one long item can never silently crowd out the
// count limit's intent.
function boundResults(ranked: RankedKnowledgeItem[], limit: number): { items: RankedKnowledgeItem[]; truncated: boolean } {
  const items: RankedKnowledgeItem[] = [];
  let chars = 0;
  let truncated = false;
  for (const item of ranked) {
    if (items.length >= limit) {
      truncated = true;
      break;
    }
    if (chars + item.content.length > CHAR_BUDGET) {
      truncated = true;
      break;
    }
    items.push(item);
    chars += item.content.length;
  }
  if (!truncated && ranked.length > items.length) truncated = true;
  return { items, truncated };
}

export async function retrieveKnowledge(request: RetrieveKnowledgeRequest): Promise<RetrieveKnowledgeResult> {
  const snapshot = await getIndex();
  const queryTerms = tokenize(request.query);
  const domains = request.domains && request.domains.length ? new Set<string>(request.domains) : null;
  const limit = Math.min(Math.max(1, request.limit || DEFAULT_LIMIT), MAX_LIMIT);

  // Section 13/45 -- authorization filter runs BEFORE ranking, never after
  // (a caller must never even see an out-of-scope item's score/existence).
  // Section 7/33/35's own requirement -- when the caller names explicit
  // domains, that is a HARD filter, not merely a ranking weight: a domain
  // with zero real content (development/private/partnerships today) must
  // return truly empty, never silently backfilled from a higher-lexical-
  // match item in an unrelated domain.
  const eligible = snapshot.items.filter(
    (item) =>
      audienceAllowed(item.audience, request.actor.audienceScope) &&
      agentAllowed(item, request.actor.agentRole) &&
      (!domains || domains.has(item.domain))
  );

  const ranked: RankedKnowledgeItem[] = eligible
    .map((item) => {
      const { score, reason } = scoreItem(item, queryTerms, domains);
      return { ...item, relevanceScore: score, rankReason: reason };
    })
    // Section 19 -- ties broken by authority rank, never left to incidental array order.
    .sort((a, b) => b.relevanceScore - a.relevanceScore || authorityRank(a.authorityClass) - authorityRank(b.authorityClass));

  const { items, truncated } = boundResults(ranked, limit);

  operationalMetrics.increment("oyi_knowledge_retrieval_total", {
    outcome: snapshot.sourceOk ? "ok" : "source_unavailable",
    agent_role: request.actor.agentRole,
    domain: domains ? Array.from(domains)[0] || "none" : "none",
    result_count: String(items.length),
  });

  return {
    items,
    truncated,
    queryEcho: request.query,
    domainsSearched: domains ? (Array.from(domains) as RetrieveKnowledgeResult["domainsSearched"]) : [],
    generatedAt: new Date().toISOString(),
  };
}

// Section 45 security note: this function accepts no file path, no raw
// query string interpreted as a path, and no caller-supplied "authority"
// override -- the only inputs that affect WHICH items are even eligible are
// request.actor (server-computed, never client-supplied raw) and
// request.domains (a closed enum). There is no code path by which a
// request body field can grant access to an item whose own manifest-declared
// audience/agentVisibility would otherwise exclude it.
export function invalidateKnowledgeCache(): void {
  cached = null;
}

// Intelligence System Visibility, Slice 5 -- Governed Knowledge Visibility.
// The browse/list contract the Phase 1 audit found missing: the live
// retrieval paths (retrieveKnowledge above, getKnowledgeItemByCanonicalKey
// below) answer "what
// can THIS actor retrieve for a live conversation," gated by
// audienceAllowed/agentAllowed against one caller's own agentRole/
// audienceScope. This function answers a genuinely different question --
// "what does the governed corpus contain, and what does its own
// governance metadata say" -- for Office's Intelligence page, an
// already-audit.read-permission-gated internal viewer inspecting
// GOVERNANCE LABELS (domain/authorityClass/audience/agentVisibility/
// claimBoundary), not exercising any item's own live retrieval authority.
// Exactly the same "metadata visibility != execution authority"
// principle Slice 1 already established for the capability registry
// (every capability's rollout_status/worker-scoping is inspectable
// regardless of who could actually invoke it) -- not a new bypass, the
// same established one applied to a second governed system. Real
// per-item audience/agentVisibility/claimBoundary/authorityClass values
// are always returned UNCHANGED and UNFILTERED-BY-AUTHORIZATION; the
// filters below are caller-requested narrowing, never a widening of
// what retrieveKnowledge() itself would allow a live caller to use.
export type ListKnowledgeFilters = {
  domains?: KnowledgeItem["domain"][];
  authorityClasses?: KnowledgeAuthorityClass[];
  audiences?: KnowledgeAudience[];
  freshnessClasses?: KnowledgeItem["freshnessClass"][];
  claimBoundaries?: KnowledgeItem["claimBoundary"][];
  agentRoles?: KnowledgeAgentRole[]; // "worker visibility" filter -- items visible to ANY of these roles
};

export type ListKnowledgeResult = {
  items: KnowledgeItem[];
  sourceOk: boolean;
  sourceReason: string | null;
  generatedAt: string;
};

export async function listKnowledgeItems(filters: ListKnowledgeFilters = {}): Promise<ListKnowledgeResult> {
  const snapshot = await getIndex();
  const domains = filters.domains?.length ? new Set(filters.domains) : null;
  const authorityClasses = filters.authorityClasses?.length ? new Set(filters.authorityClasses) : null;
  const audiences = filters.audiences?.length ? new Set(filters.audiences) : null;
  const freshnessClasses = filters.freshnessClasses?.length ? new Set(filters.freshnessClasses) : null;
  const claimBoundaries = filters.claimBoundaries?.length ? new Set(filters.claimBoundaries) : null;
  const agentRoles = filters.agentRoles?.length ? new Set(filters.agentRoles) : null;

  const items = snapshot.items.filter(
    (item) =>
      (!domains || domains.has(item.domain)) &&
      (!authorityClasses || authorityClasses.has(item.authorityClass)) &&
      (!audiences || audiences.has(item.audience)) &&
      (!freshnessClasses || freshnessClasses.has(item.freshnessClass)) &&
      (!claimBoundaries || claimBoundaries.has(item.claimBoundary)) &&
      (!agentRoles || item.agentVisibility.some((role) => agentRoles.has(role)))
  );

  return {
    items: items.slice().sort((a, b) => authorityRank(a.authorityClass) - authorityRank(b.authorityClass) || a.title.localeCompare(b.title)),
    sourceOk: snapshot.sourceOk,
    sourceReason: snapshot.sourceReason,
    generatedAt: snapshot.builtAt,
  };
}

// Same governance-inspection authority as listKnowledgeItems above --
// exact-key lookup over the FULL corpus, no audienceAllowed/agentAllowed
// gate. Distinct from getKnowledgeItemByCanonicalKey() below, which
// keeps its real per-actor gate for genuine conversational retrieval.
export async function getKnowledgeItemForInspection(canonicalKey: string): Promise<KnowledgeItem | null> {
  const snapshot = await getIndex();
  return snapshot.items.find((item) => item.canonicalKey === canonicalKey) || null;
}

// Wave 9 Slice 2 -- a deterministic, exact-key lookup (never ranked/fuzzy),
// added for the ONE narrow case that needs it: a capability module that
// used to hardcode a single fixed institutional fact and now needs that
// EXACT same fact back, not "the best-matching item for a free-text
// query." Still runs through the same authorization gate as
// retrieveKnowledge() (Section 45 -- authorization is never bypassed for
// a "trusted" internal caller); returns null (never throws, never
// fabricates) if the key doesn't exist or the actor isn't allowed to see
// it, so callers can fall back safely (see
// OfficeCorporateCapabilityModules.ts's own fallback-to-literal pattern).
export async function getKnowledgeItemByCanonicalKey(
  canonicalKey: string,
  actor: { agentRole: KnowledgeAgentRole; audienceScope: KnowledgeAudience }
): Promise<KnowledgeItem | null> {
  const snapshot = await getIndex();
  const item = snapshot.items.find((candidate) => candidate.canonicalKey === canonicalKey);
  if (!item) return null;
  if (!audienceAllowed(item.audience, actor.audienceScope) || !agentAllowed(item, actor.agentRole)) return null;
  return item;
}
