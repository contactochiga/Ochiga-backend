import type { IntelligenceFact } from "../../contracts/canonicalConversation";
import type { OyiEvidence } from "../../contracts/evidence";
import type { OyiDomain } from "../../runtime/languageUnderstanding";
import { evidenceEnvelope } from "../EvidenceEnvelope";
import { classifyFreshness as classifyFreshnessBucket, type FreshnessBucket } from "../../domains/contributorSummary";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Wave 6 Slice 12: fact.freshness carries two legitimate shapes across the
// codebase -- (a) an already-classified OyiEvidence bucket literal (e.g.
// runtimeEvidenceForDevice, which runs contracts/freshness.ts's own
// classifier before the fact is built) or (b) a raw ISO observation
// timestamp / domain sentinel ("unknown"/"unavailable"/"historical"), the
// contract every other evidence loader follows (see deviceEvidence.ts's own
// "raw timestamp-or-unknown" comment). Shape (a) must pass through
// unchanged; shape (b) must be classified by age using the existing
// domain-aware classifier, never defaulted to "fresh" just because it looks
// date-shaped -- that silently fabricated freshness regardless of actual age.
const EVIDENCE_FRESHNESS_LITERALS = new Set(["fresh", "stale", "expired", "unknown", "unobservable", "provider_disconnected"]);

function mapFreshnessBucketToEvidenceFreshness(bucket: FreshnessBucket): OyiEvidence["freshness"] {
  switch (bucket) {
    case "fresh": return "fresh";
    case "recent": return "stale";
    case "stale": return "stale";
    case "historical": return "expired";
    case "unavailable": return "unobservable";
    case "unknown":
    default:
      return "unknown";
  }
}

function normalizeFreshness(value: unknown, domain: string): OyiEvidence["freshness"] {
  const raw = text(value).toLowerCase();
  if (EVIDENCE_FRESHNESS_LITERALS.has(raw)) return raw as OyiEvidence["freshness"];
  return mapFreshnessBucketToEvidenceFreshness(classifyFreshnessBucket(domain, value, Date.now()));
}

function privacyForFact(fact: IntelligenceFact): OyiEvidence["privacy_class"] {
  const raw = text((fact as any).privacy_class).toLowerCase();
  if (/financial|wallet|transaction/.test(`${raw} ${fact.domain} ${fact.fact_type}`)) return "financial_sensitive";
  if (/security|credential|access/.test(`${raw} ${fact.domain} ${fact.fact_type}`)) return "security_sensitive";
  if (/resident|home|household|device/.test(raw)) return "household_private";
  return "household_private";
}

export function evidenceFromFact(fact: IntelligenceFact): OyiEvidence {
  return evidenceEnvelope({
    evidence_id: `capability:${fact.fact_id}`,
    domain: fact.domain as OyiDomain,
    type: fact.fact_type,
    object_type: fact.object?.object_type || null,
    object_id: fact.object?.canonical_id || null,
    object_ref: {
      object_type: fact.object?.object_type || null,
      object_id: fact.object?.canonical_id || null,
      label: fact.object?.label || null,
    },
    source: "domain_adapter",
    source_type: fact.source_type as any,
    source_id: fact.source_id || fact.fact_id,
    observed_at: fact.observed_at || fact.occurred_at || null,
    freshness: normalizeFreshness(fact.freshness, fact.domain),
    truth_class: fact.truth_state === "permission_restricted" ? "permission_restricted" : fact.truth_state === "unavailable" ? "unavailable" : "source_record",
    privacy_class: privacyForFact(fact),
    permissions: fact.permissions || [],
    authorised_scope: {
      estate_id: fact.scope?.estate_id || null,
      building_id: (fact.scope as any)?.building_id || null,
      home_id: fact.scope?.home_id || null,
      room_id: fact.scope?.room_id || null,
    },
    confidence: typeof fact.confidence === "number" && Number.isFinite(fact.confidence) ? fact.confidence : 0,
    payload: { fact },
  });
}

export function factsFromEvidence(evidence: OyiEvidence[]): IntelligenceFact[] {
  return evidence.map((item) => recordOf(item.payload).fact).filter((item): item is IntelligenceFact => Boolean(item && typeof item === "object"));
}

