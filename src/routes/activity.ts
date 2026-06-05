import express from "express";
import { requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";

type ActivityCategory =
  | "device"
  | "visitor"
  | "message"
  | "community"
  | "maintenance"
  | "wallet"
  | "service"
  | "security"
  | "invite"
  | "scene"
  | "automation"
  | "system"
  | "profile"
  | "watch";

type ActivitySeverity = "info" | "success" | "attention" | "warning" | "critical";

type ActivityAction = {
  kind: string;
  route: string;
  href: string;
  entity_id: string | null;
  label: string;
};

type ActivityEvent = {
  id: string;
  source: string;
  type: string;
  title: string;
  summary: string;
  description: string;
  occurred_at: string;
  severity: ActivitySeverity;
  category: ActivityCategory;
  actor: Record<string, any> | null;
  target: Record<string, any> | null;
  estate_id: string | null;
  home_id: string | null;
  user_id: string | null;
  label?: string;
  thumbnail_url?: string | null;
  action?: ActivityAction | null;
  metadata: Record<string, any>;
};

type SourceResult = { rows: any[]; available: boolean; reason: string | null };

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;

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

function objectValue(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function categoryFrom(value: any): ActivityCategory {
  const text = String(value || "").toLowerCase();
  if (/watch/.test(text)) return "watch";
  if (/invite|invitation|membership|access updated|home member/.test(text)) return "invite";
  if (/profile|verification|avatar/.test(text)) return "profile";
  if (/automation/.test(text)) return "automation";
  if (/scene/.test(text)) return "scene";
  if (/message|thread|chat|inbox|dm/.test(text)) return "message";
  if (/visitor|gate|guest/.test(text)) return "visitor";
  if (/device|light|switch|climate|ac|sensor|camera|door|sync|tuya|edge/.test(text)) return "device";
  if (/maintenance|support|repair|ticket/.test(text)) return "maintenance";
  if (/service_charge|service request|service payment|utility service/.test(text)) return "service";
  if (/wallet|payment|billing|fund|transaction|dues/.test(text)) return "wallet";
  if (/community|notice|announcement|comment|post|reaction/.test(text)) return "community";
  if (/security|alert|incident|alarm|motion|lockdown|emergency/.test(text)) return "security";
  return "system";
}

function severityFrom(value: any): ActivitySeverity {
  const text = String(value || "").toLowerCase();
  if (/critical|failed|denied|error|leak|alarm|lockdown|emergency|rejected/.test(text)) return "critical";
  if (/warning|overdue|expired|offline|unavailable|cancelled/.test(text)) return "warning";
  if (/pending|attention|waiting|open|new|requested|created|invited/.test(text)) return "attention";
  if (/success|executed|resolved|read|active|approved|accepted|completed|paid|online|synced/.test(text)) return "success";
  return "info";
}

function action(route: string, label: string, kind: string, entityId?: string | null): ActivityAction {
  return { kind, route, href: route, entity_id: entityId || null, label };
}

function baseEvent(input: Omit<ActivityEvent, "description" | "metadata"> & { metadata?: Record<string, any>; summary?: string }) : ActivityEvent {
  const summary = cleanText(input.summary, "Home activity");
  return {
    ...input,
    summary,
    description: summary,
    estate_id: input.estate_id || null,
    home_id: input.home_id || null,
    user_id: input.user_id || null,
    actor: input.actor || null,
    target: input.target || null,
    action: input.action || null,
    metadata: objectValue(input.metadata),
  };
}

function notificationAction(row: any, category: ActivityCategory) {
  const payload = objectValue(row?.payload);
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

async function safeSelect(table: string, build: (q: any) => any): Promise<SourceResult> {
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
  const payload = objectValue(row?.payload);
  const category = categoryFrom(`${row?.type || ""} ${row?.title || ""} ${row?.message || ""} ${payload?.kind || ""}`);
  return baseEvent({
    id: `notification:${row.id}`,
    source: "notifications",
    type: cleanText(row?.type, "notification"),
    category,
    severity: severityFrom(`${row?.type || ""} ${row?.status || ""} ${row?.title || ""}`),
    title: cleanText(row?.title, "Home update"),
    summary: cleanText(row?.message, "Oyi activity"),
    occurred_at: iso(row?.created_at),
    estate_id: firstString(row?.estate_id, payload.estate_id) || null,
    home_id: firstString(row?.home_id, payload.home_id) || null,
    user_id: firstString(row?.user_id) || null,
    actor: null,
    target: firstString(row?.entity_id, payload.entity_id) ? { id: firstString(row?.entity_id, payload.entity_id) } : null,
    label: cleanText(row?.type, category),
    thumbnail_url: typeof payload.thumbnail_url === "string" ? payload.thumbnail_url : null,
    action: notificationAction(row, category),
    metadata: { payload },
  });
}

function visitorEvent(row: any, source = "visitor_access"): ActivityEvent {
  const name = cleanText(row?.visitor_name || row?.name || row?.full_name || row?.guest_name, "Visitor");
  const status = cleanText(row?.status, "updated").replace(/_/g, " ");
  return baseEvent({
    id: `${source}:${row.id}`,
    source,
    type: `visitor.${cleanText(row?.status, "updated")}`,
    category: "visitor",
    severity: severityFrom(status),
    title: `${name} ${status}`,
    summary: cleanText(row?.purpose || row?.visit_reason, "Visitor access activity"),
    occurred_at: iso(row?.updated_at || row?.created_at),
    estate_id: firstString(row?.estate_id) || null,
    home_id: firstString(row?.home_id) || null,
    user_id: firstString(row?.resident_id, row?.created_by, row?.user_id) || null,
    actor: { name },
    target: row?.id ? { id: String(row.id), type: "visitor" } : null,
    label: "People",
    thumbnail_url: null,
    action: row?.id ? action(`/visitors?visitorId=${encodeURIComponent(String(row.id))}`, "Open visitor", "visitor", String(row.id)) : null,
  });
}

function maintenanceEvent(row: any): ActivityEvent {
  const status = cleanText(row?.status, "open").replace(/_/g, " ");
  return baseEvent({
    id: `maintenance:${row.id}`,
    source: "maintenance_requests",
    type: `maintenance.${cleanText(row?.status, "updated")}`,
    category: "maintenance",
    severity: severityFrom(`${row?.priority || ""} ${status}`),
    title: cleanText(row?.title, "Maintenance request"),
    summary: cleanText(row?.description || status, "Service update"),
    occurred_at: iso(row?.updated_at || row?.created_at),
    estate_id: firstString(row?.estate_id) || null,
    home_id: firstString(row?.home_id) || null,
    user_id: firstString(row?.user_id, row?.resident_id, row?.created_by) || null,
    actor: null,
    target: row?.id ? { id: String(row.id), type: "maintenance" } : null,
    label: "Service",
    action: row?.id ? action(`/maintenance?requestId=${encodeURIComponent(String(row.id))}`, "Open request", "maintenance", String(row.id)) : null,
  });
}

function commandLedgerEvent(row: any): ActivityEvent {
  const status = cleanText(row?.execution_status, "recorded");
  return baseEvent({
    id: `command:${row.id}`,
    source: "ai_execution_ledger",
    type: `system.command.${status}`,
    category: "system",
    severity: severityFrom(status),
    title: cleanText(row?.result_summary || row?.tool_id, "Oyi command"),
    summary: cleanText(row?.prompt_excerpt, cleanText(status, "Command update")),
    occurred_at: iso(row?.executed_at || row?.requested_at),
    estate_id: firstString(row?.estate_id) || null,
    home_id: firstString(row?.home_id) || null,
    user_id: firstString(row?.actor_user_id) || null,
    actor: firstString(row?.actor_user_id) ? { id: String(row.actor_user_id) } : null,
    target: row?.tool_id ? { type: "command", id: String(row.tool_id) } : null,
    label: "Oyi",
  });
}

function walletEvent(row: any): ActivityEvent {
  const meta = objectValue(row?.metadata);
  const type = cleanText(row?.type || row?.direction, "wallet").replace(/_/g, " ");
  const status = cleanText(row?.status, "recorded");
  const amount = Number(row?.amount || 0);
  const serviceTitle = cleanText(meta?.receipt?.title || meta?.service_title, "");
  const isService = String(meta?.source || "").toLowerCase() === "services_api" || Boolean(meta?.service_key || serviceTitle);
  return baseEvent({
    id: `${isService ? "service_payment" : "wallet"}:${row.id}`,
    source: isService ? "service_payments" : "wallet_transactions",
    type: isService ? `service.payment.${status}` : `wallet.${status}`,
    category: isService ? "service" : "wallet",
    severity: severityFrom(status),
    title: isService ? `${serviceTitle || "Service payment"} ${status}` : `${type} ${status}`,
    summary: amount ? `NGN ${amount.toLocaleString("en-NG")}` : isService ? "Service payment activity" : "Wallet activity",
    occurred_at: iso(row?.created_at),
    estate_id: firstString(meta?.estate_id) || null,
    home_id: firstString(meta?.home_id) || null,
    user_id: firstString(row?.user_id, meta?.userId, meta?.user_id) || null,
    actor: null,
    target: row?.id ? { id: String(row.id), type: isService ? "service_payment" : "wallet_transaction" } : null,
    label: isService ? "Services" : "Wallet",
    action: row?.id
      ? action(isService ? `/services?paymentId=${encodeURIComponent(String(row.id))}` : `/wallet?transactionId=${encodeURIComponent(String(row.id))}`, isService ? "Open service" : "Open transaction", isService ? "service" : "wallet", String(row.id))
      : null,
    metadata: { reference: row?.reference || null, service_key: meta?.service_key || null },
  });
}

function communityEvent(row: any): ActivityEvent {
  const categoryText = `${row?.category || ""} ${row?.type || ""} ${row?.title || ""} ${row?.status || ""}`;
  const media = Array.isArray(row?.media) ? row.media : [];
  const firstMedia = media.find((item: any) => typeof item?.url === "string" && item.url);
  const isComment = Boolean(row?.post_id || row?.comment_id || row?.body && !row?.title && row?.post_id !== undefined);
  const postId = firstString(row?.post_id, row?.community_post_id, row?.id && !isComment ? row.id : "");
  const commentId = isComment ? firstString(row?.id, row?.comment_id) : "";
  return baseEvent({
    id: `${isComment ? "community_comment" : "community"}:${row.id}`,
    source: isComment ? "community_comments" : "community_posts",
    type: isComment ? "community.comment" : "community.post",
    category: "community",
    severity: severityFrom(categoryText),
    title: isComment ? "New community comment" : cleanText(row?.title, "Community update"),
    summary: cleanText(row?.body || row?.content || row?.summary, "Estate community update"),
    occurred_at: iso(row?.updated_at || row?.created_at),
    estate_id: firstString(row?.estate_id) || null,
    home_id: firstString(row?.home_id) || null,
    user_id: firstString(row?.author_id, row?.user_id, row?.created_by) || null,
    actor: firstString(row?.author_name, row?.resident_name) ? { name: firstString(row?.author_name, row?.resident_name) } : null,
    target: postId ? { id: postId, type: "community_post", comment_id: commentId || null } : null,
    label: cleanText(row?.category, isComment ? "Comment" : "Community"),
    thumbnail_url: firstMedia?.url || null,
    action: postId ? action(`/community?postId=${encodeURIComponent(postId)}${commentId ? `&commentId=${encodeURIComponent(commentId)}` : ""}`, isComment ? "Open thread" : "Open post", isComment ? "community_comment" : "community_post", postId) : null,
  });
}

function messageEvent(row: any): ActivityEvent {
  const senderId = firstString(row?.sender_id);
  return baseEvent({
    id: `message:${row.id}`,
    source: "dm_messages",
    type: "message.created",
    category: "message",
    severity: "attention",
    title: senderId === firstString(row?.current_user_id) ? "Message sent" : "New message",
    summary: cleanText(row?.body, "Message update"),
    occurred_at: iso(row?.created_at),
    estate_id: firstString(row?.estate_id) || null,
    home_id: firstString(row?.home_id) || null,
    user_id: senderId || null,
    actor: senderId ? { id: senderId } : null,
    target: row?.thread_id ? { id: String(row.thread_id), type: "message_thread" } : null,
    label: "Messages",
    action: row?.thread_id ? action(`/messages?threadId=${encodeURIComponent(String(row.thread_id))}`, "Open thread", "message", String(row.thread_id)) : null,
  });
}

function inviteEvent(row: any): ActivityEvent {
  const status = cleanText(row?.status, "pending");
  return baseEvent({
    id: `invite:${row.id}`,
    source: "invites",
    type: `invite.${status}`,
    category: "invite",
    severity: severityFrom(status),
    title: status === "pending" ? "Home invite received" : `Invite ${status}`,
    summary: cleanText(row?.role, "Home access invitation"),
    occurred_at: iso(row?.claimed_at || row?.updated_at || row?.created_at),
    estate_id: firstString(row?.estate_id) || null,
    home_id: firstString(row?.home_id) || null,
    user_id: firstString(row?.claimed_by) || null,
    actor: null,
    target: row?.id ? { id: String(row.id), type: "invite" } : null,
    label: "Access",
    action: row?.id && status === "pending" ? action(`/invites?inviteId=${encodeURIComponent(String(row.id))}`, "Open invite", "invite", String(row.id)) : null,
  });
}

function membershipEvent(row: any, source: "home_memberships" | "estate_memberships"): ActivityEvent {
  const status = cleanText(row?.status, "updated");
  const label = source === "home_memberships" ? "Home access" : "Estate access";
  return baseEvent({
    id: `${source}:${row.id || `${row.user_id}:${row.home_id || row.estate_id}`}:${row.updated_at || row.created_at || ""}`,
    source,
    type: `${source === "home_memberships" ? "home" : "estate"}.access.${status}`,
    category: "invite",
    severity: severityFrom(status),
    title: `${label} ${status}`,
    summary: cleanText(row?.role, "Access updated"),
    occurred_at: iso(row?.updated_at || row?.created_at),
    estate_id: firstString(row?.estate_id) || null,
    home_id: firstString(row?.home_id) || null,
    user_id: firstString(row?.user_id) || null,
    actor: null,
    target: row?.home_id ? { id: String(row.home_id), type: "home" } : row?.estate_id ? { id: String(row.estate_id), type: "estate" } : null,
    label: "Access",
  });
}

function sceneEvent(row: any, kind: "scene" | "automation"): ActivityEvent {
  const enabled = row?.enabled === false ? "paused" : "active";
  return baseEvent({
    id: `${kind}:${row.id}:${row.updated_at || row.created_at || ""}`,
    source: kind === "scene" ? "consumer_scenes" : "consumer_automations",
    type: `${kind}.${enabled}`,
    category: kind,
    severity: severityFrom(enabled),
    title: cleanText(row?.name, kind === "scene" ? "Scene" : "Automation"),
    summary: cleanText(row?.description || row?.mood || enabled, kind === "scene" ? "Scene update" : "Automation update"),
    occurred_at: iso(row?.updated_at || row?.created_at),
    estate_id: firstString(row?.estate_id) || null,
    home_id: firstString(row?.home_id) || null,
    user_id: firstString(row?.created_by) || null,
    actor: firstString(row?.created_by) ? { id: String(row.created_by) } : null,
    target: row?.id ? { id: String(row.id), type: kind } : null,
    label: kind === "scene" ? "Scenes" : "Automations",
    action: row?.id ? action(kind === "scene" ? `/scenes?sceneId=${encodeURIComponent(String(row.id))}` : `/scenes?tab=automations&automationId=${encodeURIComponent(String(row.id))}`, kind === "scene" ? "Open scene" : "Open automation", kind, String(row.id)) : null,
  });
}

function incidentEvent(row: any, source = "incidents"): ActivityEvent {
  return baseEvent({
    id: `${source}:${row.id}`,
    source,
    type: `security.${cleanText(row?.status, "incident")}`,
    category: "security",
    severity: severityFrom(`${row?.severity || ""} ${row?.status || ""}`),
    title: cleanText(row?.title || row?.incident_type || row?.type, "Security event"),
    summary: cleanText(row?.description || row?.status, "Incident update"),
    occurred_at: iso(row?.updated_at || row?.created_at),
    estate_id: firstString(row?.estate_id) || null,
    home_id: firstString(row?.home_id) || null,
    user_id: firstString(row?.reported_by, row?.created_by, row?.assigned_to) || null,
    actor: null,
    target: row?.id ? { id: String(row.id), type: "incident" } : null,
    label: "Security",
    action: row?.id ? action(`/security?incidentId=${encodeURIComponent(String(row.id))}`, "Open security", "security", String(row.id)) : action("/security", "Open security", "security", null),
  });
}

function auditEvent(row: any): ActivityEvent | null {
  const actionText = cleanText(row?.action, "audit.recorded");
  const resourceType = cleanText(row?.resource_type, "system");
  const category = categoryFrom(`${actionText} ${resourceType}`);
  if (!["device", "scene", "automation", "invite", "profile", "watch", "system"].includes(category)) return null;
  const resourceId = firstString(row?.resource_id);
  const isInformationalDevice = category === "device" && /command\.executed|status|heartbeat/.test(actionText.toLowerCase());
  const route = category === "device" && resourceId && !isInformationalDevice ? `/devices?deviceId=${encodeURIComponent(resourceId)}`
    : category === "scene" && resourceId ? `/scenes?sceneId=${encodeURIComponent(resourceId)}`
    : category === "automation" && resourceId ? `/scenes?tab=automations&automationId=${encodeURIComponent(resourceId)}`
    : category === "profile" ? "/profile"
    : "";
  return baseEvent({
    id: `audit:${row.id}`,
    source: "audit_events",
    type: actionText,
    category,
    severity: severityFrom(`${row?.status || ""} ${actionText}`),
    title: cleanText(row?.metadata?.title || actionText.replace(/[._]/g, " "), "Activity recorded"),
    summary: cleanText(row?.metadata?.summary || row?.status, "System activity"),
    occurred_at: iso(row?.created_at || row?.timestamp),
    estate_id: firstString(row?.estate_id) || null,
    home_id: firstString(row?.home_id) || null,
    user_id: firstString(row?.actor_id) || null,
    actor: firstString(row?.actor_id) ? { id: String(row.actor_id), role: row?.actor_role || null } : null,
    target: resourceId ? { id: resourceId, type: resourceType } : null,
    label: category === "system" ? "System" : cleanText(resourceType, category),
    action: route ? action(route, category === "profile" ? "Open profile" : "Open", category, resourceId || null) : null,
    metadata: objectValue(row?.metadata),
  });
}

function deviceStateEvent(row: any, device: any): ActivityEvent {
  const status = objectValue(row?.status);
  const command = objectValue(status.last_command || status);
  const value =
    typeof command.switch === "boolean" ? command.switch :
    typeof command.power === "boolean" ? command.power :
    typeof command.on === "boolean" ? command.on :
    undefined;
  const stateText = typeof value === "boolean" ? (value ? "turned on" : "turned off") : "updated";
  const name = cleanText(device?.name, "Device");
  return baseEvent({
    id: `device_state:${row.device_id}:${row.last_seen || row.updated_at || row.created_at || ""}`,
    source: "device_states",
    type: "device.status.updated",
    category: "device",
    severity: severityFrom(status.online === false ? "warning" : "info"),
    title: `${name} ${stateText}`,
    summary: cleanText(device?.room_name || device?.category || device?.type, "Device state changed"),
    occurred_at: iso(row?.last_seen || row?.updated_at || row?.created_at),
    estate_id: firstString(device?.estate_id) || null,
    home_id: firstString(device?.home_id) || null,
    user_id: null,
    actor: null,
    target: row?.device_id ? { id: String(row.device_id), type: "device" } : null,
    label: cleanText(device?.category || device?.type, "Device"),
  });
}

function sourceMap(sources: Record<string, SourceResult>) {
  return Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, { available: value.available, reason: value.reason }]));
}

function uniqueEvents(events: ActivityEvent[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

async function buildActivity(req: express.Request) {
  const user = req.user!;
  const userId = String(user.id);
  const userEmail = String(user.email || "").trim().toLowerCase();
  const estateId = user.estate_id ? String(user.estate_id) : "";
  const homeId = user.home_id ? String(user.home_id) : "";
  const sinceIso = new Date(Date.now() - 30 * DAY_MS).toISOString();

  const [notifications, legacyVisitors, visitorAccess, maintenance, commandLedger, wallets, incidents, facilityIncidents, community, devices, messageMemberships, invites, homeMemberships, estateMemberships, scenes, automations, audits] = await Promise.all([
    safeSelect("notifications", (q) => q.select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(60)),
    safeSelect("visitors", (q) => q.select("id,visitor_name,name,full_name,purpose,status,created_at,updated_at,estate_id,home_id,resident_id,created_by,user_id").or(`created_by.eq.${userId},resident_id.eq.${userId},user_id.eq.${userId}${homeId ? `,home_id.eq.${homeId}` : ""}`).order("created_at", { ascending: false }).limit(20)),
    safeSelect("visitor_access", (q) => q.select("*").or(`created_by.eq.${userId},resident_id.eq.${userId},user_id.eq.${userId}${homeId ? `,home_id.eq.${homeId}` : ""}`).order("created_at", { ascending: false }).limit(30)),
    safeSelect("maintenance_requests", (q) => q.select("*").or(`user_id.eq.${userId},resident_id.eq.${userId},created_by.eq.${userId}${homeId ? `,home_id.eq.${homeId}` : ""}`).order("created_at", { ascending: false }).limit(30)),
    safeSelect("ai_execution_ledger", (q) => q.select("*").eq("actor_user_id", userId).order("requested_at", { ascending: false }).limit(20)),
    safeSelect("wallets", (q) => q.select("id,user_id").eq("user_id", userId).limit(10)),
    estateId ? safeSelect("incidents", (q) => q.select("*").eq("estate_id", estateId).order("created_at", { ascending: false }).limit(20)) : Promise.resolve({ rows: [], available: true, reason: null }),
    estateId ? safeSelect("facility_incidents", (q) => q.select("*").eq("estate_id", estateId).order("created_at", { ascending: false }).limit(20)) : Promise.resolve({ rows: [], available: true, reason: null }),
    estateId ? safeSelect("community_posts", (q) => q.select("*").eq("estate_id", estateId).neq("status", "deleted").order("created_at", { ascending: false }).limit(30)) : Promise.resolve({ rows: [], available: true, reason: null }),
    safeSelect("devices", (q) => {
      let next = q.select("id,name,category,type,home_id,estate_id,room_name").limit(100);
      if (estateId) next = next.eq("estate_id", estateId);
      if (homeId) next = next.eq("home_id", homeId);
      return next;
    }),
    safeSelect("dm_thread_members", (q) => q.select("thread_id,last_read_at").eq("user_id", userId).eq("is_active", true).limit(200)),
    userEmail ? safeSelect("invites", (q) => q.select("*").eq("invited_email", userEmail).order("created_at", { ascending: false }).limit(20)) : Promise.resolve({ rows: [], available: true, reason: null }),
    safeSelect("home_memberships", (q) => q.select("*").eq("user_id", userId).order("updated_at", { ascending: false, nullsFirst: false }).limit(20)),
    safeSelect("estate_memberships", (q) => q.select("*").eq("user_id", userId).order("updated_at", { ascending: false, nullsFirst: false }).limit(20)),
    safeSelect("consumer_scenes", (q) => {
      let next = q.select("*").order("updated_at", { ascending: false, nullsFirst: false }).limit(20);
      if (estateId) next = next.eq("estate_id", estateId);
      if (homeId) next = next.eq("home_id", homeId);
      return next;
    }),
    safeSelect("consumer_automations", (q) => {
      let next = q.select("*").order("updated_at", { ascending: false, nullsFirst: false }).limit(20);
      if (estateId) next = next.eq("estate_id", estateId);
      if (homeId) next = next.eq("home_id", homeId);
      return next;
    }),
    safeSelect("audit_events", (q) => {
      let next = q.select("*").gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(50);
      if (estateId) next = next.eq("estate_id", estateId);
      return next;
    }),
  ]);

  const communityPostIds = community.rows.map((row) => String(row.id)).filter(Boolean);
  const communityComments = communityPostIds.length
    ? await safeSelect("community_comments", (q) => q.select("*").in("post_id", communityPostIds).order("created_at", { ascending: false }).limit(30))
    : { rows: [], available: community.available, reason: community.reason };

  const walletIds = wallets.rows.map((row: any) => String(row.id)).filter(Boolean);
  const walletTransactions = walletIds.length
    ? await safeSelect("wallet_transactions", (q) => q.select("*").in("wallet_id", walletIds).order("created_at", { ascending: false }).limit(40))
    : { rows: [], available: wallets.available, reason: wallets.reason };

  const threadIds = messageMemberships.rows.map((row: any) => String(row.thread_id)).filter(Boolean);
  const messages = threadIds.length
    ? await safeSelect("dm_messages", (q) => q.select("id,thread_id,body,sender_id,created_at,is_hidden,estate_id,home_id").in("thread_id", threadIds).eq("is_hidden", false).order("created_at", { ascending: false }).limit(30))
    : { rows: [], available: messageMemberships.available, reason: messageMemberships.reason };

  const deviceMap = new Map(devices.rows.map((device: any) => [String(device.id), device]));
  const deviceIds = devices.rows.map((device: any) => String(device.id)).filter(Boolean);
  const deviceStates = deviceIds.length
    ? await safeSelect("device_states", (q) => q.select("device_id,status,last_seen,updated_at,created_at").in("device_id", deviceIds).order("last_seen", { ascending: false }).limit(30))
    : { rows: [], available: devices.available, reason: devices.reason };

  const auditEvents = audits.rows.map(auditEvent).filter(Boolean) as ActivityEvent[];
  const events = uniqueEvents([
    ...notifications.rows.map(notificationEvent),
    ...visitorAccess.rows.map((row: any) => visitorEvent(row, "visitor_access")),
    ...legacyVisitors.rows.map((row: any) => visitorEvent(row, "visitors")),
    ...maintenance.rows.map(maintenanceEvent),
    ...messages.rows.map((row: any) => messageEvent({ ...row, current_user_id: userId })),
    ...commandLedger.rows.map(commandLedgerEvent),
    ...walletTransactions.rows.map(walletEvent),
    ...incidents.rows.map((row: any) => incidentEvent(row, "incidents")),
    ...facilityIncidents.rows.map((row: any) => incidentEvent(row, "facility_incidents")),
    ...community.rows.map(communityEvent),
    ...communityComments.rows.map(communityEvent),
    ...invites.rows.map(inviteEvent),
    ...homeMemberships.rows.map((row: any) => membershipEvent(row, "home_memberships")),
    ...estateMemberships.rows.map((row: any) => membershipEvent(row, "estate_memberships")),
    ...scenes.rows.map((row: any) => sceneEvent(row, "scene")),
    ...automations.rows.map((row: any) => sceneEvent(row, "automation")),
    ...deviceStates.rows.map((row: any) => deviceStateEvent(row, deviceMap.get(String(row.device_id)) || {})),
    ...auditEvents,
  ])
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, 80);

  const summary = {
    events: events.length,
    total_events: events.length,
    alerts: events.filter((event) => event.category === "security" || event.severity === "critical" || event.severity === "warning").length,
    visitors: events.filter((event) => event.category === "visitor").length,
    actions: events.filter((event) => Boolean(event.action)).length,
    unread: notifications.rows.filter((row: any) => !row?.read_at && !/read|seen|ack/.test(String(row?.status || "").toLowerCase())).length,
    critical: events.filter((event) => event.severity === "critical").length,
    attention: events.filter((event) => event.severity === "attention" || event.severity === "warning").length,
  };

  const sources = sourceMap({
    notifications,
    visitor_access: visitorAccess,
    visitors: legacyVisitors,
    maintenance_requests: maintenance,
    messages,
    dm_thread_members: messageMemberships,
    ai_execution_ledger: commandLedger,
    wallets,
    wallet_transactions: walletTransactions,
    incidents,
    facility_incidents: facilityIncidents,
    community_posts: community,
    community_comments: communityComments,
    invites,
    home_memberships: homeMemberships,
    estate_memberships: estateMemberships,
    consumer_scenes: scenes,
    consumer_automations: automations,
    devices,
    device_states: deviceStates,
    audit_events: audits,
  });

  return { summary, events, sources, generated_at: new Date().toISOString() };
}

router.get("/feed", requireAuth, async (req, res) => {
  try {
    const data = await buildActivity(req);
    res.json({ items: data.events, summary: data.summary, generated_at: data.generated_at });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to load activity feed" });
  }
});

router.get("/summary", requireAuth, async (req, res) => {
  try {
    const data = await buildActivity(req);
    res.json({ summary: data.summary, generated_at: data.generated_at });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to load activity summary" });
  }
});

router.get("/sources", requireAuth, async (req, res) => {
  try {
    const data = await buildActivity(req);
    res.json({ sources: data.sources, generated_at: data.generated_at });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to load activity sources" });
  }
});

export default router;
