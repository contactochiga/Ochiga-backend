// Wave 9 Slice 2/3 -- Backend-native institutional knowledge items.
//
// The first four items are the exact, byte-for-byte content that
// originally lived ONLY as inline string literals in
// OfficeCorporateCapabilityModules.ts's corporate.company/oyi/private/
// partnerships.read modules (audited in full in Slice 2). They are
// converged here as real, governed KnowledgeItems -- the SAME canonical
// contract Office's 27-file pack uses (knowledgeContracts.ts) -- so there
// is exactly ONE authority for each fact, never a hardcoded copy plus a
// separate knowledge-pack copy.
//
// The fifth item (backend:corporate-development) was added in Slice 3
// after a direct audit of app/development/page.tsx found genuine durable
// identity content there (mission statement + journey stages), distinct
// from that same page's volatile CURRENT_DEVELOPMENTS project inventory.
//
// Deliberately NOT converted from OfficeCorporateCapabilityModules.ts:
// corporate.development.read. Direct read confirmed it is a LIVE fetch
// from Website's public Sanity CDN dataset (current development project
// listings), not a static institutional fact -- institutional knowledge
// is NOT "project-specific current state." That module is correctly LIVE
// STATE-shaped already and is left untouched.
//
// Source provenance: company/oyi/private/partnerships were "curated
// static content, mirrored from what is actually live on the public
// website today (app/about/page.tsx, app/private/page.tsx,
// app/partnerships/page.tsx, lib/company.ts)" per the original code's own
// comment. The partnerships item's wording was corrected in Slice 3
// (§3 of that slice) after a direct audit found app/partnerships/page.tsx
// (rebuilt 2026-08-11) now models 3 distinct sub-categories --
// Delivery Professionals, Technology/Oyi Integrators, and Strategic
// Partners -- under what this item previously called only
// "Professional/Strategic Partners," a label that matched neither the
// current nav (lib/company.ts, "Professional / Strategic Partners") nor
// any single page card exactly. The item keeps the coarser 4-track
// grouping (matching nav-level structure, appropriate for a short
// identity statement) but now names all 3 real sub-paths rather than
// the single stale label -- a source-authority correction, not a
// "pick the newer wording" choice. The development item's content was
// checked directly against app/development/page.tsx at write time.
// No other item was byte-diffed against the live website source this
// slice (flagged as a remaining gap, not rewritten, per the task's own
// "do not rewrite websites unless absolutely required" instruction).
//
// sourceRepo/sourceFile point back to THIS file + the exact function that
// used to own the literal, so the fact remains auditable to its origin
// even though it is no longer physically duplicated there (§27
// provenance requirement).
import { createHash } from "node:crypto";
import type { KnowledgeItem } from "./knowledgeContracts";

function shortHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

const SOURCE_REPO = "ochiga-backend";
const SOURCE_FILE = "src/oyi-core/capabilities/OfficeCorporateCapabilityModules.ts";
// Wave 9 Slice 3 -- the development identity item is a genuinely new item
// (no prior hardcoded literal to point back to), so its provenance points
// to this file itself plus the live website page it was written from,
// rather than borrowing the other four items' OfficeCorporateCapabilityModules.ts
// origin, which would misattribute it.
const DEVELOPMENT_SOURCE_FILE = "src/oyi-core/domains/knowledge/backendInstitutionalKnowledge.ts (content checked against Ochiga-website's app/development/page.tsx)";

type BackendInstitutionalSeed = Omit<KnowledgeItem, "version">;

const SEEDS: BackendInstitutionalSeed[] = [
  {
    id: "backend-institutional:corporate-company",
    canonicalKey: "backend:corporate-company",
    title: "What is Ochiga? (corporate.company.read)",
    domain: "corporate",
    authorityClass: "APPROVED_INSTITUTIONAL",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa", "office_internal", "executive"],
    content:
      "Ochiga develops and powers intelligent places, bringing together real estate development, building technology and strategic investment partnerships. " +
      "The company works through three connected engines: Ochiga Development (creates the physical asset), Oyi (Ochiga's building operating technology — powers how it operates), " +
      "and Ochiga Private (connects selected investors, buyers, landowners and strategic partners with opportunity). These are interconnected parts of one Ochiga ecosystem, not three unrelated businesses.",
    sourceRepo: SOURCE_REPO,
    sourceFile: SOURCE_FILE,
    updatedAt: null,
    freshnessClass: "evergreen",
    claimBoundary: "safe_to_state",
    tags: ["company", "identity", "what-is-ochiga", "three-engines"],
  },
  {
    id: "backend-institutional:corporate-oyi",
    canonicalKey: "backend:corporate-oyi",
    title: "What is Oyi? (corporate.oyi.read)",
    domain: "technology",
    authorityClass: "APPROVED_INSTITUTIONAL",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa", "office_internal", "executive"],
    content:
      "Oyi is Ochiga's building operating technology — the intelligence layer that helps developments continue to evolve after handover, powering access control, energy, climate and security across a property. " +
      "It's the same assistant you're talking to right now, adapted for residents, facility staff and Ochiga's own developments. More at getoyi.com.",
    sourceRepo: SOURCE_REPO,
    sourceFile: SOURCE_FILE,
    updatedAt: null,
    freshnessClass: "evergreen",
    claimBoundary: "safe_to_state",
    tags: ["oyi", "technology", "what-is-oyi"],
  },
  {
    id: "backend-institutional:corporate-private",
    canonicalKey: "backend:corporate-private",
    title: "What is Ochiga Private? (corporate.private.read)",
    domain: "private",
    authorityClass: "APPROVED_INSTITUTIONAL",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa", "office_internal", "executive"],
    content:
      "Ochiga Private is a curated private real-estate investment and opportunity network connecting selected investors, buyers, landowners and strategic partners with Ochiga's development opportunities. " +
      "Membership works through five stages — Apply, Qualify, Access, Participate, Grow — and opportunities span recurring income, longer-term appreciation and development-linked categories. " +
      "Membership and access are subject to individual review and are never guaranteed; Ochiga does not provide investment advice, and nothing here is an offer of securities or a guarantee of returns.",
    sourceRepo: SOURCE_REPO,
    sourceFile: SOURCE_FILE,
    updatedAt: null,
    freshnessClass: "evergreen",
    // Section 9/14's own explicit instruction: never invent returns,
    // guarantees, regulated-investment-service claims, or fundraising
    // authority. This item's own content already carries that compliance
    // disclaimer verbatim -- claimBoundary reflects it must always be
    // stated WITH that qualification attached, never trimmed.
    claimBoundary: "requires_qualification",
    tags: ["private", "membership", "investment-network", "compliance-disclaimer"],
  },
  {
    id: "backend-institutional:corporate-partnerships",
    canonicalKey: "backend:corporate-partnerships",
    title: "What partnerships does Ochiga consider? (corporate.partnerships.read)",
    domain: "partnerships",
    authorityClass: "APPROVED_INSTITUTIONAL",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa", "office_internal", "executive"],
    content:
      "Ochiga partners across several tracks: Landowners & Joint Ventures (land contribution, joint development), Capital Partners (institutions, family offices, strategic capital), " +
      "Buyers & Offtake (acquisition and sales relationships), and Delivery Professionals, Technology/Oyi Integrators & Strategic Partners (architecture/engineering/construction delivery, IoT/building-automation/OEM integration, and institutional/financial/hospitality relationships). " +
      "The process is Introduce, Review, Structure, Align, Execute. Start a conversation at ochiga.com.ng/partnerships or ochiga.com.ng/contact.",
    sourceRepo: SOURCE_REPO,
    sourceFile: SOURCE_FILE,
    updatedAt: null,
    freshnessClass: "evergreen",
    claimBoundary: "safe_to_state",
    tags: ["partnerships", "landowner", "jv", "capital", "offtake", "delivery-professionals", "technology-integrators", "strategic-partners"],
  },
  {
    // Wave 9 Slice 3 -- added after the audit found app/development/page.tsx
    // carries genuine durable institutional identity content (a mission
    // statement + an 8-stage development journey: Land, Strategy, Design,
    // Capital, Delivery, Sales, Technology, Operations), separate from the
    // page's own volatile CURRENT_DEVELOPMENTS project inventory (Havana,
    // Green Gardens, etc.) and separate from corporate.development.read's
    // live Sanity project-listing fetch. This item answers "what IS Ochiga
    // Development" (identity), never "what projects currently exist"
    // (that stays live state, deliberately not frozen here).
    id: "backend-institutional:corporate-development",
    canonicalKey: "backend:corporate-development",
    title: "What is Ochiga Development? (corporate.development identity)",
    domain: "development",
    authorityClass: "APPROVED_INSTITUTIONAL",
    audience: "PUBLIC",
    agentVisibility: ["oma", "osa", "office_internal", "executive"],
    content:
      "Ochiga Development is Ochiga's physical development engine — land, design, capital and delivery for residential and mixed-use environments. " +
      "Development, architecture, engineering and technology are considered together from the outset, so a building is designed not only to be delivered, but to operate and evolve. " +
      "The development journey runs Land, Strategy, Design, Capital, Delivery, Sales, Technology, Operations — bringing the disciplines required to move a development from opportunity to operating asset. " +
      "Current development projects and their status are live information, not part of this institutional description.",
    sourceRepo: SOURCE_REPO,
    sourceFile: DEVELOPMENT_SOURCE_FILE,
    updatedAt: null,
    freshnessClass: "evergreen",
    claimBoundary: "safe_to_state",
    tags: ["development", "identity", "what-is-ochiga-development", "journey-stages"],
  },
];

export const BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS: KnowledgeItem[] = SEEDS.map((seed) => ({
  ...seed,
  version: shortHash(seed.content),
}));
