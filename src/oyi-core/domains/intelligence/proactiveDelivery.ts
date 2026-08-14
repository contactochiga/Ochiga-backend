import type { OperationalRecommendation } from "../../contracts/intelligence";
import { NotificationService } from "../../../services/NotificationService";
import { logger } from "../../../observability/logger";

const SEVERITY_RANK: Record<OperationalRecommendation["severity"], number> = { critical: 3, warning: 2, attention: 1, info: 0 };

// Cap on how many recommendations get proactively surfaced per orchestrator
// run — proactive intelligence must never become a notification storm. Any
// candidate beyond this is simply not delivered this round; it remains
// available on-demand via the recommendations.read capability and will be
// reconsidered (and, if material, re-ranked to the top) on the next run.
const MAX_DELIVERIES_PER_RUN = 5;

export type ProactiveDeliveryResult = {
  recommendation_id: string;
  delivered: boolean;
  decision: string | null;
  reason: string;
};

// Reuses NotificationService.sendToHome end-to-end for delivery/cooldown/
// preferences/push — Programme 3 builds NO competing notification or
// suppression architecture (§K). The only Programme 3-specific behavior
// added on top is (a) a severity floor (never proactively surface "info"),
// (b) a delivery cap per run, and (c) folding severity into the
// notification key so a genuine escalation (e.g. attention -> critical on
// the same underlying issue) is never suppressed by an in-flight cooldown
// for the lower severity — NotificationService's own per-(user,category,
// entity,kind) cooldown treats that as a distinct key, so this needs no
// separate escalation-override mechanism either.
//
// Recommendations are not persisted (recomputed fresh from current
// evidence each orchestrator run, same rationale as anomalies — see
// predictionPersistence.ts). Everything needed to answer "why are you
// telling me this?" is embedded directly in the notification payload
// below (reason, evidence_ids, domain, suggested_action) so Phase L's
// conversational explain capability can read it straight off the
// notifications row via Programme 1's existing detail/explain
// architecture — no separate explanation store.
export async function runProactiveDelivery(recommendations: OperationalRecommendation[], scope: { home_id: string | null }): Promise<ProactiveDeliveryResult[]> {
  if (!scope.home_id) return [];
  const candidates = recommendations
    .filter((recommendation) => recommendation.status === "open" && recommendation.severity !== "info")
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const results: ProactiveDeliveryResult[] = [];
  for (const recommendation of candidates.slice(0, MAX_DELIVERIES_PER_RUN)) {
    results.push(await deliverProactiveRecommendation(recommendation, scope.home_id));
  }
  for (const skipped of candidates.slice(MAX_DELIVERIES_PER_RUN)) {
    results.push({ recommendation_id: skipped.recommendation_id, delivered: false, decision: null, reason: "over_delivery_cap" });
  }
  return results;
}

async function deliverProactiveRecommendation(recommendation: OperationalRecommendation, homeId: string): Promise<ProactiveDeliveryResult> {
  try {
    const { data, error } = await NotificationService.sendToHome(homeId, {
      title: recommendation.title,
      message: recommendation.summary,
      type: "intelligence",
      entityId: recommendation.dedup_key,
      payload: {
        kind: `recommendation:${recommendation.severity}`,
        severity: recommendation.severity,
        recommendation_id: recommendation.recommendation_id,
        domain: recommendation.domain,
        home_id: homeId,
        estate_id: recommendation.scope.estate_id,
        reason: recommendation.reason,
        suggested_action: recommendation.suggested_action,
        evidence_ids: recommendation.evidence_ids,
        actionability: recommendation.actionability,
      },
      routing: {
        source_type: "prediction",
        source_id: recommendation.recommendation_id,
        actionability: recommendation.actionability === "actionable" ? "review" : "informational",
        attention_eligible: true,
        queue_eligible: false,
        acknowledgement_required: false,
      },
    });
    if (error) throw error;
    const skipped = Array.isArray(data) ? data.length === 0 : !data;
    return { recommendation_id: recommendation.recommendation_id, delivered: !skipped, decision: skipped ? "suppressed_or_activity_only" : "delivered", reason: skipped ? "policy_suppressed" : "sent" };
  } catch (error) {
    logger.warn("oyi_proactive_delivery_failed", { recommendation_id: recommendation.recommendation_id, error });
    return { recommendation_id: recommendation.recommendation_id, delivered: false, decision: null, reason: "delivery_error" };
  }
}
