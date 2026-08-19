import { publishIntelligenceEvent } from "./eventBus";
import type { IntelligenceAgentId, IntelligenceSurface } from "./types";

// Oyi Cross-Surface Observability Closure — the ONE normalization point
// for turning already-authoritative source records (a conversation
// turn, a communications_events row, an ai_execution_ledger row) into
// one canonical, cross-surface event shape. This does not replace any
// of those source tables — they stay authoritative; this is a thin
// projection layer over ochiga_intelligence_events (already the
// existing cross-surface event sink used by workflows/camera-intel/
// edge-discovery), reused rather than duplicated.

export type OyiObservabilityCategory = "conversation" | "device" | "automation";
export type OyiObservabilityMode = "text" | "voice" | "vision";
export type OyiObservabilityStatus = "success" | "denied" | "failed" | "timed_out" | "unavailable";

export type OyiObservabilityInput = {
  surface: IntelligenceSurface;
  // Only conversational events carry a mode — device/automation events
  // omit it rather than forcing a text/voice/vision label onto
  // something that isn't a conversation turn at all.
  mode?: OyiObservabilityMode | null;
  category: OyiObservabilityCategory;
  event_type: string;
  status: OyiObservabilityStatus;
  actor_ref?: string | null;
  estate_id?: string | null;
  home_id?: string | null;
  capability?: string | null;
  tool?: string | null;
  conversation_id?: string | null;
  request_id?: string | null;
  latency_ms?: number | null;
  safe_summary: string;
  source_table: string;
  source_event_id: string;
  occurred_at?: string;
};

const AGENT_FOR_SURFACE: Partial<Record<IntelligenceSurface, IntelligenceAgentId>> = {
  consumer: "oyi",
  facility: "facility",
  office_internal: "oma",
  public_corporate: "oma",
};

// Real, canonical mapping from CanonicalConversationResponse.truth.
// truth_state (an existing field on every conversation orchestrator
// response, not invented for this) to an observability status. Shared
// by every conversation-orchestrator call site this closure hooks.
export function observabilityStatusFromTruthState(truthState: string | null | undefined): OyiObservabilityStatus {
  if (truthState === "unavailable") return "unavailable";
  if (truthState === "permission_restricted") return "denied";
  if (truthState === "unsupported") return "failed";
  return "success";
}

/**
 * Best-effort write of ONE normalized observability event. Never
 * blocking, never allowed to alter the result of the real operation it
 * observes — every call site must fire this without awaiting failure
 * into its own response path (matches the existing emitAuditEvent /
 * publishSourceIntelligenceEvent "best-effort write-time" convention).
 *
 * Deliberately calls publishIntelligenceEvent directly rather than
 * publishSourceIntelligenceEvent, which would also trigger
 * orchestrateWorkflowForSourceEvent — routine conversation/tool/voice/
 * vision observability traffic must never create an operational
 * workflow. (Verified safe independent of that: none of this module's
 * event_type values match ruleFor()'s workflow-triggering patterns
 * either.)
 */
export function recordOyiObservabilityEvent(input: OyiObservabilityInput) {
  return publishIntelligenceEvent(
    {
      actor_id: input.actor_ref || null,
      agent_id: AGENT_FOR_SURFACE[input.surface] || "oyi",
      surface: input.surface,
      estate_id: input.estate_id || null,
      home_id: input.home_id || null,
      event_type: input.event_type,
      category: input.category,
      title: input.safe_summary.slice(0, 180),
      summary: input.safe_summary,
      confidence: "confirmed",
      source: "oyi_observability_bridge",
      metadata: {},
      occurred_at: input.occurred_at || new Date().toISOString(),
      mode: input.mode || null,
      status: input.status,
      capability: input.capability || null,
      tool: input.tool || null,
      conversation_id: input.conversation_id || null,
      request_id: input.request_id || null,
      latency_ms: Number.isFinite(input.latency_ms as number) ? (input.latency_ms as number) : null,
    },
    { source_table: input.source_table, source_event_id: input.source_event_id }
  ).catch((error: any) => {
    console.warn("[oyi-observability] record failed", { event_type: input.event_type, reason: error?.message || String(error) });
    return { ok: false, reason: "record_exception" };
  });
}
