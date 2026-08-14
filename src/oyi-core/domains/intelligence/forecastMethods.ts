// Simple, explainable forecasting methods only (§18 of the Programme 3
// spec) — no ML framework, no external model calls. Every method here is a
// few lines of arithmetic a person could verify by hand.

export type ForecastMethod = "naive_last_period" | "moving_average" | "linear_trend";

export function naiveLastPeriod(series: number[]): number {
  return series.length ? series[series.length - 1] : 0;
}

export function movingAverage(series: number[], window: number): number {
  if (!series.length) return 0;
  const slice = series.slice(-Math.max(1, Math.min(window, series.length)));
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

export function linearTrendFit(series: number[]): { slope: number; intercept: number } {
  const n = series.length;
  if (n < 2) return { slope: 0, intercept: series[0] || 0 };
  const xs = series.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = series.reduce((a, b) => a + b, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (xs[i] - meanX) * (series[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

// Projects `count` future points using the given method, trained on
// `series` (chronological order, oldest first).
export function forecastForward(series: number[], method: ForecastMethod, count: number): number[] {
  if (method === "naive_last_period") {
    const last = naiveLastPeriod(series);
    return Array.from({ length: count }, () => last);
  }
  if (method === "moving_average") {
    const avg = movingAverage(series, Math.min(3, series.length));
    return Array.from({ length: count }, () => avg);
  }
  const { slope, intercept } = linearTrendFit(series);
  return Array.from({ length: count }, (_, i) => intercept + slope * (series.length + i));
}

export function mae(actual: number[], predicted: number[]): number {
  const n = Math.min(actual.length, predicted.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs(actual[i] - predicted[i]);
  return sum / n;
}

// Null when any actual value is zero — MAPE is undefined there, and a
// silently-wrong percentage is worse than an honest "not applicable".
export function mape(actual: number[], predicted: number[]): number | null {
  const n = Math.min(actual.length, predicted.length);
  if (!n) return null;
  if (actual.slice(0, n).some((value) => value === 0)) return null;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs((actual[i] - predicted[i]) / actual[i]);
  return (sum / n) * 100;
}

export function rmse(actual: number[], predicted: number[]): number {
  const n = Math.min(actual.length, predicted.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += (actual[i] - predicted[i]) ** 2;
  return Math.sqrt(sum / n);
}

export type BacktestResult = {
  method: ForecastMethod;
  holdout_count: number;
  predicted: number[];
  actual: number[];
  mae: number;
  mape: number | null;
  rmse: number;
  baseline_mae: number;
  baseline_mape: number | null;
  beats_baseline: boolean;
};

// Deterministic backtest (§19/§20): trains on series[0..n-holdout), predicts
// the held-out tail, and ALWAYS compares against the naive-last-period
// baseline — a forecast is only worth trusting if it beats the trivial
// baseline it's compared against.
export function backtest(series: number[], method: ForecastMethod, holdout: number): BacktestResult | null {
  if (series.length <= holdout || holdout < 1) return null;
  const train = series.slice(0, series.length - holdout);
  const actual = series.slice(series.length - holdout);
  const predicted = forecastForward(train, method, holdout);
  const baselinePredicted = forecastForward(train, "naive_last_period", holdout);
  const methodMae = mae(actual, predicted);
  const baselineMae = mae(actual, baselinePredicted);
  return {
    method,
    holdout_count: holdout,
    predicted,
    actual,
    mae: methodMae,
    mape: mape(actual, predicted),
    rmse: rmse(actual, predicted),
    baseline_mae: baselineMae,
    baseline_mape: mape(actual, baselinePredicted),
    beats_baseline: methodMae <= baselineMae,
  };
}
