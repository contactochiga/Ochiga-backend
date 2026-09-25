import type { CanonicalConversationRequest } from "../../contracts/canonicalConversation";
import type { OisContext } from "../../../types/oisContext";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";
import type { OperationalAnomaly, OperationalPrediction, OperationalForecast, OperationalRecommendation, OperationalScope } from "../../contracts/intelligence";
import type { OyiDomain } from "../../runtime/languageUnderstanding";
import type { AuthUser } from "../../../middleware/auth";
import { ANOMALY_DETECTORS } from "./anomalyDetectors";
import { PREDICTION_PROVIDERS } from "./predictionProviders";
import { runLegacyPredictionAdapter } from "./legacyPredictionAdapter";
import { generateUtilitySpendForecast } from "./utilitySpendForecastProvider";
import { persistPrediction, persistForecast } from "./predictionPersistence";
import { buildRecommendations } from "./recommendationPlanner";
import { runProactiveDelivery, type ProactiveDeliveryResult } from "./proactiveDelivery";
import { listRecommendations, type RecommendationReadItem } from "../../read/canonicalAwarenessReadService";
import { logger } from "../../../observability/logger";
import { operationalMetrics } from "../../../observability/metrics";

// Wave 7 Slice 1 -- Recommendation-read unification (docs/WAVE7_DECISION_
// PLANNING_AUTHORITY_AUDIT.md §37, slice 1). Mirrors the exact disclosed-
// fallback shape Wave 6 Final C already validated for
// getConvergedAwarenessDigest (awarenessPresentationAdapter.ts): canonical
// is tried first and, if it produces a usable result, is presented alone;
// legacy/ephemeral computation is only used, and only ever its own separate
// output returned, when canonical could not answer -- never blended
// item-by-item. canonicalAwarenessReadService.ts (frozen Wave 6 truth) is
// consumed here, never reimplemented or modified.
export type RecommendationSource = "canonical" | "ephemeral";
export type RecommendationFallbackReason = "no_actor_context" | "canonical_coverage_gap" | "proactive_delivery_path" | null;

// Presentation-only domain vocabulary translation -- operational_
// recommendations rows don't carry a domain column at this read layer, but
// the real domain is encoded, by construction, as the middle segment of
// recommendation_key ("recommendation:${domain}:${insightId}", see
// operationalRecommendations.ts:148). This is not a recalculation of
// domain, it is the same translation-only spirit as
// awarenessPresentationAdapter.ts's URGENCY_TO_SEVERITY: mapping the
// canonical OperationalRecommendationDomain vocabulary
// (operationalRecommendations.ts) onto the ephemeral OperationalRecommendation
// contract's OyiDomain vocabulary, which do not share a common set of
// literals (a real, separate vocabulary-fragmentation gap the Slice 0
// audit's §30 already documented -- not something Slice 1 is scoped to fix).
const CANONICAL_RECOMMENDATION_DOMAIN_TO_OYI_DOMAIN: Record<string, OyiDomain> = {
  infrastructure: "devices",
  security: "security",
  maintenance: "maintenance",
  utility: "utilities",
  environmental: "devices",
  visitor: "visitors",
  financial: "transactions",
  community: "community",
  operational_governance: "reports",
  executive: "reports",
};

function domainFromRecommendationKey(recommendationKey: string): OyiDomain {
  const segment = recommendationKey.split(":")[1] || "";
  return CANONICAL_RECOMMENDATION_DOMAIN_TO_OYI_DOMAIN[segment] || "reports";
}

// Same urgency->severity bucketing awarenessPresentationAdapter.ts already
// uses for canonical awareness items, adapted to OperationalRecommendation's
// 4-value severity vocabulary (no "normal" tier there -- "info" is the
// floor).
const CANONICAL_URGENCY_TO_SEVERITY: Record<string, OperationalRecommendation["severity"]> = {
  urgent: "critical",
  act: "warning",
  review: "attention",
  monitor: "info",
};

function mapCanonicalRecommendation(item: RecommendationReadItem): OperationalRecommendation {
  const severity = CANONICAL_URGENCY_TO_SEVERITY[String(item.urgency || "").toLowerCase()] || "info";
  return {
    recommendation_id: item.recommendationId,
    domain: domainFromRecommendationKey(item.recommendationKey),
    scope: { estate_id: item.scope.estateId, home_id: item.scope.homeId, room_id: item.scope.roomId },
    object_refs: [],
    created_at: item.generatedAt,
    severity,
    title: item.title,
    summary: item.summary,
    reason: item.reason || item.summary,
    evidence_ids: [],
    // No dedicated "what to do next" column exists at this read layer
    // (payload jsonb, where a nextStep/recommendedAction may live, is
    // deliberately not selected by the frozen canonicalAwarenessReadService
    // -- Wave 6 truth is consumed as-is, not widened). Best-effort,
    // presentation-only synthesis from the fields actually selected.
    suggested_action: item.reason || item.summary,
    actionability: item.approvalRequired ? "review" : "informational",
    requires_confirmation: item.approvalRequired,
    capability_key: null,
    expires_at: item.expiresAt,
    status: "open",
    dedup_key: item.recommendationKey,
  };
}

// Only "pending"/"monitoring" are live canonical statuses (Slice 0 audit
// §14-15's real-literal inventory); resolved/dismissed/expired rows are not
// "what should I pay attention to now" and are excluded here, the same way
// the ephemeral planner never re-surfaces something already handled.
const LIVE_CANONICAL_RECOMMENDATION_STATUSES = new Set(["pending", "monitoring"]);

async function loadCanonicalRecommendations(
  actor: AuthUser,
  oisContext: OisContext | null | undefined
): Promise<{ ok: boolean; recommendations: OperationalRecommendation[] }> {
  const canonical = await listRecommendations(actor, oisContext, {});
  if (!canonical.ok) return { ok: false, recommendations: [] };
  const recommendations = canonical.items
    .filter((item) => LIVE_CANONICAL_RECOMMENDATION_STATUSES.has(item.status))
    .map(mapCanonicalRecommendation);
  return { ok: true, recommendations };
}

export type IntelligenceOrchestratorInput = {
  input: CanonicalConversationRequest;
  oisContext: OisContext | null | undefined;
  contract: IntelligenceRequestContract;
  scope: OperationalScope;
  actor?: AuthUser | null;
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
  // Wave 7 Slice 1 -- explicit, observable disclosure of which authority
  // produced `recommendations`. Never silently blended; a caller can
  // always tell which truth source answered. See RecommendationSource.
  recommendation_source: RecommendationSource;
  recommendation_fallback_reason: RecommendationFallbackReason;
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
  // Programme 4 Phase K — "profile... intelligence orchestrator,
  // prediction/forecast path". This function had no latency
  // instrumentation at all before this pass.
  const startedAt = Date.now();
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
    context.scope.home_id ? (async () => {
      const forecastStartedAt = Date.now();
      try {
        return await generateUtilitySpendForecast(context.scope);
      } finally {
        operationalMetrics.observe("oyi_forecast_provider_latency_ms", Date.now() - forecastStartedAt, { provider: "utility_spend" });
      }
    })().catch((error) => {
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

  // Wave 7 Slice 1 -- canonical is only ever attempted for a real,
  // privacy-scoped actor and never for the proactive-delivery path.
  // resolveActorAuthority (canonicalAwarenessReadService.ts, frozen)
  // structurally requires a real actor to derive privacy/scope authority;
  // there is no safe way to consult canonical truth for the
  // proactiveIntelligenceScheduler's system-level, actor-less home batch,
  // so that path (and every other actor-less caller, e.g. the Room/Home
  // contributors) keeps using ephemeral computation exactly as before this
  // slice -- unchanged behavior, not a regression. Proactive delivery is
  // additionally excluded even when an actor is present, since
  // runProactiveDelivery sends real notifications and Slice 1 is scoped to
  // the read path only (docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md
  // §37 slice 1: "Frozen systems affected: None").
  let finalRecommendations = recommendations;
  let recommendationSource: RecommendationSource = "ephemeral";
  let recommendationFallbackReason: RecommendationFallbackReason = context.actor ? null : "no_actor_context";
  if (context.actor && !context.proactive) {
    try {
      const canonical = await loadCanonicalRecommendations(context.actor, context.oisContext);
      if (canonical.ok) {
        finalRecommendations = canonical.recommendations;
        recommendationSource = "canonical";
        recommendationFallbackReason = null;
      } else {
        recommendationFallbackReason = "canonical_coverage_gap";
      }
    } catch (error) {
      warnings.push(`canonical recommendation read failed: ${error instanceof Error ? error.message : String(error)}`);
      recommendationFallbackReason = "canonical_coverage_gap";
    }
  } else if (context.actor && context.proactive) {
    recommendationFallbackReason = "proactive_delivery_path";
  }

  const proactiveDeliveries = context.proactive ? await runProactiveDelivery(recommendations, { home_id: context.scope.home_id }) : [];

  // Programme 4 Phase J — the spec's explicit counter list ("anomaly
  // count, prediction count, forecast count") had no metric anywhere;
  // this is the single entry point both conversational reads and the
  // Phase H scheduler call, so it's instrumented here once rather than
  // at every caller.
  operationalMetrics.increment("oyi_anomalies_generated_total", { triggered_by: context.proactive ? "scheduled" : "conversational" }, anomalies.length);
  operationalMetrics.increment("oyi_predictions_generated_total", { triggered_by: context.proactive ? "scheduled" : "conversational" }, predictions.length);
  operationalMetrics.increment("oyi_forecasts_generated_total", { triggered_by: context.proactive ? "scheduled" : "conversational" }, forecasts.length);
  operationalMetrics.increment("oyi_recommendations_built_total", { triggered_by: context.proactive ? "scheduled" : "conversational" }, recommendations.length);
  for (const delivery of proactiveDeliveries) {
    operationalMetrics.increment("oyi_proactive_deliveries_total", { outcome: delivery.delivered ? "sent" : "suppressed", reason: delivery.reason });
  }
  // Wave 7 Slice 1 -- low-cardinality (2 source values x 4 reason values)
  // signal for the recommendation-read-unification rollout, separate from
  // the pre-existing "how many were built" metric above.
  operationalMetrics.increment("oyi_recommendation_source_total", {
    source: recommendationSource,
    reason: recommendationFallbackReason || "none",
  }, finalRecommendations.length);

  // Programme 4 Phase K — "profile... intelligence orchestrator" (see
  // startedAt above). Labeled by triggered_by so scheduled-batch latency
  // (Phase H, many homes per run) and conversational per-turn latency
  // don't get averaged together into a meaningless blend.
  operationalMetrics.observe("oyi_intelligence_orchestrator_latency_ms", Date.now() - startedAt, { triggered_by: context.proactive ? "scheduled" : "conversational" });

  return {
    anomalies,
    predictions,
    forecasts,
    recommendations: finalRecommendations,
    warnings,
    data_quality: quality,
    proactive_deliveries: proactiveDeliveries,
    recommendation_source: recommendationSource,
    recommendation_fallback_reason: recommendationFallbackReason,
  };
}
