// Wave 6 Slice 4 -- CanonicalConversationAwarenessAdapter.
//
// The smallest possible bridge between CanonicalAwarenessReadService
// (Slice 2/3's privacy-safe, scope-correct read authority) and the
// existing conversation fact/answer-building machinery in
// canonicalConversationRuntime.ts / conversationAnswerPresentation.ts.
//
// This file does NOT re-derive actor authority, re-check camera/home/
// visitor/maintenance/utility/security privacy, or touch a database
// table directly. It calls listActiveAwareness() -- which already
// performs all of that -- and reshapes its already-authorized,
// already-sanitized output into the IntelligenceFact shape the
// conversation answer builders already consume. That is the entire
// job: TRUTH RETRIEVAL (canonical service) feeding LANGUAGE GENERATION
// (existing conversation builders), never the two responsibilities
// mixed in one function.
//
// No legacy fallback lives here. If canonical read fails technically,
// this adapter returns an empty fact list and an honest status --
// callers degrade gracefully (the existing device/recent-changes
// facts still answer the turn) rather than reaching for
// oyiUnifiedIntelligenceService.

import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import type { IntelligenceFact, TruthState } from "../contracts/canonicalConversation";
import { listActiveAwareness, type AwarenessReadItem } from "../read/canonicalAwarenessReadService";

export type ConversationCanonicalStatus = "complete" | "partial" | "unavailable";

export type ConversationAwarenessContext = {
  facts: IntelligenceFact[];
  canonicalStatus: ConversationCanonicalStatus;
  coverageGapExcluded: number;
};

// oisContext is the server-verified operating context (Slice 1B: "surface
// may restrict, never expand authority"). Building the authority-driving
// actor shim from it -- rather than trusting a raw, potentially-stale
// actor.role/estate_id/home_id -- matches exactly how
// canonicalAwarenessReadService.ts's own resolveActorAuthority already
// prefers oisContext for estate/home; this extends the same precedent to
// role, since oisContext.role is the surface-verified operating role for
// this request.
function actorShimFromOisContext(oisContext: OisContext | null | undefined): AuthUser {
  return {
    id: oisContext?.actor_id || null,
    role: oisContext?.role || null,
    estate_id: oisContext?.estate_id || null,
    home_id: oisContext?.home_id || null,
    permissions: Array.isArray(oisContext?.permissions) ? oisContext.permissions : [],
  } as AuthUser;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function awarenessItemToFact(item: AwarenessReadItem): IntelligenceFact {
  // truth_state is deliberately always "observed", never "confirmed":
  // canonical awareness is Oyi Core's derived belief from signals, not a
  // live device read. freshness (passed through verbatim from the
  // canonical item) is what actually tells the language layer whether
  // this belief is current, stale, or unspecified -- Section 13's
  // invariant that freshness must not be rewritten as current certainty.
  const truthState: TruthState = "observed";
  return {
    fact_id: `canonical_awareness:${item.awarenessId}`,
    domain: item.domain || "operational",
    fact_type: "canonical_awareness",
    scope: { estate_id: item.scope.estateId, home_id: item.scope.homeId },
    object: null,
    statement: item.summary || item.title,
    value: {
      title: item.title,
      status: item.status,
      urgency: item.urgency,
      freshness: item.freshness,
      incident_id: item.incidentId,
      incident_key: item.incidentKey,
      recommended_action: item.recommendedAction || null,
      owner: item.owner || null,
    },
    previous_value: null,
    occurred_at: item.generatedAt || null,
    observed_at: item.updatedAt || item.generatedAt || new Date().toISOString(),
    source_type: "database",
    source_id: item.awarenessId,
    truth_state: truthState,
    confidence: typeof item.confidence === "number" ? item.confidence : null,
    freshness: item.freshness,
    privacy_class: item.privacyClass || "",
    permissions: [],
    evidence: item.evidence.map((ref) => ({ type: ref.type, id: ref.id })),
  };
}

// Awareness-dependent generic queries only ("What's happening?", "Anything
// wrong?", "Is everything okay?") -- this adapter is not a universal
// awareness injector for every conversation turn. Section 4's explicit
// instruction: do not inject the full awareness feed into every turn.
// The caller (canonicalConversationRuntime.ts) only invokes this from the
// home_operational_summary intent branch, which canonicalTurnResolution.ts
// already reserves for exactly this class of question -- direct domain
// queries (utility spend, visitor list, maintenance list, wallet, device
// diagnosis) are classified into their own separate intents upstream and
// never reach this adapter at all.
export async function loadCanonicalAwarenessFacts(
  oisContext: OisContext | null | undefined
): Promise<ConversationAwarenessContext> {
  const actor = actorShimFromOisContext(oisContext);
  if (!actor.id) return { facts: [], canonicalStatus: "unavailable", coverageGapExcluded: 0 };
  const result = await listActiveAwareness(actor, oisContext, {});
  if (!result.ok) return { facts: [], canonicalStatus: "unavailable", coverageGapExcluded: 0 };
  return {
    facts: result.items.map(awarenessItemToFact),
    canonicalStatus: result.coverageGap.scopeUnresolvedExcluded > 0 ? "partial" : "complete",
    coverageGapExcluded: result.coverageGap.scopeUnresolvedExcluded,
  };
}

export type AwarenessIncidentGroup = {
  incidentId: string | null;
  incidentKey: string | null;
  facts: IntelligenceFact[];
};

// Section 11: multiple observations may belong to one incident. Group
// canonical_awareness facts by their incident_id so the answer builder can
// describe one coherent problem instead of N duplicated lines -- without
// redesigning incidentCorrelation.ts, this only groups what
// listActiveAwareness already told us via each item's incidentId.
export function groupAwarenessFactsByIncident(facts: IntelligenceFact[]): AwarenessIncidentGroup[] {
  const groups = new Map<string, AwarenessIncidentGroup>();
  const order: string[] = [];
  for (const fact of facts) {
    if (fact.fact_type !== "canonical_awareness") continue;
    const value = fact.value as Record<string, unknown>;
    const incidentId = text(value.incident_id) || null;
    const key = incidentId || fact.fact_id;
    if (!groups.has(key)) {
      groups.set(key, { incidentId, incidentKey: text(value.incident_key) || null, facts: [] });
      order.push(key);
    }
    groups.get(key)!.facts.push(fact);
  }
  return order.map((key) => groups.get(key)!);
}
