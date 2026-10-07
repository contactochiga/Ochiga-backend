import type { EvidenceReadOutcome, EvidenceScopeClass } from "../../contracts/evidence";

// IQ-3B governed evidence planner contracts. The planner decides WHAT authorised evidence to
// gather for an assessment the IQ-2 context already understands. It never ranks, scores or judges.

export type Necessity = "mandatory" | "optional";

// Per-class result. Distinct states are deliberate: they must never be collapsed for IQ-4.
export type ClassStatus =
  | "MANDATORY_COMPLETE_ENOUGH"      // every source returned a proven complete/zero result
  | "MANDATORY_PARTIAL"              // evidence exists but is partial/truncated/stale/degraded
  | "MANDATORY_UNAVAILABLE"          // a source exists but failed, timed out or was denied
  | "MANDATORY_MISSING_CAPABILITY"   // no safe certified source exists (known product debt or not certified)
  | "OPTIONAL_GATHERED"
  | "OPTIONAL_UNAVAILABLE";

export type PlanStatus = "MANDATORY_COMPLETE_ENOUGH" | "MANDATORY_PARTIAL" | "MANDATORY_UNAVAILABLE" | "MANDATORY_MISSING_CAPABILITY" | "NO_EVIDENCE_REQUIRED";

export type Requirement = { class: string; necessity: Necessity; reason: string };

export type PlanStep = {
  step_id: string;
  class: string;
  necessity: Necessity;
  source_key: string;
  scope_class: EvidenceScopeClass;
  selection_reason: string;
  scope_label?: string | null;
};

export type UnresolvedClass = {
  class: string;
  necessity: Necessity;
  reason: "known_product_debt" | "no_certified_source" | "not_authorised" | "scope_unsupported" | "scope_insufficient" | "room_unresolved" | "fan_out_bound" | "composite_not_planner_source";
  detail: string;
};

export type EvidencePlan = {
  version: 1;
  plan_id: string;
  objective: string;
  surface: string;
  scope_key: string;
  subject_key: string;
  broad: boolean;
  requirements: Requirement[];
  steps: PlanStep[];
  unresolved: UnresolvedClass[];
  notes: string[];
};

export type ContributionStatus = EvidenceReadOutcome["status"] | "not_run_fan_out_bound";

export type CompactRef = { t: string | null; id: string | null; l: string | null };

export type Contribution = {
  source_key: string;
  evidence_class: string;
  necessity: Necessity;
  status: ContributionStatus;
  availability: "available" | "unavailable" | "denied" | "unsupported_scope" | "timeout" | "error";
  completeness: "complete" | "partial" | "zero_proven" | "unknown";
  freshness: "current" | "stale" | "historical" | "unknown";
  scope_class: EvidenceScopeClass;
  lifecycle: { active: number; historical: number; unknown: number };
  scope_label?: string | null;
  record_count: number;
  // Records the source returned but whose CURRENT state has no observation (unknown/unobservable).
  unobserved: number;
  source_total: number | null;
  truncated: boolean;
  degraded: string[];
  refs: CompactRef[];
  material: Array<Record<string, string | number | boolean | null>>;
  provenance: Array<Record<string, unknown>>;
  gathered_at: string;
  fresh_until: string;
  latency_ms: number;
  reused?: boolean;
};

export type ClassOutcome = {
  class: string;
  necessity: Necessity;
  status: ClassStatus;
  sources: string[];
  reason: string | null;
};

// The ONLY evidence-plan state persisted (inside the existing ephemeral assessment context).
// Compact by construction: counts, safe references and a small allowlisted field projection.
export type CompactEvidencePlanState = {
  v: 1;
  plan_id: string;
  gathered_at: string;
  expires_at: string;
  scope_key: string;
  subject_key: string;
  input_fingerprint: string | null;
  material_hash: string | null;
  objective: string;
  surface: string;
  status: PlanStatus;
  classes: ClassOutcome[];
  contributions: Contribution[];
  missing_mandatory: string[];
  optional_unavailable: string[];
  cannot_conclude: string[];
  requested_not_honoured: string[];
  limits: { max_sources: number; per_source_ms: number; overall_ms: number; max_records_per_source: number; max_material_items: number };
  stats: { sources_planned: number; sources_attempted: number; sources_reused: number; success: number; partial: number; error: number; denied: number; timeout: number; latency_ms: number };
  invalidation: string[];
};

export type PlannerLimits = CompactEvidencePlanState["limits"];
