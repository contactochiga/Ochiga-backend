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
  reply: string;
  panel?: string | null;
  deviceId?: string | null;
  actions?: never[];
  tools?: any[];
  confirmations?: any[];
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

function buildReply(message: string, toolResults: any[]) {
  const confirmation = toolResults.find((item) => item.status === "pending_confirmation");
  if (confirmation) {
    return "I can prepare that request, but it needs confirmation before anything operational is executed. No device, visitor, wallet, twin, or admin action has been performed.";
  }
  const denied = toolResults.find((item) => item.status === "denied");
  if (denied && !toolResults.some((item) => item.status === "executed")) {
    return `I cannot perform that action yet. Reason: ${denied.reason || denied.error || "permission or safety policy"}.`;
  }
  const summaries = toolResults
    .filter((item) => item.status === "executed" && item.summary)
    .map((item) => item.summary);
  if (summaries.length) return summaries.join("\n");
  const failed = toolResults.find((item) => item.status === "failed" && (item.summary || item.error));
  if (failed) return failed.summary || `That action could not complete: ${failed.error}.`;
  return `I received: ${message}. I kept this in safe command mode and did not execute any sensitive action.`;
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
  const response: AiChatResponse = {
    reply: buildReply(message, routedResults),
    panel: typeof panel === "string" && (PANELS as readonly string[]).includes(panel) ? panel : null,
    deviceId: null,
    actions: [],
    tools: routedResults,
    confirmations,
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
