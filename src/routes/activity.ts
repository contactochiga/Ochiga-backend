import express from "express";
import { requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";

type ActivityCategory =
  | "security"
  | "visitor"
  | "device"
  | "maintenance"
  | "ai"
  | "wallet"
  | "community"
  | "system";

type ActivitySeverity = "low" | "medium" | "high" | "info";

type ActivityEvent = {
  id: string;
  category: ActivityCategory;
  severity: ActivitySeverity;
  title: string;
  description: string;
  occurred_at: string;
  source: string;
  label?: string;
  thumbnail_url?: string | null;
  action?: {
    href: string;
    label: string;
    kind: string;
    entity_id?: string | null;
  } | null;
};

const router = express.Router();

function iso(value: any) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function cleanText(value: any, fallback: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function firstString(...values: any[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function categoryFrom(value: any): ActivityCategory {
  const text = String(value || "").toLowerCase();
  if (/visitor|gate|access|guest/.test(text)) return "visitor";
  if (/device|light|switch|climate|ac|sensor|camera|door/.test(text)) return "device";
  if (/maintenance|support|repair|service/.test(text)) return "maintenance";
  if (/ai|oyi|command|execution/.test(text)) return "ai";
  if (/wallet|payment|billing|service_charge|fund/.test(text)) return "wallet";
  if (/community|notice|announcement|message/.test(text)) return "community";
  if (/security|alert|incident|alarm|motion/.test(text)) return "security";
  return "system";
}

function severityFrom(value: any): ActivitySeverity {
  const text = String(value || "").toLowerCase();
  if (/high|critical|failed|denied|error|leak|alarm/.test(text)) return "high";
  if (/medium|warning|pending|attention/.test(text)) return "medium";
  if (/low|ok|success|executed|resolved|read/.test(text)) return "low";
  return "info";
}

function action(href: string, label: string, kind: string, entityId?: string | null) {
  return { href, label, kind, entity_id: entityId || null };
}

function notificationAction(row: any, category: ActivityCategory) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const typeText = `${row?.type || ""} ${row?.title || ""} ${row?.message || ""} ${payload?.kind || ""}`.toLowerCase();
  const entityId = firstString(row?.entity_id, payload?.entity_id, payload?.id);

  const inviteId = firstString(payload.invite_id, payload.inviteId, payload.invitation_id, entityId && /invite|invitation/.test(typeText) ? entityId : "");
  const postId = firstString(payload.post_id, payload.postId, payload.community_post_id, entityId && /community|post|announcement|notice/.test(typeText) ? entityId : "");
  const commentId = firstString(payload.comment_id, payload.commentId);
  const threadId = firstString(payload.thread_id, payload.threadId, payload.conversation_id, payload.message_thread_id, entityId && /message|thread|chat|inbox/.test(typeText) ? entityId : "");
  const visitorId = firstString(payload.visitor_id, payload.visitorId, payload.guest_id, entityId && /visitor|guest|gate|access/.test(typeText) ? entityId : "");
  const maintenanceId = firstString(payload.request_id, payload.requestId, payload.maintenance_id, payload.maintenanceId, payload.ticket_id, payload.ticketId, entityId && /maintenance|repair|support/.test(typeText) ? entityId : "");
  const transactionId = firstString(payload.transaction_id, payload.transactionId, payload.wallet_transaction_id, entityId && /wallet|payment|transaction/.test(typeText) ? entityId : "");
  const serviceId = firstString(payload.service_id, payload.serviceId, entityId && /service/.test(typeText) ? entityId : "");
  const deviceId = firstString(payload.device_id, payload.deviceId, entityId && /device|light|switch|climate|sensor/.test(typeText) ? entityId : "");
  const roomId = firstString(payload.room_id, payload.roomId, payload.space_id, payload.spaceId, entityId && /room|space/.test(typeText) ? entityId : "");
  const sceneId = firstString(payload.scene_id, payload.sceneId, entityId && /scene/.test(typeText) ? entityId : "");
  const automationId = firstString(payload.automation_id, payload.automationId, entityId && /automation/.test(typeText) ? entityId : "");
  const incidentId = firstString(payload.incident_id, payload.incidentId, payload.security_incident_id, entityId && /security|incident|alert|emergency/.test(typeText) ? entityId : "");

  if (inviteId) return action(`/invites?inviteId=${encodeURIComponent(inviteId)}`, "Open invite", "invite", inviteId);
  if (postId) return action(`/community?postId=${encodeURIComponent(postId)}${commentId ? `&commentId=${encodeURIComponent(commentId)}` : ""}`, commentId ? "Open thread" : "Open post", commentId ? "community_comment" : "community_post", postId);
  if (threadId) return action(`/messages?threadId=${encodeURIComponent(threadId)}`, "Open thread", "message", threadId);
  if (visitorId) return action(`/visitors?visitorId=${encodeURIComponent(visitorId)}`, "Open visitor", "visitor", visitorId);
  if (maintenanceId) return action(`/maintenance?requestId=${encodeURIComponent(maintenanceId)}`, "Open request", "maintenance", maintenanceId);
  if (transactionId) return action(`/wallet?transactionId=${encodeURIComponent(transactionId)}`, "Open transaction", "wallet", transactionId);
  if (serviceId) return action(`/services?serviceId=${encodeURIComponent(serviceId)}`, "Open service", "service", serviceId);
  if (deviceId && !/heartbeat|sync completed|telemetry|turned on|turned off|command.executed/.test(typeText)) return action(`/devices?deviceId=${encodeURIComponent(deviceId)}`, "Open device", "device", deviceId);
  if (roomId) return action(`/spaces?roomId=${encodeURIComponent(roomId)}`, "Open space", "space", roomId);
  if (sceneId && !/executed/.test(typeText)) return action(`/scenes?sceneId=${encodeURIComponent(sceneId)}`, "Open scene", "scene", sceneId);
  if (automationId) return action(`/scenes?tab=automations&automationId=${encodeURIComponent(automationId)}`, "Open automation", "automation", automationId);
  if (incidentId || category === "security") return action(`/security${incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : ""}`, "Open security", "security", incidentId || null);
  return null;
}

async function safeSelect(table: string, build: (q: any) => any) {
  try {
    const query = build(supabaseAdmin.from(table));
    const { data, error } = await query;
    if (error) return { rows: [], available: false, reason: error.message };
    return { rows: data || [], available: true, reason: null };
  } catch (err: any) {
    return { rows: [], available: false, reason: err?.message || "source_unavailable" };
  }
}

function notificationEvent(row: any): ActivityEvent {
  const category = categoryFrom(`${row?.type || ""} ${row?.title || ""} ${row?.message || ""}`);
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const itemAction = notificationAction(row, category);
  return {
    id: `notification:${row.id}`,
    category,
    severity: severityFrom(`${row?.type || ""} ${row?.status || ""} ${row?.title || ""}`),
    title: cleanText(row?.title, "Home update"),
    description: cleanText(row?.message, "Oyi activity"),
    occurred_at: iso(row?.created_at),
    source: "notifications",
    label: cleanText(row?.type, category),
    thumbnail_url: typeof payload.thumbnail_url === "string" ? payload.thumbnail_url : null,
    action: itemAction,
  };
}

function visitorEvent(row: any): ActivityEvent {
  const name = cleanText(row?.visitor_name || row?.name || row?.full_name, "Visitor");
  const status = cleanText(row?.status, "updated").replace(/_/g, " ");
  return {
    id: `visitor:${row.id}`,
    category: "visitor",
    severity: severityFrom(status),
    title: `${name} ${status}`,
    description: cleanText(row?.purpose, "Visitor access activity"),
    occurred_at: iso(row?.updated_at || row?.created_at),
    source: "visitors",
    label: "People",
    thumbnail_url: null,
    action: row?.id ? action(`/visitors?visitorId=${encodeURIComponent(String(row.id))}`, "Open visitor", "visitor", String(row.id)) : null,
  };
}

function maintenanceEvent(row: any): ActivityEvent {
  const status = cleanText(row?.status, "open").replace(/_/g, " ");
  return {
    id: `maintenance:${row.id}`,
    category: "maintenance",
    severity: severityFrom(`${row?.priority || ""} ${status}`),
    title: cleanText(row?.title, "Maintenance request"),
    description: cleanText(row?.description || status, "Service update"),
    occurred_at: iso(row?.updated_at || row?.created_at),
    source: "maintenance_requests",
    label: "Service",
    action: row?.id ? action(`/maintenance?requestId=${encodeURIComponent(String(row.id))}`, "Open request", "maintenance", String(row.id)) : null,
  };
}

function aiEvent(row: any): ActivityEvent {
  return {
    id: `ai:${row.id}`,
    category: "ai",
    severity: severityFrom(row?.execution_status),
    title: cleanText(row?.result_summary || row?.tool_id, "Oyi command"),
    description: cleanText(row?.prompt_excerpt, cleanText(row?.execution_status, "Command update")),
    occurred_at: iso(row?.executed_at || row?.requested_at),
    source: "ai_execution_ledger",
    label: "Oyi",
  };
}

function walletEvent(row: any): ActivityEvent {
  const type = cleanText(row?.type, "wallet").replace(/_/g, " ");
  const status = cleanText(row?.status, "recorded");
  const amount = Number(row?.amount || 0);
  return {
    id: `wallet:${row.id}`,
    category: "wallet",
    severity: severityFrom(status),
    title: `${type} ${status}`,
    description: amount ? `₦${amount.toLocaleString("en-NG")}` : "Wallet activity",
    occurred_at: iso(row?.created_at),
    source: "wallet_transactions",
    label: "Wallet",
    action: row?.id ? action(`/wallet?transactionId=${encodeURIComponent(String(row.id))}`, "Open transaction", "wallet", String(row.id)) : null,
  };
}


function communityEvent(row: any): ActivityEvent {
  const categoryText = `${row?.category || ""} ${row?.title || ""} ${row?.status || ""}`;
  const title = cleanText(row?.title, "Community update");
  const body = cleanText(row?.body || row?.content, "Estate community update");
  const media = Array.isArray(row?.media) ? row.media : [];
  const firstMedia = media.find((item: any) => typeof item?.url === "string" && item.url);
  return {
    id: `community:${row.id}`,
    category: "community",
    severity: severityFrom(categoryText),
    title,
    description: body,
    occurred_at: iso(row?.updated_at || row?.created_at),
    source: "community_posts",
    label: cleanText(row?.category, "Community"),
    thumbnail_url: firstMedia?.url || null,
    action: row?.id ? action(`/community?postId=${encodeURIComponent(String(row.id))}`, "Open post", "community_post", String(row.id)) : null,
  };
}

function incidentEvent(row: any): ActivityEvent {
  return {
    id: `incident:${row.id}`,
    category: "security",
    severity: severityFrom(`${row?.severity || ""} ${row?.status || ""}`),
    title: cleanText(row?.title || row?.incident_type, "Security event"),
    description: cleanText(row?.description || row?.status, "Incident update"),
    occurred_at: iso(row?.updated_at || row?.created_at),
    source: "incidents",
    label: "Security",
    action: row?.id ? action(`/security?incidentId=${encodeURIComponent(String(row.id))}`, "Open security", "security", String(row.id)) : action("/security", "Open security", "security", null),
  };
}

function deviceStateEvent(row: any, device: any): ActivityEvent {
  const status = row?.status && typeof row.status === "object" ? row.status : {};
  const command = status.last_command && typeof status.last_command === "object" ? status.last_command : status;
  const value =
    typeof command.switch === "boolean" ? command.switch :
    typeof command.power === "boolean" ? command.power :
    typeof command.on === "boolean" ? command.on :
    undefined;
  const stateText = typeof value === "boolean" ? (value ? "turned on" : "turned off") : "updated";
  const name = cleanText(device?.name, "Device");
  return {
    id: `device_state:${row.device_id}:${row.last_seen || row.updated_at || row.created_at || ""}`,
    category: "device",
    severity: severityFrom(status.online === false ? "medium" : "info"),
    title: `${name} ${stateText}`,
    description: cleanText(device?.room_name || device?.category || device?.type, "Device state changed"),
    occurred_at: iso(row?.last_seen || row?.updated_at || row?.created_at),
    source: "device_states",
    label: cleanText(device?.category || device?.type, "Device"),
  };
}

async function buildActivity(req: express.Request) {
  const user = req.user!;
  const userId = String(user.id);
  const estateId = user.estate_id ? String(user.estate_id) : "";
  const homeId = user.home_id ? String(user.home_id) : "";

  const [notifications, visitors, maintenance, ai, wallets, incidents, community, devices] = await Promise.all([
    safeSelect("notifications", (q) =>
      q.select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(40)
    ),
    safeSelect("visitors", (q) =>
      q.select("id,visitor_name,name,full_name,purpose,status,created_at,updated_at")
        .or(`created_by.eq.${userId},resident_id.eq.${userId}${homeId ? `,home_id.eq.${homeId}` : ""}`)
        .order("created_at", { ascending: false })
        .limit(20)
    ),
    safeSelect("maintenance_requests", (q) =>
      q.select("id,title,description,priority,status,created_at,updated_at")
        .or(`user_id.eq.${userId},resident_id.eq.${userId}${homeId ? `,home_id.eq.${homeId}` : ""}`)
        .order("created_at", { ascending: false })
        .limit(20)
    ),
    safeSelect("ai_execution_ledger", (q) =>
      q.select("id,tool_id,prompt_excerpt,execution_status,requested_at,executed_at,result_summary")
        .eq("actor_user_id", userId)
        .order("requested_at", { ascending: false })
        .limit(20)
    ),
    safeSelect("wallets", (q) => q.select("id").eq("user_id", userId).limit(10)),
    estateId
      ? safeSelect("incidents", (q) =>
          q.select("id,title,description,incident_type,severity,status,created_at,updated_at").eq("estate_id", estateId).order("created_at", { ascending: false }).limit(20)
        )
      : Promise.resolve({ rows: [], available: true, reason: null }),
    estateId
      ? safeSelect("community_posts", (q) =>
          q.select("id,title,body,content,category,status,media,created_at,updated_at").eq("estate_id", estateId).neq("status", "deleted").order("created_at", { ascending: false }).limit(20)
        )
      : Promise.resolve({ rows: [], available: true, reason: null }),
    safeSelect("devices", (q) => {
      let next = q.select("id,name,category,type,home_id,estate_id").limit(80);
      if (estateId) next = next.eq("estate_id", estateId);
      if (homeId) next = next.eq("home_id", homeId);
      return next;
    }),
  ]);

  const walletIds = wallets.rows.map((row: any) => String(row.id)).filter(Boolean);
  const walletTransactions = walletIds.length
    ? await safeSelect("wallet_transactions", (q) =>
        q.select("id,wallet_id,type,amount,status,created_at").in("wallet_id", walletIds).order("created_at", { ascending: false }).limit(20)
      )
    : { rows: [], available: wallets.available, reason: wallets.reason };

  const deviceMap = new Map(devices.rows.map((device: any) => [String(device.id), device]));
  const deviceIds = devices.rows.map((device: any) => String(device.id)).filter(Boolean);
  const deviceStates = deviceIds.length
    ? await safeSelect("device_states", (q) =>
        q.select("device_id,status,last_seen").in("device_id", deviceIds).order("last_seen", { ascending: false }).limit(20)
      )
    : { rows: [], available: devices.available, reason: devices.reason };

  const events: ActivityEvent[] = [
    ...notifications.rows.map(notificationEvent),
    ...visitors.rows.map(visitorEvent),
    ...maintenance.rows.map(maintenanceEvent),
    ...ai.rows.map(aiEvent),
    ...walletTransactions.rows.map(walletEvent),
    ...incidents.rows.map(incidentEvent),
    ...community.rows.map(communityEvent),
    ...deviceStates.rows.map((row: any) => deviceStateEvent(row, deviceMap.get(String(row.device_id)) || {})),
  ]
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, 60);

  const summary = {
    total_events: events.length,
    alerts: events.filter((event) => event.category === "security" || event.severity === "high").length,
    visitors: events.filter((event) => event.category === "visitor").length,
    actions: events.filter((event) => event.category === "ai" || event.category === "device").length,
  };

  const sources = {
    notifications: { available: notifications.available, reason: notifications.reason },
    visitors: { available: visitors.available, reason: visitors.reason },
    maintenance: { available: maintenance.available, reason: maintenance.reason },
    ai: { available: ai.available, reason: ai.reason },
    wallets: { available: walletTransactions.available, reason: walletTransactions.reason },
    incidents: { available: incidents.available, reason: incidents.reason },
    community: { available: community.available, reason: community.reason },
    devices: { available: devices.available && deviceStates.available, reason: devices.reason || deviceStates.reason },
  };

  return { summary, events, sources, generated_at: new Date().toISOString() };
}

router.get("/feed", requireAuth, async (req, res) => {
  try {
    const data = await buildActivity(req);
    res.json({ items: data.events, summary: data.summary, sources: data.sources, generated_at: data.generated_at });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to load activity feed" });
  }
});

router.get("/summary", requireAuth, async (req, res) => {
  try {
    const data = await buildActivity(req);
    res.json({ summary: data.summary, sources: data.sources, generated_at: data.generated_at });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to load activity summary" });
  }
});

export default router;
