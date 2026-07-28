export type PredictionClassification = "rule" | "trend" | "anomaly" | "forecast" | "prediction" | "recommendation";

export type CanonicalPredictionTruth = {
  prediction_type: PredictionClassification;
  target: Record<string, unknown>;
  horizon: string | null;
  confidence: number;
  baseline: Record<string, unknown>;
  input_window: string | null;
  evidence: Array<Record<string, unknown>>;
  method: string;
  generated_at: string;
  valid_until: string | null;
  verification_criteria: string;
  outcome: Record<string, unknown>;
  calibration_result: Record<string, unknown>;
  user_facing_label: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function classifyPredictionPayload(payload: Record<string, unknown>, generatedAt = new Date().toISOString()): CanonicalPredictionTruth {
  const evidence = Array.isArray(payload.evidence) ? payload.evidence.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
  const method = text(payload.method || payload.model || payload.algorithm || payload.prediction_type);
  const hasHorizon = Boolean(text(payload.horizon || payload.valid_until || payload.expires_at));
  const hasOutcome = Boolean(text(payload.verification_criteria || payload.outcome_metric));
  const confidence = typeof payload.confidence === "number" ? Math.max(0, Math.min(1, payload.confidence)) : evidence.length >= 3 ? 0.7 : 0.45;
  const predictionType: PredictionClassification =
    /recommend/.test(method) ? "recommendation"
    : /anomaly/.test(method) ? "anomaly"
    : /trend/.test(method) ? "trend"
    : hasHorizon && hasOutcome && evidence.length >= 3 ? "forecast"
    : hasHorizon && evidence.length >= 3 ? "prediction"
    : "rule";
  return {
    prediction_type: predictionType,
    target: (payload.target && typeof payload.target === "object" && !Array.isArray(payload.target) ? payload.target : {}) as Record<string, unknown>,
    horizon: text(payload.horizon || payload.valid_until || payload.expires_at) || null,
    confidence,
    baseline: (payload.baseline && typeof payload.baseline === "object" && !Array.isArray(payload.baseline) ? payload.baseline : {}) as Record<string, unknown>,
    input_window: text(payload.input_window || payload.window) || null,
    evidence,
    method: method || (predictionType === "rule" ? "deterministic_rule" : "unknown_method"),
    generated_at: generatedAt,
    valid_until: text(payload.valid_until || payload.expires_at) || null,
    verification_criteria: text(payload.verification_criteria) || "No measurable verification criteria supplied.",
    outcome: (payload.outcome && typeof payload.outcome === "object" && !Array.isArray(payload.outcome) ? payload.outcome : {}) as Record<string, unknown>,
    calibration_result: (payload.calibration_result && typeof payload.calibration_result === "object" && !Array.isArray(payload.calibration_result) ? payload.calibration_result : {}) as Record<string, unknown>,
    user_facing_label: predictionType === "rule" ? "Rule-based notice" : predictionType === "forecast" ? "Forecast" : predictionType,
  };
}
