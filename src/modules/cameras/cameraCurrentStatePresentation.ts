import { resolveCameraCurrentStates, CameraCurrentState, CameraInterpretationOptions } from "./cameraCurrentStateAuthority";
import { canAccessCamera, cameraHomeId, cameraPrivacyScope } from "./cameraAccess.policy";
import { sanitizeCameraRecord } from "./cameraSerialization";

type Actor = Parameters<typeof canAccessCamera>[1];
const operationalRoles = new Set(["admin", "system_admin", "estate_admin", "facility_manager", "manager", "security", "operator", "owner"]);

/** Presentation only. Never interprets registry flags or establishes new freshness. */
export function cameraStatePresentation(state: CameraCurrentState, detailed = false) {
  if (detailed) return state;
  const component = (c: CameraCurrentState["frame"]) => ({ state: c.state, freshness: c.freshness, reason: c.reason,
    observedAt: c.evidence.map(e => e.observedAt).sort().at(-1) || null,
    lastSuccessAt: c.lastSuccess.map(e => e.observedAt).sort().at(-1) || null });
  return { cameraId: state.cameraId, capability: state.capability, overall: state.overall, videoEvidence: state.videoEvidence,
    observedAt: state.observedAt, reasons: state.reasons,
    frame: component(state.frame), stream: component(state.stream), reachability: component(state.reachability),
    inference: component(state.inference), recorder: state.recorder,
    edge: { connectivity: state.edge.connectivity, freshness: state.edge.freshness, observedAt: state.edge.observedAt, reason: state.edge.reason } };
}

export function cameraStateExplanation(state: { overall: string; videoEvidence: string; inference: { state: string; freshness: string }; reachability: { state: string; freshness: string }; edge: { connectivity: string } }) {
  if (state.overall === "unknown") return state.edge.connectivity === "unavailable"
    ? "Current camera state is unknown: Edge telemetry is unavailable and there is no recent acquisition evidence."
    : "Current camera state is unknown; configuration alone does not prove video is working.";
  if (state.overall === "unavailable") return "A recent video acquisition attempt failed; this does not establish that the camera is physically offline.";
  if (state.inference.state === "failed" && state.inference.freshness === "fresh") return "Video acquisition was recently observed, but the latest inference attempt failed.";
  if (["failed", "mixed"].includes(state.reachability.state) && state.reachability.freshness === "fresh") return "The control endpoint is impaired, but a recent frame was acquired.";
  return state.overall === "degraded" ? "A recent frame was acquired, with component or telemetry impairment." : "Video acquisition was recently observed; continuous playback is not proven.";
}

export async function presentCameraRows(rows: any[], actor: Actor, options: CameraInterpretationOptions & { consumer?: boolean } = {}) {
  const groups = new Map<string, string[]>();
  for (const row of rows) if (row.id && row.estate_id && canAccessCamera(row, actor).ok) {
    const ids = groups.get(row.estate_id) || []; if (!ids.includes(row.id)) ids.push(row.id); groups.set(row.estate_id, ids);
  }
  const states = new Map<string, CameraCurrentState>();
  const now = options.now ?? Date.now();
  for (const [estate, ids] of groups) for (let offset=0; offset<ids.length; offset+=100) {
    for (const state of await resolveCameraCurrentStates(estate, ids.slice(offset,offset+100), actor, { ...options, now })) states.set(state.cameraId,state);
  }
  const detailed = !options.consumer && operationalRoles.has(String(actor?.role || "").toLowerCase());
  return rows.flatMap(row => {
    const state=states.get(row.id); if (!state) return [];
    // Explicit identity/configuration projection: raw observation, checkpoint and
    // legacy metadata/health diagnostics must not escape as competing truth.
    const fields=["id","name","estate_id","home_id","privacy_scope","camera_id","location","zone_id","room_id","building_id","ai_enabled","created_at","updated_at"];
    if (detailed) fields.push("provider","stream_protocol","edge_node_id","nvr_id","channel","ip","onvif_port");
    const identity=Object.fromEntries(fields.filter(k=>k in row).map(k=>[k,row[k]]));
    const current=cameraStatePresentation(state,detailed);
    const configuredDetection = (key: string) => ({availability: row.ai_enabled && row.metadata?.[key] === true ? "configured" : "unknown", source: "camera_profile"});
    return [{ ...sanitizeCameraRecord(identity), id: row.id, home_id: cameraHomeId(row), privacy_scope: cameraPrivacyScope(row), current_state: current, status: state.overall, health_status: state.overall,
      stream_status: state.stream.state, explanation: cameraStateExplanation(state),
      health: { status: state.overall, online: state.overall === "unknown" ? null : state.videoEvidence === "recent_acquisition",
        stream_status: state.stream.state, last_seen_at: state.observedAt, frame_freshness_at: state.frame.evidence.filter(e=>e.result==="acquired").map(e=>e.observedAt).sort().at(-1)||null },
      capabilities: { motionDetection: configuredDetection("detect_motion"), personDetection: configuredDetection("detect_person"), vehicleDetection: configuredDetection("detect_vehicle"), lineCrossing: configuredDetection("detect_line_crossing"), zoneIntrusion: configuredDetection("detect_zone_intrusion"),
        liveView: { availability: row.edge_hls_url || row.hls_url ? "configured" : "unknown", source: "playback_configuration_not_runtime_proof" },
        playback: { availability: row.edge_hls_url || row.hls_url ? "configured" : "unknown", source: "playback_configuration_not_runtime_proof" } } }];
  });
}

export function cameraStateCounts(rows: any[]) {
  const counts={healthy_count:0,degraded_count:0,unavailable_count:0,unknown_count:0};
  for(const row of rows){const state=row.current_state?.overall;const key= `${["healthy","degraded","unavailable"].includes(state)?state:"unknown"}_count` as keyof typeof counts;counts[key]++;}
  return counts;
}
