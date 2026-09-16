// Oyi Intelligence Convergence, Camera Intelligence Convergence Wave --
// the one canonical normalization boundary between camera-domain
// observations (detections, health/connectivity transitions) and Core's
// intelligence entry point (submitCanonicalSignal() ->
// oyiCoreRuntime.receiveSignal()).
//
// Governing boundary (see this wave's report): camera infrastructure
// stays responsible for discovery, connectivity, streams, CV/detection,
// deduplication, zones, media evidence, and raw health telemetry -- all
// of that is UNCHANGED by this file. This module only translates an
// already-computed camera-domain observation into a canonical signal;
// it contains no detection logic, no transport logic, and no independent
// severity/escalation policy of its own.
//
// DETECTION CLASSIFICATION vs OPERATIONAL SEVERITY (see this wave's
// report, section 3): the raw detector classification (event/detection
// type, e.g. "person", "fire", "zone_intrusion") is camera domain's own
// finding and is preserved verbatim as `entity.status` and evidence --
// never silently upgraded into an operational severity label here.
// Operational severity is derived by feeding that SAME raw type string
// into signalSeverity() -- oyi-core's existing, already-canonical,
// domain-agnostic text classifier (used for facility incidents, twin
// state, etc.) -- reusing it rather than building a second, camera-local
// severity engine. Detector CONFIDENCE (a probability) is preserved as
// evidence/metadata only and is never itself treated as severity.
import { submitCanonicalSignal } from "../../ingress/canonicalSignalIngress";
import { signalSeverity } from "../../contracts/operationalSignal";

export type CameraDetectionCanonicalInput = {
  cameraId: string;
  cameraName?: string | null;
  estateId: string;
  homeId?: string | null;
  roomId?: string | null;
  zoneId?: string | null;
  zoneName?: string | null;
  // Raw detector classification -- camera domain's own finding, e.g.
  // "person", "vehicle", "fire", "zone_intrusion", "intrusion".
  detectionType: string;
  // Raw detector confidence (0-1). Preserved as evidence only -- never
  // reinterpreted as severity.
  confidence?: number | null;
  observedAt: string;
  eventId?: string | null;
  detectionId?: string | null;
  providerEventId?: string | null;
  provider?: string | null;
  verified?: boolean;
  verificationMethod?: string | null;
  actorId?: string | null;
  mediaReference?: { id: string; kind: string } | null;
};

export async function submitCameraDetectionCanonicalSignal(input: CameraDetectionCanonicalInput) {
  const confidence = typeof input.confidence === "number" && Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : null;
  return submitCanonicalSignal({
    type: "camera.detection.observed",
    domain: "camera",
    source: "camera",
    origin: "physical",
    estateId: input.estateId,
    unitId: input.homeId || input.roomId || null,
    entity: {
      id: input.cameraId,
      type: "camera",
      name: input.cameraName || null,
      // Detection classification, preserved verbatim -- this IS the
      // camera domain's finding, not Core's interpretation of it.
      status: input.detectionType,
    },
    actor: input.actorId ? { id: input.actorId, type: "device" } : { id: null, type: "device" },
    // Reuses the existing canonical severity classifier, fed the raw
    // detection type -- not a camera-local severity computation.
    severity: input.detectionType,
    triggerReason: input.zoneName ? `${input.detectionType} detected in ${input.zoneName}` : `${input.detectionType} detected`,
    correlationId: `camera_detection:${input.cameraId}:${input.eventId || input.detectionId || input.observedAt}`,
    verified: Boolean(input.verified),
    evidence: [
      {
        id: input.detectionId || input.eventId || null,
        type: "camera_detection",
        source: input.provider || "camera",
        summary: `${input.detectionType} detected on camera ${input.cameraId}`,
        timestamp: input.observedAt,
        metadata: {
          confidence,
          zone_id: input.zoneId || null,
          zone_name: input.zoneName || null,
          provider_event_id: input.providerEventId || null,
          verification_method: input.verificationMethod || null,
          media_reference: input.mediaReference || null,
        },
      },
    ],
    metadata: {
      event_id: input.eventId || null,
      detection_id: input.detectionId || null,
      confidence,
      zone_id: input.zoneId || null,
      zone_name: input.zoneName || null,
      provider: input.provider || null,
    },
  });
}

// -----------------------------------------------------------------------
// Camera health / connectivity -- see this wave's report, section 5, for
// why raw heartbeats are NOT forwarded 1:1. Only a real state transition
// (not a repeated report of the same state) reaches Core.
// -----------------------------------------------------------------------

export type CameraHealthTransitionKind =
  | "connectivity_lost"
  | "connectivity_restored"
  | "health_degraded"
  | "tamper_detected"
  | "recorder_failure"
  | "binding_changed";

const ONLINE_STATUS_VALUES = new Set(["online", "active", "healthy", "ok"]);

// Reuses cameraHealth.ts's own definition of "online" (see
// canonicalCameraHealth()) so this module and the existing health
// projection never disagree about what "online" means.
function isOnlineStatus(status: string | null | undefined) {
  return ONLINE_STATUS_VALUES.has(String(status || "").toLowerCase());
}

// Classifies a status/health_state transition as intelligence-worthy, or
// returns null for routine/unchanged transport noise (repeated
// heartbeats reporting the same state). Does not know about tamper or
// recorder failure signals directly -- those are passed explicitly by
// the caller (extra.tamper / extra.recorderFailure) because they come
// from distinct fields the camera domain already tracks, not from the
// status string alone.
export function classifyCameraHealthTransition(
  previousStatus: string | null | undefined,
  nextStatus: string | null | undefined,
  extra: { tamper?: boolean; recorderFailure?: boolean } = {}
): CameraHealthTransitionKind | null {
  if (extra.tamper) return "tamper_detected";
  if (extra.recorderFailure) return "recorder_failure";
  const prev = String(previousStatus || "").toLowerCase();
  const next = String(nextStatus || "").toLowerCase();
  if (!next || prev === next) return null; // no real transition, or nothing to compare against
  const wasOnline = isOnlineStatus(prev);
  const isOnline = isOnlineStatus(next);
  if (wasOnline && !isOnline) return "connectivity_lost";
  if (!wasOnline && isOnline) return "connectivity_restored";
  if (!wasOnline && !isOnline) return "health_degraded"; // e.g. "pending" -> "error", still not online
  return null; // online -> online with a cosmetic label change is not intelligence-worthy
}

export type CameraHealthCanonicalInput = {
  cameraId: string;
  cameraName?: string | null;
  estateId: string;
  homeId?: string | null;
  transition: CameraHealthTransitionKind;
  previousStatus?: string | null;
  nextStatus: string;
  observedAt: string;
  latencyMs?: number | null;
  providerError?: string | null;
  actorId?: string | null;
};

const TRANSITION_TYPE: Record<CameraHealthTransitionKind, string> = {
  connectivity_lost: "camera.connectivity.lost",
  connectivity_restored: "camera.connectivity.restored",
  health_degraded: "camera.health.degraded",
  tamper_detected: "camera.tamper.detected",
  recorder_failure: "camera.recorder.failed",
  binding_changed: "camera.binding.changed",
};

// Severity hint fed to the shared signalSeverity() classifier per
// transition -- connectivity_restored is deliberately informational
// (good news), not escalated.
const TRANSITION_SEVERITY_HINT: Record<CameraHealthTransitionKind, string> = {
  connectivity_lost: "offline",
  connectivity_restored: "online",
  health_degraded: "degraded",
  tamper_detected: "tamper",
  recorder_failure: "failed",
  binding_changed: "configuration_changed",
};

export async function submitCameraHealthCanonicalSignal(input: CameraHealthCanonicalInput) {
  return submitCanonicalSignal({
    type: TRANSITION_TYPE[input.transition],
    domain: "camera",
    source: "camera",
    origin: "physical",
    estateId: input.estateId,
    unitId: input.homeId || null,
    entity: {
      id: input.cameraId,
      type: "camera",
      name: input.cameraName || null,
      status: input.nextStatus,
    },
    actor: { id: input.actorId || null, type: input.actorId ? "operator" : "device" },
    severity: TRANSITION_SEVERITY_HINT[input.transition],
    triggerReason: `camera ${input.transition.replace(/_/g, " ")}`,
    // Stable per-camera correlation id (not per-event) so Core can
    // associate a sequence of health transitions for the same camera.
    correlationId: `camera_health:${input.cameraId}`,
    verified: true,
    evidence: [
      {
        id: null,
        type: "camera_health_transition",
        source: "camera_health",
        summary: `${input.previousStatus || "unknown"} -> ${input.nextStatus}`,
        timestamp: input.observedAt,
        metadata: {
          previous_status: input.previousStatus || null,
          next_status: input.nextStatus,
          latency_ms: input.latencyMs ?? null,
          provider_error: input.providerError || null,
        },
      },
    ],
    metadata: {
      transition: input.transition,
      previous_status: input.previousStatus || null,
      next_status: input.nextStatus,
      latency_ms: input.latencyMs ?? null,
      provider_error: input.providerError || null,
    },
  });
}
