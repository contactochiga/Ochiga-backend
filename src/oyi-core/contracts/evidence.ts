import type { OyiDomain } from "../runtime/languageUnderstanding";

export type OyiEvidence = {
  evidence_id: string;
  domain: OyiDomain | "unknown";
  type: string;
  object_type: string | null;
  object_id: string | null;
  source: "domain_adapter" | "provider" | "runtime" | "execution" | "history" | "page_context";
  observed_at: string | null;
  persisted_at: string | null;
  freshness: "fresh" | "stale" | "expired" | "unknown" | "unobservable" | "provider_disconnected";
  authorised_scope: {
    estate_id: string | null;
    home_id: string | null;
    room_id: string | null;
  };
  confidence: number;
  payload: Record<string, unknown>;
};
