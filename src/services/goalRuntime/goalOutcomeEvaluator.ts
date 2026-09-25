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
import { evaluateCommercialOpportunityOutcome, type CommercialOutcomeEvaluation } from "../../oyi-core/domains/development/commercialOutcomeEvaluator";
import { fetchOfficeOpportunitySnapshots } from "../../oyi-core/ingress/officeOpportunityBridge";
import { evaluateCameraOutcomes, type CameraOutcomeEvaluation } from "../../modules/cameras/cameraOutcomeEvaluator";
import { evaluateMaintenanceOutcomes, type MaintenanceOutcomeEvaluation } from "../maintenanceOutcomeEvaluator";
import { evaluateVisitorOutcomes, type VisitorOutcomeEvaluation } from "../visitorOutcomeEvaluator";
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
// Wave 8 Slice 4 -- three commercial-domain provenance values added,
// mirroring commercialOutcomeEvaluator.ts's own CommercialOutcomeProvenance
// verbatim (never re-typed independently, to avoid the two enums drifting).
// Wave 8 Slice 6 -- three more domain-specific provenance values, one per
// new evaluator, so a caller inspecting only GoalOutcome.provenance can
// still tell which real authority produced the verdict without needing
// the richer camera/maintenance/visitor sub-object.
export type GoalOutcomeProvenance =
  | "device_state_evaluation"
  | "no_evaluator_available"
  | "insufficient_evidence"
  | "commercial_opportunity_evaluation"
  | "no_target_specified"
  | "office_unavailable"
  | "camera_state_evaluation"
  | "maintenance_resident_verification"
  | "visitor_entry_evidence";

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
  // Wave 8 Slice 4 -- populated only when this Goal was evaluated via the
  // commercial path (device `evidence` above stays empty in that case,
  // and vice versa -- a Goal is device-oriented or commercial-oriented,
  // never both, per GoalTargetEntities' own established convention).
  // Additive-only: every existing device-path consumer's own fields
  // (state/provenance/evaluatedAt/evidence/note) are completely
  // unaffected by this field's presence or absence.
  commercial?: CommercialOutcomeEvaluation | null;
  // Wave 8 Slice 6 -- same additive pattern as `commercial` above: at
  // most ONE of commercial/camera/maintenance/visitor/evidence(device)
  // is ever populated for a given Goal, mirroring GoalTargetEntities'
  // own mutual-exclusivity convention (Section 30/P -- one Goal, one
  // domain, provenance never flattened across domains).
  camera?: CameraOutcomeEvaluation | null;
  maintenance?: MaintenanceOutcomeEvaluation | null;
  visitor?: VisitorOutcomeEvaluation | null;
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

// Wave 8 Slice 4 -- single-Goal convenience path. Fetches exactly this
// Goal's own Opportunity via the same batched bridge batch evaluation
// uses (a batch of one) -- Section 32's own "no N+1" requirement is
// still satisfied structurally (one Office round-trip pair per call),
// just not amortized across multiple Goals the way a real batch caller
// would get automatically (see evaluateCommercialGoalsBatch below, the
// preferred entry point for multi-Goal evaluation).
async function deriveCommercialGoalOutcome(goal: GoalRecord, opportunityId: string, targetStage: string): Promise<GoalOutcome> {
  const fetchResult = await fetchOfficeOpportunitySnapshots([opportunityId]);
  const snapshot = fetchResult.ok ? fetchResult.snapshots.get(opportunityId) || null : null;
  const commercial = evaluateCommercialOpportunityOutcome(targetStage, snapshot);
  if (!fetchResult.ok) {
    // Office unavailable is a distinct, honest provenance (Section 23) --
    // never silently downgraded to "no evaluator" or fabricated as failure.
    const unavailable: CommercialOutcomeEvaluation = { ...commercial, provenance: "office_unavailable", notes: `Office could not be reached (${fetchResult.reason}) -- outcome is honestly unverified.` };
    operationalMetrics.increment("goal_outcome_derivation_total", { state: "unverified", provenance: "office_unavailable" });
    return { goalId: goal.id, state: "unverified", provenance: "office_unavailable", evaluatedAt: null, evidence: [], commercial: unavailable, note: LIVE_DERIVATION_NOTE };
  }
  operationalMetrics.increment("goal_outcome_derivation_total", { state: commercial.result, provenance: commercial.provenance });
  return {
    goalId: goal.id,
    state: commercial.result,
    provenance: commercial.provenance,
    evaluatedAt: commercial.evaluatedAt,
    evidence: [],
    commercial,
    note: LIVE_DERIVATION_NOTE,
  };
}

// Wave 8 Slice 6 -- reduces a CameraOutcomeResult into the shared
// GoalOutcomeState vocabulary, mirroring the device-path reduction
// exactly ("contradicted" -> "not_achieved", never a fourth top-level
// value -- the richer camera-specific nuance stays in the `camera`
// sub-object's own observedOverall/notes fields, Section 27).
function cameraGoalOutcomeState(result: CameraOutcomeEvaluation["result"]): GoalOutcomeState {
  if (result === "achieved") return "achieved";
  if (result === "contradicted") return "not_achieved";
  return "unverified";
}

async function deriveCameraGoalOutcome(goal: GoalRecord, cameraId: string, decisionId: string | null): Promise<GoalOutcome> {
  const estateId = goal.target_entities?.estate_id || null;
  if (!estateId) {
    operationalMetrics.increment("goal_outcome_derivation_total", { state: "unverified", provenance: "insufficient_evidence" });
    return { goalId: goal.id, state: "unverified", provenance: "insufficient_evidence", evaluatedAt: null, evidence: [], note: "This Goal names a camera_id but no estate_id -- CameraCurrentStateAuthority requires estate scope and cannot be resolved without it." };
  }
  const [camera] = await evaluateCameraOutcomes([{ lineage: { cameraId, estateId, decisionId, goalId: goal.id, canonicalSignalKey: goal.canonical_signal_key } }]);
  operationalMetrics.increment("goal_outcome_derivation_total", { state: cameraGoalOutcomeState(camera.result), provenance: "camera_state_evaluation" });
  return { goalId: goal.id, state: cameraGoalOutcomeState(camera.result), provenance: "camera_state_evaluation", evaluatedAt: camera.observedAt, evidence: [], camera, note: LIVE_DERIVATION_NOTE };
}

function maintenanceGoalOutcomeState(result: MaintenanceOutcomeEvaluation["result"]): GoalOutcomeState {
  return result === "achieved" ? "achieved" : "unverified";
}

async function deriveMaintenanceGoalOutcome(goal: GoalRecord, maintenanceRequestId: string, decisionId: string | null): Promise<GoalOutcome> {
  const [maintenance] = await evaluateMaintenanceOutcomes([{ lineage: { maintenanceRequestId, decisionId, goalId: goal.id, canonicalSignalKey: goal.canonical_signal_key } }]);
  operationalMetrics.increment("goal_outcome_derivation_total", { state: maintenanceGoalOutcomeState(maintenance.result), provenance: "maintenance_resident_verification" });
  return { goalId: goal.id, state: maintenanceGoalOutcomeState(maintenance.result), provenance: "maintenance_resident_verification", evaluatedAt: null, evidence: [], maintenance, note: LIVE_DERIVATION_NOTE };
}

function visitorGoalOutcomeState(result: VisitorOutcomeEvaluation["result"]): GoalOutcomeState {
  if (result === "achieved") return "achieved";
  if (result === "not_achieved") return "not_achieved";
  return "unverified";
}

async function deriveVisitorGoalOutcome(goal: GoalRecord, visitorAccessId: string, decisionId: string | null): Promise<GoalOutcome> {
  const [visitor] = await evaluateVisitorOutcomes([{ lineage: { visitorAccessId, decisionId, goalId: goal.id, canonicalSignalKey: goal.canonical_signal_key } }]);
  operationalMetrics.increment("goal_outcome_derivation_total", { state: visitorGoalOutcomeState(visitor.result), provenance: "visitor_entry_evidence" });
  return { goalId: goal.id, state: visitorGoalOutcomeState(visitor.result), provenance: "visitor_entry_evidence", evaluatedAt: visitor.arrivedAt, evidence: [], visitor, note: LIVE_DERIVATION_NOTE };
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
    // Wave 8 Slice 4 -- a device-less Goal is not automatically
    // "no evaluator available" anymore: if it names a real Office
    // Opportunity AND a commercial target, dispatch to the commercial
    // evaluator instead (Section 16's own conceptual architecture: Goal
    // -> commercial target resolver -> Office Opportunity truth ->
    // commercial evaluator -> GoalOutcomeEvaluation). Every currently-live
    // Goal has commercial_target_stage unset (no producer sets it yet,
    // per commercialOutcomeEvaluator.ts's own §6 finding), so this branch
    // is exercised today only by test fixtures -- honestly disclosed, not
    // hidden (see docs/WAVE8_SLICE4_COMMERCIAL_OUTCOME_EVALUATOR.md).
    const opportunityId = goal.target_entities?.opportunity_id || null;
    const targetStage = goal.target_entities?.commercial_target_stage || null;
    if (opportunityId && targetStage) {
      return deriveCommercialGoalOutcome(goal, opportunityId, targetStage);
    }

    // Wave 8 Slice 6 -- structured domain/target dispatch only (Section
    // 21): each check is a plain identity-field presence test, never a
    // free-text/objective inspection or LLM classification. Every
    // currently-live Goal has none of these three fields set (no Decision
    // producer exists yet for camera/maintenance/visitor -- Section 26),
    // so these branches are exercised today only by test fixtures,
    // honestly disclosed, matching the commercial dispatch's own
    // precedent immediately above.
    const cameraId = goal.target_entities?.camera_id || null;
    if (cameraId) {
      const decisionId = await findDecisionIdForGoal(goal.id);
      return deriveCameraGoalOutcome(goal, cameraId, decisionId);
    }
    const maintenanceRequestId = goal.target_entities?.maintenance_request_id || null;
    if (maintenanceRequestId) {
      const decisionId = await findDecisionIdForGoal(goal.id);
      return deriveMaintenanceGoalOutcome(goal, maintenanceRequestId, decisionId);
    }
    const visitorAccessId = goal.target_entities?.visitor_access_id || null;
    if (visitorAccessId) {
      const decisionId = await findDecisionIdForGoal(goal.id);
      return deriveVisitorGoalOutcome(goal, visitorAccessId, decisionId);
    }

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

// Wave 8 Slice 4 -- Section 32's own explicit batch-performance
// requirement: evaluating N Goals with commercial targets must cost a
// FIXED number of Office round-trips (two: opportunities + activities),
// never N. This is the entry point a caller evaluating many Goals at
// once should use instead of calling deriveGoalOutcome() in a loop for
// commercial Goals specifically -- device-path and no-evaluator Goals
// are unaffected (each still costs its own existing, already-batched
// Postgres query per Slice 3's own design; this function does not change
// that, it only removes the N-Office-calls risk for the commercial path).
export async function deriveGoalOutcomesBatch(goals: GoalRecord[]): Promise<GoalOutcome[]> {
  const noDeviceStep = (goal: GoalRecord) => !goal.plan.some(isDeviceOutcomeStep);
  const commercialGoals = goals.filter((goal) => noDeviceStep(goal) && goal.target_entities?.opportunity_id && goal.target_entities?.commercial_target_stage);
  const cameraGoals = goals.filter((goal) => noDeviceStep(goal) && !commercialGoals.includes(goal) && goal.target_entities?.camera_id);
  const maintenanceGoals = goals.filter((goal) => noDeviceStep(goal) && !commercialGoals.includes(goal) && !cameraGoals.includes(goal) && goal.target_entities?.maintenance_request_id);
  const visitorGoals = goals.filter(
    (goal) => noDeviceStep(goal) && !commercialGoals.includes(goal) && !cameraGoals.includes(goal) && !maintenanceGoals.includes(goal) && goal.target_entities?.visitor_access_id
  );
  const claimed = new Set([...commercialGoals, ...cameraGoals, ...maintenanceGoals, ...visitorGoals]);
  const otherGoals = goals.filter((goal) => !claimed.has(goal));

  const opportunityIds = Array.from(new Set(commercialGoals.map((goal) => goal.target_entities!.opportunity_id!)));
  const fetchResult = opportunityIds.length ? await fetchOfficeOpportunitySnapshots(opportunityIds) : { ok: true as const, snapshots: new Map() };

  const commercialResults: GoalOutcome[] = commercialGoals.map((goal) => {
    const opportunityId = goal.target_entities!.opportunity_id!;
    const targetStage = goal.target_entities!.commercial_target_stage!;
    if (!fetchResult.ok) {
      const commercial: CommercialOutcomeEvaluation = { ...evaluateCommercialOpportunityOutcome(targetStage, null), provenance: "office_unavailable", notes: `Office could not be reached (${fetchResult.reason}) -- outcome is honestly unverified.` };
      operationalMetrics.increment("goal_outcome_derivation_total", { state: "unverified", provenance: "office_unavailable" });
      return { goalId: goal.id, state: "unverified" as GoalOutcomeState, provenance: "office_unavailable" as GoalOutcomeProvenance, evaluatedAt: null, evidence: [], commercial, note: LIVE_DERIVATION_NOTE };
    }
    const snapshot = fetchResult.snapshots.get(opportunityId) || null;
    const commercial = evaluateCommercialOpportunityOutcome(targetStage, snapshot);
    operationalMetrics.increment("goal_outcome_derivation_total", { state: commercial.result, provenance: commercial.provenance });
    return { goalId: goal.id, state: commercial.result, provenance: commercial.provenance, evaluatedAt: commercial.evaluatedAt, evidence: [], commercial, note: LIVE_DERIVATION_NOTE };
  });

  // Wave 8 Slice 6 -- each domain batched with exactly ONE call to its own
  // evaluator covering every Goal in that domain (cameraOutcomeEvaluator.ts
  // further batches internally by estate -- Section 32, no N+1 regardless
  // of how many Goals/cameras/estates a single deriveGoalOutcomesBatch
  // call covers).
  let cameraResults: GoalOutcome[] = [];
  if (cameraGoals.length) {
    const cameraEvaluations = await evaluateCameraOutcomes(
      cameraGoals.map((goal) => ({ lineage: { cameraId: goal.target_entities!.camera_id!, estateId: goal.target_entities?.estate_id || "", decisionId: null, goalId: goal.id, canonicalSignalKey: goal.canonical_signal_key } }))
    );
    cameraResults = cameraGoals.map((goal, index) => {
      const goalHasEstate = Boolean(goal.target_entities?.estate_id);
      if (!goalHasEstate) {
        operationalMetrics.increment("goal_outcome_derivation_total", { state: "unverified", provenance: "insufficient_evidence" });
        return { goalId: goal.id, state: "unverified" as GoalOutcomeState, provenance: "insufficient_evidence" as GoalOutcomeProvenance, evaluatedAt: null, evidence: [], note: "This Goal names a camera_id but no estate_id -- CameraCurrentStateAuthority requires estate scope and cannot be resolved without it." };
      }
      const camera = cameraEvaluations[index];
      operationalMetrics.increment("goal_outcome_derivation_total", { state: cameraGoalOutcomeState(camera.result), provenance: "camera_state_evaluation" });
      return { goalId: goal.id, state: cameraGoalOutcomeState(camera.result), provenance: "camera_state_evaluation" as GoalOutcomeProvenance, evaluatedAt: camera.observedAt, evidence: [], camera, note: LIVE_DERIVATION_NOTE };
    });
  }

  let maintenanceResults: GoalOutcome[] = [];
  if (maintenanceGoals.length) {
    const maintenanceEvaluations = await evaluateMaintenanceOutcomes(
      maintenanceGoals.map((goal) => ({ lineage: { maintenanceRequestId: goal.target_entities!.maintenance_request_id!, decisionId: null, goalId: goal.id, canonicalSignalKey: goal.canonical_signal_key } }))
    );
    maintenanceResults = maintenanceGoals.map((goal, index) => {
      const maintenance = maintenanceEvaluations[index];
      operationalMetrics.increment("goal_outcome_derivation_total", { state: maintenanceGoalOutcomeState(maintenance.result), provenance: "maintenance_resident_verification" });
      return { goalId: goal.id, state: maintenanceGoalOutcomeState(maintenance.result), provenance: "maintenance_resident_verification" as GoalOutcomeProvenance, evaluatedAt: null, evidence: [], maintenance, note: LIVE_DERIVATION_NOTE };
    });
  }

  let visitorResults: GoalOutcome[] = [];
  if (visitorGoals.length) {
    const visitorEvaluations = await evaluateVisitorOutcomes(
      visitorGoals.map((goal) => ({ lineage: { visitorAccessId: goal.target_entities!.visitor_access_id!, decisionId: null, goalId: goal.id, canonicalSignalKey: goal.canonical_signal_key } }))
    );
    visitorResults = visitorGoals.map((goal, index) => {
      const visitor = visitorEvaluations[index];
      operationalMetrics.increment("goal_outcome_derivation_total", { state: visitorGoalOutcomeState(visitor.result), provenance: "visitor_entry_evidence" });
      return { goalId: goal.id, state: visitorGoalOutcomeState(visitor.result), provenance: "visitor_entry_evidence" as GoalOutcomeProvenance, evaluatedAt: visitor.arrivedAt, evidence: [], visitor, note: LIVE_DERIVATION_NOTE };
    });
  }

  const otherResults = await Promise.all(otherGoals.map((goal) => deriveGoalOutcome(goal)));
  const byGoalId = new Map<string, GoalOutcome>();
  for (const result of [...commercialResults, ...cameraResults, ...maintenanceResults, ...visitorResults, ...otherResults]) {
    byGoalId.set(result.goalId, result);
  }
  return goals.map((goal) => byGoalId.get(goal.id)!);
}
