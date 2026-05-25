import { Request } from "express";
import { hasPermission } from "../core/foundation";
import type { AuthUser } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { routeAiCommand, updateAiConfirmation, type ProposedAiTool } from "../ai/commandRouter";

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

function stateColor(state?: string | null) {
  const value = String(state || "").toLowerCase();
  if (["online", "calm", "success", "read"].includes(value)) return "green";
  if (["aware", "unread", "pending", "unknown"].includes(value)) return "blue";
  if (["attention", "offline", "error", "failed"].includes(value)) return "red";
  return "blue";
}

function safeTitle(value: unknown, fallback = "Home update") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 32);
}

function safeDetail(value: unknown, fallback = "Updated now") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 48);
}

function deviceFamily(row: any) {
  const source = `${row?.name || ""} ${row?.type || ""} ${row?.device_type || ""} ${row?.category || ""} ${row?.vendor || ""}`.toLowerCase();
  if (/ac|air conditioner|air conditioning|climate|hvac/.test(source)) return "hvac";
  if (/light|lamp|bulb/.test(source)) return "light";
  if (/socket|plug|outlet/.test(source)) return "outlet";
  if (/switch|relay/.test(source)) return "switch";
  if (/camera|cctv/.test(source)) return "camera";
  if (/lock|gate|door/.test(source)) return "access";
  return "device";
}

function deviceActionVerb(row: any) {
  const family = deviceFamily(row);
  if (family === "camera") return "show";
  if (family === "access") return "status";
  return statusLabel(row?.status) === "online" ? "off" : "on";
}

function devicePrompt(row: any) {
  const name = row?.name || "device";
  const verb = deviceActionVerb(row);
  if (verb === "show") return `show ${name} camera status`;
  if (verb === "status") return `show ${name} status`;
  return `turn ${verb} ${name}`;
}

function canExposeControl(row: any) {
  const family = deviceFamily(row);
  return ["light", "switch", "outlet", "hvac", "device"].includes(family);
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
    .select("id,external_id,name,type,category,vendor,status,estate_id,home_id,room_id,updated_at")
    .limit(limit);
  if (actorEstateId(actor)) query = query.eq("estate_id", actorEstateId(actor));
  if (actorHomeId(actor)) query = query.eq("home_id", actorHomeId(actor));
  const { data, error } = await query;
  if (error) return [];
  return data || [];
}

async function visibleHome(actor: AuthUser) {
  if (!actorHomeId(actor)) return null;
  const { data } = await supabaseAdmin
    .from("homes")
    .select("id,name,unit,block,estate_id")
    .eq("id", actorHomeId(actor))
    .maybeSingle();
  return data || null;
}

async function visibleEstate(actor: AuthUser, homeEstateId?: string | null) {
  const estateId = actorEstateId(actor) || homeEstateId || null;
  if (!estateId) return null;
  const { data } = await supabaseAdmin
    .from("estates")
    .select("id,name")
    .eq("id", estateId)
    .maybeSingle();
  return data || null;
}

export async function getWatchHomeStatus(actor: AuthUser) {
  const [devices, notifications, maintenance, home] = await Promise.all([
    visibleDevices(actor),
    recentNotifications(actor, 4),
    countTable("maintenance_requests", actorHomeId(actor) ? { home_id: actorHomeId(actor) } : actorEstateId(actor) ? { estate_id: actorEstateId(actor) } : {}),
    visibleHome(actor),
  ]);
  const estate = await visibleEstate(actor, (home as any)?.estate_id || null);
  const offline = devices.filter((device: any) => statusLabel(device.status) === "offline").length;
  const unread = notifications.filter((item: any) => String(item.status || "").toLowerCase() !== "read").length;
  const state = offline > 0 ? "attention" : unread > 0 ? "aware" : "calm";
  const homeName = safeTitle((home as any)?.name || [(home as any)?.block, (home as any)?.unit].filter(Boolean).join(" ") || (estate as any)?.name || actor.username || "Oyi Home", "Oyi Home");
  return {
    state,
    title: state === "calm" ? homeName : state === "aware" ? "Home aware" : "Needs attention",
    summary: offline > 0 ? `${offline} device${offline === 1 ? "" : "s"} need attention` : unread > 0 ? `${unread} new signal${unread === 1 ? "" : "s"}` : "All systems normal",
    home_name: homeName,
    estate_name: (estate as any)?.name || null,
    home_id: actorHomeId(actor),
    estate_id: actorEstateId(actor) || (home as any)?.estate_id || null,
    updated_at: new Date().toISOString(),
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
  const deviceGlances = devices.slice(0, 3).map((device: any) => {
    const state = statusLabel(device.status);
    return {
      id: `device-${device.id}`,
      type: deviceFamily(device),
      icon_type: deviceFamily(device),
      title: safeTitle(device.name || "Device"),
      detail: state === "offline" ? "Offline" : state === "online" ? "Available" : "No live state yet",
      state,
      state_color: stateColor(state),
      last_updated: device.updated_at || null,
    };
  });
  const notificationGlances = notifications.slice(0, 5).map((item: any) => {
    const state = String(item.status || "unread").toLowerCase() === "read" ? "read" : "unread";
    return {
      id: item.id,
      type: item.type || "activity",
      icon_type: item.type || "activity",
      title: safeTitle(item.title || "Home update"),
      detail: safeDetail(item.message || "New signal"),
      state,
      state_color: stateColor(state),
      last_updated: item.created_at || null,
    };
  });
  return {
    items: [
      {
        id: "home-state",
        type: "awareness",
        icon_type: "home",
        title: safeTitle(status.title),
        detail: safeDetail(status.summary),
        state: status.state,
        state_color: stateColor(status.state),
        last_updated: status.updated_at,
      },
      ...notificationGlances,
      ...deviceGlances,
    ].slice(0, 8),
    source: "backend",
    generated_at: new Date().toISOString(),
  };
}

export async function getWatchQuickActions(actor: AuthUser) {
  const canControl = hasPermission(actor, "devices.control");
  const devices = await visibleDevices(actor, 20);
  const actionableDevices = devices.filter(canExposeControl).slice(0, 3);
  const actions = [
    { id: "show_status", label: "Home status", prompt: "show home status", risk: "read", enabled: true, icon_type: "home", state_color: "blue", confirmation_required: false },
    ...actionableDevices.map((device: any) => {
      const verb = deviceActionVerb(device);
      const family = deviceFamily(device);
      const disabled = statusLabel(device.status) === "offline";
      return {
        id: `device:${device.id}:${verb}`,
        label: safeTitle(verb === "off" ? `${device.name || "Device"} off` : verb === "on" ? `${device.name || "Device"} on` : `${device.name || "Device"} status`, "Device"),
        prompt: devicePrompt(device),
        risk: family === "access" ? "medium" : "low",
        enabled: canControl && !disabled,
        disabled_reason: !canControl ? "permission_required" : disabled ? "device_offline" : null,
        confirmation_required: family === "access",
        icon_type: family,
        state_color: disabled ? "red" : "blue",
        device_id: device.id,
        last_updated: device.updated_at || null,
      };
    }),
  ];
  return {
    actions: actions.slice(0, 5),
    source: "backend",
    generated_at: new Date().toISOString(),
  };
}

function proposedToolsForWatch(input: { command?: string; action_id?: string }, matched: any): ProposedAiTool[] {
  const command = String(input.command || matched?.prompt || "show home status").toLowerCase();
  if (matched?.device_id || /turn on|turn off|switch on|switch off|set .*\d+|light|ac|climate|camera|device|status/.test(command)) {
    return [{ tool_id: "device_command", arguments: matched?.device_id ? { device_id: matched.device_id } : {} }];
  }
  if (/home status|status|readiness|health/.test(command)) return [{ tool_id: "summarize_readiness", arguments: {} }];
  return [{ tool_id: "open_module", arguments: { module: "home" } }];
}

export async function runWatchCommand(req: Request | undefined, actor: AuthUser, input: { command?: string; action_id?: string }) {
  const quick = await getWatchQuickActions(actor);
  const matched = (input.action_id ? quick.actions.find((action: any) => action.id === input.action_id) : null) as any;
  if (matched && !matched.enabled) {
    return { state: "denied", reply: matched.disabled_reason === "device_offline" ? "That device is offline." : "You do not have permission.", tools: [], confirmations: [] };
  }
  const prompt = String(input.command || (matched as any)?.prompt || "show home status").trim();
  const routed = await routeAiCommand(req, {
    actor,
    prompt,
    surface: "watch",
    scope: actor.home_id ? "home" : actor.estate_id ? "estate" : "user",
    estateId: actor.estate_id || null,
    homeId: actor.home_id || null,
    proposedTools: proposedToolsForWatch(input, matched),
  });
  const results = routed.results as any[];
  const confirmation = results.find((item) => item.status === "pending_confirmation");
  const failed = results.find((item) => item.status === "failed" || item.status === "denied");
  const executed = results.find((item) => item.status === "executed");
  return {
    state: confirmation ? "confirmation_required" : failed ? failed.status : executed ? "success" : "queued",
    reply: confirmation ? "Confirm on watch." : executed?.summary || failed?.summary || failed?.error || "Queued.",
    tools: results.map((item) => ({ tool_id: item.tool_id, status: item.status, ledger_id: item.ledger_id || null, summary: item.summary || null })),
    confirmations: confirmation ? [confirmation] : [],
  };
}

export async function confirmWatchCommand(actor: AuthUser, ledgerId: string) {
  const result = await updateAiConfirmation(actor, ledgerId, "confirmed");
  return {
    state: result.ok && result.record?.execution_status === "executed" ? "success" : result.ok ? result.record?.execution_status || "queued" : "failed",
    reply: result.record?.result_summary || result.error || "Could not confirm.",
    record: result.record ? { id: result.record.id, execution_status: result.record.execution_status, tool_id: result.record.tool_id } : null,
  };
}

export async function cancelWatchCommand(actor: AuthUser, ledgerId: string) {
  const result = await updateAiConfirmation(actor, ledgerId, "denied");
  return {
    state: result.ok ? "denied" : "failed",
    reply: result.record?.result_summary || result.error || "Cancelled.",
    record: result.record ? { id: result.record.id, execution_status: result.record.execution_status, tool_id: result.record.tool_id } : null,
  };
}
