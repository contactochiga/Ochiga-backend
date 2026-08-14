import type { CapabilityContext, CapabilityModule } from "../../contracts/capability";
import type { DomainResult } from "../../contracts/domainResult";
import type { IntelligenceFact } from "../../contracts/canonicalConversation";
import type { OperationalAnomaly, OperationalPrediction, OperationalForecast, OperationalRecommendation } from "../../contracts/intelligence";
import { logger } from "../../../observability/logger";
import {
  readModule,
  evidenceFromFact,
  factsFromEvidence,
  requestContract,
  resultPresentation,
  readRequirement,
  homeScope,
} from "../../capabilities/ReadCapabilityModules";
import { buildResultSetContext } from "../../context/resultSetContext";
import { runIntelligenceOrchestrator, type IntelligenceOrchestratorResult } from "./intelligenceOrchestrator";

// Same short-lived collect()->answer() hand-off pattern roomHomeCapabilities
// uses (see pendingAggregates there) — runs the orchestrator once per turn
// in collect(), then answer() only formats the already-computed result.
const pendingOrchestratorResults = new Map<string, IntelligenceOrchestratorResult>();

function currentScope(context: CapabilityContext) {
  return {
    estate_id: context.input.estate_id || context.oisContext?.estate_id || null,
    home_id: context.input.home_id || context.oisContext?.home_id || null,
    room_id: null as string | null,
  };
}

// These four capabilities never opt into proactive delivery (§K —
// conversational reads must never fire a notification as a side effect)
// and always persist native predictions/forecasts, same as any other read
// that happens to compute fresh evidence.
async function runOrchestratorForContext(context: CapabilityContext): Promise<IntelligenceOrchestratorResult> {
  const contract = requestContract(context);
  const scope = currentScope(context);
  return runIntelligenceOrchestrator({ input: context.input, oisContext: context.oisContext, contract, scope, actor: context.actor, persist: true, proactive: false });
}

// Adapters onto the existing IntelligenceFact shape (not a new evidence
// type) so the whole existing machinery — evidenceFromFact,
// factsFromEvidence, buildResultSetContext, and critically
// domains/explainAnswer.ts's buildExplainAnswer (reads fact.value.reason)
// — works for Programme 3 objects with zero new plumbing. This is what
// makes "why are you telling me this?" work for anomalies/predictions/
// forecasts/recommendations without a separate explanation system.
export function factFromAnomaly(anomaly: OperationalAnomaly): IntelligenceFact {
  const ref = anomaly.subject || anomaly.object_refs[0] || null;
  return {
    fact_id: `anomaly:${anomaly.anomaly_id}`,
    domain: anomaly.domain,
    fact_type: "anomaly",
    scope: anomaly.scope,
    object: { object_type: ref?.object_type || "anomaly", canonical_id: ref?.canonical_id || anomaly.anomaly_id, label: ref?.label || anomaly.anomaly_type.replace(/_/g, " ") },
    statement: anomaly.explanation,
    value: { ...anomaly, reason: anomaly.explanation, status: anomaly.status },
    previous_value: null,
    occurred_at: anomaly.window?.to || anomaly.generated_at,
    observed_at: anomaly.generated_at,
    source_type: "calculation",
    source_id: anomaly.anomaly_id,
    truth_state: "inferred",
    confidence: anomaly.confidence,
    freshness: anomaly.generated_at,
    privacy_class: "household_private",
    permissions: [],
    evidence: anomaly.evidence_ids.map((id) => ({ type: "evidence_id", id })),
  };
}

export function factFromPrediction(prediction: OperationalPrediction): IntelligenceFact {
  const ref = prediction.subject || prediction.object_refs[0] || null;
  return {
    fact_id: `prediction:${prediction.prediction_id}`,
    domain: prediction.domain,
    fact_type: "prediction",
    scope: prediction.scope,
    object: { object_type: ref?.object_type || "prediction", canonical_id: ref?.canonical_id || prediction.prediction_id, label: ref?.label || prediction.prediction_type.replace(/_/g, " ") },
    statement: prediction.reasoning_summary,
    value: { ...prediction, reason: prediction.reasoning_summary, status: prediction.status },
    previous_value: null,
    occurred_at: prediction.generated_at,
    observed_at: prediction.generated_at,
    source_type: "prediction",
    source_id: prediction.prediction_id,
    truth_state: "predicted",
    confidence: prediction.confidence,
    freshness: prediction.generated_at,
    privacy_class: "household_private",
    permissions: [],
    evidence: prediction.evidence_ids.map((id) => ({ type: "evidence_id", id })),
  };
}

export function factFromForecast(forecast: OperationalForecast): IntelligenceFact {
  const ref = forecast.object_refs[0] || null;
  const reason = `Forecast method ${forecast.method} (${forecast.data_quality} data quality) over a ${forecast.historical_window.sample_count}-record window.`;
  return {
    fact_id: `forecast:${forecast.forecast_id}`,
    domain: forecast.domain,
    fact_type: "forecast",
    scope: forecast.scope,
    object: { object_type: ref?.object_type || "forecast", canonical_id: ref?.canonical_id || forecast.forecast_id, label: ref?.label || forecast.metric.replace(/_/g, " ") },
    statement: `${forecast.metric.replace(/_/g, " ")} forecast for ${forecast.forecast_horizon.replace(/_/g, " ")}.`,
    value: { ...forecast, reason, status: forecast.status },
    previous_value: null,
    occurred_at: forecast.generated_at,
    observed_at: forecast.generated_at,
    source_type: "calculation",
    source_id: forecast.forecast_id,
    truth_state: "predicted",
    confidence: forecast.data_quality === "sufficient" ? 0.65 : 0.4,
    freshness: forecast.generated_at,
    privacy_class: "financial_sensitive",
    permissions: [],
    evidence: forecast.evidence_ids.map((id) => ({ type: "evidence_id", id })),
  };
}

export function factFromRecommendation(recommendation: OperationalRecommendation): IntelligenceFact {
  const ref = recommendation.object_refs[0] || null;
  return {
    fact_id: `recommendation:${recommendation.recommendation_id}`,
    domain: recommendation.domain,
    fact_type: "recommendation",
    scope: recommendation.scope,
    object: { object_type: ref?.object_type || "recommendation", canonical_id: ref?.canonical_id || recommendation.recommendation_id, label: ref?.label || recommendation.title },
    statement: recommendation.summary,
    value: { ...recommendation, reason: recommendation.reason, status: recommendation.status },
    previous_value: null,
    occurred_at: recommendation.created_at,
    observed_at: recommendation.created_at,
    source_type: "calculation",
    source_id: recommendation.recommendation_id,
    truth_state: "inferred",
    confidence: 0.6,
    freshness: recommendation.created_at,
    privacy_class: "household_private",
    permissions: [],
    evidence: recommendation.evidence_ids.map((id) => ({ type: "evidence_id", id })),
  };
}

function withResultSet(result: DomainResult, facts: IntelligenceFact[], context: CapabilityContext, domain: string, capabilityKey: string, operation: string): DomainResult {
  const contract = requestContract(context);
  const resultSet = buildResultSetContext({ domain, capabilityKey, operation, facts, contract, message: context.input.message });
  if (!resultSet) return result;
  return { ...result, metadata: { ...(result.metadata || {}), result_set: resultSet } };
}

const INTELLIGENCE_PERMISSIONS = ["devices.read", "maintenance.read", "visitors.read", "security.read", "utilities.read", "automations.read"];

function anomaliesCapability(): CapabilityModule {
  return readModule({
    key: "anomalies.read",
    domain: "reports",
    operations: ["list", "summarize", "inspect"],
    supportedSurfaces: ["consumer"],
    permissions: INTELLIGENCE_PERMISSIONS,
    scopeRequirements: homeScope,
    evidenceRequirements: [readRequirement("reports", "operational_anomaly")],
    supports: (frame) => /\banomal(y|ies)|unusual (pattern|activity)|out of the ordinary\b/i.test(frame.normalizedText),
    collect: async (context) => {
      const result = await runOrchestratorForContext(context);
      pendingOrchestratorResults.set(context.resolvedTurn.request_id, result);
      return result.anomalies.map(factFromAnomaly).map(evidenceFromFact);
    },
    answer: (context, evidence) => {
      const requestId = context.resolvedTurn.request_id;
      const result = pendingOrchestratorResults.get(requestId);
      pendingOrchestratorResults.delete(requestId);
      const facts = factsFromEvidence(evidence);
      if (!result) {
        logger.warn("oyi_anomalies_result_missing_at_answer");
        return { status: facts.length ? "answered" : "empty", answer: "I could not check for anomalies right now.", presentation_policy: resultPresentation("text") };
      }
      if (result.data_quality === "unavailable") {
        return { status: "unavailable", answer: "I could not check for anomalies right now — the underlying evidence is unavailable.", presentation_policy: resultPresentation("text") };
      }
      const answer = result.anomalies.length
        ? `${result.anomalies.length} anomal${result.anomalies.length === 1 ? "y" : "ies"} detected: ${result.anomalies.slice(0, 5).map((a) => a.explanation).join(" ")}`
        : "No anomalies detected in the current evidence.";
      return withResultSet({ status: result.anomalies.length ? "answered" : "empty", answer, presentation_policy: resultPresentation("list") }, facts, context, "reports", "anomalies.read", "list");
    },
    primary: "list",
  });
}

function predictionsCapability(): CapabilityModule {
  return readModule({
    key: "predictions.read",
    domain: "reports",
    operations: ["list", "summarize", "inspect"],
    supportedSurfaces: ["consumer"],
    permissions: INTELLIGENCE_PERMISSIONS,
    scopeRequirements: homeScope,
    evidenceRequirements: [readRequirement("reports", "operational_prediction")],
    supports: (frame) => /\bpredict(ion|ions)?\b|what (do you|will) (you )?(think|expect)|likely to (fail|break|happen)/i.test(frame.normalizedText) && !/\bforecast\b/i.test(frame.normalizedText),
    collect: async (context) => {
      const result = await runOrchestratorForContext(context);
      pendingOrchestratorResults.set(context.resolvedTurn.request_id, result);
      return result.predictions.map(factFromPrediction).map(evidenceFromFact);
    },
    answer: (context, evidence) => {
      const requestId = context.resolvedTurn.request_id;
      const result = pendingOrchestratorResults.get(requestId);
      pendingOrchestratorResults.delete(requestId);
      const facts = factsFromEvidence(evidence);
      if (!result) {
        logger.warn("oyi_predictions_result_missing_at_answer");
        return { status: facts.length ? "answered" : "empty", answer: "I could not generate predictions right now.", presentation_policy: resultPresentation("text") };
      }
      if (result.data_quality === "unavailable") {
        return { status: "unavailable", answer: "I could not generate predictions right now — the underlying evidence is unavailable.", presentation_policy: resultPresentation("text") };
      }
      const answer = result.predictions.length
        ? `${result.predictions.length} prediction${result.predictions.length === 1 ? "" : "s"}: ${result.predictions.slice(0, 5).map((p) => p.reasoning_summary).join(" ")}`
        : "I do not have any active predictions right now.";
      return withResultSet({ status: result.predictions.length ? "answered" : "empty", answer, presentation_policy: resultPresentation("list") }, facts, context, "reports", "predictions.read", "list");
    },
    primary: "list",
  });
}

function forecastsCapability(): CapabilityModule {
  return readModule({
    key: "forecasts.read",
    domain: "reports",
    operations: ["list", "summarize", "inspect"],
    supportedSurfaces: ["consumer"],
    permissions: INTELLIGENCE_PERMISSIONS,
    scopeRequirements: homeScope,
    evidenceRequirements: [readRequirement("reports", "operational_forecast")],
    supports: (frame) => /\bforecast\b/i.test(frame.normalizedText),
    collect: async (context) => {
      const result = await runOrchestratorForContext(context);
      pendingOrchestratorResults.set(context.resolvedTurn.request_id, result);
      return result.forecasts.map(factFromForecast).map(evidenceFromFact);
    },
    answer: (context, evidence) => {
      const requestId = context.resolvedTurn.request_id;
      const result = pendingOrchestratorResults.get(requestId);
      pendingOrchestratorResults.delete(requestId);
      const facts = factsFromEvidence(evidence);
      if (!result) {
        logger.warn("oyi_forecasts_result_missing_at_answer");
        return { status: facts.length ? "answered" : "empty", answer: "I could not build a forecast right now.", presentation_policy: resultPresentation("text") };
      }
      if (!result.forecasts.length) {
        return { status: "empty", answer: "I do not have enough historical data to forecast that yet.", presentation_policy: resultPresentation("text") };
      }
      const forecast = result.forecasts[0];
      const value = forecast.predicted_values[0];
      const interval = forecast.confidence_interval ? ` (likely between ${Math.round(forecast.confidence_interval.lower[0])} and ${Math.round(forecast.confidence_interval.upper[0])})` : "";
      const answer = `${forecast.metric.replace(/_/g, " ")} forecast for ${forecast.forecast_horizon.replace(/_/g, " ")}: about ${Math.round(value)}${interval}. Data quality: ${forecast.data_quality}.`;
      return withResultSet({ status: "answered", answer, presentation_policy: resultPresentation("text") }, facts, context, "reports", "forecasts.read", "inspect");
    },
    primary: "text",
  });
}

function recommendationsCapability(): CapabilityModule {
  return readModule({
    key: "recommendations.read",
    domain: "reports",
    operations: ["list", "summarize", "inspect"],
    supportedSurfaces: ["consumer"],
    permissions: INTELLIGENCE_PERMISSIONS,
    scopeRequirements: homeScope,
    evidenceRequirements: [readRequirement("reports", "operational_recommendation")],
    supports: (frame) => /\brecommend(ation|ations)?\b|what should i (do|check|fix)|any (suggestions|advice)\b/i.test(frame.normalizedText),
    collect: async (context) => {
      const result = await runOrchestratorForContext(context);
      pendingOrchestratorResults.set(context.resolvedTurn.request_id, result);
      return result.recommendations.map(factFromRecommendation).map(evidenceFromFact);
    },
    answer: (context, evidence) => {
      const requestId = context.resolvedTurn.request_id;
      const result = pendingOrchestratorResults.get(requestId);
      pendingOrchestratorResults.delete(requestId);
      const facts = factsFromEvidence(evidence);
      if (!result) {
        logger.warn("oyi_recommendations_result_missing_at_answer");
        return { status: facts.length ? "answered" : "empty", answer: "I could not check for recommendations right now.", presentation_policy: resultPresentation("text") };
      }
      const answer = result.recommendations.length
        ? `${result.recommendations.length} recommendation${result.recommendations.length === 1 ? "" : "s"}: ${result.recommendations.slice(0, 5).map((r) => `${r.title} — ${r.suggested_action}`).join("; ")}.`
        : "No recommendations right now — nothing needs attention.";
      return withResultSet({ status: result.recommendations.length ? "answered" : "empty", answer, presentation_policy: resultPresentation("list") }, facts, context, "reports", "recommendations.read", "list");
    },
    primary: "list",
  });
}

export function buildIntelligenceCapabilities(): CapabilityModule[] {
  return [anomaliesCapability(), predictionsCapability(), forecastsCapability(), recommendationsCapability()];
}
