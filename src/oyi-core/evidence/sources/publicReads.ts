// Evidence-read adapters for the public (Osa) surface: governed corporate knowledge, the
// published development listing and a thread's own caller-supplied opportunity objective.
// PURE READ and public-only: no CRM, Office, finance, private documents or staff data.
import type { CapabilityContext } from "../../contracts/capability";
import type { EvidenceReadOutcome, EvidenceReadScope, OyiEvidence } from "../../contracts/evidence";
import { evidenceEnvelope } from "../EvidenceEnvelope";
import { evidenceReadOutcome } from "../EvidenceReadOutcome";
import { canonicalCorporateKnowledge, type CorporateKnowledgeLookup } from "../../capabilities/corporateKnowledgeAnswer";
import { readPublicOpportunityObjective, type PublicOpportunityObjective } from "../../context/publicOpportunityObjective";

const publicEvidence: OyiEvidence["privacy_class"] = "public";

function text(value: unknown) {
  return String(value ?? "").trim();
}

// IQ-3A -- evidence-planning read of one governed corporate fact. Provenance is part of
// the evidence; in-code fallback copy is NEVER evidence: a missing governed item is a
// proven "no authorised match" (zero) and a failed retrieval is an error, never the same text.
export async function corporateKnowledgeOutcome(key: string, domain: OyiEvidence["domain"], canonicalKey: string, scope: EvidenceReadScope, lookupFn: (key: string) => Promise<CorporateKnowledgeLookup> = canonicalCorporateKnowledge): Promise<EvidenceReadOutcome> {
  const base = {
    capability_key: key, domain, requested_scope: scope, effective_scope: scope, authority: "allowed" as const,
    scope: "enforced" as const, query_executed: true, availability: "available" as const,
    population: `governed_knowledge_item_${canonicalKey}_visible_to_public_actor`,
    complete: true, truncated: false, freshness: "current" as const, records: [] as OyiEvidence[],
  };
  const lookup = await lookupFn(canonicalKey);
  if (lookup.retrieval !== "governed_item") {
    if (lookup.retrieval === "no_authorised_match") return evidenceReadOutcome(base);
    return evidenceReadOutcome({ ...base, availability: lookup.retrieval === "retrieval_failed" ? "error" : "unavailable", complete: false });
  }
  const record = evidenceEnvelope({
    domain, type: "governed_knowledge", object_type: "knowledge_item", object_id: lookup.provenance.canonical_key,
    source: "domain_adapter", observed_at: null,
    // No knowledge re-verification contract exists: governed does not mean verified current.
    freshness: "unknown", privacy_class: publicEvidence, confidence: 0.9,
    authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
    payload: { knowledge: { text: lookup.text, claim_boundary: lookup.provenance.claim_boundary }, provenance: lookup.provenance },
  });
  return evidenceReadOutcome({ ...base, records: [record], freshness: "unknown" });
}

const SANITY_PROJECT_ID = "ap1ku6sf";
const SANITY_DATASET = "production";
const DEVELOPMENT_PROJECTS_GROQ = `*[_type == "developmentProject"] | order(order asc) {
  name,
  "slug": slug.current,
  typeLine,
  location,
  status,
  oneLiner
}`;

export type SanityDevelopmentProject = {
  name?: string;
  slug?: string;
  typeLine?: string;
  location?: string;
  status?: string;
  oneLiner?: string;
};

export async function fetchLiveDevelopmentProjects(): Promise<{ projects: SanityDevelopmentProject[]; fetched: boolean; failure?: "http_error" | "timeout" | "network_error" | "malformed_response" }> {
  try {
    const url = `https://${SANITY_PROJECT_ID}.apicdn.sanity.io/v2024-01-01/data/query/${SANITY_DATASET}?query=${encodeURIComponent(DEVELOPMENT_PROJECTS_GROQ)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return { projects: [], fetched: false, failure: "http_error" };
    const body = (await response.json()) as { result?: SanityDevelopmentProject[] };
    // A body without a result array is a malformed response, not an empty listing.
    if (!Array.isArray(body?.result)) return { projects: [], fetched: false, failure: "malformed_response" };
    return { projects: body.result, fetched: true };
  } catch (error) {
    return { projects: [], fetched: false, failure: (error as Error)?.name === "TimeoutError" ? "timeout" : "network_error" };
  }
}

// IQ-3A -- evidence-planning read of the public development listing. A failed fetch is
// unavailable/timeout, never "no projects". The CDN gives no freshness guarantee, so an empty
// listing is not proven current zero.
export async function corporateDevelopmentOutcome(scope: EvidenceReadScope): Promise<EvidenceReadOutcome> {
  const base = {
    capability_key: "corporate.development.read", domain: "corporate_development" as const, requested_scope: scope, effective_scope: scope,
    authority: "allowed" as const, scope: "enforced" as const, query_executed: true, availability: "available" as const,
    population: "published_development_projects_in_public_website_dataset", complete: true, truncated: false,
    freshness: "unknown" as const, records: [] as OyiEvidence[],
  };
  const { projects, fetched, failure } = await fetchLiveDevelopmentProjects();
  if (!fetched) return evidenceReadOutcome({ ...base, availability: failure === "timeout" ? "timeout" : failure === "http_error" || failure === "malformed_response" ? "unavailable" : "error", complete: false });
  const records = projects.map((project) => evidenceEnvelope({
    domain: "corporate_development", type: "public_development_project", object_type: "development_project",
    object_id: project.slug || project.name || null, source: "provider", source_type: "provider_api",
    observed_at: new Date().toISOString(), freshness: "unknown", privacy_class: publicEvidence, confidence: 0.95,
    authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null }, payload: { project },
  }));
  return evidenceReadOutcome({ ...base, records, truncated: records.length > 50 });
}

function publicOpportunityEvidence(objective: PublicOpportunityObjective | null): OyiEvidence {
  return evidenceEnvelope({
    domain: "corporate_opportunity",
    type: "public_opportunity_objective",
    object_type: null,
    object_id: null,
    source: "domain_adapter",
    observed_at: objective?.updated_at || null,
    freshness: "unknown",
    privacy_class: publicEvidence,
    confidence: 0.85,
    authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
    payload: { objective, load_failed: false },
  });
}

// IQ-3A -- evidence-planning read of this thread's own, caller-supplied (unverified)
// opportunity objective. Ownership is proven (same public principal and surface); absence
// and failure are distinct; the TTL-expired case is an honest "no current objective".
export async function publicOpportunityOutcome(context: CapabilityContext, scope: EvidenceReadScope): Promise<EvidenceReadOutcome> {
  const base = {
    capability_key: "corporate.opportunity.read", domain: "corporate_opportunity" as const, requested_scope: scope, effective_scope: scope,
    authority: "allowed" as const, scope: "enforced" as const, query_executed: true, availability: "available" as const,
    population: "unexpired_caller_supplied_opportunity_objective_of_owned_public_thread", complete: true, truncated: false,
    freshness: "current" as const, records: [] as OyiEvidence[],
  };
  const read = await readPublicOpportunityObjective(text(context.input.thread_id), context.actor?.id);
  if (read.status === "error") return evidenceReadOutcome({ ...base, availability: "error", complete: false });
  if (read.status === "not_owned") return evidenceReadOutcome({ ...base, authority: "denied", query_executed: false });
  if (read.status === "thread_not_found") return evidenceReadOutcome({ ...base, scope: "insufficient", query_executed: false });
  if (read.status === "none" || read.status === "expired") return evidenceReadOutcome(base);
  const record = publicOpportunityEvidence(read.objective);
  // Caller-supplied facts are unverified: never promoted above their stated source.
  return evidenceReadOutcome({ ...base, records: [{ ...record, truth_class: "user_assertion" as const, confidence: 0.5 }], freshness: "unknown" });
}

