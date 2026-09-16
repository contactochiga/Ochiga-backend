// Oyi Intelligence Convergence, Wave 0 -- canonical signal ingress
// adapter.
//
// The Phase 1 audit found three disconnected signal concepts operating
// side by side across the codebase:
//   handleSignal()                     control-plane's signal router
//   emitSignal()                       realtime/broadcast only, never
//                                       reaches Core
//   publishSourceIntelligenceEvent()   legacy intelligence-core pipeline
//
// This module is the smallest reusable bridge for a domain mutation to
// keep doing all of that UNCHANGED and additionally submit one canonical
// signal into Core's real intelligence entry point,
// oyiCoreRuntime.receiveSignal(). It does not replace or merge the other
// three mechanisms -- domains keep their existing realtime broadcast and
// legacy publication during this migration; this only adds a fourth,
// canonical path alongside them.
//
// Deliberately calls oyiCoreRuntime.receiveSignal() directly, NOT
// core/control-plane's handleSignal() wrapper. Investigated for this
// slice: handleSignal() unconditionally also runs realtimeSubscriber(),
// which calls oyiCoreRuntime.decorateRealtimePayload() -- which itself
// calls receiveSignal() a SECOND time with a reshaped payload, then
// emitRealtime() broadcasts a real second socket.io event ("signal" and
// the raw event name) into the same estate/room/user/device rooms a
// domain's own existing broadcast already targets. Routing new signals
// through handleSignal() would therefore double-process every signal
// inside Core and double-broadcast it over realtime -- a genuine,
// observed duplicate side effect, not a hypothetical one (see this
// slice's report). handleSignal()'s other fan-out
// (evaluateSignal()/policies -> intentWorker, notificationSubscriber)
// was checked and found safe for unrecognized signal types: every policy
// and the notification switch match on an exact, known signal.type
// string and no-op for anything else -- but the realtime double-emit is
// not type-gated at all, so it is not safe to go through handleSignal().
// oyiCoreRuntime.receiveSignal() is the actual canonical intelligence
// entry point handleSignal() itself calls first; this adapter uses that
// directly, "shadow" with respect to the non-intelligence side effects
// handleSignal() would otherwise also trigger.
//
// receiveSignal() normalizes internally (via universalSignalRuntime.
// receive() -> normalizeSignal()), so callers pass a small, clean,
// recognizable shape here -- there is no need to hand-build a
// NormalizedSignal at each call site.
import { oyiCoreRuntime, type RuntimeEnvelope } from "../service";
import { signalSeverity, type SignalOrigin, type SignalSource } from "../contracts/operationalSignal";
import { logger } from "../../observability/logger";

export type CanonicalSignalIngressEntity = {
  id?: string | null;
  type?: string | null;
  name?: string | null;
  status?: string | null;
};

export type CanonicalSignalIngressActor = {
  id?: string | null;
  type?: string | null;
  role?: string | null;
};

export type CanonicalSignalIngressInput = {
  // A short, stable event name (e.g. "facility.incident.created"). Not
  // required to be one of core/control-plane's narrow Signal union
  // members -- this bypasses that wrapper entirely (see above).
  type: string;
  domain: string;
  source: SignalSource;
  origin: SignalOrigin;
  estateId?: string | null;
  buildingId?: string | null;
  // Home/room/unit id, whichever is the meaningful scope for this event.
  unitId?: string | null;
  entity?: CanonicalSignalIngressEntity;
  actor?: CanonicalSignalIngressActor;
  // Only pass a severity when it is genuinely known from the domain
  // event -- omit rather than guess.
  severity?: string | null;
  triggerReason?: string | null;
  // Preserve idempotency/correlation info where the domain has it (e.g.
  // the mutated row's own id) so repeated events for the same entity are
  // traceable, and so Core's own durable dedup (canonicalIntelligenceStore)
  // has something meaningful to key on.
  correlationId?: string | null;
  verified?: boolean;
  evidence?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

// Fire-and-forget from the caller's perspective: never throws, never
// rejects. Canonical ingestion must not be able to break the domain
// write that produced it -- a malformed or unavailable Core ingress is
// logged and swallowed here, exactly like this file's existing
// publishSourceIntelligenceEvent() and audit() calls already do for
// their own side channels.
export async function submitCanonicalSignal(input: CanonicalSignalIngressInput): Promise<RuntimeEnvelope | null> {
  try {
    return await oyiCoreRuntime.receiveSignal({
      type: input.type as any,
      domain: input.domain,
      source: input.source,
      origin: input.origin,
      estateId: input.estateId ?? null,
      buildingId: input.buildingId ?? null,
      unitId: input.unitId ?? null,
      entity: input.entity,
      actor: input.actor,
      severity: input.severity != null ? signalSeverity(input.severity) : undefined,
      triggerReason: input.triggerReason ?? null,
      correlationId: input.correlationId ?? null,
      verified: input.verified,
      evidence: input.evidence,
      metadata: input.metadata,
    });
  } catch (error) {
    logger.warn("oyi_canonical_signal_ingress_failed", {
      type: input.type,
      domain: input.domain,
      source: input.source,
      estate_id: input.estateId || null,
      error: (error as any)?.message || String(error),
    });
    return null;
  }
}
