import type { OyiTarget, OyiTargetType } from "../../types/oisContext";
import type { NotificationActionability, NotificationDestination, NotificationSourceType, OisNotificationRouting } from "../../types/notificationRouting";

type NotificationLike = {
  type?: unknown;
  title?: unknown;
  message?: unknown;
  entity_id?: unknown;
  entityId?: unknown;
  source_type?: unknown;
  source_id?: unknown;
  destination?: unknown;
  target?: unknown;
  actionability?: unknown;
  attention_eligible?: unknown;
  queue_eligible?: unknown;
  acknowledgement_required?: unknown;
  routing?: Partial<OisNotificationRouting> | null;
  payload?: Record<string, any> | null;
};

const SOURCE_TYPES = new Set<NotificationSourceType>(["visitor", "maintenance", "incident", "workflow", "prediction", "device", "camera", "edge", "utility", "provider", "wallet", "service", "community", "message", "handover", "system"]);
const DESTINATIONS = new Set<NotificationDestination>(["page", "drawer", "queue", "attention", "external", "none"]);
const ACTIONS = new Set<NotificationActionability>(["informational", "review", "approve", "assign", "acknowledge", "resolve", "verify", "escalate"]);
const TARGET_TYPES = new Set<OyiTargetType>(["workflow", "prediction", "incident", "maintenance", "visitor", "device", "camera", "infrastructure", "wallet", "service", "community", "message", "handover", "none"]);

const clean = (value: unknown) => String(value || "").trim() || null;
const bool = (value: unknown) => value === true || value === "true" || value === 1 || value === "1";

function sourceFor(value: unknown): NotificationSourceType | null {
  const raw = String(value || "").trim().toLowerCase();
  if (SOURCE_TYPES.has(raw as NotificationSourceType)) return raw as NotificationSourceType;
  if (/visitor|guest|gate|access/.test(raw)) return "visitor";
  if (/maintenance|repair|ticket|support/.test(raw)) return "maintenance";
  if (/incident|security|alarm|emergency/.test(raw)) return "incident";
  if (/workflow/.test(raw)) return "workflow";
  if (/predict/.test(raw)) return "prediction";
  if (/camera|cctv/.test(raw)) return "camera";
  if (/edge/.test(raw)) return "edge";
  if (/utility|power|water|generator/.test(raw)) return "utility";
  if (/provider|integration/.test(raw)) return "provider";
  if (/device|light|switch|relay|sensor/.test(raw)) return "device";
  if (/wallet|payment|transaction|billing/.test(raw)) return "wallet";
  if (/service|internet|electricity/.test(raw)) return "service";
  if (/community|post|announcement|moderation/.test(raw)) return "community";
  if (/message|thread|chat|inbox/.test(raw)) return "message";
  if (/handover|shift/.test(raw)) return "handover";
  return null;
}

function targetFor(source: NotificationSourceType, sourceId: string | null, routing: any, payload: Record<string, any>): OyiTarget | null {
  const explicit = routing?.target || payload?.target;
  if (explicit && TARGET_TYPES.has(String(explicit.target_type || explicit.type || "") as OyiTargetType)) {
    return {
      target_type: String(explicit.target_type || explicit.type) as OyiTargetType,
      target_id: clean(explicit.target_id || explicit.id),
      infrastructure_source: explicit.infrastructure_source,
      open_as: DESTINATIONS.has(String(explicit.open_as || "") as NotificationDestination) ? explicit.open_as : "page",
      action: explicit.action,
    };
  }
  const targetType: Record<NotificationSourceType, OyiTargetType> = {
    visitor: "visitor", maintenance: "maintenance", incident: "incident", workflow: "workflow", prediction: "prediction",
    device: "device", camera: "camera", edge: "infrastructure", utility: "infrastructure", provider: "infrastructure",
    wallet: "wallet", service: "service", community: "community", message: "message", handover: "handover", system: "none",
  };
  const type = targetType[source];
  if (type === "none") return null;
  if (type === "infrastructure") {
    const infrastructure_source = source === "camera" ? "cameras" : source === "edge" ? "edge" : source === "utility" ? "utilities" : source === "provider" ? "providers" : "devices";
    return { target_type: "infrastructure", target_id: sourceId, infrastructure_source, open_as: "drawer", action: "inspect" };
  }
  return sourceId ? { target_type: type, target_id: sourceId, open_as: ["workflow", "prediction", "incident"].includes(type) ? "drawer" : "page", action: "inspect" } : null;
}

function routingDefaults(source: NotificationSourceType, statusText: string) {
  const critical = /critical|overdue|escalated|failed|blocked|offline|breach|emergency/.test(statusText);
  const pending = /pending|awaiting|approval|required/.test(statusText);
  if (source === "message" || source === "community" || source === "handover") return { actionability: "informational" as const, attention: false, queue: false, acknowledgement: false };
  if (source === "visitor" && pending) return { actionability: "approve" as const, attention: true, queue: true, acknowledgement: true };
  if (source === "workflow") return { actionability: /verification/.test(statusText) ? "verify" as const : "review" as const, attention: critical || pending, queue: critical || pending, acknowledgement: critical || pending };
  if (source === "prediction") return { actionability: "review" as const, attention: true, queue: false, acknowledgement: false };
  if (source === "incident") return { actionability: critical ? "acknowledge" as const : "review" as const, attention: true, queue: true, acknowledgement: true };
  if (source === "maintenance" && (critical || pending)) return { actionability: /unassigned/.test(statusText) ? "assign" as const : "review" as const, attention: true, queue: true, acknowledgement: critical };
  if (["device", "camera", "edge", "utility", "provider"].includes(source) && critical) return { actionability: "review" as const, attention: true, queue: true, acknowledgement: true };
  return { actionability: "informational" as const, attention: false, queue: false, acknowledgement: false };
}

/** New producer normalizer. The routing result is persisted with every service-created notification. */
export function normalizeNotificationRouting(input: NotificationLike, legacy = false): OisNotificationRouting {
  const payload = input.payload || {};
  const explicit = input.routing || payload.routing || {};
  const legacyText = `${input.type || ""} ${payload.kind || ""} ${payload.event_type || ""}`;
  const source_type = sourceFor(explicit.source_type || input.source_type || payload.source_type || payload.sourceType || legacyText) || "system";
  const source_id = clean(explicit.source_id || input.source_id || payload.source_id || payload.sourceId || input.entity_id || input.entityId || payload.entity_id || payload.id || payload.visitor_id || payload.request_id || payload.workflow_id || payload.prediction_id || payload.incident_id || payload.device_id || payload.transaction_id || payload.post_id || payload.thread_id);
  const statusText = `${input.type || ""} ${payload.kind || ""} ${payload.status || ""} ${payload.severity || ""} ${payload.state || ""}${legacy ? ` ${input.title || ""} ${input.message || ""}` : ""}`.toLowerCase();
  const defaults = routingDefaults(source_type, statusText);
  const target = targetFor(source_type, source_id, explicit, payload);
  const destination = DESTINATIONS.has(String(explicit.destination || input.destination || payload.destination || "") as NotificationDestination)
    ? String(explicit.destination || input.destination || payload.destination) as NotificationDestination
    : target ? target.open_as : "none";
  return {
    source_type,
    source_id,
    destination,
    target,
    actionability: ACTIONS.has(String(explicit.actionability || input.actionability || payload.actionability || "") as NotificationActionability) ? String(explicit.actionability || input.actionability || payload.actionability) as NotificationActionability : defaults.actionability,
    attention_eligible: explicit.attention_eligible === undefined && input.attention_eligible === undefined && payload.attention_eligible === undefined ? defaults.attention : bool(explicit.attention_eligible ?? input.attention_eligible ?? payload.attention_eligible),
    queue_eligible: explicit.queue_eligible === undefined && input.queue_eligible === undefined && payload.queue_eligible === undefined ? defaults.queue : bool(explicit.queue_eligible ?? input.queue_eligible ?? payload.queue_eligible),
    acknowledgement_required: explicit.acknowledgement_required === undefined && input.acknowledgement_required === undefined && payload.acknowledgement_required === undefined ? defaults.acknowledgement : bool(explicit.acknowledgement_required ?? input.acknowledgement_required ?? payload.acknowledgement_required),
  };
}

/** Historic rows do not need a migration backfill: they are normalized on read. */
export const legacyNotificationRoutingMapper = (row: NotificationLike) => normalizeNotificationRouting(row, true);

export function routingColumns(routing: OisNotificationRouting) {
  return {
    source_type: routing.source_type,
    source_id: routing.source_id,
    destination: routing.destination,
    target: routing.target,
    actionability: routing.actionability,
    attention_eligible: routing.attention_eligible,
    queue_eligible: routing.queue_eligible,
    acknowledgement_required: routing.acknowledgement_required,
  };
}

export function withNotificationRouting<T extends Record<string, any>>(row: T): T & { routing: OisNotificationRouting } {
  const persisted = row.source_type || row.source_id || row.destination || row.target || row.actionability || row.attention_eligible !== undefined || row.queue_eligible !== undefined || row.acknowledgement_required !== undefined;
  const routing = normalizeNotificationRouting(persisted ? row : { ...row, routing: row.routing || null }, !persisted);
  return { ...row, routing };
}
