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

// Wave 8 Slice 5 -- read-side cache only (Section 30). A promoted or
// rolled-back value becomes visible to every NEW consumer call within at
// most CACHE_TTL_MS (default 60s) — no restart required, no explicit
// invalidation call needed. This trades a bounded staleness window for
// avoiding a DB round trip on every single provider evaluation; the
// window is short relative to how infrequently a parameter is actually
// promoted (a deliberate, human-gated action), so "must eventually take
// effect" (Section 30) is satisfied comfortably.
const CACHE_TTL_MS = Math.max(1000, Number(process.env.OYI_LEARNING_PARAMETER_CACHE_TTL_MS || 60000));
const parameterCache = new Map<string, { value: LearningParameter; expiresAt: number }>();

function cacheKey(name: string, scope: { estate_id?: string | null; home_id?: string | null }): string {
  return `${name}::${scope.estate_id || ""}::${scope.home_id || ""}`;
}

export async function getLearningParameterCached(name: string, scope: { estate_id?: string | null; home_id?: string | null }, fallbackValue: unknown, bounds?: { min?: number; max?: number }): Promise<LearningParameter> {
  const key = cacheKey(name, scope);
  const cached = parameterCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await getLearningParameter(name, scope, fallbackValue, bounds);
  parameterCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

// Wave 8 Slice 5 -- best-effort append-only audit row (Sections 10/26).
// Written AFTER the compare-and-swap update already durably applied the
// state change, mirroring the exact precedent Wave 8 Slice 4's Office
// prerequisite established for transitionOpportunity(): the CAS update
// is the source of truth for the actual state; if this audit insert
// fails, the promotion has still genuinely happened and is not rolled
// back — only the history record is (disclosed) best-effort, logged on
// failure, never silently swallowed.
async function recordPromotion(entry: {
  parameterId: string;
  fromStage: RolloutStage;
  toStage: RolloutStage;
  previousValue: unknown;
  newValue: unknown;
  versionBefore: number;
  versionAfter: number;
  evidence: Record<string, unknown>;
  approver: string | null;
  isRollback: boolean;
}): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("oyi_learning_parameter_promotions").insert({
      parameter_id: entry.parameterId,
      from_stage: entry.fromStage,
      to_stage: entry.toStage,
      previous_value: entry.previousValue,
      new_value: entry.newValue,
      version_before: entry.versionBefore,
      version_after: entry.versionAfter,
      evidence: entry.evidence,
      approver: entry.approver,
      is_rollback: entry.isRollback,
    } as any);
    if (error) throw error;
  } catch (error) {
    logger.warn("oyi_learning_parameter_promotion_audit_write_failed", { parameterId: entry.parameterId, error });
  }
}

export type PromotionResult =
  | { ok: true; alreadyApplied: boolean; parameter: LearningParameter }
  | { ok: false; reason: "not_found" | "stale" | "approver_required" | "update_failed" };

// Explicit, human-triggered promotion between rollout stages
// (observe -> shadow -> reviewed -> enabled). Only "enabled" moves the
// proposed_value into current_value, and even then only when the caller
// explicitly requests it — never invoked from any evaluation/detection
// code path in this module. There is deliberately no scheduler or trigger
// anywhere in Programme 3 that calls this automatically.
//
// Wave 8 Slice 5 hardening (Sections 8/27/33):
//   - `options.expectedVersion`/`expectedStage` are a real compare-and-
//     swap precondition, repeated verbatim in the UPDATE's WHERE clause.
//     Two concurrent promotions reading the same pre-update row cannot
//     both succeed; the loser's UPDATE affects zero rows and this
//     function reports "stale" rather than silently overwriting a
//     change it never saw.
//   - Default posture is HUMAN APPROVAL (Section 8): the one transition
//     that can change future reasoning (-> "enabled", moving
//     proposed_value into current_value) is refused outright without a
//     named approver. Earlier stage transitions (observe -> shadow, or
//     -> reviewed — curating which proposals are worth a human's
//     attention) never touch current_value, so they are not gated the
//     same way.
//   - A retry carrying the OLD expected version/stage, after the exact
//     same transition already applied, is reported as an idempotent
//     success (`alreadyApplied: true`) rather than a stale failure —
//     retrying an already-applied operation must not look broken. This
//     is decided by a SOUND signal, not a loose shape-heuristic on the
//     current row: since exactly one promotion can ever consume a given
//     (parameter_id, version_before) pair (each successful CAS strictly
//     increments version), a promotion-history row with
//     version_before === options.expectedVersion AND
//     to_stage === nextStage proves this exact transition already
//     happened — regardless of who performed it — and is a fact, never
//     an inference from current_value/proposed_value shape (which could
//     coincidentally match a DIFFERENT promotion and falsely look like
//     "your own retry" — the bug this design deliberately avoids).
export async function promoteLearningParameter(id: string, nextStage: RolloutStage, options: { approver: string | null; expectedVersion: number; expectedStage: RolloutStage }): Promise<PromotionResult> {
  try {
    const { data, error } = await supabaseAdmin.from("oyi_learning_parameters").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, reason: "not_found" };
    const parameter = data as unknown as LearningParameter;
    assertLearnableParameter(parameter.name);

    if (nextStage === "enabled" && !options.approver) {
      return { ok: false, reason: "approver_required" };
    }

    if (parameter.version !== options.expectedVersion || parameter.rollout_stage !== options.expectedStage) {
      const { data: matchingPromotion, error: historyError } = await supabaseAdmin
        .from("oyi_learning_parameter_promotions")
        .select("*")
        .eq("parameter_id", id)
        .eq("version_before", options.expectedVersion)
        .eq("to_stage", nextStage)
        .limit(1)
        .maybeSingle();
      if (!historyError && matchingPromotion) return { ok: true, alreadyApplied: true, parameter };
      return { ok: false, reason: "stale" };
    }

    const previousValue = parameter.current_value;
    const versionBefore = parameter.version || 1;
    const update: Record<string, unknown> = { rollout_stage: nextStage, updated_at: new Date().toISOString() };
    let newValue = previousValue;
    let versionAfter = versionBefore;
    if (nextStage === "enabled" && parameter.proposed_value != null) {
      newValue = parameter.proposed_value;
      update.current_value = newValue;
      update.proposed_value = null;
      versionAfter = versionBefore + 1;
      update.version = versionAfter;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("oyi_learning_parameters")
      .update(update as any)
      .eq("id", id)
      .eq("version", options.expectedVersion)
      .eq("rollout_stage", options.expectedStage)
      .select("*")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return { ok: false, reason: "stale" };

    parameterCache.delete(cacheKey(parameter.name, { estate_id: parameter.scope_estate_id, home_id: parameter.scope_home_id }));

    await recordPromotion({
      parameterId: id,
      fromStage: options.expectedStage,
      toStage: nextStage,
      previousValue,
      newValue,
      versionBefore,
      versionAfter,
      evidence: parameter.evaluation_basis || {},
      approver: options.approver,
      isRollback: false,
    });

    return { ok: true, alreadyApplied: false, parameter: updated as unknown as LearningParameter };
  } catch (error) {
    logger.warn("oyi_learning_parameter_promote_failed", { id, nextStage, error });
    return { ok: false, reason: "update_failed" };
  }
}

// Wave 8 Slice 5 -- Section 11. A promoted parameter must be reversible.
// Restores current_value to whatever it was immediately before the most
// recent promotion event recorded in oyi_learning_parameter_promotions,
// as a NEW, separately-audited promotion (never a raw overwrite or a
// deleted history row — historical rows are permanent, matching this
// entire programme's established "never rewrite history" doctrine).
// Also requires a named approver (Section 8's same default posture
// applies to undoing a promotion, not just making one) and uses the
// same real compare-and-swap precondition.
export async function rollbackLearningParameter(id: string, options: { approver: string }): Promise<PromotionResult> {
  try {
    if (!options.approver) return { ok: false, reason: "approver_required" };
    const { data, error } = await supabaseAdmin.from("oyi_learning_parameters").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, reason: "not_found" };
    const parameter = data as unknown as LearningParameter;
    assertLearnableParameter(parameter.name);

    const { data: lastPromotion, error: historyError } = await supabaseAdmin
      .from("oyi_learning_parameter_promotions")
      .select("*")
      .eq("parameter_id", id)
      .order("promoted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (historyError) throw historyError;
    if (!lastPromotion) return { ok: false, reason: "not_found" };

    const versionBefore = parameter.version || 1;
    const restoredValue = (lastPromotion as any).previous_value;
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("oyi_learning_parameters")
      .update({ current_value: restoredValue, version: versionBefore + 1, updated_at: new Date().toISOString() } as any)
      .eq("id", id)
      .eq("version", versionBefore)
      .select("*")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return { ok: false, reason: "stale" };

    parameterCache.delete(cacheKey(parameter.name, { estate_id: parameter.scope_estate_id, home_id: parameter.scope_home_id }));

    await recordPromotion({
      parameterId: id,
      fromStage: parameter.rollout_stage,
      toStage: parameter.rollout_stage,
      previousValue: parameter.current_value,
      newValue: restoredValue,
      versionBefore,
      versionAfter: versionBefore + 1,
      evidence: { rollback_of_promotion_id: (lastPromotion as any).id },
      approver: options.approver,
      isRollback: true,
    });

    return { ok: true, alreadyApplied: false, parameter: updated as unknown as LearningParameter };
  } catch (error) {
    logger.warn("oyi_learning_parameter_rollback_failed", { id, error });
    return { ok: false, reason: "update_failed" };
  }
}
