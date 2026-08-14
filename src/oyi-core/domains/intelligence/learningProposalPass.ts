import { logger } from "../../../observability/logger";
import { summarizeEvaluatedPredictionsByType } from "./outcomeEvaluation";
import { getLearningParameter, proposeLearningParameterAdjustment } from "./learningParameters";

// Programme 4 Phase I — closes the "Not Completed In Programme 3" gap:
// "no automated loop yet proposes adjustments from real outcome data."
// This is the automated PROPOSAL step only. It never promotes a proposal —
// promoteLearningParameter is never imported or called here. Promotion
// stays an explicit, separately-invoked human action, exactly as
// learningParameters.ts already documents and enforces.

// Exactly the three prediction types outcomeEvaluation.ts actually
// evaluates (device_reliability_risk, maintenance_sla_risk,
// automation_failure_risk) — proposing a calibration for a type with no
// real evaluator would fabricate learning from nothing.
const EVALUABLE_PREDICTION_TYPES = ["device_reliability_risk", "maintenance_sla_risk", "automation_failure_risk"] as const;

const MIN_SAMPLE_THRESHOLD = Math.max(1, Number(process.env.OYI_LEARNING_MIN_SAMPLE_THRESHOLD || 20));

function parameterNameFor(predictionType: string) {
  // Under the "prediction." namespace learningParameters.ts already
  // recognizes; confidence calibration only, never a risk/authority/
  // permission-shaped name (assertLearnableParameter rejects those
  // regardless, but this naming keeps the proposal legible on its own).
  return `prediction.${predictionType}.confidence_calibration`;
}

export type LearningProposalOutcome =
  | { prediction_type: string; status: "proposed"; parameter_name: string; sample_size: number; accuracy: number; evidence_basis: Record<string, unknown> }
  | { prediction_type: string; status: "insufficient_evidence"; sample_size: number; threshold: number }
  | { prediction_type: string; status: "propose_failed"; sample_size: number };

export async function runLearningProposalPass(): Promise<{ outcomes: LearningProposalOutcome[] }> {
  const outcomes: LearningProposalOutcome[] = [];

  for (const predictionType of EVALUABLE_PREDICTION_TYPES) {
    const summary = await summarizeEvaluatedPredictionsByType(predictionType);
    if (summary.unavailable || summary.total < MIN_SAMPLE_THRESHOLD || summary.accuracy == null) {
      outcomes.push({ prediction_type: predictionType, status: "insufficient_evidence", sample_size: summary.total, threshold: MIN_SAMPLE_THRESHOLD });
      continue;
    }

    const parameterName = parameterNameFor(predictionType);
    // Ensure the parameter row exists with real [0,1] bounds BEFORE
    // proposing — proposeLearningParameterAdjustment creates the row
    // without bounds on first use if it doesn't already exist, which
    // would make clampToBounds a no-op for a brand-new parameter. The
    // fallback current_value on first creation is a neutral 0.5, never
    // the freshly-computed accuracy — current_value must only ever move
    // via an explicit, separately-invoked promoteLearningParameter call,
    // never as a side effect of seeding a row for a proposal.
    await getLearningParameter(parameterName, { estate_id: null, home_id: null }, 0.5, { min: 0, max: 1 });

    const evidenceBasis = {
      method: "empirical_accuracy_calibration",
      sample_size: summary.total,
      realized: summary.realized,
      not_realized: summary.not_realized,
      accuracy: summary.accuracy,
      evaluated_at: new Date().toISOString(),
    };

    const result = await proposeLearningParameterAdjustment(parameterName, { estate_id: null, home_id: null }, summary.accuracy, evidenceBasis);
    if (result.ok) {
      outcomes.push({ prediction_type: predictionType, status: "proposed", parameter_name: parameterName, sample_size: summary.total, accuracy: summary.accuracy, evidence_basis: evidenceBasis });
    } else {
      outcomes.push({ prediction_type: predictionType, status: "propose_failed", sample_size: summary.total });
    }
  }

  logger.info("oyi_learning_proposal_pass_completed", {
    proposed: outcomes.filter((o) => o.status === "proposed").length,
    insufficient_evidence: outcomes.filter((o) => o.status === "insufficient_evidence").length,
    failed: outcomes.filter((o) => o.status === "propose_failed").length,
  });

  return { outcomes };
}
