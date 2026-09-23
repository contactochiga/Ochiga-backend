// Wave 6 Slice 3 -- presentation adapter + explicit fallback orchestration
// for GET /oyi/awareness.
//
// Canonical service (canonicalAwarenessReadService.ts) is truth. This file
// is projection only: it never queries a table, never re-derives actor
// authority, never recomputes privacy, and never independently fetches
// legacy intelligence to blend with canonical output. Its only two jobs:
//   1. Map a canonical ReadOutcome<AwarenessReadItem> into the legacy
//      AwarenessResult-compatible response shape GET /oyi/awareness has
//      always returned, so older clients keep working.
//   2. Decide, once, whether canonical coverage was sufficient for this
//      call -- and if not, fall back to the legacy digest EXPLICITLY,
//      never silently merging the two into one undifferentiated result.

import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import { listActiveAwareness, type AwarenessReadItem, type ReadOutcome } from "./canonicalAwarenessReadService";
import { getOyiUnifiedAwareness } from "../../services/oyiUnifiedIntelligenceService";
import { logger } from "../../observability/logger";

type LegacySeverity = "normal" | "info" | "attention" | "warning" | "critical";

// Presentation-only vocabulary translation. Canonical's urgency
// ("monitor"|"review"|"act"|"urgent") is the authoritative fact; this maps
// it to the legacy severity vocabulary older clients branch on. This is
// not a recalculation of severity -- urgency itself is untouched and
// still carried on each item -- it is a display-label translation, exactly
// the kind of "presentation-specific ordering/labeling" the mission
// permits without redoing Awareness Scoring convergence.
const URGENCY_TO_SEVERITY: Record<string, LegacySeverity> = {
  urgent: "critical",
  act: "warning",
  review: "attention",
  monitor: "normal",
};
const SEVERITY_RANK: Record<LegacySeverity, number> = { critical: 4, warning: 3, attention: 2, normal: 1, info: 0 };
// Same presentation-only spirit for the legacy 0-100 "calm" score: a fixed
// bucket per worst severity present, not a re-derivation of urgency/status.
const SEVERITY_SCORE: Record<LegacySeverity, number> = { critical: 8, warning: 30, attention: 55, normal: 90, info: 90 };

function worstSeverity(items: AwarenessReadItem[]): LegacySeverity {
  let worst: LegacySeverity = "normal";
  for (const item of items) {
    const mapped = URGENCY_TO_SEVERITY[String(item.urgency || "").toLowerCase()] || "normal";
    if (SEVERITY_RANK[mapped] > SEVERITY_RANK[worst]) worst = mapped;
  }
  return worst;
}

export type CanonicalStatus = "complete" | "partial" | "unavailable";
export type FallbackReason = "canonical_coverage_gap" | "unsupported_domain" | "temporary_migration" | "scope_unverified" | null;

export type AwarenessDigestResponse = {
  ok: boolean;
  headline: string;
  summary: string;
  body: string;
  severity: LegacySeverity;
  recommended_action: string;
  destination: string;
  cards: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  suggested_actions: Array<Record<string, unknown>>;
  awareness_score: number;
  score: number;
  generated_at: string;
  // Wave 6 Slice 3 -- explicit, observable migration status. Never
  // silently merged with legacy content; a caller can always tell which
  // truth source produced this response.
  canonical_status: CanonicalStatus;
  legacy_fallback_used: boolean;
  fallback_reason: FallbackReason;
};

function buildDigestFromCanonical(result: ReadOutcome<AwarenessReadItem>): AwarenessDigestResponse {
  const items = result.items;
  const severity = items.length ? worstSeverity(items) : "normal";
  const generatedAt = items.reduce((latest, item) => (item.generatedAt > latest ? item.generatedAt : latest), items[0]?.generatedAt || new Date().toISOString());
  const headline = items.length ? items[0].title : "No active awareness right now.";
  const summary = items.length
    ? `${items.length} active item${items.length === 1 ? "" : "s"} currently tracked.`
    : "Oyi Core has no active operational awareness for this scope right now.";
  const recommendedAction = items.find((item) => item.recommendedAction)?.recommendedAction || "";
  const cards = items.map((item) => ({
    id: item.awarenessId,
    type: "awareness",
    domain: item.domain,
    title: item.title,
    summary: item.summary,
    severity: URGENCY_TO_SEVERITY[String(item.urgency || "").toLowerCase()] || "normal",
    urgency: item.urgency,
    status: item.status,
    freshness: item.freshness,
    generated_at: item.generatedAt,
    incident_id: item.incidentId,
  }));
  const sources = items.flatMap((item) => item.evidence.map((ref) => ({ awareness_id: item.awarenessId, type: ref.type, id: ref.id })));
  const suggestedActions = items
    .filter((item) => item.recommendedAction)
    .map((item) => ({ id: item.awarenessId, label: item.recommendedAction, domain: item.domain }));

  return {
    ok: result.ok,
    headline,
    summary,
    body: summary,
    severity,
    recommended_action: recommendedAction,
    destination: "",
    cards,
    sources,
    suggested_actions: suggestedActions,
    awareness_score: SEVERITY_SCORE[severity],
    score: SEVERITY_SCORE[severity],
    generated_at: generatedAt,
    canonical_status: result.coverageGap.scopeUnresolvedExcluded > 0 ? "partial" : "complete",
    legacy_fallback_used: false,
    fallback_reason: null,
  };
}

// Wave 6 Slice 8 Section 19 -- failure to verify scope must not trigger a
// less-verified read path. Legacy's own scope resolution
// (authenticatedActorScope/applyRoleScopeToFilters, feeding
// loadUnifiedContext) uses raw actor.estate_id/home_id rather than the
// verified oisContext -- the exact staleness gap Slice 1B's "SURFACE !=
// AUTHORITY" work closed elsewhere. Falling back to legacy specifically
// when canonical could not verify scope would answer with a *less*
// scope-safe engine at the exact moment scope safety is in question. This
// response fails closed instead: truthful, not fabricated, not a hard
// error, and never legacy-derived.
function buildDigestForUnverifiedScope(generatedAt: string): AwarenessDigestResponse {
  const message = "Oyi could not verify a scoped estate or home for this request, so no current awareness is shown. This is a safety measure, not an error.";
  return {
    ok: true,
    headline: "Current awareness could not be confirmed for this account.",
    summary: message,
    body: message,
    severity: "normal",
    recommended_action: "Confirm your estate or home context and try again.",
    destination: "",
    cards: [],
    sources: [],
    suggested_actions: [],
    awareness_score: 0,
    score: 0,
    generated_at: generatedAt,
    canonical_status: "unavailable",
    legacy_fallback_used: false,
    fallback_reason: "scope_unverified",
  };
}

function buildDigestFromLegacy(legacy: Record<string, unknown>, reason: FallbackReason): AwarenessDigestResponse {
  return {
    ok: (legacy as any)?.ok !== false,
    headline: String((legacy as any)?.headline || ""),
    summary: String((legacy as any)?.summary || ""),
    body: String((legacy as any)?.body || ""),
    severity: (legacy as any)?.severity || "normal",
    recommended_action: String((legacy as any)?.recommended_action || ""),
    destination: String((legacy as any)?.destination || ""),
    cards: Array.isArray((legacy as any)?.cards) ? (legacy as any).cards : [],
    sources: Array.isArray((legacy as any)?.sources) ? (legacy as any).sources : [],
    suggested_actions: Array.isArray((legacy as any)?.suggested_actions) ? (legacy as any).suggested_actions : [],
    awareness_score: Number((legacy as any)?.awareness_score ?? 50),
    score: Number((legacy as any)?.score ?? 50),
    generated_at: String((legacy as any)?.generated_at || new Date().toISOString()),
    canonical_status: "unavailable",
    legacy_fallback_used: true,
    fallback_reason: reason,
  };
}

// The one orchestration point GET /oyi/awareness calls. Canonical is tried
// first and, if it produces a usable result (ok:true -- including a
// truthful zero-item result, which is still a complete, trustworthy
// answer), canonical alone is presented. Legacy is only invoked, and only
// its own separate digest ever returned, when canonical itself could not
// answer at all (e.g. no verified estate, a read failure) -- never blended
// item-by-item with canonical output.
export async function getConvergedAwarenessDigest(
  actor: AuthUser | null,
  oisContext: OisContext | null | undefined,
  legacyInput: { surface?: "consumer" | "facility" | "office"; estate_id?: string | null; home_id?: string | null; context?: OisContext | null }
): Promise<AwarenessDigestResponse> {
  if (!actor) {
    return buildDigestFromLegacy(await getOyiUnifiedAwareness(actor, legacyInput), "unsupported_domain");
  }
  const canonical = await listActiveAwareness(actor, oisContext, {});
  if (canonical.ok) return buildDigestFromCanonical(canonical);

  if (canonical.reason === "no_verified_estate") {
    logger.warn("oyi_awareness_scope_unverified", { reason: canonical.reason });
    return buildDigestForUnverifiedScope(new Date().toISOString());
  }

  logger.warn("oyi_awareness_canonical_fallback", { reason: canonical.reason || "unknown" });
  const legacy = await getOyiUnifiedAwareness(actor, legacyInput);
  return buildDigestFromLegacy(legacy, "canonical_coverage_gap");
}
