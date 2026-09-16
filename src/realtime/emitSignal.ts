import { getIO } from "./io";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import type { Signal } from "../core/control-plane/contracts/signal.types";
import { oyiCoreRuntime } from "../oyi-core/service";
import { logger } from "../observability/logger";

export type EmitSignalOptions = {
  // Oyi Intelligence Convergence, Signal Transport Convergence Slice --
  // when the caller has ALREADY submitted this same domain event to Core
  // canonically (via oyi-core/ingress/canonicalSignalIngress.ts's
  // submitCanonicalSignal()), pass true here so this broadcast does NOT
  // also trigger legacyAmbientCanonicalIngress() below. Without this,
  // every emitSignal() call ambiently reaches oyiCoreRuntime.
  // receiveSignal() a second time via decorateRealtimePayload() -- see
  // legacyAmbientCanonicalIngress()'s comment for why that path still
  // exists for every OTHER caller.
  skipCanonicalIngress?: boolean;
};

// Oyi Intelligence Convergence, Signal Transport Convergence Slice --
// COMPATIBILITY ONLY, not a decoration step. A number of existing
// emitSignal() callers (audit.recorded via core/foundation/audit.ts's
// emitAuditEvent, infrastructure onboarding, device registry, edge
// discovery, Tuya registry sync, and several platformGapService.ts event
// types not yet migrated: utility.telemetry.updated, edge.heartbeat,
// incident.updated, facility.handover.updated, camera.status.updated)
// have NO other route into Core today -- this call, via
// oyiCoreRuntime.decorateRealtimePayload()'s internal receiveSignal()
// call, is their ONLY canonical ingestion. Removing it outright would
// silently disconnect them from Core (this slice's audit found and was
// explicitly instructed not to do that). Named and isolated here so that
// behavior is an explicit, visible, INTENTIONALLY SKIPPABLE step (see
// EmitSignalOptions.skipCanonicalIngress above) rather than a hidden
// side effect of "decorating a realtime payload" -- it should be retired
// producer-by-producer as each is migrated to an explicit
// submitCanonicalSignal() call in a future wave, not migrated in bulk
// here (see this slice's report for the full caller list).
async function legacyAmbientCanonicalIngress(event: string, signal: Record<string, unknown>) {
  return oyiCoreRuntime.decorateRealtimePayload(event, signal, []);
}

export async function emitSignal(signal: Signal, options: EmitSignalOptions = {}) {
  const io = getIO();
  if (!io) return;

  const anySig: any = signal;
  const estateId = anySig.estateId || anySig.estate_id;
  const roomId = anySig.roomId || anySig.room_id;
  const homeId = anySig.homeId || anySig.home_id;
  const deviceId = anySig.deviceId || anySig.device_id;
  const userId = anySig?.requestedBy?.userId || anySig?.requestedBy?.user_id;

  // Broadcast to the most relevant scopes. Canonical ingestion (Core
  // observing this event) is NOT what this envelope is for -- see
  // legacyAmbientCanonicalIngress()'s comment. A caller that already
  // submitted canonically opts out via options.skipCanonicalIngress, so
  // Core is only ever observed once for that event.
  const envelope = options.skipCanonicalIngress
    ? {}
    : await legacyAmbientCanonicalIngress(String(anySig.type || "signal"), anySig);
  const enriched = { ...anySig, ...envelope };
  if (estateId) io.to(`estate:${estateId}`).emit("signal", enriched);
  if (roomId) io.to(`room:${roomId}`).emit("signal", enriched);
  if (homeId) io.to(`home:${homeId}`).emit("signal", enriched);
  if (userId) io.to(`user:${userId}`).emit("signal", enriched);
  if (deviceId) io.to(`device:${deviceId}`).emit("signal", enriched);

  const standardEvent = standardRealtimeEvent(anySig.type);
  if (standardEvent) {
    const payload = {
      ...enriched,
      event: standardEvent,
      timestamp: anySig.timestamp || new Date().toISOString(),
    };
    const scoped = Boolean(estateId || homeId || roomId || userId || deviceId);
    if (!scoped) io.emit(standardEvent, payload);
    if (estateId) io.to(`estate:${estateId}`).emit(standardEvent, payload);
    if (homeId) io.to(`home:${homeId}`).emit(standardEvent, payload);
    if (roomId) io.to(`room:${roomId}`).emit(standardEvent, payload);
    if (userId) io.to(`user:${userId}`).emit(standardEvent, payload);
    if (deviceId) io.to(`device:${deviceId}`).emit(standardEvent, payload);
  }
}

// Oyi Intelligence Convergence, Canonical Signal Path Hardening Slice --
// the safe fire-and-forget pattern for emitSignal() callers. Realtime
// transport is deliberately fire-and-forget: a caller's already-successful
// domain write must never wait on, or be rolled back by, a broadcast --
// but emitSignal() is async, and calling it without a rejection handler
// risks an unhandled promise rejection (which can terminate the process
// depending on Node's unhandledRejection mode). This does the minimum
// required to be safe: catch, log via the real observability logger (not
// silently swallowed), and stop -- no retry, no fallback Core ingestion
// attempt (that would be a duplicate submission of the same event
// through a different path, exactly what this programme is eliminating).
export function emitSignalSafely(signal: Signal, options?: EmitSignalOptions) {
  emitSignal(signal, options).catch((error) => {
    logger.warn("realtime_emit_signal_failed", {
      type: (signal as any)?.type || null,
      error: (error as any)?.message || String(error),
    });
  });
}

export function standardRealtimeEvent(type?: string | null) {
  const value = String(type || "");
  if (value === "device.registry.updated") return "device.registry.updated";
  if (value === "device.discovered") return "device.discovered";
  if (value === "device.status.updated" || value.startsWith("device.state") || value.startsWith("device.status")) return "device.status.updated";
  if (value === "visitor.created") return "visitor.created";
  if (value === "wallet.funded") return "wallet.funded";
  if (value === "support.ticket.created") return "support.ticket.created";
  if (value === "support.ticket.assigned") return "support.ticket.assigned";
  if (value === "estate.updated") return "estate.updated";
  if (value === "home.updated") return "home.updated";
  if (value === "edge.heartbeat") return "edge.heartbeat";
  if (value === "camera.status.updated") return "camera.status.updated";
  if (value === "camera.event") return "camera.event.created";
  if (value === "camera.discovery.updated") return "camera.discovery.updated";
  if (value === "camera.media.created") return "camera.media.created";
  if (value === "incident.created") return "incident.created";
  if (value === "incident.updated") return "incident.updated";
  if (value === "maintenance.updated") return "maintenance.updated";
  if (value === "deployment.milestone.created") return "deployment.milestone.created";
  if (value === "office.notification") return "office.notification";
  if (value === "audit.recorded") return "audit.recorded";
  if (value === "twin.state.updated") return "twin.state.updated";
  if (value === "utility.telemetry.updated") return "utility.telemetry.updated";
  if (value.startsWith("infrastructure.onboarding.")) return "infrastructure.onboarding.updated";
  return "";
}

export function makeBaseSignal(overrides: Partial<Signal>): Signal {
  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "system",
    type: "system.signal",
    timestamp: new Date().toISOString(),
    ...(overrides as any),
  } as Signal;
}
