import { AuthUser } from "../middleware/auth";
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
  if (actor.home_id) query = query.eq("home_id", actor.home_id);
  else if (actor.estate_id) query = query.eq("estate_id", actor.estate_id);
  const { data } = await query.maybeSingle();
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
  const existing = await existingMemory(actor, memoryType, memoryKey).catch(() => null);
  const now = new Date().toISOString();
  const row = {
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
    .upsert(row as any, { onConflict: "user_id,home_id,memory_type,memory_key" });
  if (error) console.warn("[resident_memory] write failed:", error.message);
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

export async function getLatestMaintenanceContext(actor: AuthUser) {
  let query = supabaseAdmin
    .from("resident_memory")
    .select("*")
    .eq("user_id", actor.id)
    .eq("memory_type", "conversation_context")
    .eq("memory_key", "latest_maintenance_request")
    .order("last_seen_at", { ascending: false })
    .limit(1);
  if (actor.home_id) query = query.eq("home_id", actor.home_id);
  else if (actor.estate_id) query = query.eq("estate_id", actor.estate_id);

  const { data } = await query.maybeSingle();
  const memory = data?.memory_value && typeof data.memory_value === "object" ? data.memory_value : null;
  if (!memory?.request_id) return memory || null;

  const { data: request } = await supabaseAdmin
    .from("maintenance_requests")
    .select("id,title,status,updated_at,created_at")
    .eq("id", memory.request_id)
    .match({
      ...(actor.home_id ? { home_id: actor.home_id } : {}),
      ...(!actor.home_id && actor.estate_id ? { estate_id: actor.estate_id } : {}),
    })
    .maybeSingle();

  return {
    ...memory,
    request_id: memory.request_id,
    title: request?.title || memory.title || "Maintenance request",
    status: request?.status || memory.status || "open",
    updated_at: request?.updated_at || request?.created_at || null,
  };
}

export async function buildHomeTimeline(actor: AuthUser, limit = 80) {
  const [timeline, notifications, audit] = await Promise.all([
    supabaseAdmin
      .from("home_timeline")
      .select("*")
      .eq("user_id", actor.id)
      .match({
        ...(actor.home_id ? { home_id: actor.home_id } : {}),
        ...(!actor.home_id && actor.estate_id ? { estate_id: actor.estate_id } : {}),
      })
      .order("occurred_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("notifications")
      .select("id,title,message,type,status,created_at,payload")
      .eq("user_id", actor.id)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("audit_events")
      .select("id,action,resource_type,status,created_at,metadata,home_id,estate_id")
      .eq("actor_id", actor.id)
      .match({
        ...(actor.home_id ? { home_id: actor.home_id } : {}),
        ...(!actor.home_id && actor.estate_id ? { estate_id: actor.estate_id } : {}),
      })
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const rows = [
    ...((timeline.data || []).map((row: any) => ({ source: row.source, type: row.event_type, title: row.title, summary: row.summary, occurred_at: row.occurred_at, severity: row.severity, metadata: row.metadata || {} }))),
    ...((notifications.data || []).map((row: any) => ({ source: "notifications", type: row.type || "notification", title: row.title, summary: row.message, occurred_at: row.created_at, severity: /urgent|critical|security|alert/i.test(`${row.type} ${row.title}`) ? "attention" : "info", metadata: row.payload || {} }))),
    ...((audit.data || []).map((row: any) => ({ source: "audit", type: row.resource_type || row.action, title: String(row.action || "Home update").replace(/\./g, " "), summary: String(row.status || "updated"), occurred_at: row.created_at, severity: row.status === "failed" ? "warning" : "info", metadata: row.metadata || {} }))),
  ];

  return rows
    .sort((a, b) => new Date(b.occurred_at || 0).getTime() - new Date(a.occurred_at || 0).getTime())
    .slice(0, limit);
}

function startOfTodayIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function startOfWeekIso() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start.toISOString();
}

function formatDeviceHistoryTime(value: any) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function deviceNameFromEvent(row: any) {
  return String(row?.metadata?.device_name || row?.devices?.name || "Device").trim() || "Device";
}

export async function answerDeviceHistoryQuestion(actor: AuthUser, prompt: string) {
  const text = String(prompt || "").toLowerCase();
  const wantsHistory =
    /device|light|switch|offline|online|power|used|usage|active|unstable|bedroom|living room|socket|plug|ac|tv/.test(text)
    || /did power|power.*(off|out|fail)|which .*active recently|which .*used/.test(text);
  if (!wantsHistory) return null;
  const since = /week/.test(text) ? startOfWeekIso() : startOfTodayIso();
  let eventsQuery = supabaseAdmin
    .from("device_events")
    .select("id,device_id,event_type,new_state,source,confidence_level,occurred_at,metadata")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(80);
  if (actor.home_id) eventsQuery = eventsQuery.eq("home_id", actor.home_id);
  else if (actor.estate_id) eventsQuery = eventsQuery.eq("estate_id", actor.estate_id);
  else eventsQuery = eventsQuery.eq("user_id", actor.id);

  let countersQuery = supabaseAdmin
    .from("device_usage_counters")
    .select("device_id,total_toggles,last_used_at,last_source,offline_count,online_count,failure_count,stability_score,last_offline_at,last_online_at,metadata")
    .order("last_used_at", { ascending: false })
    .limit(20);
  if (actor.home_id) countersQuery = countersQuery.eq("home_id", actor.home_id);
  else if (actor.estate_id) countersQuery = countersQuery.eq("estate_id", actor.estate_id);

  const [{ data: events }, { data: counters }] = await Promise.all([eventsQuery, countersQuery]);
  const rows = Array.isArray(events) ? events : [];
  const counterRows = Array.isArray(counters) ? counters : [];
  if (!rows.length && !counterRows.length) return "I don't have enough device history yet.";

  if (/power.*(off|out|failure)|did power/.test(text)) {
    let timelineQuery = supabaseAdmin
      .from("home_timeline")
      .select("title,summary,occurred_at,metadata")
      .eq("event_type", "power_event_possible")
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(3);
    if (actor.home_id) timelineQuery = timelineQuery.eq("home_id", actor.home_id);
    const { data: powerRows } = await timelineQuery;
    if (!powerRows?.length) return "No confirmed power outage is visible in today's device history. I also did not see a cluster of devices going offline together.";
    const first: any = powerRows[0];
    return `A possible power or network interruption was detected.
Context: ${first.summary || first.title || "Several devices went offline close together."} This is not a confirmed power outage.
Suggested action: Open Activity to review the affected devices.`;
  }

  if (/offline|unstable/.test(text)) {
    const offline = rows.filter((row: any) => /offline/.test(String(row.event_type || ""))).slice(0, 5);
    const unstable = counterRows.filter((row: any) => Number(row?.stability_score ?? 100) < 80 || Number(row?.failure_count || 0) > 0).slice(0, 5);
    if (!offline.length && !unstable.length) return "No device offline or instability event is visible in the current device history.";
    const lines = (offline.length ? offline : unstable).map((row: any) => {
      const name = deviceNameFromEvent(row);
      const time = formatDeviceHistoryTime(row.occurred_at || row.last_offline_at || row.last_used_at);
      return `${name}${time ? ` at ${time}` : ""}`;
    });
    return `Device attention is visible.
Context: ${lines.join(", ")}.
Suggested action: Open Devices to check connectivity.`;
  }

  if (/most used|used most|which device/.test(text)) {
    const sorted = [...counterRows].sort((a: any, b: any) => Number(b.total_toggles || 0) - Number(a.total_toggles || 0));
    const top = sorted[0];
    if (!top || !Number(top.total_toggles || 0)) return "I don't have enough device usage history yet.";
    return `Your most-used device is ${deviceNameFromEvent(top)}.
Context: It has ${Number(top.total_toggles || 0)} recorded toggle${Number(top.total_toggles || 0) === 1 ? "" : "s"}.
Suggested action: Open Devices if you want to review its status.`;
  }

  if (/active recently|recently active|active device/.test(text)) {
    const recent: any = rows[0] || counterRows.find((row: any) => row.last_used_at);
    if (!recent) return "I don't have enough device history yet.";
    const name = deviceNameFromEvent(recent);
    const time = formatDeviceHistoryTime(recent.occurred_at || recent.last_used_at);
    return `${name} was active recently${time ? ` at ${time}` : ""}.
Context: This is based only on device events Oyi actually received.
Suggested action: Open Activity for the full device timeline.`;
  }

  if (/how many|times/.test(text)) {
    const target = text.replace(/how many|times|was|were|used|switched|today|the|device|light|switch|\?/g, "").trim();
    const matched = rows.filter((row: any) => !target || deviceNameFromEvent(row).toLowerCase().includes(target)).filter((row: any) => /on|off|executed|state/.test(String(row.event_type || "")));
    if (!matched.length) return "I don't have enough matching device history yet.";
    const name = deviceNameFromEvent(matched[0]);
    return `${name} has ${matched.length} recorded device update${matched.length === 1 ? "" : "s"} today.
Context: These are based only on events Oyi actually received.
Suggested action: Open Activity for the timeline.`;
  }

  const latest = rows.slice(0, 5).map((row: any) => {
    const time = formatDeviceHistoryTime(row.occurred_at);
    const event = String(row.event_type || "updated")
      .replace(/^device\.state\./, "")
      .replace(/\./g, " ");
    return `${deviceNameFromEvent(row)} ${event}${time ? ` at ${time}` : ""}`;
  });
  return `Your device history has recent activity.
Context: ${latest.join("; ")}.
Suggested action: Open Activity for the complete timeline.`;
}
