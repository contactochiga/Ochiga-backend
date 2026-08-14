import { randomUUID } from "crypto";
import { generateIntelligencePredictions, type IntelligencePrediction, type IntelligencePredictionType } from "../../../intelligence-core/predictionEngine";
import type { OperationalAnomaly, OperationalPrediction, OperationalRecommendation, OperationalScope } from "../../contracts/intelligence";
import { logger } from "../../../observability/logger";
import { operationalMetrics } from "../../../observability/metrics";

// Strangler adapter (§14 of the Programme 3 spec): predictionEngine.ts is
// preserved untouched and still runs (and still persists to
// ochiga_intelligence_predictions, which Programme 3 also reuses for its
// own predictions — see predictionPersistence.ts). This only classifies
// its output into the canonical Anomaly/Prediction/Recommendation
// contracts, since the legacy engine conflates all three under one loose
// "IntelligencePrediction" shape. Every call is logged so legacy-adapter
// usage is measurable (§14: "measure legacy adapter usage").
const ANOMALY_TYPES = new Set<IntelligencePredictionType>(["device_anomaly", "camera_anomaly", "power_or_network_instability"]);
const RECOMMENDATION_TYPES = new Set<IntelligencePredictionType>(["operational_recommendation"]);
// Everything else (maintenance_risk, security_risk, visitor_pattern,
// edge_runtime_risk) is genuinely forward-looking and becomes a prediction.

const CONFIDENCE_TO_NUMBER: Record<IntelligencePrediction["confidence"], number> = {
  confirmed: 0.9,
  likely: 0.7,
  possible: 0.5,
  needs_monitoring: 0.35,
};

function scopeOf(prediction: IntelligencePrediction): OperationalScope {
  return { estate_id: prediction.estate_id || null, home_id: prediction.home_id || null, room_id: null };
}

function objectRefsOf(prediction: IntelligencePrediction) {
  const refs: Array<{ object_type: string; canonical_id: string; label: string | null }> = [];
  if (prediction.camera_id) refs.push({ object_type: "camera", canonical_id: prediction.camera_id, label: null });
  return refs;
}

function toAnomaly(prediction: IntelligencePrediction): OperationalAnomaly {
  return {
    anomaly_id: prediction.id || randomUUID(),
    domain: prediction.prediction_type === "camera_anomaly" ? "cameras" : "devices",
    anomaly_type: prediction.prediction_type,
    scope: scopeOf(prediction),
    subject: objectRefsOf(prediction)[0] || null,
    object_refs: objectRefsOf(prediction),
    generated_at: prediction.created_at || new Date().toISOString(),
    window: null,
    baseline: null,
    observed: prediction.summary,
    deviation: null,
    severity: prediction.severity,
    confidence: CONFIDENCE_TO_NUMBER[prediction.confidence] ?? 0.5,
    evidence_ids: prediction.source_event_ids,
    status: prediction.status === "acknowledged" ? "acknowledged" : prediction.status === "resolved" ? "resolved" : prediction.status === "dismissed" ? "dismissed" : "active",
    explanation: prediction.summary,
    source_model: "legacy.predictionEngine",
    source_model_version: "v1",
    limitations: ["Adapted from the legacy heuristic prediction engine, not a Programme 3 native detector."],
    payload: { legacy_prediction_type: prediction.prediction_type, legacy_id: prediction.id || null },
  };
}

function toPrediction(prediction: IntelligencePrediction): OperationalPrediction {
  return {
    prediction_id: prediction.id || randomUUID(),
    domain: prediction.prediction_type === "maintenance_risk" ? "maintenance" : prediction.prediction_type === "security_risk" ? "security" : prediction.prediction_type === "visitor_pattern" ? "visitors" : "home",
    prediction_type: prediction.prediction_type,
    scope: scopeOf(prediction),
    subject: objectRefsOf(prediction)[0] || null,
    object_refs: objectRefsOf(prediction),
    generated_at: prediction.created_at || new Date().toISOString(),
    horizon: "unspecified",
    predicted_value: prediction.recommended_action,
    probability: null,
    confidence: CONFIDENCE_TO_NUMBER[prediction.confidence] ?? 0.5,
    severity: prediction.severity,
    evidence_ids: prediction.source_event_ids,
    reasoning_summary: prediction.summary,
    model_name: "legacy.predictionEngine",
    model_version: "v1",
    model_type: "rule",
    expires_at: null,
    status: prediction.status === "acknowledged" ? "active" : prediction.status === "resolved" ? "realized" : prediction.status === "dismissed" ? "dismissed" : "active",
    limitations: ["Adapted from the legacy heuristic prediction engine, not a Programme 3 native provider."],
  };
}

function toRecommendation(prediction: IntelligencePrediction): OperationalRecommendation {
  return {
    recommendation_id: prediction.id || randomUUID(),
    domain: "home",
    scope: scopeOf(prediction),
    object_refs: objectRefsOf(prediction),
    created_at: prediction.created_at || new Date().toISOString(),
    severity: prediction.severity,
    title: prediction.title,
    summary: prediction.summary,
    reason: prediction.summary,
    evidence_ids: prediction.source_event_ids,
    suggested_action: prediction.recommended_action,
    actionability: "review",
    requires_confirmation: false,
    capability_key: null,
    expires_at: null,
    status: prediction.status === "acknowledged" ? "accepted" : prediction.status === "resolved" ? "executed" : prediction.status === "dismissed" ? "dismissed" : "open",
    dedup_key: `legacy:${prediction.prediction_type}:${prediction.estate_id || ""}:${prediction.home_id || ""}`,
  };
}

export async function runLegacyPredictionAdapter(options: { actor?: any; estate_id?: string | null; home_id?: string | null; persist?: boolean }): Promise<{ anomalies: OperationalAnomaly[]; predictions: OperationalPrediction[]; recommendations: OperationalRecommendation[]; warnings: string[] }> {
  const startedAt = Date.now();
  const result = await generateIntelligencePredictions({ actor: options.actor, estate_id: options.estate_id, home_id: options.home_id, persist: options.persist ?? true });
  const anomalies: OperationalAnomaly[] = [];
  const predictions: OperationalPrediction[] = [];
  const recommendations: OperationalRecommendation[] = [];
  for (const raw of result.predictions as IntelligencePrediction[]) {
    if (ANOMALY_TYPES.has(raw.prediction_type)) anomalies.push(toAnomaly(raw));
    else if (RECOMMENDATION_TYPES.has(raw.prediction_type)) recommendations.push(toRecommendation(raw));
    else predictions.push(toPrediction(raw));
  }
  const latencyMs = Date.now() - startedAt;
  logger.info("oyi_legacy_prediction_adapter_used", {
    estate_id: options.estate_id || null,
    home_id: options.home_id || null,
    generated_count: result.generated_count,
    persisted_count: result.persisted_count,
    anomaly_count: anomalies.length,
    prediction_count: predictions.length,
    recommendation_count: recommendations.length,
    warning_count: result.warnings.length,
    latency_ms: latencyMs,
  });
  // Programme 4 Phase J — promotes the above log line into a first-class
  // counter, per OYI_PREDICTION_LEARNING_MODEL.md's Phase C retirement
  // criteria: this adapter can only be retired once camera_anomaly and
  // power_or_network_instability have native detectors; usage must be
  // measurable to know when that's actually safe, not assumed.
  operationalMetrics.increment("oyi_legacy_prediction_adapter_calls_total");
  operationalMetrics.observe("oyi_legacy_prediction_adapter_latency_ms", latencyMs);
  return { anomalies, predictions, recommendations, warnings: result.warnings };
}
