import type { CanonicalConversationRequest } from "../../contracts/canonicalConversation";
import type { OisContext } from "../../../types/oisContext";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";
import type { OperationalAnomaly, OperationalPrediction, OperationalForecast, OperationalRecommendation, OperationalScope } from "../../contracts/intelligence";
import { ANOMALY_DETECTORS } from "./anomalyDetectors";
import { PREDICTION_PROVIDERS } from "./predictionProviders";
import { runLegacyPredictionAdapter } from "./legacyPredictionAdapter";
import { generateUtilitySpendForecast } from "./utilitySpendForecastProvider";
import { persistPrediction, persistForecast } from "./predictionPersistence";
import { buildRecommendations } from "./recommendationPlanner";
import { runProactiveDelivery, type ProactiveDeliveryResult } from "./proactiveDelivery";
import { logger } from "../../../observability/logger";

export type IntelligenceOrchestratorInput = {
  input: CanonicalConversationRequest;
  oisContext: OisContext | null | undefined;
  contract: IntelligenceRequestContract;
  scope: OperationalScope;
  actor?: unknown;
  persist?: boolean;
  // Deliberately opt-in and separate from every conversational read. Chat
  // capabilities (predictions.read, anomalies.read, etc — Phase L) MUST
  // call this with proactive left false/omitted so simply asking a
  // question never fires a notification as a side effect. Proactive
  // surfacing (§K) is only meant to run from an event/scheduled trigger —
  // today that means an explicit caller opts in; there is no live
  // scheduler wired yet (see the "runProactiveDelivery" module comment).
  proactive?: boolean;
};

export type IntelligenceOrchestratorResult = {
  anomalies: OperationalAnomaly[];
  predictions: OperationalPrediction[];
  forecasts: OperationalForecast[];
  recommendations: OperationalRecommendation[];
  warnings: string[];
  data_quality: "sufficient" | "limited" | "stale" | "sparse" | "unavailable" | "unsupported" | "mixed";
  proactive_deliveries: ProactiveDeliveryResult[];
};

const QUALITY_RANK: Record<string, number> = { unavailable: 0, sparse: 1, stale: 1, limited: 2, unsupported: 2, sufficient: 3 };

function worstQuality(values: string[]): IntelligenceOrchestratorResult["data_quality"] {
  if (!values.length) return "unavailable";
  const distinct = new Set(values);
  if (distinct.size === 1) return values[0] as IntelligenceOrchestratorResult["data_quality"];
  let worst = values[0];
  for (const value of values) if ((QUALITY_RANK[value] ?? 0) < (QUALITY_RANK[worst] ?? 0)) worst = value;
  return distinct.size > 1 ? "mixed" : (worst as IntelligenceOrchestratorResult["data_quality"]);
}

// The single entry point Programme 3's conversational capabilities call
// (Phase L): runs every native detector + provider in parallel, the
// strangler-wrapped legacy engine, and the one real forecast, then feeds
// everything through the recommendation planner. Native predictions/
// forecasts are persisted here; legacy output is NOT re-persisted since
// predictionEngine.ts already persists itself (§14 — avoid double writes
// into ochiga_intelligence_predictions).
export async function runIntelligenceOrchestrator(context: IntelligenceOrchestratorInput): Promise<IntelligenceOrchestratorResult> {
  const detectorContext = { input: context.input, oisContext: context.oisContext, contract: context.contract, scope: context.scope };
  const warnings: string[] = [];

  const [detectorResults, providerResults, legacyResult, forecastResult] = await Promise.all([
    Promise.all(ANOMALY_DETECTORS.map((detector) => detector.detect(detectorContext).catch((error) => {
      warnings.push(`detector ${detector.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      return { anomalies: [], data_quality: "unavailable" as const, evidence_count: 0 };
    }))),
    Promise.all(PREDICTION_PROVIDERS.map((provider) => provider.evaluate(detectorContext).catch((error) => {
      warnings.push(`provider ${provider.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      return { predictions: [], data_quality: "unavailable" as const };
    }))),
    runLegacyPredictionAdapter({ actor: context.actor, estate_id: context.scope.estate_id, home_id: context.scope.home_id, persist: context.persist ?? true }).catch((error) => {
      warnings.push(`legacy adapter failed: ${error instanceof Error ? error.message : String(error)}`);
      return { anomalies: [], predictions: [], recommendations: [], warnings: [] };
    }),
    context.scope.home_id ? generateUtilitySpendForecast(context.scope).catch((error) => {
      warnings.push(`utility spend forecast failed: ${error instanceof Error ? error.message : String(error)}`);
      return { forecast: null, data_quality: "unavailable" as const };
    }) : Promise.resolve({ forecast: null, data_quality: "unsupported" as const }),
  ]);

  const nativeAnomalies = detectorResults.flatMap((result) => result.anomalies);
  const nativePredictions = providerResults.flatMap((result) => result.predictions);
  warnings.push(...legacyResult.warnings);

  const anomalies = [...nativeAnomalies, ...legacyResult.anomalies];
  const predictions = [...nativePredictions, ...legacyResult.predictions];
  const forecasts = forecastResult.forecast ? [forecastResult.forecast] : [];

  if (context.persist ?? true) {
    await Promise.all([
      ...nativePredictions.map((prediction) => persistPrediction(prediction)),
      ...forecasts.map((forecast) => persistForecast(forecast)),
    ]).catch((error) => {
      logger.warn("oyi_intelligence_orchestrator_persist_failed", { error });
    });
  }

  const recommendations = buildRecommendations({ anomalies, predictions, forecasts, legacyRecommendations: legacyResult.recommendations });

  const quality = worstQuality([
    ...detectorResults.map((result) => result.data_quality),
    ...providerResults.map((result) => result.data_quality),
    forecastResult.data_quality,
  ]);

  const proactiveDeliveries = context.proactive ? await runProactiveDelivery(recommendations, { home_id: context.scope.home_id }) : [];

  return { anomalies, predictions, forecasts, recommendations, warnings, data_quality: quality, proactive_deliveries: proactiveDeliveries };
}
