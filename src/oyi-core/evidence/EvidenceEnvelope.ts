import { randomUUID } from "crypto";
import type { OyiEvidence } from "../contracts/evidence";

export function evidenceEnvelope(input: Omit<OyiEvidence, "evidence_id" | "persisted_at"> & { evidence_id?: string; persisted_at?: string | null }): OyiEvidence {
  return {
    evidence_id: input.evidence_id || randomUUID(),
    persisted_at: input.persisted_at ?? new Date().toISOString(),
    ...input,
  };
}
