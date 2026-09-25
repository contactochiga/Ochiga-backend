import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import { operationalMetrics } from "../../../observability/metrics";

// Wave 8 Slice 2 -- Recommendation Dismissal Feedback Loop. Read-only
// evidence surfacing over the EXISTING intelligence_feedback write path
// (canonicalIntelligenceStore.recordFeedback -- see its object_type ===
// "recommendation" branch). This module never writes anything, never
// changes operational_recommendations, never touches scoring/ranking/
// generation, and never creates a learning proposal. It answers only
// factual evidence questions; whether that evidence should change future
// behavior is a later, separately-governed decision (see
// docs/WAVE8_OUTCOME_LEARNING_AUTHORITY_AUDIT.md).

export const DISMISSAL_FEEDBACK_TYPES = ["dismissed", "not_useful", "false_positive"] as const;
export type DismissalFeedbackType = (typeof DISMISSAL_FEEDBACK_TYPES)[number];

export type DismissalCountsByType = Record<DismissalFeedbackType, number>;

function emptyCountsByType(): DismissalCountsByType {
  return { dismissed: 0, not_useful: 0, false_positive: 0 };
}

type RawFeedbackRow = { object_id: string; feedback_type: string; actor_id: string | null; reason: string | null; created_at: string };

// A human dismissal is a single click producing one HTTP request; the
// write path (recordFeedback) is a plain insert with no idempotency check
// at all (unlike Wave 8 Slice 1's device evaluator, which at least does a
// best-effort SELECT-then-INSERT). No "reopen" path back to an active
// recommendation was found anywhere in the codebase once
// operational_recommendations.status becomes "dismissed", so more than
// one feedback row for the SAME actor + SAME recommendation_key + SAME
// feedback_type is far more plausibly a UI double-submit / network retry
// of one human decision than two independent decisions. This collapses
// those into a single counted occurrence for evidence-strength purposes
// WITHOUT deleting, rewriting, or hiding any raw row -- the full history
// stays queryable by anyone reading intelligence_feedback directly. Rows
// from different actors, or different feedback_types, are never
// collapsed -- those are always genuinely distinct evidence.
const RETRY_COLLAPSE_WINDOW_MS = 30_000;

function collapseRetries(rows: RawFeedbackRow[]): RawFeedbackRow[] {
  const byIdentity = new Map<string, RawFeedbackRow[]>();
  for (const row of rows) {
    const key = `${row.object_id}::${row.feedback_type}::${row.actor_id || "unknown"}`;
    const bucket = byIdentity.get(key) || [];
    bucket.push(row);
    byIdentity.set(key, bucket);
  }
  const collapsed: RawFeedbackRow[] = [];
  for (const bucket of byIdentity.values()) {
    bucket.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    let lastKeptAt = -Infinity;
    for (const row of bucket) {
      const at = new Date(row.created_at).getTime();
      if (at - lastKeptAt > RETRY_COLLAPSE_WINDOW_MS) {
        collapsed.push(row);
        lastKeptAt = at;
      }
    }
  }
  return collapsed;
}

function summarize(rows: RawFeedbackRow[]) {
  const byFeedbackType = emptyCountsByType();
  const actorIds = new Set<string>();
  const reasons = new Set<string>();
  let firstSeenAt: string | null = null;
  let lastSeenAt: string | null = null;
  for (const row of rows) {
    if (row.feedback_type in byFeedbackType) byFeedbackType[row.feedback_type as DismissalFeedbackType] += 1;
    if (row.actor_id) actorIds.add(row.actor_id);
    if (row.reason && row.reason.trim()) reasons.add(row.reason.trim());
    if (!firstSeenAt || row.created_at < firstSeenAt) firstSeenAt = row.created_at;
    if (!lastSeenAt || row.created_at > lastSeenAt) lastSeenAt = row.created_at;
  }
  return {
    dismissalCount: rows.length,
    byFeedbackType,
    distinctActorCount: actorIds.size,
    firstSeenAt,
    lastSeenAt,
    reasons: Array.from(reasons).slice(0, 20),
  };
}

export type RecommendationDismissalEvidence = {
  recommendationKey: string;
  dismissalCount: number;
  byFeedbackType: DismissalCountsByType;
  distinctActorCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  reasons: string[];
};

// Factual evidence for ONE specific recommendation occurrence (one
// recommendation_key). Does not answer "should this be suppressed" --
// only "what dismissal evidence exists."
export async function getRecommendationDismissalEvidence(recommendationKey: string): Promise<RecommendationDismissalEvidence> {
  const key = String(recommendationKey || "").trim();
  if (!key) return { recommendationKey: key, dismissalCount: 0, byFeedbackType: emptyCountsByType(), distinctActorCount: 0, firstSeenAt: null, lastSeenAt: null, reasons: [] };
  try {
    const { data, error } = await supabaseAdmin
      .from("intelligence_feedback")
      .select("object_id,feedback_type,actor_id,reason,created_at")
      .eq("object_type", "recommendation")
      .in("feedback_type", DISMISSAL_FEEDBACK_TYPES as unknown as string[])
      .eq("object_id", key);
    if (error) throw error;
    const rows = collapseRetries((data || []) as RawFeedbackRow[]);
    operationalMetrics.increment("dismissal_evidence_read_total", { domain: "single_recommendation", result: "ok" });
    return { recommendationKey: key, ...summarize(rows) };
  } catch (error) {
    logger.warn("oyi_dismissal_evidence_single_failed", { recommendationKey: key, error });
    operationalMetrics.increment("dismissal_evidence_read_total", { domain: "single_recommendation", result: "error" });
    return { recommendationKey: key, dismissalCount: 0, byFeedbackType: emptyCountsByType(), distinctActorCount: 0, firstSeenAt: null, lastSeenAt: null, reasons: [] };
  }
}

export type DismissalPatternFilter = {
  domain?: string | null;
  actionType?: string | null;
  estateId?: string | null;
  homeId?: string | null;
  limit?: number;
};

export type DismissalPatternEvidence = {
  domain: string;
  actionType: string;
  recommendationCount: number;
  dismissalCount: number;
  byFeedbackType: DismissalCountsByType;
  distinctActorCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

// Aggregates dismissal evidence by (domain, action_type) -- the smallest
// stable, ALREADY-PERSISTED pattern identity available. recommendation_key
// itself is NOT reused as the pattern key: it is derived (materialization.ts
// scopeMaterializationIdentities) from a hash that includes the triggering
// signal's own provider/event id, so a recurring real-world issue (the
// same device faulting again next week) mints a brand-new recommendation_key
// each time -- recommendation_key is stable only against retried/duplicate
// delivery of the SAME signal occurrence, not across genuinely repeated
// occurrences of the same semantic recommendation. domain + action_type are
// real, persisted, non-free-text columns on operational_recommendations
// (target->>'domain' and action_type) shared by every occurrence of "the
// same kind of recommendation" -- exactly the identity Wave 7 Slice 2's own
// insight-id repair already established one layer up the chain. `reason` is
// deliberately NOT part of the grouping key: it is generator-authored prose
// (e.g. "3 further offline events..."), not a taxonomy field, and grouping
// on it would fragment identical patterns by incidental wording -- distinct
// reasons are still surfaced as raw evidence via getRecommendationDismissalEvidence.
export async function listDismissalPatternEvidence(filter: DismissalPatternFilter = {}): Promise<DismissalPatternEvidence[]> {
  const scanLimit = Math.max(1, Math.min(filter.limit || 500, 2000));
  try {
    let query = supabaseAdmin
      .from("operational_recommendations")
      .select("recommendation_key,action_type,target,estate_id,home_id")
      .order("updated_at", { ascending: false })
      .limit(scanLimit);
    if (filter.estateId) query = query.eq("estate_id", filter.estateId);
    if (filter.homeId) query = query.eq("home_id", filter.homeId);
    if (filter.actionType) query = query.eq("action_type", filter.actionType);
    const { data: recommendationRows, error: recommendationError } = await query;
    if (recommendationError) throw recommendationError;
    const recommendations = (recommendationRows || []) as { recommendation_key: string; action_type: string; target: unknown; estate_id: string | null; home_id: string | null }[];

    const patternByKey = new Map<string, { domain: string; actionType: string }>();
    for (const row of recommendations) {
      const domain = String((row.target as Record<string, unknown> | null)?.domain ?? "unknown");
      if (filter.domain && domain !== filter.domain) continue;
      patternByKey.set(row.recommendation_key, { domain, actionType: row.action_type });
    }
    const keys = Array.from(patternByKey.keys());
    if (!keys.length) {
      operationalMetrics.increment("dismissal_evidence_read_total", { domain: filter.domain || "all", result: "empty" });
      return [];
    }

    const { data: feedbackRows, error: feedbackError } = await supabaseAdmin
      .from("intelligence_feedback")
      .select("object_id,feedback_type,actor_id,reason,created_at")
      .eq("object_type", "recommendation")
      .in("feedback_type", DISMISSAL_FEEDBACK_TYPES as unknown as string[])
      .in("object_id", keys);
    if (feedbackError) throw feedbackError;

    const rowsByPattern = new Map<string, RawFeedbackRow[]>();
    for (const row of (feedbackRows || []) as RawFeedbackRow[]) {
      const pattern = patternByKey.get(row.object_id);
      if (!pattern) continue;
      const patternKey = `${pattern.domain}::${pattern.actionType}`;
      const bucket = rowsByPattern.get(patternKey) || [];
      bucket.push(row);
      rowsByPattern.set(patternKey, bucket);
    }

    const recommendationCountByPattern = new Map<string, Set<string>>();
    for (const [key, pattern] of patternByKey.entries()) {
      const patternKey = `${pattern.domain}::${pattern.actionType}`;
      const set = recommendationCountByPattern.get(patternKey) || new Set<string>();
      set.add(key);
      recommendationCountByPattern.set(patternKey, set);
    }

    const results: DismissalPatternEvidence[] = [];
    for (const [patternKey, rows] of rowsByPattern.entries()) {
      const [domain, actionType] = patternKey.split("::");
      const collapsed = collapseRetries(rows);
      if (!collapsed.length) continue;
      const summary = summarize(collapsed);
      results.push({
        domain,
        actionType,
        recommendationCount: recommendationCountByPattern.get(patternKey)?.size || 0,
        dismissalCount: summary.dismissalCount,
        byFeedbackType: summary.byFeedbackType,
        distinctActorCount: summary.distinctActorCount,
        firstSeenAt: summary.firstSeenAt,
        lastSeenAt: summary.lastSeenAt,
      });
    }
    results.sort((a, b) => b.dismissalCount - a.dismissalCount);
    operationalMetrics.increment("dismissal_evidence_read_total", { domain: filter.domain || "all", result: "ok" });
    return results;
  } catch (error) {
    logger.warn("oyi_dismissal_evidence_pattern_failed", { filter, error });
    operationalMetrics.increment("dismissal_evidence_read_total", { domain: filter.domain || "all", result: "error" });
    return [];
  }
}
