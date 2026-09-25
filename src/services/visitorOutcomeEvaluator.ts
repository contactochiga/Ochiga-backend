// Wave 8 Slice 6 -- Visitor Outcome Evaluator.
//
// Generalizes deviceOutcomeEvaluator.ts's own proven pattern to the
// visitor lifecycle: does the real, concurrency-safe visitor_access/
// visitor_analytics record now show the ONE narrow supported objective
// -- "authorized visitor successfully entered" -- was satisfied.
//
// Authority boundary (Section 15/17): reads only visitor_access.status
// and visitor_analytics.arrived_at/exited_at, both written exclusively
// through transitionVisitorAccessStatus()'s real CAS
// (src/services/visitorAccessTransition.ts, Wave 6 Slice 11) and
// markEntry/markExit (visitorController.ts) -- never infers a visitor's
// identity from name/phone/gate-code/conversation text (Section 17);
// always keys strictly by the canonical visitor_access.id the caller
// supplies.
//
// Lifecycle semantics preserved exactly (Section 16):
//   approved            -> authorization only, NOT an outcome. A Goal
//                           still at "approved" has not yet achieved
//                           "visitor entered" -- honestly unverified,
//                           still possible.
//   entered / exited    -> factual lifecycle outcome. Entry is what the
//                           evaluator's one supported target actually
//                           asks about; exited does not undo it.
//   denied / expired     -> establishes not_achieved, but ONLY when no
//                           entry evidence exists at all -- a denial or
//                           expiry after a real entry is structurally
//                           impossible here (the CAS preconditions in
//                           visitorAccessTransition.ts only allow
//                           entered from "approved" and exited from
//                           "entered"), so this ordering is never
//                           actually ambiguous in practice.
//
// Historical preservation (Section 18): visitor_analytics.arrived_at is
// its own durable, independently-timestamped column, written once by
// markEntry and never cleared by markExit (confirmed by direct read of
// visitorController.ts -- markExit only ever adds exited_at/
// duration_minutes to the same row). This evaluator treats arrived_at
// non-null as the PRIMARY achieved evidence -- current status "exited"
// can never erase it. Falls back to visitor_access.status in
// ('entered','exited') only if the analytics row itself is missing
// (defensive: the CAS to "entered" and the analytics upsert are two
// separate writes, so a caller should not treat their absence as proof
// entry never happened -- it is weaker evidence, still honestly
// consulted, never silently dropped).
import { logger } from "../observability/logger";
import { operationalMetrics } from "../observability/metrics";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { persistOutcomeEvaluations } from "../oyi-core/domains/intelligence/outcomeFeedbackPersistence";

export type VisitorOutcomeResult = "achieved" | "not_achieved" | "unverified";

export type VisitorOutcomeLineage = {
  visitorAccessId: string;
  decisionId?: string | null;
  goalId?: string | null;
  canonicalSignalKey?: string | null;
};

export type VisitorOutcomeEvaluationInput = { lineage: VisitorOutcomeLineage };

export type VisitorOutcomeEvaluation = {
  result: VisitorOutcomeResult;
  observedStatus: string | null;
  arrivedAt: string | null;
  exitedAt: string | null;
  evidenceSource: "visitor_analytics" | "visitor_access_status" | "not_found";
  lineage: VisitorOutcomeLineage;
  causalNote: string;
  notes: string;
  persisted: boolean;
  feedbackId: string | null;
};

// Reuses Slice 5's real partial unique index exactly as
// cameraOutcomeEvaluator.ts does -- see that file's own comment for the
// full rationale. Zero new migration.
export const OBJECT_TYPE = "visitor_outcome";
export const FEEDBACK_TYPE = "outcome_evaluation";

const CAUSAL_NOTE =
  "This evaluation establishes only whether the visitor_access record's own authoritative lifecycle currently shows entry occurred. " +
  "It does not establish that any Decision/Goal action caused the approval or the visitor's own choice to arrive.";

const TERMINAL_WITHOUT_ENTRY = new Set(["denied", "expired"]);

// Section 23/27 -- see cameraOutcomeEvaluator.ts's own objectIdFor
// comment for the full rationale: the evidence key is folded directly
// into object_id so Slice 5's real unique index (no separate evidence
// column) preserves genuine history (approved -> entered -> exited are
// three distinct facts, each its own row) instead of collapsing every
// evaluation of the same visitor_access_id into the first one recorded.
function objectIdFor(lineage: VisitorOutcomeLineage, evidenceKey: string): string {
  const lineageKey = lineage.decisionId || lineage.goalId || "no-lineage";
  return `visitor:${lineage.visitorAccessId}:target:entered:${lineageKey}:${evidenceKey}`;
}

function evidenceKeyFor(arrivedAt: string | null, status: string | null): string {
  return arrivedAt ? `arrived_at:${arrivedAt}` : `status:${status || "unknown"}`;
}

function text(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

export async function evaluateVisitorOutcomes(inputs: VisitorOutcomeEvaluationInput[]): Promise<VisitorOutcomeEvaluation[]> {
  if (!inputs.length) return [];

  const visitorAccessIds = Array.from(new Set(inputs.map((i) => i.lineage.visitorAccessId)));

  const { data: accessRows, error: accessError } = await supabaseAdmin
    .from("visitor_access")
    .select("id,status")
    .in("id", visitorAccessIds);
  if (accessError) logger.warn("oyi_visitor_outcome_access_load_failed", { error: accessError, ids: visitorAccessIds });
  const accessByid = new Map((accessRows || []).map((r: any) => [String(r.id), r]));

  const { data: analyticsRows, error: analyticsError } = await supabaseAdmin
    .from("visitor_analytics")
    .select("visitor_access_id,arrived_at,exited_at")
    .in("visitor_access_id", visitorAccessIds);
  if (analyticsError) logger.warn("oyi_visitor_outcome_analytics_load_failed", { error: analyticsError, ids: visitorAccessIds });
  const analyticsById = new Map((analyticsRows || []).map((r: any) => [String(r.visitor_access_id), r]));

  const evaluated: Array<{ evaluation: VisitorOutcomeEvaluation; evidenceKey: string; objectId: string }> = [];

  for (const input of inputs) {
    const access = accessByid.get(input.lineage.visitorAccessId) || null;
    const analytics = analyticsById.get(input.lineage.visitorAccessId) || null;
    const status = access ? text(access.status) : null;
    const arrivedAt = analytics ? text(analytics.arrived_at) : null;
    const exitedAt = analytics ? text(analytics.exited_at) : null;

    let result: VisitorOutcomeResult;
    let evidenceSource: VisitorOutcomeEvaluation["evidenceSource"];
    let notes: string;

    if (!access) {
      result = "unverified";
      evidenceSource = "not_found";
      notes = "No visitor_access row resolves for this id -- outcome not currently provable, never guessed.";
    } else if (arrivedAt) {
      result = "achieved";
      evidenceSource = "visitor_analytics";
      notes = exitedAt
        ? `Entry recorded at ${arrivedAt} (visitor_analytics.arrived_at); the visitor has since exited at ${exitedAt}, which does not undo the historical fact that entry occurred.`
        : `Entry recorded at ${arrivedAt} (visitor_analytics.arrived_at) -- target satisfied.`;
    } else if (status === "entered" || status === "exited") {
      // Defensive fallback: the CAS status transition succeeded but the
      // analytics upsert row could not be found -- still real evidence
      // of entry, just from the weaker of the two sources.
      result = "achieved";
      evidenceSource = "visitor_access_status";
      notes = `visitor_access.status is "${status}" with no visitor_analytics row found -- entry is still treated as achieved from status alone, a weaker but real evidence source.`;
    } else if (status && TERMINAL_WITHOUT_ENTRY.has(status)) {
      result = "not_achieved";
      evidenceSource = "visitor_access_status";
      notes = `visitor_access.status is "${status}" with no entry evidence recorded -- the visitor never entered before this pursuit ended.`;
    } else {
      result = "unverified";
      evidenceSource = status ? "visitor_access_status" : "not_found";
      notes = status
        ? `visitor_access.status is "${status}" (authorization/pending only) -- entry has not yet occurred but remains possible.`
        : "No status could be resolved for this visitor_access id -- outcome not currently provable.";
    }

    const evidenceKey = evidenceKeyFor(arrivedAt, status);
    evaluated.push({
      evidenceKey,
      objectId: objectIdFor(input.lineage, evidenceKey),
      evaluation: {
        result,
        observedStatus: status,
        arrivedAt,
        exitedAt,
        evidenceSource,
        lineage: input.lineage,
        causalNote: CAUSAL_NOTE,
        notes,
        persisted: false,
        feedbackId: null,
      },
    });
  }

  await persistOutcomeEvaluations(evaluated, OBJECT_TYPE, FEEDBACK_TYPE, "oyi_visitor_outcome", (evaluation) => ({
    domain: "visitor",
    observed_status: evaluation.observedStatus,
    arrived_at: evaluation.arrivedAt,
    exited_at: evaluation.exitedAt,
    evidence_source: evaluation.evidenceSource,
  }));

  const results: VisitorOutcomeEvaluation[] = [];
  for (const entry of evaluated) {
    operationalMetrics.increment("oyi_visitor_outcome_evaluation_total", { result: entry.evaluation.result, provenance: entry.evaluation.evidenceSource });
    results.push(entry.evaluation);
  }
  return results;
}

export async function evaluateVisitorOutcome(input: VisitorOutcomeEvaluationInput): Promise<VisitorOutcomeEvaluation> {
  const [result] = await evaluateVisitorOutcomes([input]);
  return result;
}
