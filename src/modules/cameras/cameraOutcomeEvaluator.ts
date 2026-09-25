// Wave 8 Slice 6 -- Camera Outcome Evaluator.
//
// Generalizes deviceOutcomeEvaluator.ts's own proven pattern (compare an
// intended target against FRESH, independently re-queried evidence from
// the authority that already owns that fact) to camera acquisition: does
// CameraCurrentStateAuthority now show this camera's video-acquisition
// capability satisfying the target a Decision/Goal named -- "restore
// trustworthy video acquisition."
//
// Authority boundary (Section 4/5 of the task, enforced structurally by
// only ever calling resolveCameraCurrentStates -- never reading
// facility_cameras.status, camera_infrastructure.health_state, legacy
// event strings, go2rtc config, or Edge availability directly):
//   overall === "healthy"    -> the frozen Wave 6 meaning (docs/
//                                WAVE6_SLICE14G_CAMERA_EDGE_FINAL_
//                                CHECKPOINT_AUDIT.md): "sufficient fresh
//                                acquisition evidence with no interpreted
//                                impairment." NEVER "camera physically
//                                powered, recorder healthy, AI inference
//                                healthy, or ONVIF control healthy" --
//                                this evaluator's own wording preserves
//                                that ceiling (see notes text below).
//   overall === "degraded"   -> fresh evidence, genuinely short of the
//                                target, but "usable evidence with
//                                supported impairment/staleness" (frozen
//                                doc) -- not a total capability loss.
//   overall === "unavailable" -> "observed video acquisition capability
//                                failure, not electrical/network death"
//                                (frozen doc) -- a real, fresh negative
//                                signal.
//   overall === "unknown"    -> "insufficient current evidence" (frozen
//                                doc) -- honestly not currently provable,
//                                never a fabricated failure.
//
// Edge-expiry invariant (Section 7/8), inherited from the authority, not
// reimplemented here: cameraCurrentState() only ever pushes overall
// toward "degraded" when Edge telemetry is impaired (never straight to
// "unavailable"), and always appends the reason
// "edge_telemetry_impaired_not_physical_camera_offline" when it does --
// this evaluator surfaces that same reasons array verbatim in its
// persisted evaluation, so a reader can always see WHY a degraded/
// unavailable verdict was reached, distinguishing stale Edge telemetry
// from a genuine acquisition failure.
//
// READ-ONLY with respect to the physical world and camera configuration:
// no provider call, no camera command, no Edge polling happens anywhere
// in this file -- resolveCameraCurrentStates() itself performs exactly
// two Supabase reads per estate batch (Section 32 -- no N+1, no
// polling).
import { logger } from "../../observability/logger";
import { operationalMetrics } from "../../observability/metrics";
import { resolveCameraCurrentStates, type CameraCurrentState } from "./cameraCurrentStateAuthority";
import { persistOutcomeEvaluations } from "../../oyi-core/domains/intelligence/outcomeFeedbackPersistence";

export type CameraOutcomeResult = "achieved" | "contradicted" | "unverified";

export type CameraOutcomeLineage = {
  cameraId: string;
  estateId: string;
  decisionId?: string | null;
  goalId?: string | null;
  canonicalSignalKey?: string | null;
};

export type CameraOutcomeEvaluationInput = { lineage: CameraOutcomeLineage };

export type CameraOutcomeEvaluation = {
  result: CameraOutcomeResult;
  observedOverall: "healthy" | "degraded" | "unavailable" | "unknown" | null;
  reasons: string[];
  observedAt: string | null;
  lineage: CameraOutcomeLineage;
  causalNote: string;
  notes: string;
  persisted: boolean;
  feedbackId: string | null;
};

// Reuses Slice 5's own real partial unique index
// (idx_intelligence_feedback_outcome_evaluation_identity, scoped to
// feedback_type='outcome_evaluation') for genuine DB-level idempotency
// -- not Slice 1's weaker application-level "select existing, insert if
// absent" pattern, which that slice's own SQL smoke explicitly disclosed
// as a best-effort race window. Reusing the SAME feedback_type literal
// Slice 5 already indexed means zero new migration while getting a
// strictly stronger guarantee: object_type differentiates every domain
// (device/prediction/camera/maintenance/visitor) under one shared,
// already-proven constraint.
export const OBJECT_TYPE = "camera_state_outcome";
export const FEEDBACK_TYPE = "outcome_evaluation";

const CAUSAL_NOTE =
  "This evaluation establishes only whether CameraCurrentStateAuthority's own observed_video_acquisition capability currently satisfies the target. " +
  "It does not establish that any Decision/Goal action caused this state, and it never claims anything about physical power, recorder health, AI inference health, or ONVIF control health -- only observed video acquisition, per the frozen Wave 6 semantic ceiling.";

// Section 23/27 -- Slice 5's real unique index constrains
// (object_type, object_id, feedback_type) with NO separate evidence
// column; it was built for outcomeEvaluation.ts's own one-shot
// prediction evaluations (a prediction is evaluated exactly once, ever,
// by construction). Camera acquisition, unlike a prediction, is
// genuinely re-evaluated many times over a target's lifetime (Section 9
// -- historical preservation requires every distinct observation to
// remain its own row, never overwritten). Folding the evidence key
// directly into object_id is what makes Slice 5's index correctly do
// BOTH jobs at once: a genuine re-insert of the EXACT SAME evidence
// collides (real idempotency, Section 23's "one factual feedback row"),
// while genuinely NEW evidence gets its own object_id and therefore its
// own row (Section 9's history requirement) -- without this, reusing
// Slice 5's index verbatim would have silently collapsed every later
// evaluation of the same camera/target into the FIRST one ever recorded.
function objectIdFor(lineage: CameraOutcomeLineage, evidenceKey: string): string {
  const lineageKey = lineage.decisionId || lineage.goalId || "no-lineage";
  return `camera:${lineage.cameraId}:target:healthy_acquisition:${lineageKey}:${evidenceKey}`;
}

function evidenceKeyFor(observedAt: string | null, overall: string): string {
  return observedAt ? `at:${observedAt}` : `overall:${overall}`;
}

function notesFor(overall: CameraCurrentState["overall"] | null, reasons: string[]): string {
  if (overall === "healthy") return "Fresh authoritative evidence shows sufficient, unimpaired video acquisition -- the target is satisfied per the frozen observed_video_acquisition ceiling only.";
  if (overall === "degraded") return `Fresh authoritative evidence shows usable but impaired acquisition -- the target is not currently satisfied. Reasons: ${reasons.join(", ") || "none recorded"}.`;
  if (overall === "unavailable") return `Fresh authoritative evidence shows an observed video-acquisition capability failure -- this describes acquisition capability only, never physical/electrical/network camera death. Reasons: ${reasons.join(", ") || "none recorded"}.`;
  return "Insufficient current evidence to assert the target is or is not satisfied -- outcome not currently provable.";
}

function resultFor(overall: CameraCurrentState["overall"] | null): CameraOutcomeResult {
  if (overall === "healthy") return "achieved";
  if (overall === "degraded" || overall === "unavailable") return "contradicted";
  return "unverified";
}

// System-actor precedent already established in this codebase
// (cameraHealthTransition.service.ts:13) for the same reason: a
// background evaluator has no end-user session, but genuinely needs
// full read access to evaluate the authority's own truth honestly.
const EVALUATOR_ACTOR = { id: "camera-outcome-evaluator", role: "system_admin" } as const;

// Batched per estate (Section 32): groups inputs by estateId so each
// estate costs exactly the SAME 2 Supabase reads resolveCameraCurrentStates
// itself already batches internally, regardless of how many cameras/
// Goals share that estate -- never one authority call per camera/Goal.
export async function evaluateCameraOutcomes(inputs: CameraOutcomeEvaluationInput[]): Promise<CameraOutcomeEvaluation[]> {
  if (!inputs.length) return [];

  const byEstate = new Map<string, CameraOutcomeEvaluationInput[]>();
  for (const input of inputs) {
    const list = byEstate.get(input.lineage.estateId) || [];
    list.push(input);
    byEstate.set(input.lineage.estateId, list);
  }

  const evaluated: Array<{ evaluation: CameraOutcomeEvaluation; evidenceKey: string; objectId: string }> = [];

  for (const [estateId, estateInputs] of byEstate.entries()) {
    const cameraIds = Array.from(new Set(estateInputs.map((i) => i.lineage.cameraId)));
    let statesByCameraId = new Map<string, CameraCurrentState>();
    try {
      const states = await resolveCameraCurrentStates(estateId, cameraIds, EVALUATOR_ACTOR);
      statesByCameraId = new Map(states.map((s) => [s.cameraId, s]));
    } catch (error) {
      logger.warn("oyi_camera_outcome_authority_read_failed", { estate_id: estateId, camera_ids: cameraIds, error });
    }

    for (const input of estateInputs) {
      const state = statesByCameraId.get(input.lineage.cameraId) || null;
      const overall = state?.overall ?? null;
      const reasons = state?.reasons ?? [];
      const observedAt = state?.observedAt ?? null;
      const result = resultFor(overall);
      const notes = notesFor(overall, reasons);
      const evidenceKey = evidenceKeyFor(observedAt, String(overall));

      evaluated.push({
        evidenceKey,
        objectId: objectIdFor(input.lineage, evidenceKey),
        evaluation: {
          result,
          observedOverall: overall,
          reasons,
          observedAt,
          lineage: input.lineage,
          causalNote: CAUSAL_NOTE,
          notes,
          persisted: false,
          feedbackId: null,
        },
      });
    }
  }

  await persistOutcomeEvaluations(evaluated, OBJECT_TYPE, FEEDBACK_TYPE, "oyi_camera_outcome", (evaluation) => ({
    domain: "camera",
    observed_overall: evaluation.observedOverall,
    reasons: evaluation.reasons,
    observed_at: evaluation.observedAt,
  }));

  const results: CameraOutcomeEvaluation[] = [];
  for (const entry of evaluated) {
    operationalMetrics.increment("oyi_camera_outcome_evaluation_total", { result: entry.evaluation.result, provenance: entry.evaluation.observedOverall || "no_evidence" });
    results.push(entry.evaluation);
  }
  return results;
}

export async function evaluateCameraOutcome(input: CameraOutcomeEvaluationInput): Promise<CameraOutcomeEvaluation> {
  const [result] = await evaluateCameraOutcomes([input]);
  return result;
}
