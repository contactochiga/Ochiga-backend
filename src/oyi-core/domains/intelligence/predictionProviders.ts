import { randomUUID } from "crypto";
import type { OperationalAnomaly, OperationalPrediction } from "../../contracts/intelligence";
import type { PredictionProvider, ProviderContext, ProviderResult } from "./predictionProviderTypes";
import type { DetectorContext } from "./detectorTypes";
import {
  deviceOfflineClusterDetector,
  maintenanceAgingDetector,
  automationFailureRateDetector,
  securityIncidentFrequencyDetector,
} from "./anomalyDetectors";
import { getLearningParameterCached, type LearningParameter } from "./learningParameters";

// A prediction provider turns a detector's CURRENT-deviation anomalies into
// a genuinely forward-looking estimate — never just relabels the anomaly.
// Confidence -> probability language mapping is fixed and documented here
// (§22): this is NOT an invented exact probability from a qualitative
// label, it's a deliberately coarse, defensible band.
function probabilityBand(confidence: number): "possible" | "likely" | "needs_monitoring" {
  if (confidence >= 0.65) return "likely";
  if (confidence >= 0.45) return "possible";
  return "needs_monitoring";
}

// Wave 8 Slice 5 -- the one real reasoning consumer of a promoted
// learning parameter (docs/WAVE8_SLICE5_LEARNING_PARAMETER_CONSUMER.md).
// learningProposalPass.ts already proposes prediction.<type>.
// confidence_calibration from real, evidence-backed accuracy (realized /
// total, over evaluated predictions of that type). This function ONLY
// uses a promoted value to scale the raw anomaly confidence fed into
// probabilityBand() when composing this prediction's advisory
// predicted_value/reasoning TEXT -- it never touches the persisted
// numeric `confidence` field itself (that stays anomaly.confidence,
// unchanged, exactly as before this slice), which is what ranking,
// severity comparisons, and awareness elsewhere in oyi-core actually
// depend on. This is "recommendation ordering NOT recommendation
// factual content" / "prediction threshold NOT state truth" (§16),
// applied as narrowly as the category allows: it changes only the words
// a human reads, never any authority- or truth-relevant field.
//
// NEUTRAL (0.5) is both the fallback value AND the value that produces a
// no-op scale factor (1.0) -- so "no row" / "not yet promoted" / "value
// out of range" all fall through to the exact pre-slice behavior,
// byte-for-byte (§14/§15).
const NEUTRAL_CALIBRATION = 0.5;

function applyCalibration(parameter: LearningParameter, rawConfidence: number): number {
  const value = parameter.current_value;
  if (parameter.rollout_stage !== "enabled" || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return rawConfidence;
  }
  const scale = value / NEUTRAL_CALIBRATION;
  return Math.max(0, Math.min(1, rawConfidence * scale));
}

// Exactly ONE parameter-storage read per provider.evaluate() invocation
// (cached besides -- see learningParameters.ts's getLearningParameterCached),
// never per anomaly/prediction item (§29) -- the returned parameter is
// applied to every anomaly this call produces via applyCalibration()
// above, a pure, synchronous function.
async function loadCalibration(predictionType: string): Promise<LearningParameter> {
  return getLearningParameterCached(`prediction.${predictionType}.confidence_calibration`, { estate_id: null, home_id: null }, NEUTRAL_CALIBRATION, { min: 0, max: 1 });
}

function detectorContextFrom(context: ProviderContext): DetectorContext {
  return { input: context.input, oisContext: context.oisContext, contract: context.contract, scope: context.scope };
}

function predictionFromAnomaly(anomaly: OperationalAnomaly, input: { prediction_type: string; horizon: string; predicted_value: string; reasoning: string; modelName: string; modelVersion: string }): OperationalPrediction {
  return {
    prediction_id: randomUUID(),
    domain: anomaly.domain,
    prediction_type: input.prediction_type,
    scope: anomaly.scope,
    subject: anomaly.subject,
    object_refs: anomaly.object_refs,
    generated_at: new Date().toISOString(),
    horizon: input.horizon,
    predicted_value: input.predicted_value,
    probability: null,
    confidence: anomaly.confidence,
    severity: anomaly.severity,
    evidence_ids: anomaly.evidence_ids,
    reasoning_summary: input.reasoning,
    model_name: input.modelName,
    model_version: input.modelVersion,
    model_type: "rule",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    status: "active",
    limitations: ["Rule-based estimate from recent event history, not a statistical model."],
  };
}

export const deviceReliabilityProvider: PredictionProvider = {
  id: "device.reliability",
  version: "v1",
  domains: ["devices"],
  requiredEvidence: ["device_events"],
  evaluate: async (context: ProviderContext): Promise<ProviderResult> => {
    const detection = await deviceOfflineClusterDetector.detect(detectorContextFrom(context));
    if (detection.data_quality === "unavailable") return { predictions: [], data_quality: "unavailable" };
    const calibration = await loadCalibration("device_reliability_risk");
    const predictions = detection.anomalies.map((anomaly) => {
      const bandConfidence = applyCalibration(calibration, anomaly.confidence);
      return predictionFromAnomaly(anomaly, {
        prediction_type: "device_reliability_risk",
        horizon: "next_7_days",
        predicted_value: `another offline/failure event ${probabilityBand(bandConfidence)}`,
        reasoning: `${anomaly.explanation} If this pattern continues, another failure event is ${probabilityBand(bandConfidence)} within the next week.`,
        modelName: "device.reliability",
        modelVersion: "v1",
      });
    });
    return { predictions, data_quality: detection.data_quality };
  },
};

export const maintenanceRiskProvider: PredictionProvider = {
  id: "maintenance.risk",
  version: "v1",
  domains: ["maintenance"],
  requiredEvidence: ["maintenance_requests"],
  evaluate: async (context: ProviderContext): Promise<ProviderResult> => {
    const detection = await maintenanceAgingDetector.detect(detectorContextFrom(context));
    if (detection.data_quality === "unavailable") return { predictions: [], data_quality: "unavailable" };
    const calibration = await loadCalibration("maintenance_sla_risk");
    const predictions = detection.anomalies.map((anomaly) => {
      const bandConfidence = applyCalibration(calibration, anomaly.confidence);
      return predictionFromAnomaly(anomaly, {
        prediction_type: "maintenance_sla_risk",
        horizon: "until_resolved",
        predicted_value: `continued delay ${probabilityBand(bandConfidence)}`,
        reasoning: `${anomaly.explanation} Requests open this long are ${probabilityBand(bandConfidence)} to remain unresolved without follow-up.`,
        modelName: "maintenance.risk",
        modelVersion: "v1",
      });
    });
    return { predictions, data_quality: detection.data_quality };
  },
};

export const automationReliabilityProvider: PredictionProvider = {
  id: "automation.reliability",
  version: "v1",
  domains: ["automations"],
  requiredEvidence: ["consumer_automation_runs"],
  evaluate: async (context: ProviderContext): Promise<ProviderResult> => {
    const detection = await automationFailureRateDetector.detect(detectorContextFrom(context));
    if (detection.data_quality === "unavailable") return { predictions: [], data_quality: "unavailable" };
    const calibration = await loadCalibration("automation_failure_risk");
    const predictions = detection.anomalies.map((anomaly) => {
      const bandConfidence = applyCalibration(calibration, anomaly.confidence);
      return predictionFromAnomaly(anomaly, {
        prediction_type: "automation_failure_risk",
        horizon: "next_run",
        predicted_value: `next run failure ${probabilityBand(bandConfidence)}`,
        reasoning: `${anomaly.explanation} At this failure rate, the next run is ${probabilityBand(bandConfidence)} to fail again unless the underlying cause is addressed.`,
        modelName: "automation.reliability",
        modelVersion: "v1",
      });
    });
    return { predictions, data_quality: detection.data_quality };
  },
};

export const securityPatternProvider: PredictionProvider = {
  id: "security.pattern",
  version: "v1",
  domains: ["security"],
  requiredEvidence: ["facility_incidents"],
  evaluate: async (context: ProviderContext): Promise<ProviderResult> => {
    const detection = await securityIncidentFrequencyDetector.detect(detectorContextFrom(context));
    if (detection.data_quality === "unavailable") return { predictions: [], data_quality: "unavailable" };
    // Deliberately conservative — a prediction here is framed as "needs
    // review", never as a threat forecast (§26: security predictions must
    // be conservative).
    const predictions = detection.anomalies.map((anomaly) => predictionFromAnomaly(anomaly, {
      prediction_type: "security_review_needed",
      horizon: "current",
      predicted_value: "review recommended",
      reasoning: `${anomaly.explanation} This needs review — not an automatic escalation or threat forecast.`,
      modelName: "security.pattern",
      modelVersion: "v1",
    }));
    return { predictions, data_quality: detection.data_quality };
  },
};

export const PREDICTION_PROVIDERS: PredictionProvider[] = [
  deviceReliabilityProvider,
  maintenanceRiskProvider,
  automationReliabilityProvider,
  securityPatternProvider,
];
