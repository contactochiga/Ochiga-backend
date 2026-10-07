// IQ-4 bounded judgment contracts. Judgment is ADVISORY and EVIDENCE-LINKED: it may only cite evidence the
// IQ-3B bundle holds, never retrieves, never mutates, and never persists reasoning text beyond a concise,
// evidence-linked rationale per candidate.

export type Dimension = "lifecycle" | "importance" | "time_pressure" | "readiness" | "recency" | "observability";
export type Level = string;

// What a candidate/evidence reference points at. Only ids the bundle itself issued are valid.
export type EvidenceEntry = {
  ref: string;                 // e1.. (a material item) or s1.. (a whole source summary)
  kind: "item" | "source";
  source_key: string;
  evidence_class: string;
  item_index: number | null;
  label: string | null;
  fields: Record<string, string | number | boolean | null>;
  availability: "available";   // only AVAILABLE evidence is indexed: denied/unavailable sources can never be cited
  completeness: string;
  caller_supplied: boolean;
};

export type Factor = { dimension: Dimension; level: Level; basis: "typed"; eref: string };

export type Candidate = {
  cid: string;                 // c1..
  kind: "issue" | "task" | "event" | "business" | "opportunity";
  evidence_class: string;
  source_key: string;
  ref: { t: string | null; id: string | null; label: string | null };
  evidence: string[];
  factors: Factor[];
  // Short free-text the source itself recorded (reason/status/label). Quoted evidence, never a typed fact.
  signals: Array<{ eref: string; text: string }>;
  needs_comparative_judgment: boolean;
};

export type JudgmentMode = "deterministic" | "provider" | "bounded_no_provider" | "insufficient" | "fallback_after_rejection";
export type JudgmentStatus = "JUDGED" | "BOUNDED" | "INSUFFICIENT" | "CLARIFICATION_NEEDED";

export type RankedItem = {
  cid: string; rank: number; tier: number; ref: Candidate["ref"]; rationale: string;
  factors: Array<{ dimension: Dimension; level: Level }>; supporting: string[]; counter: string[]; uncertainties: string[];
};

export type JudgmentResult = {
  v: 1;
  assessment_id: string;       // the evidence plan id this judgment is derived from
  objective: string;
  mode: JudgmentMode;
  status: JudgmentStatus;
  candidates: Array<{ cid: string; ref: Candidate["ref"]; state: "needs_attention" | "not_a_current_concern" | "cannot_confirm"; basis: string; evidence: string[] }>;
  ranking: RankedItem[] | null;
  tied_groups: string[][];
  conclusion: string;
  rationale: string[];
  uncertainties: string[];
  limitations: string[];
  clarification: string | null;
  evidence_refs: string[];
  // IQ-5: the candidates the composed answer actually NAMES, in the order named (what a later reference points at).
  presented?: Array<{ cid: string; group: ArtifactGroup }>;
};

// The canonical DERIVED assessment artifact (IQ-4 minted rankings; IQ-5 generalises it, it is still the ONE derived state). It
// is a distinct cognitive object: never the raw result set it was derived from, so "the second one" can mean "the second
// priority" unambiguously. It holds only safe references, short evidence-linked rationale and compact typed factors; never raw
// evidence and never a reasoning chain.
export type ArtifactGroup = "ranked" | "compared" | "attention" | "past" | "wait";
export type ArtifactItem = {
  rank: number; tier: number; ref: Candidate["ref"]; rationale: string; factors: Array<{ dimension: Dimension; level: Level }>;
  // IQ-5: where the item sat in what was PRESENTED, so a later reference resolves against the human referent (the answer as given).
  group?: ArtifactGroup; state?: "needs_attention" | "not_a_current_concern" | "cannot_confirm"; kind?: Candidate["kind"]; source_key?: string; evidence?: string[];
};
export type DerivedRanking = {
  v: 1;
  ranking_id: string;
  // ranking: ordered by judgment; comparison: the named pair (no order is claimed); assessment_set: the items named, in the order named.
  artifact_type?: "ranking" | "comparison" | "assessment_set";
  ordered?: boolean;
  assessment_id: string;       // evidence bundle version (plan id) the artifact was derived from
  objective: string;
  basis: "deterministic" | "provider";
  scope_key: string;
  subject_key: string;
  surface?: string;
  scope_binding?: string;      // hash of surface + estate + home: checked on every dereference
  source_keys?: string[];      // sources the items came from: authority is re-checked against these on every dereference
  created_at: string;
  updated_at?: string;
  expires_at: string;
  items: ArtifactItem[];
  tied_groups: number;
  limitations: string[];
  uncertainties?: string[];
  // Reference state (IQ-5). `focus` is the rank last referred to; `parked` means a different subject is now active; `stale`
  // means the judgment was made before something that may change it (a material fact) and has NOT been reassessed.
  focus?: number | null;
  parked?: boolean;
  stale?: { reason: "material_fact" | "evidence_changed"; at: string } | null;
  // IQ-6: after a successful reassessment the replaced artifact is kept as the single historical one; the new one records where it came from.
  historical?: { superseded_by: string; at: string; reason: "material_fact" | "correction" } | null;
  reassessed_from?: string | null;
};

export type JudgmentOutcome = {
  result: JudgmentResult;
  text: string;
  ranking_artifact: DerivedRanking | null;
  validation: { ok: boolean; failures: string[] };
  provider: { attempted: boolean; name: string | null; latency_ms: number | null; failure_class: string | null };
  candidate_count: number;
  evidence_source_count: number;
  latency_ms: number;
};
