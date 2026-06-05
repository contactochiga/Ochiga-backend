// src/routes/aiRoutes.ts
import { Router } from "express";
import OpenAI from "openai";
import { emitAuditEvent } from "../core/foundation";
import { requireAuth } from "../middleware/auth";
import { routeAiCommand, listAiLedger, listAiConfirmations, updateAiConfirmation, type ProposedAiTool } from "../ai/commandRouter";
import { AI_TOOL_REGISTRY } from "../ai/toolRegistry";

const router = Router();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.warn("OPENAI_API_KEY not set — /ai/chat will run in deterministic safe mode.");
}

const client = apiKey ? new OpenAI({ apiKey }) : null;

const PANELS = [
  "home",
  "rooms",
  "visitor",
  "door",
  "wallet",
  "utilities",
  "maintenance",
  "community",
  "light",
  "ac",
  "tv",
  "cctv",
  "sensors",
  "devices",
  "support",
  "documents",
  "readiness",
] as const;

type AiChatResponse = {
  message: string;
  reply: string;
  panel?: string | null;
  deviceId?: string | null;
  actions?: never[];
  tools?: any[];
  confirmations?: any[];
  cards?: any[];
  sources?: any[];
  suggested_actions?: any[];
  safe_mode: true;
  requiresConfirmation?: boolean;
};

function safeJsonExtract(text: string) {
  const cleaned = (text || "").replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last !== -1) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeText(v: string) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function openPanelFromPrompt(message: string) {
  const t = normalizeText(message);
  if (/device|hardware|sensor|switch|meter|light|ac|tv/.test(t)) return "devices";
  if (/visitor|guest|access|gate|door/.test(t)) return "visitor";
  if (/wallet|payment|transaction|balance/.test(t)) return "wallet";
  if (/support|maintenance|ticket|complaint/.test(t)) return "maintenance";
  if (/community|message|notice|announcement/.test(t)) return "community";
  if (/document|proposal|contract|invoice|report/.test(t)) return "documents";
  if (/readiness|health|status|diagnostic/.test(t)) return "readiness";
  if (/room|space|floor/.test(t)) return "rooms";
  return "home";
}

function deterministicTools(message: string): ProposedAiTool[] {
  const t = normalizeText(message);
  if (/what happened|today|recent activity|recent updates|what changed/.test(t)) {
    return [{ tool_id: "summarize_recent_activity", arguments: {} }];
  }
  if (/needs my attention|need attention|attention|urgent|offline devices|devices offline|home status|home state|summary|overview/.test(t)) {
    return [{ tool_id: "summarize_home_state", arguments: {} }, { tool_id: "summarize_recent_activity", arguments: {} }];
  }
  if (/who visited|visitors today|visitor summary|recent visitors/.test(t)) {
    return [{ tool_id: "summarize_visitors", arguments: {} }];
  }
  if (/maintenance pending|pending maintenance|any maintenance|maintenance status|maintenance summary/.test(t)) {
    return [{ tool_id: "summarize_maintenance", arguments: {} }];
  }
  if (/community|notice|announcement|urgent notice/.test(t) && !/create|post|send/.test(t)) {
    return [{ tool_id: "summarize_community", arguments: {} }];
  }
  if (/watch|apple watch|oyi watch/.test(t)) {
    return [{ tool_id: "summarize_watch_status", arguments: {} }];
  }
  if (/run|start|activate|execute/.test(t) && /scene|good morning|good night|relax|movie|away|vacation|leaving home|welcome home/.test(t)) {
    return [{ tool_id: "run_scene", arguments: { scene_name: message } }];
  }
  if (/create|open|raise|log|file/.test(t) && /maintenance|ticket|complaint|request|repair|fix|not cooling|leak|broken/.test(t)) {
    return [{ tool_id: "create_maintenance_request", arguments: { title: message.slice(0, 120), description: message } }];
  }
  if (/turn on|turn off|switch on|switch off|open gate|close gate|unlock|lock|set\s+\d+|brightness|temperature/.test(t)) {
    return [{ tool_id: "device_command", arguments: { intent: "device_control_request" } }];
  }
  if (/create|open|raise|log|file/.test(t) && /support|maintenance|ticket|complaint/.test(t)) {
    return [{ tool_id: "support_mutation", arguments: { title: message.slice(0, 120), description: message } }];
  }
  if (/create|generate|approve|grant|visitor|guest|access code|gate pass/.test(t) && /visitor|guest|access|gate/.test(t)) {
    return [{ tool_id: "visitor_create", arguments: { intent: "visitor_access_request" } }];
  }
  if (/wallet|balance|payment|transaction/.test(t)) return [{ tool_id: "summarize_wallet", arguments: {} }];
  if (/support|maintenance|ticket|complaint/.test(t)) return [{ tool_id: "summarize_support", arguments: {} }];
  if (/device|hardware|sensor|camera|cctv|meter|light|ac|tv/.test(t)) return [{ tool_id: "summarize_devices", arguments: {} }];
  if (/document|proposal|contract|invoice|report/.test(t)) return [{ tool_id: "search_documents", arguments: { query: message } }];
  if (/readiness|health|status|diagnostic|system/.test(t)) return [{ tool_id: "summarize_readiness", arguments: {} }];
  if (/estate|building|home|unit|room|occupancy/.test(t)) return [{ tool_id: "summarize_estate", arguments: {} }];
  if (/ai|oyi|assistant|agent/.test(t)) return [{ tool_id: "get_ai_status", arguments: {} }];
  return [{ tool_id: "open_module", arguments: { module: openPanelFromPrompt(message) } }];
}

function sanitizeProposedTools(value: any): ProposedAiTool[] {
  const rows = Array.isArray(value?.tools) ? value.tools : Array.isArray(value) ? value : [];
  return rows
    .map((item: any) => ({
      tool_id: String(item?.tool_id || item?.name || "").trim(),
      arguments: item?.arguments && typeof item.arguments === "object" ? item.arguments : {},
    }))
    .filter((item: ProposedAiTool) => Boolean(item.tool_id))
    .slice(0, 5);
}

async function suggestToolsWithModel(message: string, context: any): Promise<ProposedAiTool[] | null> {
  if (!client) return null;
  const enabledTools = AI_TOOL_REGISTRY.map((tool) => ({
    tool_id: tool.tool_id,
    description: tool.description,
    risk_level: tool.risk_level,
    enabled: tool.enabled,
  }));
  const system = `You classify authenticated Oyi user requests into registered AI tools. Return JSON only: {"tools":[{"tool_id":"...","arguments":{}}]}. Prefer safe read-only tools. Do not invent tools. For any physical control, visitor mutation, wallet mutation, admin mutation, or twin control, return the matching disabled/risky tool so the backend can require confirmation. Registered tools: ${JSON.stringify(enabledTools)}`;
  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 300,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ message, context: { surface: context?.surface, estateId: context?.estateId, homeId: context?.homeId } }) },
      ],
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() || "";
    const parsed = safeJsonExtract(raw);
    const tools = sanitizeProposedTools(parsed);
    return tools.length ? tools : null;
  } catch (error) {
    console.warn("[ai] tool classification fallback:", (error as any)?.message || String(error));
    return null;
  }
}

function cardByType(cards: any[], type: string) {
  return cards.find((card) => String(card?.type || "").toLowerCase() === type);
}

function itemValue(card: any, label: string) {
  const item = (Array.isArray(card?.items) ? card.items : []).find((entry: any) => String(entry?.label || entry?.title || "").toLowerCase() === label.toLowerCase());
  const value = item?.value;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cardItems(card: any) {
  return Array.isArray(card?.items) ? card.items : [];
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

function cleanAssistantText(value: any) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^I found\s+/i, "")
    .replace(/^There are\s+/i, "")
    .trim();
}

function formatCount(label: string, count: number, ok: string) {
  return count > 0 ? `${count} ${label}${count === 1 ? "" : "s"}` : ok;
}

function formatEventTime(value: any) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function isToday(value: any) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function responseIntent(message: string) {
  const text = normalizeText(message);
  if (/who visited|visitors today|visitor summary|recent visitors/.test(text)) return "visitors_today";
  if (/needs my attention|need attention|attention|urgent/.test(text)) return "attention";
  if (/maintenance pending|pending maintenance|any maintenance|maintenance status|maintenance summary/.test(text)) return "maintenance_pending";
  if (/what happened|today|recent activity|recent updates|what changed/.test(text)) return "today";
  if (/how is my home|home health|home status|home state|home summary|home overview/.test(text)) return "home_health";
  return "general";
}

function buildNarrativeReply(message: string, toolResults: any[], cards: any[]) {
  const intent = responseIntent(message);
  const home = cardByType(cards, "home_summary");
  const visitors = cardByType(cards, "visitors");
  const recentVisitors = cardByType(cards, "recent_visitors");
  const maintenance = cardByType(cards, "maintenance");
  const activityTypes = ["urgent", "devices", "visitors", "community", "maintenance", "security"].map((type) => cardByType(cards, type)).filter(Boolean);
  const community = cardByType(cards, "community");

  if (intent === "visitors_today") {
    const visitorRows = cardItems(recentVisitors)
      .filter((row: any) => isToday(row.timestamp || row.created_at || row.updated_at))
      .slice(0, 5);
    if (!visitorRows.length) {
      return "No visitors were recorded today.";
    }
    const timedNames = visitorRows
      .map((row: any) => {
        const time = formatEventTime(row.timestamp || row.created_at || row.updated_at);
        return row.title ? `${row.title}${time ? ` at ${time}` : ""}` : "";
      })
      .filter(Boolean);
    const total = visitorRows.length;
    return compactLines([
      timedNames.length ? `Today's visitors: ${timedNames.join(", ")}.` : `${total} visitor${total === 1 ? "" : "s"} were recorded today.`,
      `Context: ${total} visitor${total === 1 ? "" : "s"} total; ${formatCount("active visitor", itemValue(visitors, "Active"), "no active visitors")}; ${formatCount("pending visitor", itemValue(visitors, "Pending"), "no pending visitors")}.`,
      itemValue(visitors, "Pending") ? "Suggested action: Open Visitors to review pending access." : null,
    ]).join("\n");
  }

  if (intent === "attention") {
    const security = activityTypes.find((card: any) => String(card.type).toLowerCase() === "security" || String(card.type).toLowerCase() === "urgent");
    const openMaintenance = itemValue(home, "Open maintenance") || itemValue(maintenance, "Open");
    const offlineDevices = itemValue(home, "Offline");
    const pendingVisitors = itemValue(visitors, "Pending");
    const unreadNotices = itemValue(community, "Unread") || itemValue(home, "Unread activity");
    const priorities = compactLines([
      security ? "Security needs review." : null,
      openMaintenance ? `${openMaintenance} maintenance request${openMaintenance === 1 ? "" : "s"} need attention.` : null,
      offlineDevices ? `${offlineDevices} device${offlineDevices === 1 ? "" : "s"} appear offline.` : null,
      pendingVisitors ? `${pendingVisitors} visitor${pendingVisitors === 1 ? "" : "s"} are pending.` : null,
      unreadNotices ? `${unreadNotices} unread update${unreadNotices === 1 ? "" : "s"} may need review.` : null,
    ]);
    if (!priorities.length) return "Everything looks normal.";
    return compactLines([
      priorities[0],
      `Context: ${priorities.slice(1).join(" ") || "No other priority items are visible."}`,
      "Suggested action: Open Activity to review the latest details.",
    ]).join("\n");
  }

  if (intent === "maintenance_pending") {
    const open = itemValue(maintenance, "Open");
    const waiting = itemValue(maintenance, "Waiting resident");
    const inProgress = itemValue(maintenance, "In progress");
    if (!open && !waiting && !inProgress) return "No maintenance requests are pending.";
    const total = open || waiting + inProgress;
    return compactLines([
      `Maintenance needs tracking.`,
      `Context: ${formatCount("open request", open, "no open requests")}; ${formatCount("waiting request", waiting, "none waiting on you")}; ${formatCount("in-progress request", inProgress, "none in progress")}.`,
      total ? "Suggested action: Open Maintenance to review request details." : null,
    ]).join("\n");
  }

  if (intent === "today") {
    if (!activityTypes.length) return "No activity was recorded today.";
    const summaries = activityTypes.slice(0, 5).map((card: any) => {
      const label = String(card.title || card.type || "Update").replace(/_/g, " ");
      const first = cardItems(card)[0];
      return first?.title ? `${label}: ${first.title}.` : `${label}: ${cleanAssistantText(card.summary) || "recent update"}.`;
    });
    return compactLines([
      `Your home has updates across ${activityTypes.length} area${activityTypes.length === 1 ? "" : "s"} today.`,
      `Context: ${summaries.join(" ")}`,
      "Suggested action: Open Activity for the full timeline.",
    ]).join("\n");
  }

  if (intent === "home_health") {
    if (!home) return "I do not have enough home context yet.";
    const offline = itemValue(home, "Offline");
    const maintenanceOpen = itemValue(home, "Open maintenance");
    const unread = itemValue(home, "Unread activity");
    const status = offline || maintenanceOpen ? "Needs attention" : unread ? "Aware" : "Healthy";
    return compactLines([
      `Home status: ${status}.`,
      `Context: ${itemValue(home, "Online")} devices online; ${offline ? `${offline} offline` : "no offline devices"}; ${maintenanceOpen ? `${maintenanceOpen} active maintenance issue${maintenanceOpen === 1 ? "" : "s"}` : "no active maintenance issues"}; ${unread ? `${unread} unread update${unread === 1 ? "" : "s"}` : "no urgent unread updates"}.`,
      offline || maintenanceOpen || unread ? "Suggested action: Open Activity to review what changed." : null,
    ]).join("\n");
  }

  const successful = toolResults.find((item) => item.status === "executed" && item.summary);
  if (successful?.summary) return cleanAssistantText(successful.summary);
  return "";
}

function buildReply(message: string, toolResults: any[], cards: any[] = []) {
  const confirmation = toolResults.find((item) => item.status === "pending_confirmation");
  if (confirmation) {
    return confirmation.summary || "I need confirmation before doing that. No action has been performed yet.";
  }
  const denied = toolResults.find((item) => item.status === "denied");
  if (denied && !toolResults.some((item) => item.status === "executed")) {
    return "I don’t have access to do that yet.";
  }
  const narrative = buildNarrativeReply(message, toolResults, cards);
  if (narrative) return narrative;
  const summaries = toolResults
    .filter((item) => item.status === "executed" && item.summary)
    .map((item) => cleanAssistantText(item.summary));
  if (summaries.length) return compactLines(summaries).join("\n");
  const failed = toolResults.find((item) => item.status === "failed" && (item.summary || item.error));
  if (failed) return failed.summary || `That action could not complete: ${failed.error}.`;
  return "I can help with your home, devices, visitors, maintenance, community, and recent activity.";
}

function uniqueBy<T>(rows: T[], keyOf: (row: T) => string) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyOf(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

router.post("/chat", requireAuth, async (req, res) => {
  const message: string = (req.body?.message || req.body?.prompt || "").trim();
  const context = req.body?.context || {};

  if (!message) return res.status(400).json({ error: "message is required" });
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const proposedTools = (await suggestToolsWithModel(message, context)) || deterministicTools(message);
  const routed = await routeAiCommand(req, {
    actor: req.user,
    prompt: message,
    surface: String(context.surface || req.headers["x-ochiga-surface"] || "consumer"),
    scope: String(context.scope || (req.user.role === "resident" ? "home" : req.user.estate_id ? "estate" : "user")),
    estateId: context.estateId || context.estate_id || req.user.estate_id || null,
    homeId: context.homeId || context.home_id || req.user.home_id || null,
    proposedTools,
  });

  const routedResults = routed.results as any[];
  const panel = routedResults.find((item) => item.data?.panel)?.data?.panel || openPanelFromPrompt(message);
  const confirmations = routedResults.filter((item) => item.status === "pending_confirmation");
  const cards = routedResults.flatMap((item) => Array.isArray(item.data?.cards) ? item.data.cards : []);
  const sources = uniqueBy(routedResults.flatMap((item) => Array.isArray(item.data?.sources) ? item.data.sources : []), (item: any) => `${item.label || ""}:${item.timestamp || ""}`).slice(0, 12);
  const suggestedActions = uniqueBy(routedResults.flatMap((item) => Array.isArray(item.data?.suggested_actions) ? item.data.suggested_actions : []), (item: any) => `${item.label || ""}:${item.route || ""}`).slice(0, 8);
  const reply = buildReply(message, routedResults, cards);
  const response: AiChatResponse = {
    message: reply,
    reply,
    panel: typeof panel === "string" && (PANELS as readonly string[]).includes(panel) ? panel : null,
    deviceId: null,
    actions: [],
    tools: routedResults,
    confirmations,
    cards,
    sources,
    suggested_actions: suggestedActions,
    safe_mode: true,
    requiresConfirmation: confirmations.length > 0,
  };

  return res.json(response);
});

router.get("/tools", requireAuth, async (_req, res) => {
  res.json({ tools: AI_TOOL_REGISTRY });
});

router.get("/executions", requireAuth, async (req, res) => {
  const payload = await listAiLedger(req.user!, Number(req.query.limit || 100));
  res.json(payload);
});

router.get("/confirmations", requireAuth, async (req, res) => {
  const payload = await listAiConfirmations(req.user!, Number(req.query.limit || 50));
  res.json(payload);
});

router.post("/confirmations/:id/confirm", requireAuth, async (req, res) => {
  const result = await updateAiConfirmation(req.user!, req.params.id, "confirmed");
  await emitAuditEvent({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    action: "ai.command.confirmed",
    resourceType: "ai_command",
    resourceId: req.params.id,
    estateId: req.user!.estate_id,
    homeId: req.user!.home_id,
    status: result.ok ? "success" : "failed",
    metadata: { error: result.error || "", execution_status: result.record?.execution_status || "" },
    req,
  } as any);
  if (result.ok && result.record) {
    await emitAuditEvent({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: result.record.execution_status === "executed" ? "ai.tool.executed" : "ai.action.failed",
      resourceType: "ai_command",
      resourceId: req.params.id,
      estateId: req.user!.estate_id,
      homeId: req.user!.home_id,
      status: result.record.execution_status === "executed" ? "success" : "failed",
      metadata: {
        tool_id: result.record.tool_id,
        execution_status: result.record.execution_status,
        result_summary: result.record.result_summary || "",
        error: result.record.error_message || "",
      },
      req,
    } as any);
  }
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

router.post("/confirmations/:id/cancel", requireAuth, async (req, res) => {
  const result = await updateAiConfirmation(req.user!, req.params.id, "denied");
  await emitAuditEvent({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    action: "ai.command.cancelled",
    resourceType: "ai_command",
    resourceId: req.params.id,
    estateId: req.user!.estate_id,
    homeId: req.user!.home_id,
    status: result.ok ? "success" : "failed",
    metadata: { error: result.error || "" },
    req,
  } as any);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

export default router;
