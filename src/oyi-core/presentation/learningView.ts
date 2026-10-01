// Intelligence System Visibility, Slice 6 -- Learning.
//
// Answers "what outcome/feedback evidence is Oyi collecting, and is any
// of it actually changing future behaviour?" without overselling:
//   - mechanism wiring is stated from code (re-derived by a static smoke
//     guard, so it cannot silently go stale), and
//   - observed state comes from head-only counts plus ONE bounded,
//     column-limited read of oyi_learning_parameters, whose free-form
//     fields are whitelisted before anything leaves this module.
// Never selected: intelligence_feedback.reason/actor_id/object_id, any
// outcome_metadata other than the single result field being counted,
// learning-parameter scope IDs.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { ALLOWED_NAME_PREFIXES, LEARNING_FORBIDDEN_NAME_TERMS, assertLearnableParameter } from "../domains/intelligence/learningParameters";
import { EVALUABLE_PREDICTION_TYPES, LEARNING_MIN_SAMPLE_THRESHOLD, learningProposalPassEnabledInThisProcess } from "../domains/intelligence/learningProposalPass";
import { DISMISSAL_FEEDBACK_TYPES } from "../domains/intelligence/recommendationDismissalEvidence";
import { OBJECT_TYPE as DEVICE_OBJECT_TYPE, FEEDBACK_TYPE as DEVICE_FEEDBACK_TYPE } from "../domains/devices/deviceOutcomeEvaluator";
import { OBJECT_TYPE as CAMERA_OBJECT_TYPE, FEEDBACK_TYPE as CAMERA_FEEDBACK_TYPE } from "../../modules/cameras/cameraOutcomeEvaluator";
import { OBJECT_TYPE as MAINTENANCE_OBJECT_TYPE, FEEDBACK_TYPE as MAINTENANCE_FEEDBACK_TYPE } from "../../services/maintenanceOutcomeEvaluator";
import { OBJECT_TYPE as VISITOR_OBJECT_TYPE, FEEDBACK_TYPE as VISITOR_FEEDBACK_TYPE } from "../../services/visitorOutcomeEvaluator";

const PARAMETER_READ_LIMIT = 200;
const PROMOTION_READ_LIMIT = 1000;

// Outcome result vocabularies mirror each evaluator's own exported result
// type (EvaluationOutcome / DeviceOutcomeResult / CameraOutcomeResult /
// MaintenanceOutcomeResult / VisitorOutcomeResult); a static smoke guard
// fails if any of those types changes without this table. "observable"
// marks results that reflect a real observation, as opposed to
// "unobservable"/"unverified"/"unsupported" (evidence was not available).
export const OUTCOME_SOURCES = [
  {
    key: "prediction",
    label: "Prediction outcomes",
    object_type: "oyi_prediction",
    feedback_type: "outcome_evaluation",
    result_field: "outcome",
    results: [
      { value: "realized", observable: true },
      { value: "not_realized", observable: true },
      { value: "partial", observable: true },
      { value: "unobservable", observable: false },
    ],
  },
  {
    key: "device_state",
    label: "Device state outcomes",
    object_type: DEVICE_OBJECT_TYPE,
    feedback_type: DEVICE_FEEDBACK_TYPE,
    result_field: "result",
    results: [
      { value: "achieved", observable: true },
      { value: "contradicted", observable: true },
      { value: "unverified", observable: false },
      { value: "unsupported", observable: false },
    ],
  },
  {
    key: "camera_state",
    label: "Camera state outcomes",
    object_type: CAMERA_OBJECT_TYPE,
    feedback_type: CAMERA_FEEDBACK_TYPE,
    result_field: "result",
    results: [
      { value: "achieved", observable: true },
      { value: "contradicted", observable: true },
      { value: "unverified", observable: false },
    ],
  },
  {
    key: "maintenance",
    label: "Maintenance outcomes",
    object_type: MAINTENANCE_OBJECT_TYPE,
    feedback_type: MAINTENANCE_FEEDBACK_TYPE,
    result_field: "result",
    results: [
      { value: "achieved", observable: true },
      { value: "unverified", observable: false },
    ],
  },
  {
    key: "visitor",
    label: "Visitor outcomes",
    object_type: VISITOR_OBJECT_TYPE,
    feedback_type: VISITOR_FEEDBACK_TYPE,
    result_field: "result",
    results: [
      { value: "achieved", observable: true },
      { value: "not_achieved", observable: true },
      { value: "unverified", observable: false },
    ],
  },
] as const;

// Code wiring, as of this slice. A static smoke guard re-derives each
// claim from source (callers, flags, model_type) so these cannot drift.
export const LEARNING_MECHANISMS = {
  evidence_collection: {
    label: "Evidence Collection",
    status: "active" as const,
    detail: "Outcome evaluators run from the goal runtime; prediction outcomes are evaluated by the proactive scheduler; feedback is recorded through the runtime feedback route.",
  },
  parameter_proposal: {
    label: "Parameter Proposals",
    status: "config_gated" as const,
    detail: `A proposal pass computes empirical confidence calibration for ${EVALUABLE_PREDICTION_TYPES.length} prediction types once at least ${LEARNING_MIN_SAMPLE_THRESHOLD} evaluated outcomes exist. It runs in the worker process only when OYI_LEARNING_PROPOSAL_ENABLED is "true" (off by default). It only writes proposed_value -- never current_value.`,
  },
  human_promotion: {
    label: "Human Promotion",
    status: "inactive_unwired" as const,
    detail: "promoteLearningParameter exists (compare-and-swap, named approver required to enable) but no route, job or caller invokes it.",
  },
  automatic_promotion: {
    label: "Automatic Promotion",
    status: "not_implemented" as const,
    detail: "Deliberately absent: no scheduler or trigger promotes a proposal automatically.",
  },
  model_training: {
    label: "Model Training",
    status: "not_implemented" as const,
    detail: "No training exists. Prediction providers are rule-based (model_type \"rule\").",
  },
};

// The ONLY behaviour-changing consumer: prediction providers apply a
// calibration when, and only when, its rollout_stage is "enabled"
// (predictionProviders.ts applyCalibration).
const BEHAVIOUR_CHANGING_STAGE = "enabled";

type Timed<T> = { ok: true; value: T } | { ok: false; error: string };

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function learnable(name: string): boolean {
  try {
    assertLearnableParameter(name);
    return true;
  } catch {
    return false;
  }
}

function namespaceOf(name: string): string | null {
  return ALLOWED_NAME_PREFIXES.find((prefix) => name.startsWith(prefix)) || null;
}

// Whitelist over the free-form evaluation_basis jsonb: only the fields
// learningProposalPass itself writes, only as numbers/ISO timestamps,
// and `method` only when it is a plain snake_case identifier.
function safeEvidence(basis: unknown) {
  const b = basis && typeof basis === "object" && !Array.isArray(basis) ? (basis as Record<string, unknown>) : {};
  const method = typeof b.method === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(b.method) ? b.method : null;
  return {
    method,
    sample_size: finiteNumber(b.sample_size),
    realized: finiteNumber(b.realized),
    not_realized: finiteNumber(b.not_realized),
    accuracy: finiteNumber(b.accuracy),
    evaluated_at: isoOrNull(b.evaluated_at),
  };
}

export type LearningView = Awaited<ReturnType<typeof buildLearningView>>;

export async function buildLearningView() {
  const timings: Record<string, number> = {};
  let queryCount = 0;
  async function timed<T>(name: string, fn: () => Promise<T>): Promise<Timed<T>> {
    const startedAt = Date.now();
    try {
      const value = await fn();
      timings[name] = Date.now() - startedAt;
      return { ok: true, value };
    } catch (err: any) {
      timings[name] = Date.now() - startedAt;
      return { ok: false, error: err?.message || String(err) };
    }
  }
  async function headCount(table: string, apply: (q: any) => any): Promise<number> {
    queryCount += 1;
    const { count, error } = await apply(supabaseAdmin.from(table).select("*", { count: "exact", head: true }));
    if (error) throw new Error(error.message || "count_failed");
    return count ?? 0;
  }

  const parameters = timed("learning_parameters", async () => {
    queryCount += 2;
    const [paramsRes, promotionsRes] = await Promise.all([
      supabaseAdmin
        .from("oyi_learning_parameters")
        .select("id,name,scope_estate_id,scope_home_id,version,current_value,proposed_value,min_bound,max_bound,rollout_stage,evaluation_basis,created_at,updated_at")
        .order("name", { ascending: true })
        .limit(PARAMETER_READ_LIMIT),
      supabaseAdmin.from("oyi_learning_parameter_promotions").select("parameter_id,is_rollback").limit(PROMOTION_READ_LIMIT),
    ]);
    if (paramsRes.error) throw new Error(paramsRes.error.message || "learning_parameters_failed");
    if (promotionsRes.error) throw new Error(promotionsRes.error.message || "learning_promotions_failed");
    const promotionsByParam = new Map<string, { promotions: number; rollbacks: number }>();
    for (const row of (promotionsRes.data || []) as any[]) {
      const entry = promotionsByParam.get(String(row.parameter_id)) || { promotions: 0, rollbacks: 0 };
      if (row.is_rollback) entry.rollbacks += 1;
      else entry.promotions += 1;
      promotionsByParam.set(String(row.parameter_id), entry);
    }
    const rows = (paramsRes.data || []) as any[];
    let nonConforming = 0;
    const items = rows.flatMap((row) => {
      const name = String(row.name || "");
      if (!learnable(name)) {
        nonConforming += 1;
        return [];
      }
      const history = promotionsByParam.get(String(row.id)) || { promotions: 0, rollbacks: 0 };
      const proposed = finiteNumber(row.proposed_value);
      return [{
        name,
        namespace: namespaceOf(name),
        scope: row.scope_estate_id || row.scope_home_id ? ("scoped" as const) : ("global" as const),
        rollout_stage: String(row.rollout_stage),
        changes_behaviour: row.rollout_stage === BEHAVIOUR_CHANGING_STAGE,
        version: finiteNumber(row.version),
        current_value: finiteNumber(row.current_value),
        proposed_value: proposed,
        has_pending_proposal: row.proposed_value != null,
        bounds: { min: finiteNumber(row.min_bound), max: finiteNumber(row.max_bound) },
        evidence: safeEvidence(row.evaluation_basis),
        promotions: history.promotions,
        rollbacks: history.rollbacks,
        created_at: isoOrNull(row.created_at),
        updated_at: isoOrNull(row.updated_at),
      }];
    });
    const byStage: Record<string, number> = { observe: 0, shadow: 0, reviewed: 0, enabled: 0 };
    items.forEach((item) => { byStage[item.rollout_stage] = (byStage[item.rollout_stage] || 0) + 1; });
    return {
      items,
      total: items.length,
      truncated: rows.length >= PARAMETER_READ_LIMIT,
      non_conforming_hidden: nonConforming,
      by_rollout_stage: byStage,
      pending_proposals: items.filter((i) => i.has_pending_proposal).length,
      behaviour_changing: items.filter((i) => i.changes_behaviour).length,
      promotions_recorded: Array.from(promotionsByParam.values()).reduce((a, e) => a + e.promotions, 0),
      rollbacks_recorded: Array.from(promotionsByParam.values()).reduce((a, e) => a + e.rollbacks, 0),
    };
  });

  // Feedback: only canonical (object_type, feedback_type) pairs are named.
  // /oyi/runtime/feedback accepts caller-supplied type strings, so any
  // other pair is counted as "other" and never echoed back.
  const feedback = timed("feedback", async () => {
    const dismissalPairs = DISMISSAL_FEEDBACK_TYPES.map((type) => ({ key: `recommendation_${type}`, label: `Recommendation ${type.replace(/_/g, " ")}`, object_type: "recommendation", feedback_type: type }));
    const outcomePairs = OUTCOME_SOURCES.map((s) => ({ key: `${s.key}_evaluation`, label: s.label, object_type: s.object_type, feedback_type: s.feedback_type }));
    const pairs = [...dismissalPairs, ...outcomePairs];
    const [total, ...counts] = await Promise.all([
      headCount("intelligence_feedback", (q) => q),
      ...pairs.map((p) => headCount("intelligence_feedback", (q) => q.eq("object_type", p.object_type).eq("feedback_type", p.feedback_type))),
    ]);
    const known = counts.reduce((a, b) => a + b, 0);
    return {
      total,
      canonical: pairs.map((p, i) => ({ key: p.key, label: p.label, kind: p.object_type === "recommendation" ? ("recommendation_dismissal" as const) : ("outcome_evaluation" as const), count: counts[i] })),
      other: Math.max(0, total - known),
    };
  });

  const outcomes = OUTCOME_SOURCES.map((source) =>
    timed(`outcomes_${source.key}`, async () => {
      const base = (q: any) => q.eq("object_type", source.object_type).eq("feedback_type", source.feedback_type);
      const [total, ...byResult] = await Promise.all([
        headCount("intelligence_feedback", base),
        ...source.results.map((r) => headCount("intelligence_feedback", (q) => base(q).eq(`outcome_metadata->>${source.result_field}`, r.value))),
      ]);
      const results = source.results.map((r, i) => ({ value: r.value, observable: r.observable, count: byResult[i] }));
      return {
        key: source.key,
        label: source.label,
        evaluated: total,
        observable: results.filter((r) => r.observable).reduce((a, r) => a + r.count, 0),
        unobservable: results.filter((r) => !r.observable).reduce((a, r) => a + r.count, 0),
        results,
      };
    })
  );

  const [parametersResult, feedbackResult, ...outcomeResults] = await Promise.all([parameters, feedback, ...outcomes]);
  const p = parametersResult.ok ? parametersResult.value : null;

  const sources = {
    learning_parameters: parametersResult.ok,
    feedback: feedbackResult.ok,
    ...Object.fromEntries(OUTCOME_SOURCES.map((s, i) => [`outcomes_${s.key}`, outcomeResults[i].ok])),
  };
  const slowest = Object.entries(timings).sort((a, b) => b[1] - a[1])[0];

  return {
    complete: Object.values(sources).every(Boolean),
    sources,
    mechanisms: {
      evidence_collection: { ...LEARNING_MECHANISMS.evidence_collection, implemented: true, observed: feedbackResult.ok ? { available: true, evidence_rows: feedbackResult.value.total } : { available: false } },
      parameter_proposal: { ...LEARNING_MECHANISMS.parameter_proposal, implemented: true, enabled_in_this_process: learningProposalPassEnabledInThisProcess(), runs_in: "worker", observed: p ? { available: true, pending_proposals: p.pending_proposals } : { available: false } },
      human_promotion: { ...LEARNING_MECHANISMS.human_promotion, implemented: true, observed: p ? { available: true, promotions_recorded: p.promotions_recorded, rollbacks_recorded: p.rollbacks_recorded } : { available: false } },
      automatic_promotion: { ...LEARNING_MECHANISMS.automatic_promotion, implemented: false },
      model_training: { ...LEARNING_MECHANISMS.model_training, implemented: false },
    },
    behaviour_change: p
      ? { available: true, parameters_changing_behaviour: p.behaviour_changing, rule: "A calibration only changes prediction confidence when its rollout_stage is \"enabled\", which only promotion can set." }
      : { available: false },
    parameters: p
      ? { available: true, total: p.total, truncated: p.truncated, non_conforming_hidden: p.non_conforming_hidden, by_rollout_stage: p.by_rollout_stage, pending_proposals: p.pending_proposals, items: p.items }
      : { available: false },
    feedback: feedbackResult.ok ? { available: true, ...feedbackResult.value } : { available: false },
    outcomes: OUTCOME_SOURCES.map((s, i) => {
      const r = outcomeResults[i];
      return r.ok ? { available: true, ...r.value } : { available: false, key: s.key, label: s.label };
    }),
    safety_boundary: {
      allowed_namespaces: [...ALLOWED_NAME_PREFIXES],
      forbidden_terms: [...LEARNING_FORBIDDEN_NAME_TERMS],
      enforcement: "assertLearnableParameter rejects any forbidden term or unrecognised namespace on every read, proposal, promotion and rollback -- before any write.",
      approval: "Moving a value into effect (rollout_stage \"enabled\") requires a named human approver.",
      rollout_stages: ["observe", "shadow", "reviewed", "enabled"],
    },
    performance: {
      query_count: queryCount,
      source_timings_ms: timings,
      slowest_source: slowest ? { name: slowest[0], ms: slowest[1] } : null,
    },
  };
}
