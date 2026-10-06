import type { EvidenceDegradedSource, EvidenceReadOutcome, EvidenceReadScope, OyiEvidence } from "../contracts/evidence";

// Matches the existing maintenance/security source row bound. This is an
// acceptance bound, not a claim that an upstream query was itself bounded.
export const MAX_EVIDENCE_READ_RECORDS = 50;

export type EvidenceReadProof = {
  capability_key: string;
  domain: OyiEvidence["domain"];
  requested_scope: EvidenceReadScope;
  effective_scope: EvidenceReadScope | null;
  authority: "allowed" | "denied";
  scope: "enforced" | "unsupported" | "insufficient";
  query_executed: boolean;
  availability: "available" | "unavailable" | "error" | "timeout";
  population: string;
  // This must come from the source adapter (pagination/count/snapshot contract),
  // never from records.length or a capability's supports() predicate.
  complete: boolean;
  truncated: boolean;
  source_total?: number | null;
  freshness: EvidenceReadOutcome["freshness"];
  records: OyiEvidence[];
  lifecycle?: EvidenceReadOutcome["lifecycle"];
  // Failed sub-sources that did not stop the read. Empty/undefined means none failed.
  degraded_sources?: EvidenceDegradedSource[];
};

/** Normalize audited source proofs. This function neither authorizes nor reads. */
export function evidenceReadOutcome(proof: EvidenceReadProof): EvidenceReadOutcome {
  const base: EvidenceReadOutcome = {
    capability_key: proof.capability_key, domain: proof.domain,
    requested_scope: proof.requested_scope, effective_scope: null,
    authority: proof.authority, query_executed: proof.query_executed,
    population: proof.population, status: "unavailable", complete: false,
    zero_proven: false, truncated: proof.truncated, freshness: proof.freshness,
    records: [], record_count: 0, source_total: null, lifecycle: [], error_class: null,
  };
  // Suppress records, source counts and effective scope on failed admission.
  if (proof.authority !== "allowed") return { ...base, status: "authority_denied" };
  if (proof.scope !== "enforced") return { ...base, status: proof.scope === "unsupported" ? "scope_unsupported" : "scope_insufficient" };
  if (!proof.effective_scope) return { ...base, status: "scope_insufficient" };
  const dimensions = ["estate_id", "building_id", "home_id", "room_id", "actor_id"] as const;
  if (dimensions.some(d => proof.requested_scope[d] && proof.requested_scope[d] !== proof.effective_scope?.[d])) {
    return { ...base, status: "scope_unsupported" };
  }
  // Defense in depth: contradictory record scope must not leak even counts.
  // Missing per-record scope is not fabricated: source-level filter proof is
  // still required from the adapter for records without membership fields.
  if (proof.records.some(r => dimensions.some(d => d !== "actor_id" && proof.effective_scope?.[d]
    && r.authorised_scope?.[d] && r.authorised_scope[d] !== proof.effective_scope[d]))) {
    return { ...base, status: "authority_denied", authority: "denied" };
  }
  base.effective_scope = proof.effective_scope;
  if (proof.availability !== "available") return {
    ...base, status: proof.availability,
    error_class: proof.availability === "timeout" ? "deadline_exceeded" : proof.availability === "error" ? "source_error" : "source_unavailable",
  };
  if (!proof.query_executed || !proof.population.trim()) return { ...base, error_class: "source_unavailable" };
  // Failure sentinel records are not observations and cannot prove zero.
  if (proof.records.some(r => r.truth_class === "permission_restricted")) return { ...base, effective_scope: null, status: "authority_denied", authority: "denied" };
  const unavailable = proof.records.some(r => r.truth_class === "unavailable" || r.freshness === "provider_disconnected");
  // A failed mandatory sub-source (e.g. the primary history query) is an error, not
  // a result: nothing from the read may be taken as evidence of absence.
  const degraded = proof.degraded_sources || [];
  if (degraded.some(d => d.mandatory)) {
    return { ...base, status: "error", error_class: "source_error", degraded_sources: degraded };
  }
  const accepted = proof.records.filter(r => r.truth_class !== "unavailable" && r.freshness !== "provider_disconnected");
  const records = accepted.slice(0, MAX_EVIDENCE_READ_RECORDS);
  const total = Number.isInteger(proof.source_total) && Number(proof.source_total) >= 0 ? Number(proof.source_total) : null;
  const truncated = proof.truncated || accepted.length > records.length || (total !== null && total > records.length);
  const complete = proof.complete && !truncated && !unavailable && degraded.length === 0 && (total === null || total === records.length);
  const stale = proof.freshness === "stale" || records.some(r => r.freshness === "stale" || r.freshness === "expired");
  const zero = complete && records.length === 0 && proof.freshness === "current";
  const ids = new Set(records.map(r => r.evidence_id));
  return {
    ...base, records, record_count: records.length, source_total: total,
    truncated, complete, zero_proven: zero,
    freshness: stale ? "stale" : proof.freshness,
    lifecycle: (proof.lifecycle || []).filter(r => ids.has(r.evidence_id)),
    status: unavailable && !records.length ? "unavailable" : stale ? "stale" : zero ? "available_zero" : complete && records.length > 0 ? "available_complete" : "available_partial",
    error_class: unavailable ? "source_unavailable" : degraded.length ? "source_error" : null,
    ...(degraded.length ? { degraded_sources: degraded } : {}),
  };
}

/**
 * Bound one read's acceptance window. Abort is cooperative; a collector that
 * ignores the signal may finish later. Its late value is discarded, never
 * delivered to the completed caller. No assessment state is mutated here.
 */
export async function withinEvidenceDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>, timeoutMs: number,
): Promise<{ status: "completed"; value: T } | { status: "timeout" | "error" }> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid evidence deadline");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ status: "timeout" }>(resolve => {
    timer = setTimeout(() => { resolve({ status: "timeout" }); controller.abort(); }, timeoutMs);
  });
  const pending = Promise.resolve().then(() => read(controller.signal)).then(
    value => ({ status: "completed" as const, value }),
    () => ({ status: "error" as const }),
  );
  try { return await Promise.race([pending, deadline]); }
  finally { if (timer) clearTimeout(timer); }
}
