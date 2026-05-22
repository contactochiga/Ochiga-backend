import { Request } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitAuditEvent, hasPermission } from "../core/foundation";
import type { AuthUser } from "../middleware/auth";
import { AI_TOOL_REGISTRY, getAiTool, type AiToolDefinition } from "./toolRegistry";

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
