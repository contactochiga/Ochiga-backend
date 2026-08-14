import { randomUUID } from "crypto";
import type { OperationalAnomaly, OperationalPrediction, OperationalForecast, OperationalRecommendation } from "../../contracts/intelligence";

const SEVERITY_RANK: Record<OperationalRecommendation["severity"], number> = { critical: 3, warning: 2, attention: 1, info: 0 };

function recommendationFromAnomaly(anomaly: OperationalAnomaly): OperationalRecommendation | null {
  if (anomaly.severity === "info") return null;
  const subjectLabel = anomaly.subject?.label || anomaly.object_refs[0]?.label || "this item";
  return {
    recommendation_id: randomUUID(),
    domain: anomaly.domain,
    scope: anomaly.scope,
    object_refs: anomaly.object_refs,
    created_at: anomaly.generated_at,
    severity: anomaly.severity,
    title: `Review ${subjectLabel}`,
    summary: anomaly.explanation,
    reason: anomaly.deviation || anomaly.explanation,
    evidence_ids: anomaly.evidence_ids,
    suggested_action: `Look into ${subjectLabel} — ${anomaly.observed || anomaly.explanation}`,
    actionability: "review",
    requires_confirmation: false,
    capability_key: null,
    expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    status: "open",
    dedup_key: `anomaly:${anomaly.domain}:${anomaly.anomaly_type}:${anomaly.object_refs[0]?.canonical_id || anomaly.scope.home_id || anomaly.scope.estate_id || ""}`,
  };
}

function recommendationFromPrediction(prediction: OperationalPrediction): OperationalRecommendation | null {
  if (prediction.status !== "active" || (prediction.severity !== "warning" && prediction.severity !== "critical")) return null;
  const subjectLabel = prediction.subject?.label || prediction.object_refs[0]?.label || "this item";
  return {
    recommendation_id: randomUUID(),
    domain: prediction.domain,
    scope: prediction.scope,
    object_refs: prediction.object_refs,
    created_at: prediction.generated_at,
    severity: prediction.severity,
    title: `Prepare for possible issue with ${subjectLabel}`,
    summary: prediction.reasoning_summary,
    reason: prediction.reasoning_summary,
    evidence_ids: prediction.evidence_ids,
    suggested_action: `Consider checking ${subjectLabel} before ${prediction.horizon.replace(/_/g, " ")}.`,
    actionability: "review",
    requires_confirmation: false,
    capability_key: null,
    expires_at: prediction.expires_at,
    status: "open",
    dedup_key: `prediction:${prediction.domain}:${prediction.prediction_type}:${prediction.object_refs[0]?.canonical_id || prediction.scope.home_id || prediction.scope.estate_id || ""}`,
  };
}

// Only surfaces a forecast-derived recommendation when the predicted value
// meaningfully exceeds the naive baseline (>=20%) — a flat or declining
// forecast is not something anyone needs to act on.
function recommendationFromForecast(forecast: OperationalForecast): OperationalRecommendation | null {
  if (forecast.status !== "active" || !forecast.baseline) return null;
  const predicted = forecast.predicted_values[0];
  const baseline = forecast.baseline.values[0];
  if (!(baseline > 0) || predicted <= baseline * 1.2) return null;
  const pctUp = Math.round(((predicted - baseline) / baseline) * 100);
  return {
    recommendation_id: randomUUID(),
    domain: forecast.domain,
    scope: forecast.scope,
    object_refs: forecast.object_refs,
    created_at: forecast.generated_at,
    severity: pctUp >= 50 ? "warning" : "attention",
    title: `${forecast.metric.replace(/_/g, " ")} trending up`,
    summary: `The ${forecast.metric.replace(/_/g, " ")} forecast for ${forecast.forecast_horizon.replace(/_/g, " ")} is about ${pctUp}% above the recent baseline.`,
    reason: `Forecast method ${forecast.method} projects ${predicted} vs a baseline of ${baseline}.`,
    evidence_ids: forecast.evidence_ids,
    suggested_action: `Review recent ${forecast.metric.replace(/_/g, " ")} activity if this trend is unexpected.`,
    actionability: "informational",
    requires_confirmation: false,
    capability_key: null,
    expires_at: forecast.time_points[forecast.time_points.length - 1] || null,
    status: "open",
    dedup_key: `forecast:${forecast.domain}:${forecast.metric}:${forecast.scope.home_id || forecast.scope.estate_id || ""}`,
  };
}

// Combines anomalies + predictions + forecasts + legacy-adapter
// recommendations into one deduped, ranked list. Never produces anything
// with actionability "actionable" itself — capability_key stays null
// throughout Programme 3 (see legacyPredictionAdapter.ts and Phase L
// capability wiring for why: no capability is registered against these
// yet, so nothing here can be mistaken for something the system could
// execute). Dedup keeps the highest-severity, most-recent entry per key —
// never silently drops a more severe finding in favor of an older one.
export function buildRecommendations(input: {
  anomalies: OperationalAnomaly[];
  predictions: OperationalPrediction[];
  forecasts: OperationalForecast[];
  legacyRecommendations: OperationalRecommendation[];
}): OperationalRecommendation[] {
  const generated = [
    ...input.anomalies.map(recommendationFromAnomaly),
    ...input.predictions.map(recommendationFromPrediction),
    ...input.forecasts.map(recommendationFromForecast),
  ].filter((value): value is OperationalRecommendation => Boolean(value));

  const all = [...generated, ...input.legacyRecommendations];
  const byKey = new Map<string, OperationalRecommendation>();
  for (const recommendation of all) {
    const existing = byKey.get(recommendation.dedup_key);
    if (!existing) {
      byKey.set(recommendation.dedup_key, recommendation);
      continue;
    }
    const existingRank = SEVERITY_RANK[existing.severity];
    const nextRank = SEVERITY_RANK[recommendation.severity];
    if (nextRank > existingRank || (nextRank === existingRank && new Date(recommendation.created_at).getTime() > new Date(existing.created_at).getTime())) {
      byKey.set(recommendation.dedup_key, recommendation);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
