import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import { publishSourceIntelligenceEvent } from "../intelligence-core";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { NotificationService } from "./NotificationService";

type AnyRecord = Record<string, any>;

type InfrastructureEventKind =
  | "power_outage"
  | "power_restored"
  | "internet_outage"
  | "internet_restored"
  | "provider_unavailable"
  | "provider_recovered"
  | "hub_disconnected"
  | "hub_reconnected"
  | "zigbee_coordinator_offline"
  | "zigbee_coordinator_recovered"
  | "bluetooth_gateway_unavailable"
  | "bluetooth_gateway_recovered"
  | "mesh_node_offline"
  | "mesh_node_recovered"
  | "mass_device_offline"
  | "mass_device_recovery"
  | "generator_started"
  | "generator_stopped"
  | "inverter_takeover"
  | "solar_takeover";

type DeviceEventLike = {
  deviceId: string;
  estateId?: string | null;
  homeId?: string | null;
  roomId?: string | null;
  eventType: string;
  source?: string | null;
  occurredAt?: string | null;
  metadata?: Record<string, any> | null;
};

type DeviceRow = {
  id: string;
  name?: string | null;
  type?: string | null;
  category?: string | null;
  adapter?: string | null;
  vendor?: string | null;
  provider?: string | null;
  parent_device_id?: string | null;
  room_id?: string | null;
  metadata?: AnyRecord | null;
};

type ActiveInfrastructureEvent = {
  kind: InfrastructureEventKind;
  title: string;
  summary: string;
  occurred_at: string;
  metadata: AnyRecord;
};

function text(value: unknown) {
  const next = String(value ?? "").trim();
  return next || null;
}

function lower(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function arrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function protocolsForDevice(device: DeviceRow) {
  const metadata = asRecord(device.metadata);
  return Array.from(
    new Set(
      [
        ...(Array.isArray(metadata.protocols) ? metadata.protocols : []),
        metadata.protocol,
        metadata.transport,
        metadata.connectivity,
        device.adapter,
        device.vendor,
      ]
        .map((item) => lower(item))
        .filter(Boolean),
    ),
  );
}

function roomNameForDevice(device: DeviceRow) {
  const metadata = asRecord(device.metadata);
  return text(metadata.room_name || metadata.room || metadata.roomLabel);
}

function hubKeyForDevice(device: DeviceRow) {
  const metadata = asRecord(device.metadata);
  return [
    metadata.gateway_id,
    metadata.gatewayId,
    metadata.hub_id,
    metadata.hubId,
    metadata.coordinator_id,
    metadata.coordinatorId,
    device.parent_device_id,
  ]
    .map((value) => text(value))
    .find(Boolean) || null;
}

function deviceLooksLikeHub(device: DeviceRow) {
  const haystack = [
    device.name,
    device.type,
    device.category,
    device.adapter,
    asRecord(device.metadata).product_name,
    asRecord(device.metadata).productName,
    asRecord(device.metadata).model,
  ]
    .map((item) => lower(item))
    .join(" ");
  return /hub|gateway|mesh|router|coordinator|bridge|bluetooth gateway|zigbee/.test(haystack);
}

function deviceLooksLikeGenerator(device: DeviceRow) {
  const haystack = [device.name, device.type, device.category, asRecord(device.metadata).product_name]
    .map((item) => lower(item))
    .join(" ");
  if (/generator/.test(haystack)) return "generator";
  if (/inverter|ups|backup power|backup/.test(haystack)) return "inverter";
  if (/solar|battery/.test(haystack)) return "solar";
  return null;
}

function naturalLines(kind: InfrastructureEventKind, args: {
  affectedCount: number;
  recoveredCount?: number;
  stillAffectedCount?: number;
  durationMinutes?: number | null;
  protocols?: string[];
  provider?: string | null;
}) {
  const affected = args.affectedCount;
  const recovered = args.recoveredCount ?? affected;
  const stillAffected = args.stillAffectedCount ?? 0;
  const duration = typeof args.durationMinutes === "number" && args.durationMinutes > 0 ? `${args.durationMinutes} minute${args.durationMinutes === 1 ? "" : "s"}` : null;
  switch (kind) {
    case "power_outage":
      return {
        title: "Power appears to have been lost",
        summary: `${affected} connected device${affected === 1 ? "" : "s"} became unavailable at nearly the same time.`,
        recommendation: "Check estate or home power availability, backup power, and network equipment.",
        status: "offline",
      };
    case "power_restored":
      return {
        title: "Grid power appears to be restored",
        summary: `${recovered} device${recovered === 1 ? "" : "s"} recovered${stillAffected ? `, while ${stillAffected} still need attention` : ""}${duration ? ` after about ${duration}` : ""}.`,
        recommendation: "Review any devices that did not recover automatically.",
        status: "recovered",
      };
    case "internet_outage":
      return {
        title: "Internet connectivity appears interrupted",
        summary: `${affected} cloud-controlled device${affected === 1 ? "" : "s"} cannot currently be reached.`,
        recommendation: "Check your router, ISP link, and Wi-Fi power.",
        status: "offline",
      };
    case "internet_restored":
      return {
        title: "Internet connection has recovered",
        summary: `${recovered} device${recovered === 1 ? "" : "s"} resumed reporting${duration ? ` after about ${duration}` : ""}${stillAffected ? `, but ${stillAffected} still need attention` : ""}.`,
        recommendation: "Review any devices still unavailable after network recovery.",
        status: "recovered",
      };
    case "provider_unavailable":
      return {
        title: "The provider cloud is currently unreachable",
        summary: `${affected} connected device${affected === 1 ? "" : "s"} share the same provider path${args.provider ? ` (${args.provider})` : ""} and stopped responding together.`,
        recommendation: "Wait for provider recovery or retry once provider health improves.",
        status: "degraded",
      };
    case "provider_recovered":
      return {
        title: "The device provider is reachable again",
        summary: `${recovered} device${recovered === 1 ? "" : "s"} resumed reporting${duration ? ` after about ${duration}` : ""}.`,
        recommendation: "Retry any command that was left waiting for provider confirmation.",
        status: "recovered",
      };
    case "hub_disconnected":
      return {
        title: "Your smart hub appears offline",
        summary: `${affected} dependent device${affected === 1 ? "" : "s"} stopped reporting at the same time.`,
        recommendation: "Check the hub power and local network connection.",
        status: "offline",
      };
    case "hub_reconnected":
      return {
        title: "Your smart hub is back online",
        summary: `${recovered} dependent device${recovered === 1 ? "" : "s"} resumed reporting${duration ? ` after about ${duration}` : ""}${stillAffected ? `, with ${stillAffected} still unavailable` : ""}.`,
        recommendation: "Review any child device that did not recover with the hub.",
        status: "recovered",
      };
    case "zigbee_coordinator_offline":
      return {
        title: "The Zigbee hub appears offline",
        summary: `${affected} Zigbee-linked device${affected === 1 ? "" : "s"} may stop reporting until the coordinator reconnects.`,
        recommendation: "Check coordinator power and the parent hub connection.",
        status: "offline",
      };
    case "zigbee_coordinator_recovered":
      return {
        title: "The Zigbee hub is reporting again",
        summary: `${recovered} Zigbee-linked device${recovered === 1 ? "" : "s"} resumed reporting${duration ? ` after about ${duration}` : ""}.`,
        recommendation: "Review any Zigbee device that stayed unavailable after coordinator recovery.",
        status: "recovered",
      };
    case "bluetooth_gateway_unavailable":
      return {
        title: "The Bluetooth gateway appears unavailable",
        summary: `${affected} Bluetooth-linked device${affected === 1 ? "" : "s"} may temporarily stop reporting.`,
        recommendation: "Check the gateway power and bridge connection.",
        status: "offline",
      };
    case "bluetooth_gateway_recovered":
      return {
        title: "The Bluetooth gateway is back online",
        summary: `${recovered} Bluetooth-linked device${recovered === 1 ? "" : "s"} resumed reporting${duration ? ` after about ${duration}` : ""}.`,
        recommendation: "Review any device still waiting for reconnection.",
        status: "recovered",
      };
    case "mesh_node_offline":
      return {
        title: "A mesh node appears to be offline",
        summary: `${affected} connected device${affected === 1 ? "" : "s"} depend on the same local mesh path.`,
        recommendation: "Check the local mesh node power and uplink.",
        status: "offline",
      };
    case "mesh_node_recovered":
      return {
        title: "The mesh node is back online",
        summary: `${recovered} dependent device${recovered === 1 ? "" : "s"} resumed reporting${duration ? ` after about ${duration}` : ""}.`,
        recommendation: "Review any endpoint that did not recover with the mesh node.",
        status: "recovered",
      };
    case "mass_device_offline":
      return {
        title: "Several connected devices went offline together",
        summary: `${affected} devices became unavailable within the same window.`,
        recommendation: "Check shared power, network, or hub dependencies.",
        status: "offline",
      };
    case "mass_device_recovery":
      return {
        title: "Several connected devices recovered together",
        summary: `${recovered} devices resumed reporting${duration ? ` after about ${duration}` : ""}${stillAffected ? `, while ${stillAffected} still need review` : ""}.`,
        recommendation: "Inspect any device that did not recover with the group.",
        status: "recovered",
      };
    case "generator_started":
      return {
        title: "Generator backup started",
        summary: "Backup power appears to have taken over.",
        recommendation: "Review power continuity and expected load coverage.",
        status: "online",
      };
    case "generator_stopped":
      return {
        title: "Generator backup stopped",
        summary: "Backup generation is no longer active.",
        recommendation: "Confirm whether grid or inverter power is now carrying the load.",
        status: "normal",
      };
    case "inverter_takeover":
      return {
        title: "Inverter backup appears active",
        summary: "Battery or inverter power appears to have taken over connected loads.",
        recommendation: "Review battery health and expected runtime.",
        status: "online",
      };
    case "solar_takeover":
      return {
        title: "Solar or battery power appears active",
        summary: "A solar or battery source appears to be supporting connected loads.",
        recommendation: "Review backup availability and charging state.",
        status: "online",
      };
  }
}

function recentWindowIso(windowMs: number) {
  return new Date(Date.now() - windowMs).toISOString();
}

function groupProvider(devices: DeviceRow[]) {
  const providers = Array.from(new Set(devices.map((device) => lower(device.provider || device.vendor)).filter(Boolean)));
  return providers.length === 1 ? providers[0] : null;
}

function inferClusterKind(devices: DeviceRow[], mode: "offline" | "recovery", source: string): InfrastructureEventKind | null {
  const hubKeys = Array.from(new Set(devices.map(hubKeyForDevice).filter(Boolean)));
  const protocols = Array.from(new Set(devices.flatMap(protocolsForDevice)));
  const provider = groupProvider(devices);
  const rooms = Array.from(new Set(devices.map((device) => device.room_id || roomNameForDevice(device)).filter(Boolean)));

  if (hubKeys.length === 1 && devices.length >= 2) {
    if (protocols.some((item) => /zigbee/.test(item))) return mode === "offline" ? "zigbee_coordinator_offline" : "zigbee_coordinator_recovered";
    if (protocols.some((item) => /ble|bluetooth/.test(item))) return mode === "offline" ? "bluetooth_gateway_unavailable" : "bluetooth_gateway_recovered";
    if (protocols.some((item) => /mesh|thread/.test(item))) return mode === "offline" ? "mesh_node_offline" : "mesh_node_recovered";
    return mode === "offline" ? "hub_disconnected" : "hub_reconnected";
  }

  if (provider && /provider_reported|provider_app|system/.test(source) && devices.length >= 4) {
    return mode === "offline" ? "provider_unavailable" : "provider_recovered";
  }

  if (devices.length >= 4 && protocols.every((item) => /wifi|cloud|tuya/.test(item)) && rooms.length >= 2) {
    return mode === "offline" ? "internet_outage" : "internet_restored";
  }

  if (devices.length >= 4 && rooms.length >= 2) {
    return mode === "offline" ? "power_outage" : "power_restored";
  }

  if (devices.length >= 3) {
    return mode === "offline" ? "mass_device_offline" : "mass_device_recovery";
  }

  return null;
}

function inferSingleInfrastructureKind(input: DeviceEventLike, device: DeviceRow | null): InfrastructureEventKind | null {
  if (!device) return null;
  const eventType = lower(input.eventType);
  const infrastructureDevice = deviceLooksLikeGenerator(device);
  if (/device\.power\.on|device\.command\.executed|device\.state\.changed/.test(eventType) && infrastructureDevice) {
    if (infrastructureDevice === "generator") return "generator_started";
    if (infrastructureDevice === "inverter") return "inverter_takeover";
    if (infrastructureDevice === "solar") return "solar_takeover";
  }
  if (/device\.power\.off/.test(eventType) && infrastructureDevice === "generator") return "generator_stopped";
  if (/device\.offline/.test(eventType) && deviceLooksLikeHub(device)) {
    const protocols = protocolsForDevice(device);
    if (protocols.some((item) => /zigbee/.test(item))) return "zigbee_coordinator_offline";
    if (protocols.some((item) => /ble|bluetooth/.test(item))) return "bluetooth_gateway_unavailable";
    if (protocols.some((item) => /mesh|thread/.test(item))) return "mesh_node_offline";
    return "hub_disconnected";
  }
  if (/device\.online/.test(eventType) && deviceLooksLikeHub(device)) {
    const protocols = protocolsForDevice(device);
    if (protocols.some((item) => /zigbee/.test(item))) return "zigbee_coordinator_recovered";
    if (protocols.some((item) => /ble|bluetooth/.test(item))) return "bluetooth_gateway_recovered";
    if (protocols.some((item) => /mesh|thread/.test(item))) return "mesh_node_recovered";
    return "hub_reconnected";
  }
  return null;
}

async function loadDevices(ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin
    .from("devices")
    .select("id,name,type,category,adapter,vendor,provider,parent_device_id,room_id,metadata")
    .in("id", ids);
  if (error) throw error;
  return (data || []) as DeviceRow[];
}

async function loadRecentClusterEvents(input: { homeId?: string | null; estateId?: string | null; mode: "offline" | "recovery"; windowMs?: number }) {
  const since = recentWindowIso(input.windowMs ?? 90_000);
  let query = supabaseAdmin
    .from("device_events")
    .select("device_id,event_type,source,occurred_at,metadata,home_id,estate_id")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(40);
  if (input.homeId) query = query.eq("home_id", input.homeId);
  else if (input.estateId) query = query.eq("estate_id", input.estateId);
  if (input.mode === "offline") query = query.in("event_type", ["device.offline", "device.health.degraded"]);
  else query = query.in("event_type", ["device.online"]);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function latestInfrastructureEvents(input: { homeId?: string | null; estateId?: string | null; limit?: number }) {
  let query = supabaseAdmin
    .from("home_timeline")
    .select("title,summary,occurred_at,metadata,event_type,home_id,estate_id")
    .in("event_type", ["infrastructure_event.detected", "infrastructure_event.recovered"])
    .order("occurred_at", { ascending: false })
    .limit(input.limit || 20);
  if (input.homeId) query = query.eq("home_id", input.homeId);
  else if (input.estateId) query = query.eq("estate_id", input.estateId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row: any) => ({
    kind: String(row?.metadata?.infrastructure_event_kind || "") as InfrastructureEventKind,
    title: String(row?.title || ""),
    summary: String(row?.summary || ""),
    occurred_at: String(row?.occurred_at || ""),
    metadata: asRecord(row?.metadata),
  })) as ActiveInfrastructureEvent[];
}

function findActiveEvent(rows: ActiveInfrastructureEvent[], kind: InfrastructureEventKind) {
  const baseKind = kind
    .replace(/_restored$/, "")
    .replace(/_recovered$/, "")
    .replace(/_stopped$/, "")
    .replace(/_takeover$/, "");
  const latest = rows.find((row) => row.kind.startsWith(baseKind));
  if (!latest) return null;
  if (/restored|recovered/.test(latest.kind)) return null;
  return latest;
}

async function emitInfrastructureSignal(input: {
  kind: InfrastructureEventKind;
  estateId?: string | null;
  homeId?: string | null;
  source: string;
  occurredAt: string;
  affectedDeviceIds: string[];
  affectedRooms: string[];
  provider?: string | null;
  durationMinutes?: number | null;
  recoveredCount?: number;
  stillAffectedCount?: number;
}) {
  const lines = naturalLines(input.kind, {
    affectedCount: input.affectedDeviceIds.length,
    recoveredCount: input.recoveredCount,
    stillAffectedCount: input.stillAffectedCount,
    durationMinutes: input.durationMinutes,
    provider: input.provider,
  });
  const eventKey = `${input.kind}:${input.homeId || input.estateId || "global"}`;
  await handleSignal({
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "system",
    type: "telemetry",
    timestamp: input.occurredAt,
    domain: "infrastructure",
    origin: "system",
    estateId: input.estateId || null,
    unitId: input.homeId || null,
    entity: {
      id: eventKey,
      type: "infrastructure_event",
      name: titleCaseFromKind(input.kind),
      status: lines.status,
    },
    metadata: {
      category: "infrastructure_event",
      infrastructure_event_kind: input.kind,
      affected_device_count: input.affectedDeviceIds.length,
      affected_device_ids: input.affectedDeviceIds,
      affected_rooms: input.affectedRooms,
      provider: input.provider || null,
      duration_minutes: input.durationMinutes ?? null,
      recovered_count: input.recoveredCount ?? null,
      still_affected_count: input.stillAffectedCount ?? null,
      reason: lines.summary,
      message: lines.summary,
      status: lines.status,
      recommendation: lines.recommendation,
      event_key: eventKey,
    },
    evidence: [
      {
        id: eventKey,
        type: "infrastructure_cluster",
        source: "device_runtime",
        summary: lines.summary,
        timestamp: input.occurredAt,
        metadata: {
          infrastructure_event_kind: input.kind,
          affected_device_ids: input.affectedDeviceIds,
          affected_rooms: input.affectedRooms,
          provider: input.provider || null,
        },
      },
    ],
  } as any);

  await supabaseAdmin.from("home_timeline").insert({
    user_id: null,
    estate_id: input.estateId || null,
    home_id: input.homeId || null,
    source: "infrastructure",
    event_type: /restored|recovered|stopped/.test(input.kind) ? "infrastructure_event.recovered" : "infrastructure_event.detected",
    category: "Infrastructure",
    importance: /offline|outage|unavailable|disconnected/.test(input.kind) ? "attention" : "normal",
    title: lines.title,
    summary: lines.summary,
    severity: /offline|outage|unavailable|disconnected/.test(input.kind) ? "attention" : "info",
    metadata: {
      infrastructure_event_kind: input.kind,
      affected_device_count: input.affectedDeviceIds.length,
      affected_device_ids: input.affectedDeviceIds,
      affected_rooms: input.affectedRooms,
      provider: input.provider || null,
      duration_minutes: input.durationMinutes ?? null,
      recovered_count: input.recoveredCount ?? null,
      still_affected_count: input.stillAffectedCount ?? null,
      recommendation: lines.recommendation,
      event_key: eventKey,
    },
    occurred_at: input.occurredAt,
  } as any);

  void publishSourceIntelligenceEvent({
    source: "edge",
    surface: "consumer",
    event_type: /restored|recovered|stopped/.test(input.kind) ? "infrastructure.recovered" : "infrastructure.detected",
    category: "infrastructure",
    estate_id: input.estateId || null,
    home_id: input.homeId || null,
    actor_id: null,
    entity_type: "infrastructure",
    entity_id: eventKey,
    entity_label: lines.title,
    severity: /offline|outage|unavailable|disconnected/.test(input.kind) ? "attention" : "info",
    title: lines.title,
    summary: lines.summary,
    payload: {
      infrastructure_event_kind: input.kind,
      affected_device_ids: input.affectedDeviceIds,
      affected_rooms: input.affectedRooms,
      provider: input.provider || null,
      duration_minutes: input.durationMinutes ?? null,
    },
    occurred_at: input.occurredAt,
  }, {
    source_table: "home_timeline",
    source_event_id: `${eventKey}:${input.occurredAt}`,
  });

  if (input.homeId) {
    const { data: homeUsers } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("home_id", input.homeId);
    for (const row of homeUsers || []) {
      const userId = String((row as any)?.id || "").trim();
      if (!userId) continue;
      await NotificationService.sendToUser(userId, {
        title: lines.title,
        message: lines.summary,
        type: "intelligence",
        entityId: eventKey,
        payload: {
          estate_id: input.estateId || null,
          home_id: input.homeId || null,
          infrastructure_event_kind: input.kind,
          affected_device_ids: input.affectedDeviceIds,
          affected_rooms: input.affectedRooms,
          provider: input.provider || null,
          duration_minutes: input.durationMinutes ?? null,
          recovered_count: input.recoveredCount ?? null,
          still_affected_count: input.stillAffectedCount ?? null,
          notification_key: `infrastructure:${eventKey}`,
        },
      }).catch((error) => console.warn("[infrastructure_event_intelligence] notification failed", error?.message || String(error)));
    }
  }
}

function titleCaseFromKind(kind: InfrastructureEventKind) {
  return kind
    .replace(/_/g, " ")
    .replace(/\b\w/g, (chunk) => chunk.toUpperCase());
}

export async function evaluateInfrastructureEventForDeviceEvent(input: DeviceEventLike) {
  const homeId = text(input.homeId);
  const estateId = text(input.estateId);
  const occurredAt = text(input.occurredAt) || new Date().toISOString();
  if (!homeId && !estateId) return { ok: false, skipped: "missing_scope" as const };

  const currentDevice = input.deviceId ? await loadDevices([input.deviceId]).then((rows) => rows[0] || null).catch(() => null) : null;
  const singleKind = inferSingleInfrastructureKind(input, currentDevice);
  if (singleKind) {
    const existing = await latestInfrastructureEvents({ homeId, estateId, limit: 8 }).catch(() => []);
    const active = findActiveEvent(existing, singleKind);
    if (!active || new Date(occurredAt).getTime() - new Date(active.occurred_at).getTime() > 10 * 60_000) {
      await emitInfrastructureSignal({
        kind: singleKind,
        estateId,
        homeId,
        source: lower(input.source),
        occurredAt,
        affectedDeviceIds: input.deviceId ? [input.deviceId] : [],
        affectedRooms: input.roomId ? [String(input.roomId)] : [],
        provider: currentDevice?.provider || currentDevice?.vendor || null,
      });
      return { ok: true, kind: singleKind, scope: "single" as const };
    }
  }

  const offlineLike = /device\.offline|device\.health\.degraded/.test(lower(input.eventType));
  const recoveryLike = /device\.online/.test(lower(input.eventType));
  if (!offlineLike && !recoveryLike) return { ok: false, skipped: "not_availability_event" as const };

  const mode = offlineLike ? "offline" : "recovery";
  const recentEvents = await loadRecentClusterEvents({ homeId, estateId, mode }).catch(() => []);
  const affectedIds = Array.from(new Set(recentEvents.map((row: any) => String(row?.device_id || "")).filter(Boolean)));
  if (affectedIds.length < (mode === "offline" ? 3 : 2)) return { ok: false, skipped: "insufficient_cluster" as const };

  const devices = await loadDevices(affectedIds).catch(() => []);
  const kind = inferClusterKind(devices, mode, lower(input.source));
  if (!kind) return { ok: false, skipped: "no_kind" as const };

  const recentInfra = await latestInfrastructureEvents({ homeId, estateId }).catch(() => []);
  const active = findActiveEvent(recentInfra, kind);
  if (mode === "offline" && active && new Date(occurredAt).getTime() - new Date(active.occurred_at).getTime() < 10 * 60_000) {
    return { ok: false, skipped: "active_duplicate" as const };
  }

  let durationMinutes: number | null = null;
  let stillAffectedCount = 0;
  if (mode === "recovery" && active) {
    durationMinutes = Math.max(1, Math.round((new Date(occurredAt).getTime() - new Date(active.occurred_at).getTime()) / 60000));
    const priorAffected = arrayOfStrings(active.metadata.affected_device_ids);
    stillAffectedCount = Math.max(0, priorAffected.length - affectedIds.length);
  }

  const provider = groupProvider(devices);
  const affectedRooms = Array.from(new Set(devices.map((device) => device.room_id || roomNameForDevice(device)).filter(Boolean).map(String)));
  await emitInfrastructureSignal({
    kind,
    estateId,
    homeId,
    source: lower(input.source),
    occurredAt,
    affectedDeviceIds: affectedIds,
    affectedRooms,
    provider,
    durationMinutes,
    recoveredCount: mode === "recovery" ? affectedIds.length : undefined,
    stillAffectedCount: mode === "recovery" ? stillAffectedCount : undefined,
  });

  return { ok: true, kind, scope: "cluster" as const, affected_device_count: affectedIds.length };
}
