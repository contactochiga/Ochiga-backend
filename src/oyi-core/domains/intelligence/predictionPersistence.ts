import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import type { OperationalPrediction, OperationalForecast } from "../../contracts/intelligence";

// Reuses the existing, real ochiga_intelligence_predictions table (already
// written by the legacy predictionEngine.ts) rather than creating a new
// oyi_predictions table — its schema (prediction_type: free text, status:
// free text, metadata: jsonb) is generic enough to hold any Programme 3
// canonical prediction or forecast. Anomalies are deliberately NOT
// persisted here (§54: "do not persist transient low-value inference
// clutter") — they're recomputed fresh from current evidence each time,
// same as Programme 1/2's facts.
export async function persistPrediction(prediction: OperationalPrediction): Promise<{ id: string | null }> {
  try {
    const { data, error } = await supabaseAdmin.from("ochiga_intelligence_predictions").insert({
      id: prediction.prediction_id,
      prediction_type: prediction.prediction_type,
      title: prediction.reasoning_summary.slice(0, 120),
      summary: prediction.reasoning_summary,
      confidence: prediction.confidence >= 0.65 ? "likely" : prediction.confidence >= 0.45 ? "possible" : "needs_monitoring",
      severity: prediction.severity,
      agent_id: prediction.model_name,
      estate_id: prediction.scope.estate_id,
      home_id: prediction.scope.home_id,
      source_event_ids: prediction.evidence_ids,
      evidence: prediction.object_refs,
      recommended_action: prediction.predicted_value != null ? String(prediction.predicted_value) : "",
      status: prediction.status === "active" ? "open" : prediction.status,
      metadata: {
        domain: prediction.domain,
        horizon: prediction.horizon,
        model_version: prediction.model_version,
        model_type: prediction.model_type,
        room_id: prediction.scope.room_id,
        expires_at: prediction.expires_at,
      },
    } as any).select("id").maybeSingle();
    if (error) throw error;
    return { id: data?.id || prediction.prediction_id };
  } catch (error) {
    logger.warn("oyi_prediction_persist_failed", { prediction_id: prediction.prediction_id, error });
    return { id: null };
  }
}

export async function persistForecast(forecast: OperationalForecast): Promise<{ id: string | null }> {
  try {
    const { data, error } = await supabaseAdmin.from("ochiga_intelligence_predictions").insert({
      id: forecast.forecast_id,
      prediction_type: `forecast.${forecast.metric}`,
      title: `${forecast.metric} forecast`,
      summary: `Forecast for ${forecast.metric} over ${forecast.forecast_horizon}.`,
      confidence: forecast.data_quality === "sufficient" ? "likely" : "possible",
      severity: "info",
      agent_id: `${forecast.method}.${forecast.method_version}`,
      estate_id: forecast.scope.estate_id,
      home_id: forecast.scope.home_id,
      source_event_ids: forecast.evidence_ids,
      evidence: [],
      recommended_action: "",
      status: forecast.status === "active" ? "open" : forecast.status,
      metadata: {
        kind: "forecast",
        metric: forecast.metric,
        time_points: forecast.time_points,
        predicted_values: forecast.predicted_values,
        confidence_interval: forecast.confidence_interval,
        baseline: forecast.baseline,
        historical_window: forecast.historical_window,
        method: forecast.method,
        method_version: forecast.method_version,
        data_quality: forecast.data_quality,
        room_id: forecast.scope.room_id,
      },
    } as any).select("id").maybeSingle();
    if (error) throw error;
    return { id: data?.id || forecast.forecast_id };
  } catch (error) {
    logger.warn("oyi_forecast_persist_failed", { forecast_id: forecast.forecast_id, error });
    return { id: null };
  }
}

export async function listPersistedPredictions(input: { estate_id?: string | null; home_id?: string | null; status?: string | null; limit?: number }) {
  let query = supabaseAdmin.from("ochiga_intelligence_predictions").select("*").order("created_at", { ascending: false }).limit(Math.max(1, Math.min(100, input.limit || 25)));
  if (input.estate_id) query = query.eq("estate_id", input.estate_id);
  if (input.home_id) query = query.eq("home_id", input.home_id);
  if (input.status) query = query.eq("status", input.status);
  const { data, error } = await query;
  if (error) {
    logger.warn("oyi_prediction_list_failed", { error });
    return { rows: [], unavailable: true };
  }
  return { rows: Array.isArray(data) ? data : [], unavailable: false };
}
