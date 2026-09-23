// Wave 6 Slice 2 -- READ-ONLY diagnostic comparison harness (Section 18).
//
// This module is diagnostic-only. Nothing in this repo imports it at
// runtime, and it must stay that way: it exists purely to help a future
// Slice 3 migration decision by comparing, for the same actor/scope, what
// the new canonical read path (canonicalAwarenessReadService.ts) returns
// against what the legacy read path (oyiUnifiedIntelligenceService.ts's
// getOyiUnifiedAwareness) currently returns. It never feeds its output
// back into either path, and a failure or oddity here has zero effect on
// production behavior.
//
// IMPORTANT SHAPE MISMATCH (the headline finding of this harness, not a
// bug in it): the legacy path returns ONE synthesized narrative digest per
// call (AwarenessResult: headline/summary/body/cards[]/sources[]), not a
// list of discrete, individually-scoped items. The canonical path returns
// a LIST of discrete AwarenessReadItem rows, each independently scoped and
// privacy-checked. "Item count" is therefore not directly comparable
// between the two without first flattening the legacy digest's cards[]/
// sources[] arrays -- this harness does that flattening on a best-effort
// basis (the legacy shape is defined as Record<string, unknown>[], so
// exact field names vary by card type) and reports both the flattened
// comparison AND the raw structural mismatch explicitly, rather than
// silently treating a "count" as equivalent when it is not.

import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import { listActiveAwareness } from "./canonicalAwarenessReadService";
import { getOyiUnifiedAwareness } from "../../services/oyiUnifiedIntelligenceService";
import { logger } from "../../observability/logger";

export type CanonicalVsLegacyDiagnostic = {
  ok: boolean;
  canonical: {
    itemCount: number;
    domains: string[];
    coverageGapExcluded: number;
  };
  legacy: {
    reachable: boolean;
    cardCount: number;
    sourceCount: number;
    cardTypes: string[];
    generatedAt: string | null;
    error: string | null;
  };
  notes: string[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function compareCanonicalToLegacyAwareness(
  actor: AuthUser,
  oisContext: OisContext | null | undefined,
  input: { surface?: "consumer" | "facility" | "office"; estate_id?: string | null; home_id?: string | null } = {}
): Promise<CanonicalVsLegacyDiagnostic> {
  const notes: string[] = [
    "Legacy getOyiUnifiedAwareness() returns ONE synthesized digest per call; canonical listActiveAwareness() returns a LIST of discrete items. Counts below compare canonical items against the legacy digest's flattened cards[]+sources[] as a best-effort proxy, not a like-for-like item count.",
  ];

  const canonicalResult = await listActiveAwareness(actor, oisContext, {});

  const canonicalDomains = Array.from(new Set(canonicalResult.items.map((item) => text(item.domain)).filter(Boolean)));

  let legacy: CanonicalVsLegacyDiagnostic["legacy"] = {
    reachable: false,
    cardCount: 0,
    sourceCount: 0,
    cardTypes: [],
    generatedAt: null,
    error: null,
  };

  try {
    const legacyResult = await getOyiUnifiedAwareness(actor, {
      surface: input.surface || "facility",
      estate_id: input.estate_id ?? undefined,
      home_id: input.home_id ?? undefined,
      context: oisContext,
    });
    const cards = Array.isArray((legacyResult as any)?.cards) ? (legacyResult as any).cards : [];
    const sources = Array.isArray((legacyResult as any)?.sources) ? (legacyResult as any).sources : [];
    legacy = {
      reachable: true,
      cardCount: cards.length,
      sourceCount: sources.length,
      cardTypes: Array.from(new Set(cards.map((card: any) => text(card?.type || card?.kind)).filter(Boolean))),
      generatedAt: text((legacyResult as any)?.generated_at) || null,
      error: null,
    };
  } catch (error: any) {
    legacy.error = error?.message || String(error);
    logger.warn("canonical_vs_legacy_diagnostic_legacy_unreachable", { error: legacy.error });
  }

  if (canonicalResult.coverageGap.scopeUnresolvedExcluded > 0) {
    notes.push(`Canonical excluded ${canonicalResult.coverageGap.scopeUnresolvedExcluded} incident_id-less awareness row(s) from this comparison (known gap -- see canonicalAwarenessReadService.ts module header). The legacy digest has no equivalent concept of exclusion, since it does not read the canonical tables at all.`);
  }
  if (canonicalResult.items.length === 0 && (legacy.cardCount > 0 || legacy.sourceCount > 0)) {
    notes.push("Legacy digest produced content while canonical returned zero items for the same actor/scope -- expected while canonical write coverage is still partial relative to the legacy event-fabric-driven feed; not evidence of a canonical read bug by itself.");
  }

  return {
    ok: canonicalResult.ok,
    canonical: {
      itemCount: canonicalResult.items.length,
      domains: canonicalDomains,
      coverageGapExcluded: canonicalResult.coverageGap.scopeUnresolvedExcluded,
    },
    legacy,
    notes,
  };
}
