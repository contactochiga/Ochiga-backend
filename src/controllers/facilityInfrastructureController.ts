import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { getTuyaUidForUser, syncTuyaRegistryForActor } from "../services/tuyaRegistrySyncService";

function clean(value: any, fallback = "") {
  return String(value ?? fallback).trim();
}

function safeArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function sanitizeMetadata(value: any, depth = 0): any {
  if (value == null || depth > 4) return {};
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeMetadata(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(pass(word)?|secret|token|credential|access[_-]?id|access[_-]?secret|api[_-]?key|private[_-]?key)/i.test(key))
      .map(([key, nested]) => [key, nested && typeof nested === "object" ? sanitizeMetadata(nested, depth + 1) : nested])
  );
}

async function safeSelect(table: string, query: (builder: any) => any) {
  try {
    const result = await query(supabaseAdmin.from(table).select("*"));
    if (result.error) return { data: [], source: { available: false, reason: result.error.message, required_source: table } };
    return { data: result.data || [], source: { available: true } };
  } catch (error: any) {
    return { data: [], source: { available: false, reason: error?.message || "Source unavailable", required_source: table } };
  }
}

function deviceStatus(device: any) {
  const status = clean(device?.status).toLowerCase();
  if (device?.is_managed_disabled === true || status === "error") return "error";
  if (!device?.home_id) return "pending_assignment";
  if (device?.online === true || ["active", "online", "ok"].includes(status)) return "online";
  if (device?.online === false || ["offline", "down", "unavailable"].includes(status)) return "offline";
  return "unknown";
}

function locationFor(device: any, homes: Map<string, any>, rooms: Map<string, any>) {
  const home = homes.get(clean(device?.home_id));
  const room = rooms.get(clean(device?.room_id));
  return {
    home: home ? { id: home.id, name: home.name, unit: home.unit, block: home.block } : null,
    room: room ? { id: room.id, name: room.name } : null,
  };
}

export async function getFacilityInfrastructure(req: Request, res: Response) {
  const actor: any = (req as any).user;
  const estateId = clean(actor?.estate_id);
  if (!actor?.id) return res.status(401).json({ error: "Not authenticated" });
  if (!estateId) return res.status(400).json({ error: "Active estate context required" });

  const [devicesResult, homesResult, roomsResult, discoveredResult, edgeNodesResult, heartbeatResult, webhookResult, auditResult] =
    await Promise.all([
      safeSelect("devices", (query) => query.eq("estate_id", estateId).order("updated_at", { ascending: false }).limit(1000)),
      safeSelect("homes", (query) => query.eq("estate_id", estateId).order("name", { ascending: true }).limit(1000)),
      safeSelect("rooms", (query) => query.eq("estate_id", estateId).order("name", { ascending: true }).limit(2000)),
      safeSelect("discovered_devices", (query) => query.eq("estate_id", estateId).order("last_seen_at", { ascending: false }).limit(500)),
      safeSelect("edge_nodes", (query) => query.eq("estate_id", estateId).order("last_seen_at", { ascending: false }).limit(100)),
      safeSelect("edge_heartbeats", (query) => query.eq("estate_id", estateId).order("received_at", { ascending: false }).limit(100)),
      safeSelect("provider_webhook_events", (query) => query.eq("related_estate_id", estateId).order("received_at", { ascending: false }).limit(100)),
      safeSelect("audit_events", (query) =>
        query
          .eq("estate_id", estateId)
          .in("action", ["device.assigned", "device.registered", "integration.tuya.sync.completed"])
          .order("created_at", { ascending: false })
          .limit(100)
      ),
    ]);

  const homes = new Map((homesResult.data as any[]).map((home) => [clean(home.id), home]));
  const rooms = new Map((roomsResult.data as any[]).map((room) => [clean(room.id), room]));
  const registry = (devicesResult.data as any[]).map((device) => ({
    id: device.id,
    oyi_id: device.id,
    external_id: clean(device.external_id) || null,
    name: clean(device.name, "Unnamed device"),
    type: clean(device.type || device.category, "device"),
    category: clean(device.category || device.type, "device"),
    provider: clean(device.provider || device.vendor || device.adapter, "unknown"),
    adapter: clean(device.adapter || device.provider || device.vendor, "unknown"),
    status: deviceStatus(device),
    raw_status: clean(device.status, "unknown"),
    online: typeof device.online === "boolean" ? device.online : null,
    last_seen_at: device.last_seen_at || null,
    last_event_at: device.last_event_at || null,
    sync_state: clean(device.sync_state, "unknown"),
    bind_state: clean(device.bind_state, device.home_id ? "home_bound" : "discovered"),
    home_id: device.home_id || null,
    room_id: device.room_id || null,
    ...locationFor(device, homes, rooms),
    capabilities: safeArray(device.capabilities),
    protocols: safeArray(device.protocols),
    metadata: sanitizeMetadata(device.metadata),
  }));

  const discovered = (discoveredResult.data as any[]).map((device) => ({
    id: device.id,
    external_id: clean(device.external_id) || null,
    edge_node_id: clean(device.edge_node_id) || null,
    name: clean(device.name, "Unnamed device"),
    type: clean(device.category, "device"),
    provider: clean(device.provider, "unknown"),
    source: clean(device.metadata?.source || device.provider, "unknown"),
    status: clean(device.status, "unknown"),
    reachability: device.last_seen_at ? "seen" : "unknown",
    last_seen_at: device.last_seen_at || null,
    registered: registry.some((registered) => registered.external_id && registered.external_id === clean(device.external_id)),
    metadata: sanitizeMetadata(device.metadata),
  }));

  const edgeNodes = (edgeNodesResult.data as any[]).map((node) => ({
    id: node.id,
    node_id: clean(node.edge_node_id),
    name: clean(node.name || node.edge_node_id, "Edge node"),
    estate_id: node.estate_id,
    version: node.runtime_version || null,
    ip_address: node.local_runtime_host || null,
    status: clean(node.heartbeat_status, "pending_registration"),
    last_heartbeat_at: node.last_seen_at || null,
    discovery_capability: safeArray(node.metadata?.capabilities),
    sync_status: clean(node.sync_status, "awaiting_edge_runtime"),
    error_count: Number(node.error_count || 0),
    queue_depth: Number(node.queue_depth || 0),
    device_count: Number(node.device_count || 0),
    camera_count: Number(node.camera_count || 0),
  }));

  const linkedTuyaUid = await getTuyaUidForUser(String(actor.id));
  const tuyaDevices = registry.filter((device) => device.provider === "tuya" || device.adapter === "tuya");
  const latestTuyaSync = tuyaDevices
    .map((device) => device.metadata?.oyi?.provider_last_synced_at || device.last_event_at)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const providerFailures = (webhookResult.data as any[]).filter((event) => clean(event.delivery_status).toLowerCase() === "failed");

  const telemetry = [
    ...registry
      .filter((device) => ["offline", "error"].includes(device.status))
      .map((device) => ({
        id: `device:${device.id}`,
        severity: device.status === "error" ? "high" : "medium",
        domain: "device",
        affected: device.name,
        location: device.room?.name || device.home?.name || "Estate registry",
        time: device.last_seen_at || device.last_event_at || null,
        action: "Refresh status and inspect provider connectivity",
      })),
    ...edgeNodes
      .filter((node) => ["offline", "unreachable"].includes(node.status))
      .map((node) => ({
        id: `edge:${node.id}`,
        severity: "high",
        domain: "edge",
        affected: node.name,
        location: "Estate edge infrastructure",
        time: node.last_heartbeat_at,
        action: "Inspect Oyi Edge runtime and network reachability",
      })),
    ...providerFailures.map((event) => ({
      id: `provider:${event.id}`,
      severity: "medium",
      domain: "provider",
      affected: clean(event.provider, "Provider sync"),
      location: "Provider integration",
      time: event.received_at || null,
      action: "Review provider connection and retry synchronization",
    })),
  ].slice(0, 100);
  const assignmentHomes = (homesResult.data as any[]).map((home) => ({
    id: home.id,
    name: clean(home.name, "Home"),
    unit: home.unit || null,
    block: home.block || null,
  }));
  const assignmentRooms = (roomsResult.data as any[]).map((room) => ({
    id: room.id,
    home_id: room.home_id,
    name: clean(room.name, "Room"),
    type: clean(room.type, "room"),
  }));

  return res.json({
    estate: { id: estateId },
    registry,
    discovered,
    homes: assignmentHomes,
    rooms: assignmentRooms,
    edge_nodes: edgeNodes,
    heartbeats: (heartbeatResult.data as any[]).map((heartbeat) => ({
      id: heartbeat.id,
      edge_node_id: heartbeat.edge_node_id,
      heartbeat_status: heartbeat.heartbeat_status,
      queue_depth: heartbeat.queue_depth,
      sync_status: heartbeat.sync_status,
      error_count: heartbeat.error_count,
      received_at: heartbeat.received_at,
      metadata: sanitizeMetadata(heartbeat.metadata),
    })),
    assignment_history: (auditResult.data as any[]).map((event) => ({
      id: event.id,
      action: event.action,
      resource_type: event.resource_type,
      resource_id: event.resource_id,
      status: event.status,
      created_at: event.created_at,
      metadata: sanitizeMetadata(event.metadata),
    })),
    providers: [
      {
        key: "tuya",
        name: "Tuya / Smart Life",
        status: !process.env.TUYA_ACCESS_ID || !process.env.TUYA_ACCESS_SECRET
          ? "pending_configuration"
          : linkedTuyaUid
          ? "connected"
          : "disconnected",
        last_sync_at: latestTuyaSync,
        device_count: tuyaDevices.length,
        sync_errors: providerFailures.filter((event) => clean(event.provider).toLowerCase() === "tuya").length,
        can_sync: Boolean(process.env.TUYA_ACCESS_ID && process.env.TUYA_ACCESS_SECRET && linkedTuyaUid),
      },
      {
        key: "oyi_edge",
        name: "Oyi Edge",
        status: edgeNodes.length ? (edgeNodes.some((node) => node.status === "online") ? "connected" : "provider_error") : "pending_configuration",
        last_sync_at: edgeNodes.map((node) => node.last_heartbeat_at).filter(Boolean).sort().at(-1) || null,
        device_count: discovered.length,
        sync_errors: edgeNodes.reduce((sum, node) => sum + node.error_count, 0),
        can_sync: false,
      },
      { key: "matter", name: "Matter", status: "pending_configuration", last_sync_at: null, device_count: 0, sync_errors: 0, can_sync: false },
      { key: "onvif", name: "ONVIF", status: "pending_configuration", last_sync_at: null, device_count: discovered.filter((device) => device.provider === "onvif").length, sync_errors: 0, can_sync: false },
      { key: "mqtt", name: "MQTT", status: "pending_configuration", last_sync_at: null, device_count: discovered.filter((device) => device.provider === "mqtt").length, sync_errors: 0, can_sync: false },
    ],
    telemetry,
    sources: {
      devices: devicesResult.source,
      homes: homesResult.source,
      rooms: roomsResult.source,
      discovered_devices: discoveredResult.source,
      edge_nodes: edgeNodesResult.source,
      edge_heartbeats: heartbeatResult.source,
      provider_webhook_events: webhookResult.source,
      audit_events: auditResult.source,
      realtime: { available: true, events: ["device.registry.updated", "device.status.updated", "device.discovered", "edge.heartbeat"] },
    },
  });
}

export async function syncFacilityTuyaProvider(req: Request, res: Response) {
  try {
    const actor: any = (req as any).user;
    if (!actor?.id) return res.status(401).json({ error: "Not authenticated" });
    if (!actor?.estate_id) return res.status(400).json({ error: "Active estate context required" });
    return res.json(await syncTuyaRegistryForActor(actor, req));
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || "Tuya synchronization failed" });
  }
}
