// Wave 8 Slice 6 -- Maintenance Outcome Evaluator.
//
// Generalizes deviceOutcomeEvaluator.ts's own proven pattern to
// maintenance resolution: does maintenance_requests's own strongest
// factual outcome authority -- verified_by_resident -- now show the
// resident confirmed the request was resolved.
//
// INTEGRITY GATE (Section 12), audited and NOT silently worked around:
// maintenance.controller.ts::updateMaintenance (the only write path for
// verified_by_resident) writes it as a plain, unconditional field on the
// same PATCH body as status/completion_summary/etc, with NO server-side
// precondition that status ever reached "completed" first -- confirmed
// by direct read of that controller. This is a genuine, present-day
// integrity gap: a row can have verified_by_resident=true with zero
// enforced completion prerequisite. This evaluator does NOT build
// learning on that untrustworthy possibility -- it applies its OWN
// read-time integrity check (hasValidCompletionSequence below) and
// refuses to treat verified_by_resident=true as achieved evidence for
// any row that fails it, honestly downgrading such a row to "unverified"
// rather than either trusting it blindly or refusing to evaluate the
// domain at all. The disclosed prerequisite for removing this defensive
// check (and safely relying on the raw column) is documented in
// docs/WAVE8_SLICE6_REMAINING_DOMAIN_OUTCOME_EVALUATORS.md: a real
// server-side CAS precondition in updateMaintenance (or a dedicated
// resident-confirmation route mirroring transitionVisitorAccessStatus's
// own CAS shape) requiring existing.status === "completed" before
// accepting verified_by_resident=true.
//
// Distinctions preserved exactly (Section 11), never merged:
//   completed_at        -> staff says work is done (WORK COMPLETED).
//   verified_at         -> a separate staff-side technical verification
//                          step (status="verified"), NOT resident
//                          confirmation.
//   verified_by_resident -> the resident's own factual confirmation of
//                          resolution (this evaluator's one supported
//                          achieved signal, subject to the integrity
//                          check above).
//   resident_rating/resident_feedback -> SUBJECTIVE satisfaction, never
//                          read by this evaluator as outcome evidence.
//
// Negative outcome (Section 14): no column in this table's real schema
// represents an explicit resident rejection/"unresolved" confirmation
// distinct from the default (false) verified_by_resident value --
// confirmed by direct schema read. Absence of verification is
// therefore honestly "unverified", never "not_achieved" -- this
// evaluator's result type has no not_achieved case for exactly this
// reason (unlike Camera/Visitor, where real negative evidence exists).
import { logger } from "../observability/logger";
import { operationalMetrics } from "../observability/metrics";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { persistOutcomeEvaluations } from "../oyi-core/domains/intelligence/outcomeFeedbackPersistence";

export type MaintenanceOutcomeResult = "achieved" | "unverified";

export type MaintenanceOutcomeLineage = {
  maintenanceRequestId: string;
  decisionId?: string | null;
  goalId?: string | null;
  canonicalSignalKey?: string | null;
};

export type MaintenanceOutcomeEvaluationInput = { lineage: MaintenanceOutcomeLineage };

export type MaintenanceOutcomeEvaluation = {
  result: MaintenanceOutcomeResult;
  status: string | null;
  completedAt: string | null;
  verifiedByResident: boolean | null;
  integritySequenceValid: boolean;
  lineage: MaintenanceOutcomeLineage;
  causalNote: string;
  notes: string;
  persisted: boolean;
  feedbackId: string | null;
};

export const OBJECT_TYPE = "maintenance_outcome";
export const FEEDBACK_TYPE = "outcome_evaluation";

const CAUSAL_NOTE =
  "This evaluation establishes only whether maintenance_requests's own resident-confirmation field currently shows resolution, subject to this evaluator's own read-time integrity check. " +
  "It does not establish that any Decision/Goal action caused the resolution, and it never treats resident_rating (subjective satisfaction) as outcome evidence.";

// Section 23/27 -- see cameraOutcomeEvaluator.ts's own objectIdFor
// comment for the full rationale: Slice 5's real unique index has no
// separate evidence column, so the evidence key must be folded directly
// into object_id for a genuinely re-evaluated target (a maintenance
// request can be re-checked many times) to get real history instead of
// silently collapsing every evaluation into the first one ever recorded.
function objectIdFor(lineage: MaintenanceOutcomeLineage, evidenceKey: string): string {
  const lineageKey = lineage.decisionId || lineage.goalId || "no-lineage";
  return `maintenance:${lineage.maintenanceRequestId}:target:resident_verified:${lineageKey}:${evidenceKey}`;
}

function evidenceKeyFor(verifiedByResident: boolean | null, completedAt: string | null, status: string | null): string {
  return `verified:${String(verifiedByResident)}:completed_at:${completedAt || "none"}:status:${status || "unknown"}`;
}

function text(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

// The narrow, disclosed prerequisite this evaluator enforces itself
// since the server does not (Section 12): a resident cannot legitimately
// confirm resolution of work that was never marked completed.
// verified_at (a separate staff-side step) is deliberately NOT required
// here -- it is an independent, optional signal, not a documented
// prerequisite for resident confirmation specifically.
function hasValidCompletionSequence(row: { completed_at: unknown }): boolean {
  return Boolean(text(row.completed_at));
}

export async function evaluateMaintenanceOutcomes(inputs: MaintenanceOutcomeEvaluationInput[]): Promise<MaintenanceOutcomeEvaluation[]> {
  if (!inputs.length) return [];

  const requestIds = Array.from(new Set(inputs.map((i) => i.lineage.maintenanceRequestId)));
  const { data: rows, error } = await supabaseAdmin
    .from("maintenance_requests")
    .select("id,status,completed_at,verified_at,verified_by_resident")
    .in("id", requestIds);
  if (error) logger.warn("oyi_maintenance_outcome_load_failed", { error, ids: requestIds });
  const byId = new Map((rows || []).map((r: any) => [String(r.id), r]));

  const evaluated: Array<{ evaluation: MaintenanceOutcomeEvaluation; evidenceKey: string; objectId: string }> = [];

  for (const input of inputs) {
    const row = byId.get(input.lineage.maintenanceRequestId) || null;
    const status = row ? text(row.status) : null;
    const completedAt = row ? text(row.completed_at) : null;
    const verifiedByResident = row ? Boolean(row.verified_by_resident) : null;
    const integrityValid = row ? hasValidCompletionSequence(row) : false;

    let result: MaintenanceOutcomeResult;
    let notes: string;

    if (!row) {
      result = "unverified";
      notes = "No maintenance_requests row resolves for this id -- outcome not currently provable, never guessed.";
    } else if (verifiedByResident && integrityValid) {
      result = "achieved";
      notes = `verified_by_resident=true with completed_at present (${completedAt}) -- a valid completion prerequisite, so resident confirmation is trusted.`;
    } else if (verifiedByResident && !integrityValid) {
      result = "unverified";
      notes = "verified_by_resident=true but completed_at is missing -- this row's resident-verification cannot be trusted without the server enforcing sequencing (disclosed integrity gate, see docs/WAVE8_SLICE6_REMAINING_DOMAIN_OUTCOME_EVALUATORS.md).";
    } else if (status === "completed") {
      result = "unverified";
      notes = "Status is completed but the resident has not confirmed resolution -- work completion is not automatically treated as the objective achieved.";
    } else {
      result = "unverified";
      notes = status
        ? `Status is "${status}" with no resident verification -- no negative factual authority exists in this schema for "unresolved," so this is honestly unverified, never not_achieved.`
        : "No status recorded -- outcome not currently provable.";
    }

    const evidenceKey = evidenceKeyFor(verifiedByResident, completedAt, status);
    evaluated.push({
      evidenceKey,
      objectId: objectIdFor(input.lineage, evidenceKey),
      evaluation: {
        result,
        status,
        completedAt,
        verifiedByResident,
        integritySequenceValid: integrityValid,
        lineage: input.lineage,
        causalNote: CAUSAL_NOTE,
        notes,
        persisted: false,
        feedbackId: null,
      },
    });
  }

  await persistOutcomeEvaluations(evaluated, OBJECT_TYPE, FEEDBACK_TYPE, "oyi_maintenance_outcome", (evaluation) => ({
    domain: "maintenance",
    status: evaluation.status,
    completed_at: evaluation.completedAt,
    verified_by_resident: evaluation.verifiedByResident,
    integrity_sequence_valid: evaluation.integritySequenceValid,
  }));

  const results: MaintenanceOutcomeEvaluation[] = [];
  for (const entry of evaluated) {
    operationalMetrics.increment("oyi_maintenance_outcome_evaluation_total", { result: entry.evaluation.result, provenance: entry.evaluation.integritySequenceValid ? "valid_sequence" : "no_valid_sequence" });
    results.push(entry.evaluation);
  }
  return results;
}

export async function evaluateMaintenanceOutcome(input: MaintenanceOutcomeEvaluationInput): Promise<MaintenanceOutcomeEvaluation> {
  const [result] = await evaluateMaintenanceOutcomes([input]);
  return result;
}
