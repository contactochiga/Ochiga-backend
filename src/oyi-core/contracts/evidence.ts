import type { OyiDomain } from "../runtime/languageUnderstanding";

export type EvidenceSourceType =
  | "database"
  | "provider_api"
  | "device_runtime"
  | "webhook"
  | "event"
  | "ledger"
  | "conversation"
  | "user_supplied"
  | "derived"
  | "domain_adapter"
  | "runtime"
  | "history"
  | "page_context"
  | "unknown";

export type EvidenceTruthClass =
  | "source_record"
  | "observation"
  | "execution_result"
  | "historical_record"
  | "user_assertion"
  | "derived_context"
  | "unavailable"
  | "permission_restricted";

export type EvidencePrivacyClass =
  | "public"
  | "resident_private"
  | "household_private"
  | "building_operational"
  | "facility_sensitive"
  | "financial_sensitive"
  | "security_sensitive"
  | "credential_sensitive"
  | "corporate_private"
  | "system_internal";

export type OyiEvidence = {
  evidence_id: string;
  domain: OyiDomain | "unknown";
  type: string;
  object_type: string | null;
  object_id: string | null;
  object_ref: {
    object_type: string | null;
    object_id: string | null;
    label?: string | null;
  };
  source: "domain_adapter" | "provider" | "runtime" | "execution" | "history" | "page_context";
  source_type: EvidenceSourceType;
  source_id: string | null;
  observed_at: string | null;
  persisted_at: string | null;
  freshness: "fresh" | "stale" | "expired" | "unknown" | "unobservable" | "provider_disconnected";
  truth_class: EvidenceTruthClass;
  privacy_class: EvidencePrivacyClass;
  permissions: string[];
  authorised_scope: {
    estate_id: string | null;
    building_id?: string | null;
    home_id: string | null;
    room_id: string | null;
  };
  confidence: number;
  payload: Record<string, unknown>;
};

export type IntelligenceFact = {
  fact_id: string;
  domain: OyiDomain | "unknown";
  proposition: string;
  subject: OyiEvidence["object_ref"];
  evidence_ids: string[];
  confidence: number;
  freshness: OyiEvidence["freshness"];
  observed_at: string | null;
  generated_at: string;
  payload: Record<string, unknown>;
};

export type IntelligenceInference = {
  inference_id: string;
  domain: OyiDomain | "unknown";
  conclusion: string;
  fact_ids: string[];
  evidence_ids: string[];
  confidence: number;
  limitations: string[];
  generated_at: string;
  payload: Record<string, unknown>;
};

export type CanonicalClaimState =
  | "confirmed"
  | "observed"
  | "inferred"
  | "predicted"
  | "unavailable"
  | "unobservable"
  | "unsupported"
  | "permission_restricted";

export type CanonicalResponseClaim = {
  claim_id: string;
  domain: OyiDomain | "unknown";
  statement: string;
  state: CanonicalClaimState;
  evidence_ids: string[];
  fact_ids: string[];
  inference_ids: string[];
  confidence: number | null;
  privacy_class: EvidencePrivacyClass;
  generated_at: string;
  limitations: string[];
};

export function claimStateForEvidence(evidence: Pick<OyiEvidence, "freshness" | "truth_class"> | null | undefined): CanonicalClaimState {
  if (!evidence) return "unavailable";
  if (evidence.truth_class === "permission_restricted") return "permission_restricted";
  if (evidence.truth_class === "unavailable") return "unavailable";
  if (evidence.freshness === "provider_disconnected") return "unavailable";
  if (evidence.freshness === "unobservable") return "unobservable";
  if (evidence.freshness === "expired") return "observed";
  if (evidence.truth_class === "derived_context") return "inferred";
  return evidence.freshness === "fresh" ? "confirmed" : "observed";
}

export function assertClaimDoesNotPromoteUnavailable(claim: CanonicalResponseClaim, evidence: Array<Pick<OyiEvidence, "evidence_id" | "truth_class" | "freshness">>) {
  const evidenceById = new Map(evidence.map((item) => [item.evidence_id, item]));
  const referenced = claim.evidence_ids.map((id) => evidenceById.get(id)).filter(Boolean);
  if (!referenced.length) return;
  const hasUnavailable = referenced.some((item) => item?.truth_class === "unavailable" || item?.truth_class === "permission_restricted" || item?.freshness === "provider_disconnected");
  if (hasUnavailable && ["confirmed", "observed"].includes(claim.state)) {
    throw new Error("Canonical claim cannot promote unavailable or restricted evidence to confirmed/observed");
  }
}
