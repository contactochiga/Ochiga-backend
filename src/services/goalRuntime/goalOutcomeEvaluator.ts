// Wave 8 Slice 3 -- Goal Outcome / Workflow Completion Separation.
//
// GoalRuntime/goalEvaluator.ts's own `status` field answers "has Oyi's
// PURSUIT of this goal finished" (workflow). It does NOT answer "was the
// real-world objective actually achieved" (outcome) -- Wave 8 Slice 0's
// own audit found these two questions silently collapsed at four call
// sites in goalEvaluator.ts (reply_received, positive_reply, plan
// exhaustion, last-dispatch-ok). This module answers the SECOND question,
// honestly, without changing the first one at all.
//
// Deliberately a pure, read-only, ON-DEMAND derivation -- not a stored
// field on oyi_goals, not a value computed and cached at goal-evaluation
// time, and not wired into evaluateGoal()/goalScheduler.ts anywhere. This
// is the smallest-possible design per the task's own §4/§26 instruction:
// GoalRuntime's existing status machine (scheduler due-scan, CAS claim,
// terminality, Office compatibility) is untouched -- zero diff to
// GoalRuntime.ts or goalEvaluator.ts. A caller who wants to know a goal's
// outcome calls deriveGoalOutcome(goal) explicitly; nothing calls it
// automatically yet (matching Wave 8 Slice 2's own "queryable only, no
// automatic consumer" precedent).
//
// Persistence: NONE. This module never writes anywhere -- it reads the
// goal's own `plan` (already migrated, oyi_goals) and Wave 8 Slice 1's
// own `intelligence_feedback` device-outcome rows (already migrated, no
// new writes). No migration was needed for this slice -- see
// docs/WAVE8_SLICE3_GOAL_OUTCOME_WORKFLOW_SEPARATION.md §6 for the full
// justification.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import { operationalMetrics } from "../../observability/metrics";
import {
  objectIdFor as deviceObjectIdFor,
  OBJECT_TYPE as DEVICE_OUTCOME_OBJECT_TYPE,
  FEEDBACK_TYPE as DEVICE_OUTCOME_FEEDBACK_TYPE,
  type DeviceOutcomeResult,
} from "../../oyi-core/domains/devices/deviceOutcomeEvaluator";
import type { GoalRecord, GoalPlanStep } from "../../contracts/goal";

// Section 5 -- the smallest outcome vocabulary this evidence actually
// justifies. Deliberately not binary. "mixed" is defined for honesty
// (a goal with several device steps where some agree and some
// contradict) but is not reachable today with only one evaluator
// domain existing per step (each step is independently achieved OR
// contradicted, never itself ambiguous) -- it becomes reachable the
// moment a goal has two-or-more evaluated device steps that disagree,
// which the reduction below already handles correctly.
export type GoalOutcomeState = "achieved" | "not_achieved" | "unverified" | "mixed";

// Section 13 -- where a Goal outcome verdict came from. "unknown" here
// specifically means "no evaluator exists for this goal's domain at
// all" (e.g. a communication/Office goal) -- distinct from "unverified"
// evidence, which means an evaluator exists but current evidence is
// insufficient.
export type GoalOutcomeProvenance = "device_state_evaluation" | "no_evaluator_available" | "insufficient_evidence";

// Section 14 -- a pointer to the underlying intelligence_feedback row,
// never a copied blob of its content.
export type GoalOutcomeEvidenceRef = {
  stepIndex: number;
  deviceId: string;
  actionId: string;
  result: DeviceOutcomeResult;
  feedbackId: string | null;
  evaluatedAt: string | null;
};

export type GoalOutcome = {
  goalId: string;
  state: GoalOutcomeState;
  provenance: GoalOutcomeProvenance;
  // Section 15 -- distinct from oyi_goals.updated_at (workflow's own
  // last-touched timestamp). The latest evaluated_at among the
  // contributing device-outcome rows, or null when no evidence exists.
  evaluatedAt: string | null;
  evidence: GoalOutcomeEvidenceRef[];
  // Section 10/17 -- explicit, on every result, so no caller mistakes
  // this for a permanent, append-once verdict.
  note: string;
};

const NO_EVALUATOR_NOTE =
  "This goal has no device-action step, and no other outcome evaluator exists yet (Slice 4, Office/commercial outcome, is not built) -- " +
  "workflow completion for this goal says nothing about whether its real-world objective was achieved.";

const LIVE_DERIVATION_NOTE =
  "This is the goal's outcome as of the LATEST available evidence at read time, not a permanent, append-once verdict -- " +
  "some goals represent sustained conditions that can change after this evaluation (see docs/WAVE8_SLICE3_GOAL_OUTCOME_WORKFLOW_SEPARATION.md §17). " +
  "The underlying intelligence_feedback history itself is never rewritten; only this derived view reflects the most recent row per step.";

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isDeviceOutcomeStep(step: GoalPlanStep): step is GoalPlanStep & { device_command: NonNullable<GoalPlanStep["device_command"]> } {
  return step.action_type === "device_action" && Boolean(step.device_command) && (step.device_command!.action_id === "device.on" || step.device_command!.action_id === "device.off");
}

// One read-only lookup, identical in shape to goalEvaluator.ts's own
// existing decisionId lookup (Section 12 -- exposes lineage, never
// mutates oyi_decisions).
async function findDecisionIdForGoal(goalId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.from("oyi_decisions").select("id").eq("goal_id", goalId).limit(1).maybeSingle();
    return (data as any)?.id || null;
  } catch (error) {
    logger.warn("oyi_goal_outcome_decision_lookup_failed", { goal_id: goalId, error });
    return null;
  }
}

// Derives a goal's outcome from the CURRENT set of Wave 8 Slice 1 device-
// outcome evaluations for its own device-action steps -- never re-queries
// Wave 6 state itself (Section 28: one factual evaluation authority,
// device truth is never redefined here). Goals with zero device-action
// steps (every Office/communication goal today, per Section 10) honestly
// return "unverified" with provenance "no_evaluator_available" -- never
// fabricated as achieved just because the workflow finished.
export async function deriveGoalOutcome(goal: GoalRecord): Promise<GoalOutcome> {
  const deviceSteps = goal.plan.filter(isDeviceOutcomeStep);

  if (!deviceSteps.length) {
    operationalMetrics.increment("goal_outcome_derivation_total", { state: "unverified", provenance: "no_evaluator_available" });
    return { goalId: goal.id, state: "unverified", provenance: "no_evaluator_available", evaluatedAt: null, evidence: [], note: NO_EVALUATOR_NOTE };
  }

  const decisionId = await findDecisionIdForGoal(goal.id);
  const objectIds = deviceSteps.map((step) =>
    deviceObjectIdFor(
      { deviceId: step.device_command.device_id, decisionId, goalId: goal.id },
      step.device_command.action_id
    )
  );

  const { data: rows, error } = await supabaseAdmin
    .from("intelligence_feedback")
    .select("id,object_id,outcome_metadata,created_at")
    .eq("object_type", DEVICE_OUTCOME_OBJECT_TYPE)
    .eq("feedback_type", DEVICE_OUTCOME_FEEDBACK_TYPE)
    .in("object_id", Array.from(new Set(objectIds)));
  if (error) {
    logger.warn("oyi_goal_outcome_evidence_lookup_failed", { goal_id: goal.id, error });
  }

  // Latest row per object_id -- a device step's outcome can legitimately
  // be re-evaluated later (Section 16); the most recent evaluation is
  // the current truth, the earlier one remains intact and auditable in
  // intelligence_feedback itself (Section 21 of Slice 1), just not what
  // this derivation reports as "current."
  const latestByObjectId = new Map<string, { id: string; outcome_metadata: Record<string, unknown>; created_at: string }>();
  for (const row of (rows || []) as any[]) {
    const existing = latestByObjectId.get(row.object_id);
    if (!existing || new Date(row.created_at).getTime() > new Date(existing.created_at).getTime()) {
      latestByObjectId.set(row.object_id, row);
    }
  }

  const evidence: GoalOutcomeEvidenceRef[] = [];
  let latestEvaluatedAt: string | null = null;
  for (let i = 0; i < deviceSteps.length; i += 1) {
    const step = deviceSteps[i];
    const objectId = objectIds[i];
    const row = latestByObjectId.get(objectId);
    const metadata = row ? recordOf(row.outcome_metadata) : null;
    const result = (metadata?.result as DeviceOutcomeResult | undefined) || null;
    const evaluatedAt = (metadata?.evaluated_at as string | undefined) || row?.created_at || null;
    if (evaluatedAt && (!latestEvaluatedAt || evaluatedAt > latestEvaluatedAt)) latestEvaluatedAt = evaluatedAt;
    if (result) {
      evidence.push({ stepIndex: step.step_index, deviceId: step.device_command.device_id, actionId: step.device_command.action_id, result, feedbackId: row?.id || null, evaluatedAt });
    }
  }

  // Reduction rule (documented explicitly, not invented silently -- see
  // docs/WAVE8_SLICE3_GOAL_OUTCOME_WORKFLOW_SEPARATION.md §9): only
  // "achieved"/"contradicted" evidence counts as strong signal.
  // "unverified"/"unsupported" steps, or steps with no evaluation row at
  // all yet, contribute no signal (never coerced into failure). If no
  // strong evidence exists among this goal's device steps -> unverified.
  // If every strong signal agrees -> achieved or not_achieved. If they
  // disagree -> mixed, honestly, rather than picking a side.
  const strong = evidence.filter((e) => e.result === "achieved" || e.result === "contradicted");
  let state: GoalOutcomeState;
  let provenance: GoalOutcomeProvenance;
  if (!strong.length) {
    state = "unverified";
    provenance = "insufficient_evidence";
  } else {
    const allAchieved = strong.every((e) => e.result === "achieved");
    const allContradicted = strong.every((e) => e.result === "contradicted");
    state = allAchieved ? "achieved" : allContradicted ? "not_achieved" : "mixed";
    provenance = "device_state_evaluation";
  }

  operationalMetrics.increment("goal_outcome_derivation_total", { state, provenance });
  return { goalId: goal.id, state, provenance, evaluatedAt: latestEvaluatedAt, evidence, note: LIVE_DERIVATION_NOTE };
}
