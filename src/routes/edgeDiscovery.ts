import { Router } from "express";
import { randomUUID } from "crypto";
import { ingestEdgeHeartbeat, expectedEdgeHeartbeatInterval } from "../services/edgeCurrentStateAuthority";
import { ingestCameraObservations } from "../modules/cameras/cameraObservation.service";
import { requireAuth, requirePermission } from "../middleware/auth";
import { requireEdgeToken, requireCameraEdgeToken } from "../middleware/edgeToken";
import { CAMERA_ACCESS_SELECT, cameraHomeId } from "../modules/cameras/cameraAccess.policy";
import { emitAuditEvent } from "../core/foundation";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitSignal, emitSignalSafely, makeBaseSignal } from "../realtime/emitSignal";
import { normalizeIntelligenceEvent, publishIntelligenceEvent } from "../intelligence-core";
import { publicDiscoveryCandidate, safeGatewayError, sanitizeDiscoveryCandidate, validateDiscoveryRequest } from "../modules/cameras/cameraGateway";
import { ingestEdgeMedia } from "../modules/cameras/cameraMedia.service";
import { ingestEdgeDetections } from "../modules/cameras/cameraDetection.service";
// Oyi Intelligence Convergence, Camera Intelligence Convergence Wave --
// additive canonical Core ingress alongside the existing emitEdgeSignal()
// realtime broadcast below, which stays UNCHANGED. See
// oyi-core/domains/camera/cameraCanonicalSignal.ts.

export const edgeDiscoveryRouter = Router();

const store: Record<string, any[]> = {}; // fallback cache when persistence tables are unavailable

function nowIso() {
  return new Date().toISOString();
}

function asString(value: any, fallback = "") {
  return String(value ?? fallback).trim();
}

function asNumber(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasPermission(user: any, permission: string) {
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

function boundEdgeContext(req: any, payload: any = {}) {
  return {
    siteId: asString(req.edgeAgent?.siteId || payload.site_id || payload.estate_id),
    agentId: asString(req.edgeAgent?.id || payload.agent_id || payload.edge_node_id),
  };
}


const SUPPORTED_CAMERA_PROVIDERS = new Set(["generic_rtsp", "onvif", "hikvision", "dahua", "uniview", "tuya_camera", "other"]);
const SUPPORTED_CAMERA_PROTOCOLS = new Set(["rtsp", "onvif", "hls", "mjpeg", "http_snapshot"]);

function normalizeProvider(value: any) {
  const provider = asString(value || "generic_rtsp");
  return SUPPORTED_CAMERA_PROVIDERS.has(provider) ? provider : "other";
}

function normalizeProtocol(value: any) {
  const protocol = asString(value || "rtsp");
  return SUPPORTED_CAMERA_PROTOCOLS.has(protocol) ? protocol : "rtsp";
}

function safeMeta(value: any): any {
  if (Array.isArray(value)) return value.slice(0, 100).map(safeMeta);
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    return value.replace(/(rtsp|https?):\/\/[^:@/]+:[^@/]+@/gi, "$1://***:***@");
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["password", "pass", "secret", "token", "username"].includes(key.toLowerCase()))
    .map(([key, nested]) => [key, safeMeta(nested)]));
}

function sanitizeDevice(device: any) {
  const clean = safeMeta(device || {});
  delete clean.password;
  delete clean.pass;
  delete clean.secret;
  delete clean.token;
  delete clean.username;

  return {
    ...clean,
    credential_ref: asString(device?.credential_ref || clean.credential_ref || (device?.credentials_present ? "local:onvif-default" : "")) || null,
    credentials_present: Boolean(device?.credentials_present || device?.credential_ref),
  };
}

function isCamera(device: any) {
  const text = [device?.category, device?.type, device?.provider, device?.source, device?.xaddr, device?.rtsp_url, device?.stream_protocol, device?.protocol]
    .map((item) => String(item || "").toLowerCase())
    .join(" ");
  return Boolean(device?.xaddr || device?.rtsp_url || text.includes("camera") || text.includes("onvif") || text.includes("rtsp") || text.includes("hikvision") || text.includes("dahua") || text.includes("uniview") || text.includes("mjpeg") || text.includes("snapshot"));
}

async function safeInsert(table: string, row: Record<string, any>) {
  const { data, error } = await supabaseAdmin.from(table).insert(row as any).select("*").maybeSingle();
  if (error) return { ok: false, table, error: error.message, data: null };
  return { ok: true, table, error: "", data };
}

async function upsertEdgeNode(payload: any, _status: string) {
  const estateId = asString(payload.site_id || payload.estate_id);
  const edgeNodeId = asString(payload.agent_id || payload.edge_node_id);
  if (!estateId || !edgeNodeId) return { ok: false, error: "site_id and agent_id required" };

  const row = {
    estate_id: estateId,
    edge_node_id: edgeNodeId,
    name: asString(payload.name || edgeNodeId),
    local_runtime_host: asString(payload.local_runtime_host || payload.local_host) || null,
    camera_count: asNumber(payload.camera_count, 0),
    device_count: asNumber(payload.device_count, 0),
    metadata: {
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
      runtime: safeMeta(payload.runtime),
      source: "edge_agent",
    },
    updated_at: nowIso(),
  };

  const { data: existing } = await supabaseAdmin
    .from("edge_nodes")
    .select("id,metadata")
    .eq("estate_id", estateId)
    .eq("edge_node_id", edgeNodeId)
    .maybeSingle();

  if (existing?.id) {
    row.metadata = { ...existing.metadata, ...row.metadata };
    const { data, error } = await supabaseAdmin.from("edge_nodes").update(row as any).eq("id", existing.id).select("*").maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  const { data, error } = await supabaseAdmin.from("edge_nodes").insert(row as any).select("*").maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

async function persistCameraPlaceholder(siteId: string, agentId: string, rawDevice: any) {
  const device = sanitizeDevice(rawDevice);
  const ip = asString(device.ip || device.host || device.address);
  const cameraId = asString(device.camera_id || device.id || device.external_id || ip);
  if (!cameraId) return { ok: false, table: "facility_cameras", error: "Stable camera identity required", data: null };
  const provider = normalizeProvider(device.provider || (String(device.xaddr || "").includes("onvif") ? "onvif" : "generic_rtsp"));
  const protocol = normalizeProtocol(device.protocol || device.stream_protocol || (String(device.xaddr || "").includes("onvif") ? "onvif" : "rtsp"));
  const channel = asString(device.channel || device.channel_id || "1");

  const row = {
    estate_id: siteId,
    camera_id: cameraId,
    name: asString(device.name || device.label || `Camera ${ip || cameraId}`),
    location: asString(device.location || device.zone || "") || null,
    ip: ip || null,
    onvif_port: device.onvif_port ? asNumber(device.onvif_port, 8080) : null,
    stream_protocol: protocol,
    provider,
    rtsp_url: asString(device.rtsp_url) || null,
    edge_hls_url: asString(device.edge_hls_url || device.hls_url) || null,
    onvif_supported: Boolean(device.xaddr || device.onvif_supported),
    ai_enabled: Boolean(device.ai_enabled),
    status: asString(device.status || "pending"),
    last_seen_at: nowIso(),
    health_status: asString(device.health_status || "pending_stream_details"),
    metadata: {
      provider,
      protocol,
      edge_node_id: agentId,
      nvr_id: asString(device.nvr_id || device.dvr_nvr_ref) || null,
      channel,
      rtsp_path_template: asString(device.rtsp_path_template || "/Streaming/Channels/{channel}01") || null,
      credential_ref: device.credential_ref || null,
      credentials_present: Boolean(device.credentials_present),
      xaddr: asString(device.xaddr) || null,
      source: asString(device.source || "edge_discovery"),
      raw: safeMeta(device),
    },
    updated_at: nowIso(),
  };

  if (ip) {
    const { data: existing } = await supabaseAdmin
      .from("facility_cameras")
      .select("id")
      .eq("estate_id", siteId)
      .eq("ip", ip)
      .maybeSingle();
    if (existing?.id) {
      const { data, error } = await supabaseAdmin.from("facility_cameras").update(row as any).eq("id", existing.id).select("*").maybeSingle();
      if (error) return { ok: false, table: "facility_cameras", error: error.message, data: null };
      return { ok: true, table: "facility_cameras", error: "", data };
    }
  }

  const { data, error } = await supabaseAdmin.from("facility_cameras").insert(row as any).select("*").maybeSingle();
  if (error) return { ok: false, table: "facility_cameras", error: error.message, data: null };
  return { ok: true, table: "facility_cameras", error: "", data };
}

async function persistDiscoveredDevice(siteId: string, agentId: string, rawDevice: any) {
  const device = sanitizeDevice(rawDevice);
  const externalId = asString(device.id || device.external_id || device.camera_id || device.ip);
  if (!externalId) return { ok: false, table: "discovered_devices", error: "Stable device identity required", data: null };
  return safeInsert("discovered_devices", {
    estate_id: siteId,
    edge_node_id: agentId,
    external_id: externalId,
    provider: normalizeProvider(device.provider || device.source || "other"),
    category: isCamera(device) ? "camera" : asString(device.category || "device"),
    name: asString(device.name || device.label || externalId),
    ip: asString(device.ip || device.host || device.address) || null,
    status: asString(device.status || "pending"),
    credential_ref: asString(device.credential_ref) || null,
    metadata: { ...safeMeta(device), protocol: normalizeProtocol(device.protocol || device.stream_protocol || (isCamera(device) ? "rtsp" : "")) },
    last_seen_at: nowIso(),
  });
}

async function persistCameraCandidate(siteId: string, agentId: string, commandId: string, rawCandidate: any, homeId?: string | null) {
  const normalized = sanitizeDiscoveryCandidate(rawCandidate);
  if (!normalized.ok) return { ok:false, table:"discovered_devices", error:normalized.error, data:null };
  const candidate = normalized.privateCandidate;
  const row = {
    estate_id:siteId, home_id:homeId || null, edge_node_id:agentId, external_id:candidate.fingerprint,
    discovery_fingerprint:candidate.fingerprint, discovery_state:"discovered", discovery_command_id:commandId,
    provider:candidate.provider, category:"camera", name:[candidate.manufacturer,candidate.model].filter(Boolean).join(" ") || "ONVIF Camera",
    ip:candidate.ipAddress, status:candidate.requiresAuthentication ? "authentication_required" : "discovered",
    capabilities:candidate.capabilities, credential_ref:null, last_seen_at:nowIso(), discovered_at:candidate.discoveredAt,
    metadata:{ fingerprint_strength:candidate.fingerprintStrength, manufacturer:candidate.manufacturer, model:candidate.model, serial_number:candidate.serialNumber, firmware_version:candidate.firmwareVersion, hostname:candidate.hostname, onvif_port:candidate.onvifPort, onvif_available:candidate.onvifAvailable, rtsp_available:candidate.rtspAvailable, requires_authentication:candidate.requiresAuthentication, profiles:candidate.profiles, endpoint_uuid:candidate.endpointUuid, source:"edge_camera_gateway" },
    updated_at:nowIso(),
  };
  const { data:existing } = await supabaseAdmin.from("discovered_devices").select("id,canonical_camera_id,discovery_state").eq("estate_id",siteId).eq("edge_node_id",agentId).eq("discovery_fingerprint",candidate.fingerprint).maybeSingle();
  if (existing?.id) { const {data,error}=await supabaseAdmin.from("discovered_devices").update({...row,canonical_camera_id:existing.canonical_camera_id,discovery_state:existing.canonical_camera_id?"provisioned":existing.discovery_state === "ignored" ? "ignored" : "discovered"} as any).eq("id",existing.id).select("*").maybeSingle(); return {ok:!error,table:"discovered_devices",error:error?.message || "",data}; }
  const {data,error}=await supabaseAdmin.from("discovered_devices").insert(row as any).select("*").maybeSingle(); return {ok:!error,table:"discovered_devices",error:error?.message || "",data};
}

async function pendingEdgeCommands(siteId: string, agentId: string) {
  const now=nowIso();
  await supabaseAdmin.from("edge_commands").update({status:"expired",updated_at:now}).eq("estate_id",siteId).eq("edge_node_id",agentId).in("status",["pending","delivered"]).lte("expires_at",now);
  const {data,error}=await supabaseAdmin.from("edge_commands").select("*").eq("estate_id",siteId).eq("edge_node_id",agentId).in("status",["pending","delivered"]).gt("expires_at",now).order("created_at",{ascending:true}).limit(10);
  if(error)return[];
  const rows=data||[]; if(rows.length)await supabaseAdmin.from("edge_commands").update({status:"delivered",delivered_at:now,updated_at:now}).in("id",rows.map((row:any)=>row.id)).eq("estate_id",siteId).eq("edge_node_id",agentId);
  return rows.map((row:any)=>({id:row.id,type:row.command_type,siteId:row.estate_id,edgeNodeId:row.edge_node_id,createdAt:row.created_at,expiresAt:row.expires_at,payload:row.payload}));
}

function emitEdgeSignal(type: string, payload: any) {
  // Compatibility status/configuration writes do not announce operational health.
  // The transition outbox is the only factual camera-health producer.
  if (type === "camera.status.updated") return;
  const signal = makeBaseSignal({
    type,
    ...(type === "edge.heartbeat" ? { timestamp: payload.ts } : {}),
    source: "edge_agent",
    estateId: asString(payload.site_id || payload.estate_id) || undefined,
    homeId: asString(payload.home_id || payload.homeId) || undefined,
    edgeNodeId: asString(payload.agent_id || payload.edge_node_id),
    status: payload.status || payload.health_status,
    metadata: safeMeta(payload),
  } as any);
  // Heartbeat is an observation, not a durable connectivity transition. Without
  // an ordered transactional signal outbox, concurrent responses may arrive out
  // of order; do not let ambient ingress manufacture restoration/incidents.
  if (type === "edge.heartbeat") emitSignalSafely(signal, { skipCanonicalIngress: true });
  else emitSignal(signal);
}

edgeDiscoveryRouter.post("/edge/agent/register", requireEdgeToken, async (req, res) => {
  const payload = req.body || {};
  const { siteId, agentId } = boundEdgeContext(req, payload);
  if (!siteId || !agentId) return res.status(400).json({ error: "site_id and agent_id required" });

  const node = await upsertEdgeNode({ ...payload, site_id: siteId, agent_id: agentId, camera_count: asNumber(payload.camera_count, 0), device_count: asNumber(payload.device_count, 0) }, "online");
  await safeInsert("deployment_milestones", {
    estate_id: siteId,
    milestone_type: "edge.agent.registered",
    title: `Edge agent ${agentId} registered`,
    status: node.ok ? "completed" : "failed",
    metadata: { agent_id: agentId, persistence: node.ok ? "stored" : node.error },
  });
  void emitAuditEvent({
    actorId: agentId,
    actorEmail: "edge-agent@oyi.local",
    actorRole: "edge_agent",
    action: "edge.agent.registered",
    resourceType: "edge_agent",
    resourceId: agentId,
    estateId: siteId,
    status: node.ok ? "success" : "failed",
    metadata: { persistence: node.ok ? "stored" : node.error },
    req,
  } as any);

  return res.status(node.ok ? 200 : 202).json({ ok: node.ok, site_id: siteId, agent_id: agentId, persistence: node.ok ? "stored" : "missing_source", error: node.ok ? undefined : node.error });
});

edgeDiscoveryRouter.post("/edge/agent/heartbeat", requireEdgeToken, async (req, res) => {
  const payload = req.body || {};
  const { siteId, agentId } = boundEdgeContext(req, payload);
  if (!siteId || !agentId) return res.status(400).json({ error: "site_id and agent_id required" });

  try {
    const result = await ingestEdgeHeartbeat((req as any).edgeAgent, payload);
    // Only a fresh, newly accepted observation can enter the existing Edge
    // operational channel. Replay and delayed history cannot fabricate recovery.
    if (result.accepted && result.current_state.freshness === "fresh") {
      emitEdgeSignal("edge.heartbeat", { site_id: siteId, agent_id: agentId,
        status: result.current_state.connectivity, ts: result.current_state.observedAt,
        current_state: result.current_state });
    }
    return res.json({ ok: true, site_id: siteId, agent_id: agentId, persistence: "stored", details: result });
  } catch (error: any) {
    const message = String(error?.message || "heartbeat_persistence_failed");
    const status = /identity/.test(message) ? 403 : /observed_at|invalid_observation/.test(message) || String(error?.code || "").startsWith("22") ? 400 : 503;
    return res.status(status).json({ ok: false, error: status === 503 ? "heartbeat_persistence_failed" : message });
  }
});

edgeDiscoveryRouter.get("/edge/agent/config", requireEdgeToken, async (req, res) => {
  const { siteId, agentId } = boundEdgeContext(req, req.query);
  if (!siteId || !agentId) return res.status(400).json({ error: "site_id and agent_id required" });

  const commands = await pendingEdgeCommands(siteId, agentId);
  return res.json({
    HEARTBEAT_INTERVAL_MS: expectedEdgeHeartbeatInterval(),
    DISCOVERY_INTERVAL_MS: asNumber(process.env.EDGE_DISCOVERY_INTERVAL_MS, 120_000),
    CONFIG_PULL_INTERVAL_MS: asNumber(process.env.EDGE_CONFIG_PULL_INTERVAL_MS, 180_000),
    QUEUE_FLUSH_INTERVAL_MS: asNumber(process.env.EDGE_QUEUE_FLUSH_INTERVAL_MS, 5_000),
    camera_registry: {
      credential_policy: "local_only",
      stream_manager: "go2rtc_external_service",
      hls_registration: "edge_hls_url",
      supported_providers: Array.from(SUPPORTED_CAMERA_PROVIDERS),
      supported_protocols: Array.from(SUPPORTED_CAMERA_PROTOCOLS),
    },
    commands,
  });
});

edgeDiscoveryRouter.post("/edge/discovery/push", requireEdgeToken, async (req, res) => {
  const { devices } = req.body || {};
  const { siteId, agentId } = boundEdgeContext(req, req.body || {});

  if (!siteId || !agentId || !Array.isArray(devices)) {
    return res.status(400).json({ error: "site_id, agent_id, devices[] required" });
  }

  const sanitized = devices.map((device: any) => ({ ...sanitizeDevice(device), agent_id: agentId, last_seen_at: nowIso() }));
  store[siteId] = sanitized;

  const node = await upsertEdgeNode({ site_id: siteId, agent_id: agentId, camera_count: sanitized.filter(isCamera).length, device_count: sanitized.length, sync_status: "discovery_received" }, "online");
  const persisted = [] as any[];
  for (const device of sanitized) {
    const discovered = await persistDiscoveredDevice(siteId, agentId, device);
    persisted.push(discovered);
    // Legacy pushes remain candidate-only. Canonical camera creation requires
    // an explicit authorized provisioning action.
  }

  await safeInsert("deployment_milestones", {
    estate_id: siteId,
    milestone_type: "edge.discovery.received",
    title: `Edge discovery received from ${agentId}`,
    status: "completed",
    metadata: { agent_id: agentId, count: sanitized.length, persisted: persisted.filter((item) => item.ok).length },
  });

  void emitAuditEvent({
    actorId: String((req as any).edgeAgent?.id || agentId),
    actorEmail: "edge-agent@oyi.local",
    actorRole: "edge_agent",
    action: "edge.discovery.received",
    resourceType: "edge_agent",
    resourceId: agentId,
    estateId: siteId,
    status: "success",
    metadata: { site_id: siteId, agent_id: agentId, count: sanitized.length, persistence: persisted },
    req,
  } as any);

  return res.json({
    ok: true,
    site_id: siteId,
    count: sanitized.length,
    persisted: persisted.filter((item) => item.ok).length,
    missing_sources: persisted.filter((item) => !item.ok).map((item) => ({ table: item.table, reason: item.error })),
    edge_node: node.ok ? "stored" : { available: false, reason: node.error, required_source: "edge_nodes" },
  });
});

edgeDiscoveryRouter.get("/edge/camera-observation-registry", requireCameraEdgeToken, async (req, res) => {
  const identity = (req as any).edgeAgent;
  const {data,error} = await supabaseAdmin.from("facility_cameras").select("id,camera_id,ip,edge_node_id,status")
    .eq("estate_id",identity.siteId).eq("edge_node_id",identity.id).limit(1000);
  if (error) return res.status(503).json({error:"camera_registry_unavailable"});
  return res.json({site_id:identity.siteId,edge_node_id:identity.id,cameras:(data||[]).map((camera:any)=>({canonical_camera_id:camera.id,
    stream_id:String(camera.camera_id||camera.id).replace(/[^a-zA-Z0-9_-]+/g,"_"),host:camera.ip||null,enabled:camera.status!=="disabled"}))});
});

edgeDiscoveryRouter.post("/edge/camera-observations", requireCameraEdgeToken, async (req, res) => {
  try {
    // Reserved for Backend-verified persisted media repair, not Edge assertions.
    if (Array.isArray(req.body?.observations) && req.body.observations.some((item:any)=>item?.source==="media_ingestion"))
      return res.status(400).json({error:"camera_observation_source_reserved"});
    const result = await ingestCameraObservations((req as any).edgeAgent,req.body?.observations);
    return res.json(result);
  } catch (error:any) {
    const denied = error?.code === "42501" || /assignment|identity/.test(String(error?.message));
    const invalid = String(error?.code||"").startsWith("22") || /batch_invalid/.test(String(error?.message));
    return res.status(denied?403:invalid?400:503).json({error:denied?"camera_assignment_denied":invalid?"camera_observation_invalid":"camera_observation_unavailable"});
  }
});

edgeDiscoveryRouter.post("/edge/cameras/:cameraId/stream-health", requireCameraEdgeToken, async (req, res) => {
  const cameraId = asString(req.params.cameraId);
  const payload = req.body || {};
  const { siteId, agentId } = boundEdgeContext(req, payload);
  const status = asString(payload.status || payload.stream_status || "pending");
  if (!cameraId || !siteId || !agentId) return res.status(400).json({ error: "cameraId, site_id and agent_id required" });

  const update = {
    status,
    health_status: asString(payload.health_status || status),
    last_seen_at: status === "online" ? nowIso() : undefined,
    last_health_check_at: nowIso(),
    last_success_at: payload.last_success_at || (status === "online" ? nowIso() : undefined),
    last_failure_at: payload.last_failure_at || (status === "online" ? undefined : nowIso()),
    latency_ms: Number.isFinite(Number(payload.latency_ms)) ? Number(payload.latency_ms) : undefined,
    reconnect_count: Number.isFinite(Number(payload.reconnect_count)) ? Number(payload.reconnect_count) : undefined,
    provider_error: asString(payload.provider_error || payload.error_message) || null,
    edge_hls_url: asString(payload.edge_hls_url || payload.hls_url) || undefined,
    metadata: {
      edge_node_id: agentId,
      stream_status: status,
      provider: normalizeProvider(payload.provider),
      protocol: normalizeProtocol(payload.protocol || payload.stream_protocol),
      hls_url: asString(payload.hls_url || payload.edge_hls_url) || null,
      last_success_at: payload.last_success_at || null,
      last_failure_at: payload.last_failure_at || null,
      latency_ms: payload.latency_ms ?? null,
      reconnect_count: payload.reconnect_count ?? 0,
      provider_error: asString(payload.provider_error || payload.error_message) || null,
      updated_by: "edge_agent",
    },
    updated_at: nowIso(),
  } as any;
  Object.keys(update).forEach((key) => update[key] === undefined && delete update[key]);

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cameraId);
  const matchers = uuidLike ? ["id", "camera_id", "ip"] : ["camera_id", "ip"];

  // Canonical identity and existing metadata are needed for assignment/scope
  // validation and compatibility CAS writes, not health classification.
  let priorCamera: any = null;
  for (const field of matchers) {
    const result = await supabaseAdmin
      .from("facility_cameras")
      .select(`${CAMERA_ACCESS_SELECT},status,health_status,name,updated_at`)
      .eq("estate_id", siteId)
      .eq("edge_node_id", agentId)
      .eq(field, cameraId)
      .maybeSingle();
    if (result.error) return res.status(503).json({ error: "camera_scope_unavailable" });
    if (result.data) {
      priorCamera = result.data;
      break;
    }
  }

  if (!priorCamera) return res.status(403).json({ error: "camera_assignment_denied" });
  // Preserve Backend-owned legacy scope/config and other observation fields.
  // Only the explicit observation allowlist above is writable by Edge. CAS
  // prevents a concurrent rebind/privacy edit being replaced by this snapshot.
  update.metadata = { ...(priorCamera.metadata || {}), ...update.metadata };
  let write = supabaseAdmin.from("facility_cameras").update(update)
    .eq("estate_id", siteId).eq("edge_node_id", agentId).eq("id", priorCamera.id);
  write = priorCamera.updated_at ? write.eq("updated_at", priorCamera.updated_at) : write.is("updated_at", null);
  const { data, error } = await write.select("*").maybeSingle();
  if (error) return res.status(503).json({ error: "camera_update_unavailable" });
  if (!data) return res.status(409).json({ error: "camera_changed_retry" });

  // No error-text tamper/recorder inference and no legacy-string transition.

  return res.status(200).json({
    ok: true,
    camera: data,
    persistence: "stored",
  });
});

edgeDiscoveryRouter.post("/edge/cameras/:cameraId/events", requireCameraEdgeToken, async (req, res) => {
  const cameraRef = asString(req.params.cameraId);
  const payload = req.body || {};
  const { siteId, agentId } = boundEdgeContext(req, payload);
  const eventType = asString(payload.event_type || payload.type).toLowerCase();
  if (!cameraRef || !siteId || !agentId || !eventType) {
    return res.status(400).json({ error: "cameraId, site_id, agent_id and event_type required" });
  }

  let camera: any = null;
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cameraRef);
  const matchers = uuidLike ? ["id", "camera_id", "ip"] : ["camera_id", "ip"];
  for (const field of matchers) {
    const { data } = await supabaseAdmin
      .from("facility_cameras")
      .select(`${CAMERA_ACCESS_SELECT},name,camera_id,ip,edge_node_id`)
      .eq("estate_id", siteId)
      .eq("edge_node_id", agentId)
      .eq(field, cameraRef)
      .maybeSingle();
    if (data) {
      camera = data;
      break;
    }
  }
  if (!camera?.id) return res.status(404).json({ error: "Camera not found" });

  const confidenceRaw = Number(payload.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : null;
  const coreEvent = normalizeIntelligenceEvent({
    agent_id: "camera",
    surface: "edge",
    actor_id: agentId,
    estate_id: String(camera.estate_id || siteId),
    camera_id: String(camera.id),
    event_type: eventType,
    category: "Camera",
    title: asString(payload.title || `${eventType.replace(/_/g, " ")} detected`),
    summary: asString(payload.message || payload.summary || `${eventType.replace(/_/g, " ")} detected on ${camera.name || "camera"}`),
    confidence: confidence !== null && confidence >= 0.8 ? "confirmed" : confidence !== null && confidence >= 0.5 ? "probable" : "possible",
    source: "edge_camera_ai",
    metadata: {
      edge_node_id: agentId,
      camera_ref: cameraRef,
      detector: safeMeta(payload.detector || {}),
      detections: Array.isArray(payload.detections) ? payload.detections.slice(0, 20).map(safeMeta) : [],
      source_metadata: safeMeta(payload.metadata || {}),
    },
    occurred_at: asString(payload.occurred_at) || nowIso(),
  });

  const { data, error } = await supabaseAdmin
    .from("camera_events")
    .insert({
      camera_id: camera.id,
      estate_id: camera.estate_id,
      event_type: eventType,
      confidence,
      snapshot_url: asString(payload.snapshot_url) || null,
      message: asString(payload.message || coreEvent.summary) || null,
      source_timestamp: asString(payload.source_timestamp || payload.occurred_at) || null,
      metadata: {
        ...safeMeta(payload.metadata || {}),
        source: "edge_camera_ai",
        edge_node_id: agentId,
        core_event: coreEvent,
        detections: Array.isArray(payload.detections) ? payload.detections.slice(0, 20).map(safeMeta) : [],
      },
      created_by: null,
    } as any)
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const bus = await publishIntelligenceEvent(coreEvent, {
    source_table: "camera_events",
    source_event_id: String(data?.id || ""),
  });

  emitEdgeSignal("camera.event", {
    site_id: siteId,
    home_id: cameraHomeId(camera) || null,
    agent_id: agentId,
    camera_id: camera.id,
    camera_ref: cameraRef,
    event_type: eventType,
    confidence,
    event_id: data?.id,
  });

  return res.json({ ok: true, event: data, intelligence_event: coreEvent, intelligence_bus: bus });
});

edgeDiscoveryRouter.post("/edge/cameras/:cameraId/media",requireCameraEdgeToken,async(req,res)=>{const {siteId,agentId}=boundEdgeContext(req,req.body||{});const cameraId=asString(req.params.cameraId);if(!siteId||!agentId||!cameraId)return res.status(400).json({error:"media_upload_failed"});const result=await ingestEdgeMedia({cameraId,siteId,nodeId:agentId,kind:asString(req.body?.kind),mimeType:asString(req.body?.mime_type),base64:asString(req.body?.data_base64),capturedAt:asString(req.body?.captured_at)||undefined,durationMs:Number.isFinite(Number(req.body?.duration_ms))?Number(req.body.duration_ms):undefined,eventId:asString(req.body?.event_id)||undefined,idempotencyKey:asString(req.body?.idempotency_key),retention:req.body?.retention_class,metadata:safeMeta(req.body?.metadata)});if(!result.ok){console.warn(JSON.stringify({event:"camera_media.ingest_rejected",site_id:siteId,edge_node_id:agentId,camera_id:cameraId,code:result.code}));return res.status(result.code==="media_access_denied"?403:result.code==="camera_observation_unavailable"?503:400).json({error:result.code});}emitEdgeSignal("camera.media.created",{site_id:siteId,home_id:result.media.home_id,agent_id:agentId,camera_id:cameraId,media_id:result.media.id,event_id:asString(req.body?.event_id)||null,kind:result.media.kind,captured_at:result.media.captured_at});return res.status(result.created?201:200).json({ok:true,created:result.created,reference:result.reference});});

edgeDiscoveryRouter.post("/edge/cameras/:cameraId/detections",requireCameraEdgeToken,async(req,res)=>{const {siteId,agentId}=boundEdgeContext(req,req.body||{});const cameraId=asString(req.params.cameraId);if(!siteId||!agentId||!cameraId)return res.status(400).json({error:"invalid_detection_payload"});const result=await ingestEdgeDetections({cameraId,siteId,nodeId:agentId,provider:asString(req.body?.provider),model:asString(req.body?.model)||undefined,modelVersion:asString(req.body?.model_version)||undefined,detections:Array.isArray(req.body?.detections)?req.body.detections:[],mediaId:asString(req.body?.media_id)||undefined});if(!result.ok){console.warn(JSON.stringify({event:"camera_detection.ingest_rejected",site_id:siteId,edge_node_id:agentId,camera_id:cameraId,code:result.code}));return res.status(result.code==="detection_access_denied"?403:400).json({error:result.code});}emitEdgeSignal("camera.event",{site_id:siteId,agent_id:agentId,camera_id:cameraId,event_id:result.event?.id||null,detection_count:result.detections.length});return res.status(201).json({ok:true,eventId:result.event?.id||null,detections:result.detections.map((row:any)=>({id:row.id,type:row.detection_type,observedAt:row.observed_at})),evidence:result.evidence});});

edgeDiscoveryRouter.post("/edge/camera-discovery/commands", requireAuth, requirePermission("cameras.manage"), async (req, res) => {
  const user=(req as any).user; const estateId=asString(req.body?.estateId || user?.estate_id); const edgeNodeId=asString(req.body?.edgeNodeId); const surface=asString(req.body?.surface || "facility"); const homeId=asString(req.body?.homeId || user?.home_id) || null;
  if(!estateId||!edgeNodeId)return res.status(400).json({error:"estateId and edgeNodeId are required"});
  if(String(user?.role||"").toLowerCase()!=="admin"&&asString(user?.estate_id)!==estateId)return res.status(403).json({error:"Permission denied"});
  const request=validateDiscoveryRequest(req.body||{}); if(!request.ok)return res.status(400).json({error:request.error});
  const {data:node}=await supabaseAdmin.from("edge_nodes").select("edge_node_id,estate_id,heartbeat_status,metadata").eq("estate_id",estateId).eq("edge_node_id",edgeNodeId).maybeSingle();
  if(!node)return res.status(409).json({error:"edge_unreachable"});
  if(surface==="consumer"){
    const allowed=homeId&&asString(user?.home_id)===homeId&&node.metadata?.consumer_discovery_enabled===true;
    if(!allowed)return res.status(403).json({error:"scope_conflict"});
  }
  const id=randomUUID(); const expiresAt=new Date(Date.now()+Math.min(120_000,request.timeoutMs+60_000)).toISOString();
  const payload={requestId:id,mode:request.mode,cidr:request.cidr,timeoutMs:request.timeoutMs,credentialRef:asString(req.body?.credentialRef)||null,requestedBy:{userId:user?.id,surface}};
  const {data,error}=await supabaseAdmin.from("edge_commands").insert({id,estate_id:estateId,home_id:surface==="consumer"?homeId:null,edge_node_id:edgeNodeId,command_type:"camera.discovery",status:"pending",payload,requested_by:user?.id||null,requested_surface:surface,expires_at:expiresAt} as any).select("id,status,created_at,expires_at").single();
  if(error)return res.status(500).json({error:"discovery_command_unavailable"});
  void emitAuditEvent({actorId:user?.id,actorEmail:user?.email,actorRole:user?.role,action:"camera.discovery.requested",resourceType:"edge_command",resourceId:id,estateId,status:"success",metadata:{edge_node_id:edgeNodeId,mode:request.mode,surface},req} as any);
  emitEdgeSignal("camera.discovery.updated",{site_id:estateId,agent_id:edgeNodeId,status:"pending",command_id:id});
  return res.status(202).json({ok:true,command:{id:data.id,status:data.status,createdAt:data.created_at,expiresAt:data.expires_at}});
});

edgeDiscoveryRouter.post("/edge/commands/:commandId/ack", requireEdgeToken, async (req,res)=>{
  const {siteId,agentId}=boundEdgeContext(req,req.body||{}); const commandId=asString(req.params.commandId); const now=nowIso();
  const {data:command}=await supabaseAdmin.from("edge_commands").select("id,status,expires_at").eq("id",commandId).eq("estate_id",siteId).eq("edge_node_id",agentId).maybeSingle();
  if(!command)return res.status(404).json({error:"camera_not_found"}); if(Date.parse(command.expires_at)<=Date.now())return res.status(409).json({error:"expired_command"}); if(!["pending","delivered","running"].includes(command.status))return res.status(409).json({error:"command_replay"});
  const {error}=await supabaseAdmin.from("edge_commands").update({status:"running",acknowledged_at:now,updated_at:now}).eq("id",commandId).eq("estate_id",siteId).eq("edge_node_id",agentId);
  return res.status(error?500:200).json({ok:!error,commandId,status:"running"});
});

edgeDiscoveryRouter.post("/edge/commands/:commandId/complete", requireEdgeToken, async (req,res)=>{
  const {siteId,agentId}=boundEdgeContext(req,req.body||{}); const commandId=asString(req.params.commandId); const status=asString(req.body?.status)==="completed"?"completed":"failed"; const now=nowIso();
  const {data:command}=await supabaseAdmin.from("edge_commands").select("*").eq("id",commandId).eq("estate_id",siteId).eq("edge_node_id",agentId).maybeSingle();
  if(!command)return res.status(404).json({error:"camera_not_found"}); if(command.status!=="running")return res.status(409).json({error:"command_replay"}); if(Date.parse(command.expires_at)<=Date.now())return res.status(409).json({error:"expired_command"});
  const candidates=Array.isArray(req.body?.result?.candidates)?req.body.result.candidates.slice(0,256):[]; const persisted=[] as any[];
  if(status==="completed")for(const candidate of candidates)persisted.push(await persistCameraCandidate(siteId,agentId,commandId,candidate,command.home_id));
  const safeResult={requestId:command.payload?.requestId,candidateCount:candidates.length,persistedCount:persisted.filter((item)=>item.ok).length,media:req.body?.result?.media&&typeof req.body.result.media==="object"?safeMeta(req.body.result.media):null,startedAt:req.body?.result?.startedAt||null,completedAt:req.body?.result?.completedAt||now,durationMs:asNumber(req.body?.duration_ms??req.body?.result?.durationMs,0)};
  const errorCode=status==="failed"?safeGatewayError(req.body?.error?.code):null;
  const {error}=await supabaseAdmin.from("edge_commands").update({status,result:safeResult,error_code:errorCode,completed_at:now,updated_at:now}).eq("id",commandId).eq("estate_id",siteId).eq("edge_node_id",agentId);
  emitEdgeSignal("camera.discovery.updated",{site_id:siteId,home_id:command.home_id,agent_id:agentId,status,command_id:commandId,candidates_found:candidates.length,persisted:safeResult.persistedCount});
  return res.status(error?500:200).json({ok:!error,commandId,status,...safeResult,rejected:candidates.length-safeResult.persistedCount});
});

edgeDiscoveryRouter.get("/edge/camera-discovery/commands/:commandId", requireAuth, requirePermission("cameras.view"), async (req,res)=>{
  const user=(req as any).user; const {data}=await supabaseAdmin.from("edge_commands").select("id,estate_id,home_id,edge_node_id,status,created_at,expires_at,acknowledged_at,completed_at,result,error_code,requested_surface").eq("id",asString(req.params.commandId)).maybeSingle();
  if(!data)return res.status(404).json({error:"camera_not_found"}); if(String(user?.role||"").toLowerCase()!=="admin"&&asString(user?.estate_id)!==asString(data.estate_id))return res.status(403).json({error:"Permission denied"}); if(data.home_id&&asString(user?.home_id)!==asString(data.home_id)&&!hasPermission(user,"cameras.manage"))return res.status(403).json({error:"scope_conflict"});
  return res.json({ok:true,command:{id:data.id,edgeNodeId:data.edge_node_id,status:data.status,createdAt:data.created_at,expiresAt:data.expires_at,acknowledgedAt:data.acknowledged_at,completedAt:data.completed_at,result:data.result,error:data.error_code,surface:data.requested_surface}});
});

edgeDiscoveryRouter.get("/edge/camera-discovery/candidates", requireAuth, requirePermission("cameras.view"), async (req,res)=>{
  const user=(req as any).user; const estateId=asString(req.query.estateId||user?.estate_id); const requestedHomeId=asString(req.query.homeId); if(!estateId)return res.status(400).json({error:"estateId required"}); if(String(user?.role||"").toLowerCase()!=="admin"&&asString(user?.estate_id)!==estateId)return res.status(403).json({error:"Permission denied"});
  if(requestedHomeId && requestedHomeId!==asString(user?.home_id) && !hasPermission(user,"cameras.manage"))return res.status(403).json({error:"scope_conflict"});
  let query=supabaseAdmin.from("discovered_devices").select("*").eq("estate_id",estateId).eq("category","camera").order("last_seen_at",{ascending:false}).limit(500); if(requestedHomeId)query=query.eq("home_id",requestedHomeId); else if(!hasPermission(user,"cameras.manage"))query=query.eq("home_id",asString(user?.home_id));
  const {data,error}=await query; if(error)return res.status(500).json({error:"camera_candidates_unavailable"}); return res.json({ok:true,items:(data||[]).map(publicDiscoveryCandidate)});
});

edgeDiscoveryRouter.post("/edge/camera-discovery/candidates/:candidateId/provision", requireAuth, requirePermission("cameras.manage"), async (req,res)=>{
  const user=(req as any).user; const candidateId=asString(req.params.candidateId); const {data:candidate}=await supabaseAdmin.from("discovered_devices").select("*").eq("id",candidateId).eq("category","camera").maybeSingle();
  if(!candidate)return res.status(404).json({error:"camera_not_found"}); if(String(user?.role||"").toLowerCase()!=="admin"&&asString(user?.estate_id)!==asString(candidate.estate_id))return res.status(403).json({error:"Permission denied"});
  const scope=asString(req.body?.scope||"facility"); const homeId=scope==="home"?asString(req.body?.homeId):null; if(!["facility","home","office"].includes(scope))return res.status(400).json({error:"scope_conflict"}); if(scope==="home"&&(!homeId||asString(candidate.home_id)!==homeId))return res.status(409).json({error:"scope_conflict"}); if(scope!=="home"&&candidate.home_id)return res.status(409).json({error:"scope_conflict"});
  if(candidate.canonical_camera_id)return res.status(409).json({error:"duplicate_camera",cameraId:candidate.canonical_camera_id}); const {data:existing}=await supabaseAdmin.from("facility_cameras").select("id").eq("estate_id",candidate.estate_id).eq("discovery_fingerprint",candidate.discovery_fingerprint).maybeSingle(); if(existing?.id)return res.status(409).json({error:"duplicate_camera",cameraId:existing.id});
  const metadata=candidate.metadata||{}; const credentialRef=asString(req.body?.credentialRef); if(metadata.requires_authentication&&!credentialRef)return res.status(400).json({error:"camera_auth_failed"});
  const cameraMetadata={privacy_scope:scope,home_id:homeId,building_id:req.body?.buildingId||null,discovery_candidate_id:candidate.id,fingerprint_strength:metadata.fingerprint_strength,capabilities:candidate.capabilities||{}};
  const {data:camera,error}=await supabaseAdmin.from("facility_cameras").insert({estate_id:candidate.estate_id,zone_id:req.body?.zoneId||null,name:asString(req.body?.name||candidate.name||"Camera"),location:asString(req.body?.location)||null,ip:candidate.ip||null,onvif_port:metadata.onvif_port||null,onvif_supported:Boolean(metadata.onvif_available),provider:candidate.provider||"onvif",stream_protocol:"rtsp",credential_ref:credentialRef||null,edge_node_id:candidate.edge_node_id,discovery_fingerprint:candidate.discovery_fingerprint,status:"configured",stream_status:"pending",health_status:"configured",metadata:cameraMetadata,created_by:user?.id,updated_at:nowIso()} as any).select("id,estate_id,name,status,stream_status,edge_node_id,discovery_fingerprint,metadata").single();
  if(error)return res.status(409).json({error:/unique/i.test(error.message)?"duplicate_camera":"camera_provisioning_failed"}); await supabaseAdmin.from("discovered_devices").update({discovery_state:"provisioned",canonical_camera_id:camera.id,credential_ref:credentialRef||null,updated_at:nowIso()}).eq("id",candidate.id);
  emitEdgeSignal("camera.binding.changed",{site_id:candidate.estate_id,home_id:homeId,agent_id:candidate.edge_node_id,camera_id:camera.id,status:"configured"}); return res.status(201).json({ok:true,camera});
});

edgeDiscoveryRouter.get("/edge/discovery/:siteId", requireAuth, requirePermission("devices.read"), async (req, res) => {
  const siteId = req.params.siteId;
  const actorEstateId = asString((req as any).user?.estate_id);
  if (!actorEstateId || actorEstateId !== asString(siteId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { data, error } = await supabaseAdmin
    .from("discovered_devices")
    .select("*")
    .eq("estate_id", siteId)
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (!error) return res.json({ site_id: siteId, devices: data || [] });
  return res.json({ site_id: siteId, devices: store[siteId] || [], source: { available: false, reason: error.message, required_source: "discovered_devices" } });
});
