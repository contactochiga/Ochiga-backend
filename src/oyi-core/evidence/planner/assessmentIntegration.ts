import { logger } from "../../../observability/logger";
import { operationalMetrics } from "../../../observability/metrics";
import type { CanonicalConversationRequestContext } from "../../contracts/conversation";
import type { ResolvedTurn } from "../../contracts/resolvedTurn";
import type { ConversationAssessmentContext } from "../../context/conversationAssessmentContext";
import { defaultAssessmentSubject } from "../../context/conversationAssessmentContext";
import { resolveRoomForRead } from "../../runtime/conversationTargetResolver";
import type { ConversationTracer } from "../../observability/ConversationTracer";
import { planAndGatherEvidence, type PlannerResult } from "./planner";
import { enforceStateSize } from "./bundle";
import type { RoomScope } from "./planning";
import type { PlannerLimits } from "./types";
import type { ExecutionDeps } from "./execute";

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
const BUILDING = /^(?:tower|building|block|wing)\b/i;

// The single entry the orchestrator uses for an assessment turn. Ordinary (non-assessment) turns never reach it.
export async function gatherAssessmentEvidence(args: {
  context: CanonicalConversationRequestContext;
  resolvedTurn: ResolvedTurn;
  rawText: string;
  assessment: ConversationAssessmentContext;
  tracer?: ConversationTracer | null;
  limits?: PlannerLimits;
  deps?: ExecutionDeps;
}): Promise<PlannerResult> {
  const { context, assessment } = args;
  const surface = context.input.surface;
  const subjects = assessment.subject_domains || [];
  const label = assessment.subject_label || null;
  const buildingLabel = label && BUILDING.test(label) ? label : null;
  let room: RoomScope = { status: "none" };
  // Room resolution reuses the existing resolver on the retained subject label (the IQ-2 context), not on the raw prompt.
  if (label && !buildingLabel && surface === "consumer" && subjects.some(d => d === "rooms" || d === "devices")) {
    try {
      const r = await resolveRoomForRead(context.actor, context.oisContext, context.input, label);
      room = r.status === "resolved" ? { status: "resolved", room_id: r.room_id, label: r.label } : { status: "unresolved", label };
    } catch { room = { status: "unresolved", label }; }
  }
  const started = Date.now();
  const result = await planAndGatherEvidence({
    actor: context.actor, oisContext: context.oisContext, input: context.input, resolvedTurn: args.resolvedTurn,
    objective: assessment.objective, subject_domains: subjects, subject_label: label, target_id: assessment.target_ref?.canonical_id || null,
    broad: sameSet(subjects, defaultAssessmentSubject(surface)), room, building_label: buildingLabel, raw_text: args.rawText,
    material_text: [assessment.material_information?.text, assessment.pending_information].filter(Boolean).join("|") || null,
    previous: assessment.evidence_plan, limits: args.limits, deps: args.deps,
  });
  result.state = enforceStateSize(result.state);
  const s = result.state;
  // Structural observability only: counts, statuses, latency. No evidence content, ids or labels.
  const common = { surface, objective: s.objective, plan_status: s.status, sources_planned: s.stats.sources_planned, sources_attempted: s.stats.sources_attempted, sources_reused: s.stats.sources_reused };
  args.tracer?.stage("evidence_planned", { surface, status: "planned", evidence_count: result.plan.steps.length, outcome: s.invalidation.length ? "replanned" : "planned" });
  args.tracer?.stage("evidence_loaded", { surface, status: s.status.toLowerCase(), evidence_count: s.contributions.reduce((n, c) => n + c.record_count, 0), outcome: result.reused_all ? "reused" : "gathered" });
  logger.info("oyi_assessment_evidence_plan", { ...common, success: s.stats.success, partial: s.stats.partial, error: s.stats.error, denied: s.stats.denied, timeout: s.stats.timeout,
    missing_mandatory: s.missing_mandatory.length, optional_unavailable: s.optional_unavailable.length, invalidation: s.invalidation.length, latency_ms: Date.now() - started });
  operationalMetrics.increment("oyi_assessment_evidence_plans_total", { surface, status: s.status, reused: result.reused_all });
  operationalMetrics.observe("oyi_assessment_evidence_plan_latency_ms", Date.now() - started, { surface });
  operationalMetrics.increment("oyi_assessment_evidence_sources_total", { surface, outcome: "attempted" }, s.stats.sources_attempted);
  operationalMetrics.increment("oyi_assessment_evidence_sources_total", { surface, outcome: "reused" }, s.stats.sources_reused);
  return result;
}
