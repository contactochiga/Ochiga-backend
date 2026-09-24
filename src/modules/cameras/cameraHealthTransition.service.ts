import { randomUUID, createHash } from "crypto";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { cameraCurrentState, CAMERA_CURRENT_STATE_SELECT } from "./cameraCurrentStateAuthority";
import { EDGE_CURRENT_STATE_SELECT, edgeCurrentState } from "../../services/edgeCurrentStateAuthority";
import { cameraHomeId, cameraPrivacyScope, cameraOfficeAllowedUserIds, CAMERA_ACCESS_SELECT } from "./cameraAccess.policy";
import { submitCanonicalSignal } from "../../oyi-core/ingress/canonicalSignalIngress";
import { operationalMetrics } from "../../observability/metrics";
import { emitSignalSafely, makeBaseSignal } from "../../realtime/emitSignal";

export const CAMERA_TRANSITION_POLICY = "camera-transition-v1/current-state-14d-v1";
const table = "camera_health_transition_outbox";
// Trusted Backend evaluator only, not a user context or public API.
const actor = { id: "camera-transition-service", role: "system_admin" };
function scopeRevision(camera: any) {
  return createHash("sha256").update(JSON.stringify([camera.estate_id,cameraHomeId(camera),cameraPrivacyScope(camera),[...cameraOfficeAllowedUserIds(camera)].sort()])).digest("hex");
}

export function cameraTransitionType(previous: string | null, current: string, compatible = true): string | null {
  if (!compatible || previous === current || current === "unknown") return null;
  if (current === "healthy") return previous === "degraded" || previous === "unavailable" ? "camera.video.restored" : null;
  if (current === "unavailable") return "camera.video.unavailable";
  if (current === "degraded") return previous === "unavailable" ? "camera.health.improved" : "camera.health.degraded";
  return null;
}

export function prepareCameraTransition(camera: any, node: any, now = Date.now()) {
  const state = cameraCurrentState(camera, actor, node, { now });
  const cp = camera.health_transition_checkpoint;
  const edge = edgeCurrentState(node, now);
  const deadlines = [now + 1000];
  // Reject if acceptance crossed ANY source-time freshness boundary; no receipt-time ordering.
  for (const c of [state.configuration.stream, state.frame, state.stream, state.reachability, state.inference]) {
    for (const e of [...c.evidence, ...c.lastSuccess]) if (e.policy) {
      for (const ms of [e.policy.freshMs, e.policy.expiresMs]) {
        const at = Date.parse(e.observedAt) + ms + 1;
        if (at > now) deadlines.push(at);
      }
    }
  }
  if (edge.observedAt) for (const ms of [edge.policy.freshMs, edge.policy.expiresMs]) {
    const at = Date.parse(edge.observedAt) + ms + 1;
    if (at > now) deadlines.push(at);
  }
  // Invalid future observations may become admissible without any stored revision change.
  for (const entry of Object.values(camera.runtime_observations?.dimensions || {}) as any[]) {
    for (const e of [entry?.latest, entry?.last_success]) for (const time of [e?.observed_at, e?.received_at]) {
      const at = Date.parse(time || "") - 10000;
      if (Number.isFinite(at) && at > now) deadlines.push(at);
    }
  }
  for (const time of [node?.heartbeat_observed_at, node?.heartbeat_received_at]) {
    const at = Date.parse(time || "") - 10000;
    if (Number.isFinite(at) && at > now) deadlines.push(at);
  }
  const summary = {
    scope_revision: scopeRevision(camera),
    policy_key: JSON.stringify([CAMERA_TRANSITION_POLICY,edge.policy.expectedIntervalMs,process.env.CAMERA_AI_INTERVAL_MS || "15000"]),
    components: { frame: state.frame.state, stream: state.stream.state, reachability: state.reachability.state,
      inference: state.inference.state, edge: state.edge.connectivity },
    reasons: state.reasons.slice(0,32),
    evidence: [state.frame, state.stream, state.reachability, state.inference].flatMap(c => c.evidence)
      .map(e => ({ id: e.observationId, source: `${e.kind}:${e.source}`, observed_at: e.observedAt })).slice(0,16),
  };
  return { state, evaluation: { policy_revision: CAMERA_TRANSITION_POLICY, overall: state.overall,
    transition_type: cameraTransitionType(cp?.overall || null, state.overall, !cp || (cp.policy_revision === CAMERA_TRANSITION_POLICY && cp.summary?.policy_key === summary.policy_key && cp.summary?.scope_revision === summary.scope_revision)),
    evaluated_at: new Date(now).toISOString(), valid_until: new Date(Math.min(...deadlines)).toISOString(), summary } };
}

/** Bounded keyset sweep covers observation, Edge, configuration and time-only changes.
 * No reads trigger evaluation. No provider calls. Old/pending observations are not a journal.
 */
export async function evaluateCameraTransitions(afterId = "", limit = 100) {
  const bounded = Math.max(1, Math.min(100, limit));
  let query = supabaseAdmin.from("facility_cameras").select(`${CAMERA_CURRENT_STATE_SELECT},health_transition_checkpoint`).order("id").limit(bounded);
  if (afterId) query = query.gt("id", afterId);
  const { data, error } = await query;
  if (error) throw error;
  const cameras = data || [];
  const ids = [...new Set(cameras.map((c: any) => c.edge_node_id).filter(Boolean))];
  const estates = [...new Set(cameras.map((c: any) => c.estate_id))];
  const edges = ids.length ? await supabaseAdmin.from("edge_nodes").select(EDGE_CURRENT_STATE_SELECT).in("edge_node_id", ids).in("estate_id", estates).limit(10000) : { data: [], error: null };
  if (edges.error) throw edges.error;
  const map = new Map((edges.data || []).map((n: any) => [`${n.estate_id}:${n.edge_node_id}`, n]));
  let accepted = 0;
  for (const camera of cameras as any[]) {
    const node = map.get(`${camera.estate_id}:${camera.edge_node_id}`) || null;
    const { evaluation } = prepareCameraTransition(camera, node);
    const { health_transition_checkpoint, ...expected } = camera;
    const result = await supabaseAdmin.rpc("oyi_accept_camera_health_transition", { p_camera_id: camera.id,
      p_expected_camera: expected, p_expected_edge: node, p_expected_checkpoint: health_transition_checkpoint,
      p_evaluation: evaluation });
    if (result.error) {
      operationalMetrics.increment("camera_transition_evaluation_total", { result: "error" });
      continue; // A bad row cannot permanently starve the keyset sweep.
    }
    if (result.data?.accepted) accepted++;
    operationalMetrics.increment("camera_transition_evaluation_total", { result: result.data?.accepted ? "accepted" : "recompute" });
  }
  return { accepted, count: cameras.length, cursor: cameras.length === bounded ? cameras[cameras.length - 1].id : "" };
}

export function cameraTransitionSignal(row: any, camera: any) {
  const recovery = row.transition_type === "camera.video.restored";
  return {
    type: row.transition_type, domain: "camera", source: "camera" as const, origin: "physical" as const,
    estateId: camera.estate_id, unitId: cameraHomeId(camera) || null,
    entity: { id: camera.id, type: "camera", status: row.current_state },
    severity: recovery ? "info" : "warning", verified: true,
    triggerReason: row.transition_type === "camera.video.unavailable" ? "Observed video acquisition unavailable; physical connectivity is not established" :
      recovery ? "Observed video acquisition recovered" : row.transition_type === "camera.health.improved" ? "Camera acquisition partially improved; impairment remains" : "Camera acquisition has component impairment",
    correlationId: `camera_health:${camera.id}`,
    evidence: [{ id: row.transition_id, type: "camera_health_transition", source: "camera_current_state_authority",
      timestamp: row.evaluated_at, metadata: row.payload }],
    metadata: { id: row.transition_id, provider_event_id: row.transition_id, timestamp: row.evaluated_at,
      producer: "camera_health_transition_authority", transition: row.transition_type,
      previous_status: row.previous_state, next_status: row.current_state, policy_revision: row.policy_revision,
      capability: "observed_video_acquisition", home_id: cameraHomeId(camera) || null, privacy_scope: cameraPrivacyScope(camera) },
  };
}

/** Persisted signal alone is insufficient. Verify signal-specific awareness and
 * incident evidence. Missing artifacts retain the obligation; no frozen Core repair.
 */
export async function cameraTransitionMaterialized(id: string, camera: any) {
  // Match the frozen canonical store's identity convention and indexed keys.
  // Avoid scanning all historical JSON/array evidence for every delivery.
  const signalKey = ["camera", id, "camera", camera.id, camera.estate_id, cameraHomeId(camera) || "no-home"].join(":");
  const signal = await supabaseAdmin.from("operational_signals").select("id,payload")
    .eq("canonical_signal_key", signalKey).eq("producer", "camera_health_transition_authority").maybeSingle();
  if (signal.error || !signal.data) return false;
  const awareness = await supabaseAdmin.from("operational_awareness").select("id,incident_id")
    .eq("awareness_key", `awareness:${id}`).contains("related_signals", [id]).maybeSingle();
  if (awareness.error || !awareness.data?.incident_id) return false;
  const incident = await supabaseAdmin.from("operational_incidents").select("id")
    .eq("id", awareness.data.incident_id).contains("evidence", [{ id }]).maybeSingle();
  return !incident.error && Boolean(incident.data);
}

export async function deliverCameraTransitions(limit = 25) {
  const { data, error } = await supabaseAdmin.from(table).select("*").neq("delivery_state", "materialized")
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .order("created_at").limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw error;
  for (const row of data || []) {
    const now = Date.now();
    if (row.lease_until && Date.parse(row.lease_until) > now) continue;
    const earlier = await supabaseAdmin.from(table).select("transition_id").eq("camera_id", row.camera_id)
      .lt("checkpoint_revision", row.checkpoint_revision).neq("delivery_state", "materialized").limit(1);
    if (earlier.error) continue;
    if (earlier.data?.length) {
      await supabaseAdmin.from(table).update({lease_until:new Date(now+60000).toISOString()})
        .eq("transition_id",row.transition_id).eq("attempt_count",row.attempt_count).neq("delivery_state","materialized");
      continue;
    }
    const token = randomUUID();
    const claim = await supabaseAdmin.from(table).update({ delivery_state: "submitting", claim_token: token,
      lease_until: new Date(now + 60000).toISOString(), last_attempt_at: new Date(now).toISOString(),
      attempt_count: row.attempt_count + 1, updated_at: new Date(now).toISOString() })
      .eq("transition_id", row.transition_id).eq("updated_at", row.updated_at).eq("attempt_count",row.attempt_count).select("transition_id").maybeSingle();
    if (claim.error || !claim.data) continue;
    let complete = false;
    try {
      const camera = await supabaseAdmin.from("facility_cameras").select(CAMERA_ACCESS_SELECT).eq("id", row.camera_id).eq("estate_id", row.estate_id).maybeSingle();
      if (camera.error || !camera.data || scopeRevision(camera.data) !== row.payload?.summary?.scope_revision) throw new Error("scope_changed");
      complete = await cameraTransitionMaterialized(row.transition_id, camera.data);
      if (!complete) {
        await submitCanonicalSignal(cameraTransitionSignal(row, camera.data));
        complete = await cameraTransitionMaterialized(row.transition_id, camera.data);
      }
      if (complete) emitSignalSafely(makeBaseSignal({type:"camera.health.transition",source:"camera_health_transition_authority",
        estateId:camera.data.estate_id,homeId:cameraHomeId(camera.data)||undefined,
        metadata:{camera_id:camera.data.id,transition_id:row.transition_id,previous:row.previous_state,current:row.current_state,summary:row.payload.summary},
      } as any),{skipCanonicalIngress:true});
    } catch { /* bounded code only; never persist arbitrary provider/DB error text */ }
    await supabaseAdmin.from(table).update({ delivery_state: complete ? "materialized" : "retryable_failure",
      acknowledged_at: complete ? new Date().toISOString() : null, error_code: complete ? null : "materialization_unconfirmed",
      lease_until: complete ? null : new Date(Date.now() + 60000).toISOString(), updated_at: new Date().toISOString() })
      .eq("transition_id", row.transition_id).eq("claim_token", token);
  }
}
