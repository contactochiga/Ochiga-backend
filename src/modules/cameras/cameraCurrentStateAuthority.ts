import { supabaseAdmin } from "../../supabase/supabaseClient";
import { EDGE_CURRENT_STATE_SELECT, edgeCurrentState, expectedEdgeHeartbeatInterval } from "../../services/edgeCurrentStateAuthority";
import { operationalMetrics } from "../../observability/metrics";
import { CAMERA_ACCESS_SELECT, canAccessCamera, requireCameraAccess } from "./cameraAccess.policy";

export const CAMERA_CURRENT_STATE_SELECT = `${CAMERA_ACCESS_SELECT},edge_node_id,nvr_id,channel,ai_enabled,runtime_observations`;
type Actor = Parameters<typeof canAccessCamera>[1];
type Freshness = "fresh" | "stale" | "expired" | "unspecified" | "unknown";
type Window = { freshMs: number; expiresMs: number; basis: string };
export type CameraInterpretationOptions = { now?: number; windows?: Record<string, Window> };
type Evidence = { source: string; kind: string; result: string; observationId: string; observedAt: string;
  receivedAt: string; ageMs: number; freshness: Freshness; policy: Window | null; details: Record<string, unknown> };
type Component = { state: string; freshness: Freshness; reason: string; evidence: Evidence[]; lastSuccess: Evidence[] };
const vocabulary: Record<string, string[]> = {
  "stream_configuration:go2rtc_registry": ["configured", "not_configured"],
  "stream:go2rtc_inspection": ["inspected", "failed"],
  "reachability:onvif_probe": ["succeeded", "failed", "authentication_failed"],
  "reachability:tcp_probe": ["succeeded", "failed", "authentication_failed"],
  "frame:go2rtc_snapshot": ["acquired", "failed"], "frame:ai_snapshot": ["acquired", "failed"],
  "frame:media_ingestion": ["acquired"],
  "inference:external_detector": ["succeeded", "failed", "skipped", "dropped"],
};
const detailKeys = ["stream_present", "producer_count", "consumer_count", "port", "latency_ms", "mime_type", "validation", "size_bytes", "media_id", "detection_count", "queue_depth", "dropped_samples", "error_code"];

function cadenceWindow(h: number, basis: string): Window {
  return { freshMs: 3 * h + 10000, expiresMs: 6 * h + 10000, basis };
}
function windows(edge: ReturnType<typeof edgeCurrentState>, overrides: CameraInterpretationOptions["windows"]) {
  // These are expectations, not acknowledgements of effective Edge configuration.
  const h = edge.policy.expectedIntervalMs || expectedEdgeHeartbeatInterval();
  const ai = Number(process.env.CAMERA_AI_INTERVAL_MS || 15000);
  const result: Record<string, Window> = {
    "stream:go2rtc_inspection": cadenceWindow(h, "heartbeat_scheduled_inspection_backend_expected_interval"),
    "stream_configuration:go2rtc_registry": cadenceWindow(h, "heartbeat_scheduled_registry_inspection"),
  };
  if (Number.isSafeInteger(ai) && ai >= 5000) {
    result["frame:ai_snapshot"] = cadenceWindow(ai, "ai_loop_backend_expected_interval_not_agent_confirmed");
    result["inference:external_detector"] = result["frame:ai_snapshot"];
  }
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!vocabulary[key] || !Number.isFinite(value.freshMs) || value.freshMs <= 0 ||
      !Number.isFinite(value.expiresMs) || value.expiresMs < value.freshMs || !value.basis?.trim()) throw new Error("invalid_camera_freshness_policy");
    result[key] = value;
  }
  return result;
}

function evidence(raw: any, slot: string, camera: any, now: number, policies: Record<string, Window>): Evidence | null {
  const observed = Date.parse(raw?.observed_at || ""), received = Date.parse(raw?.received_at || "");
  if (!vocabulary[slot]?.includes(raw?.result) || raw?.schema_version !== 1 ||
    `${raw.kind}:${raw.source}` !== slot || raw.camera_id !== camera.id || !camera.edge_node_id || raw.edge_node_id !== camera.edge_node_id ||
    typeof raw.observation_id !== "string" || !/^[0-9a-f-]{36}$/i.test(raw.observation_id) ||
    !Number.isFinite(observed) || !Number.isFinite(received) || observed < Date.UTC(2000, 0) ||
    observed > now + 10000 || received > now + 10000 || observed > received + 10000) return null;
  const detail = raw.details || {};
  if (raw.kind === "frame" && raw.result === "acquired" &&
    (detail.validation !== "bounded_image_signature" || !["image/jpeg", "image/webp"].includes(detail.mime_type) ||
      !Number.isFinite(detail.size_bytes) || detail.size_bytes <= 0 || detail.size_bytes > 5242880)) return null;
  const ageMs = Math.max(0, now - observed), policy = policies[slot] || null;
  const freshness: Freshness = !policy ? "unspecified" : ageMs <= policy.freshMs ? "fresh" : ageMs <= policy.expiresMs ? "stale" : "expired";
  return { source: raw.source, kind: raw.kind, result: raw.result, observationId: raw.observation_id,
    observedAt: new Date(observed).toISOString(), receivedAt: new Date(received).toISOString(), ageMs, freshness, policy,
    details: Object.fromEntries(detailKeys.filter(k => Object.prototype.hasOwnProperty.call(detail, k) && ["string", "number", "boolean"].includes(typeof detail[k])).map(k => [k, detail[k]])) };
}

/** Pure internal interpreter. Actor MUST be built from authenticated, membership-resolved context.
 * Input camera MUST be a canonical row with CAMERA_CURRENT_STATE_SELECT, not client/Edge JSON.
 * No writes, signals, polling, cache, raw URL or legacy health fallback. */
export function cameraCurrentState(camera: any, actor: Actor, edgeNode?: any, options: CameraInterpretationOptions = {}) {
  for (const key of CAMERA_CURRENT_STATE_SELECT.split(",")) if (!Object.prototype.hasOwnProperty.call(camera || {}, key)) throw new Error("camera_authority_projection_incomplete");
  requireCameraAccess(camera, actor);
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error("invalid_camera_read_clock");
  const boundEdge = edgeNode?.estate_id === camera.estate_id && edgeNode?.edge_node_id === camera.edge_node_id ? edgeNode : undefined;
  const edge = edgeCurrentState(boundEdge, now), policies = windows(edge, options.windows);
  const dimensions = camera.runtime_observations?.version === 1 ? camera.runtime_observations.dimensions : null;
  const reasons: string[] = [];
  if (camera.runtime_observations != null && (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions))) reasons.push("invalid_observation_projection");
  const components: Record<string, Component> = {};
  for (const kind of ["stream_configuration", "reachability", "stream", "frame", "inference"]) {
    const list: Evidence[] = [], successes: Evidence[] = [];
    for (const slot of Object.keys(vocabulary).filter(k => k.startsWith(`${kind}:`))) {
      const entry = dimensions?.[slot];
      if (!entry) continue;
      const latest = evidence(entry.latest, slot, camera, now, policies);
      if (latest) list.push(latest); else reasons.push(`${slot}:invalid_latest`);
      if (kind === "frame" && entry.last_success) {
        const success = evidence(entry.last_success, slot, camera, now, policies);
        if (success?.result === "acquired") successes.push(success); else reasons.push(`${slot}:invalid_last_success`);
      }
    }
    const fresh = list.filter(e => e.freshness === "fresh");
    let state = "unknown", reason = "never_observed";
    if (list.length) {
      reason = fresh.length ? "fresh_component_observation" : "no_fresh_component_observation";
      if (fresh.length) {
        const good = fresh.some(e => ["acquired", "succeeded", "inspected", "configured"].includes(e.result));
        const bad = fresh.some(e => ["failed", "authentication_failed"].includes(e.result));
        state = good && bad ? "mixed" : bad ? "failed" : good ?
          kind === "stream" ? "inspected" : kind === "frame" ? "acquired" : kind === "stream_configuration" ? "configured" : "succeeded" :
          fresh.some(e => e.result === "dropped") ? "dropped" : fresh.some(e => e.result === "skipped") ? "skipped" : "not_configured";
      }
    }
    const freshness: Freshness = fresh.length ? "fresh" : list.some(e => e.freshness === "stale") ? "stale" :
      list.some(e => e.freshness === "unspecified") ? "unspecified" : list.length ? "expired" : "unknown";
    components[kind] = { state, freshness, reason, evidence: list, lastSuccess: successes };
  }
  const { frame, stream, reachability, inference } = components;
  // Only a fresh latest successful attempt supports current video-path evidence.
  // Retained last_success is explanation/history, never an override of a newer failure.
  const video = frame.evidence.some(e => e.freshness === "fresh" && e.result === "acquired");
  const frameFailure = frame.evidence.some(e => e.freshness === "fresh" && e.result === "failed");
  const impaired = [frame, stream, reachability, inference].some(c => ["mixed", "failed", "dropped", "skipped"].includes(c.state));
  const aging = [stream, reachability, inference].some(c => c.freshness === "stale" || c.freshness === "expired");
  const edgeImpaired = ["degraded", "unavailable"].includes(edge.connectivity);
  const overall: "healthy" | "degraded" | "unavailable" | "unknown" = video ?
    impaired || aging || edgeImpaired || reasons.length > 0 ? "degraded" : "healthy" : frameFailure ? "unavailable" : "unknown";
  reasons.push(video ? "recent_signature_valid_frame_acquired_not_continuous_video_proof" : frameFailure ? "fresh_frame_attempt_failed_no_fresh_successful_path" : "no_fresh_video_path_evidence");
  if (stream.state === "failed") reasons.push("stream_inspection_failed_not_video_failure_proof");
  if (reachability.state === "failed" || reachability.state === "mixed") reasons.push("control_endpoint_failure_does_not_negate_frame_evidence");
  if (["failed", "skipped", "dropped"].includes(inference.state)) reasons.push(`inference_${inference.state}_not_camera_failure`);
  if (edgeImpaired) reasons.push("edge_telemetry_impaired_not_physical_camera_offline");
  const all = Object.values(components).flatMap(c => c.evidence);
  return { cameraId: camera.id, capability: "observed_video_acquisition" as const, overall, videoEvidence: video ? "recent_acquisition" : frameFailure ? "acquisition_failed" : "unknown",
    configuration: { recorderAssigned: Boolean(camera.nvr_id), channel: camera.channel ?? null, aiEnabled: camera.ai_enabled === true, stream: components.stream_configuration },
    reachability, stream, frame, inference,
    // Frozen v1 has no recorder identity/vantage in tcp_probe. Do not attribute a camera endpoint to an NVR.
    recorder: { state: "unknown", freshness: "unspecified", reason: "no_recorder_bound_observation_contract" },
    edge: { connectivity: edge.connectivity, freshness: edge.freshness, reason: edge.reason, observedAt: edge.observedAt, receivedAt: edge.receivedAt },
    observedAt: all.length ? all.map(e => e.observedAt).sort().at(-1)! : null,
    // Summary timestamp is informational only; component clocks remain independent.
    reasons: [...new Set(reasons)], sources: [...new Set(all.map(e => `${e.kind}:${e.source}`))],
  };
}

/** One estate and <=100 explicit IDs per batch. Denied/missing IDs return no row.
 * No routes added. Callers must pass canonical authenticated resolved actor context. */
export async function resolveCameraCurrentStates(estateId: string, cameraIds: string[], actor: Actor, options: CameraInterpretationOptions = {}) {
  if (!actor?.id || !estateId || !Array.isArray(cameraIds) || cameraIds.length > 100) throw new Error("camera_authority_scope_required");
  if (!cameraIds.length) return [];
  try {
    const { data, error } = await supabaseAdmin.from("facility_cameras").select(CAMERA_CURRENT_STATE_SELECT).eq("estate_id", estateId).in("id", [...new Set(cameraIds)]).limit(100);
    if (error) throw error;
    const cameras = (data || []).filter((c: any) => canAccessCamera(c, actor).ok);
    const ids = [...new Set(cameras.map((c: any) => c.edge_node_id).filter(Boolean))];
    let nodes: any[] = [];
    if (ids.length) {
      const result = await supabaseAdmin.from("edge_nodes").select(EDGE_CURRENT_STATE_SELECT).eq("estate_id", estateId).in("edge_node_id", ids).limit(100);
      if (result.error) throw result.error;
      nodes = result.data || [];
    }
    const byId = new Map(nodes.map(n => [n.edge_node_id, n]));
    const now = options.now ?? Date.now();
    return cameras.map((camera: any) => {
      const result = cameraCurrentState(camera, actor, byId.get(camera.edge_node_id), { ...options, now });
      operationalMetrics.increment("camera_current_state_reads_total", { overall: result.overall });
      return result;
    });
  } catch (error) {
    operationalMetrics.increment("camera_current_state_read_failures_total");
    throw error;
  }
}

export type CameraCurrentState = ReturnType<typeof cameraCurrentState>;
