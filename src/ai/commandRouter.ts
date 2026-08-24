import { Request } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { authenticatedActorScope } from "../security/actorScope";
import { emitAuditEvent, hasPermission } from "../core/foundation";
import type { AuthUser } from "../middleware/auth";
import { AI_TOOL_REGISTRY, getAiTool, type AiToolDefinition } from "./toolRegistry";
import { executeDeviceCommandForActor } from "../controllers/deviceCommandController";
import { deviceWithinActorScope, hasWatchScope } from "../services/watchPolicy";
import { NotificationService } from "../services/NotificationService";
import {
  buildDeviceTimeline,
  type DeviceRuntimeScope,
  isDeviceDefinitelyOffline,
  listVisibleDevices,
  logDeviceCommandDiagnostic,
  normalizeDeviceOnlineState,
  resolveVisibleDevice,
} from "../services/deviceRuntimeService";

export type AiCommandStatus =
  | "pending_confirmation"
  | "confirmed"
  | "denied"
  | "expired"
  | "executed"
  | "failed";

export type ProposedAiTool = {
  tool_id: string;
  arguments?: Record<string, any>;
};

export type AiCommandRequest = {
  actor: AuthUser;
  prompt: string;
  surface?: string;
  scope?: string;
  estateId?: string | null;
  homeId?: string | null;
  proposedTools: ProposedAiTool[];
};

const CONFIRMATION_STATUSES = new Set<AiCommandStatus>(["pending_confirmation"]);

function promptExcerpt(prompt: string) {
  return String(prompt || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function actorEstate(actor: AuthUser, explicit?: string | null) {
  // Request payload scopes are untrusted. Context switching must update the authenticated actor first.
  return authenticatedActorScope(actor).estate_id;
}

function actorHome(actor: AuthUser, explicit?: string | null) {
  // Request payload scopes are untrusted. Context switching must update the authenticated actor first.
  return authenticatedActorScope(actor).home_id;
}

export function resolveActorScopeForTest(actor: Pick<AuthUser, "estate_id" | "home_id">, requested: { estate_id?: string | null; home_id?: string | null }) {
  return authenticatedActorScope(actor);
}

function activeScopeFilter(actor: AuthUser, estateId?: string | null, homeId?: string | null): Record<string, string | null> {
  const resolvedHomeId = actorHome(actor, homeId || null);
  const resolvedEstateId = actorEstate(actor, estateId || null);
  if (resolvedHomeId) return { home_id: resolvedHomeId };
  if (resolvedEstateId) return { estate_id: resolvedEstateId };
  return {};
}

function deviceRuntimeScope(actor: AuthUser, args: Record<string, any>): DeviceRuntimeScope {
  const estateWide = String(args.__oyi_surface || "").toLowerCase() === "facility" || args.__oyi_estate_wide === true;
  return {
    estateId: actorEstate(actor, args.estate_id || args.estateId || null),
    homeId: estateWide ? null : actorHome(actor, args.home_id || args.homeId || null),
    estateWide,
  };
}

function scopeAllowed(tool: AiToolDefinition, actor: AuthUser, scope: string) {
  const normalized = String(scope || "user").toLowerCase();
  if (!tool.allowed_scopes.includes(normalized as any)) return false;
  if (actor.role === "resident" && ["office", "facility"].includes(normalized)) return false;
  return true;
}

async function audit(req: Request | undefined, actor: AuthUser, action: string, status: string, metadata: Record<string, any> = {}) {
  await emitAuditEvent({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action,
    resourceType: "ai_command",
    resourceId: metadata.ledger_id || metadata.tool_id || "ai",
    estateId: actor.estate_id,
    homeId: actor.home_id,
    status,
    metadata,
    req,
  } as any);
}

async function writeLedger(input: {
  actor: AuthUser;
  toolId: string;
  prompt: string;
  status: AiCommandStatus;
  estateId?: string | null;
  homeId?: string | null;
  resultSummary?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
}) {
  const now = new Date().toISOString();
  const row = {
    actor_user_id: input.actor.id,
    actor_email: input.actor.email || "",
    actor_role: input.actor.role,
    estate_id: actorEstate(input.actor, input.estateId),
    home_id: actorHome(input.actor, input.homeId),
    tool_id: input.toolId,
    prompt_excerpt: promptExcerpt(input.prompt),
    execution_status: input.status,
    requested_at: now,
    confirmed_at: input.status === "confirmed" ? now : null,
    executed_at: input.status === "executed" ? now : null,
    denied_at: input.status === "denied" ? now : null,
    result_summary: input.resultSummary || "",
    error_message: input.errorMessage || "",
    metadata: input.metadata || {},
  };
  const { data, error } = await supabaseAdmin.from("ai_execution_ledger").insert(row as any).select("*").maybeSingle();
  if (error) {
    console.warn("[ai-ledger] write failed:", error.message);
    return { ...row, id: "", ledger_write_failed: true } as any;
  }
  return data || row;
}

async function countTable(table: string, filters: Record<string, string | null> = {}) {
  let query = supabaseAdmin.from(table).select("id", { count: "exact", head: true });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query = query.eq(key, value);
  });
  const { count, error } = await query;
  if (error) return { available: false, count: 0, error: error.message };
  return { available: true, count: count || 0 };
}

async function selectRows(table: string, build: (q: any) => any) {
  try {
    const { data, error } = await build(supabaseAdmin.from(table));
    if (error) return { available: false, rows: [] as any[], error: error.message };
    return { available: true, rows: data || [], error: "" };
  } catch (error: any) {
    return { available: false, rows: [] as any[], error: error?.message || "source_unavailable" };
  }
}

function asIso(value: any) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function shortText(value: any, fallback = "", max = 160) {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();
  return text.slice(0, max);
}

function compactLines(lines: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return lines
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function isUnread(row: any) {
  return !row?.read_at && !/read|seen|ack/.test(String(row?.status || "").toLowerCase());
}

function structuredCard(type: string, title: string, summary: string, items: any[] = [], meta: Record<string, any> = {}) {
  return { type, title, summary, items, ...meta };
}

function rowMatchesActorScope(actor: AuthUser, row: any) {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const rowHome = String(row?.home_id || payload.home_id || payload.homeId || meta.home_id || meta.homeId || "");
  const rowEstate = String(row?.estate_id || payload.estate_id || payload.estateId || meta.estate_id || meta.estateId || "");
  if (actor.home_id && rowHome && rowHome !== String(actor.home_id)) return false;
  if (actor.estate_id && rowEstate && rowEstate !== String(actor.estate_id)) return false;
  if (actor.home_id && rowEstate && actor.estate_id && rowEstate !== String(actor.estate_id)) return false;
  return true;
}

function sourceLabel(label: string, at?: any) {
  return { label, timestamp: at ? asIso(at) : new Date().toISOString() };
}

function suggestedAction(label: string, route: string, kind = "open_module", payload: Record<string, any> = {}) {
  return { label, route, kind, payload };
}

function titleCase(value: any, fallback = "Home update") {
  const text = shortText(value, fallback, 120);
  return text.replace(/\b\w/g, (m) => m.toUpperCase());
}

function sceneDisplayName(scene: any) {
  return shortText(scene?.name || scene?.title || "Scene", "Scene", 80);
}

function cleanName(value: any, fallback = "Item") {
  return shortText(value, fallback, 90);
}

function healthFromCounts(input: {
  offlineDevices?: number;
  openMaintenance?: number;
  pendingVisitors?: number;
  urgentNotices?: number;
  criticalNotifications?: number;
}) {
  const critical = Number(input.criticalNotifications || 0);
  const urgent = Number(input.urgentNotices || 0);
  const offline = Number(input.offlineDevices || 0);
  const maintenance = Number(input.openMaintenance || 0);
  const visitors = Number(input.pendingVisitors || 0);
  if (critical > 0 || urgent > 1) return { home_health: "Critical Attention Required", attention_level: "critical" };
  if (offline > 0 || maintenance > 0 || visitors > 0 || urgent > 0) return { home_health: "Needs Attention", attention_level: "attention" };
  return { home_health: "Excellent", attention_level: "calm" };
}

function humanStatus(value: any) {
  const status = String(value || "").replace(/_/g, " ").trim();
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Updated";
}

function humanizeInternalEvent(row: any) {
  const action = String(row?.action || row?.type || row?.payload?.kind || "").toLowerCase();
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : row?.payload && typeof row.payload === "object" ? row.payload : {};
  const title = row?.title || row?.message || row?.summary || "";
  const resource = String(row?.resource_type || row?.category || "").toLowerCase();
  const deviceName = cleanName(meta.device_name || meta.name || row?.device_name, "Device");
  const sceneName = cleanName(meta.scene_name || meta.name || title, "Scene");
  const maintenanceTitle = cleanName(meta.title || title, "Maintenance request");
  const visitorName = cleanName(meta.visitor_name || meta.name || title, "Visitor");

  if (/ai\.tool|ai\.command|ai\.response|support_mutation|tool/.test(action)) return null;
  if (/device.*command|device\.state|device\.status|device/.test(action) || resource === "device") {
    const command = meta.command && typeof meta.command === "object" ? meta.command : {};
    const state = command.switch === true || command.power === true || command.on === true ? "turned on" : command.switch === false || command.power === false || command.on === false ? "turned off" : "updated";
    return { category: "devices", title: `${deviceName} ${state}`, summary: "Device activity", timestamp: row.created_at || row.occurred_at };
  }
  if (/scene/.test(action) || resource === "scene") {
    return { category: "scenes", title: `${sceneName} scene activated`, summary: "Scene activity", timestamp: row.created_at || row.occurred_at };
  }
  if (/maintenance|support/.test(action) || resource.includes("maintenance")) {
    return { category: "maintenance", title: maintenanceTitle, summary: humanStatus(row?.status || "Maintenance updated"), timestamp: row.created_at || row.updated_at };
  }
  if (/visitor|access|gate/.test(action) || resource.includes("visitor")) {
    return { category: "visitors", title: visitorName, summary: humanStatus(row?.status || "Visitor access updated"), timestamp: row.created_at || row.updated_at };
  }
  if (/community|post|comment|announcement/.test(action) || resource.includes("community")) {
    return { category: "community", title: cleanName(title, "Community update"), summary: "Community update", timestamp: row.created_at || row.updated_at };
  }
  if (/security|incident|alert/.test(action) || resource.includes("incident")) {
    return { category: "security", title: cleanName(title, "Security update"), summary: humanStatus(row?.status || "Security update"), timestamp: row.created_at || row.updated_at };
  }
  return null;
}

async function safeWatchStatus(actor: AuthUser) {
  try {
    const mod = await import("../services/watchAdapterService");
    return mod.getWatchStatus(actor);
  } catch {
    return null;
  }
}

async function homeContext(actor: AuthUser, estateId?: string | null, homeId?: string | null) {
  const resolvedHomeId = actorHome(actor, homeId || null);
  const resolvedEstateId = actorEstate(actor, estateId || null);
  const [home, estate] = await Promise.all([
    resolvedHomeId ? selectRows("homes", (q) => q.select("id,name,unit,block,estate_id").eq("id", resolvedHomeId).limit(1)) : Promise.resolve({ available: true, rows: [], error: "" }),
    resolvedEstateId ? selectRows("estates", (q) => q.select("id,name").eq("id", resolvedEstateId).limit(1)) : Promise.resolve({ available: true, rows: [], error: "" }),
  ]);
  const homeRow = home.rows[0] || null;
  const estateRow = estate.rows[0] || null;
  return {
    estateId: resolvedEstateId || homeRow?.estate_id || null,
    homeId: resolvedHomeId || null,
    home: homeRow,
    estate: estateRow,
  };
}

async function summarizeHomeStateTool(actor: AuthUser) {
  const ctx = await homeContext(actor);
  const deviceFilter = (q: any) => {
    let next = q.select("id,name,category,type,status,home_id,estate_id,metadata,online,is_online,connected,updated_at").limit(100);
    if (ctx.estateId) next = next.eq("estate_id", ctx.estateId);
    if (ctx.homeId) next = next.eq("home_id", ctx.homeId);
    return next;
  };
  const [rooms, devices, notifications, maintenance, visitors, community, watch] = await Promise.all([
    ctx.homeId ? selectRows("rooms", (q) => q.select("id,name,type").eq("home_id", ctx.homeId).limit(80)) : Promise.resolve({ available: true, rows: [], error: "" }),
    selectRows("devices", deviceFilter),
    selectRows("notifications", (q) => q.select("id,title,message,type,status,created_at,payload").eq("user_id", actor.id).order("created_at", { ascending: false }).limit(50)),
    selectRows("maintenance_requests", (q) => {
      let next = q.select("id,title,status,created_at,updated_at").order("updated_at", { ascending: false, nullsFirst: false }).limit(30);
      if (ctx.homeId) next = next.eq("home_id", ctx.homeId);
      else if (ctx.estateId) next = next.eq("estate_id", ctx.estateId);
      return next;
    }),
    selectRows("visitor_access", (q) => {
      let next = q.select("id,visitor_name,name,status,created_at,updated_at,expires_at,home_id,estate_id").order("created_at", { ascending: false }).limit(30);
      if (ctx.homeId) next = next.eq("home_id", ctx.homeId);
      else if (ctx.estateId) next = next.eq("estate_id", ctx.estateId);
      return next;
    }),
    ctx.estateId ? selectRows("community_posts", (q) => q.select("id,title,body,category,priority,is_pinned,status,created_at,updated_at").eq("estate_id", ctx.estateId).neq("status", "deleted").order("created_at", { ascending: false }).limit(20)) : Promise.resolve({ available: true, rows: [], error: "" }),
    safeWatchStatus(actor),
  ]);
  const normalizedDevices = devices.rows.map((row: any) => ({ ...row, runtime: normalizeDeviceOnlineState(row) }));
  const offline = normalizedDevices.filter((row: any) => row.runtime.state === "offline").length;
  const online = normalizedDevices.filter((row: any) => row.runtime.state === "online").length;
  const favorites = normalizedDevices.filter((row: any) => Boolean(row?.metadata?.favorite)).slice(0, 6);
  const unread = notifications.rows.filter(isUnread);
  const openMaintenance = maintenance.rows.filter((row: any) => !/completed|closed|resolved|cancelled/.test(String(row.status || "").toLowerCase()));
  const activeVisitors = visitors.rows.filter((row: any) => /active|approved|checked_in|pending/.test(String(row.status || "").toLowerCase()));
  const urgentNotices = community.rows.filter((row: any) => /urgent|critical|security|emergency/.test(`${row.priority || ""} ${row.category || ""} ${row.title || ""}`.toLowerCase())).slice(0, 5);
  const homeName = shortText(ctx.home?.name || [ctx.home?.block, ctx.home?.unit].filter(Boolean).join(" "), "your home", 80);
  const estateName = shortText(ctx.estate?.name, "your estate", 80);
  return {
    summary: `${homeName} has ${normalizedDevices.length} device${normalizedDevices.length === 1 ? "" : "s"}, ${offline} offline, ${openMaintenance.length} open maintenance request${openMaintenance.length === 1 ? "" : "s"}, and ${unread.length} unread update${unread.length === 1 ? "" : "s"}.`,
    data: {
      cards: [
        structuredCard("home_summary", "Home summary", `${estateName} • ${homeName}`, [
          { label: "Rooms", value: rooms.rows.length },
          { label: "Devices", value: normalizedDevices.length },
          { label: "Online", value: online },
          { label: "Offline", value: offline },
          { label: "Unread activity", value: unread.length },
          { label: "Open maintenance", value: openMaintenance.length },
          { label: "Active visitors", value: activeVisitors.length },
        ]),
        ...(favorites.length ? [structuredCard("favorite_devices", "Favorite devices", "Frequently used devices in this home.", favorites.map((row: any) => ({ title: row.name || "Device", subtitle: normalizeDeviceOnlineState(row).state })))] : []),
        ...(urgentNotices.length ? [structuredCard("urgent_notices", "Urgent notices", "Important community updates.", urgentNotices.map((row: any) => ({ title: row.title || "Notice", subtitle: row.category || row.priority || "Community", timestamp: row.created_at })))] : []),
        structuredCard("watch_status", "Oyi Watch", watch?.scoped ? `${watch.quick_action_count || 0} quick action${watch.quick_action_count === 1 ? "" : "s"} ready.` : "Open Oyi on iPhone to sync Watch.", [{ label: "Scoped", value: Boolean(watch?.scoped) }, { label: "Quick actions", value: watch?.quick_action_count || 0 }]),
      ],
      sources: [sourceLabel("Home context"), sourceLabel("Notifications", notifications.rows[0]?.created_at), sourceLabel("Maintenance", maintenance.rows[0]?.updated_at || maintenance.rows[0]?.created_at)],
      suggested_actions: [
        suggestedAction("Open Activity", "/activity"),
        ...(openMaintenance.length ? [suggestedAction("View Maintenance", "/maintenance")] : []),
        ...(offline ? [suggestedAction("Open Devices", "/devices")] : []),
        ...(activeVisitors.length ? [suggestedAction("Open Visitors", "/visitors")] : []),
      ],
    },
  };
}

function cardItemValue(card: any, label: string) {
  const item = (Array.isArray(card?.items) ? card.items : []).find((entry: any) => String(entry?.label || entry?.title || "").toLowerCase() === label.toLowerCase());
  const value = item?.value;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function summarizeHomeAwarenessTool(actor: AuthUser) {
  const homeState = await summarizeHomeStateTool(actor);
  const cards = Array.isArray(homeState.data?.cards) ? homeState.data.cards : [];
  const home = cards.find((card: any) => card.type === "home_summary");
  const community = cards.find((card: any) => card.type === "urgent_notices");
  const offlineDevices = cardItemValue(home, "Offline");
  const onlineDevices = cardItemValue(home, "Online");
  const openMaintenance = cardItemValue(home, "Open maintenance");
  const activeVisitors = cardItemValue(home, "Active visitors");
  const unreadActivity = cardItemValue(home, "Unread activity");
  const urgentNotices = Array.isArray(community?.items) ? community.items.length : 0;
  const health = healthFromCounts({ offlineDevices, openMaintenance, pendingVisitors: 0, urgentNotices, criticalNotifications: 0 });
  const highlights = compactLines([
    onlineDevices ? `${onlineDevices} monitored device${onlineDevices === 1 ? " is" : "s are"} online.` : "No online device signal is visible yet.",
    offlineDevices ? `${offlineDevices} device${offlineDevices === 1 ? " appears" : "s appear"} offline.` : "No offline devices are visible.",
    openMaintenance ? `${openMaintenance} maintenance request${openMaintenance === 1 ? " is" : "s are"} open.` : "No maintenance requests require attention.",
    activeVisitors ? `${activeVisitors} visitor${activeVisitors === 1 ? " is" : "s are"} active or pending.` : "No visitors are waiting.",
    urgentNotices ? `${urgentNotices} urgent community notice${urgentNotices === 1 ? " is" : "s are"} visible.` : "",
  ]);
  const summary = health.attention_level === "calm"
    ? "Your home is calm. No visible maintenance, visitor, device, or security item needs attention."
    : health.attention_level === "critical"
      ? "Your home needs immediate attention based on the latest visible signals."
      : "Your home needs some attention based on the latest visible signals.";
  const recommended = compactLines([
    offlineDevices ? "Check Devices for offline equipment." : "",
    openMaintenance ? "Review Maintenance for the open request." : "",
    activeVisitors ? "Open Visitors to review active or pending access." : "",
    unreadActivity || urgentNotices ? "Open Activity for the latest updates." : "",
  ]);
  return {
    summary,
    data: {
      home_health: health.home_health,
      attention_level: health.attention_level,
      highlights,
      recommended_actions: recommended,
      cards: [
        structuredCard("home_awareness", "Home awareness", summary, [
          { label: "Home health", value: health.home_health },
          { label: "Attention", value: titleCase(health.attention_level) },
          { label: "Online devices", value: onlineDevices },
          { label: "Offline devices", value: offlineDevices },
          { label: "Open maintenance", value: openMaintenance },
          { label: "Active visitors", value: activeVisitors },
        ]),
        ...cards.filter((card: any) => ["urgent_notices", "watch_status"].includes(String(card.type))),
      ],
      sources: homeState.data?.sources || [],
      suggested_actions: [
        ...(openMaintenance ? [suggestedAction("Review Maintenance", "/maintenance")] : []),
        ...(offlineDevices ? [suggestedAction("Open Devices", "/devices")] : []),
        ...(activeVisitors ? [suggestedAction("Open Visitors", "/visitors")] : []),
        suggestedAction("Open Activity", "/activity"),
      ],
    },
  };
}

function eventBucket(row: any) {
  const text = `${row?.category || ""} ${row?.type || ""} ${row?.title || ""} ${row?.summary || ""} ${row?.message || ""} ${row?.payload?.kind || ""}`.toLowerCase();
  if (/critical|urgent|emergency|security|alert|lockdown|alarm/.test(text)) return "urgent";
  if (/device|switch|light|ac|tv|scene|automation/.test(text)) return /scene|automation/.test(text) ? "scenes" : "devices";
  if (/visitor|guest|gate/.test(text)) return "visitors";
  if (/maintenance|repair|ticket|support/.test(text)) return "maintenance";
  if (/community|announcement|notice|post|comment/.test(text)) return "community";
  if (/message|thread|chat|dm/.test(text)) return "messages";
  if (/wallet|payment|service|transaction/.test(text)) return "wallet_services";
  return "security";
}

async function summarizeRecentActivityTool(actor: AuthUser) {
  const feed = await selectRows("notifications", (q) => q.select("id,title,message,type,status,created_at,payload,entity_id").eq("user_id", actor.id).order("created_at", { ascending: false }).limit(60));
  const audit = await selectRows("audit_events", (q) => {
    let next = q.select("id,action,resource_type,resource_id,status,created_at,metadata,home_id,estate_id").order("created_at", { ascending: false }).limit(40);
    if (actor.estate_id) next = next.eq("estate_id", actor.estate_id);
    if (actor.home_id) next = next.eq("home_id", actor.home_id);
    return next;
  });
  const notificationRows = feed.rows
    .filter((row: any) => rowMatchesActorScope(actor, row))
    .map((row: any) => ({
      ...row,
      title: cleanName(row.title, "Home update"),
      summary: shortText(row.message || row.type, "Home update", 140),
      source_label: "Activity",
    }));
  const humanizedAuditRows = audit.rows
    .map(humanizeInternalEvent)
    .filter(Boolean)
    .map((row: any) => ({
      ...row,
      created_at: row.timestamp,
      source_label: "Activity",
    }));
  const rows = [...notificationRows, ...humanizedAuditRows]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 40);
  const groups = rows.reduce<Record<string, any[]>>((acc, row) => {
    const key = row.category || eventBucket(row);
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  }, {});
  const order = ["security", "devices", "visitors", "maintenance", "community", "scenes", "automations", "wallet_services", "messages", "urgent"];
  const cards = order
    .filter((key) => groups[key]?.length)
    .map((key) => structuredCard(key, key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), `${groups[key].length} home update${groups[key].length === 1 ? "" : "s"}.`, groups[key].slice(0, 5).map((row: any) => ({
      title: shortText(row.title, "Activity", 90),
      subtitle: shortText(row.summary || row.message, "Home update", 120),
      timestamp: row.created_at,
      severity: /urgent|critical|failed|error|security|alert/.test(`${row.title} ${row.summary}`.toLowerCase()) ? "attention" : "info",
    }))));
  return {
    summary: rows.length ? `Your home has recent activity across ${Object.keys(groups).length} area${Object.keys(groups).length === 1 ? "" : "s"}.` : "No activity yet. Your home updates will appear here.",
    data: {
      cards: cards.length ? cards : [structuredCard("recent_activity", "Recent activity", "No activity yet. Your home updates will appear here.", [])],
      sources: rows.slice(0, 6).map((row: any) => sourceLabel(row.source_label || "Activity", row.created_at)),
      suggested_actions: [suggestedAction("Open Activity", "/activity"), ...(groups.urgent?.length || groups.security?.length ? [suggestedAction("Review attention items", "/activity?filter=attention")] : [])],
    },
  };
}

async function summarizeVisitorsTool(actor: AuthUser) {
  const ctx = await homeContext(actor);
  const visitors = await selectRows("visitor_access", (q) => {
    let next = q.select("*").order("created_at", { ascending: false }).limit(50);
    if (ctx.homeId) next = next.eq("home_id", ctx.homeId);
    else if (ctx.estateId) next = next.eq("estate_id", ctx.estateId);
    return next;
  });
  const now = Date.now();
  const active = visitors.rows.filter((row: any) => /active|approved|checked_in/.test(String(row.status || "").toLowerCase()));
  const pending = visitors.rows.filter((row: any) => /pending|requested/.test(String(row.status || "").toLowerCase()));
  const expired = visitors.rows.filter((row: any) => /expired/.test(String(row.status || "").toLowerCase()) || (row.expires_at && new Date(row.expires_at).getTime() < now));
  return {
    summary: visitors.rows.length ? `${active.length} active visitor${active.length === 1 ? "" : "s"}, ${pending.length} pending, ${expired.length} expired.` : "No visitor activity is visible right now.",
    data: {
      cards: [structuredCard("visitors", "Visitors", "Resident-visible visitor state.", [
        { label: "Active", value: active.length },
        { label: "Pending", value: pending.length },
        { label: "Recent", value: visitors.rows.slice(0, 10).length },
        { label: "Expired", value: expired.length },
      ]), structuredCard("recent_visitors", "Recent visitors", "Latest visitor records.", visitors.rows.slice(0, 5).map((row: any) => ({ entity_id: row.id, visitor_id: row.id, title: row.visitor_name || row.name || "Visitor", subtitle: row.status || "updated", timestamp: row.created_at })))],
      conversation_entities: visitors.rows.slice(0, 50).map((row: any) => ({ type: "visitor", id: row.id, title: row.visitor_name || row.name || "Visitor", status: row.status || "updated", details: { created_at: row.created_at || null, updated_at: row.updated_at || null, reported_by: row.created_by_name || row.created_by || null } })),
      sources: visitors.rows.slice(0, 4).map((row: any) => sourceLabel("Visitor", row.created_at)),
      suggested_actions: [suggestedAction("Open Visitors", "/visitors")],
    },
  };
}

async function summarizeMaintenanceTool(actor: AuthUser) {
  const ctx = await homeContext(actor);
  const rows = await selectRows("maintenance_requests", (q) => {
    let next = q.select("*").order("updated_at", { ascending: false, nullsFirst: false }).limit(50);
    if (ctx.homeId) next = next.eq("home_id", ctx.homeId);
    else if (ctx.estateId) next = next.eq("estate_id", ctx.estateId);
    return next;
  });
  const open = rows.rows.filter((row: any) => /open|new|assigned|scheduled|in_progress|waiting/.test(String(row.status || "").toLowerCase()));
  const waiting = rows.rows.filter((row: any) => /resident|waiting/.test(String(row.status || "").toLowerCase()));
  const progress = rows.rows.filter((row: any) => /progress|assigned|scheduled/.test(String(row.status || "").toLowerCase()));
  const completed = rows.rows.filter((row: any) => /completed|closed|resolved/.test(String(row.status || "").toLowerCase())).slice(0, 5);
  return {
    summary: rows.rows.length ? `${open.length} maintenance request${open.length === 1 ? "" : "s"} open. ${waiting.length ? `${waiting.length} waiting on resident response.` : ""}`.trim() : "No maintenance requests are visible right now.",
    data: {
      cards: [structuredCard("maintenance", "Maintenance", "Current maintenance posture.", [
        { label: "Open", value: open.length },
        { label: "Waiting resident", value: waiting.length },
        { label: "In progress", value: progress.length },
        { label: "Completed recently", value: completed.length },
      ]), structuredCard("latest_maintenance", "Latest update", rows.rows[0]?.title || "No latest update.", rows.rows.slice(0, 5).map((row: any) => ({ entity_id: row.id, maintenance_id: row.id, title: row.title || "Maintenance request", subtitle: row.status || "open", timestamp: row.updated_at || row.created_at })))],
      conversation_entities: rows.rows.slice(0, 50).map((row: any) => ({ type: "maintenance", id: row.id, title: row.title || "Maintenance request", status: row.status || "open", details: { created_at: row.created_at || null, updated_at: row.updated_at || null, reported_by: row.reported_by_name || row.created_by_name || row.created_by || null, summary: row.description || row.details || null } })),
      sources: rows.rows.slice(0, 4).map((row: any) => sourceLabel("Maintenance request", row.updated_at || row.created_at)),
      suggested_actions: [suggestedAction("Open Maintenance", "/maintenance")],
    },
  };
}

async function summarizeCommunityTool(actor: AuthUser) {
  const ctx = await homeContext(actor);
  if (!ctx.estateId) return { summary: "I do not have estate community context yet.", data: { cards: [], sources: [], suggested_actions: [] } };
  const rows = await selectRows("community_posts", (q) => q.select("id,title,body,content,category,priority,is_pinned,status,created_at,updated_at").eq("estate_id", ctx.estateId).neq("status", "deleted").order("created_at", { ascending: false }).limit(50));
  const unread = await selectRows("notifications", (q) => q.select("id,title,message,type,status,created_at").eq("user_id", actor.id).order("created_at", { ascending: false }).limit(50));
  const urgent = rows.rows.filter((row: any) => /urgent|critical|security|emergency/.test(`${row.priority || ""} ${row.category || ""} ${row.title || ""}`.toLowerCase()));
  const pinned = rows.rows.filter((row: any) => Boolean(row.is_pinned) || /pinned|announcement/.test(String(row.status || "").toLowerCase()));
  const unreadCommunity = unread.rows.filter((row: any) => isUnread(row) && /community|announcement|notice|post|comment/.test(`${row.type || ""} ${row.title || ""} ${row.message || ""}`.toLowerCase()));
  return {
    summary: rows.rows.length ? `${urgent.length} urgent notice${urgent.length === 1 ? "" : "s"}, ${pinned.length} pinned announcement${pinned.length === 1 ? "" : "s"}, and ${unreadCommunity.length} unread community update${unreadCommunity.length === 1 ? "" : "s"}.` : "No community posts are visible right now.",
    data: {
      cards: [
        structuredCard("community", "Community", "Estate communication summary.", [{ label: "Urgent", value: urgent.length }, { label: "Pinned", value: pinned.length }, { label: "Unread", value: unreadCommunity.length }]),
        structuredCard("recent_posts", "Recent posts", "Latest visible community updates.", rows.rows.slice(0, 5).map((row: any) => ({ title: row.title || row.content || row.body || "Community update", subtitle: row.category || row.priority || "Post", timestamp: row.created_at }))),
      ],
      sources: rows.rows.slice(0, 4).map((row: any) => sourceLabel("Community notice", row.created_at)),
      suggested_actions: [suggestedAction("Open Community", "/community")],
    },
  };
}

async function summarizeWatchStatusTool(actor: AuthUser) {
  const status = await safeWatchStatus(actor);
  return {
    summary: status?.scoped ? `Oyi Watch has ${status.quick_action_count || 0} quick action${status.quick_action_count === 1 ? "" : "s"} ready.` : "Open Oyi on your iPhone to sync Oyi Watch.",
    data: {
      cards: [structuredCard("watch_status", "Oyi Watch", status?.scoped ? "Watch context is available." : "Watch context is not synced yet.", [
        { label: "Home context", value: Boolean(status?.home_context_available) },
        { label: "Estate context", value: Boolean(status?.estate_context_available) },
        { label: "Quick actions", value: status?.quick_action_count || 0 },
        { label: "Disabled actions", value: status?.disabled_action_count || 0 },
      ])],
      sources: [sourceLabel("Watch status", status?.generated_at)],
      suggested_actions: [suggestedAction("Open Connected Systems", "/devices/integrations")],
    },
  };
}

function sceneNameFromPrompt(prompt: string, args: Record<string, any>) {
  const explicit = args.scene_name || args.sceneName || args.name || args.title;
  if (explicit) return shortText(explicit, "", 120);
  return String(prompt || "")
    .replace(/\b(run|start|activate|execute|turn on|please|scene)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function maintenancePayloadFromPrompt(prompt: string, args: Record<string, any>) {
  const raw = shortText(args.description || args.summary || prompt, "", 900);
  const categorySource = `${args.category || ""} ${raw}`.toLowerCase();
  const category =
    /ac|air|climate|hvac|cooling/.test(categorySource) ? "hvac" :
    /water|leak|plumb|pipe/.test(categorySource) ? "plumbing" :
    /power|light|electric|socket/.test(categorySource) ? "electrical" :
    /security|gate|door|lock/.test(categorySource) ? "security" :
    "general";
  const cleanedPromptTitle = raw
    .replace(/^create\s+(a\s+)?maintenance\s+(request|ticket)?\s*(for|about)?\s*/i, "")
    .replace(/^open\s+(a\s+)?maintenance\s+(request|ticket)?\s*(for|about)?\s*/i, "")
    .replace(/^raise\s+(a\s+)?maintenance\s+(request|ticket)?\s*(for|about)?\s*/i, "")
    .replace(/^log\s+(a\s+)?maintenance\s+(request|ticket)?\s*(for|about)?\s*/i, "")
    .replace(/^file\s+(a\s+)?maintenance\s+(request|ticket)?\s*(for|about)?\s*/i, "")
    .trim();
  const rawTitle = String(args.title || "").trim();
  const titleSource = /^create\s+maintenance|^create\s+a\s+maintenance|^open\s+maintenance|^raise\s+maintenance|^log\s+maintenance|^file\s+maintenance/i.test(rawTitle)
    ? cleanedPromptTitle
    : rawTitle || cleanedPromptTitle;
  const title = shortText(titleSource, "Maintenance request", 120);
  return {
    title,
    category,
    description: raw || title,
    room_id: args.room_id || args.roomId || null,
    device_id: args.device_id || args.deviceId || null,
  };
}

function sceneActionCommand(action: any) {
  const key = String(action?.command_key || action?.key || action?.command || action?.type || "").toLowerCase();
  const value = action?.value ?? action?.command_value ?? action?.state ?? action?.payload?.value;
  if (["switch", "power", "on"].includes(key)) return { switch: value === undefined ? true : Boolean(value) };
  if (["off"].includes(key)) return { switch: false };
  if (["temperature", "temp_set"].includes(key)) {
    const temp = Number(value ?? action?.temperature);
    return Number.isFinite(temp) ? { temperature: temp, temp_set: temp } : null;
  }
  if (action?.command && typeof action.command === "object") return action.command;
  return null;
}

function normalizeSceneName(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/\bscene\b/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sceneSearchText(scene: any) {
  return normalizeSceneName(`${scene?.name || ""} ${scene?.title || ""} ${scene?.mood || ""} ${Array.isArray(scene?.aliases) ? scene.aliases.join(" ") : ""}`);
}

function sceneSimilarity(requested: string, scene: any) {
  const target = sceneSearchText(scene);
  if (!requested || !target) return 0;
  if (target === requested) return 100;
  if (target.includes(requested) || requested.includes(target)) return 80;
  const words = requested.split(" ").filter((word) => word.length > 2);
  return words.reduce((score, word) => score + (target.includes(word) ? 8 : 0), 0);
}

function cleanConsumerSceneActions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item: any) => ({
    device_id: String(item?.device_id || item?.deviceId || "").trim(),
    command: item?.command && typeof item.command === "object" ? item.command : {},
  })).filter((item) => item.device_id && Object.keys(item.command).length);
}

function safeConsumerSceneCommand(command: Record<string, any>) {
  const keys = Object.keys(command || {});
  return keys.length > 0 && keys.every((key) => ["switch", "power", "on", "temperature", "temp_set"].includes(key));
}

function sceneNeedsConfirmation(scene: any, actions: any[]) {
  const text = `${scene?.name || ""} ${scene?.title || ""} ${scene?.category || ""} ${JSON.stringify(actions || [])}`.toLowerCase();
  return /security|lock|gate|door|alarm|access/.test(text);
}

async function findSceneForPrompt(actor: AuthUser, prompt: string, args: Record<string, any>) {
  const ctx = await homeContext(actor, args.estate_id || args.estateId || null, args.home_id || args.homeId || null);
  const explicitId = args.scene_id || args.sceneId || args.id;
  const requested = normalizeSceneName(sceneNameFromPrompt(prompt, args));
  const consumerScenes = await selectRows("consumer_scenes", (q) => {
    let next = q.select("*").order("updated_at", { ascending: false, nullsFirst: false }).limit(80);
    if (explicitId) return next.eq("id", explicitId).limit(1);
    if (ctx.homeId) next = next.eq("home_id", ctx.homeId);
    else if (ctx.estateId) next = next.eq("estate_id", ctx.estateId);
    return next;
  });
  const legacyScenes = await selectRows("scenes", (q) => {
    let next = q.select("*").order("updated_at", { ascending: false, nullsFirst: false }).limit(80);
    if (explicitId) return next.eq("id", explicitId).limit(1);
    if (ctx.homeId) next = next.eq("home_id", ctx.homeId);
    else if (ctx.estateId) next = next.eq("estate_id", ctx.estateId);
    return next;
  });
  const scenes = [
    ...consumerScenes.rows.map((scene: any) => ({ ...scene, __oyi_scene_source: "consumer_scenes" })),
    ...legacyScenes.rows.map((scene: any) => ({ ...scene, __oyi_scene_source: "scenes" })),
  ];
  if (!scenes.length) return { scene: null, ctx, reason: "scene_not_found", matches: [] };
  if (explicitId) return { scene: scenes[0] || null, ctx, reason: scenes[0] ? "" : "scene_not_found", matches: [] };
  const scored = scenes
    .map((scene: any) => ({ scene, score: sceneSimilarity(requested, scene) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    const suggestions = scenes
      .map((scene: any) => ({ scene, score: sceneSimilarity(requested.split(" ")[0] || requested, scene) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => item.scene);
    return { scene: null, ctx, reason: "scene_not_found", matches: suggestions };
  }
  const top = scored[0].score;
  const matches = scored.filter((item) => item.score === top).map((item) => item.scene);
  if (matches.length > 1) return { scene: null, ctx, reason: "scene_ambiguous", matches: matches.slice(0, 5) };
  return { scene: matches[0], ctx, reason: "" };
}

async function executeScene(actor: AuthUser, scene: any, req?: Request) {
  if (scene.__oyi_scene_source === "consumer_scenes") {
    const actions = cleanConsumerSceneActions(scene.actions);
    if (!actions.length) {
      return { ok: false, status: "failed" as AiCommandStatus, summary: `${sceneDisplayName(scene)} has no configured actions yet.`, error: "scene_has_no_actions" };
    }
    const results = [];
    for (const action of actions) {
      if (!safeConsumerSceneCommand(action.command)) {
        results.push({ device_id: action.device_id, status: "denied", reason: "unsupported_scene_action" });
        continue;
      }
      const device = await resolveVisibleDevice(actor, action.device_id);
      if (!device || !deviceWithinActorScope(actor, device) || deviceOffline(device)) {
        results.push({ device_id: action.device_id, status: "skipped", reason: "device_unavailable" });
        continue;
      }
      try {
        const result = await executeDeviceCommandForActor({ actor, deviceId: action.device_id, command: action.command, source: "scene", req });
        results.push({ device_id: action.device_id, status: result.status });
      } catch (error: any) {
        results.push({ device_id: action.device_id, status: "failed", reason: error?.message || "command_failed" });
      }
    }
    const completed = results.filter((item) => item.status === "command_queued" || item.status === "command_executed" || item.status === "executed" || item.status === "success").length;
    await emitAuditEvent({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "scene.executed",
      resourceType: "scene",
      resourceId: String(scene.id),
      estateId: scene.estate_id || actor.estate_id,
      homeId: scene.home_id || actor.home_id,
      status: completed ? "success" : "failed",
      metadata: { source: "oyi_intelligence", scene_name: sceneDisplayName(scene), results },
      req,
    } as any);
    return {
      ok: Boolean(completed),
      status: completed ? "executed" as AiCommandStatus : "failed" as AiCommandStatus,
      summary: completed ? `${sceneDisplayName(scene)} scene activated.` : `${sceneDisplayName(scene)} could not run right now.`,
      data: { scene_id: scene.id, results },
      error: completed ? "" : "scene_execution_failed",
    };
  }
  const actions = await selectRows("scene_actions", (q) => q.select("*").eq("scene_id", scene.id).order("position", { ascending: true }).limit(50));
  if (!actions.rows.length) {
    return { ok: false, status: "failed" as AiCommandStatus, summary: "That scene has no configured actions yet.", error: "scene_has_no_actions" };
  }
  const results = [];
  for (const action of actions.rows) {
    const deviceId = action.device_id || action.deviceId;
    const command = sceneActionCommand(action);
    if (!deviceId || !command) {
      results.push({ device_id: deviceId || null, status: "skipped", reason: "action_not_supported" });
      continue;
    }
    const device = await resolveVisibleDevice(actor, deviceId);
    if (!device || !deviceWithinActorScope(actor, device) || deviceOffline(device)) {
      results.push({ device_id: deviceId, status: "skipped", reason: "device_unavailable" });
      continue;
    }
    try {
      const result = await executeDeviceCommandForActor({ actor, deviceId: String(device.id || device.external_id), command, source: "scene", req });
      results.push({ device_id: device.id || deviceId, status: result.status, command });
    } catch (error: any) {
      results.push({ device_id: deviceId, status: "failed", reason: error?.message || "command_failed" });
    }
  }
  const completed = results.filter((item) => item.status === "command_queued" || item.status === "command_executed" || item.status === "executed" || item.status === "success").length;
  await emitAuditEvent({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "scene.executed",
    resourceType: "scene",
    resourceId: String(scene.id),
    estateId: scene.estate_id || actor.estate_id,
    homeId: scene.home_id || actor.home_id,
    status: completed ? "success" : "failed",
    metadata: { source: "oyi_intelligence", results },
    req,
  } as any);
  return {
    ok: Boolean(completed),
    status: completed ? "executed" as AiCommandStatus : "failed" as AiCommandStatus,
    summary: completed ? `${sceneDisplayName(scene)} scene activated.` : `${sceneDisplayName(scene)} could not run right now.`,
    data: { scene_id: scene.id, results },
    error: completed ? "" : "scene_execution_failed",
  };
}

async function executeRunSceneTool(req: Request | undefined, actor: AuthUser, prompt: string, args: Record<string, any>) {
  const found = await findSceneForPrompt(actor, prompt, args);
  if (!found.scene) {
    const names = (found.matches || []).map((scene: any) => sceneDisplayName(scene)).filter(Boolean);
    const summary = found.reason === "scene_ambiguous"
      ? `I found more than one matching scene: ${names.join(", ")}. Which one should I run?`
      : names.length
        ? `I couldn't find that exact scene. Did you mean: ${names.join(", ")}?`
        : "I could not find that scene in your home.";
    const ledger = await writeLedger({ actor, toolId: "run_scene", prompt, status: "failed", estateId: found.ctx.estateId, homeId: found.ctx.homeId, errorMessage: found.reason, resultSummary: summary });
    return { tool_id: "run_scene", status: "failed", ledger_id: ledger.id || null, summary, error: found.reason, data: { suggestions: names } };
  }
  const actionRows = found.scene.__oyi_scene_source === "consumer_scenes"
    ? cleanConsumerSceneActions(found.scene.actions)
    : (await selectRows("scene_actions", (q) => q.select("*").eq("scene_id", found.scene.id).limit(50))).rows;
  if (sceneNeedsConfirmation(found.scene, actionRows)) {
    const ledger = await writeLedger({
      actor,
      toolId: "run_scene",
      prompt,
      status: "pending_confirmation",
      estateId: found.ctx.estateId,
      homeId: found.ctx.homeId,
      resultSummary: "I need confirmation before running this scene.",
      metadata: { proposed_arguments: { scene_id: found.scene.id }, scene_id: found.scene.id, scene_name: sceneDisplayName(found.scene), action_count: actionRows.length },
    });
    await audit(req, actor, "ai.command.confirmation.required", "pending", { tool_id: "run_scene", ledger_id: ledger.id, scene_id: found.scene.id });
    return { tool_id: "run_scene", status: "pending_confirmation", confirmation_required: true, ledger_id: ledger.id || null, summary: "I need confirmation before running this scene." };
  }
  const result = await executeScene(actor, found.scene, req);
  const ledger = await writeLedger({ actor, toolId: "run_scene", prompt, status: result.status, estateId: found.ctx.estateId, homeId: found.ctx.homeId, resultSummary: result.summary, errorMessage: result.error || "", metadata: { scene_id: found.scene.id, result: result.data } });
  return { tool_id: "run_scene", status: result.status, ledger_id: ledger.id || null, summary: result.summary, data: result.data, error: result.error };
}

async function createMaintenanceRequestTool(req: Request | undefined, actor: AuthUser, prompt: string, args: Record<string, any>) {
  const ctx = await homeContext(actor, args.estate_id || args.estateId || null, args.home_id || args.homeId || null);
  if (!ctx.homeId && actor.role === "resident") {
    const ledger = await writeLedger({ actor, toolId: "create_maintenance_request", prompt, status: "denied", estateId: ctx.estateId, homeId: ctx.homeId, errorMessage: "home_context_required", resultSummary: "I need your active home before creating a maintenance request." });
    return { tool_id: "create_maintenance_request", status: "denied", ledger_id: ledger.id || null, summary: "I need your active home before creating a maintenance request.", error: "home_context_required" };
  }
  const payload = maintenancePayloadFromPrompt(prompt, args);
  const now = new Date().toISOString();
  const row = {
    estate_id: ctx.estateId || actor.estate_id || null,
    home_id: ctx.homeId || actor.home_id || null,
    resident_id: actor.id,
    user_id: actor.id,
    title: payload.title,
    description: payload.description,
    category: payload.category,
    status: "open",
    priority: "medium",
    room_id: payload.room_id,
    device_id: payload.device_id,
    created_at: now,
    updated_at: now,
  };
  let data: any = null;
  let error: any = null;
  const attempts = [
    row,
    { ...row, user_id: undefined },
    { ...row, user_id: undefined, room_id: undefined, device_id: undefined },
    { estate_id: row.estate_id, home_id: row.home_id, resident_id: row.resident_id, title: row.title, description: row.description, category: row.category, status: row.status, priority: row.priority, created_at: row.created_at, updated_at: row.updated_at },
  ];
  for (const attempt of attempts) {
    const cleaned = Object.fromEntries(Object.entries(attempt).filter(([, value]) => value !== undefined));
    const result = await supabaseAdmin.from("maintenance_requests").insert(cleaned as any).select("*").maybeSingle();
    if (!result.error) {
      data = result.data || cleaned;
      error = null;
      break;
    }
    error = result.error;
    if (!/column|schema|Could not find|does not exist/i.test(result.error.message || "")) break;
  }
  if (error) {
    const ledger = await writeLedger({ actor, toolId: "create_maintenance_request", prompt, status: "failed", estateId: row.estate_id, homeId: row.home_id, errorMessage: error.message, resultSummary: "I could not create that maintenance request right now." });
    await audit(req, actor, "ai.action.failed", "failed", { tool_id: "create_maintenance_request", ledger_id: ledger.id, error: error.message });
    return { tool_id: "create_maintenance_request", status: "failed", ledger_id: ledger.id || null, summary: "I could not create that maintenance request right now.", error: "maintenance_create_failed" };
  }
  await emitAuditEvent({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "maintenance.request.created",
    resourceType: "maintenance_request",
    resourceId: String(data.id || ""),
    estateId: row.estate_id,
    homeId: row.home_id,
    status: "success",
    metadata: { source: "oyi_intelligence", category: payload.category },
    req,
  } as any);
  await NotificationService.sendToUser(actor.id, {
    title: "Maintenance request created",
    message: payload.title,
    type: "maintenance",
    payload: { request_id: data.id || null, source: "oyi_intelligence" },
    entityId: data.id || null,
  }).catch(() => undefined);
  const summary = compactLines([
    "Your maintenance request has been submitted.",
    `Issue: ${payload.title}.`,
    "Status: Open.",
    "The maintenance team will review it shortly.",
  ]).join("\n");
  const ledger = await writeLedger({ actor, toolId: "create_maintenance_request", prompt, status: "executed", estateId: row.estate_id, homeId: row.home_id, resultSummary: summary, metadata: { request_id: data.id || null, category: payload.category } });
  return {
    tool_id: "create_maintenance_request",
    status: "executed",
    ledger_id: ledger.id || null,
    summary,
    data: {
      cards: [structuredCard("action_result", "Maintenance Request Submitted", `Issue: ${payload.title}.`, [{ label: "Status", value: "Open" }])],
      sources: [sourceLabel("Maintenance request", data.created_at || now)],
      suggested_actions: [suggestedAction("Open Maintenance", `/maintenance?requestId=${encodeURIComponent(String(data.id || ""))}`)],
      request_id: data.id || null,
      issue: payload.title,
    },
  };
}

function moduleForPrompt(prompt: string) {
  const value = String(prompt || "").toLowerCase();
  if (/device|hardware|camera|sensor|meter/.test(value)) return "devices";
  if (/support|maintenance|ticket|complaint/.test(value)) return "support";
  if (/wallet|payment|transaction|balance/.test(value)) return "wallet";
  if (/visitor|guest|access|gate/.test(value)) return "visitors";
  if (/estate|building|home|unit|room/.test(value)) return "estate";
  if (/document|proposal|contract|invoice|report/.test(value)) return "documents";
  return "home";
}

type ModuleScope = { estateId: string | null; homeId: string | null; facility: boolean };

function moduleScope(actor: AuthUser, args: Record<string, any>): ModuleScope {
  const facility = String(args.__oyi_surface || "").toLowerCase() === "facility";
  return {
    estateId: actorEstate(actor, args.estate_id || args.estateId || null),
    homeId: facility ? null : actorHome(actor, args.home_id || args.homeId || null),
    facility,
  };
}

function modulePermission(module: string, facility = false) {
  const key = String(module || "").toLowerCase();
  if (["visitors", "security"].includes(key)) return key === "security" ? "support.read" : "visitors.create";
  if (["maintenance", "reports"].includes(key)) return "support.read";
  if (["devices", "infrastructure", "sensors"].includes(key)) return "devices.read";
  if (key === "utilities") return facility ? "devices.read" : "services.read";
  if (key === "services") return "services.read";
  if (key === "wallet") return "wallets.read";
  if (["community", "activity", "notifications"].includes(key)) return key === "community" ? "community.read" : "notifications.read";
  if (["rooms", "estate", "staff", "profile"].includes(key)) return key === "staff" ? "staff.manage" : "homes.read";
  if (["scenes", "automation"].includes(key)) return "devices.read";
  if (key === "cameras") return "cameras.view";
  return null;
}

function moduleEntity(type: string, row: any, sourceTable: string, fallback: string, details: Record<string, any> = {}) {
  const title = String(row?.title || row?.name || row?.visitor_name || row?.service_key || row?.reference || fallback).trim() || fallback;
  const status = row?.status || row?.state || row?.workflow_status
    || (row?.active === false ? "inactive" : row?.enabled === false ? "disabled" : "available");
  return {
    type,
    id: row?.id ? String(row.id) : row?.external_id ? String(row.external_id) : null,
    title,
    status: String(status),
    details: {
      created_at: row?.created_at || row?.occurred_at || row?.observed_at || null,
      updated_at: row?.updated_at || row?.occurred_at || row?.observed_at || null,
      reported_by: row?.reported_by || row?.created_by_name || row?.created_by || row?.actor_id || null,
      owner: row?.owner || row?.assigned_to || row?.assignee || null,
      source_table: sourceTable,
      summary: row?.summary || row?.description || row?.body || row?.content || null,
      ...details,
    },
  };
}

function moduleListSummary(label: string, entities: any[], scope: ModuleScope, sourceAvailable = true) {
  if (!sourceAvailable) return `The ${label} source is unavailable right now.`;
  if (!entities.length) return `There are currently no ${label} available in this ${scope.facility ? "facility" : "home"} context.`;
  return `I found ${entities.length} ${label}.\n${entities.slice(0, 5).map((entity, index) => `${index + 1}. ${entity.title} — ${entity.status}`).join("\n")}\nWhich one would you like to inspect?`;
}

async function summarizeModuleTool(actor: AuthUser, prompt: string, args: Record<string, any>) {
  const module = String(args.module || "").toLowerCase();
  const scope = moduleScope(actor, args);
  const permission = modulePermission(module, scope.facility);
  if (permission && !hasPermission(actor, permission as any)) {
    return { summary: "You do not have access to this operation under your current role.", data: { conversation_entities: [], source_available: true } };
  }
  const applyScope = (query: any, homeScoped = true) => {
    if (scope.estateId) query = query.eq("estate_id", scope.estateId);
    if (homeScoped && scope.homeId) query = query.eq("home_id", scope.homeId);
    return query;
  };
  const requested = String(prompt || "").toLowerCase();
  let result: { available: boolean; rows: any[]; error: string } = { available: true, rows: [], error: "" };
  let entities: any[] = [];
  let label = module.replace(/_/g, " ") || "records";

  if (module === "visitors") {
    result = await selectRows("visitor_access", (q) => applyScope(q.select("*").order("created_at", { ascending: false }).limit(50)));
    entities = result.rows.map((row: any) => moduleEntity("visitor", row, "visitor_access", "Visitor"));
    label = "visitor requests";
  } else if (module === "operational_queue") {
    const [maintenance, visitors, incidents] = await Promise.all([
      selectRows("maintenance_requests", (q) => applyScope(q.select("*").order("updated_at", { ascending: false }).limit(20), false)),
      selectRows("visitor_access", (q) => applyScope(q.select("*").order("created_at", { ascending: false }).limit(20), false)),
      selectRows("facility_incidents", (q) => applyScope(q.select("*").order("updated_at", { ascending: false }).limit(20), false)),
    ]);
    result = {
      available: maintenance.available || visitors.available || incidents.available,
      rows: [...maintenance.rows, ...visitors.rows, ...incidents.rows],
      error: maintenance.error || visitors.error || incidents.error,
    };
    entities = [
      ...maintenance.rows.map((row: any) => moduleEntity("maintenance", row, "maintenance_requests", "Maintenance request")),
      ...visitors.rows.map((row: any) => moduleEntity("visitor", row, "visitor_access", "Visitor request")),
      ...incidents.rows.map((row: any) => moduleEntity("security", row, "facility_incidents", "Facility incident")),
    ].sort((a, b) => new Date(String(b.details?.updated_at || b.details?.created_at || 0)).getTime() - new Date(String(a.details?.updated_at || a.details?.created_at || 0)).getTime());
    label = "recent operational requests";
  } else if (module === "maintenance") {
    result = await selectRows("maintenance_requests", (q) => applyScope(q.select("*").order("updated_at", { ascending: false }).limit(50)));
    const status = (row: any) => String(row.status || "").toLowerCase();
    const filtered = /completed|resolved|closed/.test(requested)
      ? result.rows.filter((row) => /completed|resolved|closed/.test(status(row)))
      : /open|pending|unresolved|overdue/.test(requested)
        ? result.rows.filter((row) => /open|new|assigned|scheduled|in_progress|waiting|overdue/.test(status(row)))
        : result.rows;
    entities = filtered.map((row: any) => moduleEntity("maintenance", row, "maintenance_requests", "Maintenance request", { completed_at: row.completed_at || row.resolved_at || null, handled_by: row.handled_by || row.assigned_to || null }));
    label = /completed|resolved|closed/.test(requested) ? "completed maintenance requests" : /open|pending|unresolved|overdue/.test(requested) ? "open maintenance requests" : "maintenance requests";
  } else if (module === "community") {
    const reports = /report|complaint|moderation|feedback/.test(requested);
    result = reports
      ? await selectRows("community_post_reports", (q) => applyScope(q.select("*").order("created_at", { ascending: false }).limit(50), false))
      : await selectRows("community_posts", (q) => applyScope(q.select("*").neq("status", "deleted").order("created_at", { ascending: false }).limit(50), false));
    entities = result.rows.map((row: any) => moduleEntity("community", row, reports ? "community_post_reports" : "community_posts", reports ? "Community report" : "Community update"));
    label = reports ? "community reports" : "community updates";
  } else if (module === "wallet") {
    if (scope.facility) {
      result = await selectRows("service_provider_transactions", (q) => applyScope(q.select("*").order("created_at", { ascending: false }).limit(50), false));
      entities = result.rows.map((row: any) => moduleEntity("wallet", row, "service_provider_transactions", row.service_key || "Service payment", { amount: row.amount ?? null, currency: row.currency || "NGN", provider: row.provider || null }));
      label = "facility payment records";
      return {
        summary: moduleListSummary(label, entities, scope, result.available),
        data: { conversation_entities: entities.slice(0, 50), source_available: result.available, source_table: "service_provider_transactions" },
      };
    }
    const wallets = await selectRows("wallets", (q) => q.select("*").eq("user_id", actor.id).order("updated_at", { ascending: false }).limit(10));
    const walletIds = wallets.rows.map((row: any) => row.id).filter(Boolean);
    const transactions = walletIds.length ? await selectRows("wallet_transactions", (q) => q.select("*").in("wallet_id", walletIds).order("created_at", { ascending: false }).limit(50)) : { available: wallets.available, rows: [], error: "" };
    result = { available: wallets.available || transactions.available, rows: [...wallets.rows, ...transactions.rows], error: wallets.error || transactions.error };
    const showTransactions = /transaction|payment|history|recent/.test(requested);
    entities = (showTransactions ? transactions.rows : wallets.rows).map((row: any) => moduleEntity("wallet", row, showTransactions ? "wallet_transactions" : "wallets", showTransactions ? "Wallet transaction" : "Wallet", { balance: row.balance ?? null, amount: row.amount ?? null, currency: row.currency || "NGN" }));
    label = showTransactions ? "wallet transactions" : "wallet accounts";
  } else if (module === "services" || (module === "utilities" && !scope.facility)) {
    const accounts = scope.homeId ? await selectRows("home_service_accounts", (q) => q.select("*").eq("home_id", scope.homeId).order("updated_at", { ascending: false }).limit(50)) : { available: true, rows: [], error: "" };
    const configs = scope.estateId ? await selectRows("estate_service_configs", (q) => q.select("*").eq("estate_id", scope.estateId).order("updated_at", { ascending: false }).limit(50)) : { available: true, rows: [], error: "" };
    const assignments = scope.estateId ? await selectRows("home_service_assignments", (q) => applyScope(q.select("*").order("updated_at", { ascending: false }).limit(50), !scope.facility)) : { available: true, rows: [], error: "" };
    result = { available: accounts.available || configs.available || assignments.available, rows: [...accounts.rows, ...configs.rows, ...assignments.rows], error: accounts.error || configs.error || assignments.error };
    entities = [
      ...accounts.rows.map((row: any) => moduleEntity("service", row, "home_service_accounts", row.title || row.service_key || "Service", { service_key: row.service_key || null, account_ref: row.account_ref || row.meter_id || null })),
      ...configs.rows.map((row: any) => moduleEntity("service", row, "estate_service_configs", row.title || row.service_key || "Service", { service_key: row.service_key || null })),
      ...assignments.rows.map((row: any) => moduleEntity("service", row, "home_service_assignments", row.title || row.service_key || "Service", { service_key: row.service_key || null, assigned_by: row.assigned_by || null })),
    ];
    label = module === "utilities" ? "infrastructure services" : "services";
  } else if (module === "notifications") {
    result = await selectRows("notifications", (q) => q.select("*").eq("user_id", actor.id).order("created_at", { ascending: false }).limit(50));
    entities = result.rows.map((row: any) => moduleEntity("notification", row, "notifications", "Notification"));
    label = "notifications";
  } else if (module === "activity") {
    result = await selectRows("home_timeline", (q) => applyScope(q.select("*").order("occurred_at", { ascending: false }).limit(50)));
    entities = result.rows.map((row: any) => moduleEntity("activity", row, "home_timeline", "Activity"));
    label = "activity records";
  } else if (module === "rooms") {
    result = await selectRows("rooms", (q) => applyScope(q.select("*").order("created_at", { ascending: true }).limit(100)));
    entities = result.rows.map((row: any) => moduleEntity("room", row, "rooms", "Room"));
    label = "rooms and spaces";
  } else if (module === "scenes" || module === "automation") {
    const table = module === "scenes" ? "consumer_scenes" : "consumer_automations";
    result = await selectRows(table, (q) => applyScope(q.select("*").order("created_at", { ascending: false }).limit(50)));
    entities = result.rows.map((row: any) => moduleEntity(module === "scenes" ? "scene" : "automation", row, table, module === "scenes" ? "Scene" : "Automation"));
    label = module === "scenes" ? "scenes" : "automations";
  } else if (module === "security") {
    result = await selectRows("facility_incidents", (q) => applyScope(q.select("*").order("created_at", { ascending: false }).limit(50), !scope.facility));
    entities = result.rows.map((row: any) => moduleEntity("security", row, "facility_incidents", "Security incident"));
    label = "security incidents";
  } else if (module === "cameras") {
    const [cameras, events, detections] = await Promise.all([
      selectRows("facility_cameras", (q) => applyScope(q.select("*").order("updated_at", { ascending: false }).limit(50), false)),
      selectRows("camera_events", (q) => applyScope(q.select("*").order("created_at", { ascending: false }).limit(50), false)),
      selectRows("camera_detections", (q) => applyScope(q.select("id,camera_id,estate_id,home_id,event_id,media_id,detection_type,observed_at,confidence,visual_zone_id,attributes,provider,model").order("observed_at", { ascending: false }).limit(50), false)),
    ]);
    result = { available: cameras.available || events.available || detections.available, rows: [...cameras.rows, ...events.rows, ...detections.rows], error: cameras.error || events.error || detections.error };
    entities = [
      ...cameras.rows.map((row: any) => moduleEntity("camera", row, "facility_cameras", row.name || "Camera", { location: row.location || null, last_seen_at: row.last_seen_at || null, health_status: row.health_status || null })),
      ...events.rows.map((row: any) => moduleEntity("camera", row, "camera_events", "Camera event")),
      ...detections.rows.map((row: any) => moduleEntity("camera", row, "camera_detections", `${row.detection_type || "Unknown"} detection`, { observed_at: row.observed_at, confidence: row.confidence, media_available: Boolean(row.media_id), identity_recognized: false })),
    ];
    label = /event/.test(requested) ? "camera events" : "cameras";
  } else if (module === "sensors" || (module === "utilities" && scope.facility)) {
    result = await selectRows("utility_telemetry", (q) => applyScope(q.select("*").order("observed_at", { ascending: false }).limit(50), !scope.facility));
    entities = result.rows.map((row: any) => moduleEntity("sensor", row, "utility_telemetry", "Telemetry reading"));
    label = module === "sensors" ? "sensor readings" : "utility readings";
  } else if (module === "staff") {
    result = await selectRows("estate_memberships", (q) => applyScope(q.select("id,user_id,role,status,created_at,updated_at,users(id,email,full_name,username)").eq("status", "active").order("created_at", { ascending: false }).limit(100), false));
    entities = result.rows.map((row: any) => {
      const user = row.users || {};
      const title = user.full_name || user.display_name || user.username || user.email || row.full_name || row.display_name || row.name || "Unnamed staff member";
      return moduleEntity("staff", { ...row, name: title, status: row.role || row.department || row.status }, "estate_memberships", "Unnamed staff member", { user_id: row.user_id || null, role: row.role || null, department: row.department || null, email: user.email || null });
    });
    label = "facility staff";
  } else if (module === "estate") {
    result = await selectRows("homes", (q) => applyScope(q.select("*").order("name", { ascending: true }).limit(100), false));
    entities = result.rows.map((row: any) => moduleEntity("estate", row, "homes", "Home or unit", { unit: row.unit || null, block: row.block || null }));
    label = "homes and units";
  } else if (module === "profile") {
    result = await selectRows("homes", (q) => applyScope(q.select("*").limit(1)));
    entities = result.rows.map((row: any) => moduleEntity("profile", row, "homes", row.name || "Home profile", { unit: row.unit || null, block: row.block || null }));
    label = "home profile records";
  } else if (module === "traffic") {
    result = await selectRows("home_timeline", (q) => applyScope(q.select("*").or("category.ilike.%traffic%,event_type.ilike.%traffic%,title.ilike.%traffic%,summary.ilike.%traffic%").order("occurred_at", { ascending: false }).limit(50), false));
    entities = result.rows.map((row: any) => moduleEntity("traffic", row, "home_timeline", "Traffic record"));
    label = "traffic and mobility records";
  } else if (module === "reports") {
    result = await selectRows("home_timeline", (q) => applyScope(q.select("*").or("event_type.ilike.%report%,category.ilike.%report%").order("occurred_at", { ascending: false }).limit(50), !scope.facility));
    entities = result.rows.map((row: any) => moduleEntity("report", row, "home_timeline", "Report"));
    label = "reports";
  }

  return {
    summary: moduleListSummary(label, entities, scope, result.available),
    data: { conversation_entities: entities.slice(0, 50), source_available: result.available, source_table: module },
  };
}

async function executeReadTool(toolId: string, actor: AuthUser, prompt: string, args: Record<string, any>) {
  const estateId = actorEstate(actor, args.estate_id || args.estateId || null);
  const homeId = actorHome(actor, args.home_id || args.homeId || null);
  if (toolId === "open_module") {
    return { summary: `Opening ${args.module || moduleForPrompt(prompt)}.`, data: { panel: args.module || moduleForPrompt(prompt) } };
  }
  if (toolId === "get_ai_status") {
    return {
      summary: "I can help with your home, devices, visitors, maintenance, community, Watch status, and recent activity. Sensitive actions still need confirmation.",
      data: {
        cards: [structuredCard("assistant_status", "Oyi Intelligence", "I can answer home questions and help with safe resident actions.", [
          { label: "Home summaries", value: true },
          { label: "Recent activity", value: true },
          { label: "Simple device control", value: true },
          { label: "Scene execution", value: true },
          { label: "Maintenance requests", value: true },
        ])],
        suggested_actions: [suggestedAction("What needs my attention?", "/ai?prompt=What%20needs%20my%20attention%3F")],
      },
    };
  }
  if (toolId === "summarize_module") return summarizeModuleTool(actor, prompt, args);
  if (toolId === "summarize_home_state") return summarizeHomeStateTool(actor);
  if (toolId === "summarize_home_awareness") return summarizeHomeAwarenessTool(actor);
  if (toolId === "summarize_recent_activity") return summarizeRecentActivityTool(actor);
  if (toolId === "summarize_visitors") return summarizeVisitorsTool(actor);
  if (toolId === "summarize_maintenance") return summarizeMaintenanceTool(actor);
  if (toolId === "summarize_community") return summarizeCommunityTool(actor);
  if (toolId === "summarize_watch_status") return summarizeWatchStatusTool(actor);
  if (toolId === "summarize_estate") {
    const filters = activeScopeFilter(actor, estateId, homeId);
    const [estates, homes, devices] = await Promise.all([
      countTable("estates", estateId ? { id: estateId } : {}),
      countTable("homes", homeId ? { id: homeId } : estateId ? { estate_id: estateId } : {}),
      countTable("devices", filters),
    ]);
    return { summary: `Estate context: ${estates.count} estate record(s), ${homes.count} home/unit record(s), ${devices.count} device record(s) visible.`, data: { estates, homes, devices } };
  }
  if (toolId === "summarize_devices") {
    const scope = deviceRuntimeScope(actor, args);
    const rows = await listVisibleDevices(actor, 500, scope);
    const deviceIds = rows.map((row: any) => row.id).filter(Boolean);
    const states = deviceIds.length
      ? await selectRows("device_states", (q) => q.select("device_id,status,last_seen,updated_at").in("device_id", deviceIds).limit(500))
      : { available: true, rows: [] as any[], error: "" };
    const stateByDevice = new Map((states.rows || []).map((row: any) => [String(row.device_id), row]));
    const entities = rows.map((device: any) => {
      const latest: any = stateByDevice.get(String(device.id)) || null;
      const state: Record<string, any> = latest?.status && typeof latest.status === "object" ? latest.status : {};
      const timeline = buildDeviceTimeline(device, latest);
      const online = normalizeDeviceOnlineState(device).state;
      const power = typeof state.switch === "boolean" ? (state.switch ? "on" : "off")
        : typeof state.power === "boolean" ? (state.power ? "on" : "off")
          : typeof state.on === "boolean" ? (state.on ? "on" : "off") : null;
      const status = [online, power].filter((value) => value && value !== "unknown").join(" • ") || "status unknown";
      return {
        type: "device",
        id: String(device.id),
        title: String(device.name || "Unnamed device"),
        status,
        details: {
          estate_id: device.estate_id || null,
          home_id: device.home_id || null,
          room_id: device.room_id || null,
          room_name: device.room_name || device.metadata?.room_name || null,
          provider: device.provider || device.vendor || device.adapter || null,
          external_id: device.external_id || null,
          online_state: online,
          latest_state: state,
          latest_state_at: timeline.latest_state_at,
          last_seen_at: timeline.last_seen_at,
          provider_reported_at: timeline.provider_reported_at,
          updated_at: timeline.latest_state_at,
          created_at: device.created_at || null,
          summary: `${status}${device.room_id ? " in its assigned room" : ""}.`,
        },
      };
    });
    const offline = entities.filter((entity) => entity.details.online_state === "offline").length;
    const scopeLabel = scope.estateWide ? "facility" : "home";
    return {
      summary: entities.length
        ? `${entities.length} registered ${scope.estateWide ? "infrastructure device" : "device"}${entities.length === 1 ? "" : "s"} found for this ${scopeLabel} context${offline ? `, including ${offline} offline` : ""}.`
        : `No registered ${scope.estateWide ? "infrastructure devices" : "devices"} were found for this ${scopeLabel} context.`,
      data: {
        devices: { available: true, count: entities.length },
        states: { available: states.available, count: states.rows.length, error: states.error },
        conversation_entities: entities,
        cards: [structuredCard("devices", scope.estateWide ? "Infrastructure devices" : "Devices", `${entities.length} registered device${entities.length === 1 ? "" : "s"}.`, entities.slice(0, 20).map((entity) => ({ title: entity.title, status: entity.status, device_id: entity.id })))],
      },
    };
  }
  if (toolId === "summarize_support" || toolId === "search_support") {
    const maintenance = await countTable("maintenance_requests", activeScopeFilter(actor, estateId, homeId));
    return { summary: `Support context: ${maintenance.count} maintenance/support record(s) visible.`, data: { maintenance } };
  }
  if (toolId === "summarize_wallet") {
    const wallets = await countTable("wallets", homeId ? { home_id: homeId } : {});
    return { summary: `Wallet context: ${wallets.count} wallet record(s) visible. No fund movement was performed.`, data: { wallets } };
  }
  if (toolId === "summarize_readiness") {
    const [devices, maintenance, notifications] = await Promise.all([
      countTable("devices", activeScopeFilter(actor, estateId, homeId)),
      countTable("maintenance_requests", activeScopeFilter(actor, estateId, homeId)),
      countTable("notifications", { user_id: actor.id }),
    ]);
    return { summary: "Readiness context generated from available backend tables. Missing table metadata is returned as source availability, not fake values.", data: { devices, maintenance, notifications } };
  }
  if (toolId === "search_documents") {
    const docs = await countTable("platform_files", estateId ? { estate_id: estateId } : homeId ? { home_id: homeId } : {});
    return { summary: `Document context: ${docs.count} file metadata record(s) visible.`, data: { documents: docs } };
  }
  return { summary: "Tool executed without mutation.", data: {} };
}

function normalizePrompt(prompt: string) {
  return String(prompt || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function requestedTemperature(prompt: string) {
  const match = normalizePrompt(prompt).match(/\b(?:set|to|temperature)\s*(?:ac|air|climate)?\s*(?:to)?\s*(1[6-9]|2[0-9]|30)\b/);
  return match ? Number(match[1]) : null;
}

function targetRoom(prompt: string) {
  const t = normalizePrompt(prompt);
  const rooms = ["living room", "bedroom", "master bedroom", "kitchen", "dining", "bathroom", "outdoor", "balcony", "garage", "office"];
  return rooms.find((room) => t.includes(room)) || null;
}

function targetFamily(prompt: string) {
  const t = normalizePrompt(prompt);
  if (/\bac\b|air conditioner|air conditioning|climate/.test(t)) return "hvac";
  if (/light|lamp|bulb/.test(t)) return "light";
  if (/socket|plug|outlet/.test(t)) return "outlet";
  if (/switch|relay/.test(t)) return "switch";
  if (/camera|cctv/.test(t)) return "camera";
  if (/lock|gate|door/.test(t)) return "access";
  if (/heater/.test(t)) return "heater";
  if (/security|alarm/.test(t)) return "security";
  return "device";
}

function deviceFamilyFromRow(row: any) {
  const source = `${row?.name || ""} ${row?.type || ""} ${row?.device_type || ""} ${row?.category || ""} ${row?.vendor || ""}`.toLowerCase();
  if (/ac|air conditioner|air conditioning|climate|hvac/.test(source)) return "hvac";
  if (/light|lamp|bulb/.test(source)) return "light";
  if (/socket|plug|outlet/.test(source)) return "outlet";
  if (/switch|relay/.test(source)) return "switch";
  if (/camera|cctv/.test(source)) return "camera";
  if (/lock|gate|door/.test(source)) return "access";
  if (/heater/.test(source)) return "heater";
  if (/security|alarm/.test(source)) return "security";
  return "device";
}

function classifyDeviceCommand(prompt: string) {
  const t = normalizePrompt(prompt);
  if (/wallet|debit|permission|admin|lockdown|disable camera|disarm security/.test(t)) return { risk: "high" as const, reason: "high_risk_or_admin_action" };
  if (/unlock/.test(t)) return { risk: "medium" as const, reason: "confirmation_required", action: "unlock", command: { lock: false } };
  if (/\block\b/.test(t)) return { risk: "medium" as const, reason: "confirmation_required", action: "lock", command: { lock: true } };
  if (/open gate|open door/.test(t)) return { risk: "medium" as const, reason: "confirmation_required", action: "open", command: { access: "open" } };
  if (/close gate|close door/.test(t)) return { risk: "medium" as const, reason: "confirmation_required", action: "close", command: { access: "close" } };
  if (/arm security/.test(t)) return { risk: "medium" as const, reason: "confirmation_required", action: "arm", command: { armed: true } };
  if (/heater/.test(t)) {
    if (/turn on|switch on|power on|start/.test(t)) return { risk: "medium" as const, reason: "confirmation_required", action: "on", command: { switch: true } };
    if (/turn off|switch off|power off|stop/.test(t)) return { risk: "medium" as const, reason: "confirmation_required", action: "off", command: { switch: false } };
    return { risk: "medium" as const, reason: "worker_not_allowed", action: "unsupported", command: null };
  }
  if (/turn off all|all devices|visitor access|guest access/.test(t)) return { risk: "medium" as const, reason: "worker_not_allowed", action: "unsupported", command: null };
  const temp = requestedTemperature(prompt);
  if (temp !== null) return { risk: "low" as const, action: "set_temperature", command: { temperature: temp, temp_set: temp } };
  if (/turn on|switch on|power on|start/.test(t)) return { risk: "low" as const, action: "on", command: { switch: true } };
  if (/turn off|switch off|power off|stop/.test(t)) return { risk: "low" as const, action: "off", command: { switch: false } };
  return { risk: "read" as const, action: "status", command: null };
}

async function findDeviceForPrompt(actor: AuthUser, prompt: string, args: Record<string, any>) {
  if (!hasWatchScope(actor)) return null;
  const scope = deviceRuntimeScope(actor, args);
  const explicit = args.device_id || args.deviceId || args.external_id || args.externalId;
  if (explicit) return resolveVisibleDevice(actor, explicit, scope);
  const rows = await listVisibleDevices(actor, 50, scope);

  const room = targetRoom(prompt);
  const family = targetFamily(prompt);
  const t = normalizePrompt(prompt);

  const scored = rows
    .map((row: any) => {
      const aliases = Array.isArray(row?.metadata?.aliases) ? row.metadata.aliases.join(" ") : row?.metadata?.alias || row?.alias || "";
      const name = normalizePrompt(`${row?.name || ""} ${aliases} ${row?.room_name || ""} ${row?.metadata?.room_name || ""} ${row?.category || ""} ${row?.type || ""}`);
      let score = 0;
      if (normalizePrompt(row?.name || "") && t.includes(normalizePrompt(row?.name || ""))) score += 12;
      if (deviceFamilyFromRow(row) === family) score += 4;
      if (room && name.includes(room)) score += 4;
      if (name && t.split(" ").some((word) => word.length > 3 && name.includes(word))) score += 1;
      return { row, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return {
      __oyi_ambiguous: true,
      __oyi_matches: scored.slice(0, 4).map((item: any) => ({ id: item.row?.id, name: item.row?.name || "Device" })),
    };
  }
  return scored[0]?.row || null;
}

function ambiguousDeviceSummary(device: any) {
  const names = Array.isArray(device?.__oyi_matches) ? device.__oyi_matches.map((item: any) => item.name).filter(Boolean).join(", ") : "";
  return `I found multiple matching devices${names ? `: ${names}` : ""}. Please choose one or name the room.`;
}

function mediumDeviceCommandAllowed(classification: ReturnType<typeof classifyDeviceCommand>, device: any) {
  const family = deviceFamilyFromRow(device);
  if (!classification.command || classification.risk !== "medium") return false;
  if (family === "access") return ["unlock", "lock", "open", "close"].includes(String(classification.action || ""));
  if (family === "heater") return ["on", "off"].includes(String(classification.action || ""));
  if (family === "security") return classification.action === "arm";
  return false;
}

function deviceOffline(row: any) {
  return isDeviceDefinitelyOffline(row);
}

async function executeDeviceCommandTool(req: Request | undefined, actor: AuthUser, prompt: string, args: Record<string, any>) {
  const classification = classifyDeviceCommand(prompt);
  const effectiveCommand = args.command && typeof args.command === "object" ? args.command : classification.command;
  const estateId = actorEstate(actor, args.estate_id || args.estateId || null);
  const runtimeScope = deviceRuntimeScope(actor, args);
  const homeId = runtimeScope.estateWide ? null : actorHome(actor, args.home_id || args.homeId || null);

  if (classification.risk === "high") {
    const ledger = await writeLedger({ actor, toolId: "device_command", prompt, status: "denied", estateId, homeId, errorMessage: classification.reason });
    await audit(req, actor, "ai.tool.denied", "denied", { tool_id: "device_command", ledger_id: ledger.id, reason: classification.reason });
    return { tool_id: "device_command", status: "denied", reason: classification.reason, ledger_id: ledger.id || null };
  }

  const oyiMutation = Boolean(args.__oyi_surface) && classification.risk === "low" && classification.action !== "status";
  if (classification.risk === "medium" || oyiMutation) {
    const device = await findDeviceForPrompt(actor, prompt, args);
    if (device?.__oyi_ambiguous) {
      return { tool_id: "device_command", status: "failed", error: "device_ambiguous", summary: ambiguousDeviceSummary(device) };
    }
    if (!device?.id && !device?.external_id) {
      const ledger = await writeLedger({ actor, toolId: "device_command", prompt, status: "failed", estateId, homeId, errorMessage: "device_not_found", resultSummary: "I could not find that device in your home scope." });
      await audit(req, actor, "ai.action.failed", "failed", { tool_id: "device_command", ledger_id: ledger.id, reason: "device_not_found" });
      return { tool_id: "device_command", status: "failed", error: "device_not_found", ledger_id: ledger.id || null, summary: "I could not find that device in your home scope." };
    }
    const ledger = await writeLedger({
      actor,
      toolId: "device_command",
      prompt,
      status: "pending_confirmation",
      estateId,
      homeId,
      resultSummary: "Confirmation required before this home command can execute.",
      metadata: {
        proposed_arguments: { ...args, device_id: device.id || device.external_id },
        risk_level: classification.risk,
        reason: classification.reason,
        device_id: device.id || device.external_id,
        command: effectiveCommand,
        action: classification.action,
      },
    });
    await audit(req, actor, "ai.command.confirmation.required", "pending", { tool_id: "device_command", ledger_id: ledger.id, reason: classification.reason });
    return { tool_id: "device_command", status: "pending_confirmation", confirmation_required: true, ledger_id: ledger.id || null };
  }

  if (classification.risk === "read") {
    const device = await findDeviceForPrompt(actor, prompt, args);
    if (device?.__oyi_ambiguous) {
      return { tool_id: "device_command", status: "failed", error: "device_ambiguous", summary: ambiguousDeviceSummary(device) };
    }
    const summary = device
      ? `${device.name || "Device"} is ${deviceOffline(device) ? "offline" : "available"}.`
      : "I could not find that device in your home scope.";
    const ledger = await writeLedger({ actor, toolId: "device_command", prompt, status: device ? "executed" : "failed", estateId, homeId, resultSummary: summary, errorMessage: device ? "" : "device_not_found", metadata: { mode: "status" } });
    await audit(req, actor, device ? "ai.tool.executed" : "ai.action.failed", device ? "success" : "failed", { tool_id: "device_command", ledger_id: ledger.id, mode: "status" });
    return { tool_id: "device_command", status: device ? "executed" : "failed", ledger_id: ledger.id || null, summary, data: { device_id: device?.id || null } };
  }

  const device = await findDeviceForPrompt(actor, prompt, args);
  if (device?.__oyi_ambiguous) {
    return { tool_id: "device_command", status: "failed", error: "device_ambiguous", summary: ambiguousDeviceSummary(device) };
  }
  if (!device?.id && !device?.external_id) {
    const ledger = await writeLedger({ actor, toolId: "device_command", prompt, status: "failed", estateId, homeId, errorMessage: "device_not_found", resultSummary: "I could not find that device in your home scope." });
    await audit(req, actor, "ai.action.failed", "failed", { tool_id: "device_command", ledger_id: ledger.id, reason: "device_not_found" });
    return { tool_id: "device_command", status: "failed", error: "device_not_found", ledger_id: ledger.id || null, summary: "I could not find that device in your home scope." };
  }
  if (deviceOffline(device)) {
    const ledger = await writeLedger({ actor, toolId: "device_command", prompt, status: "failed", estateId, homeId, errorMessage: "device_offline", resultSummary: "That device is offline." });
    await audit(req, actor, "ai.action.failed", "failed", { tool_id: "device_command", ledger_id: ledger.id, device_id: device.id, reason: "device_offline" });
    return { tool_id: "device_command", status: "failed", error: "device_offline", ledger_id: ledger.id || null, summary: "That device is offline." };
  }

  try {
    logDeviceCommandDiagnostic("ai.device.resolve", {
      action_id: args.action_id,
      device_id: args.device_id,
      matched_device_id: device.id || device.external_id,
      home_id: actor.home_id,
      estate_id: actor.estate_id,
      normalized_online_state: normalizeDeviceOnlineState(device).state,
      command: effectiveCommand,
    });
    const result = await executeDeviceCommandForActor({ actor, deviceId: String(device.id || device.external_id), command: effectiveCommand || {}, source: args.__oyi_surface === "facility" ? "facility" : "app", scope: runtimeScope, req });
    const commandResult: any = result;
    const finalStatus = String(commandResult?.final_status || commandResult?.execution_status || commandResult?.status || "");
    const awaiting = /accepted_for_processing|awaiting_state_confirmation|partial_confirmation|pending/.test(finalStatus);
    const summary = awaiting
      ? `${device.name || "Device"} command was accepted. Oyi is waiting for device-state confirmation.`
      : finalStatus === "state_confirmed"
        ? `${device.name || "Device"} state was confirmed.`
        : `${device.name || "Device"} command status: ${finalStatus || "recorded"}.`;
    const ledger = await writeLedger({ actor, toolId: "device_command", prompt, status: awaiting ? "pending_confirmation" : finalStatus === "state_confirmed" ? "executed" : "executed", estateId, homeId, resultSummary: summary, metadata: { device_id: device.id, command: effectiveCommand, result } });
    await audit(req, actor, "ai.tool.executed", "success", { tool_id: "device_command", ledger_id: ledger.id, device_id: device.id });
    return { tool_id: "device_command", status: awaiting ? "pending_confirmation" : "executed", ledger_id: ledger.id || null, summary, data: { device_id: device.id, command_status: commandResult.status, command_execution_id: commandResult.command_execution_id || null, final_status: commandResult.final_status || null } };
  } catch (error: any) {
    const ledger = await writeLedger({ actor, toolId: "device_command", prompt, status: "failed", estateId, homeId, errorMessage: error?.message || String(error), resultSummary: "The device command could not complete." });
    await audit(req, actor, "ai.action.failed", "failed", { tool_id: "device_command", ledger_id: ledger.id, error: error?.message || String(error) });
    return { tool_id: "device_command", status: "failed", error: error?.message || "device_command_failed", ledger_id: ledger.id || null, summary: "The device command could not complete." };
  }
}

async function insertSupportTicket(actor: AuthUser, record: any) {
  const base = {
    estate_id: record.estate_id || actor.estate_id || null,
    home_id: record.home_id || actor.home_id || null,
    user_id: actor.id,
    title: String(record.title || "AI-created support request").slice(0, 160),
    description: String(record.description || record.prompt_excerpt || "Created from confirmed Oyi AI command").slice(0, 4000),
    status: "open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from("maintenance_requests").insert(base as any).select("*").maybeSingle();
  if (error) throw error;
  return data || base;
}

async function executeConfirmedWorker(actor: AuthUser, record: any) {
  const tool = getAiTool(String(record?.tool_id || ""));
  if (!tool) {
    return { ok: false, status: "failed" as AiCommandStatus, summary: "Registered AI tool was not found.", error: "tool_not_registered" };
  }

  const missingPermission = tool.required_permissions.find((permission) => !hasPermission(actor, permission));
  if (missingPermission) {
    return { ok: false, status: "denied" as AiCommandStatus, summary: `Missing permission: ${missingPermission}`, error: "missing_permission" };
  }

  const metadata = record?.metadata && typeof record.metadata === "object" ? record.metadata : {};
  const args = metadata.proposed_arguments && typeof metadata.proposed_arguments === "object" ? metadata.proposed_arguments : {};

  if (tool.tool_id === "device_command") {
    if (!hasWatchScope(actor)) {
      return { ok: false, status: "denied" as AiCommandStatus, summary: "A home or estate context is required.", error: "watch_scope_required" };
    }
    if (record.home_id && actor.home_id && record.home_id !== actor.home_id) {
      return { ok: false, status: "denied" as AiCommandStatus, summary: "That device is outside your home scope.", error: "scope_mismatch" };
    }
    if (record.estate_id && actor.estate_id && record.estate_id !== actor.estate_id) {
      return { ok: false, status: "denied" as AiCommandStatus, summary: "That device is outside your estate scope.", error: "scope_mismatch" };
    }
    const classification = classifyDeviceCommand(String(record.prompt_excerpt || ""));
    const device = await findDeviceForPrompt(actor, String(record.prompt_excerpt || ""), args);
    if (!device || !deviceWithinActorScope(actor, device, deviceRuntimeScope(actor, args))) {
      return { ok: false, status: "denied" as AiCommandStatus, summary: "That device is outside your home scope.", error: "device_not_found_or_out_of_scope" };
    }
    if (deviceOffline(device)) {
      return { ok: false, status: "failed" as AiCommandStatus, summary: "That device is offline.", error: "device_offline" };
    }
    const lowRiskSwitch = classification.risk === "low" && ["on", "off", "set_temperature"].includes(String(classification.action || ""));
    if (!lowRiskSwitch && !mediumDeviceCommandAllowed(classification, device)) {
      return { ok: false, status: "denied" as AiCommandStatus, summary: "That confirmed command is not enabled for watch execution.", error: "worker_not_allowed" };
    }
    try {
      const result = await executeDeviceCommandForActor({
        actor,
        deviceId: String(device.id || device.external_id),
        command: classification.command || {},
        source: args.__oyi_surface === "facility" ? "facility" : "app",
        scope: deviceRuntimeScope(actor, args),
      });
      const summary = `${device.name || "Device"} command ${result.status === "command_queued" ? "queued" : "completed"}.`;
      return { ok: true, status: "executed" as AiCommandStatus, summary, data: { device_id: device.id, command_status: result.status } };
    } catch (error: any) {
      return { ok: false, status: "failed" as AiCommandStatus, summary: "The confirmed device command could not complete.", error: error?.message || "device_command_failed" };
    }
  }

  if (tool.tool_id === "support_mutation") {
    const ticket = await insertSupportTicket(actor, {
      ...args,
      estate_id: record.estate_id,
      home_id: record.home_id,
      prompt_excerpt: record.prompt_excerpt,
    });
    return {
      ok: true,
      status: "executed" as AiCommandStatus,
      summary: `Support ticket created: ${ticket.title || ticket.id}`,
      data: { support_ticket_id: ticket.id || null },
    };
  }

  if (tool.tool_id === "run_scene") {
    const sceneId = args.scene_id || args.sceneId || metadata.scene_id;
    if (!sceneId) {
      return { ok: false, status: "failed" as AiCommandStatus, summary: "I could not identify the scene to run.", error: "scene_id_missing" };
    }
    const found = await findSceneForPrompt(actor, String(record.prompt_excerpt || ""), { scene_id: sceneId });
    if (!found.scene) {
      return { ok: false, status: "failed" as AiCommandStatus, summary: "I could not find that scene in your home.", error: "scene_not_found" };
    }
    return executeScene(actor, found.scene);
  }

  return {
    ok: false,
    status: "failed" as AiCommandStatus,
    summary: "That confirmed action is not available yet. No operational action was performed.",
    error: "worker_not_available",
  };
}

export async function routeAiCommand(req: Request | undefined, input: AiCommandRequest) {
  const actor = input.actor;
  const scope = input.scope || (actor.role === "resident" ? "home" : actor.estate_id ? "estate" : "user");
  const proposedTools = input.proposedTools.length ? input.proposedTools : [{ tool_id: "open_module", arguments: { module: moduleForPrompt(input.prompt) } }];
  await audit(req, actor, "ai.command.received", "success", { prompt_excerpt: promptExcerpt(input.prompt), surface: input.surface || "consumer", scope });

  const results = [];
  for (const proposed of proposedTools.slice(0, 5)) {
    const tool = getAiTool(proposed.tool_id);
    if (!tool) {
      const ledger = await writeLedger({ actor, toolId: proposed.tool_id, prompt: input.prompt, status: "denied", estateId: input.estateId, homeId: input.homeId, errorMessage: "Tool is not registered" });
      await audit(req, actor, "ai.tool.denied", "denied", { tool_id: proposed.tool_id, ledger_id: ledger.id, reason: "tool_not_registered" });
      results.push({ tool_id: proposed.tool_id, status: "denied", reason: "tool_not_registered", ledger_id: ledger.id || null });
      continue;
    }

    await audit(req, actor, "ai.tool.requested", "success", { tool_id: tool.tool_id, risk_level: tool.risk_level });

    const missingPermission = tool.required_permissions.find((permission) => !hasPermission(actor, permission));
    if (missingPermission) {
      const ledger = await writeLedger({ actor, toolId: tool.tool_id, prompt: input.prompt, status: "denied", estateId: input.estateId, homeId: input.homeId, errorMessage: `Missing permission: ${missingPermission}` });
      await audit(req, actor, "ai.tool.denied", "denied", { tool_id: tool.tool_id, ledger_id: ledger.id, permission: missingPermission, reason: "missing_permission" });
      results.push({ tool_id: tool.tool_id, status: "denied", reason: "missing_permission", permission: missingPermission, ledger_id: ledger.id || null });
      continue;
    }

    if (!scopeAllowed(tool, actor, scope)) {
      const ledger = await writeLedger({ actor, toolId: tool.tool_id, prompt: input.prompt, status: "denied", estateId: input.estateId, homeId: input.homeId, errorMessage: `Scope not allowed: ${scope}` });
      await audit(req, actor, "ai.tool.denied", "denied", { tool_id: tool.tool_id, ledger_id: ledger.id, scope, reason: "scope_not_allowed" });
      results.push({ tool_id: tool.tool_id, status: "denied", reason: "scope_not_allowed", ledger_id: ledger.id || null });
      continue;
    }

    const toolArgs = { ...(proposed.arguments || {}), __oyi_surface: input.surface || "consumer" };

    if (tool.tool_id === "device_command") {
      const execution = await executeDeviceCommandTool(req, actor, input.prompt, toolArgs);
      results.push(execution);
      continue;
    }

    if (tool.tool_id === "run_scene") {
      const execution = await executeRunSceneTool(req, actor, input.prompt, toolArgs);
      results.push(execution);
      continue;
    }

    if (tool.tool_id === "create_maintenance_request") {
      const execution = await createMaintenanceRequestTool(req, actor, input.prompt, toolArgs);
      results.push(execution);
      continue;
    }

    if (!tool.enabled || tool.confirmation_required) {
      const status: AiCommandStatus = tool.confirmation_required ? "pending_confirmation" : "denied";
      const summary = tool.confirmation_required
        ? "I need confirmation before doing that. No action has been performed yet."
        : "That action is not available from Oyi Intelligence yet.";
      const ledger = await writeLedger({
        actor,
        toolId: tool.tool_id,
        prompt: input.prompt,
        status,
        estateId: input.estateId,
        homeId: input.homeId,
        resultSummary: summary,
        errorMessage: tool.enabled ? "" : "Tool disabled",
        metadata: { proposed_arguments: toolArgs, risk_level: tool.risk_level },
      });
      await audit(req, actor, tool.confirmation_required ? "ai.command.confirmation.required" : "ai.tool.denied", status === "denied" ? "denied" : "pending", { tool_id: tool.tool_id, ledger_id: ledger.id, risk_level: tool.risk_level });
      results.push({ tool_id: tool.tool_id, status, confirmation_required: tool.confirmation_required, enabled: tool.enabled, ledger_id: ledger.id || null, summary });
      continue;
    }

    try {
      const execution = await executeReadTool(tool.tool_id, actor, input.prompt, toolArgs);
      const ledger = await writeLedger({ actor, toolId: tool.tool_id, prompt: input.prompt, status: "executed", estateId: input.estateId, homeId: input.homeId, resultSummary: execution.summary, metadata: { result: execution.data } });
      await audit(req, actor, "ai.tool.executed", "success", { tool_id: tool.tool_id, ledger_id: ledger.id, risk_level: tool.risk_level });
      results.push({ tool_id: tool.tool_id, status: "executed", ledger_id: ledger.id || null, ...execution });
    } catch (error: any) {
      const ledger = await writeLedger({ actor, toolId: tool.tool_id, prompt: input.prompt, status: "failed", estateId: input.estateId, homeId: input.homeId, errorMessage: error?.message || String(error) });
      await audit(req, actor, "ai.action.failed", "failed", { tool_id: tool.tool_id, ledger_id: ledger.id, error: error?.message || String(error) });
      results.push({ tool_id: tool.tool_id, status: "failed", error: error?.message || "tool_failed", ledger_id: ledger.id || null });
    }
  }

  await audit(req, actor, "ai.response.generated", "success", { tool_count: results.length, pending_confirmations: results.filter((item) => CONFIRMATION_STATUSES.has(item.status as AiCommandStatus)).length });
  return { results, scope, safe_mode: true };
}

// Programme 4 Phase L — ai_execution_ledger has actor_email and
// prompt_excerpt columns; select("*") was returning both, unredacted, to
// any authenticated user scoped only by home_id/estate_id — meaning any
// other resident in the same home, or any staff member in the same
// estate, could read every other actor's email address and raw prompt
// text. Mirrors the redaction pattern deviceCommandExecutionStore.ts's
// publicRecord() already uses for the same table.
function publicLedgerRecord(row: Record<string, any>) {
  return {
    id: row?.id ?? null,
    actor_user_id: row?.actor_user_id ?? null,
    actor_role: row?.actor_role ?? null,
    estate_id: row?.estate_id ?? null,
    home_id: row?.home_id ?? null,
    tool_id: row?.tool_id ?? null,
    execution_status: row?.execution_status ?? null,
    requested_at: row?.requested_at ?? null,
    confirmed_at: row?.confirmed_at ?? null,
    executed_at: row?.executed_at ?? null,
    denied_at: row?.denied_at ?? null,
    result_summary: row?.result_summary ?? null,
    error_message: row?.error_message ?? null,
    contract_version: row?.contract_version ?? null,
  };
}

export async function listAiLedger(actor: AuthUser, limit = 100) {
  let query = supabaseAdmin
    .from("ai_execution_ledger")
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)));
  if (actor.role === "resident" && actor.home_id) query = query.eq("home_id", actor.home_id);
  else if (actor.estate_id) query = query.eq("estate_id", actor.estate_id);
  const { data, error } = await query;
  if (error) return { available: false, error: error.message, executions: [] };
  return { available: true, executions: (data || []).map(publicLedgerRecord) };
}

export async function listAiConfirmations(actor: AuthUser, limit = 50) {
  let query = supabaseAdmin
    .from("ai_execution_ledger")
    .select("*")
    .eq("execution_status", "pending_confirmation")
    .order("requested_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (actor.role === "resident" && actor.home_id) query = query.eq("home_id", actor.home_id);
  else if (actor.estate_id) query = query.eq("estate_id", actor.estate_id);
  const { data, error } = await query;
  if (error) return { available: false, error: error.message, confirmations: [] };
  return { available: true, confirmations: (data || []).map(publicLedgerRecord) };
}

export async function updateAiConfirmation(actor: AuthUser, ledgerId: string, decision: "confirmed" | "denied") {
  const now = new Date().toISOString();
  let query = supabaseAdmin
    .from("ai_execution_ledger")
    .select("*")
    .eq("id", ledgerId)
    .eq("execution_status", "pending_confirmation")
    .limit(1);
  if (actor.role === "resident" && actor.home_id) query = query.eq("home_id", actor.home_id);
  else if (actor.estate_id) query = query.eq("estate_id", actor.estate_id);
  const { data: rows, error: readError } = await query;
  if (readError) return { ok: false, error: readError.message, record: null };
  const record = rows?.[0];
  if (!record) return { ok: false, error: "confirmation_not_found", record: null };
  let patch: Record<string, any>;
  if (decision === "confirmed") {
    try {
      const execution = await executeConfirmedWorker(actor, record);
      await audit(
        undefined,
        actor,
        execution.status === "executed" ? "ai.tool.executed" : execution.status === "denied" ? "ai.tool.denied" : "ai.action.failed",
        execution.status === "executed" ? "success" : execution.status,
        { tool_id: record.tool_id, ledger_id: record.id, error: execution.error || null },
      );
      patch = {
        execution_status: execution.status,
        confirmed_at: now,
        executed_at: execution.status === "executed" ? now : null,
        denied_at: execution.status === "denied" ? now : null,
        result_summary: execution.summary,
        error_message: execution.error || "",
        metadata: { ...(record.metadata || {}), execution_result: execution.data || {}, worker_status: execution.status },
      };
    } catch (error: any) {
      patch = {
        execution_status: "failed",
        confirmed_at: now,
        error_message: error?.message || String(error),
        result_summary: "Confirmed command failed during controlled execution.",
        metadata: { ...(record.metadata || {}), worker_status: "failed" },
      };
    }
  } else {
    patch = { execution_status: "denied", denied_at: now, result_summary: "Command cancelled by user. No action executed." };
  }
  const { data, error } = await supabaseAdmin
    .from("ai_execution_ledger")
    .update(patch as any)
    .eq("id", ledgerId)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message, record: null };
  return { ok: true, record: data ? publicLedgerRecord(data) : null };
}
