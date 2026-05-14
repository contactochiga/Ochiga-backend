import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";

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

async function safeSelect(table: string, columns = "*") {
  const { data, error } = await supabaseAdmin.from(table).select(columns);
  if (error) {
    console.warn(`[office-export] ${table}: ${error.message}`);
    return [] as Row[];
  }
  return asArray<Row>(data);
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

router.get("/export", requireOfficeExportKey, async (_req: Request, res: Response) => {
  const nowIso = new Date().toISOString();

  const [
    estates,
    homes,
    devices,
    estateWallets,
    wallets,
    maintenanceRequests,
    notifications,
    estateMemberships,
    homeMemberships,
    visitors,
    payments,
    dues,
    communityPosts,
  ] = await Promise.all([
    safeSelect("estates"),
    safeSelect("homes"),
    safeSelect("devices"),
    safeSelect("estate_wallets"),
    safeSelect("wallets"),
    safeSelect("maintenance_requests"),
    safeSelect("notifications"),
    safeSelect("estate_memberships"),
    safeSelect("home_memberships"),
    safeSelect("visitors"),
    safeSelect("payments"),
    safeSelect("dues"),
    safeSelect("community_posts"),
  ]);

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

  return res.json({
    source: "oyi-os",
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
    },
    meta: {
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
      },
    },
  });
});

export default router;
