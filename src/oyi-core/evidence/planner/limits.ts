import type { PlannerLimits } from "./types";

// Fan-out and deadline limits. Values come from measurement (docs/INTELLIGENCE_QUALITY_V1_IQ3B.md,
// "Performance"): the largest plan the policy can produce is 8 sources; Office snapshot reads are
// in-memory; database-backed reads measure single-digit milliseconds on the fixture and the only
// network source (the public development listing) carries its own 4s provider timeout, so the
// per-source deadline bounds it. The overall deadline bounds the parallel wall time, not the sum.
export const PLANNER_LIMITS: PlannerLimits = Object.freeze({
  // Never the whole registry, never an optional source "because capacity remains".
  max_sources: 8,
  // Single-source acceptance deadline (readEvidence default is 2000ms; a planner read is tighter).
  per_source_ms: 1500,
  // Parallel wall-clock bound for the entire evidence plan; unfinished sources are marked timeout.
  overall_ms: 3000,
  // IQ-3A source acceptance bound (MAX_EVIDENCE_READ_RECORDS); the bundle projects far fewer.
  max_records_per_source: 50,
  // Normalised material items kept per source in the compact bundle (and so in persisted state).
  max_material_items: 8,
});

export const MAX_REFS_PER_SOURCE = 10;
export const MAX_STRING = 80;
