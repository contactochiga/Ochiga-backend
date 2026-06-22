import type { OyiTarget, OyiTargetType } from "../../types/oisContext";

const TARGET_TYPES = new Set<OyiTargetType>(["workflow", "prediction", "incident", "maintenance", "visitor", "device", "camera", "infrastructure", "wallet", "service", "community", "message", "handover", "none"]);
const OPEN_AS = new Set(["drawer", "page", "queue", "attention", "none"]);
const INFRASTRUCTURE_SOURCES = new Set(["devices", "cameras", "edge", "utilities", "providers"]);
const ACTIONS = new Set(["inspect", "approve", "assign", "acknowledge", "verify", "resolve", "escalate", "control", "pay", "message"]);

const clean = (value: unknown) => String(value || "").trim() || null;

function targetTypeFor(value: unknown): OyiTargetType | null {
  const type = String(value || "").trim().toLowerCase();
  const map: Record<string, OyiTargetType> = {
    workflows: "workflow", workflow: "workflow", predictions: "prediction", prediction: "prediction",
    incidents: "incident", incident: "incident", security: "incident",
    maintenance: "maintenance", visitors: "visitor", visitor: "visitor",
    devices: "device", device: "device", cameras: "camera", camera: "camera",
    infrastructure: "infrastructure", edge: "infrastructure", utilities: "infrastructure", providers: "infrastructure",
    wallet: "wallet", service: "service", services: "service", community: "community",
    message: "message", messages: "message", handover: "handover",
  };
  return map[type] || (TARGET_TYPES.has(type as OyiTargetType) ? type as OyiTargetType : null);
}

function targetTypeFromIdentifiers(row: any): OyiTargetType | null {
  const identifiers: Array<[string, OyiTargetType]> = [
    ["workflow_id", "workflow"], ["prediction_id", "prediction"], ["incident_id", "incident"],
    ["maintenance_id", "maintenance"], ["request_id", "maintenance"], ["visitor_id", "visitor"],
    ["device_id", "device"], ["camera_id", "camera"], ["transaction_id", "wallet"],
    ["wallet_id", "wallet"], ["service_id", "service"], ["post_id", "community"],
    ["thread_id", "message"], ["handover_id", "handover"],
  ];
  return identifiers.find(([key]) => clean(row?.[key]))?.[1] || null;
}

function idFor(row: any, type: OyiTargetType): string | null {
  const keys: Record<OyiTargetType, string[]> = {
    workflow: ["workflow_id", "id"], prediction: ["prediction_id", "id"], incident: ["incident_id", "id"],
    maintenance: ["maintenance_id", "request_id", "id"], visitor: ["visitor_id", "id"], device: ["device_id", "id"],
    camera: ["camera_id", "id"], infrastructure: ["infrastructure_id", "id"], wallet: ["transaction_id", "wallet_id", "id"],
    service: ["service_id", "request_id", "id"], community: ["post_id", "community_id", "id"], message: ["thread_id", "message_id", "id"],
    handover: ["handover_id", "id"], none: [],
  };
  for (const key of keys[type]) {
    const value = clean(row?.[key]);
    if (value) return value;
  }
  return null;
}

function infrastructureSource(row: any, type: OyiTargetType) {
  const value = String(row?.infrastructure_source || row?.source_type || row?.source || row?.domain || row?.type || "").toLowerCase();
  if (type !== "infrastructure" && type !== "camera") return undefined;
  if (type === "camera" || /camera|cctv/.test(value)) return "cameras" as const;
  if (/provider/.test(value)) return "providers" as const;
  if (/utility/.test(value)) return "utilities" as const;
  if (/edge/.test(value)) return "edge" as const;
  return "devices" as const;
}

function targetFromRoute(route: unknown): OyiTarget | null {
  const value = String(route || "");
  if (!value) return null;
  const path = value.split("?")[0];
  const map: Record<string, OyiTargetType> = {
    "/maintenance": "maintenance", "/visitors": "visitor", "/devices": "device", "/wallet": "wallet",
    "/services": "service", "/community": "community", "/messages": "message", "/alerts": "incident",
  };
  const type = map[path];
  return type ? { target_type: type, target_id: null, open_as: "page", action: "inspect" } : null;
}

export function normalizeOyiTarget(input: any): OyiTarget {
  const explicit = input?.target || input?.oyi_target || null;
  const rawType = explicit?.target_type || explicit?.type || input?.target_type || input?.entity_type || input?.type || input?.domain;
  const target_type = targetTypeFor(rawType) || targetTypeFromIdentifiers(input);
  if (!target_type) return targetFromRoute(input?.route || input?.href) || { target_type: "none", open_as: "none" };
  if (target_type === "none") return { target_type: "none", open_as: "none" };
  const target_id = clean(explicit?.target_id || explicit?.id) || idFor(input, target_type);
  const source = infrastructureSource(explicit || input, target_type);
  const open_as = OPEN_AS.has(String(explicit?.open_as || input?.open_as || ""))
    ? String(explicit?.open_as || input?.open_as) as OyiTarget["open_as"]
    : target_type === "workflow" || target_type === "prediction" || target_type === "incident" || target_type === "infrastructure" ? "drawer" : "page";
  const action = ACTIONS.has(String(explicit?.action || input?.action || ""))
    ? String(explicit?.action || input?.action) as NonNullable<OyiTarget["action"]>
    : "inspect";
  if (target_type === "infrastructure") return { target_type, target_id, infrastructure_source: INFRASTRUCTURE_SOURCES.has(String(source)) ? source : "devices", open_as, action };
  return { target_type, target_id, open_as, action };
}

/** Adds machine-readable targets without changing the human-facing Oyi response. */
export function decorateOyiTargets(response: any, activeEntity?: any) {
  const decorateCard = (card: any) => {
    const items = Array.isArray(card?.items) ? card.items.map((item: any) => ({ ...item, target: normalizeOyiTarget({ ...item, type: item?.type || card?.type, domain: item?.domain || card?.domain }) })) : [];
    return { ...card, target: normalizeOyiTarget(card), items };
  };
  const cards = Array.isArray(response?.cards) ? response.cards.map(decorateCard) : [];
  const suggested_actions = Array.isArray(response?.suggested_actions)
    ? response.suggested_actions.map((action: any) => ({ ...action, target: normalizeOyiTarget(action) }))
    : [];
  const executionTarget = activeEntity ? normalizeOyiTarget({ ...activeEntity, entity_type: activeEntity.type }) : normalizeOyiTarget(response?.execution || {});
  return {
    ...response,
    cards,
    suggested_actions,
    target: executionTarget,
    execution: response?.execution ? { ...response.execution, target: executionTarget } : response?.execution,
  };
}
