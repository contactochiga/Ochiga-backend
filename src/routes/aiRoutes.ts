// src/routes/aiRoutes.ts
import { Router } from "express";
import OpenAI from "openai";
import { emitAuditEvent } from "../core/foundation";
import { requireAuth } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
import { routeAiCommand, listAiLedger, listAiConfirmations, updateAiConfirmation, type ProposedAiTool } from "../ai/commandRouter";
import { AI_TOOL_REGISTRY } from "../ai/toolRegistry";
import { getLatestMaintenanceContext, recordIntelligenceMemory } from "../services/intelligenceMemoryService";
import { adaptCanonicalToAiChat } from "../oyi-core/runtime/canonicalConversationAdapters";
import { runCanonicalConversation } from "../oyi-core/runtime/canonicalConversationRuntime";
import { operationalMetrics } from "../observability/metrics";

const router = Router();

// Freeze ownership note:
// - /ai/* remains a consumer-facing assistant and tool-routing surface.
// - It may orchestrate UI-safe actions, but it is not the canonical Oyi Core runtime.
// - Operational awareness, reasoning, recommendations, automation, conversation,
//   and execution history remain backend-owned under /oyi/runtime/*.

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
  response_mode?: "answer" | "insight" | "action" | "dashboard";
  awareness?: Record<string, any> | null;
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

function isStatusContinuationPrompt(message: string) {
  const raw = String(message || "").trim();
  const t = normalizeText(raw);
  return /^(what s|whats|what is|check|show)?\s*(the\s*)?status$/.test(t) || /^what'?s the status\??$/i.test(raw) || /^what is the status\??$/i.test(raw);
}

function shouldForceDeterministicTools(message: string) {
  const t = normalizeText(message);
  return isStatusContinuationPrompt(message)
    || /^(how is my home|what needs my attention|anything important|any maintenance pending|who visited today|what happened today|run relax|run movie time|run good night)/.test(t);
}

function deterministicTools(message: string): ProposedAiTool[] {
  const t = normalizeText(message);
  if (/what happened|today|recent activity|recent updates|what changed/.test(t)) {
    return [{ tool_id: "summarize_recent_activity", arguments: {} }];
  }
  if (/how is my home|home health|home status|home state|home summary|home overview|needs my attention|need attention|attention|urgent|anything important|what is going on|whats going on|what s going on|offline devices|devices offline|summary|overview/.test(t)) {
    return [{ tool_id: "summarize_home_awareness", arguments: {} }, { tool_id: "summarize_recent_activity", arguments: {} }];
  }
  if (/who visited|who came|visitors today|visitor summary|recent visitors|any visitors/.test(t)) {
    return [{ tool_id: "summarize_visitors", arguments: {} }];
  }
  if (/maintenance pending|pending maintenance|any maintenance|maintenance status|maintenance summary|maintenance update|maintenance updates/.test(t)) {
    return [{ tool_id: "summarize_maintenance", arguments: {} }];
  }
  if (/^(what'?s|what is|check|show)?\s*(the\s*)?status\??$|what'?s the status|what is the status/i.test(message.trim())) {
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
    .replace(/\b(ai tool requested|ai command received|ai response generated|device command requested|device command executed|support_mutation success|tool name|audit event|database|route)\b/gi, "home update")
    .trim();
}

function humanIssueTitle(value: any) {
  const cleaned = String(value || "Maintenance request")
    .replace(/^maintenance request created:\s*/i, "")
    .replace(/^your maintenance request has been submitted\.?\s*/i, "")
    .replace(/^issue:\s*/i, "")
    .replace(/\bstatus:\s*open\b/ig, "")
    .replace(/the maintenance team will review it shortly\.?/ig, "")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .trim() || "Maintenance request";
  if (/ac|air|cooling|hvac/i.test(cleaned)) return "AC cooling";
  return cleaned;
}

function humanMaintenanceStatus(value: any) {
  const status = String(value || "open").toLowerCase().replace(/_/g, " ");
  if (/open|new|pending/.test(status)) return "still open and awaiting review";
  if (/assigned|scheduled/.test(status)) return status;
  if (/progress/.test(status)) return "in progress";
  if (/waiting.*resident|resident/.test(status)) return "waiting for your response";
  if (/completed|resolved|closed/.test(status)) return "completed";
  return status || "open";
}

async function statusContinuationReply(actor: any) {
  const latest = await getLatestMaintenanceContext(actor).catch(() => null);
  if (!latest) return null;
  const issue = humanIssueTitle(latest.title);
  const status = humanMaintenanceStatus(latest.status);
  return compactLines([
    `Your ${issue} request is ${status}.`,
    /open|awaiting review|pending/.test(status) ? "No update has been posted yet." : null,
    "Suggested action: Open Maintenance to review the request.",
  ]).join("\n");
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
  if (/who visited|who came|visitors today|visitor summary|recent visitors|any visitors/.test(text)) return "visitors_today";
  if (/needs my attention|need attention|attention|urgent|anything important|what is going on|whats going on|what s going on/.test(text)) return "attention";
  if (/maintenance pending|pending maintenance|any maintenance|maintenance status|maintenance summary|maintenance update|maintenance updates/.test(text)) return "maintenance_pending";
  if (/what happened|today|recent activity|recent updates|what changed/.test(text)) return "today";
  if (/how is my home|home health|home status|home state|home summary|home overview/.test(text)) return "home_health";
  return "general";
}

function buildNarrativeReply(message: string, toolResults: any[], cards: any[]) {
  const intent = responseIntent(message);
  const home = cardByType(cards, "home_summary");
  const awareness = cardByType(cards, "home_awareness");
  const visitors = cardByType(cards, "visitors");
  const recentVisitors = cardByType(cards, "recent_visitors");
  const maintenance = cardByType(cards, "maintenance");
  const latestMaintenance = cardByType(cards, "latest_maintenance");
  const activityTypes = ["security", "devices", "visitors", "community", "maintenance", "scenes", "automations", "utilities"].map((type) => cardByType(cards, type)).filter(Boolean);
  const community = cardByType(cards, "community");

  if (intent === "visitors_today") {
    const visitorRows = cardItems(recentVisitors)
      .filter((row: any) => isToday(row.timestamp || row.created_at || row.updated_at))
      .slice(0, 5);
    if (!visitorRows.length) {
      return "No visitor activity has been recorded today.";
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
    const openMaintenance = itemValue(awareness, "Open maintenance") || itemValue(home, "Open maintenance") || itemValue(maintenance, "Open");
    const offlineDevices = itemValue(awareness, "Offline devices") || itemValue(home, "Offline");
    const pendingVisitors = itemValue(visitors, "Pending");
    const unreadNotices = itemValue(community, "Unread") || itemValue(home, "Unread activity");
    const priorities = compactLines([
      security ? "A security update needs review." : null,
      openMaintenance ? `${openMaintenance} maintenance request${openMaintenance === 1 ? "" : "s"} require attention.` : null,
      offlineDevices ? `${offlineDevices} device${offlineDevices === 1 ? "" : "s"} appear offline.` : null,
      pendingVisitors ? `${pendingVisitors} visitor${pendingVisitors === 1 ? "" : "s"} are pending.` : null,
      unreadNotices ? `${unreadNotices} unread update${unreadNotices === 1 ? "" : "s"} may need review.` : null,
    ]);
    if (!priorities.length) return "Everything looks normal.";
    return compactLines([
      "Your home needs attention.",
      ...priorities,
      "Suggested action: Open Activity to review the latest details.",
    ]).join("\n");
  }

  if (intent === "maintenance_pending") {
    const open = itemValue(maintenance, "Open");
    const waiting = itemValue(maintenance, "Waiting resident");
    const inProgress = itemValue(maintenance, "In progress");
    if (!open && !waiting && !inProgress) return "No maintenance requests are pending.";
    const latest = cardItems(latestMaintenance)[0];
    return compactLines([
      `${open || waiting || inProgress} maintenance request${(open || waiting || inProgress) === 1 ? "" : "s"} currently need tracking.`,
      `Context: ${latest?.title ? `Issue: ${latest.title}. ` : ""}${formatCount("open request", open, "no open requests")}; ${formatCount("waiting request", waiting, "none waiting on you")}; ${formatCount("in-progress request", inProgress, "none in progress")}.`,
      "Suggested action: Review the maintenance request details.",
    ]).join("\n");
  }

  if (intent === "today") {
    if (!activityTypes.length) return "No activity was recorded today.";
    const summaries = activityTypes.slice(0, 6).map((card: any) => {
      const label = String(card.title || card.type || "Update").replace(/_/g, " ");
      const first = cardItems(card)[0];
      const time = formatEventTime(first?.timestamp);
      return first?.title ? `${label}:\n${first.title}${time ? ` at ${time}` : ""}.` : `${label}:\n${cleanAssistantText(card.summary) || "Recent update"}.`;
    });
    return [
      `Your home has updates across ${activityTypes.length} area${activityTypes.length === 1 ? "" : "s"} today.`,
      summaries.join("\n\n"),
      activityTypes.some((card: any) => String(card.type).toLowerCase() === "security") ? "" : "No security incidents were recorded in the visible updates.",
      "Suggested action: Open Activity for the full timeline.",
    ].filter(Boolean).join("\n\n");
  }

  if (intent === "home_health") {
    const source = awareness || home;
    if (!source) return "I do not have enough home context yet.";
    const offline = itemValue(awareness, "Offline devices") || itemValue(home, "Offline");
    const maintenanceOpen = itemValue(awareness, "Open maintenance") || itemValue(home, "Open maintenance");
    const activeVisitors = itemValue(awareness, "Active visitors") || itemValue(home, "Active visitors");
    const unread = itemValue(home, "Unread activity");
    const status = String(cardItems(awareness).find((item: any) => String(item.label || "").toLowerCase() === "home health")?.value || (offline || maintenanceOpen ? "Needs Attention" : unread ? "Good" : "Excellent"));
    const calm = !offline && !maintenanceOpen && !unread;
    return compactLines([
      calm ? "Your home is operating normally." : `Your home ${String(status).toLowerCase().includes("attention") ? "needs attention" : "looks mostly okay"}.`,
      maintenanceOpen ? `${maintenanceOpen === 1 ? "One maintenance request is" : `${maintenanceOpen} maintenance requests are`} currently open.` : "No maintenance issues are active.",
      offline ? `${offline === 1 ? "One device appears" : `${offline} devices appear`} offline.` : "No device connectivity issues are visible.",
      activeVisitors ? `${activeVisitors === 1 ? "One visitor is" : `${activeVisitors} visitors are`} active or pending.` : "No visitors are waiting.",
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
    return denied.summary || "I can’t do that from your current home context.";
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

type ResponseMode = "answer" | "insight" | "action" | "dashboard";

function responseModeFor(message: string, proposedTools: ProposedAiTool[], results: any[]): ResponseMode {
  const text = normalizeText(message);
  if (/^(show|open|display|take me to|view)\b/.test(text)) return "dashboard";
  if (/what happened|summarize activity|today s updates|today updates|recent activity|what has been happening|give me today/.test(text)) return "insight";
  if (proposedTools.some((tool) => /run_scene|device_command|create_maintenance_request|visitor_create|support_mutation/.test(tool.tool_id))) return "action";
  if (results.some((result) => /run_scene|device_command|create_maintenance_request|visitor_create|support_mutation/.test(String(result?.tool_id || "")))) return "action";
  return "answer";
}

function actionResultReply(results: any[], fallback: string) {
  const action = results.find((result) => /run_scene|device_command|create_maintenance_request|visitor_create|support_mutation/.test(String(result?.tool_id || "")));
  if (!action) return fallback;
  if (action.status === "pending_confirmation") return action.summary || "I need confirmation before doing that.";
  if (action.status === "failed") return action.summary || "That action could not complete.";
  if (action.status === "denied") return action.summary || "I can’t do that from your current home context.";
  const summary = cleanAssistantText(action.summary || fallback);
  if (!summary) return fallback;
  return summary;
}

function actionResultCard(results: any[], reply: string) {
  const action = results.find((result) => /run_scene|device_command|create_maintenance_request|visitor_create|support_mutation/.test(String(result?.tool_id || "")));
  if (!action) return null;
  const existing = Array.isArray(action.data?.cards) ? action.data.cards[0] : null;
  if (existing) return existing;
  return {
    type: "action_result",
    title: reply.replace(/^✓\s*/, ""),
    summary: action.status === "failed" ? "The action did not complete." : "Action completed.",
    items: action.data?.request_id ? [{ label: "Status", value: "Open" }] : [],
  };
}

function primaryCardForIntent(message: string, cards: any[]) {
  const intent = responseIntent(message);
  if (intent === "home_health" || intent === "attention" || intent === "general") {
    const awareness = cardByType(cards, "home_awareness");
    const home = cardByType(cards, "home_summary");
    if (awareness || home) {
      const offline = itemValue(awareness, "Offline devices") || itemValue(home, "Offline");
      const maintenanceOpen = itemValue(awareness, "Open maintenance") || itemValue(home, "Open maintenance");
      const visitors = itemValue(awareness, "Active visitors") || itemValue(home, "Active visitors");
      const health = cardItems(awareness).find((item: any) => String(item.label || "").toLowerCase() === "home health")?.value || (offline || maintenanceOpen ? "Needs Attention" : "Normal");
      return {
        type: "summary",
        title: "Home status",
        summary: offline || maintenanceOpen || visitors ? "A few items may need your attention." : "Everything looks normal.",
        items: [
          maintenanceOpen ? { label: "Maintenance", value: maintenanceOpen } : null,
          offline ? { label: "Offline devices", value: offline } : null,
          visitors ? { label: "Visitors", value: visitors } : null,
          !maintenanceOpen && !offline && !visitors ? { label: "Status", value: health } : null,
        ].filter(Boolean),
      };
    }
  }
  const preferred = intent === "maintenance_pending"
    ? ["maintenance"]
    : intent === "visitors_today"
      ? ["visitors"]
      : ["home_awareness", "home_summary"];
  for (const type of preferred) {
    const card = cardByType(cards, type);
    if (card) return card;
  }
  return null;
}

function compressCardsForMode(mode: ResponseMode, message: string, results: any[], cards: any[], reply: string) {
  if (mode === "action") {
    const card = actionResultCard(results, reply);
    return card ? [card] : [];
  }
  if (mode === "insight") return [];
  if (mode === "dashboard") return uniqueBy(cards, (card: any) => String(card?.type || card?.title || "")).slice(0, 6);
  const primary = primaryCardForIntent(message, cards);
  return primary ? [primary] : [];
}

function suggestedActionsForMode(mode: ResponseMode, actions: any[]) {
  if (mode === "action") return [];
  if (mode === "dashboard") return actions.slice(0, 6);
  return actions.slice(0, 1);
}

function buildAwarenessObject(cards: any[]) {
  const awareness = cardByType(cards, "home_awareness");
  const home = cardByType(cards, "home_summary");
  const visitors = cardByType(cards, "visitors");
  const maintenance = cardByType(cards, "maintenance");
  const source = awareness || home;
  if (!source && !visitors && !maintenance) return null;
  return {
    home_health: cardItems(awareness).find((item: any) => String(item.label || "").toLowerCase() === "home health")?.value || null,
    attention_level: cardItems(awareness).find((item: any) => String(item.label || "").toLowerCase() === "attention")?.value || null,
    devices_online: itemValue(awareness, "Online devices") || itemValue(home, "Online"),
    devices_offline: itemValue(awareness, "Offline devices") || itemValue(home, "Offline"),
    maintenance_open: itemValue(awareness, "Open maintenance") || itemValue(home, "Open maintenance") || itemValue(maintenance, "Open"),
    visitors_active: itemValue(awareness, "Active visitors") || itemValue(home, "Active visitors") || itemValue(visitors, "Active"),
    visitors_pending: itemValue(visitors, "Pending"),
  };
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

router.post("/chat", requireAuth, resolveRequestContext, async (req, res) => {
  const message: string = (req.body?.message || req.body?.prompt || "").trim();
  const context = req.body?.context || {};

  if (!message) return res.status(400).json({ error: "message is required" });
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  operationalMetrics.increment("oyi_compatibility_route_calls_total", {
    route: "/ai/chat",
    surface: String(req.oisContext?.surface || context.surface || req.headers["x-ochiga-surface"] || "consumer"),
  });

  const runtime = await runCanonicalConversation(req.user, req.oisContext || null, {
    ...(req.body || {}),
    message,
    surface: (req.oisContext?.surface as any) || String(context.surface || req.headers["x-ochiga-surface"] || "consumer"),
    estate_id: req.oisContext?.estate_id || context.estateId || context.estate_id || req.user.estate_id || null,
    home_id: req.oisContext?.home_id || context.homeId || context.home_id || req.user.home_id || null,
    module: req.oisContext?.module || context.module || null,
    thread_id: req.body?.thread_id || context.thread_id || context.threadId || null,
    context: { ...(context || {}), ...(req.oisContext || {}) },
    target: req.body?.target || context.target || req.oisContext?.target || null,
  });

  void recordIntelligenceMemory(req.user, {
    prompt: message,
    responseMode: runtime.display_mode,
    reply: runtime.reply,
    results: [{ status: runtime.requiresConfirmation ? "pending_confirmation" : "processed", data: { cards: runtime.cards, sources: runtime.sources, suggested_actions: runtime.suggested_actions } }],
  });

  return res.json(adaptCanonicalToAiChat(runtime));
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
