// Wave 9 Slice 1 -- classification manifest for Office's real 27-file
// `knowledge/` pack (Slice 0's first real source, per the task's own
// Section 9/10 instruction: "use the existing pack as the FIRST real
// source... do not assume all 27 files are canonical... classify every
// file").
//
// Every classification below was decided from a full, direct read of every
// file in the pack during this slice (not re-derived from Slice 0's own
// partial triage, which explicitly flagged most files as name/README-based
// only). Two files are deliberately EXCLUDED from the retrievable
// KnowledgeItem corpus, not silently ingested:
//   - README.md: the pack's own meta-documentation about itself, not a
//     knowledge claim.
//   - agent-voice-and-style.md: pure behavioral/tone instruction
//     (Section 10's own explicit rule: "agent voice/style must not become
//     corporate factual truth"). This is PROMPT, not KNOWLEDGE, per the
//     locked semantic boundary -- Core's prompt construction may still read
//     it directly as a style guide if desired, but knowledgeRetrieval.ts
//     will never surface it as an answer to a factual query.
//
// Content itself is NOT duplicated here -- this manifest carries only
// classification metadata; officeKnowledgeBridge.ts fetches the real
// content from Office at runtime and knowledgeIndex.ts joins the two by
// filename (Section 9: "the source remains auditable back to its file").
import type { ClaimBoundary, KnowledgeAgentRole, KnowledgeAudience, KnowledgeAuthorityClass, KnowledgeDomain, KnowledgeFreshnessClass } from "./knowledgeContracts";

export type OfficeKnowledgeManifestEntry = {
  file: string;
  title: string;
  domain: KnowledgeDomain;
  authorityClass: KnowledgeAuthorityClass;
  audience: KnowledgeAudience;
  agentVisibility: KnowledgeAgentRole[];
  claimBoundary: ClaimBoundary;
  freshnessClass: KnowledgeFreshnessClass;
  tags: string[];
};

export type ExcludedManifestEntry = {
  file: string;
  reason: string;
};

const ALL_COMMERCIAL_ROLES: KnowledgeAgentRole[] = ["oma", "osa", "office_internal", "executive"];

// Section 10 classification, one row per file, decided from a full read of
// every file's actual current content (2026-09-26).
export const OFFICE_KNOWLEDGE_MANIFEST: OfficeKnowledgeManifestEntry[] = [
  {
    file: "approved-system-description.md",
    title: "Approved one-paragraph system description",
    domain: "corporate",
    authorityClass: "APPROVED_INSTITUTIONAL",
    audience: "PUBLIC",
    agentVisibility: ALL_COMMERCIAL_ROLES,
    claimBoundary: "safe_to_state",
    freshnessClass: "evergreen",
    tags: ["company", "identity", "what-is-oyi"],
  },
  {
    file: "ochiga-overview.md",
    title: "Ochiga & Oyi overview, product stack, commercial model",
    domain: "corporate",
    authorityClass: "APPROVED_INSTITUTIONAL",
    audience: "PUBLIC",
    agentVisibility: ALL_COMMERCIAL_ROLES,
    claimBoundary: "safe_to_state",
    freshnessClass: "evergreen",
    tags: ["company", "identity", "product-stack", "oma", "osa"],
  },
  {
    file: "company-explainer-patterns.md",
    title: "Company explainer patterns (approved answers)",
    domain: "corporate",
    authorityClass: "APPROVED_INSTITUTIONAL",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa"],
    claimBoundary: "safe_to_state",
    freshnessClass: "evergreen",
    tags: ["what-does-the-company-do", "elevator-pitch"],
  },
  {
    file: "system-overview-and-surfaces.md",
    title: "System overview and surfaces (code-grounded, dated)",
    domain: "technology",
    authorityClass: "TECHNICAL_SOURCE",
    audience: "PUBLIC",
    agentVisibility: ALL_COMMERCIAL_ROLES,
    claimBoundary: "safe_to_state",
    // Explicitly self-dated ("as of April 12, 2026") -- a real, disclosed
    // freshness marker, not evergreen.
    freshnessClass: "volatile",
    tags: ["architecture", "surfaces", "multi-surface"],
  },
  {
    file: "business-model-and-current-maturity.md",
    title: "Business model & implementation maturity (unverified reference)",
    domain: "corporate",
    // This prose mixes inferred revenue lines with undated deployment
    // claims. It is not executable evidence of current implementation.
    authorityClass: "UNVERIFIED_REFERENCE",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["osa", "office_internal", "executive"],
    claimBoundary: "requires_human_confirmation",
    freshnessClass: "volatile",
    tags: ["maturity", "revenue-model", "implemented-vs-positioned"],
  },
  {
    file: "oyi-solution-map.md",
    title: "Oyi solution map & fit signals",
    domain: "product",
    authorityClass: "PRODUCT_SOURCE",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa"],
    claimBoundary: "safe_to_state",
    freshnessClass: "evergreen",
    tags: ["solution-map", "fit-signals", "what-is-oyi"],
  },
  {
    file: "modules-and-capabilities.md",
    title: "Modules & capabilities (high-level categories only)",
    domain: "product",
    authorityClass: "PRODUCT_SOURCE",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa"],
    claimBoundary: "requires_qualification",
    freshnessClass: "evergreen",
    tags: ["capabilities", "modules"],
  },
  {
    file: "product-boundaries-and-safe-claims.md",
    title: "Product boundaries and safe claims",
    domain: "product",
    authorityClass: "PRODUCT_SOURCE",
    audience: "PUBLIC",
    agentVisibility: ALL_COMMERCIAL_ROLES,
    claimBoundary: "safe_to_state",
    freshnessClass: "evergreen",
    tags: ["safe-claims", "boundaries", "overclaiming"],
  },
  {
    file: "use-cases-and-needs.md",
    title: "Use cases and needs (safe framing)",
    domain: "product",
    authorityClass: "PRODUCT_SOURCE",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa"],
    claimBoundary: "requires_qualification",
    freshnessClass: "evergreen",
    tags: ["use-cases", "digital-twin"],
  },
  {
    file: "digital-twin-building-blueprint.md",
    title: "Digital twin building blueprint (proposed architecture)",
    domain: "technology",
    authorityClass: "PRODUCT_SOURCE",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["osa", "office_internal"],
    // The file's own explicit self-framing: "treat this as proposed
    // solution architecture and demo scope, not as a blanket claim that
    // every module is already production-ready."
    claimBoundary: "requires_qualification",
    freshnessClass: "volatile",
    tags: ["digital-twin", "proposal", "demo-scope"],
  },
  {
    file: "edge-runtime-and-agent-stack.md",
    title: "Edge runtime and internal agent stack (code-grounded)",
    domain: "technology",
    authorityClass: "TECHNICAL_SOURCE",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["osa", "office_internal", "executive"],
    claimBoundary: "requires_qualification",
    freshnessClass: "volatile",
    tags: ["edge", "oyi-edge-agent", "internal-architecture"],
  },
  {
    file: "facility-control-system.md",
    title: "Facility control system (code-grounded, includes pricing)",
    domain: "technology",
    authorityClass: "TECHNICAL_SOURCE",
    audience: "INTERNAL_COMMERCIAL",
    // The file's own explicit rule: "Oma should not quote or negotiate from
    // this file" -- Oma is deliberately excluded from agentVisibility.
    agentVisibility: ["osa", "office_internal"],
    claimBoundary: "requires_human_confirmation",
    freshnessClass: "volatile",
    tags: ["facility-oyi", "pricing", "operator-dashboard"],
  },
  {
    file: "consumer-app-and-ai-surfaces.md",
    title: "Consumer app and AI surfaces (code-grounded)",
    domain: "technology",
    authorityClass: "TECHNICAL_SOURCE",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa"],
    claimBoundary: "requires_qualification",
    freshnessClass: "volatile",
    tags: ["consumer-app", "resident", "oyi-os-frontend"],
  },
  {
    file: "ideal-customers-and-fit.md",
    title: "Ideal customer profiles and fit signals",
    domain: "commercial",
    authorityClass: "APPROVED_COMMERCIAL",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["oma", "osa"],
    claimBoundary: "do_not_state_verbatim",
    freshnessClass: "evergreen",
    tags: ["icp", "fit-signals", "qualification"],
  },
  {
    file: "qualification-playbook.md",
    title: "OMA qualification playbook",
    domain: "commercial",
    authorityClass: "APPROVED_COMMERCIAL",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["oma"],
    claimBoundary: "do_not_state_verbatim",
    freshnessClass: "evergreen",
    tags: ["qualification", "lead-stages", "routing"],
  },
  {
    file: "demo-and-discovery-playbook.md",
    title: "Demo and discovery playbook",
    domain: "commercial",
    authorityClass: "APPROVED_COMMERCIAL",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["oma", "osa"],
    claimBoundary: "requires_qualification",
    freshnessClass: "evergreen",
    tags: ["demo", "discovery", "booking"],
  },
  {
    file: "osa-sales-narrative.md",
    title: "OSA sales narrative",
    domain: "commercial",
    authorityClass: "APPROVED_COMMERCIAL",
    audience: "PUBLIC",
    agentVisibility: ["osa"],
    claimBoundary: "safe_to_state",
    freshnessClass: "evergreen",
    tags: ["sales-narrative", "objections", "packages"],
  },
  {
    file: "commercial-guardrails.md",
    title: "Commercial guardrails",
    domain: "commercial",
    authorityClass: "APPROVED_COMMERCIAL",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["oma", "osa"],
    claimBoundary: "do_not_state_verbatim",
    freshnessClass: "evergreen",
    tags: ["guardrails", "escalation", "do-not-invent"],
  },
  {
    file: "commercial-proposal-logic.md",
    title: "Commercial proposal logic and package structure",
    domain: "commercial",
    authorityClass: "APPROVED_COMMERCIAL",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["osa", "office_internal"],
    claimBoundary: "requires_qualification",
    freshnessClass: "evergreen",
    tags: ["proposal", "packages", "commercial-structure"],
  },
  {
    file: "commercial-signals-and-handoff.md",
    title: "Commercial signals and handoff rules",
    domain: "commercial",
    authorityClass: "APPROVED_COMMERCIAL",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["oma", "osa", "office_internal"],
    claimBoundary: "do_not_state_verbatim",
    freshnessClass: "evergreen",
    tags: ["handoff", "routing", "escalation"],
  },
  {
    file: "negotiation-intelligence.md",
    title: "Osa negotiation intelligence (customer-facing scripts)",
    domain: "commercial",
    authorityClass: "APPROVED_COMMERCIAL",
    // Unlike the other commercial-doctrine files, this one IS meant to be
    // spoken to the buyer near-verbatim -- it is scripted dialogue, not
    // internal strategy notes.
    audience: "PUBLIC",
    agentVisibility: ["osa"],
    claimBoundary: "safe_to_state",
    freshnessClass: "evergreen",
    tags: ["negotiation", "objection-handling", "scripts"],
  },
  {
    file: "objection-and-reply-guide.md",
    title: "Objection and reply guide",
    domain: "commercial",
    authorityClass: "APPROVED_COMMERCIAL",
    audience: "PUBLIC",
    agentVisibility: ["oma"],
    claimBoundary: "safe_to_state",
    freshnessClass: "evergreen",
    tags: ["objections", "company-explainer"],
  },
  {
    file: "pitch-deck-positioning.md",
    title: "Pitch deck / investor-enterprise positioning narrative",
    domain: "corporate",
    authorityClass: "MARKETING_REFERENCE",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["osa", "office_internal", "executive"],
    claimBoundary: "requires_qualification",
    freshnessClass: "volatile",
    tags: ["investor", "positioning", "vision"],
  },
  {
    file: "demo-narrative.md",
    title: "Approved demo sequence narrative",
    domain: "product",
    authorityClass: "UNVERIFIED_REFERENCE",
    audience: "INTERNAL_COMMERCIAL",
    agentVisibility: ["osa", "office_internal"],
    claimBoundary: "requires_qualification",
    freshnessClass: "volatile",
    tags: ["demo", "sequence"],
  },
  {
    file: "website-messaging.md",
    title: "Website messaging (public positioning)",
    domain: "website",
    authorityClass: "MARKETING_REFERENCE",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa"],
    claimBoundary: "requires_qualification",
    freshnessClass: "volatile",
    tags: ["website", "taglines", "positioning"],
  },
  {
    file: "websites-positioning-and-deployments.md",
    title: "Website positioning and deployment model",
    domain: "website",
    authorityClass: "MARKETING_REFERENCE",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa"],
    claimBoundary: "requires_qualification",
    freshnessClass: "volatile",
    tags: ["website", "deployment-model", "consultative"],
  },
];

// Section 10 -- deliberately excluded, with reason, so the exclusion itself
// is auditable rather than silent.
export const OFFICE_KNOWLEDGE_EXCLUDED: ExcludedManifestEntry[] = [
  { file: "README.md", reason: "REFERENCE_DOCUMENT -- the pack's own meta-documentation about itself, not a knowledge claim." },
  {
    file: "agent-voice-and-style.md",
    reason: "PROMPT_INSTRUCTION -- tone/style guidance, not factual knowledge. Section 10: 'agent voice/style must not become corporate factual truth.' Never surfaced by knowledgeRetrieval.ts.",
  },
];

export function manifestEntryFor(file: string): OfficeKnowledgeManifestEntry | undefined {
  return OFFICE_KNOWLEDGE_MANIFEST.find((entry) => entry.file === file);
}
