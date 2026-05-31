import { Request } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitAuditEvent, hasPermission } from "../core/foundation";
import type { AuthUser } from "../middleware/auth";
import { AI_TOOL_REGISTRY, getAiTool, type AiToolDefinition } from "./toolRegistry";
import { executeDeviceCommandForActor } from "../controllers/deviceCommandController";
import { deviceWithinActorScope, hasWatchScope } from "../services/watchPolicy";
import {
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
  return explicit || actor.estate_id || null;
}

function actorHome(actor: AuthUser, explicit?: string | null) {
  return explicit || actor.home_id || null;
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

async function executeReadTool(toolId: string, actor: AuthUser, prompt: string, args: Record<string, any>) {
  const estateId = actorEstate(actor, args.estate_id || args.estateId || null);
  const homeId = actorHome(actor, args.home_id || args.homeId || null);
  if (toolId === "open_module") {
    return { summary: `Opening ${args.module || moduleForPrompt(prompt)}.`, data: { panel: args.module || moduleForPrompt(prompt) } };
  }
  if (toolId === "get_ai_status") {
    return {
      summary: "AI command infrastructure is running in Phase 1 safe mode. Write/control tools are disabled until confirmation hardening is complete.",
      data: {
        enabled_tools: AI_TOOL_REGISTRY.filter((tool) => tool.enabled).map((tool) => tool.tool_id),
        disabled_tools: AI_TOOL_REGISTRY.filter((tool) => !tool.enabled).map((tool) => tool.tool_id),
      },
    };
  }
  if (toolId === "summarize_estate") {
    const [estates, homes, devices] = await Promise.all([
      countTable("estates", estateId ? { id: estateId } : {}),
      countTable("homes", estateId ? { estate_id: estateId } : homeId ? { id: homeId } : {}),
      countTable("devices", estateId ? { estate_id: estateId } : homeId ? { home_id: homeId } : {}),
    ]);
    return { summary: `Estate context: ${estates.count} estate record(s), ${homes.count} home/unit record(s), ${devices.count} device record(s) visible.`, data: { estates, homes, devices } };
  }
  if (toolId === "summarize_devices") {
    const devices = await countTable("devices", estateId ? { estate_id: estateId } : homeId ? { home_id: homeId } : {});
    const states = await countTable("device_states");
    return { summary: `Device context: ${devices.count} device record(s), ${states.count} state record(s) available.`, data: { devices, states } };
  }
  if (toolId === "summarize_support" || toolId === "search_support") {
    const maintenance = await countTable("maintenance_requests", estateId ? { estate_id: estateId } : homeId ? { home_id: homeId } : {});
    return { summary: `Support context: ${maintenance.count} maintenance/support record(s) visible.`, data: { maintenance } };
  }
  if (toolId === "summarize_wallet") {
    const wallets = await countTable("wallets", homeId ? { home_id: homeId } : {});
    return { summary: `Wallet context: ${wallets.count} wallet record(s) visible. No fund movement was performed.`, data: { wallets } };
  }
  if (toolId === "summarize_readiness") {
    const [devices, maintenance, notifications] = await Promise.all([
      countTable("devices", estateId ? { estate_id: estateId } : {}),
      countTable("maintenance_requests", estateId ? { estate_id: estateId } : {}),
      countTable("notifications"),
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
  const explicit = args.device_id || args.deviceId || args.external_id || args.externalId;
  if (explicit) return resolveVisibleDevice(actor, explicit);
  const rows = await listVisibleDevices(actor, 50);

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
  const homeId = actorHome(actor, args.home_id || args.homeId || null);

  if (classification.risk === "high") {
    const ledger = await writeLedger({ actor, toolId: "device_command", prompt, status: "denied", estateId, homeId, errorMessage: classification.reason });
    await audit(req, actor, "ai.tool.denied", "denied", { tool_id: "device_command", ledger_id: ledger.id, reason: classification.reason });
    return { tool_id: "device_command", status: "denied", reason: classification.reason, ledger_id: ledger.id || null };
  }

  if (classification.risk === "medium") {
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
        risk_level: "medium",
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
    const result = await executeDeviceCommandForActor({ actor, deviceId: String(device.id || device.external_id), command: effectiveCommand || {}, req });
    const actionText = classification.action === "set_temperature" ? `set to ${(effectiveCommand as any)?.temperature}°` : classification.action === "on" ? "on" : "off";
    const queued = result.status === "command_queued";
    const summary = queued ? `${device.name || "Device"} command queued.` : `${device.name || "Device"} is ${actionText}.`;
    const ledger = await writeLedger({ actor, toolId: "device_command", prompt, status: "executed", estateId, homeId, resultSummary: summary, metadata: { device_id: device.id, command: effectiveCommand, result } });
    await audit(req, actor, "ai.tool.executed", "success", { tool_id: "device_command", ledger_id: ledger.id, device_id: device.id });
    return { tool_id: "device_command", status: queued ? "queued" : "executed", ledger_id: ledger.id || null, summary, data: { device_id: device.id, command_status: result.status } };
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
    if (!device || !deviceWithinActorScope(actor, device)) {
      return { ok: false, status: "denied" as AiCommandStatus, summary: "That device is outside your home scope.", error: "device_not_found_or_out_of_scope" };
    }
    if (deviceOffline(device)) {
      return { ok: false, status: "failed" as AiCommandStatus, summary: "That device is offline.", error: "device_offline" };
    }
    if (!mediumDeviceCommandAllowed(classification, device)) {
      return { ok: false, status: "denied" as AiCommandStatus, summary: "That confirmed command is not enabled for watch execution.", error: "worker_not_allowed" };
    }
    try {
      const result = await executeDeviceCommandForActor({
        actor,
        deviceId: String(device.id || device.external_id),
        command: classification.command || {},
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

  return {
    ok: false,
    status: "failed" as AiCommandStatus,
    summary: `${tool.tool_id} is confirmed but has no Phase 1 execution worker yet. No operational action was performed.`,
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

    if (tool.tool_id === "device_command") {
      const execution = await executeDeviceCommandTool(req, actor, input.prompt, proposed.arguments || {});
      results.push(execution);
      continue;
    }

    if (!tool.enabled || tool.confirmation_required) {
      const status: AiCommandStatus = tool.confirmation_required ? "pending_confirmation" : "denied";
      const ledger = await writeLedger({
        actor,
        toolId: tool.tool_id,
        prompt: input.prompt,
        status,
        estateId: input.estateId,
        homeId: input.homeId,
        resultSummary: tool.confirmation_required ? "Confirmation required before execution. No action executed." : "Tool disabled in Phase 1.",
        errorMessage: tool.enabled ? "" : "Tool disabled in Phase 1",
        metadata: { proposed_arguments: proposed.arguments || {}, risk_level: tool.risk_level },
      });
      await audit(req, actor, tool.confirmation_required ? "ai.command.confirmation.required" : "ai.tool.denied", status === "denied" ? "denied" : "pending", { tool_id: tool.tool_id, ledger_id: ledger.id, risk_level: tool.risk_level });
      results.push({ tool_id: tool.tool_id, status, confirmation_required: tool.confirmation_required, enabled: tool.enabled, ledger_id: ledger.id || null });
      continue;
    }

    try {
      const execution = await executeReadTool(tool.tool_id, actor, input.prompt, proposed.arguments || {});
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
  return { available: true, executions: data || [] };
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
  return { available: true, confirmations: data || [] };
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
  return { ok: true, record: data };
}
