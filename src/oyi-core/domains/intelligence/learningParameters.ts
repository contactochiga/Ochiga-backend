import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";

export type RolloutStage = "observe" | "shadow" | "reviewed" | "enabled";

export type LearningParameter = {
  id: string;
  name: string;
  scope_estate_id: string | null;
  scope_home_id: string | null;
  version: number;
  current_value: unknown;
  proposed_value: unknown;
  min_bound: unknown;
  max_bound: unknown;
  rollout_stage: RolloutStage;
  evaluation_basis: Record<string, unknown>;
};

// Hard boundary (§10, verbatim categories) — learning may tune ranking
// weights, detector/anomaly thresholds, confidence calibration, alert
// timing and suppression cooldowns. It must NEVER touch permissions, RLS,
// access control, financial authority, confirmation requirements, security
// policy, safety constraints, or allowed-action-type definitions. This is
// enforced here in code, not left to convention: any parameter name
// matching a forbidden term is rejected before it can ever be created or
// adjusted, regardless of what evaluation logic upstream computed.
const FORBIDDEN_NAME_PATTERN = /permission|rls|row.level.security|access.control|financial.authority|wallet.limit|confirmation.requirement|security.policy|safety.constraint|allowed.action.type|risk_class|authority/i;

const ALLOWED_NAME_PREFIXES = [
  "anomaly.",
  "prediction.",
  "forecast.",
  "recommendation.",
  "ranking.",
  "notification.cooldown.",
  "notification.suppression.",
];

function assertLearnableParameter(name: string) {
  if (FORBIDDEN_NAME_PATTERN.test(name)) {
    throw new Error(`oyi_learning_parameter_forbidden: "${name}" falls outside the permitted learning boundary (§10) and can never be tuned by learning.`);
  }
  if (!ALLOWED_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    throw new Error(`oyi_learning_parameter_unrecognized_namespace: "${name}" is not under a recognized learnable namespace (${ALLOWED_NAME_PREFIXES.join(", ")}).`);
  }
}

function clampToBounds(value: number, min: unknown, max: unknown): number {
  let result = value;
  if (typeof min === "number" && result < min) result = min;
  if (typeof max === "number" && result > max) result = max;
  return result;
}

export async function getLearningParameter(name: string, scope: { estate_id?: string | null; home_id?: string | null }, fallbackValue: unknown, bounds?: { min?: number; max?: number }): Promise<LearningParameter> {
  assertLearnableParameter(name);
  const estateId = scope.estate_id || null;
  const homeId = scope.home_id || null;
  try {
    let query = supabaseAdmin.from("oyi_learning_parameters").select("*").eq("name", name).limit(1);
    query = estateId ? query.eq("scope_estate_id", estateId) : query.is("scope_estate_id", null);
    query = homeId ? query.eq("scope_home_id", homeId) : query.is("scope_home_id", null);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (data) return data as unknown as LearningParameter;
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("oyi_learning_parameters")
      .insert({
        name,
        scope_estate_id: estateId,
        scope_home_id: homeId,
        version: 1,
        current_value: fallbackValue,
        proposed_value: null,
        min_bound: typeof bounds?.min === "number" ? bounds.min : null,
        max_bound: typeof bounds?.max === "number" ? bounds.max : null,
        rollout_stage: "observe",
        evaluation_basis: {},
      } as any)
      .select("*")
      .maybeSingle();
    if (insertError) throw insertError;
    return inserted as unknown as LearningParameter;
  } catch (error) {
    logger.warn("oyi_learning_parameter_load_failed", { name, error });
    return {
      id: "",
      name,
      scope_estate_id: estateId,
      scope_home_id: homeId,
      version: 0,
      current_value: fallbackValue,
      proposed_value: null,
      min_bound: bounds?.min ?? null,
      max_bound: bounds?.max ?? null,
      rollout_stage: "observe",
      evaluation_basis: {},
    };
  }
}

// Writes a PROPOSED adjustment only — current_value never changes here.
// This is deliberate: learning starts in observe -> evaluate ->
// recommend-adjustment mode only (§10), and no code path in this module
// ever auto-applies a proposal. Moving a proposal into current_value is a
// separate, explicit, human-reviewed action (promoteLearningParameter)
// gated by rollout_stage, never called automatically.
export async function proposeLearningParameterAdjustment(name: string, scope: { estate_id?: string | null; home_id?: string | null }, proposedValue: number, evaluationBasis: Record<string, unknown>): Promise<{ ok: boolean }> {
  assertLearnableParameter(name);
  const parameter = await getLearningParameter(name, scope, proposedValue);
  if (!parameter.id) return { ok: false };
  const clamped = clampToBounds(proposedValue, parameter.min_bound, parameter.max_bound);
  try {
    const { error } = await supabaseAdmin
      .from("oyi_learning_parameters")
      .update({ proposed_value: clamped, evaluation_basis: evaluationBasis, updated_at: new Date().toISOString() } as any)
      .eq("id", parameter.id);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    logger.warn("oyi_learning_parameter_propose_failed", { name, error });
    return { ok: false };
  }
}

// Explicit, human-triggered promotion between rollout stages
// (observe -> shadow -> reviewed -> enabled). Only "enabled" moves the
// proposed_value into current_value, and even then only when the caller
// explicitly requests it — never invoked from any evaluation/detection
// code path in this module. There is deliberately no scheduler or trigger
// anywhere in Programme 3 that calls this automatically.
export async function promoteLearningParameter(id: string, nextStage: RolloutStage): Promise<{ ok: boolean }> {
  try {
    const { data, error } = await supabaseAdmin.from("oyi_learning_parameters").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false };
    const parameter = data as unknown as LearningParameter;
    assertLearnableParameter(parameter.name);
    const update: Record<string, unknown> = { rollout_stage: nextStage, updated_at: new Date().toISOString() };
    if (nextStage === "enabled" && parameter.proposed_value != null) {
      update.current_value = parameter.proposed_value;
      update.proposed_value = null;
      update.version = (parameter.version || 1) + 1;
    }
    const { error: updateError } = await supabaseAdmin.from("oyi_learning_parameters").update(update as any).eq("id", id);
    if (updateError) throw updateError;
    return { ok: true };
  } catch (error) {
    logger.warn("oyi_learning_parameter_promote_failed", { id, nextStage, error });
    return { ok: false };
  }
}
