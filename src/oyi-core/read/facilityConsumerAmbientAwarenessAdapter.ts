// Wave 6 Slice 5 -- Facility / Consumer Ambient Awareness Convergence.
//
// The shared canonical ambient-awareness projection consumed by BOTH
// Facility's and Consumer's "what's happening / what needs attention"
// surfaces. This is the "CanonicalAwarenessReadService -> authorized
// actor/scope -> canonical ambient projection -> Facility/Consumer
// presentation" shape the mission calls for -- there is exactly one
// factual computation here (buildAmbientAwarenessProjection), and
// Facility/Consumer differ ONLY in which domain bucket is emphasized
// first when presenting the same authorized items. Neither surface gets
// its own severity/urgency calculation, its own incident identity, or a
// second interpretation of what is currently active.
//
// Truth retrieval only: this file calls listActiveAwareness() (already
// actor/scope/camera/privacy-authorized by Slice 2/3) and reshapes its
// output. It does not query a table directly and does not re-derive
// authority. No legacy fallback lives inside this file -- on technical
// failure it returns canonicalStatus:"unavailable" and an empty item
// list for the caller (the /intelligence/summary route) to handle
// explicitly, exactly like Slice 3's awarenessPresentationAdapter.ts.

import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import { listActiveAwareness, type AwarenessReadItem } from "./canonicalAwarenessReadService";
import { normalizeIntelligenceCategory } from "../../intelligence-core/eventBus";
import type { IntelligenceEventCategory } from "../../intelligence-core/types";
import { INTELLIGENCE_SUMMARY_TITLE_BY_TYPE, intelligenceSummarySuggestedActions, type IntelligenceSummaryType } from "../../intelligence-core/summaryEngine";

// Wave 6 Slice 6 -- "executive" added as a third projection surface.
// Same read, same authority, same dedup/grouping; only the domain
// ordering below differs, per this slice's mission ("It may summarize
// and prioritize canonical truth differently. It must NOT independently
// derive a second awareness truth from legacy events").
export type AmbientProjectionSurface = "facility" | "consumer" | "executive";
export type AmbientCanonicalStatus = "complete" | "partial" | "unavailable";

export type AmbientAttentionItem = {
  incidentId: string | null;
  awarenessId: string;
  domain: IntelligenceEventCategory;
  title: string;
  summary: string;
  urgency: string | null;
  status: string;
  freshness: "current" | "stale" | "unspecified";
  recommendedAction: string | null;
  // Wave 6 Slice 6 -- carried through so a caller (e.g. the executive
  // brief's "latest signal") can pick the most-recent item honestly
  // instead of reconstructing a raw legacy event for that purpose.
  generatedAt: string;
};

export type AmbientDomainBucket = {
  domain: IntelligenceEventCategory;
  count: number;
  worstUrgency: string | null;
};

export type AmbientAwarenessProjection = {
  ok: boolean;
  canonicalStatus: AmbientCanonicalStatus;
  surface: AmbientProjectionSurface;
  totalItems: number;
  domainSummary: AmbientDomainBucket[];
  attentionItems: AmbientAttentionItem[];
  coverageGapExcluded: number;
  generatedAt: string;
  reason?: string;
};

// Section 6/7 -- presentation/ranking only. Every domain a canonical item
// can actually carry is represented; a domain absent from a surface's own
// priority list is appended at the end (in urgency order) rather than
// dropped, so nothing authorized is ever hidden by the ordering choice.
const FACILITY_DOMAIN_ORDER: IntelligenceEventCategory[] = ["security", "camera", "device", "utility", "maintenance", "visitor", "community", "wallet", "edge"];
const CONSUMER_DOMAIN_ORDER: IntelligenceEventCategory[] = ["security", "visitor", "maintenance", "device", "utility", "workflow", "prediction", "community"];
// Executive ordering favors business-critical/cross-department conditions
// (security, then camera/infrastructure risk, then maintenance/utility
// operational cost, then visitor/community) -- presentation only, same
// factual items as Facility/Consumer for the same actor/scope.
const EXECUTIVE_DOMAIN_ORDER: IntelligenceEventCategory[] = ["security", "camera", "maintenance", "device", "utility", "visitor", "community", "wallet"];

function domainOrderFor(surface: AmbientProjectionSurface): IntelligenceEventCategory[] {
  if (surface === "facility") return FACILITY_DOMAIN_ORDER;
  if (surface === "executive") return EXECUTIVE_DOMAIN_ORDER;
  return CONSUMER_DOMAIN_ORDER;
}

function domainRank(surface: AmbientProjectionSurface, domain: IntelligenceEventCategory): number {
  const order = domainOrderFor(surface);
  const index = order.indexOf(domain);
  return index === -1 ? order.length : index;
}

const URGENCY_RANK: Record<string, number> = { urgent: 3, act: 2, review: 1, monitor: 0 };
function urgencyRank(urgency: string | null) {
  return URGENCY_RANK[String(urgency || "")] ?? 0;
}

function itemToAttentionItem(item: AwarenessReadItem): AmbientAttentionItem {
  return {
    incidentId: item.incidentId,
    awarenessId: item.awarenessId,
    domain: normalizeIntelligenceCategory(item.domain),
    title: item.title,
    summary: item.summary,
    urgency: item.urgency,
    status: item.status,
    freshness: item.freshness,
    recommendedAction: item.recommendedAction,
    generatedAt: item.generatedAt,
  };
}

// Section 8 -- shared incident identity: Facility and Consumer both call
// this same function against the same canonical rows; if both are
// authorized for a row, both receive the identical incidentId/awarenessId.
// Section 14 -- Facility/Consumer domain coverage matrix is derivable by
// inspecting domainSummary's buckets against the caller's expected domain
// list (see the Slice 5 final report for the classification table).
export async function buildAmbientAwarenessProjection(
  actor: AuthUser,
  oisContext: OisContext | null | undefined,
  surface: AmbientProjectionSurface
): Promise<AmbientAwarenessProjection> {
  const generatedAt = new Date().toISOString();
  // Section 17/21 -- an ambient summary must not silently truncate active
  // items via listActiveAwareness's default page size (50): the default
  // is tuned for a raw chronological feed, but this projection re-sorts
  // by urgency/domain itself, so an arbitrary recency-based cutoff could
  // drop a genuinely urgent older item in favor of a newer "monitor" one.
  // Request the service's own maximum (200) instead of inventing a
  // second pagination scheme.
  const result = await listActiveAwareness(actor, oisContext, { limit: 200 });
  if (!result.ok) {
    return {
      ok: false,
      canonicalStatus: "unavailable",
      surface,
      totalItems: 0,
      domainSummary: [],
      attentionItems: [],
      coverageGapExcluded: 0,
      generatedAt,
      reason: result.reason,
    };
  }

  const byDomain = new Map<IntelligenceEventCategory, AmbientAttentionItem[]>();
  for (const item of result.items) {
    const attention = itemToAttentionItem(item);
    if (!byDomain.has(attention.domain)) byDomain.set(attention.domain, []);
    byDomain.get(attention.domain)!.push(attention);
  }

  const domainSummary: AmbientDomainBucket[] = Array.from(byDomain.entries())
    .map(([domain, items]) => ({
      domain,
      count: items.length,
      worstUrgency: items.reduce<string | null>((worst, item) => (urgencyRank(item.urgency) > urgencyRank(worst) ? item.urgency : worst), null),
    }))
    .sort((a, b) => domainRank(surface, a.domain) - domainRank(surface, b.domain));

  // Attention items: every active item, deduped by incidentId (Section 11
  // precedent from Slice 4 -- one incident, one entry, not N duplicates),
  // sorted by domain priority then urgency. Nothing is dropped here; a
  // caller wanting only the "top" items slices this list itself.
  const seenIncidents = new Set<string>();
  const attentionItems: AmbientAttentionItem[] = [];
  for (const item of result.items.map(itemToAttentionItem).sort((a, b) => {
    const domainDelta = domainRank(surface, a.domain) - domainRank(surface, b.domain);
    if (domainDelta !== 0) return domainDelta;
    return urgencyRank(b.urgency) - urgencyRank(a.urgency);
  })) {
    const dedupeKey = item.incidentId || item.awarenessId;
    if (seenIncidents.has(dedupeKey)) continue;
    seenIncidents.add(dedupeKey);
    attentionItems.push(item);
  }

  return {
    ok: true,
    canonicalStatus: result.coverageGap.scopeUnresolvedExcluded > 0 ? "partial" : "complete",
    surface,
    totalItems: result.items.length,
    domainSummary,
    attentionItems,
    coverageGapExcluded: result.coverageGap.scopeUnresolvedExcluded,
    generatedAt,
  };
}

export type AmbientSummaryCompatibleShape = {
  type: IntelligenceSummaryType;
  title: string;
  health: "attention" | "normal";
  total_events: number;
  attention_count: number;
  by_category: Record<string, number>;
  by_agent: Record<string, number>;
  latest: Array<{ title: string; summary: string; category: string; agent_id: string | null; occurred_at: string | null }>;
  attention_items: Array<{ title: string; summary: string; category: string; incident_id: string | null; urgency: string | null; freshness: string }>;
  suggested_actions: string[];
  raw_summary: null;
  canonical_status: AmbientCanonicalStatus;
};

// Section 13/16 -- maps a canonical projection into the exact field names
// GET /intelligence/summary has always returned (so older clients keep
// working), the same compatibility approach as Slice 3's
// awarenessPresentationAdapter.ts. by_agent/raw_summary have no canonical
// equivalent (canonical items are not "agent events"), so they are
// returned empty/null rather than fabricated or borrowed from legacy.
// Only "act"/"urgent" canonical urgency counts as "attention" here,
// matching the legacy notion of "needs attention now" rather than merely
// monitored.
export function mapAmbientProjectionToSummaryShape(projection: AmbientAwarenessProjection, type: IntelligenceSummaryType): AmbientSummaryCompatibleShape {
  const needsAttention = projection.attentionItems.filter((item) => item.urgency === "act" || item.urgency === "urgent");
  const attentionForShape = needsAttention.slice(0, 5).map((item) => ({
    title: item.title,
    summary: item.summary,
    category: item.domain,
    incident_id: item.incidentId,
    urgency: item.urgency,
    freshness: item.freshness,
  }));
  const byCategory: Record<string, number> = {};
  for (const bucket of projection.domainSummary) byCategory[bucket.domain] = bucket.count;

  return {
    type,
    title: INTELLIGENCE_SUMMARY_TITLE_BY_TYPE[type],
    health: attentionForShape.length ? "attention" : "normal",
    total_events: projection.totalItems,
    attention_count: attentionForShape.length,
    by_category: byCategory,
    by_agent: {},
    latest: projection.attentionItems.slice(0, type === "facility" ? 6 : 6).map((item) => ({
      title: item.title,
      summary: item.summary,
      category: item.domain,
      agent_id: null,
      occurred_at: null,
    })),
    attention_items: attentionForShape,
    suggested_actions: intelligenceSummarySuggestedActions(type, attentionForShape.length > 0),
    raw_summary: null,
    canonical_status: projection.canonicalStatus,
  };
}
