import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { requireEdgeToken } from "../middleware/edgeToken";
import { emitAuditEvent } from "../core/foundation";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitSignal, makeBaseSignal } from "../realtime/emitSignal";

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

function safeMeta(value: any) {
  if (!value || typeof value !== "object") return {};
  const { password, pass, secret, token, username, ...rest } = value;
  return rest;
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

async function upsertEdgeNode(payload: any, status: string) {
  const estateId = asString(payload.site_id || payload.estate_id);
  const edgeNodeId = asString(payload.agent_id || payload.edge_node_id);
  if (!estateId || !edgeNodeId) return { ok: false, error: "site_id and agent_id required" };

  const row = {
    estate_id: estateId,
    edge_node_id: edgeNodeId,
    name: asString(payload.name || edgeNodeId),
    heartbeat_status: status,
    last_seen_at: nowIso(),
    local_runtime_host: asString(payload.local_runtime_host || payload.local_host) || null,
    camera_count: asNumber(payload.camera_count, 0),
    device_count: asNumber(payload.device_count, 0),
    queue_depth: asNumber(payload.queue_depth ?? payload.outbox_depth, 0),
    sync_status: asString(payload.sync_status, "registered"),
    error_count: asNumber(payload.error_count, 0),
    runtime_version: asString(payload.runtime_version) || null,
    metadata: {
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
      runtime: safeMeta(payload.runtime),
      source: "edge_agent",
    },
    updated_at: nowIso(),
  };

  const { data: existing } = await supabaseAdmin
    .from("edge_nodes")
    .select("id")
    .eq("estate_id", estateId)
    .eq("edge_node_id", edgeNodeId)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabaseAdmin.from("edge_nodes").update(row as any).eq("id", existing.id).select("*").maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  const { data, error } = await supabaseAdmin.from("edge_nodes").insert(row as any).select("*").maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

async function recordHeartbeat(payload: any) {
  const estateId = asString(payload.site_id || payload.estate_id);
  const edgeNodeId = asString(payload.agent_id || payload.edge_node_id);
  const status = asString(payload.status || payload.heartbeat_status || "online");

  const node = await upsertEdgeNode(payload, status);
  if (!node.ok) return { ok: false, node, heartbeat: null };

  const heartbeat = await safeInsert("edge_heartbeats", {
    estate_id: estateId,
    edge_node_id: edgeNodeId,
    heartbeat_status: status,
    local_runtime_host: asString(payload.local_runtime_host || payload.local_host) || null,
    camera_count: asNumber(payload.camera_count, 0),
    device_count: asNumber(payload.device_count, 0),
    queue_depth: asNumber(payload.queue_depth ?? payload.outbox_depth, 0),
    sync_status: asString(payload.sync_status || "synced"),
    error_count: asNumber(payload.error_count, 0),
    runtime_version: asString(payload.runtime_version) || null,
    metadata: {
      ts: payload.ts || nowIso(),
      outbox_depth: asNumber(payload.outbox_depth, 0),
      source: "edge_agent",
    },
  });

  return { ok: heartbeat.ok, node, heartbeat };
}

async function persistCameraPlaceholder(siteId: string, agentId: string, rawDevice: any) {
  const device = sanitizeDevice(rawDevice);
  const ip = asString(device.ip || device.host || device.address);
  const cameraId = asString(device.camera_id || device.id || device.external_id || ip || `${agentId}-${Date.now()}`);
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
  const externalId = asString(device.id || device.external_id || device.camera_id || device.ip || `${agentId}-${Date.now()}`);
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

function emitEdgeSignal(type: string, payload: any) {
  emitSignal(makeBaseSignal({
    type,
    source: "edge_agent",
    estateId: asString(payload.site_id || payload.estate_id) || undefined,
    edgeNodeId: asString(payload.agent_id || payload.edge_node_id),
    status: payload.status || payload.health_status,
    metadata: safeMeta(payload),
  } as any));
}

edgeDiscoveryRouter.post("/edge/agent/register", requireEdgeToken, async (req, res) => {
  const payload = req.body || {};
  const siteId = asString(payload.site_id || payload.estate_id);
  const agentId = asString(payload.agent_id || payload.edge_node_id);
  if (!siteId || !agentId) return res.status(400).json({ error: "site_id and agent_id required" });

  const node = await upsertEdgeNode({ ...payload, camera_count: asNumber(payload.camera_count, 0), device_count: asNumber(payload.device_count, 0) }, "online");
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
  const siteId = asString(payload.site_id || payload.estate_id);
  const agentId = asString(payload.agent_id || payload.edge_node_id);
  if (!siteId || !agentId) return res.status(400).json({ error: "site_id and agent_id required" });

  const result = await recordHeartbeat(payload);
  emitEdgeSignal("edge.heartbeat", payload);
  void emitAuditEvent({
    actorId: agentId,
    actorEmail: "edge-agent@oyi.local",
    actorRole: "edge_agent",
    action: "edge.heartbeat",
    resourceType: "edge_agent",
    resourceId: agentId,
    estateId: siteId,
    status: result.ok ? "success" : "failed",
    metadata: { queue_depth: asNumber(payload.queue_depth ?? payload.outbox_depth, 0), persistence: result.ok ? "stored" : result.heartbeat?.error || result.node?.error },
    req,
  } as any);

  return res.status(result.ok ? 200 : 202).json({ ok: result.ok, site_id: siteId, agent_id: agentId, persistence: result.ok ? "stored" : "missing_source", details: result });
});

edgeDiscoveryRouter.get("/edge/agent/config", requireEdgeToken, async (req, res) => {
  const siteId = asString(req.query.site_id);
  const agentId = asString(req.query.agent_id || req.headers["x-edge-agent-id"]);
  if (!siteId || !agentId) return res.status(400).json({ error: "site_id and agent_id required" });

  return res.json({
    HEARTBEAT_INTERVAL_MS: asNumber(process.env.EDGE_HEARTBEAT_INTERVAL_MS, 30_000),
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
  });
});

edgeDiscoveryRouter.post("/edge/discovery/push", requireEdgeToken, async (req, res) => {
  const { site_id, agent_id, devices } = req.body || {};
  const siteId = asString(site_id);
  const agentId = asString(agent_id);

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
    if (isCamera(device)) {
      const camera = await persistCameraPlaceholder(siteId, agentId, device);
      persisted.push(camera);
      if (camera.ok) {
        emitEdgeSignal("camera.status.updated", {
          site_id: siteId,
          agent_id: agentId,
          camera_id: camera.data?.id || device.camera_id || device.ip,
          status: device.status || "pending",
          health_status: device.health_status || "pending_stream_details",
        });
      }
    }
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

edgeDiscoveryRouter.post("/edge/cameras/:cameraId/stream-health", requireEdgeToken, async (req, res) => {
  const cameraId = asString(req.params.cameraId);
  const payload = req.body || {};
  const siteId = asString(payload.site_id || payload.estate_id);
  const agentId = asString(payload.agent_id || payload.edge_node_id);
  const status = asString(payload.status || payload.stream_status || "pending");
  if (!cameraId || !siteId || !agentId) return res.status(400).json({ error: "cameraId, site_id and agent_id required" });

  const update = {
    status,
    health_status: asString(payload.health_status || status),
    last_seen_at: status === "online" ? nowIso() : undefined,
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

  let data: any = null;
  let error: any = null;
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cameraId);
  const matchers = uuidLike ? ["id", "camera_id", "ip"] : ["camera_id", "ip"];
  for (const field of matchers) {
    const result = await supabaseAdmin
      .from("facility_cameras")
      .update(update)
      .eq("estate_id", siteId)
      .eq(field, cameraId)
      .select("*")
      .maybeSingle();
    if (result.data || !result.error) {
      data = result.data;
      error = result.error;
      if (data) break;
    } else {
      error = result.error;
    }
  }

  emitEdgeSignal("camera.status.updated", { ...payload, site_id: siteId, agent_id: agentId, camera_id: cameraId, status });

  return res.status(error ? 202 : 200).json({
    ok: !error,
    camera: data || null,
    persistence: error ? { available: false, reason: error.message, required_source: "facility_cameras" } : "stored",
  });
});

edgeDiscoveryRouter.get("/edge/discovery/:siteId", requireAuth, requirePermission("devices.read"), async (req, res) => {
  const siteId = req.params.siteId;
  const { data, error } = await supabaseAdmin
    .from("discovered_devices")
    .select("*")
    .eq("estate_id", siteId)
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (!error) return res.json({ site_id: siteId, devices: data || [] });
  return res.json({ site_id: siteId, devices: store[siteId] || [], source: { available: false, reason: error.message, required_source: "discovered_devices" } });
});
