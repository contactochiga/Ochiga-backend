import { supabaseAdmin } from "../supabase/supabaseClient";

export const EDGE_CURRENT_STATE_SELECT = "id,estate_id,edge_node_id,heartbeat_observed_at,heartbeat_received_at,heartbeat_observation";
export function expectedEdgeHeartbeatInterval() {
  const value = Number(process.env.EDGE_HEARTBEAT_INTERVAL_MS || 30000);
  return Number.isSafeInteger(value) && value >= 1000 && value <= 2147483647 ? value : 30000;
}

/** Interpretation only: no provider polling, cache, writes, or camera inference.
 * Three missed heartbeat opportunities + the default 10s request budget marks
 * stale; six opportunities / two capped 60s retries + request budget expires.
 * H is Backend expectation, not proof the agent applied its remote config. */
export function edgeCurrentState(node: any, now = Date.now()) {
  const observation = node?.heartbeat_observation;
  const observed = Date.parse(node?.heartbeat_observed_at || "");
  const received = Date.parse(node?.heartbeat_received_at || "");
  const valid = observation?.version === 1 && observation?.source === "edge_heartbeat" &&
    Number.isFinite(observed) && Number.isFinite(received) && observed <= received + 10000 && observed <= now + 10000;
  const interval = Number(observation?.expected_interval_ms);
  const h = Number.isSafeInteger(interval) && interval >= 1000 ? interval : expectedEdgeHeartbeatInterval();
  const freshMs = 3 * h + 10000;
  const expiresMs = Math.max(6 * h, 120000) + 10000;
  const age = valid ? Math.max(0, now - observed) : null;
  const freshness = age === null ? "unknown" : age <= freshMs ? "fresh" : age <= expiresMs ? "stale" : "expired";
  const status = valid ? String(observation.status || "unknown").toLowerCase() : null;
  const queueDepth = valid ? Number(observation.queue_depth) : null;
  const syncStatus = valid ? String(observation.sync_status || "unknown") : null;
  const errorCount = valid ? Number(observation.error_count) : null;
  const healthyReport = ["online", "healthy", "active"].includes(status || "");
  const degraded = (queueDepth || 0) > 0 || (errorCount || 0) > 0 || !["synced", "healthy", "ok"].includes(syncStatus || "");
  const connectivity = freshness === "unknown" ? "unknown" : freshness === "expired" ? "unavailable" :
    freshness === "stale" ? "degraded" : healthyReport ? (degraded ? "degraded" : "healthy") :
    ["degraded", "error"].includes(status || "") ? "degraded" :
    ["offline", "unavailable"].includes(status || "") ? "unavailable" : "unknown";
  const reason = !valid ? (observation ? "invalid_observation" : "never_observed") :
    freshness === "expired" ? "heartbeat_expired_telemetry_unavailable" : freshness === "stale" ? "heartbeat_stale" :
    !healthyReport ? `agent_reported_${status}` : degraded ? "agent_reported_service_degradation" : "fresh_heartbeat";
  return {
    nodeId: node?.edge_node_id || null, estateId: node?.estate_id || null, connectivity, freshness, reason,
    observedAt: valid ? new Date(observed).toISOString() : null,
    receivedAt: valid ? new Date(received).toISOString() : null, ageMs: age,
    lastKnownStatus: status, runtimeVersion: valid ? observation.runtime_version || null : null,
    queueHealth: { depth: queueDepth, status: queueDepth === null ? "unknown" : queueDepth > 0 ? "backlog" : "clear" },
    syncHealth: syncStatus, errorState: { reportedCount: errorCount },
    source: valid ? "edge_heartbeat" : "unavailable",
    policy: { expectedIntervalMs: h, intervalSource: "backend_expected_not_agent_confirmed", freshMs, expiresMs },
  };
}

export function projectEdgeNode(node: any, now = Date.now()) {
  const current = edgeCurrentState(node, now);
  return { ...node, heartbeat_status: current.connectivity === "healthy" ? "online" : current.connectivity,
    last_seen_at: current.observedAt, current_state: current };
}

export async function listEdgeCurrentStates(estateId: string) {
  const { data, error } = await supabaseAdmin.from("edge_nodes").select(EDGE_CURRENT_STATE_SELECT).eq("estate_id", estateId).limit(1000);
  if (error) throw error;
  const now = Date.now();
  return (data || []).map((node: any) => edgeCurrentState(node, now));
}

export async function ingestEdgeHeartbeat(identity: { id: string; siteId: string; legacy?: boolean }, payload: any) {
  if (!identity?.id || !identity?.siteId || identity.legacy) throw new Error("bound_edge_identity_required");
  for (const [key, expected] of [["site_id",identity.siteId],["estate_id",identity.siteId],["agent_id",identity.id],["edge_node_id",identity.id]]) {
    if (payload[key] != null && String(payload[key]) !== expected) throw new Error("edge_identity_mismatch");
  }
  const observed = Date.parse(String(payload.ts || ""));
  if (!Number.isFinite(observed) || !/(Z|[+-]\d{2}:\d{2})$/i.test(String(payload.ts))) throw new Error("edge_observed_at_required_or_invalid");
  // DB repeats the time guard against its own receipt clock.
  if (observed > Date.now() + 10000) throw new Error("edge_observed_at_future_or_invalid");
  const { data, error } = await supabaseAdmin.rpc("oyi_ingest_edge_heartbeat", {
    p_estate_id: identity.siteId, p_edge_node_id: identity.id,
    p_heartbeat: { ...payload, site_id: identity.siteId, agent_id: identity.id, ts: new Date(observed).toISOString() },
    p_expected_interval_ms: expectedEdgeHeartbeatInterval(),
  });
  if (error) throw error; // No fallback that acknowledges non-durable telemetry.
  return { ...data, current_state: edgeCurrentState(data.node) };
}
