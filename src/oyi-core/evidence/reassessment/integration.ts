import { logger } from "../../../observability/logger";
import { operationalMetrics } from "../../../observability/metrics";
import type { CanonicalConversationRequestContext } from "../../contracts/conversation";
import type { ResolvedTurn } from "../../contracts/resolvedTurn";
import type { ConversationTracer } from "../../observability/ConversationTracer";
import { ASSESSMENT_TTL_MS, type ConversationAssessmentContext } from "../../context/conversationAssessmentContext";
import { gatherAssessmentEvidence } from "../planner/assessmentIntegration";
import { judgeAssessment } from "../judgment/judge";
import { providerFromEnv, type JudgmentProvider } from "../judgment/provider";
import { assertsPromiseOrAction } from "../judgment/validator";
import type { DerivedRanking } from "../judgment/types";
import { activeFacts } from "./facts";
import { classifyChange, composeNotReassessed, composeReassessment, type ChangeClass, type ReassessmentRecord } from "./reassess";

export type ReassessArgs = {
  context: CanonicalConversationRequestContext; resolvedTurn: ResolvedTurn; previous: ConversationAssessmentContext; text: string; tracer?: ConversationTracer | null;
  provider?: JudgmentProvider | null; scopeBinding: string; authorised: (sourceKeys: string[]) => boolean; now?: number;
  gather?: typeof gatherAssessmentEvidence; judge?: typeof judgeAssessment;
};
export type ReassessOutcome = { answer: string; assessment: ConversationAssessmentContext; outcome: string; record: ReassessmentRecord };

// Bounded conversational reassessment: re-read ONLY the evidence the new facts can affect (the rest is reused), run the SAME IQ-4
// judgment, compare with the previous artifact, and either replace it (keeping it as history) or leave it stale and say why. Advisory
// only: nothing is executed, scheduled or sent, and the previous state is never corrupted by a failure.
export async function runReassessment(a: ReassessArgs): Promise<ReassessOutcome> {
  const t0 = Date.now(), now = a.now ?? t0, prev = a.previous, old = prev.derived_ranking as DerivedRanking, facts = activeFacts(prev.facts);
  const affected = [...new Set(facts.flatMap(f => f.classes))];
  const stamp = new Date(now).toISOString();
  const base = (extra: Partial<ReassessmentRecord>): ReassessmentRecord => ({ v: 1, previous_ranking_id: old.ranking_id, previous_assessment_id: old.assessment_id, new_ranking_id: null, new_assessment_id: null, change_class: "INSUFFICIENT_TO_REASSESS", ranking_changed: false, conclusion_changed: false,
    changed_factors: [], unverified_fact_ids: facts.map(f => f.id), limitations: [], sources_reused: 0, sources_refreshed: 0, affected_classes: affected, at: stamp, failure: null, ...extra });
  const fail = (reason: Parameters<typeof composeNotReassessed>[0], failure: string, change: ChangeClass = "INSUFFICIENT_TO_REASSESS", detail?: string, drop = false): ReassessOutcome => {
    const record = base({ change_class: change, failure });
    const keep: DerivedRanking | null = drop ? null : { ...old, stale: old.stale ?? { reason: "material_fact", at: stamp } };
    return finish(composeNotReassessed(reason, old, facts, detail), { ...prev, derived_ranking: keep, reassessment: record, updated_at: stamp, expires_at: new Date(now + ASSESSMENT_TTL_MS).toISOString(), suspended: false }, `reassessment_${change.toLowerCase()}`, record);
  };
  const finish = (answer: string, assessment: ConversationAssessmentContext, outcome: string, record: ReassessmentRecord): ReassessOutcome => {
    if (assertsPromiseOrAction(answer)) answer = "I could not safely restate that, so I am leaving the earlier assessment as it was, marked as not current.";
    const latency = Date.now() - t0;
    a.tracer?.stage("response_composed", { surface: a.context.input.surface, status: record.change_class.toLowerCase(), outcome: `reassessment_${record.change_class.toLowerCase()}`, evidence_count: record.sources_refreshed });
    logger.info("oyi_reassessment", { request_id: a.tracer?.requestId, surface: a.context.input.surface, attempted: true, previous_exists: true, material_fact_count: facts.length, affected_class_count: affected.length,
      sources_reused: record.sources_reused, sources_refreshed: record.sources_refreshed, judgment_changed: record.change_class === "CHANGED_ORDER" || record.change_class === "CHANGED_CONCLUSION", change_class: record.change_class, failure_class: record.failure, latency_ms: latency });
    operationalMetrics.increment("oyi_reassessments_total", { surface: a.context.input.surface, change_class: record.change_class, failed: Boolean(record.failure) });
    operationalMetrics.observe("oyi_reassessment_latency_ms", latency, { surface: a.context.input.surface });
    return { answer, assessment, outcome, record };
  };

  if (!a.authorised(old.source_keys || [])) return fail("authority", "authority_revoked", "INSUFFICIENT_TO_REASSESS", undefined, true);
  let planned;
  try {
    planned = await (a.gather || gatherAssessmentEvidence)({ context: a.context, resolvedTurn: a.resolvedTurn, rawText: a.text, assessment: { ...prev, objective: (old.objective as ConversationAssessmentContext["objective"]) || prev.objective },
      tracer: a.tracer, affected_classes: affected, material_text: facts.map(f => f.text).join("|") || null });
  } catch (error) { return fail("evidence", "evidence_read_failed"); }
  if (!planned.applicable) return fail("evidence", "planner_not_applicable");
  const stats = planned.state.stats, refreshed = stats.sources_attempted ?? 0, reused = stats.sources_reused ?? 0;
  if (planned.state.missing_mandatory.length) return fail("capability", "missing_mandatory_evidence", "MISSING_CAPABILITY", planned.state.missing_mandatory.map(m => String((m as { class?: string }).class ?? m)).join(", "));
  let judged;
  try {
    judged = await (a.judge || judgeAssessment)({ state: planned.state, objective: old.objective, question: prev.question, surface: a.context.input.surface, previous: null, provider: a.provider === undefined ? providerFromEnv() : a.provider,
      facts: facts.filter(f => f.target_status === "bound").map(f => ({ target_id: f.target?.id ?? null, target_label: f.target?.label ?? null, text: f.text })) });
  } catch { return fail("judgment", "judgment_threw"); }
  const next = judged.ranking_artifact;
  if (!next || judged.result.status !== "JUDGED" || !judged.validation.ok) return { ...fail("judgment", judged.provider.failure_class || "no_validated_judgment"), };
  const cls = classifyChange(old, next);
  const newArt: DerivedRanking = { ...next, scope_binding: a.scopeBinding, reassessed_from: old.ranking_id, stale: null, parked: false, focus: null };
  const history: DerivedRanking = { ...old, parked: false, historical: { superseded_by: newArt.ranking_id, at: stamp, reason: facts.some(f => f.type === "correction") ? "correction" : "material_fact" } };
  const record = base({ new_ranking_id: newArt.ranking_id, new_assessment_id: newArt.assessment_id, change_class: cls.change_class, ranking_changed: cls.ranking_changed, conclusion_changed: cls.conclusion_changed, changed_factors: cls.changed_factors.slice(0, 6),
    limitations: [...newArt.limitations, ...(newArt.uncertainties || [])].slice(0, 4), sources_reused: reused, sources_refreshed: refreshed });
  const assessment: ConversationAssessmentContext = { ...prev, evidence_plan: planned.state, derived_ranking: newArt, derived_history: history, reassessment: record, suspended: false, status: "assessment_pending",
    judgment: { assessment_id: judged.result.assessment_id, mode: judged.result.mode, status: judged.result.status, validated: true, judged_at: stamp }, updated_at: stamp, expires_at: new Date(now + ASSESSMENT_TTL_MS).toISOString() };
  return finish(composeReassessment({ old, next: newArt, cls, facts, currentText: judged.text, reused, refreshed }), assessment, `reassessment_${cls.change_class.toLowerCase()}`, record);
}
