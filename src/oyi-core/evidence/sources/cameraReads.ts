// Evidence-read adapters for Facility camera current state. PURE READ.
import type { CapabilityContext } from "../../contracts/capability";
import type { EvidenceReadOutcome, EvidenceReadScope, OyiEvidence } from "../../contracts/evidence";
import type { IntelligenceFact } from "../../contracts/canonicalConversation";
import { evidenceReadOutcome } from "../EvidenceReadOutcome";
import { ordinaryEvidenceDb } from "../ReadOnlyEvidenceDb";
import { cameraAccessActor, canAccessCamera } from "../../../modules/cameras/cameraAccess.policy";
import { resolveCameraCurrentStates } from "../../../modules/cameras/cameraCurrentStateAuthority";
import { cameraStateExplanation } from "../../../modules/cameras/cameraCurrentStatePresentation";
import { evidenceFromFact } from "./evidenceFromFact";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const CAMERA_ROW_LIMIT = 100;

type FacilityCameraRead =
  | { availability: "available"; facts: IntelligenceFact[]; truncated: boolean; source_rows: number }
  | { availability: "unavailable" | "error"; reason: "estate_scope_missing" | "query_failed" };

// One canonical Facility camera read. The registry query is bounded to CAMERA_ROW_LIMIT
// BEFORE the camera access policy filters rows, so reaching the bound means accessible
// cameras may be missing: truncated, never complete. Unknown video state stays unknown;
// it is never offline.
async function readFacilityCameras(context: CapabilityContext): Promise<FacilityCameraRead> {
  const db = context.evidence_db ?? ordinaryEvidenceDb();
  const estateId = text(context.oisContext?.estate_id || context.actor?.estate_id);
  if (!estateId || !context.actor?.id) return { availability: "unavailable", reason: "estate_scope_missing" };
  const accessActor = cameraAccessActor(context.actor, { estate_id: estateId, home_id: null });
  try {
    const { data, error } = await db.from("facility_cameras")
      .select("id,estate_id,home_id,privacy_scope,metadata,name,location")
      .eq("estate_id", estateId).limit(CAMERA_ROW_LIMIT);
    if (error) throw error;
    const rows = (data || []) as any[];
    const authorised = rows.filter((row: any) => canAccessCamera(row, accessActor).ok);
    const states = await resolveCameraCurrentStates(estateId, authorised.map((row: any) => row.id), accessActor, {}, db);
    const names = new Map(authorised.map((row: any) => [String(row.id), text(row.name) || "Camera"]));
    const facts = states.map((state) => ({
      fact_id: `camera-current-state:${state.cameraId}`,
      domain: "cameras", fact_type: "camera_current_state",
      scope: { estate_id: estateId, home_id: null, room_id: null },
      object: { object_type: "camera", canonical_id: state.cameraId, label: names.get(state.cameraId) || "Camera" },
      statement: `${names.get(state.cameraId) || "Camera"}: ${cameraStateExplanation(state)} `,
      value: { overall: state.overall, video_evidence: state.videoEvidence, observed_at: state.observedAt },
      previous_value: null, occurred_at: state.observedAt, observed_at: new Date().toISOString(),
      source_type: "database", source_id: state.cameraId, truth_state: "confirmed",
      confidence: state.overall === "unknown" ? 0.4 : 0.9,
      freshness: state.observedAt || "unknown", privacy_class: "facility_sensitive",
      permissions: ["cameras.view"], evidence: [{ type: "camera_current_state", id: state.cameraId, overall: state.overall }],
    } as IntelligenceFact));
    return { availability: "available", facts, truncated: rows.length >= CAMERA_ROW_LIMIT, source_rows: rows.length };
  } catch {
    return { availability: "error", reason: "query_failed" };
  }
}

export async function facilityCameraEvidence(context: CapabilityContext): Promise<OyiEvidence[]> {
  const estateId = text(context.oisContext?.estate_id || context.actor?.estate_id);
  if (!estateId || !context.actor?.id) return [];
  const read = await readFacilityCameras(context);
  if (read.availability === "available") return read.facts.map(evidenceFromFact);
  return [evidenceFromFact({
      fact_id: `camera-current-state-unavailable:${context.resolvedTurn.request_id}`,
      domain: "cameras", fact_type: "camera_current_state",
      scope: { estate_id: estateId, home_id: null, room_id: null },
      object: { object_type: "camera", canonical_id: estateId, label: "Estate cameras" },
      statement: "Camera current-state evidence could not be loaded.", value: null,
      previous_value: null, occurred_at: null, observed_at: new Date().toISOString(),
      source_type: "database", source_id: null, truth_state: "unavailable",
      confidence: 0, freshness: "unavailable", privacy_class: "facility_sensitive",
      permissions: ["cameras.view"], evidence: [{ type: "camera_current_state", status: "unavailable" }],
    } as IntelligenceFact)];
}

export async function facilityCameraOutcome(context: CapabilityContext, scope: EvidenceReadScope): Promise<EvidenceReadOutcome> {
  const base = {
    capability_key: "facility.cameras.read", domain: "cameras" as const, requested_scope: scope, effective_scope: scope,
    authority: "allowed" as const, scope: "enforced" as const, query_executed: true, availability: "available" as const,
    population: `cameras_in_verified_estate_accessible_to_actor_registry_limit_${CAMERA_ROW_LIMIT}`,
    complete: false, truncated: false, freshness: "unknown" as const, records: [] as OyiEvidence[],
  };
  const read = await readFacilityCameras(context);
  if (read.availability !== "available") {
    return read.reason === "estate_scope_missing"
      ? evidenceReadOutcome({ ...base, scope: "insufficient", query_executed: false })
      : evidenceReadOutcome({ ...base, availability: "error" });
  }
  // A camera whose current video state is unknown is a registered camera with no
  // observation: keep it, mark unobservable, never offline.
  const records = read.facts.map(evidenceFromFact).map(record => {
    const overall = text(recordOf(recordOf(record.payload).fact && (recordOf(record.payload).fact as any).value).overall);
    return overall === "unknown" ? { ...record, freshness: "unobservable" as const } : record;
  });
  return evidenceReadOutcome({
    ...base, records, complete: !read.truncated, truncated: read.truncated,
    freshness: records.some(r => r.freshness === "unobservable") ? "unknown" : "current",
  });
}

