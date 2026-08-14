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
    const predictions = detection.anomalies.map((anomaly) => predictionFromAnomaly(anomaly, {
      prediction_type: "device_reliability_risk",
      horizon: "next_7_days",
      predicted_value: `another offline/failure event ${probabilityBand(anomaly.confidence)}`,
      reasoning: `${anomaly.explanation} If this pattern continues, another failure event is ${probabilityBand(anomaly.confidence)} within the next week.`,
      modelName: "device.reliability",
      modelVersion: "v1",
    }));
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
    const predictions = detection.anomalies.map((anomaly) => predictionFromAnomaly(anomaly, {
      prediction_type: "maintenance_sla_risk",
      horizon: "until_resolved",
      predicted_value: `continued delay ${probabilityBand(anomaly.confidence)}`,
      reasoning: `${anomaly.explanation} Requests open this long are ${probabilityBand(anomaly.confidence)} to remain unresolved without follow-up.`,
      modelName: "maintenance.risk",
      modelVersion: "v1",
    }));
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
    const predictions = detection.anomalies.map((anomaly) => predictionFromAnomaly(anomaly, {
      prediction_type: "automation_failure_risk",
      horizon: "next_run",
      predicted_value: `next run failure ${probabilityBand(anomaly.confidence)}`,
      reasoning: `${anomaly.explanation} At this failure rate, the next run is ${probabilityBand(anomaly.confidence)} to fail again unless the underlying cause is addressed.`,
      modelName: "automation.reliability",
      modelVersion: "v1",
    }));
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
