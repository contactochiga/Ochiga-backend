// Shared by OfficeCorporateCapabilityModules.ts and
// PublicOpportunityCapabilityModule.ts -- extracted so the two can both
// use the same governed-knowledge-lookup-with-fallback pattern without a
// circular import between them.
import { getKnowledgeItemByCanonicalKey, lookupKnowledgeItemByCanonicalKey } from "../domains/knowledge/knowledgeRetrieval";
import type { KnowledgeItem } from "../domains/knowledge/knowledgeContracts";

const CORPORATE_ANSWER_ACTOR = { agentRole: "oma" as const, audienceScope: "PUBLIC" as const };

export async function canonicalCorporateAnswer(canonicalKey: string, fallback: string): Promise<string> {
  try {
    const item = await getKnowledgeItemByCanonicalKey(canonicalKey, CORPORATE_ANSWER_ACTOR);
    return item?.content || fallback;
  } catch {
    return fallback;
  }
}

// IQ-3A -- what future reasoning may know about a governed fact. Deliberately
// excludes the source file/repo (filesystem paths), tags, ids of hidden items and
// any item the actor cannot see.
export type CorporateKnowledgeProvenance = {
  canonical_key: string;
  domain: KnowledgeItem["domain"];
  authority_class: KnowledgeItem["authorityClass"];
  audience: KnowledgeItem["audience"];
  worker_visibility: KnowledgeItem["agentVisibility"];
  freshness_class: KnowledgeItem["freshnessClass"];
  claim_boundary: KnowledgeItem["claimBoundary"];
  version: string;
  updated_at: string | null;
  source_family: "backend_institutional" | "office_knowledge_pack";
};

export type CorporateKnowledgeLookup =
  | { retrieval: "governed_item"; text: string; provenance: CorporateKnowledgeProvenance }
  // Governed item absent or not visible to the public actor: NOT a failure and NOT licence to
  // substitute in-code fallback copy as if it were the governed fact.
  | { retrieval: "no_authorised_match"; text: null; provenance: null }
  | { retrieval: "retrieval_degraded" | "retrieval_failed"; text: null; provenance: null };

export function corporateKnowledgeProvenance(item: KnowledgeItem): CorporateKnowledgeProvenance {
  return {
    canonical_key: item.canonicalKey, domain: item.domain, authority_class: item.authorityClass, audience: item.audience,
    worker_visibility: [...item.agentVisibility], freshness_class: item.freshnessClass, claim_boundary: item.claimBoundary,
    version: item.version, updated_at: item.updatedAt,
    source_family: item.id.startsWith("backend-institutional:") ? "backend_institutional" : "office_knowledge_pack",
  };
}

export async function canonicalCorporateKnowledge(canonicalKey: string): Promise<CorporateKnowledgeLookup> {
  try {
    const found = await lookupKnowledgeItemByCanonicalKey(canonicalKey, CORPORATE_ANSWER_ACTOR);
    if (found.status === "found") return { retrieval: "governed_item", text: found.item.content, provenance: corporateKnowledgeProvenance(found.item) };
    return found.status === "no_authorised_match"
      ? { retrieval: "no_authorised_match", text: null, provenance: null }
      : { retrieval: "retrieval_degraded", text: null, provenance: null };
  } catch {
    return { retrieval: "retrieval_failed", text: null, provenance: null };
  }
}
