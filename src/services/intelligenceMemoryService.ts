import { AuthUser } from "../middleware/auth";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";

function cleanKey(value: any, fallback = "item") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || fallback;
}

function actorScope(actor: AuthUser) {
  return {
    user_id: actor.id,
    estate_id: actor.estate_id || null,
    home_id: actor.home_id || null,
  };
}

async function existingMemory(actor: AuthUser, memoryType: string, key: string) {
  let query = supabaseAdmin
    .from("resident_memory")
    .select("*")
    .eq("user_id", actor.id)
    .eq("memory_type", memoryType)
    .eq("memory_key", key)
    .limit(1);
  query = actor.home_id ? query.eq("home_id", actor.home_id) : query.is("home_id", null);
  query = actor.estate_id ? query.eq("estate_id", actor.estate_id) : query.is("estate_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("resident_memory_lookup_failed");
  return data || null;
}

export async function upsertResidentMemory(actor: AuthUser, input: {
  memoryType: string;
  key: string;
  value: Record<string, any>;
  weight?: number;
}) {
  const memoryType = cleanKey(input.memoryType, "memory");
  const memoryKey = cleanKey(input.key, "item");
  const existing = await existingMemory(actor, memoryType, memoryKey);
  const digest = createHash("sha256").update(JSON.stringify([actor.id, actor.estate_id || null, actor.home_id || null, memoryType, memoryKey])).digest("hex");
  const id = existing?.id || `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const now = new Date().toISOString();
  const row = {
    id,
    ...actorScope(actor),
    memory_type: memoryType,
    memory_key: memoryKey,
    memory_value: input.value || {},
    weight: Math.max(1, Math.min(1000, Number(existing?.weight || 0) + Number(input.weight || 1))),
    last_seen_at: now,
    updated_at: now,
  };

  const { error } = await supabaseAdmin
    .from("resident_memory")
    .upsert(row as any, { onConflict: "id" });
  if (error) throw new Error("resident_memory_write_failed");
}

function actionTitle(result: any) {
  const summary = String(result?.summary || "").trim();
  if (summary) return summary.replace(/\.$/, "");
  const tool = String(result?.tool_id || "action").replace(/_/g, " ");
  return tool.charAt(0).toUpperCase() + tool.slice(1);
}

export async function recordHomeTimelineEvent(actor: AuthUser, input: {
  source: string;
  type: string;
  title: string;
  summary?: string;
  severity?: string;
  metadata?: Record<string, any>;
  occurredAt?: string;
}) {
  const row = {
    ...actorScope(actor),
    source: input.source,
    event_type: input.type,
    title: String(input.title || "Home update").slice(0, 180),
    summary: String(input.summary || input.title || "Home update").slice(0, 500),
    severity: input.severity || "info",
    metadata: input.metadata || {},
    occurred_at: input.occurredAt || new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("home_timeline").insert(row as any);
  if (error) console.warn("[home_timeline] write failed:", error.message);
}

export async function recordIntelligenceMemory(actor: AuthUser, input: {
  prompt: string;
  responseMode: string;
  reply: string;
  results: any[];
}) {
  await upsertResidentMemory(actor, {
    memoryType: "recent_intelligence_query",
    key: input.prompt.slice(0, 80),
    value: { prompt: input.prompt, response_mode: input.responseMode, last_reply: input.reply.slice(0, 300) },
  }).catch(() => undefined);

  for (const result of input.results || []) {
    const toolId = String(result?.tool_id || "");
    if (result?.status !== "executed") continue;

    if (toolId === "run_scene") {
      const sceneId = result?.data?.scene_id || result?.data?.sceneId || null;
      const sceneName = String(result?.summary || "Scene").replace(/\s+scene\s+(activated|ran).*$/i, "").trim() || "Scene";
      await upsertResidentMemory(actor, {
        memoryType: "favorite_scene",
        key: sceneId || sceneName,
        value: { scene_id: sceneId, scene_name: sceneName, last_result: result.summary || "Scene activated" },
        weight: 2,
      }).catch(() => undefined);
      await recordHomeTimelineEvent(actor, {
        source: "intelligence",
        type: "scene",
        title: result.summary || `${sceneName} Scene Activated`,
        summary: "Scene activated from Oyi Intelligence.",
        severity: "success",
        metadata: { scene_id: sceneId },
      }).catch(() => undefined);
    }

    if (toolId === "create_maintenance_request") {
      const requestId = result?.data?.request_id || null;
      const issue = String(result?.data?.issue || result?.summary || "Maintenance request").trim();
      await upsertResidentMemory(actor, {
        memoryType: "conversation_context",
        key: "latest_maintenance_request",
        value: { request_id: requestId, title: issue, status: "open" },
        weight: 3,
      }).catch(() => undefined);
      await upsertResidentMemory(actor, {
        memoryType: "recent_maintenance_issue",
        key: requestId || result?.summary || "maintenance_request",
        value: { request_id: requestId, title: issue, status: "open" },
        weight: 2,
      }).catch(() => undefined);
      await recordHomeTimelineEvent(actor, {
        source: "intelligence",
        type: "maintenance",
        title: "Maintenance Request Submitted",
        summary: result?.summary || "Maintenance request submitted.",
        severity: "attention",
        metadata: { request_id: requestId },
      }).catch(() => undefined);
    }

    if (toolId === "device_command") {
      await recordHomeTimelineEvent(actor, {
        source: "intelligence",
        type: "device",
        title: actionTitle(result),
        summary: "Device action requested from Oyi Intelligence.",
        severity: "info",
        metadata: { tool_id: toolId },
      }).catch(() => undefined);
    }
  }
}
