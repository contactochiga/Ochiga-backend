import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import { listPersistedPredictions } from "./predictionPersistence";
import { loadMaintenanceRequestFacts } from "../maintenance/maintenanceEvidence";
import { loadAutomationRunFacts } from "../automations/sceneAutomationEvidence";
import { loadDeviceEventHistory } from "./deviceEventEvidence";
import type { CanonicalConversationRequest } from "../../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export type EvaluationOutcome = "realized" | "not_realized" | "partial" | "unobservable";

export type EvaluatedPrediction = {
  prediction_id: string;
  prediction_type: string;
  outcome: EvaluationOutcome;
  notes: string;
};

// Minimum age before a prediction is even eligible for evaluation — a
// prediction made 5 minutes ago hasn't had time to be tested against
// reality yet (§9/§67: "prediction made -> future evidence arrives ->
// outcome evaluator runs").
const MIN_AGE_HOURS_FOR_EVALUATION = 24;

async function evaluateDeviceReliability(row: Record<string, unknown>, minimalInput: CanonicalConversationRequest, contract: IntelligenceRequestContract): Promise<EvaluatedPrediction> {
  const deviceId = text((row.evidence as any)?.[0]?.canonical_id);
  const scope = { estate_id: text(row.estate_id) || null, home_id: text(row.home_id) || null, room_id: null };
  if (!deviceId) return { prediction_id: text(row.id), prediction_type: text(row.prediction_type), outcome: "unobservable", notes: "No device reference recorded on this prediction." };
  const { rows, unavailable } = await loadDeviceEventHistory(scope, 30, 200);
  if (unavailable) return { prediction_id: text(row.id), prediction_type: text(row.prediction_type), outcome: "unobservable", notes: "Device event history unavailable at evaluation time." };
  const createdAt = new Date(text(row.created_at)).getTime();
  const laterFailures = rows.filter((event) => event.device_id === deviceId && new Date(event.occurred_at).getTime() > createdAt && /offline|failure|failed|disconnect/i.test(`${event.event_type} ${JSON.stringify(event.new_state || {})}`));
  return {
    prediction_id: text(row.id),
    prediction_type: text(row.prediction_type),
    outcome: laterFailures.length ? "realized" : "not_realized",
    notes: laterFailures.length ? `${laterFailures.length} further offline/failure event(s) recorded after the prediction.` : "No further offline/failure events recorded since the prediction.",
  };
}

async function evaluateMaintenanceRisk(row: Record<string, unknown>, input: CanonicalConversationRequest, contract: IntelligenceRequestContract): Promise<EvaluatedPrediction> {
  const requestId = text((row.evidence as any)?.[0]?.canonical_id);
  if (!requestId) return { prediction_id: text(row.id), prediction_type: text(row.prediction_type), outcome: "unobservable", notes: "No maintenance request reference recorded." };
  const facts = await loadMaintenanceRequestFacts(input, null, contract);
  if (facts.some((fact) => fact.truth_state === "unavailable")) return { prediction_id: text(row.id), prediction_type: text(row.prediction_type), outcome: "unobservable", notes: "Maintenance evidence unavailable at evaluation time." };
  const match = facts.find((fact) => fact.object?.canonical_id === requestId);
  if (!match) return { prediction_id: text(row.id), prediction_type: text(row.prediction_type), outcome: "not_realized", notes: "Request no longer appears in the open queue (resolved or removed)." };
  const status = text(recordOf(match.value).status);
  const stillOpen = /open|unresolved|pending|in_progress/i.test(status);
  return { prediction_id: text(row.id), prediction_type: text(row.prediction_type), outcome: stillOpen ? "realized" : "not_realized", notes: stillOpen ? "Request remains open, as predicted." : `Request status is now "${status}".` };
}

async function evaluateAutomationReliability(row: Record<string, unknown>, input: CanonicalConversationRequest, contract: IntelligenceRequestContract): Promise<EvaluatedPrediction> {
  const automationId = text((row.evidence as any)?.[0]?.canonical_id);
  if (!automationId) return { prediction_id: text(row.id), prediction_type: text(row.prediction_type), outcome: "unobservable", notes: "No automation reference recorded." };
  const runs = await loadAutomationRunFacts(input, null, contract);
  if (runs.some((fact) => fact.truth_state === "unavailable")) return { prediction_id: text(row.id), prediction_type: text(row.prediction_type), outcome: "unobservable", notes: "Automation run evidence unavailable at evaluation time." };
  const createdAt = new Date(text(row.created_at)).getTime();
  const laterRuns = runs.filter((fact) => recordOf(fact.value).automation_id === automationId && new Date(fact.occurred_at || 0).getTime() > createdAt);
  if (!laterRuns.length) return { prediction_id: text(row.id), prediction_type: text(row.prediction_type), outcome: "unobservable", notes: "No runs recorded since the prediction was made." };
  const nextRun = laterRuns[laterRuns.length - 1];
  const failed = text(recordOf(nextRun.value).status).toLowerCase() === "failed";
  return { prediction_id: text(row.id), prediction_type: text(row.prediction_type), outcome: failed ? "realized" : "not_realized", notes: failed ? "The next recorded run also failed." : "The next recorded run succeeded." };
}

// Evaluates OPEN predictions old enough to test, by re-querying CURRENT
// evidence through the SAME Programme 1 loaders the provider used — never
// assumes success just because a recommendation was shown/accepted (§9/§36:
// "do not infer success merely because a recommendation was clicked").
// Results are written to intelligence_feedback (a real, existing, generic
// outcome table — see contracts/intelligence.ts's comment on why no new
// migration was needed for this).
export async function evaluateOpenPredictions(scope: { estate_id?: string | null; home_id?: string | null }, limit = 25): Promise<{ evaluated: EvaluatedPrediction[]; skipped: number }> {
  const { rows, unavailable } = await listPersistedPredictions({ estate_id: scope.estate_id, home_id: scope.home_id, status: "open", limit: 100 });
  if (unavailable) return { evaluated: [], skipped: 0 };
  const cutoff = Date.now() - MIN_AGE_HOURS_FOR_EVALUATION * 60 * 60 * 1000;
  const eligible = rows.filter((row: any) => new Date(row.created_at).getTime() <= cutoff).slice(0, limit);
  const minimalInput: CanonicalConversationRequest = { message: "", surface: "consumer", estate_id: scope.estate_id || null, home_id: scope.home_id || null } as CanonicalConversationRequest;
  const contract: IntelligenceRequestContract = {
    conversation_request_id: "outcome-evaluation",
    thread_id: null,
    surface: "consumer",
    operation_class: "read",
    intent: "evidence",
    scope_mode: "home_scope",
    temporal_scope: { mode: "current", from: null, to: null },
    target: { object_type: null, canonical_id: null, parent_id: null, channel_code: null, label: null },
    mutation: { requested: false, confirmed: false, command: null, desired_state: null, risk_class: "read" },
    evidence_requirements: { current_state: true, recent_events: true, execution_history: true, audit_history: false, relationships: false, permissions: true, provider_state: false, financial_ledger: false, access_records: false },
    answer_builder: null,
    report_builder: null,
    truth_policy: "read_only_no_execution",
    confidence: 0.8,
  } as unknown as IntelligenceRequestContract;

  const evaluated: EvaluatedPrediction[] = [];
  for (const row of eligible as Record<string, unknown>[]) {
    const predictionType = text(row.prediction_type);
    let result: EvaluatedPrediction;
    if (predictionType === "device_reliability_risk") result = await evaluateDeviceReliability(row, minimalInput, contract);
    else if (predictionType === "maintenance_sla_risk") result = await evaluateMaintenanceRisk(row, minimalInput, contract);
    else if (predictionType === "automation_failure_risk") result = await evaluateAutomationReliability(row, minimalInput, contract);
    else result = { prediction_id: text(row.id), prediction_type: predictionType, outcome: "unobservable", notes: "No evaluator implemented for this prediction type yet." };
    evaluated.push(result);
    if (result.outcome !== "unobservable") {
      await persistOutcome(result);
      await closePrediction(result);
    }
  }
  return { evaluated, skipped: rows.length - eligible.length };
}

async function closePrediction(result: EvaluatedPrediction) {
  try {
    const { error } = await supabaseAdmin
      .from("ochiga_intelligence_predictions")
      .update({ status: result.outcome === "realized" ? "resolved" : "dismissed", updated_at: new Date().toISOString() } as any)
      .eq("id", result.prediction_id)
      .eq("status", "open");
    if (error) throw error;
  } catch (error) {
    logger.warn("oyi_prediction_close_failed", { prediction_id: result.prediction_id, error });
  }
}

async function persistOutcome(result: EvaluatedPrediction) {
  try {
    const { error } = await supabaseAdmin.from("intelligence_feedback").insert({
      object_type: "oyi_prediction",
      object_id: result.prediction_id,
      feedback_type: "outcome_evaluation",
      actor_id: null,
      reason: result.notes,
      outcome_metadata: { outcome: result.outcome, prediction_type: result.prediction_type, evaluated_at: new Date().toISOString() },
    } as any);
    if (error) throw error;
  } catch (error) {
    logger.warn("oyi_prediction_outcome_persist_failed", { prediction_id: result.prediction_id, error });
  }
}

export async function summarizeEvaluatedPredictions(scope: { estate_id?: string | null; home_id?: string | null }) {
  try {
    const predictionsResult = await listPersistedPredictions({ estate_id: scope.estate_id, home_id: scope.home_id, limit: 200 });
    if (predictionsResult.unavailable) return { unavailable: true, total: 0, realized: 0, not_realized: 0, accuracy: null as number | null };
    const ids = predictionsResult.rows.map((row: any) => String(row.id));
    if (!ids.length) return { unavailable: false, total: 0, realized: 0, not_realized: 0, accuracy: null as number | null };
    const { data, error } = await supabaseAdmin.from("intelligence_feedback").select("object_id,outcome_metadata").eq("object_type", "oyi_prediction").eq("feedback_type", "outcome_evaluation").in("object_id", ids);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    let realized = 0;
    let notRealized = 0;
    for (const row of rows as any[]) {
      const outcome = text(recordOf(row.outcome_metadata).outcome);
      if (outcome === "realized") realized += 1;
      else if (outcome === "not_realized") notRealized += 1;
    }
    const total = realized + notRealized;
    return { unavailable: false, total, realized, not_realized: notRealized, accuracy: total ? realized / total : null };
  } catch (error) {
    logger.warn("oyi_prediction_evaluation_summary_failed", { error });
    return { unavailable: true, total: 0, realized: 0, not_realized: 0, accuracy: null as number | null };
  }
}
