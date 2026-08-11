import type { OisContext, OyiTarget } from "../../types/oisContext";
import { logger } from "../../observability/logger";
import type {
  CanonicalConversationRequest,
  OperationalObject,
  OperationalObjectType,
} from "../runtime/canonicalConversationRuntime";
import type { IntelligenceRequestContract } from "../interpretation/conversationIntentRouting";
import type { ConversationObjectCandidate } from "./conversationObjectHydration";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanLabel(value: unknown, fallback: string) {
  return text(value) || fallback;
}

function objectTypeFromEntityType(value: unknown): OperationalObjectType | null {
  const raw = text(value).toLowerCase();
  const map: Record<string, OperationalObjectType> = {
    estate: "estate",
    building: "building",
    tower: "tower",
    block: "block",
    floor: "floor",
    wing: "wing",
    home: "home",
    room: "room",
    corridor: "corridor",
    zone: "zone",
    device: "device",
    visitor: "visitor",
    access_pass: "access_pass",
    visitor_access: "access_pass",
    maintenance: "maintenance_request",
    maintenance_request: "maintenance_request",
    wallet: "wallet",
    transaction: "transaction",
    service: "service_account",
    service_account: "service_account",
    infrastructure: "infrastructure_asset",
    infrastructure_asset: "infrastructure_asset",
    asset: "infrastructure_asset",
    access_point: "access_point",
    entrance: "access_point",
    gate: "access_point",
    emergency_asset: "emergency_asset",
    emergency: "emergency_asset",
    provider: "provider",
    camera: "camera",
    meter: "meter",
    scene: "scene",
    automation: "automation",
    message: "message_thread",
    message_thread: "message_thread",
    community: "community_post",
    community_post: "community_post",
    notification: "notification",
    operational_incident: "operational_incident",
    incident: "operational_event",
    workflow: "operational_event",
    report: "operational_event",
    awareness: "operational_event",
    queue: "operational_event",
    activity: "operational_event",
    security: "operational_event",
    twin_node: "twin_node",
    device_channel: "device_channel",
  };
  return map[raw] || null;
}

function objectTypeFromTarget(target: OyiTarget | null | undefined): OperationalObjectType | null {
  const raw = text(target?.target_type).toLowerCase();
  const map: Record<string, OperationalObjectType> = {
    maintenance: "maintenance_request",
    visitor: "visitor",
    access_pass: "access_pass",
    device: "device",
    device_channel: "device_channel",
    building: "building",
    floor: "floor",
    zone: "zone",
    room: "room",
    corridor: "corridor",
    access_point: "access_point",
    camera: "camera",
    infrastructure: "infrastructure_asset",
    wallet: "wallet",
    service: "service_account",
    transaction: "transaction",
    community: "community_post",
    message: "message_thread",
    notification: "notification",
    workflow: "operational_event",
    prediction: "operational_event",
    incident: "operational_event",
  };
  return map[raw] || null;
}

const CONVERSATION_CONTAINER_OBJECT_TYPES = new Set([
  "message",
  "message_thread",
  "conversation_thread",
  "thread",
  "chat_thread",
  "conversation",
]);

export function isConversationContainerObject(value: unknown): boolean {
  const record = recordOf(value);
  const rawType = text(record.object_type || record.type || record.target_type || record.entity_type).toLowerCase();
  if (CONVERSATION_CONTAINER_OBJECT_TYPES.has(rawType)) return true;
  const label = text(record.label || record.title || record.name).toLowerCase();
  return Boolean(label) && /^(message thread|conversation thread|chat thread)$/.test(label);
}

function logConversationContainerRemoved(input: CanonicalConversationRequest, source: string, value: unknown) {
  const record = recordOf(value);
  logger.info("conversation_container_removed_from_target_resolution", {
    thread_id: input.thread_id || text(record.thread_id || record.id) || null,
    submitted_object_type: text(record.object_type || record.type || record.target_type || record.entity_type) || null,
    submitted_object_id: text(record.canonical_id || record.target_id || record.id) || null,
    source,
  });
}

function stripContainerRecord<T>(input: CanonicalConversationRequest, value: T, source: string): T | null {
  if (!value || typeof value !== "object") return value;
  if (isConversationContainerObject(value)) {
    logConversationContainerRemoved(input, source, value);
    return null;
  }
  return value;
}

function sanitizeActiveContextForOperationalTargets(input: CanonicalConversationRequest, value: unknown, source: string) {
  const active = recordOf(value);
  if (!Object.keys(active).length) return null;
  const next = { ...active };
  next.selected_subobject = stripContainerRecord(input, next.selected_subobject, `${source}.selected_subobject`);
  next.primary_object = stripContainerRecord(input, next.primary_object, `${source}.primary_object`);
  return next;
}

export function sanitizeConversationInputTargets(input: CanonicalConversationRequest): CanonicalConversationRequest {
  const contextRecord = recordOf(input.context);
  const conversationContext = recordOf(input.conversation_context);
  const contextActive = sanitizeActiveContextForOperationalTargets(
    input,
    contextRecord.active_intelligence_context || recordOf(contextRecord.runtime_context).active_context,
    "context.active_intelligence_context",
  );
  const conversationActive = sanitizeActiveContextForOperationalTargets(
    input,
    conversationContext.active_context,
    "conversation_context.active_context",
  );
  const nextContext = {
    ...contextRecord,
    operational_object: stripContainerRecord(input, contextRecord.operational_object, "context.operational_object"),
    active_intelligence_context: contextActive,
    runtime_context: {
      ...recordOf(contextRecord.runtime_context),
      active_context: contextActive,
    },
  };
  const nextConversationContext = {
    ...conversationContext,
    active_context: conversationActive,
    selected_subobject: stripContainerRecord(input, conversationContext.selected_subobject, "conversation_context.selected_subobject"),
  };
  return {
    ...input,
    operational_object: stripContainerRecord(input, input.operational_object, "input.operational_object"),
    target: stripContainerRecord(input, input.target, "input.target") as OyiTarget | null,
    context: nextContext,
    conversation_context: nextConversationContext,
  };
}

type RouteCandidate = {
  object_type: OperationalObjectType;
  id: string;
  label?: string | null;
  room_id?: string | null;
  source_module?: string | null;
  metadata?: Record<string, unknown>;
};

function routeContextCandidates(contextRecord: Record<string, unknown>): RouteCandidate[] {
  return [
    { object_type: "device", id: text(contextRecord.device_id || contextRecord.deviceId), label: text(contextRecord.device_name || contextRecord.deviceName) || null, room_id: text(contextRecord.room_id || contextRecord.roomId) || null, source_module: text(contextRecord.module) || "devices", metadata: {} },
    { object_type: "room", id: text(contextRecord.room_id || contextRecord.roomId), label: text(contextRecord.room_name || contextRecord.roomName) || null, room_id: text(contextRecord.room_id || contextRecord.roomId) || null, source_module: text(contextRecord.module) || "rooms", metadata: {} },
    { object_type: "building", id: text(contextRecord.building_id || contextRecord.buildingId), label: text(contextRecord.building_name || contextRecord.buildingName) || null, source_module: text(contextRecord.module) || "estate", metadata: {} },
    { object_type: "floor", id: text(contextRecord.floor_id || contextRecord.floorId || contextRecord.floor), label: text(contextRecord.floor_name || contextRecord.floorName || contextRecord.floor) || null, source_module: text(contextRecord.module) || "estate", metadata: { building_id: text(contextRecord.building_id || contextRecord.buildingId) || null } },
    { object_type: "zone", id: text(contextRecord.zone_id || contextRecord.zoneId), label: text(contextRecord.zone_name || contextRecord.zoneName) || null, source_module: text(contextRecord.module) || "estate", metadata: {} },
    { object_type: "corridor", id: text(contextRecord.corridor_id || contextRecord.corridorId), label: text(contextRecord.corridor_name || contextRecord.corridorName) || null, source_module: text(contextRecord.module) || "spatial", metadata: { building_id: text(contextRecord.building_id || contextRecord.buildingId) || null, floor: text(contextRecord.floor || contextRecord.floor_name || contextRecord.floorName) || null } },
    { object_type: "access_point", id: text(contextRecord.access_point_id || contextRecord.accessPointId || contextRecord.gate_id || contextRecord.gateId || contextRecord.entrance_id), label: text(contextRecord.access_point_name || contextRecord.accessPointName || contextRecord.gate_name || contextRecord.entrance_name) || null, source_module: text(contextRecord.module) || "access", metadata: { building_id: text(contextRecord.building_id || contextRecord.buildingId) || null, room_id: text(contextRecord.room_id || contextRecord.roomId) || null } },
    { object_type: "infrastructure_asset", id: text(contextRecord.asset_id || contextRecord.assetId || contextRecord.infrastructure_asset_id || contextRecord.infrastructureAssetId), label: text(contextRecord.asset_name || contextRecord.assetName || contextRecord.infrastructure_asset_name) || null, source_module: text(contextRecord.module) || "infrastructure", metadata: { building_id: text(contextRecord.building_id || contextRecord.buildingId) || null, room_id: text(contextRecord.room_id || contextRecord.roomId) || null } },
    { object_type: "emergency_asset", id: text(contextRecord.emergency_asset_id || contextRecord.emergencyAssetId), label: text(contextRecord.emergency_asset_name || contextRecord.emergencyAssetName) || null, source_module: text(contextRecord.module) || "safety", metadata: { building_id: text(contextRecord.building_id || contextRecord.buildingId) || null, floor: text(contextRecord.floor || contextRecord.floor_name || contextRecord.floorName) || null } },
    { object_type: "visitor", id: text(contextRecord.visitor_id || contextRecord.visitorId), label: text(contextRecord.visitor_name || contextRecord.visitorName) || null, source_module: text(contextRecord.module) || "visitors", metadata: {} },
    { object_type: "maintenance_request", id: text(contextRecord.maintenance_id || contextRecord.request_id || contextRecord.ticket_id || contextRecord.ticketId), label: text(contextRecord.maintenance_title || contextRecord.ticket_title) || null, source_module: text(contextRecord.module) || "maintenance", metadata: {} },
    { object_type: "transaction", id: text(contextRecord.transaction_id || contextRecord.transactionId || contextRecord.wallet_reference), label: text(contextRecord.transaction_reference || contextRecord.wallet_reference) || null, source_module: text(contextRecord.module) || "wallet", metadata: {} },
    { object_type: "wallet", id: text(contextRecord.wallet_id || contextRecord.walletId), label: text(contextRecord.wallet_label || contextRecord.wallet_name) || null, source_module: text(contextRecord.module) || "wallet", metadata: {} },
    { object_type: "service_account", id: text(contextRecord.service_id || contextRecord.serviceId || contextRecord.service_account_id || contextRecord.serviceAccountId), label: text(contextRecord.service_label || contextRecord.service_name) || null, source_module: text(contextRecord.module) || "services", metadata: {} },
    { object_type: "notification", id: text(contextRecord.notification_id || contextRecord.notificationId), label: text(contextRecord.notification_title) || null, source_module: text(contextRecord.module) || "notifications", metadata: {} },
    { object_type: "message_thread", id: text(contextRecord.conversation_id || contextRecord.thread_id || contextRecord.threadId || contextRecord.message_thread_id), label: text(contextRecord.thread_title || contextRecord.conversation_title) || null, source_module: text(contextRecord.module) || "messages", metadata: {} },
    { object_type: "community_post", id: text(contextRecord.post_id || contextRecord.postId || contextRecord.community_post_id), label: text(contextRecord.post_title) || null, source_module: text(contextRecord.module) || "community", metadata: {} },
    { object_type: "camera", id: text(contextRecord.camera_id || contextRecord.cameraId), label: text(contextRecord.camera_name || contextRecord.cameraName) || null, source_module: text(contextRecord.module) || "cameras", metadata: {} },
    { object_type: "infrastructure_asset", id: text(contextRecord.infrastructure_id || contextRecord.infrastructureId || contextRecord.asset_id || contextRecord.assetId), label: text(contextRecord.infrastructure_name || contextRecord.asset_name || contextRecord.assetName) || null, source_module: text(contextRecord.module) || "infrastructure", metadata: {} },
    { object_type: "operational_incident", id: text(contextRecord.incident_id || contextRecord.incidentId), label: text(contextRecord.incident_title || contextRecord.incident_name) || null, source_module: text(contextRecord.module) || "incidents", metadata: {} },
    { object_type: "home", id: text(contextRecord.selected_home_id || contextRecord.home_id || contextRecord.homeId), label: text(contextRecord.home_name || contextRecord.homeName) || null, source_module: text(contextRecord.module) || "homes", metadata: {} },
    { object_type: "estate", id: text(contextRecord.selected_estate_id || contextRecord.estate_id || contextRecord.estateId), label: text(contextRecord.estate_name || contextRecord.estateName) || null, source_module: text(contextRecord.module) || "estate", metadata: {} },
  ];
}

export function explicitObjectCandidate(input: CanonicalConversationRequest): ConversationObjectCandidate | null {
  const contextRecord = recordOf(input.context);
  const activeContext = recordOf(contextRecord.active_intelligence_context || recordOf(contextRecord.runtime_context).active_context || recordOf(input.conversation_context).active_context);
  const activeSelected = recordOf(activeContext.selected_subobject);
  const activePrimary = recordOf(activeContext.primary_object);
  const explicit = recordOf(input.operational_object || contextRecord.operational_object || (Object.keys(activeSelected).length ? activeSelected : activePrimary));
  if (isConversationContainerObject(explicit)) return null;
  const explicitType = objectTypeFromEntityType(explicit.object_type || explicit.type);
  const explicitId = text(explicit.canonical_id || explicit.target_id || explicit.id);
  if (explicitType && explicitId) {
    const activeScope = recordOf(activeContext.scope);
    return {
      object_type: explicitType,
      canonical_id: explicitId,
      label: text(explicit.label || explicit.title) || null,
      estate_id: text(explicit.estate_id || activeScope.estate_id) || input.estate_id || null,
      home_id: text(explicit.home_id || activeScope.home_id) || input.home_id || null,
      room_id: text(explicit.room_id || activeScope.room_id) || input.room_id || null,
      source_module: text(explicit.source_module) || input.module || null,
      metadata: explicit,
      source: "explicit_request",
    };
  }
  if (input.device_id) {
    return {
      object_type: "device",
      canonical_id: text(input.device_id),
      label: input.device_name || null,
      estate_id: input.estate_id || null,
      home_id: input.home_id || null,
      room_id: input.room_id || null,
      source_module: input.module || "devices",
      metadata: {},
      source: "explicit_request",
    };
  }
  const routeCandidate = routeContextCandidates(contextRecord).find((candidate) => candidate.id);
  if (routeCandidate) {
    return {
      object_type: routeCandidate.object_type,
      canonical_id: routeCandidate.id,
      label: routeCandidate.label || null,
      estate_id: text(contextRecord.estate_id || contextRecord.estateId) || input.estate_id || null,
      home_id: text(contextRecord.home_id || contextRecord.homeId) || input.home_id || null,
      room_id: routeCandidate.room_id || null,
      source_module: routeCandidate.source_module || input.module || null,
      metadata: routeCandidate.metadata || {},
      source: "page_selection",
    };
  }
  const channel = recordOf(explicit.channel || explicit.device_channel);
  const channelIndex = text(channel.index || channel.channel_index || explicit.channel_index);
  const channelCode = text(channel.code || channel.channel_code || explicit.channel_code);
  const channelDeviceId = text(channel.device_id || explicit.device_id || input.device_id);
  if (channelDeviceId && (channelIndex || channelCode)) {
    const channelId = channelCode ? `${channelDeviceId}:${channelCode}` : `${channelDeviceId}:channel:${channelIndex}`;
    return {
      object_type: "device_channel",
      canonical_id: channelId,
      label: text(channel.label || explicit.label || explicit.title) || null,
      estate_id: input.estate_id || null,
      home_id: input.home_id || null,
      room_id: input.room_id || null,
      source_module: input.module || "devices",
      metadata: {
        ...explicit,
        device_id: channelDeviceId,
        channel_index: channelIndex || null,
        channel_code: channelCode || null,
      },
      source: "explicit_request",
    };
  }
  const targetType = objectTypeFromTarget(input.target || (recordOf(input.context).target as OyiTarget | undefined));
  const targetId = text(input.target?.target_id || recordOf(input.context).target_id);
  if (targetType && targetId) {
    return {
      object_type: targetType,
      canonical_id: targetId,
      estate_id: input.estate_id || null,
      home_id: input.home_id || null,
      room_id: input.room_id || null,
      source_module: input.module || null,
      metadata: {},
      source: "page_selection",
    };
  }
  return null;
}

export function threadObjectCandidate(context: { state?: Record<string, any>; estate_id?: unknown; home_id?: unknown }): ConversationObjectCandidate | null {
  const state = recordOf(context.state);
  const activeEntity = recordOf(state.active_entity);
  const objectType = objectTypeFromEntityType(state.active_entity_type || activeEntity.type);
  const canonicalId = text(state.active_entity_id || activeEntity.id);
  if (!objectType || !canonicalId) return null;
  const details = recordOf(activeEntity.details);
  return {
    object_type: objectType,
    canonical_id: canonicalId,
    label: text(state.active_entity_label || activeEntity.title) || null,
    estate_id: text(context.estate_id) || null,
    home_id: text(context.home_id) || null,
    room_id: text(details.room_id) || null,
    source_module: objectType === "device" ? "devices" : null,
    metadata: details,
    source: "thread_state",
  };
}

export function currentScopeForConversation(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  };
}

export function constructBroadScopeObject(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined, contract: IntelligenceRequestContract): OperationalObject | null {
  const scope = currentScopeForConversation(input, oisContext);
  const contextRecord = recordOf(input.context);
  if (contract.scope_mode === "room_scope" && scope.room_id) {
    return {
      object_type: "room",
      canonical_id: scope.room_id,
      label: text(input.room_name || contextRecord.room_name || contextRecord.roomName) || "Room",
      estate_id: scope.estate_id,
      building_id: text(contextRecord.building_id || contextRecord.buildingId) || null,
      home_id: scope.home_id,
      room_id: scope.room_id,
      parent_id: scope.home_id,
      source_module: "rooms",
      capabilities: ["conversation", "room_summary", "device_inventory"],
      current_state: null,
      health: null,
      permissions: ["read"],
      relationships: {},
      evidence_references: [],
      metadata: { source: "current_turn_room_reference", requested_scope: contract.scope_mode },
      freshness: null,
    };
  }
  if ((contract.scope_mode === "explicit_broad_scope" || contract.scope_mode === "home_scope") && scope.home_id) {
    return {
      object_type: "home",
      canonical_id: scope.home_id,
      label: text(contextRecord.home_name || contextRecord.homeName) || "Home",
      estate_id: scope.estate_id,
      building_id: text(contextRecord.building_id || contextRecord.buildingId) || null,
      home_id: scope.home_id,
      room_id: null,
      parent_id: null,
      source_module: "home",
      capabilities: ["conversation", "home_summary", "device_inventory"],
      current_state: null,
      health: null,
      permissions: ["read"],
      relationships: {},
      evidence_references: [],
      metadata: { source: "current_turn_explicit_scope", requested_scope: contract.scope_mode },
      freshness: null,
    };
  }
  if ((contract.scope_mode === "building_scope" || contract.scope_mode === "explicit_broad_scope") && scope.estate_id && !scope.home_id) {
    return {
      object_type: "estate",
      canonical_id: scope.estate_id,
      label: text(contextRecord.estate_name || contextRecord.estateName) || "Estate",
      estate_id: scope.estate_id,
      building_id: text(contextRecord.building_id || contextRecord.buildingId) || null,
      home_id: null,
      room_id: null,
      parent_id: null,
      source_module: "estate",
      capabilities: ["conversation", "building_summary", "operational_health"],
      current_state: null,
      health: null,
      permissions: ["read"],
      relationships: {},
      evidence_references: [],
      metadata: { source: "current_turn_explicit_scope", requested_scope: contract.scope_mode },
      freshness: null,
    };
  }
  return null;
}
