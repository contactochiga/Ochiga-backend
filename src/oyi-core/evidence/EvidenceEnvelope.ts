import { randomUUID } from "crypto";
import type { OyiEvidence } from "../contracts/evidence";

export type EvidenceEnvelopeInput = Omit<OyiEvidence, "evidence_id" | "persisted_at" | "object_ref" | "source_type" | "source_id" | "truth_class" | "privacy_class" | "permissions"> & {
  evidence_id?: string;
  persisted_at?: string | null;
  object_ref?: OyiEvidence["object_ref"];
  source_type?: OyiEvidence["source_type"];
  source_id?: string | null;
  truth_class?: OyiEvidence["truth_class"];
  privacy_class?: OyiEvidence["privacy_class"];
  permissions?: string[];
};

function sourceTypeForLegacySource(source: OyiEvidence["source"]): OyiEvidence["source_type"] {
  if (source === "runtime") return "device_runtime";
  if (source === "provider") return "provider_api";
  if (source === "execution") return "ledger";
  if (source === "history") return "history";
  if (source === "page_context") return "page_context";
  return source;
}

export function evidenceEnvelope(input: EvidenceEnvelopeInput): OyiEvidence {
  return {
    ...input,
    evidence_id: input.evidence_id || randomUUID(),
    persisted_at: input.persisted_at ?? new Date().toISOString(),
    object_ref: input.object_ref || {
      object_type: input.object_type,
      object_id: input.object_id,
      label: null,
    },
    source_type: input.source_type || sourceTypeForLegacySource(input.source),
    source_id: input.source_id ?? input.object_id ?? null,
    truth_class: input.truth_class || (input.freshness === "provider_disconnected" ? "unavailable" : "observation"),
    privacy_class: input.privacy_class || "household_private",
    permissions: Array.isArray(input.permissions) ? input.permissions : [],
  };
}
