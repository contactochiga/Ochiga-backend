import type { StateConcept } from "../interpretation/conceptLexicon";

// IQ-8D structured RESULT ENVELOPE: the outcome of a capability / answer path, in the form a response can be projected from. It is NOT the IQ-3
// evidence bundle (which supports cognition and judgment). It carries only truth the capabilities already hold: no field is mandatory, nothing
// is inferred from prose, nothing is fabricated. Capabilities own the truth; the mapper only moves it into this shape.

export type Availability = "answered" | "empty" | "unavailable" | "unsupported" | "denied" | "partial";
export type CapabilityStatus = "enabled" | "declared";
export type LimitationKind = "UNAVAILABLE" | "MISSING_CAPABILITY" | "UNSUPPORTED_SCOPE" | "INSUFFICIENT_SCOPE" | "PARTIAL" | "PROVIDER_REQUIRED" | "AUTHORITY_DENIED" | "AMBIGUOUS" | "STALE" | "UNOBSERVED";
export type Limitation = { kind: LimitationKind; label?: string };
export type EnvelopeRecord = { id?: string | null; label: string; status?: string | null; state?: StateConcept | null; detail?: string | null; time?: string | null; fields?: Record<string, string | number | boolean | null> };

export type ResultEnvelope = {
  v: 1;
  capability_key: string;
  availability: Availability;
  capability_status: CapabilityStatus;         // declared = the capability exists on paper but is not implemented
  truth_state?: string;                        // observed / confirmed / unavailable / unsupported ... as the capability reported it
  subject: { domain: string | null; object_class: string | null; noun: string; singular: string; population?: string | null; facets: string[] };
  records?: EnvelopeRecord[];
  count?: number;
  total_count?: number | null;                 // only when the source knows it
  total_qualifier?: string | null;             // what total_count counts ("open")
  truncated?: boolean;
  value?: { amount: number; currency: string; as_of?: string | null; label?: string; frozen?: boolean };
  state_facts?: { fresh?: number; stale?: number; unobserved?: number };
  scope?: { label?: string | null };
  limitations?: Limitation[];
  provenance?: { sources: string[] };
  held_facts?: { known: Record<string, string>; missing: string[] | null; constraints: string[]; objective_type?: string };
  actions?: { workflow_id?: string | null; action_id?: string | null };
  hints?: { permission_only?: boolean; requires_judgment?: boolean; is_selection_only?: boolean; aggregate_only?: boolean };
  legacy_prose: string;                        // the capability's own sentence: supporting detail / fallback, never parsed
};

/** What the structured response contract tells a certifier, independent of wording: success vs honest limitation vs denial. */
export function responseContract(e: ResultEnvelope) {
  const outcome = e.availability === "answered" || e.availability === "empty" || e.availability === "partial" ? (e.capability_status === "declared" ? "HONEST_LIMITATION" : "CAPABILITY_SUCCESS")
    : e.availability === "denied" ? "AUTHORITY_DENIED" : "HONEST_LIMITATION";
  return { outcome, availability: e.availability, capability_status: e.capability_status, truth_state: e.truth_state ?? null, limitation_kinds: (e.limitations || []).map(l => l.kind), capability_key: e.capability_key };
}
