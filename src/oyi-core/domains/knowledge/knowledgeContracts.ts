// Wave 9 Slice 1 -- Canonical Knowledge Authority & Retrieval Contract.
//
// Semantic boundary (locked, per the Slice 1 task and Slice 0's own audit --
// docs/WAVE9_SLICE0_KNOWLEDGE_MEMORY_CAPABILITY_AUDIT.md):
//   KNOWLEDGE    = durable, approved institutional/domain understanding.
//   MEMORY       = retained context from prior interactions (lead_memories,
//                  resident_memory) -- NOT modeled here, out of Slice 1 scope.
//   LIVE STATE   = authoritative current operational truth (Wave 5/6 device/
//                  camera/maintenance/visitor state, Office CRM truth) -- NOT
//                  modeled here. A KnowledgeItem never answers "is Camera 17
//                  healthy" or "what stage is Opportunity X" -- it may only
//                  explain what those concepts MEAN.
//   CONTEXT      = the caller-supplied request-specific assembly (message,
//                  role, domain hints) used to QUERY this contract -- see
//                  RetrieveKnowledgeRequest.context below.
//   PROMPT       = behavioral/role instruction (e.g. Office's own
//                  agent-voice-and-style.md) -- deliberately excluded from
//                  the retrievable KnowledgeItem corpus (see
//                  officeKnowledgeManifest.ts's own PROMPT_INSTRUCTION class).
//
// Field list deliberately minimal (Section 5's own instruction: "derive the
// minimum from actual source needs, avoid unbounded metadata dumping") --
// every field below exists because a real distinction found in Office's own
// 27-file knowledge pack required it, not because a suggested list mentioned
// it. See docs/WAVE9_SLICE1_CANONICAL_KNOWLEDGE_AUTHORITY.md for the
// per-field justification.

// Section 7 -- bounded domain taxonomy. Deliberately ALIGNED to Backend's
// own existing, real CorporateBusinessUnit enum (contracts/corporateIntelligence.ts)
// for its 5 shared values (corporate/development/technology/private/
// partnerships) rather than inventing a parallel taxonomy -- discovered
// during this slice's own tracing to be the exact enum request.business_unit
// already carries on every live corporate conversation request, making it a
// free, structured domain hint for retrieval (Section 28). Three more
// values (commercial/product/website) are added because the Office pack's
// real content needs them -- CorporateBusinessUnit has no equivalent for
// "how do we sell this" vs "what does this do" vs "what does the public
// website say", which are genuinely different knowledge shapes even within
// one business unit. "development"/"private"/"partnerships" currently have
// ZERO Office-pack content (confirmed by full read of all 27 files during
// this slice) -- kept as real values so retrieval honestly returns "no
// knowledge in this domain" rather than the domain silently not existing.
export type KnowledgeDomain =
  | "corporate"
  | "commercial"
  | "product"
  | "technology"
  | "website"
  | "development"
  | "private"
  | "partnerships";

// Section 6 -- authority taxonomy, derived from evidence in the Office pack
// itself (several files literally self-describe as "code-grounded" or
// "approved," one explicitly as "proposed solution architecture, not a
// blanket claim of production-readiness"). Ordered here from highest to
// lowest authority -- this order is the single source of truth for
// contradiction resolution (Section 19), never re-derived ad hoc elsewhere.
export const KNOWLEDGE_AUTHORITY_RANK = [
  "APPROVED_INSTITUTIONAL",
  "TECHNICAL_SOURCE",
  "APPROVED_COMMERCIAL",
  "PRODUCT_SOURCE",
  "PROJECT_SOURCE",
  "MARKETING_REFERENCE",
  "UNVERIFIED_REFERENCE",
] as const;
export type KnowledgeAuthorityClass = (typeof KNOWLEDGE_AUTHORITY_RANK)[number];

export function authorityRank(authorityClass: KnowledgeAuthorityClass): number {
  return KNOWLEDGE_AUTHORITY_RANK.indexOf(authorityClass);
}

// Section 14 -- public/internal separation. PUBLIC = safe for a caller
// talking directly to an external prospect/visitor to draw on (Oma, the
// public website widget). INTERNAL_COMMERCIAL = may inform an agent's own
// reasoning/strategy but must never be recited verbatim to an external
// party (e.g. exact pricing figures, internal fit-scoring signals,
// negotiation scripts) -- Osa may use it, Oma may not. INTERNAL_ONLY =
// reserved for staff-only material; declared now even though Slice 0 found
// zero current content requiring it (Private/investment knowledge is
// MISSING entirely, per Slice 0 Section 15), so retrieval has a real class
// to assign such content to once it exists, rather than inventing one later
// under pressure.
export type KnowledgeAudience = "PUBLIC" | "INTERNAL_COMMERCIAL" | "INTERNAL_ONLY";

// Section 15 -- explicit claim-boundary field, derived directly from the
// Office pack's own recurring "do not invent / do not quote / route to
// Sales" language (product-boundaries-and-safe-claims.md,
// facility-control-system.md's pricing-table caveat). This is NOT a second
// policy engine (Section 15's own instruction) -- it is a single, flat
// classification carried on the knowledge item itself, read (never
// re-decided) by callers.
export type ClaimBoundary =
  | "safe_to_state" // may be stated directly, in the agent's own words
  | "requires_qualification" // may be stated but must be hedged/qualified (e.g. "positioned as", "proposed")
  | "requires_human_confirmation" // may only be referenced as existing; exact figures/scope must route to a human
  | "do_not_state_verbatim"; // informs agent reasoning only; must never be quoted or paraphrased to an external party

// Section 22 -- freshness class, not a universal TTL. EVERGREEN items
// (company identity) never expire on their own; VOLATILE items (pricing,
// current maturity, feature availability) carry a shorter effective
// freshness window and should be treated with more caution the older they
// get, even though this v1 has no automatic re-verification mechanism (see
// docs/WAVE9_SLICE1_CANONICAL_KNOWLEDGE_AUTHORITY.md's freshness section for
// the disclosed limitation).
export type KnowledgeFreshnessClass = "evergreen" | "volatile";

// Section 12/27 -- agent-aware, not agent-owned: this is a caller
// identifier, never a separate per-agent knowledge store. Adding a new
// value here must never imply a new omaKnowledgeService-style silo.
export type KnowledgeAgentRole = "oma" | "osa" | "office_internal" | "executive" | "facility" | "consumer";

export type KnowledgeItem = {
  // Stable within a source file+section; survives small editorial changes
  // to the same concept (Section 21) -- derived from sourceFile + a slug of
  // the section's own heading/opening line, never from content hash alone
  // (a content hash would create a new identity on every edit, which
  // Section 21 explicitly forbids).
  id: string;
  // A short, human-legible stable key for cross-referencing/citation
  // display -- same stability guarantee as id, just without the internal
  // slug mechanics exposed.
  canonicalKey: string;
  title: string;
  domain: KnowledgeDomain;
  authorityClass: KnowledgeAuthorityClass;
  audience: KnowledgeAudience;
  // Which agent roles may retrieve this item at all -- a second, narrower
  // gate than audience (e.g. facility-control-system.md's exact pricing
  // section is INTERNAL_COMMERCIAL audience AND agentVisibility=["osa"]
  // only, deliberately excluding "oma" per that file's own stated rule).
  agentVisibility: KnowledgeAgentRole[];
  content: string;
  sourceRepo: string;
  sourceFile: string;
  // Content hash of just this item's own section -- changes on every edit,
  // giving Section 21's "revision changes, identity survives" behavior.
  version: string;
  updatedAt: string | null;
  freshnessClass: KnowledgeFreshnessClass;
  claimBoundary: ClaimBoundary;
  tags: string[];
};

export type RetrieveKnowledgeRequest = {
  actor: {
    agentRole: KnowledgeAgentRole;
    // The caller's own declared audience ceiling -- retrieval MUST NOT
    // return an item whose audience exceeds this (Section 13: "no
    // retrieval result may widen the caller's authority").
    audienceScope: KnowledgeAudience;
  };
  domains?: KnowledgeDomain[];
  query: string;
  // Free-form additional signal (e.g. Opportunity business-unit hint,
  // inquiry type) -- Section 28: used as structured ranking input, never as
  // a second LLM call to formulate the search.
  context?: Record<string, string | undefined>;
  limit?: number;
};

export type RankedKnowledgeItem = KnowledgeItem & {
  relevanceScore: number;
  rankReason: string;
};

export type RetrieveKnowledgeResult = {
  items: RankedKnowledgeItem[];
  // True if more matching items existed than the bounded limit/char budget
  // allowed through (Section 30) -- callers must never infer completeness
  // from a non-truncated result either; this only reports the bound itself.
  truncated: boolean;
  queryEcho: string;
  domainsSearched: KnowledgeDomain[];
  generatedAt: string;
};

// Section 41 disclosure carried in code, not just docs: this contract's
// current implementation (knowledgeRetrieval.ts) is an in-memory index over
// Office's own 27-file pack, fetched and cached from Office at runtime (see
// officeKnowledgeBridge.ts) -- no database table exists or is required for
// v1, per the corpus's own real size (1,139 total lines across 27 files,
// confirmed by direct read during this slice).
