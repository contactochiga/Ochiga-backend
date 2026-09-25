// Wave 9 Slice 2 -- Backend-native institutional knowledge items.
//
// These four items are the exact, byte-for-byte content that previously
// lived ONLY as inline string literals in
// OfficeCorporateCapabilityModules.ts's corporate.company/oyi/private/
// partnerships.read modules (audited in full this slice). They are
// converged here as real, governed KnowledgeItems -- the SAME canonical
// contract Office's 27-file pack uses (knowledgeContracts.ts) -- so there
// is exactly ONE authority for each fact, never a hardcoded copy plus a
// separate knowledge-pack copy.
//
// Deliberately NOT converted from OfficeCorporateCapabilityModules.ts:
// corporate.development.read. Direct read this slice confirmed it is a
// LIVE fetch from Website's public Sanity CDN dataset (current
// development project listings), not a static institutional fact --
// Slice 2's own instruction is explicit that institutional knowledge is
// NOT "project-specific current state." That module is correctly LIVE
// STATE-shaped already and is left untouched.
//
// Source provenance (confirmed by the original code's own comment,
// preserved here): "curated static content, mirrored from what is
// actually live on the public website today (app/about/page.tsx,
// app/private/page.tsx, app/partnerships/page.tsx, lib/company.ts)" --
// i.e. these are already a convergence of website copy, not an
// independent third version. A full byte-diff against the live website
// source was not performed this slice (§20 -- flagged as a remaining gap,
// not rewritten here per the task's own "do not rewrite websites unless
// absolutely required" instruction).
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
      "Buyers & Offtake (acquisition and sales relationships), and Professional/Strategic Partners (delivery and technology integrators). " +
      "The process is Introduce, Review, Structure, Align, Execute. Start a conversation at ochiga.com.ng/partnerships or ochiga.com.ng/contact.",
    sourceRepo: SOURCE_REPO,
    sourceFile: SOURCE_FILE,
    updatedAt: null,
    freshnessClass: "evergreen",
    claimBoundary: "safe_to_state",
    tags: ["partnerships", "landowner", "jv", "capital", "offtake"],
  },
];

export const BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS: KnowledgeItem[] = SEEDS.map((seed) => ({
  ...seed,
  version: shortHash(seed.content),
}));
