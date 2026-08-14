import { randomUUID } from "crypto";
import type { OperationalForecast, OperationalScope } from "../../contracts/intelligence";
import { loadUtilitySpendHistory, weeklyBuckets } from "./utilitySpendHistoryEvidence";
import { forecastForward, backtest, type ForecastMethod } from "./forecastMethods";

export type UtilitySpendForecastResult = {
  forecast: OperationalForecast | null;
  data_quality: OperationalForecast["data_quality"];
};

const WINDOW_DAYS = 84; // 12 weeks — enough for a weekly-bucketed trend/backtest, bounded (§16).
const MIN_WEEKS_FOR_FORECAST = 4;
const MIN_WEEKS_FOR_INTERVAL = 6; // needs a real backtest to ground an interval in — never fabricated.

// utility_spend.rolling_mean:v1 / utility_spend.linear_trend:v1 — the ONLY
// forecast Programme 3 builds, precisely because it's the only metric with
// real, persisted historical numerical data (wallet_transactions, already
// used by Programme 1's utilities.spending.read). Consumption/usage/meter
// forecasting is explicitly NOT built — see §17: no reliable telemetry
// source exists for that, and inferring it from spending would be
// fabrication, not forecasting.
export async function generateUtilitySpendForecast(scope: OperationalScope): Promise<UtilitySpendForecastResult> {
  const { transactions, unavailable } = await loadUtilitySpendHistory(scope, WINDOW_DAYS);
  if (unavailable) return { forecast: null, data_quality: "unavailable" };
  const { weekStarts, values } = weeklyBuckets(transactions, WINDOW_DAYS);
  const populatedWeeks = values.filter((value) => value > 0).length;
  if (!transactions.length || populatedWeeks < MIN_WEEKS_FOR_FORECAST) {
    return { forecast: null, data_quality: transactions.length ? "sparse" : "unavailable" };
  }

  const method: ForecastMethod = "linear_trend";
  const nextValue = forecastForward(values, method, 1)[0];
  const predictedValue = Math.max(0, Math.round(nextValue));
  const baselineValue = Math.max(0, Math.round(forecastForward(values, "naive_last_period", 1)[0]));

  let confidenceInterval: OperationalForecast["confidence_interval"] = null;
  let dataQuality: OperationalForecast["data_quality"] = "limited";
  if (populatedWeeks >= MIN_WEEKS_FOR_INTERVAL) {
    const bt = backtest(values, method, Math.min(3, Math.floor(values.length / 3)));
    if (bt) {
      confidenceInterval = { lower: [Math.max(0, predictedValue - bt.mae)], upper: [predictedValue + bt.mae] };
      dataQuality = "sufficient";
    }
  }

  const forecast: OperationalForecast = {
    forecast_id: randomUUID(),
    domain: "utilities",
    metric: "utility_spend",
    scope,
    object_refs: [],
    generated_at: new Date().toISOString(),
    forecast_horizon: "next_week",
    time_points: [new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()],
    predicted_values: [predictedValue],
    confidence_interval: confidenceInterval,
    baseline: { method: "naive_last_period", values: [baselineValue] },
    historical_window: { from: weekStarts[0], to: new Date().toISOString(), sample_count: transactions.length },
    method,
    method_version: "v1",
    evidence_ids: transactions.slice(0, 20).map((t) => t.id),
    data_quality: dataQuality,
    status: "active",
  };
  return { forecast, data_quality: dataQuality };
}
