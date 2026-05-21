import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { CONTRACT_VERSION, emitAuditEvent } from "../core/foundation";

const router = Router();

type Row = Record<string, any>;

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function extractBearer(req: Request) {
  const auth = req.headers.authorization || "";
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function requireOfficeExportKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.OFFICE_SYNC_API_KEY || process.env.OFFICE_EXPORT_API_KEY || "";
  if (!expected) {
    return res.status(503).json({ error: "OFFICE_SYNC_API_KEY is not configured" });
  }

  const provided = String(req.headers["x-api-key"] || extractBearer(req) || "").trim();
  if (!provided || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: "Invalid office sync key" });
  }

  return next();
}

function toNumber(value: any, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asArray<T = Row>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

type SelectResult = {
  rows: Row[];
  source: {
    available: boolean;
    reason?: string;
    required_source: string;
    count: number;
  };
};

async function safeSelectWithStatus(table: string, columns = "*"): Promise<SelectResult> {
  const { data, error } = await supabaseAdmin.from(table).select(columns);
  if (error) {
    console.warn(`[office-export] ${table}: ${error.message}`);
    return {
      rows: [],
      source: {
        available: false,
        reason: "table_or_service_missing",
        required_source: table,
        count: 0,
      },
    };
  }
  const rows = asArray<Row>(data);
  return {
    rows,
    source: {
      available: true,
      required_source: table,
      count: rows.length,
    },
  };
}

function exportRecord(kind: string, row: Row, index: number, nowIso: string) {
  return {
    id: String(row.id || row.event_id || `${kind}_${index + 1}`),
    estate_id: row.estate_id || null,
    building_id: row.building_id || null,
    home_id: row.home_id || null,
    user_id: row.user_id || row.created_by || null,
    title: row.title || row.name || row.subject || row.event_type || kind,
    category: row.category || row.type || kind,
    status: row.status || row.state || "recorded",
    priority: row.priority || row.severity || null,
    created_at: row.created_at || row.received_at || row.timestamp || nowIso,
    updated_at: row.updated_at || row.created_at || nowIso,
    metadata: row.metadata || row.payload || row,
  };
}

function sourceUnavailable(requiredSource: string) {
  return {
    available: false,
    reason: "table_or_service_missing",
    required_source: requiredSource,
  };
}

function makePackage(estate: Row, nowIso: string) {
  const code = String(
    estate.package_code || estate.package || estate.subscription_plan || estate.plan || estate.tier || "starter"
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const name = String(estate.package_name || estate.package || estate.subscription_plan || estate.plan || code)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return {
    id: `oyi_pkg_${code || "starter"}`,
    name,
    code: code || "starter",
    status: "active",
    setup_fee: toNumber(estate.setup_fee),
    monthly_fee: toNumber(estate.monthly_fee || estate.subscription_fee),
    estate_limit: estate.estate_limit ?? null,
    building_limit: estate.building_limit ?? null,
    home_limit: estate.home_limit ?? null,
    device_limit: estate.device_limit ?? null,
    api_access: Boolean(estate.api_access),
    support_tier: estate.support_tier || "standard",
    created_at: estate.created_at || nowIso,
    updated_at: estate.updated_at || nowIso,
  };
}

function groupBuildings(homes: Row[], devices: Row[], nowIso: string) {
  const groups = new Map<string, Row>();

  for (const home of homes) {
    const estateId = String(home.estate_id || "unassigned_estate");
    const block = String(home.building || home.block || home.wing || home.cluster || "Main Block").trim();
    const id = `oyi_building_${estateId}_${block.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        estate_id: estateId,
        name: block || "Main Block",
        type: home.type || "estate block",
        homes_count: 0,
        devices_count: 0,
        permitted_users: 0,
        live_cameras: 0,
        occupancy_pct: 0,
        created_at: home.created_at || nowIso,
        updated_at: nowIso,
      });
    }

    const group = groups.get(id)!;
    group.homes_count += 1;
    group.permitted_users += toNumber(home.residents_count || home.users_count || home.occupants_count);
  }

  for (const device of devices) {
    const estateId = String(device.estate_id || "unassigned_estate");
    const block = String(device.building || device.block || "Main Block").trim();
    const id = `oyi_building_${estateId}_${block.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        estate_id: estateId,
        name: block || "Main Block",
        type: "device cluster",
        homes_count: 0,
        devices_count: 0,
        permitted_users: 0,
        live_cameras: 0,
        occupancy_pct: 0,
        created_at: device.created_at || nowIso,
        updated_at: nowIso,
      });
    }

    const group = groups.get(id)!;
    group.devices_count += 1;
    if (/camera|cctv|video/i.test(String(device.category || device.type || device.name || ""))) {
      group.live_cameras += 1;
    }
  }

  return Array.from(groups.values()).map((building) => ({
    ...building,
    occupancy_pct: building.homes_count ? Math.min(100, Math.round((building.permitted_users / building.homes_count) * 100)) : 0,
  }));
}

router.get("/export", requireOfficeExportKey, async (req: Request, res: Response) => {
  const nowIso = new Date().toISOString();

  const [
    estatesResult,
    homesResult,
    devicesResult,
    estateWalletsResult,
    walletsResult,
    maintenanceRequestsResult,
    notificationsResult,
    estateMembershipsResult,
    homeMembershipsResult,
    visitorsResult,
    paymentsResult,
    duesResult,
    communityPostsResult,
    usersResult,
    roomsResult,
    incidentsResult,
    edgeHeartbeatsResult,
    utilityEventsResult,
    automationsResult,
    deviceTelemetryResult,
    providerWebhookEventsResult,
  ] = await Promise.all([
    safeSelectWithStatus("estates"),
    safeSelectWithStatus("homes"),
    safeSelectWithStatus("devices"),
    safeSelectWithStatus("estate_wallets"),
    safeSelectWithStatus("wallets"),
    safeSelectWithStatus("maintenance_requests"),
    safeSelectWithStatus("notifications"),
    safeSelectWithStatus("estate_memberships"),
    safeSelectWithStatus("home_memberships"),
    safeSelectWithStatus("visitors"),
    safeSelectWithStatus("payments"),
    safeSelectWithStatus("dues"),
    safeSelectWithStatus("community_posts"),
    safeSelectWithStatus("users", "id,email,full_name,username,role,estate_id,home_id,account_status,created_at,updated_at"),
    safeSelectWithStatus("rooms"),
    safeSelectWithStatus("incidents"),
    safeSelectWithStatus("edge_heartbeats"),
    safeSelectWithStatus("utility_events"),
    safeSelectWithStatus("automations"),
    safeSelectWithStatus("device_telemetry"),
    safeSelectWithStatus("provider_webhook_events"),
  ]);

  const estates = estatesResult.rows;
  const homes = homesResult.rows;
  const devices = devicesResult.rows;
  const estateWallets = estateWalletsResult.rows;
  const wallets = walletsResult.rows;
  const maintenanceRequests = maintenanceRequestsResult.rows;
  const notifications = notificationsResult.rows;
  const estateMemberships = estateMembershipsResult.rows;
  const homeMemberships = homeMembershipsResult.rows;
  const visitors = visitorsResult.rows;
  const payments = paymentsResult.rows;
  const dues = duesResult.rows;
  const communityPosts = communityPostsResult.rows;
  const users = usersResult.rows;
  const rooms = roomsResult.rows;
  const incidents = incidentsResult.rows;
  const edgeHeartbeats = edgeHeartbeatsResult.rows;
  const utilityEvents = utilityEventsResult.rows;
  const automations = automationsResult.rows;
  const deviceTelemetry = deviceTelemetryResult.rows;
  const providerWebhookEvents = providerWebhookEventsResult.rows;

  const packageMap = new Map<string, Row>();
  const officeEstates = estates.map((estate) => {
    const pkg = makePackage(estate, nowIso);
    packageMap.set(pkg.id, pkg);
    const estateId = String(estate.id);
    const estateHomes = homes.filter((home) => String(home.estate_id) === estateId);
    const estateDevices = devices.filter((device) => String(device.estate_id) === estateId);
    const estateWallet = estateWallets.find((wallet) => String(wallet.estate_id) === estateId);
    const memberCount = estateMemberships.filter((member) => String(member.estate_id) === estateId).length;
    const openSupport = maintenanceRequests.filter(
      (ticket) => String(ticket.estate_id) === estateId && ["open", "in_progress", "pending"].includes(String(ticket.status || "open"))
    ).length;
    const unreadAlerts = notifications.filter(
      (notice) => String(notice.estate_id) === estateId && (notice.read === false || notice.read_at == null)
    ).length;

    return {
      id: estateId,
      name: estate.name || "Unnamed Estate",
      package_id: pkg.id,
      status: estate.status || "active",
      subscription_status: estate.subscription_status || estate.membership_status || "live",
      location: estate.address || estate.location || "",
      latitude: estate.latitude ?? estate.lat ?? estate.geo?.latitude ?? estate.geo?.lat ?? null,
      longitude: estate.longitude ?? estate.lng ?? estate.geo?.longitude ?? estate.geo?.lng ?? null,
      health_score: estate.health_score ?? estate.health_pct ?? null,
      metadata: {
        community_posts: communityPosts.filter((post) => String(post.estate_id) === estateId).length,
        utility_count: toNumber(estate.utility_count || estate.utilities_count),
        source: "oyi_backend_export",
      },
      buildings_count: new Set(estateHomes.map((home) => home.building || home.block || "Main Block")).size,
      homes_count: estateHomes.length,
      devices_count: estateDevices.length,
      resident_count: memberCount,
      wallet_balance: toNumber(estateWallet?.balance || estate.wallet_balance),
      monthly_recurring_revenue: toNumber(estate.monthly_fee || estate.subscription_fee),
      support_open: openSupport + unreadAlerts,
      support_escalated: maintenanceRequests.filter(
        (ticket) => String(ticket.estate_id) === estateId && String(ticket.priority || "").toLowerCase() === "critical"
      ).length,
      connected_at: estate.created_at || nowIso,
      updated_at: estate.updated_at || nowIso,
    };
  });

  const officeHomes = homes.map((home) => ({
    id: String(home.id),
    estate_id: String(home.estate_id || ""),
    building_id: `oyi_building_${String(home.estate_id || "unassigned_estate")}_${String(home.building || home.block || "Main Block")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")}`,
    name: home.name || home.unit || "Unnamed Home",
    residents_count: home.residents_count || home.users_count || homeMemberships.filter((member) => String(member.home_id) === String(home.id)).length,
    devices_count: devices.filter((device) => String(device.home_id) === String(home.id)).length,
    wallet_balance: toNumber(home.wallet_balance || wallets.find((wallet) => String(wallet.home_id) === String(home.id))?.balance),
    automation_state: home.automation_state || home.status || "standby",
    created_at: home.created_at || nowIso,
    updated_at: home.updated_at || nowIso,
  }));

  const officeDevices = devices.map((device) => ({
    id: String(device.id || device.device_id || device.external_id),
    estate_id: device.estate_id || null,
    building_id: device.building_id || null,
    home_id: device.home_id || null,
    name: device.name || device.label || "Unnamed Device",
    category: device.category || device.type || "hardware",
    provider: device.provider || device.adapter || "oyi-os",
    status: device.status || (device.online ? "online" : "offline"),
    battery_level: device.battery_level ?? device.battery ?? null,
    last_seen_at: device.last_seen_at || device.last_seen || device.updated_at || null,
    metadata: device.metadata || {},
    created_at: device.created_at || nowIso,
    updated_at: device.updated_at || nowIso,
  }));

  const officeWallets = [...estateWallets, ...wallets].map((wallet, index) => ({
    id: String(wallet.id || `oyi_wallet_${index + 1}`),
    scope_type: wallet.estate_id ? "estate" : wallet.home_id ? "home" : "user",
    scope_id: String(wallet.estate_id || wallet.home_id || wallet.user_id || ""),
    label: wallet.label || wallet.name || "Oyi Wallet",
    balance: toNumber(wallet.balance),
    currency: wallet.currency || "NGN",
    pending_charges: toNumber(wallet.pending_charges || wallet.outstanding_dues),
    created_at: wallet.created_at || nowIso,
    updated_at: wallet.updated_at || nowIso,
  }));

  const supportMappings = maintenanceRequests.map((ticket, index) => ({
    id: String(ticket.id || `oyi_support_${index + 1}`),
    estate_id: ticket.estate_id || null,
    building_id: ticket.building_id || null,
    home_id: ticket.home_id || null,
    title: ticket.title || ticket.subject || ticket.description || "Maintenance request",
    category: ticket.category || "maintenance",
    channel: ticket.channel || "facility",
    priority: ticket.priority || "medium",
    status: ticket.status || "open",
    assigned_team: ticket.assigned_team || ticket.assigned_to || "customer_support",
    created_at: ticket.created_at || nowIso,
    updated_at: ticket.updated_at || nowIso,
  }));

  const analytics = [
    {
      id: "oyi_facility_live_export",
      surface: "facility_system",
      label: "Oyi Facility Live Export",
      period: "live",
      sessions: visitors.length,
      unique_visitors: new Set(visitors.map((visitor) => visitor.user_id || visitor.email || visitor.phone)).size,
      conversions: payments.length,
      active_agent: "Oyi OS",
      top_source: "Oyi Backend",
      top_location: officeEstates[0]?.location || "",
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: "oyi_consumer_live_export",
      surface: "consumer_sync",
      label: "Oyi Smart Home Live Export",
      period: "live",
      sessions: homes.length,
      unique_visitors: homeMemberships.length,
      conversions: devices.length,
      active_agent: "Oyi Consumer",
      top_source: "Smart Home OS",
      top_location: "",
      created_at: nowIso,
      updated_at: nowIso,
    },
  ];

  const officeUsers = users.map((user) => ({
    id: String(user.id),
    email: user.email || "",
    display_name: user.full_name || user.username || user.email || "User",
    role: user.role || "resident",
    status: user.account_status || "active",
    estate_id: user.estate_id || null,
    home_id: user.home_id || null,
    created_at: user.created_at || nowIso,
    updated_at: user.updated_at || nowIso,
  }));

  const officeVisitors = visitors.map((visitor, index) => ({
    id: String(visitor.id || `oyi_visitor_${index + 1}`),
    estate_id: visitor.estate_id || null,
    home_id: visitor.home_id || null,
    name: visitor.name || visitor.visitor_name || "Visitor",
    status: visitor.status || "pending",
    created_at: visitor.created_at || nowIso,
    updated_at: visitor.updated_at || nowIso,
    metadata: visitor,
  }));

  const officeRooms = rooms.map((room, index) => ({
    id: String(room.id || `oyi_room_${index + 1}`),
    estate_id: room.estate_id || null,
    home_id: room.home_id || null,
    name: room.name || room.label || "Room",
    type: room.type || "room",
    created_at: room.created_at || nowIso,
    updated_at: room.updated_at || nowIso,
    metadata: room.metadata || {},
  }));

  const maintenance = maintenanceRequests.map((ticket, index) => exportRecord("maintenance", ticket, index, nowIso));
  const incidentRecords = incidents.map((incident, index) => exportRecord("incident", incident, index, nowIso));
  const edgeHeartbeatRecords = edgeHeartbeats.map((heartbeat, index) => exportRecord("edge_heartbeat", heartbeat, index, nowIso));
  const utilityEventRecords = utilityEvents.map((event, index) => exportRecord("utility_event", event, index, nowIso));
  const community = communityPosts.map((post, index) => exportRecord("community", post, index, nowIso));
  const support = supportMappings.map((ticket) => ({ ...ticket, metadata: { source: "maintenance_requests" } }));
  const automationRecords = automations.map((automation, index) => exportRecord("automation", automation, index, nowIso));
  const telemetryRecords = deviceTelemetry.map((telemetry, index) => exportRecord("device_telemetry", telemetry, index, nowIso));
  const webhookDeliveryRecords = providerWebhookEvents.map((event, index) => ({
    id: String(event.id || `provider_webhook_${index + 1}`),
    provider: event.provider || "unknown",
    event_type: event.event_type || event.type || "provider.event",
    received_at: event.received_at || event.created_at || nowIso,
    verified: Boolean(event.verified),
    signature_status: event.signature_status || "unknown",
    delivery_status: event.delivery_status || event.status || "recorded",
    error_message: event.error_message || "",
    payload_summary: event.payload_summary || event.metadata || {},
    related_estate_id: event.related_estate_id || event.estate_id || null,
    related_user_id: event.related_user_id || event.user_id || null,
  }));

  const sourceStatus = {
    estates: estatesResult.source,
    homes: homesResult.source,
    devices: devicesResult.source,
    estate_wallets: estateWalletsResult.source,
    wallets: walletsResult.source,
    maintenance_requests: maintenanceRequestsResult.source,
    notifications: notificationsResult.source,
    estate_memberships: estateMembershipsResult.source,
    home_memberships: homeMembershipsResult.source,
    visitors: visitorsResult.source,
    payments: paymentsResult.source,
    dues: duesResult.source,
    community_posts: communityPostsResult.source,
    users: usersResult.source,
    rooms: roomsResult.source,
    incidents: incidentsResult.source,
    edge_heartbeats: edgeHeartbeatsResult.source,
    utility_events: utilityEventsResult.source,
    automations: automationsResult.source,
    device_telemetry: deviceTelemetryResult.source,
    provider_webhook_events: providerWebhookEventsResult.source,
  };

  const completeness = {
    facility: {
      estates: estatesResult.source.available,
      buildings: homesResult.source.available || devicesResult.source.available,
      homes: homesResult.source.available,
      devices: devicesResult.source.available,
      maintenance: maintenanceRequestsResult.source.available,
      incidents: incidentsResult.source.available,
      edge_heartbeats: edgeHeartbeatsResult.source.available,
      utility_events: utilityEventsResult.source.available,
    },
    consumer: {
      homes: homesResult.source.available,
      rooms: roomsResult.source.available,
      residents: usersResult.source.available || homeMembershipsResult.source.available,
      users: usersResult.source.available,
      devices: devicesResult.source.available,
      community: communityPostsResult.source.available,
      support: maintenanceRequestsResult.source.available,
      automations: automationsResult.source.available,
      notifications: notificationsResult.source.available,
      device_telemetry: deviceTelemetryResult.source.available,
    },
    webhooks: {
      provider_events: providerWebhookEventsResult.source.available,
      delivery_history: providerWebhookEventsResult.source.available,
    },
  };

  void emitAuditEvent({
    actorId: "office_sync",
    actorEmail: "office-sync@ochiga.local",
    actorRole: "system",
    action: "office.export.accessed",
    resourceType: "office_export",
    resourceId: "office/export",
    status: "success",
    metadata: {
      completeness,
      source_counts: Object.fromEntries(Object.entries(sourceStatus).map(([key, value]) => [key, value.count])),
    },
    req,
  } as any);

  return res.json({
    source: "oyi-os",
    contract_version: CONTRACT_VERSION,
    generated_at: nowIso,
    collections: {
      packages: Array.from(packageMap.values()),
      estates: officeEstates,
      buildings: groupBuildings(homes, devices, nowIso),
      homes: officeHomes,
      devices: officeDevices,
      wallets: officeWallets,
      analytics,
      support_mappings: supportMappings,
      users: officeUsers,
      visitors: officeVisitors,
      rooms: officeRooms,
      maintenance,
      incidents: incidentRecords,
      edge_heartbeats: edgeHeartbeatRecords,
      utility_events: utilityEventRecords,
      community,
      support,
      automations: automationRecords,
      notifications,
      device_telemetry: telemetryRecords,
      webhook_events: webhookDeliveryRecords,
    },
    completeness,
    meta: {
      sources: sourceStatus,
      missing_sources: Object.fromEntries(Object.entries(sourceStatus).filter(([, value]) => !value.available).map(([key, value]) => [key, sourceUnavailable(value.required_source)])),
      webhook_delivery: {
        available: providerWebhookEventsResult.source.available,
        count: providerWebhookEvents.length,
        required_source: "provider_webhook_events",
      },
      raw_counts: {
        estates: estates.length,
        homes: homes.length,
        devices: devices.length,
        estate_wallets: estateWallets.length,
        wallets: wallets.length,
        maintenance_requests: maintenanceRequests.length,
        notifications: notifications.length,
        payments: payments.length,
        dues: dues.length,
        community_posts: communityPosts.length,
        users: users.length,
        rooms: rooms.length,
        maintenance: maintenance.length,
        incidents: incidentRecords.length,
        edge_heartbeats: edgeHeartbeatRecords.length,
        utility_events: utilityEventRecords.length,
        community: community.length,
        support: support.length,
        automations: automationRecords.length,
        notification_records: notifications.length,
        device_telemetry: telemetryRecords.length,
        webhook_events: webhookDeliveryRecords.length,
      },
    },
  });
});

export default router;
