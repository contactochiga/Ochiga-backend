import { Request } from "express";
import { hasPermission } from "../core/foundation";
import type { AuthUser } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { routeAiCommand, updateAiConfirmation } from "../ai/commandRouter";

function actorHomeId(actor: AuthUser) {
  return actor.home_id || null;
}

function actorEstateId(actor: AuthUser) {
  return actor.estate_id || null;
}

function statusLabel(status?: string | null) {
  const value = String(status || "").toLowerCase();
  if (value.includes("offline") || value.includes("error")) return "offline";
  if (value.includes("online") || value.includes("active")) return "online";
  return "unknown";
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

async function recentNotifications(actor: AuthUser, limit = 6) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id,title,message,type,status,created_at,payload")
    .eq("user_id", actor.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

async function visibleDevices(actor: AuthUser, limit = 20) {
  let query = supabaseAdmin
    .from("devices")
    .select("id,name,type,category,vendor,status,estate_id,home_id,room_id,updated_at")
    .limit(limit);
  if (actorEstateId(actor)) query = query.eq("estate_id", actorEstateId(actor));
  if (actorHomeId(actor)) query = query.eq("home_id", actorHomeId(actor));
  const { data, error } = await query;
  if (error) return [];
  return data || [];
}

export async function getWatchHomeStatus(actor: AuthUser) {
  const [devices, notifications, maintenance] = await Promise.all([
    visibleDevices(actor),
    recentNotifications(actor, 4),
    countTable("maintenance_requests", actorHomeId(actor) ? { home_id: actorHomeId(actor) } : actorEstateId(actor) ? { estate_id: actorEstateId(actor) } : {}),
  ]);
  const offline = devices.filter((device: any) => statusLabel(device.status) === "offline").length;
  const unread = notifications.filter((item: any) => String(item.status || "").toLowerCase() !== "read").length;
  const state = offline > 0 ? "attention" : unread > 0 ? "aware" : "calm";
  return {
    state,
    title: state === "calm" ? "Home calm" : state === "aware" ? "Home aware" : "Needs attention",
    summary: offline > 0 ? `${offline} device${offline === 1 ? "" : "s"} need attention` : unread > 0 ? `${unread} new signal${unread === 1 ? "" : "s"}` : "All systems normal",
    home_id: actorHomeId(actor),
    estate_id: actorEstateId(actor),
    permissions: {
      devices_read: hasPermission(actor, "devices.read"),
      devices_control: hasPermission(actor, "devices.control"),
      notifications_read: hasPermission(actor, "notifications.read"),
    },
    counts: {
      devices: devices.length,
      offline_devices: offline,
      unread_notifications: unread,
      maintenance: maintenance.count,
    },
  };
}

export async function getWatchGlances(actor: AuthUser) {
  const [status, notifications, devices] = await Promise.all([getWatchHomeStatus(actor), recentNotifications(actor, 8), visibleDevices(actor, 12)]);
  const deviceGlances = devices.slice(0, 2).map((device: any) => ({
    id: `device-${device.id}`,
    type: "device",
    title: device.name || "Device",
    detail: statusLabel(device.status) === "offline" ? "Offline" : "Available",
    state: statusLabel(device.status),
  }));
  const notificationGlances = notifications.slice(0, 5).map((item: any) => ({
    id: item.id,
    type: item.type || "activity",
    title: item.title || "Home update",
    detail: item.message || "New signal",
    state: String(item.status || "unread").toLowerCase() === "read" ? "read" : "unread",
    created_at: item.created_at,
  }));
  return {
    items: [
      { id: "home-state", type: "awareness", title: status.title, detail: status.summary, state: status.state },
      ...notificationGlances,
      ...deviceGlances,
    ].slice(0, 8),
  };
}

export async function getWatchQuickActions(actor: AuthUser) {
  const canControl = hasPermission(actor, "devices.control");
  return {
    actions: [
      { id: "show_status", label: "Home status", prompt: "show home status", risk: "read", enabled: true },
      { id: "all_lights_off", label: "All lights off", prompt: "turn off lights", risk: "low", enabled: canControl },
      { id: "movie_mode", label: "Movie mode", prompt: "activate movie mode", risk: "low", enabled: canControl },
      { id: "arm_security", label: "Arm security", prompt: "arm security", risk: "medium", enabled: canControl, confirmation_required: true },
      { id: "climate", label: "Climate", prompt: "show climate status", risk: "read", enabled: true },
    ],
  };
}

export async function runWatchCommand(req: Request | undefined, actor: AuthUser, input: { command?: string; action_id?: string }) {
  const quick = await getWatchQuickActions(actor);
  const matched = input.action_id ? quick.actions.find((action) => action.id === input.action_id) : null;
  if (matched && !matched.enabled) {
    return { state: "denied", reply: "Not allowed.", tools: [], confirmations: [] };
  }
  const prompt = String(input.command || matched?.prompt || "show home status").trim();
  const routed = await routeAiCommand(req, {
    actor,
    prompt,
    surface: "watch",
    scope: actor.home_id ? "home" : actor.estate_id ? "estate" : "user",
    estateId: actor.estate_id || null,
    homeId: actor.home_id || null,
    proposedTools: [],
  });
  const results = routed.results as any[];
  const confirmation = results.find((item) => item.status === "pending_confirmation");
  const failed = results.find((item) => item.status === "failed" || item.status === "denied");
  const executed = results.find((item) => item.status === "executed");
  return {
    state: confirmation ? "confirmation_required" : failed ? failed.status : executed ? "success" : "queued",
    reply: confirmation ? "Confirm on watch." : executed?.summary || failed?.summary || failed?.error || "Queued.",
    tools: results,
    confirmations: confirmation ? [confirmation] : [],
  };
}

export async function confirmWatchCommand(actor: AuthUser, ledgerId: string) {
  const result = await updateAiConfirmation(actor, ledgerId, "confirmed");
  return {
    state: result.ok && result.record?.execution_status === "executed" ? "success" : result.ok ? result.record?.execution_status || "queued" : "failed",
    reply: result.record?.result_summary || result.error || "Could not confirm.",
    record: result.record,
  };
}

export async function cancelWatchCommand(actor: AuthUser, ledgerId: string) {
  const result = await updateAiConfirmation(actor, ledgerId, "denied");
  return {
    state: result.ok ? "denied" : "failed",
    reply: result.record?.result_summary || result.error || "Cancelled.",
    record: result.record,
  };
}
