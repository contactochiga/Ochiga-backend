import { randomUUID } from "crypto";
import type { AuthUser } from "../../middleware/auth";
import type { OisContext, OyiTarget } from "../../types/oisContext";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import {
  loadOyiConversationContext,
  runOyiUnifiedChat,
  type OyiChatInput,
  type OyiSurface,
} from "../../services/oyiUnifiedIntelligenceService";
import { buildModuleFacts } from "./moduleFactAdapters";
import { resolveConversationTarget } from "./conversationTargetResolver";
import { hydrateCanonicalTarget } from "./canonicalTargetHydrationRegistry";
import { deviceRuntimeStateService } from "../../services/deviceRuntimeStateService";
import { normalizeUserTurn, type NormalizedUserTurn, type OyiDomain } from "./languageUnderstanding";
import { capabilityKeyForTurn, decideAuthorityForTurn, getDomainCapability, type AuthorityDecision } from "./domainCapabilityRegistry";
import { createWorkflow, type CanonicalTarget, type OyiWorkflow } from "./conversationWorkflowRuntime";
import { freshnessLabelFromEvidence, safeDateLabel } from "../presentation/timeFreshness";

export type OperationalObjectType =
  | "estate"
  | "building"
  | "tower"
  | "block"
  | "floor"
  | "wing"
  | "home"
  | "room"
  | "corridor"
  | "zone"
  | "device"
  | "device_channel"
  | "visitor"
  | "access_pass"
  | "maintenance_request"
  | "wallet"
  | "transaction"
  | "service_account"
  | "infrastructure_asset"
  | "access_point"
  | "emergency_asset"
  | "provider"
  | "camera"
  | "meter"
  | "scene"
  | "automation"
  | "message_thread"
  | "community_post"
  | "notification"
  | "operational_incident"
  | "operational_event"
  | "twin_node";

export type TruthState =
  | "confirmed"
  | "observed"
  | "inferred"
  | "predicted"
  | "pending_confirmation"
  | "unavailable"
  | "unsupported"
  | "permission_restricted";

export type OperationalObject = {
  object_type: OperationalObjectType;
  canonical_id: string;
  label: string;
  estate_id: string | null;
  building_id: string | null;
  home_id: string | null;
  room_id: string | null;
  parent_id: string | null;
  source_module: string | null;
  capabilities: string[];
  current_state: string | null;
  health: string | null;
  permissions: string[];
  relationships: Record<string, unknown>;
  evidence_references: string[];
  metadata: Record<string, unknown>;
  freshness: string | null;
};

export type CanonicalTruth = {
  title: string;
  body: string;
  truth_state: TruthState;
  severity: "normal" | "info" | "attention" | "warning" | "critical";
  source_event: string | null;
  confidence: number | null;
  object: OperationalObject | null;
  occurred_at: string | null;
  freshness: string | null;
  recommended_actions: Array<Record<string, unknown>>;
  active_execution: Record<string, unknown> | null;
  target: OyiTarget | null;
  technical_details: Record<string, unknown> | null;
};

export type CanonicalConversationRequest = {
  message: string;
  surface: OyiSurface;
  estate_id?: string | null;
  home_id?: string | null;
  module?: string | null;
  role?: string | null;
  thread_id?: string | null;
  context?: OisContext | Record<string, unknown> | null;
  operational_object?: Partial<OperationalObject> | null;
  target?: OyiTarget | null;
  device_id?: string | null;
  device_name?: string | null;
  room_id?: string | null;
  room_name?: string | null;
  control_profile?: string | null;
  primary_state?: string | null;
  health_status?: string | null;
  supported_controls?: string[] | null;
  channel_definitions?: Array<Record<string, unknown>> | null;
  memory_summary?: Record<string, unknown> | null;
  relationships?: Record<string, unknown> | null;
  predictive_findings?: Array<Record<string, unknown>> | null;
  recent_executions?: Array<Record<string, unknown>> | null;
  active_scenes?: Array<Record<string, unknown>> | null;
  active_automations?: Array<Record<string, unknown>> | null;
  active_intelligence_context?: Record<string, unknown> | null;
  conversation_context?: Record<string, unknown> | null;
  intent_hint?: string | null;
  operation_class_hint?: string | null;
  scope_mode_hint?: string | null;
};

export type CanonicalConversationResponse = {
  id: string;
  thread_id: string | null;
  intent: string;
  understood: string | null;
  summary: string;
  answer: string;
  reply: string;
  message: string;
  display_mode: "conversation" | "awareness" | "list" | "detail" | "audit" | "report";
  truth: CanonicalTruth;
  operational_object: OperationalObject | null;
  context: {
    surface: OyiSurface;
    estate_id: string | null;
    home_id: string | null;
    module: string | null;
    context_source: "explicit_request" | "thread_state" | "page_selection" | "home_scope" | "estate_scope" | "global_scope";
    warnings: string[];
    target_resolution?: Record<string, unknown>;
    module_facts?: Record<string, unknown>;
    request_contract?: IntelligenceRequestContract;
  };
  resolved_turn?: ResolvedConversationTurn;
  execution: Record<string, unknown>;
  cards: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  suggested_actions: Array<Record<string, unknown>>;
  awareness?: Record<string, unknown>;
  presentation_policy?: ConversationPresentationPolicy;
  confirmations: Array<Record<string, unknown>>;
  warnings: string[];
  persistence_saved?: boolean;
  source: "oyi_canonical_runtime";
  safe_mode: true;
  approvalRequired: boolean;
  requiresConfirmation: boolean;
};

type ObjectCandidate = {
  object_type: OperationalObjectType;
  canonical_id: string;
  label?: string | null;
  estate_id?: string | null;
  home_id?: string | null;
  room_id?: string | null;
  source_module?: string | null;
  metadata?: Record<string, unknown>;
  source:
    | "explicit_request"
    | "thread_state"
    | "page_selection"
    | "home_scope"
    | "estate_scope"
    | "global_scope";
};

type ResolvedOperationalObject = {
  object: OperationalObject | null;
  source: ObjectCandidate["source"];
  warnings: string[];
};

type ConversationBuilderKey =
  | "device_status"
  | "device_activity"
  | "device_failures"
  | "device_diagnosis"
  | "device_relationships"
  | "device_control"
  | "home_summary"
  | "offline_inventory"
  | "recent_changes"
  | "wallet_history"
  | "wallet_summary"
  | "utility_spending"
  | "domain_list"
  | "module_navigation"
  | "object_navigation"
  | "clarification"
  | "general_help";

type DeviceResolutionResult =
  | { status: "resolved"; device_id: string; channel_code: string | null; label: string; room_id: string | null; confidence: number }
  | { status: "ambiguous"; phrase: string; candidates: Array<{ device_id: string; label: string; room_label: string | null; device_family: string; channel_code: string | null }> }
  | { status: "not_found"; phrase: string };

type RoomResolutionResult =
  | { status: "resolved"; room_id: string; label: string; confidence: number }
  | { status: "ambiguous"; phrase: string; candidates: Array<{ room_id: string; label: string }> }
  | { status: "not_found"; phrase: string };

type CurrentTurnAuthorityDecision = {
  operation: string;
  domain: string | null;
  scope: ScopeMode;
  explicitRoomPhrase: string | null;
  explicitObjectPhrase: string | null;
  temporalScope: string | null;
  mayUseInheritedExactTarget: boolean;
  rejectionReason: string | null;
};

type PendingClarification = {
  clarification_id: string;
  thread_id: string;
  original_user_message: string;
  operation: string;
  domain: string;
  requested_action: string | null;
  requested_state: string | null;
  requested_phrase: string | null;
  candidate_ids: string[];
  candidates: Array<Record<string, unknown>>;
  selected_candidate_id: string | null;
  unresolved_fields: string[];
  created_at: string;
  expires_at: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function cleanLabel(value: unknown, fallback: string) {
  const next = text(value);
  return next || fallback;
}

function normalizeLookupText(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function severityFor(value: unknown): CanonicalTruth["severity"] {
  const raw = text(value).toLowerCase();
  if (raw === "critical") return "critical";
  if (raw === "warning") return "warning";
  if (raw === "attention") return "attention";
  if (raw === "info") return "info";
  return "normal";
}

function truthStateFromCompatibility(response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const status = text(execution.status).toLowerCase();
  if (status === "pending_confirmation") return "pending_confirmation" as const;
  if (status === "permission_denied" || status === "denied") return "permission_restricted" as const;
  if (status === "unsupported" || status === "validation_required") return "unsupported" as const;
  if (status === "failed") return "observed" as const;
  if (status === "executed" || status === "processed") return "confirmed" as const;
  if (response.awareness && severityFor(recordOf(response.awareness).severity) !== "normal") return "observed" as const;
  if (Array.isArray(response.sources) && response.sources.length) return "observed" as const;
  return "inferred" as const;
}

export function canonicalTruthStateForTest(input: { status?: string | null; hasSources?: boolean; hasAwareness?: boolean; severity?: string | null }) {
  return truthStateFromCompatibility({
    execution: { status: input.status || null },
    sources: input.hasSources ? [{ id: "source:1" }] : [],
    awareness: input.hasAwareness ? { severity: input.severity || "info" } : null,
  });
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
  const selected = stripContainerRecord(input, next.selected_subobject, `${source}.selected_subobject`);
  const primary = stripContainerRecord(input, next.primary_object, `${source}.primary_object`);
  next.selected_subobject = selected;
  next.primary_object = primary;
  return next;
}

function sanitizeConversationInputTargets(input: CanonicalConversationRequest): CanonicalConversationRequest {
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

function explicitObjectCandidate(input: CanonicalConversationRequest): ObjectCandidate | null {
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
  const routeContextCandidates: Array<{
    object_type: OperationalObjectType;
    id: string;
    label?: string | null;
    room_id?: string | null;
    source_module?: string | null;
    metadata?: Record<string, unknown>;
  }> = [
    {
      object_type: "device",
      id: text(contextRecord.device_id || contextRecord.deviceId),
      label: text(contextRecord.device_name || contextRecord.deviceName) || null,
      room_id: text(contextRecord.room_id || contextRecord.roomId) || null,
      source_module: text(contextRecord.module) || "devices",
      metadata: {},
    },
    {
      object_type: "room",
      id: text(contextRecord.room_id || contextRecord.roomId),
      label: text(contextRecord.room_name || contextRecord.roomName) || null,
      room_id: text(contextRecord.room_id || contextRecord.roomId) || null,
      source_module: text(contextRecord.module) || "rooms",
      metadata: {},
    },
    {
      object_type: "building",
      id: text(contextRecord.building_id || contextRecord.buildingId),
      label: text(contextRecord.building_name || contextRecord.buildingName) || null,
      source_module: text(contextRecord.module) || "estate",
      metadata: {},
    },
    {
      object_type: "floor",
      id: text(contextRecord.floor_id || contextRecord.floorId || contextRecord.floor),
      label: text(contextRecord.floor_name || contextRecord.floorName || contextRecord.floor) || null,
      source_module: text(contextRecord.module) || "estate",
      metadata: {
        building_id: text(contextRecord.building_id || contextRecord.buildingId) || null,
      },
    },
    {
      object_type: "zone",
      id: text(contextRecord.zone_id || contextRecord.zoneId),
      label: text(contextRecord.zone_name || contextRecord.zoneName) || null,
      source_module: text(contextRecord.module) || "estate",
      metadata: {},
    },
    {
      object_type: "corridor",
      id: text(contextRecord.corridor_id || contextRecord.corridorId),
      label: text(contextRecord.corridor_name || contextRecord.corridorName) || null,
      source_module: text(contextRecord.module) || "spatial",
      metadata: {
        building_id: text(contextRecord.building_id || contextRecord.buildingId) || null,
        floor: text(contextRecord.floor || contextRecord.floor_name || contextRecord.floorName) || null,
      },
    },
    {
      object_type: "access_point",
      id: text(contextRecord.access_point_id || contextRecord.accessPointId || contextRecord.gate_id || contextRecord.gateId || contextRecord.entrance_id),
      label: text(contextRecord.access_point_name || contextRecord.accessPointName || contextRecord.gate_name || contextRecord.entrance_name) || null,
      source_module: text(contextRecord.module) || "access",
      metadata: {
        building_id: text(contextRecord.building_id || contextRecord.buildingId) || null,
        room_id: text(contextRecord.room_id || contextRecord.roomId) || null,
      },
    },
    {
      object_type: "infrastructure_asset",
      id: text(contextRecord.asset_id || contextRecord.assetId || contextRecord.infrastructure_asset_id || contextRecord.infrastructureAssetId),
      label: text(contextRecord.asset_name || contextRecord.assetName || contextRecord.infrastructure_asset_name) || null,
      source_module: text(contextRecord.module) || "infrastructure",
      metadata: {
        building_id: text(contextRecord.building_id || contextRecord.buildingId) || null,
        room_id: text(contextRecord.room_id || contextRecord.roomId) || null,
      },
    },
    {
      object_type: "emergency_asset",
      id: text(contextRecord.emergency_asset_id || contextRecord.emergencyAssetId),
      label: text(contextRecord.emergency_asset_name || contextRecord.emergencyAssetName) || null,
      source_module: text(contextRecord.module) || "safety",
      metadata: {
        building_id: text(contextRecord.building_id || contextRecord.buildingId) || null,
        floor: text(contextRecord.floor || contextRecord.floor_name || contextRecord.floorName) || null,
      },
    },
    {
      object_type: "visitor",
      id: text(contextRecord.visitor_id || contextRecord.visitorId),
      label: text(contextRecord.visitor_name || contextRecord.visitorName) || null,
      source_module: text(contextRecord.module) || "visitors",
      metadata: {},
    },
    {
      object_type: "maintenance_request",
      id: text(contextRecord.maintenance_id || contextRecord.request_id || contextRecord.ticket_id || contextRecord.ticketId),
      label: text(contextRecord.maintenance_title || contextRecord.ticket_title) || null,
      source_module: text(contextRecord.module) || "maintenance",
      metadata: {},
    },
    {
      object_type: "transaction",
      id: text(contextRecord.transaction_id || contextRecord.transactionId || contextRecord.wallet_reference),
      label: text(contextRecord.transaction_reference || contextRecord.wallet_reference) || null,
      source_module: text(contextRecord.module) || "wallet",
      metadata: {},
    },
    {
      object_type: "wallet",
      id: text(contextRecord.wallet_id || contextRecord.walletId),
      label: text(contextRecord.wallet_label || contextRecord.wallet_name) || null,
      source_module: text(contextRecord.module) || "wallet",
      metadata: {},
    },
    {
      object_type: "service_account",
      id: text(contextRecord.service_id || contextRecord.serviceId || contextRecord.service_account_id || contextRecord.serviceAccountId),
      label: text(contextRecord.service_label || contextRecord.service_name) || null,
      source_module: text(contextRecord.module) || "services",
      metadata: {},
    },
    {
      object_type: "notification",
      id: text(contextRecord.notification_id || contextRecord.notificationId),
      label: text(contextRecord.notification_title) || null,
      source_module: text(contextRecord.module) || "notifications",
      metadata: {},
    },
    {
      object_type: "message_thread",
      id: text(contextRecord.conversation_id || contextRecord.thread_id || contextRecord.threadId || contextRecord.message_thread_id),
      label: text(contextRecord.thread_title || contextRecord.conversation_title) || null,
      source_module: text(contextRecord.module) || "messages",
      metadata: {},
    },
    {
      object_type: "community_post",
      id: text(contextRecord.post_id || contextRecord.postId || contextRecord.community_post_id),
      label: text(contextRecord.post_title) || null,
      source_module: text(contextRecord.module) || "community",
      metadata: {},
    },
    {
      object_type: "camera",
      id: text(contextRecord.camera_id || contextRecord.cameraId),
      label: text(contextRecord.camera_name || contextRecord.cameraName) || null,
      source_module: text(contextRecord.module) || "cameras",
      metadata: {},
    },
    {
      object_type: "infrastructure_asset",
      id: text(contextRecord.infrastructure_id || contextRecord.infrastructureId || contextRecord.asset_id || contextRecord.assetId),
      label: text(contextRecord.infrastructure_name || contextRecord.asset_name || contextRecord.assetName) || null,
      source_module: text(contextRecord.module) || "infrastructure",
      metadata: {},
    },
    {
      object_type: "operational_incident",
      id: text(contextRecord.incident_id || contextRecord.incidentId),
      label: text(contextRecord.incident_title || contextRecord.incident_name) || null,
      source_module: text(contextRecord.module) || "incidents",
      metadata: {},
    },
    {
      object_type: "home",
      id: text(contextRecord.selected_home_id || contextRecord.home_id || contextRecord.homeId),
      label: text(contextRecord.home_name || contextRecord.homeName) || null,
      source_module: text(contextRecord.module) || "homes",
      metadata: {},
    },
    {
      object_type: "estate",
      id: text(contextRecord.selected_estate_id || contextRecord.estate_id || contextRecord.estateId),
      label: text(contextRecord.estate_name || contextRecord.estateName) || null,
      source_module: text(contextRecord.module) || "estate",
      metadata: {},
    },
  ];
  const routeCandidate = routeContextCandidates.find((candidate) => candidate.id);
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

function threadObjectCandidate(context: Awaited<ReturnType<typeof loadOyiConversationContext>>): ObjectCandidate | null {
  const state = context.state;
  const objectType = objectTypeFromEntityType(state.active_entity_type || state.active_entity?.type);
  const canonicalId = text(state.active_entity_id || state.active_entity?.id);
  if (!objectType || !canonicalId) return null;
  const details = recordOf(state.active_entity?.details);
  return {
    object_type: objectType,
    canonical_id: canonicalId,
    label: text(state.active_entity_label || state.active_entity?.title) || null,
    estate_id: text(context.estate_id) || null,
    home_id: text(context.home_id) || null,
    room_id: text(details.room_id) || null,
    source_module: objectType === "device" ? "devices" : null,
    metadata: details,
    source: "thread_state",
  };
}

async function resolveCandidate(actor: AuthUser | null, oisContext: OisContext | null | undefined, candidate: ObjectCandidate | null): Promise<ResolvedOperationalObject> {
  if (!candidate) {
    if (oisContext?.home_id) {
      return {
        object: {
          object_type: "home",
          canonical_id: oisContext.home_id,
          label: cleanLabel(oisContext.home?.name, "Home"),
          estate_id: oisContext.estate_id || null,
          building_id: null,
          home_id: oisContext.home_id,
          room_id: null,
          parent_id: oisContext.estate_id || null,
          source_module: oisContext.module || null,
          capabilities: ["conversation"],
          current_state: null,
          health: null,
          permissions: Array.isArray(oisContext.permissions) ? oisContext.permissions : [],
          relationships: {},
          evidence_references: [],
          metadata: {},
          freshness: oisContext.resolved_at || null,
        },
        source: "home_scope",
        warnings: [],
      } as any;
    }
    if (oisContext?.estate_id) {
      return {
        object: {
          object_type: "estate",
          canonical_id: oisContext.estate_id,
          label: cleanLabel(oisContext.estate?.name, "Estate"),
          estate_id: oisContext.estate_id,
          building_id: null,
          home_id: null,
          room_id: null,
          parent_id: null,
          source_module: oisContext.module || null,
          capabilities: ["conversation"],
          current_state: null,
          health: null,
          permissions: Array.isArray(oisContext.permissions) ? oisContext.permissions : [],
          relationships: {},
          evidence_references: [],
          metadata: {},
          freshness: oisContext.resolved_at || null,
        },
        source: "estate_scope",
        warnings: [],
      } as any;
    }
    return { object: null, source: "global_scope", warnings: [] };
  }

  const warnings: string[] = [];
  const actorPermissions = Array.isArray(actor?.permissions) ? actor.permissions : [];
  const basePermissions = Array.isArray(oisContext?.permissions) ? oisContext.permissions : actorPermissions;
  const estateScoped = oisContext?.estate_id || candidate.estate_id || null;
  const homeScoped = oisContext?.home_id || candidate.home_id || null;
  const metadata = recordOf(candidate.metadata);

  async function maybeSingle(table: string, select: string, id: string) {
    return supabaseAdmin.from(table).select(select).eq("id", id).maybeSingle();
  }

  async function maybeSingleWhere(table: string, select: string, column: string, value: string) {
    return supabaseAdmin.from(table).select(select).eq(column, value).maybeSingle();
  }

  let object: OperationalObject | null = null;
  switch (candidate.object_type) {
    case "estate": {
      const { data } = await maybeSingle("estates", "id,name,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      object = {
        object_type: "estate",
        canonical_id: String(row.id),
        label: cleanLabel(row.name, "Estate"),
        estate_id: String(row.id),
        building_id: null,
        home_id: null,
        room_id: null,
        parent_id: null,
        source_module: candidate.source_module || null,
        capabilities: ["conversation"],
        current_state: null,
        health: null,
        permissions: basePermissions,
        relationships: {},
        evidence_references: [],
        metadata: {},
          freshness: row.updated_at || null,
      };
      break;
    }
    case "home": {
      const { data } = await maybeSingle("homes", "id,name,estate_id,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (estateScoped && String(row.estate_id || "") !== String(estateScoped)) {
        warnings.push("The selected home is outside the active estate scope.");
        break;
      }
      object = {
        object_type: "home",
        canonical_id: String(row.id),
        label: cleanLabel(row.name, "Home"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: String(row.id),
        room_id: null,
        parent_id: String(row.estate_id || estateScoped || "") || null,
        source_module: candidate.source_module || null,
        capabilities: ["conversation"],
        current_state: null,
        health: null,
        permissions: basePermissions,
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "building": {
      const { data } = await maybeSingle("estate_buildings", "id,name,estate_id,building_ref,block,floors,unit_count,building_type,status,metadata,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (estateScoped && String(row.estate_id || "") !== String(estateScoped)) {
        warnings.push("The selected building is outside the active estate scope.");
        break;
      }
      object = {
        object_type: "building",
        canonical_id: String(row.id),
        label: cleanLabel(row.name || candidate.label, "Building"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: String(row.id),
        home_id: null,
        room_id: null,
        parent_id: String(row.estate_id || estateScoped || "") || null,
        source_module: candidate.source_module || "estate",
        capabilities: ["conversation", "spatial_reasoning", "operational_health", "registry"],
        current_state: text(row.status) || null,
        health: text(recordOf(row.metadata).health_status || row.status) || null,
        permissions: basePermissions,
        relationships: {
          estate_id: row.estate_id || null,
          building_ref: row.building_ref || null,
          block: row.block || null,
          floors: row.floors || null,
          unit_count: row.unit_count || null,
          building_type: row.building_type || null,
          child_objects: [
            row.floors ? `${row.floors} floors` : null,
            row.unit_count ? `${row.unit_count} units` : null,
          ].filter(Boolean),
        },
        evidence_references: [],
        metadata: recordOf(row.metadata),
        freshness: row.updated_at || null,
      };
      break;
    }
    case "floor": {
      const floorMetadata = recordOf(candidate.metadata);
      object = {
        object_type: "floor",
        canonical_id: candidate.canonical_id,
        label: cleanLabel(candidate.label || floorMetadata.floor_name || floorMetadata.floor, "Floor"),
        estate_id: candidate.estate_id || estateScoped,
        building_id: text(floorMetadata.building_id) || null,
        home_id: null,
        room_id: null,
        parent_id: text(floorMetadata.building_id) || candidate.estate_id || estateScoped,
        source_module: candidate.source_module || "estate",
        capabilities: ["conversation", "spatial_reasoning", "registry"],
        current_state: text(floorMetadata.status) || null,
        health: text(floorMetadata.health || floorMetadata.health_status) || null,
        permissions: basePermissions,
        relationships: {
          building_id: text(floorMetadata.building_id) || null,
          floor: text(floorMetadata.floor || candidate.label || candidate.canonical_id) || null,
          child_objects: Array.isArray(floorMetadata.child_objects) ? floorMetadata.child_objects : [],
        },
        evidence_references: [],
        metadata: floorMetadata,
        freshness: text(floorMetadata.updated_at) || null,
      };
      break;
    }
    case "zone": {
      const { data } = await maybeSingle("estate_zones", "id,name,estate_id,zone_ref,zone_type,parent_zone_ref,description,metadata,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (estateScoped && String(row.estate_id || "") !== String(estateScoped)) {
        warnings.push("The selected zone is outside the active estate scope.");
        break;
      }
      object = {
        object_type: "zone",
        canonical_id: String(row.id),
        label: cleanLabel(row.name || candidate.label, "Zone"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: text(recordOf(row.metadata).building_id) || null,
        home_id: null,
        room_id: null,
        parent_id: text(row.parent_zone_ref || recordOf(row.metadata).building_id || row.estate_id || estateScoped) || null,
        source_module: candidate.source_module || "estate",
        capabilities: ["conversation", "spatial_reasoning", "registry"],
        current_state: text(recordOf(row.metadata).status) || null,
        health: text(recordOf(row.metadata).health || recordOf(row.metadata).health_status) || null,
        permissions: basePermissions,
        relationships: {
          estate_id: row.estate_id || null,
          zone_ref: row.zone_ref || null,
          zone_type: row.zone_type || null,
          parent_zone_ref: row.parent_zone_ref || null,
          description: row.description || null,
          child_objects: Array.isArray(recordOf(row.metadata).child_objects) ? recordOf(row.metadata).child_objects : [],
        },
        evidence_references: [],
        metadata: recordOf(row.metadata),
        freshness: row.updated_at || null,
      };
      break;
    }
    case "tower":
    case "block":
    case "wing":
    case "corridor":
    case "access_point":
    case "emergency_asset": {
      const spatialMetadata = recordOf(candidate.metadata);
      const buildingId = text(spatialMetadata.building_id || spatialMetadata.buildingId);
      object = {
        object_type: candidate.object_type,
        canonical_id: candidate.canonical_id,
        label: cleanLabel(candidate.label || spatialMetadata.name || spatialMetadata.label, objectTypeLabel({ object_type: candidate.object_type } as OperationalObject)),
        estate_id: candidate.estate_id || estateScoped,
        building_id: buildingId || null,
        home_id: text(spatialMetadata.home_id || spatialMetadata.homeId) || null,
        room_id: text(spatialMetadata.room_id || spatialMetadata.roomId) || null,
        parent_id: text(spatialMetadata.parent_id || spatialMetadata.parentId || spatialMetadata.floor_id || spatialMetadata.floorId || buildingId || candidate.estate_id || estateScoped) || null,
        source_module: candidate.source_module || "spatial",
        capabilities: ["conversation", "spatial_reasoning", "registry"],
        current_state: text(spatialMetadata.status || spatialMetadata.current_state) || null,
        health: text(spatialMetadata.health || spatialMetadata.health_status) || null,
        permissions: basePermissions,
        relationships: {
          estate_id: candidate.estate_id || estateScoped,
          building_id: buildingId || null,
          floor: text(spatialMetadata.floor || spatialMetadata.floor_name || spatialMetadata.floorName) || null,
          zone: text(spatialMetadata.zone || spatialMetadata.zone_name || spatialMetadata.zoneName) || null,
          room: text(spatialMetadata.room || spatialMetadata.room_name || spatialMetadata.roomName) || null,
          child_objects: Array.isArray(spatialMetadata.child_objects) ? spatialMetadata.child_objects : [],
          contained_objects: Array.isArray(spatialMetadata.contained_objects) ? spatialMetadata.contained_objects : [],
          dependencies: Array.isArray(spatialMetadata.dependencies) ? spatialMetadata.dependencies : [],
          affected_areas: Array.isArray(spatialMetadata.affected_areas) ? spatialMetadata.affected_areas : [],
        },
        evidence_references: arrayOfStrings(spatialMetadata.evidence_references),
        metadata: spatialMetadata,
        freshness: text(spatialMetadata.updated_at || spatialMetadata.freshness) || null,
      };
      break;
    }
    case "room": {
      const { data } = await maybeSingle("rooms", "id,name,home_id,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (homeScoped && String(row.home_id || "") !== String(homeScoped)) {
        warnings.push("The selected room is outside the active home scope.");
        break;
      }
      object = {
        object_type: "room",
        canonical_id: String(row.id),
        label: cleanLabel(row.name, "Room"),
        estate_id: estateScoped,
        building_id: null,
        home_id: String(row.home_id || homeScoped || ""),
        room_id: String(row.id),
        parent_id: String(row.home_id || homeScoped || "") || null,
        source_module: candidate.source_module || "spaces",
        capabilities: ["conversation", "registry"],
        current_state: null,
        health: null,
        permissions: basePermissions,
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "device": {
      const { data } = await maybeSingle("devices", "id,name,estate_id,home_id,room_id,parent_device_id,control_profile,status,health_status,updated_at,metadata", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (homeScoped && String(row.home_id || "") !== String(homeScoped)) {
        warnings.push("This device is outside the active home scope.");
        break;
      }
      object = {
        object_type: "device",
        canonical_id: String(row.id),
        label: cleanLabel(row.name || candidate.label, "Device"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: String(row.home_id || homeScoped || ""),
        room_id: String(row.room_id || candidate.room_id || "") || null,
        parent_id: String(row.parent_device_id || "") || null,
        source_module: candidate.source_module || "devices",
        capabilities: arrayOfStrings([
          row.control_profile,
          ...(arrayOfStrings(recordOf(row.metadata).supported_controls)),
        ]),
        current_state: text(row.status) || null,
        health: text(row.health_status) || null,
        permissions: basePermissions,
        relationships: {},
        evidence_references: [],
        metadata: recordOf(row.metadata),
        freshness: row.updated_at || null,
      };
      break;
    }
    case "device_channel": {
      const deviceId = text(metadata.device_id || candidate.canonical_id.split(":")[0]);
      const channelCode = text(metadata.channel_code || candidate.canonical_id.split(":")[1]);
      const channelIndex = text(metadata.channel_index);
      if (!deviceId) {
        warnings.push("This device channel could not be resolved without a parent device.");
        break;
      }
      const { data } = await maybeSingle("devices", "id,name,estate_id,home_id,room_id,parent_device_id,control_profile,status,health_status,updated_at,metadata", deviceId);
      const row = data as any;
      if (!row?.id) break;
      if (homeScoped && String(row.home_id || "") !== String(homeScoped)) {
        warnings.push("This device channel is outside the active home scope.");
        break;
      }
      const deviceMetadata = recordOf(row.metadata);
      const rawChannels = Array.isArray(deviceMetadata.channel_definitions) ? deviceMetadata.channel_definitions : [];
      const matchedChannel =
        rawChannels.find((entry: any) => text(entry.code || entry.channel_code) === channelCode)
        || rawChannels.find((entry: any) => text(entry.index || entry.channel_index) === channelIndex);
      object = {
        object_type: "device_channel",
        canonical_id: candidate.canonical_id,
        label: cleanLabel(
          matchedChannel?.name || matchedChannel?.label || candidate.label,
          `${cleanLabel(row.name, "Device")} ${channelCode || channelIndex || "channel"}`
        ),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: String(row.home_id || homeScoped || ""),
        room_id: String(row.room_id || candidate.room_id || "") || null,
        parent_id: String(row.id),
        source_module: candidate.source_module || "devices",
        capabilities: arrayOfStrings([
          channelCode || null,
          channelIndex ? `channel_${channelIndex}` : null,
          row.control_profile,
        ]),
        current_state: text(matchedChannel?.state ?? matchedChannel?.current_state ?? row.status) || null,
        health: text(row.health_status) || null,
        permissions: basePermissions,
        relationships: {
          device_id: row.id,
          channel_code: channelCode || null,
          channel_index: channelIndex || null,
        },
        evidence_references: [],
        metadata: {
          ...deviceMetadata,
          channel: matchedChannel || null,
        },
        freshness: row.updated_at || null,
      };
      break;
    }
    case "visitor": {
      const { data } = await maybeSingle("visitors", "id,name,estate_id,home_id,status,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (homeScoped && String(row.home_id || "") !== String(homeScoped)) {
        warnings.push("This visitor is outside the active home scope.");
        break;
      }
      object = {
        object_type: "visitor",
        canonical_id: String(row.id),
        label: cleanLabel(row.name || candidate.label, "Visitor"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: String(row.home_id || homeScoped || "") || null,
        room_id: null,
        parent_id: String(row.home_id || homeScoped || "") || null,
        source_module: candidate.source_module || "visitors",
        capabilities: ["approve", "deny", "extend", "inspect"],
        current_state: text(row.status) || null,
        health: null,
        permissions: basePermissions,
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "access_pass": {
      const { data } = await maybeSingle("visitor_access", "id,visitor_name,estate_id,home_id,status,updated_at,purpose,expires_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (homeScoped && String(row.home_id || "") !== String(homeScoped)) {
        warnings.push("This access pass is outside the active home scope.");
        break;
      }
      object = {
        object_type: "access_pass",
        canonical_id: String(row.id),
        label: cleanLabel(row.visitor_name || candidate.label, "Access pass"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: String(row.home_id || homeScoped || "") || null,
        room_id: null,
        parent_id: String(row.home_id || homeScoped || "") || null,
        source_module: candidate.source_module || "visitors",
        capabilities: ["inspect", "approve", "deny", "extend"],
        current_state: text(row.status) || null,
        health: null,
        permissions: basePermissions,
        relationships: { purpose: row.purpose || null, expires_at: row.expires_at || null },
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "maintenance_request": {
      const { data } = await maybeSingle("maintenance_requests", "id,title,estate_id,home_id,status,assigned_to,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (homeScoped && String(row.home_id || "") !== String(homeScoped)) {
        warnings.push("This maintenance request is outside the active home scope.");
        break;
      }
      object = {
        object_type: "maintenance_request",
        canonical_id: String(row.id),
        label: cleanLabel(row.title || candidate.label, "Maintenance request"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: String(row.home_id || homeScoped || "") || null,
        room_id: null,
        parent_id: String(row.home_id || homeScoped || "") || null,
        source_module: candidate.source_module || "maintenance",
        capabilities: ["inspect", "assign", "escalate", "resolve"],
        current_state: text(row.status) || null,
        health: null,
        permissions: basePermissions,
        relationships: { assigned_to: row.assigned_to || null },
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "wallet": {
      const { data } = await maybeSingle("wallets", "id,user_id,currency,is_frozen,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (actor?.role === "resident" && actor.id && String(row.user_id || "") !== String(actor.id)) {
        warnings.push("This wallet is not available in the active resident scope.");
        break;
      }
      object = {
        object_type: "wallet",
        canonical_id: String(row.id),
        label: cleanLabel(candidate.label, "Wallet"),
        estate_id: estateScoped,
        building_id: null,
        home_id: homeScoped,
        room_id: null,
        parent_id: String(row.user_id || "") || null,
        source_module: candidate.source_module || "wallet",
        capabilities: ["inspect", "fund", "history"],
        current_state: row.is_frozen ? "frozen" : "active",
        health: null,
        permissions: basePermissions,
        relationships: { user_id: row.user_id || null, currency: row.currency || null },
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "service_account": {
      const { data } = await maybeSingle("home_service_accounts", "id,estate_id,home_id,service_key,provider,status,account_ref,meter_id,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      const identifier = text(row.meter_id || row.account_ref);
      if (homeScoped && String(row.home_id || "") !== String(homeScoped)) {
        warnings.push("This service account is outside the active home scope.");
        break;
      }
      object = {
        object_type: "service_account",
        canonical_id: String(row.id),
        label: cleanLabel(candidate.label || `${String(row.service_key || "Service").replace(/_/g, " ")} account`, "Service account"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: String(row.home_id || homeScoped || ""),
        room_id: null,
        parent_id: String(row.home_id || homeScoped || "") || null,
        source_module: candidate.source_module || "services",
        capabilities: ["inspect", "vending", "transactions"],
        current_state: text(row.status) || null,
        health: null,
        permissions: basePermissions,
        relationships: { provider: row.provider || null, identifier },
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "transaction": {
      let { data } = await maybeSingle("wallet_transactions", "id,wallet_id,status,reference,created_at", candidate.canonical_id);
      if (!(data as any)?.id && candidate.canonical_id) {
        const byReference = await maybeSingleWhere("wallet_transactions", "id,wallet_id,status,reference,created_at", "reference", candidate.canonical_id);
        data = byReference.data as any;
      }
      const row = data as any;
      if (!row?.id) break;
      object = {
        object_type: "transaction",
        canonical_id: String(row.id),
        label: cleanLabel(row.reference, "Transaction"),
        estate_id: estateScoped,
        building_id: null,
        home_id: homeScoped,
        room_id: null,
        parent_id: String(row.wallet_id || "") || null,
        source_module: candidate.source_module || "wallet",
        capabilities: ["inspect"],
        current_state: text(row.status) || null,
        health: null,
        permissions: basePermissions,
        relationships: { wallet_id: row.wallet_id || null },
        evidence_references: [],
        metadata: {},
        freshness: row.created_at || null,
      };
      break;
    }
    case "community_post": {
      const { data } = await maybeSingle("community_posts", "id,title,estate_id,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      object = {
        object_type: "community_post",
        canonical_id: String(row.id),
        label: cleanLabel(row.title || candidate.label, "Community post"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: homeScoped,
        room_id: null,
        parent_id: null,
        source_module: candidate.source_module || "community",
        capabilities: ["inspect"],
        current_state: null,
        health: null,
        permissions: basePermissions,
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "camera": {
      const { data } = await maybeSingle("facility_cameras", "id,name,estate_id,room_id,status,health_status,updated_at,dvr_id", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (estateScoped && String(row.estate_id || "") !== String(estateScoped)) {
        warnings.push("This camera is outside the active estate scope.");
        break;
      }
      object = {
        object_type: "camera",
        canonical_id: String(row.id),
        label: cleanLabel(row.name || candidate.label, "Camera"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: homeScoped,
        room_id: String(row.room_id || candidate.room_id || "") || null,
        parent_id: String(row.dvr_id || "") || null,
        source_module: candidate.source_module || "cameras",
        capabilities: ["inspect", "stream", "events"],
        current_state: text(row.status) || null,
        health: text(row.health_status) || null,
        permissions: basePermissions,
        relationships: { dvr_id: row.dvr_id || null },
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "notification": {
      const { data } = await maybeSingle("notifications", "id,title,body,user_id,estate_id,home_id,read,created_at,metadata", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      object = {
        object_type: "notification",
        canonical_id: String(row.id),
        label: cleanLabel(row.title || candidate.label, "Notification"),
        estate_id: String(row.estate_id || estateScoped || "") || null,
        building_id: null,
        home_id: String(row.home_id || homeScoped || "") || null,
        room_id: null,
        parent_id: String(row.user_id || "") || null,
        source_module: candidate.source_module || "notifications",
        capabilities: ["inspect", "acknowledge"],
        current_state: row.read ? "read" : "unread",
        health: null,
        permissions: basePermissions,
        relationships: { user_id: row.user_id || null },
        evidence_references: [],
        metadata: recordOf(row.metadata),
        freshness: row.created_at || null,
      };
      break;
    }
    case "operational_incident":
    case "operational_event": {
      const { data } = await maybeSingle("facility_incidents", "id,title,estate_id,status,severity,updated_at,assigned_to", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (estateScoped && String(row.estate_id || "") !== String(estateScoped)) {
        warnings.push("This operational incident is outside the active estate scope.");
        break;
      }
      object = {
        object_type: candidate.object_type,
        canonical_id: String(row.id),
        label: cleanLabel(row.title || candidate.label, "Operational incident"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: homeScoped,
        room_id: null,
        parent_id: null,
        source_module: candidate.source_module || "incidents",
        capabilities: ["inspect", "acknowledge", "resolve"],
        current_state: text(row.status) || null,
        health: text(row.severity) || null,
        permissions: basePermissions,
        relationships: { assigned_to: row.assigned_to || null },
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "message_thread": {
      const { data } = await maybeSingle("dm_threads", "id,estate_id,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      object = {
        object_type: "message_thread",
        canonical_id: String(row.id),
        label: cleanLabel(candidate.label, "Message thread"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: homeScoped,
        room_id: null,
        parent_id: null,
        source_module: candidate.source_module || "messages",
        capabilities: ["inspect", "reply"],
        current_state: null,
        health: null,
        permissions: basePermissions,
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "automation": {
      const { data } = await maybeSingle("automations", "id,name,estate_id,home_id,enabled,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      object = {
        object_type: "automation",
        canonical_id: String(row.id),
        label: cleanLabel(row.name || candidate.label, "Automation"),
        estate_id: String(row.estate_id || estateScoped || ""),
        building_id: null,
        home_id: String(row.home_id || homeScoped || "") || null,
        room_id: null,
        parent_id: String(row.home_id || homeScoped || "") || null,
        source_module: candidate.source_module || "automations",
        capabilities: ["inspect", "execute", "toggle"],
        current_state: row.enabled === false ? "disabled" : "enabled",
        health: null,
        permissions: basePermissions,
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: row.updated_at || null,
      };
      break;
    }
    case "scene": {
      const { data } = await supabaseAdmin.from("consumer_scenes").select("id,name,estate_id,home_id,enabled,updated_at").eq("id", candidate.canonical_id).maybeSingle();
      if (!data?.id) break;
      object = {
        object_type: "scene",
        canonical_id: String(data.id),
        label: cleanLabel((data as any).name || candidate.label, "Scene"),
        estate_id: String((data as any).estate_id || estateScoped || ""),
        building_id: null,
        home_id: String((data as any).home_id || homeScoped || "") || null,
        room_id: null,
        parent_id: String((data as any).home_id || homeScoped || "") || null,
        source_module: candidate.source_module || "scenes",
        capabilities: ["inspect", "execute", "toggle"],
        current_state: (data as any).enabled === false ? "disabled" : "enabled",
        health: null,
        permissions: basePermissions,
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: (data as any).updated_at || null,
      };
      break;
    }
    default: {
      object = {
        object_type: candidate.object_type,
        canonical_id: candidate.canonical_id,
        label: cleanLabel(candidate.label, "Operational object"),
        estate_id: candidate.estate_id || estateScoped,
        building_id: null,
        home_id: candidate.home_id || homeScoped,
        room_id: candidate.room_id || null,
        parent_id: null,
        source_module: candidate.source_module || null,
        capabilities: [],
        current_state: null,
        health: null,
        permissions: basePermissions,
        relationships: {},
        evidence_references: [],
        metadata,
        freshness: null,
      };
    }
  }

  if (!object && candidate.source === "explicit_request") warnings.push("The selected operational object could not be verified in the active scope.");
  return { object, source: candidate.source, warnings };
}

export function resolveContextSourceForTest(input: { explicit?: boolean; thread?: boolean; home?: boolean; estate?: boolean }) {
  if (input.explicit) return "explicit_request" as const;
  if (input.thread) return "thread_state" as const;
  if (input.home) return "home_scope" as const;
  if (input.estate) return "estate_scope" as const;
  return "global_scope" as const;
}

function canonicalTruthFor(response: Record<string, unknown>, operationalObject: OperationalObject | null): CanonicalTruth {
  const awareness = recordOf(response.awareness);
  const execution = recordOf(response.execution);
  const title = cleanLabel(
    awareness.headline || response.understood || operationalObject?.label || response.intent,
    "Oyi update"
  );
  const body = cleanLabel(response.reply || response.message, "Oyi reviewed the current operational context.");
  return {
    title,
    body,
    truth_state: truthStateFromCompatibility(response),
    severity: severityFor(awareness.severity || execution.status),
    source_event: text(recordOf(response.execution).providerEventId || recordOf(response.execution).provider_event_id) || null,
    confidence: typeof response.confidence === "number" ? Number(response.confidence) : null,
    object: operationalObject,
    occurred_at: text(awareness.generated_at) || null,
    freshness: text(awareness.generated_at) || operationalObject?.freshness || null,
    recommended_actions: Array.isArray(response.suggested_actions) ? response.suggested_actions as Array<Record<string, unknown>> : [],
    active_execution: Object.keys(execution).length ? execution : null,
    target: recordOf(response.target) as OyiTarget | null,
    technical_details: {
      intent: response.intent || null,
      display_mode: response.display_mode || null,
      execution_status: execution.status || null,
    },
  };
}

function human(value: unknown) {
  return text(value).replace(/_/g, " ");
}

function sentence(value: unknown) {
  const raw = human(value).replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.endsWith(".") || raw.endsWith("?") || raw.endsWith("!") ? raw : `${raw}.`;
}

function naturalizeUserCopy(value: unknown) {
  let next = sentence(value);
  const replacements: Array<[RegExp, string]> = [
    [/\bai\.[a-z0-9_.-]+\b/gi, "Oyi background event"],
    [/\boyi\.[a-z0-9_.-]+\b/gi, "Oyi background event"],
    [/\b[a-z]+(?:\.[a-z0-9_-]+){2,}\b/gi, "system event"],
    [/\bruntime\b/gi, "system"],
    [/\bprovider acknowledgement\b/gi, "controller confirmation"],
    [/\bprovider\b/gi, "controller"],
    [/\btelemetry\b/gi, "device updates"],
    [/\bbackend\b/gi, "Oyi"],
    [/\bapi\b/gi, "connection"],
    [/\bexecution pipeline\b/gi, "control path"],
    [/\bsignal normalization\b/gi, "event processing"],
    [/\binternal enum(?:s)?\b/gi, "status"],
    [/\bunsupported capability\b/gi, "feature this object does not support"],
    [/\bcapability unsupported\b/gi, "feature not supported"],
    [/\bpermission restricted\b/gi, "not allowed right now"],
    [/\bpending_confirmation\b/gi, "waiting for confirmation"],
    [/\bstate_confirmed\b/gi, "confirmed"],
    [/\bpartial_confirmation\b/gi, "partially confirmed"],
    [/\bvalidation_required\b/gi, "needs checking first"],
    [/\bexecution ledger\b/gi, "activity history"],
    [/\baudit events?\b/gi, "activity record"],
    [/\bprivacy_class\b/gi, "privacy setting"],
    [/\borganization_restricted\b/gi, "restricted"],
    [/\bresident_device_private\b/gi, "home-private"],
    [/\bInvalid Date\b/g, "time unavailable"],
    [/\bundefined\b/gi, "unavailable"],
    [/\bnull\b/gi, "unavailable"],
    [/\bpermitted surface\b/gi, "available in this view"],
    [/\bFacility projection\b/gi, "building view"],
  ];
  for (const [pattern, replacement] of replacements) next = next.replace(pattern, replacement);
  return next
    .replace(/\b([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM)?)\s*\(\s*\1\s*\)/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function listNames(value: unknown, fallbackPrefix: string) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row, index) => {
      const record = recordOf(row);
      return text(record.name || record.label || record.title || record.id) || `${fallbackPrefix} ${index + 1}`;
    })
    .filter(Boolean);
}

function objectTypeLabel(object: OperationalObject) {
  const labels: Record<string, string> = {
    device: "device",
    device_channel: "channel",
    tower: "tower",
    block: "block",
    room: "room",
    corridor: "corridor",
    wing: "wing",
    visitor: "visitor",
    access_pass: "access pass",
    maintenance_request: "maintenance request",
    wallet: "wallet",
    transaction: "transaction",
    service_account: "service",
    camera: "camera",
    meter: "meter",
    scene: "scene",
    automation: "automation",
    message_thread: "message thread",
    community_post: "community post",
    notification: "notification",
    operational_incident: "incident",
    operational_event: "event",
    infrastructure_asset: "asset",
    access_point: "access point",
    emergency_asset: "emergency asset",
    provider: "provider",
    estate: "estate",
    building: "building",
    home: "home",
    floor: "floor",
    zone: "zone",
    twin_node: "twin object",
  };
  return labels[object.object_type] || "object";
}

function objectPersonality(object: OperationalObject) {
  const profiles: Partial<Record<OperationalObjectType, { role: string; diagnostics: string[]; actions: string[] }>> = {
    device: {
      role: "I operate from this device's live state, controls, health, activity, and relationships.",
      diagnostics: ["state", "health", "last control", "automation", "connection"],
      actions: ["control", "timer", "schedule", "rename", "diagnose"],
    },
    device_channel: {
      role: "I operate this device channel independently while keeping the parent device context.",
      diagnostics: ["channel state", "last update", "parent device", "automation"],
      actions: ["control", "timer", "schedule", "rename channel"],
    },
    room: {
      role: "I read the room as a living operational space: devices, occupancy, activity, scenes, and comfort.",
      diagnostics: ["active devices", "occupancy", "room activity", "scenes"],
      actions: ["turn devices off", "run scene", "check occupancy", "summarize activity"],
    },
    building: {
      role: "I read this building as a connected operational system: floors, zones, rooms, infrastructure, devices, people, and service impact.",
      diagnostics: ["operational health", "occupancy", "infrastructure", "maintenance"],
      actions: ["show affected areas", "check infrastructure", "review maintenance", "show evidence"],
    },
    floor: {
      role: "I read this floor through its zones, rooms, devices, occupancy, incidents, and infrastructure dependencies.",
      diagnostics: ["rooms", "active devices", "incidents", "service impact"],
      actions: ["show rooms", "check offline areas", "review maintenance", "show evidence"],
    },
    zone: {
      role: "I read this zone as a spatial operating area with contained rooms, assets, devices, and incidents.",
      diagnostics: ["contained objects", "health", "dependencies", "activity"],
      actions: ["show contained objects", "check health", "show affected areas"],
    },
    corridor: {
      role: "I read this corridor through access, lighting, cameras, sensors, and movement-related events.",
      diagnostics: ["lighting", "cameras", "access points", "activity"],
      actions: ["check lighting", "show cameras", "review access activity"],
    },
    wing: {
      role: "I read this wing across its rooms, corridors, infrastructure, occupants, and operational risks.",
      diagnostics: ["rooms", "maintenance", "security", "infrastructure"],
      actions: ["show affected rooms", "check maintenance", "review security"],
    },
    visitor: {
      role: "I track this visitor's identity, access state, arrival history, and safe approval path.",
      diagnostics: ["identity", "access status", "arrival history", "approval state"],
      actions: ["approve", "extend", "deny", "review history"],
    },
    access_pass: {
      role: "I track this access pass, its holder, validity, usage, and security state.",
      diagnostics: ["validity", "usage", "holder", "security"],
      actions: ["extend", "cancel", "review usage"],
    },
    maintenance_request: {
      role: "I track this maintenance request through issue, assignee, delay, escalation, and closure.",
      diagnostics: ["status", "assignee", "delay", "related incidents"],
      actions: ["assign", "escalate", "review history", "close"],
    },
    wallet: {
      role: "I track this wallet's balance, funding, charges, receipts, and payment safety.",
      diagnostics: ["balance", "last payment", "receipts", "outstanding charges"],
      actions: ["verify payment", "show receipt", "show transactions"],
    },
    transaction: {
      role: "I track this transaction's amount, confirmation state, receipt, and ledger evidence.",
      diagnostics: ["payment status", "receipt", "ledger", "confirmation"],
      actions: ["verify", "show receipt", "explain status"],
    },
    service_account: {
      role: "I track this service account's provider, tariff, billing, vending readiness, and transactions.",
      diagnostics: ["tariff", "billing", "provider readiness", "transactions"],
      actions: ["check vending", "show tariff", "show transactions", "report issue"],
    },
    infrastructure_asset: {
      role: "I track this asset's health, dependencies, incidents, services, and operational impact.",
      diagnostics: ["health", "dependencies", "incidents", "affected homes"],
      actions: ["diagnose", "show dependencies", "review incidents"],
    },
    access_point: {
      role: "I track this access point's location, protected area, activity, cameras, and security state.",
      diagnostics: ["access state", "protected area", "recent activity", "linked cameras"],
      actions: ["show access history", "check camera", "review security"],
    },
    emergency_asset: {
      role: "I track this emergency asset's location, readiness, inspection state, and affected area.",
      diagnostics: ["readiness", "location", "inspection", "coverage"],
      actions: ["show location", "review inspection", "check coverage"],
    },
    camera: {
      role: "I monitor this camera's live state, events, connectivity, and security context.",
      diagnostics: ["live state", "motion events", "connection", "coverage"],
      actions: ["show events", "check connection", "review incident"],
    },
    meter: {
      role: "I track this meter's service binding, readings, tariff context, and settlement evidence.",
      diagnostics: ["readings", "service", "tariff", "last update"],
      actions: ["show readings", "check service", "review transactions"],
    },
    scene: {
      role: "I coordinate the devices and conditions attached to this scene.",
      diagnostics: ["included devices", "last run", "failures", "schedule"],
      actions: ["run", "edit", "show devices"],
    },
    automation: {
      role: "I track this automation's trigger, conditions, actions, and last execution.",
      diagnostics: ["trigger", "conditions", "last run", "affected objects"],
      actions: ["enable", "disable", "edit", "show history"],
    },
    message_thread: {
      role: "I track this conversation thread, participants, messages, and operational follow-up.",
      diagnostics: ["participants", "latest message", "status", "linked records"],
      actions: ["reply", "resolve", "open record"],
    },
    community_post: {
      role: "I track this community item, audience, responses, and follow-up state.",
      diagnostics: ["audience", "responses", "status"],
      actions: ["summarize", "reply", "review activity"],
    },
    notification: {
      role: "I track this notification's event, read state, deep link, and evidence.",
      diagnostics: ["event", "delivery", "read state"],
      actions: ["open event", "mark read", "show evidence"],
    },
    operational_incident: {
      role: "I track this incident's cause, affected objects, recovery, and recommended action.",
      diagnostics: ["cause", "duration", "affected objects", "recovery"],
      actions: ["show evidence", "show affected", "review recovery"],
    },
    operational_event: {
      role: "I track this operational event, evidence, impact, and follow-up.",
      diagnostics: ["evidence", "impact", "status"],
      actions: ["show evidence", "review follow-up"],
    },
    twin_node: {
      role: "I represent the selected spatial object and its live operational relationships.",
      diagnostics: ["position", "relationships", "state", "activity"],
      actions: ["show relationships", "show activity", "diagnose"],
    },
  };
  return profiles[object.object_type] || {
    role: `I answer from this ${objectTypeLabel(object)} and its operational evidence.`,
    diagnostics: ["status", "health", "activity", "relationships"],
    actions: ["status", "activity", "relationships", "evidence"],
  };
}

function objectVoice(object: OperationalObject) {
  const type = object.object_type;
  if (type === "device" || type === "device_channel") return {
    healthy: "Everything responded normally.",
    unavailable: "I can’t verify it right now.",
    next: "Would you like to check health, view history, or create an automation?",
  };
  if (type === "wallet" || type === "transaction") return {
    healthy: "The financial record looks consistent.",
    unavailable: "I can’t verify the payment record right now.",
    next: "Would you like recent transactions or a receipt?",
  };
  if (type === "visitor" || type === "access_pass") return {
    healthy: "No unusual access activity is visible.",
    unavailable: "I can’t verify the access record right now.",
    next: "Would you like access history or the current pass status?",
  };
  if (type === "maintenance_request") return {
    healthy: "The request is still trackable.",
    unavailable: "I can’t verify the maintenance record right now.",
    next: "Would you like the assignee, history, or escalation options?",
  };
  if (type === "service_account" || type === "meter") return {
    healthy: "The service record is available.",
    unavailable: "I can’t verify this service right now.",
    next: "Would you like tariff, billing, or recent transactions?",
  };
  if (type === "camera") return {
    healthy: "The camera record is available.",
    unavailable: "I can’t verify the camera right now.",
    next: "Would you like recent events or a connection check?",
  };
  return {
    healthy: "Everything I can verify looks normal.",
    unavailable: "I can’t verify that right now.",
    next: "Would you like activity, relationships, or evidence?",
  };
}

function naturalState(value: unknown) {
  const raw = human(value).toLowerCase();
  if (!raw) return "";
  const map: Record<string, string> = {
    on: "ON",
    off: "OFF",
    online: "online",
    offline: "offline",
    healthy: "healthy",
    normal: "normal",
    degraded: "degraded",
    unavailable: "unavailable",
    pending: "pending",
    "pending confirmation": "waiting for confirmation",
    active: "active",
    inactive: "inactive",
    open: "open",
    closed: "closed",
    resolved: "resolved",
    failed: "not completed",
  };
  return map[raw] || human(value);
}

function objectStateLine(object: OperationalObject) {
  const state = naturalState(object.current_state);
  const health = naturalState(object.health);
  if (state && health && state.toLowerCase() !== health.toLowerCase()) return `${object.label} is ${state}. Health is ${health}.`;
  if (state) return `${object.label} is ${state}.`;
  if (health) return `${object.label} health is ${health}.`;
  return `${object.label} is selected.`;
}

function relationshipLine(object: OperationalObject, input: CanonicalConversationRequest) {
  const relationships = { ...recordOf(object.relationships), ...recordOf(input.relationships) };
  const parts: string[] = [];
  const room = text(input.room_name || relationships.room_name || relationships.room || object.room_id);
  const parent = recordOf(relationships.parent_device || relationships.parent || {});
  const children = Array.isArray(relationships.child_devices) ? relationships.child_devices : Array.isArray(relationships.children) ? relationships.children : [];
  const scenes = Array.isArray(input.active_scenes) ? input.active_scenes : Array.isArray(relationships.scenes) ? relationships.scenes : [];
  const automations = Array.isArray(input.active_automations) ? input.active_automations : Array.isArray(relationships.automations) ? relationships.automations : [];
  const schedules = Array.isArray(relationships.schedules) ? relationships.schedules : [];
  const sensors = Array.isArray(relationships.sensors) ? relationships.sensors : [];
  const affectedHomes = Array.isArray(relationships.affected_homes) ? relationships.affected_homes : [];
  const transactions = Array.isArray(relationships.transactions) ? relationships.transactions : [];
  const assignee = text(relationships.assignee_name || relationships.assignee || relationships.technician);
  const controller = text(relationships.controller || relationships.provider || recordOf(object.metadata).controller || recordOf(object.metadata).provider);
  const sceneNames = listNames(scenes, "scene");
  const automationNames = listNames(automations, "automation");
  if (room) parts.push(`${object.label} belongs to ${room}.`);
  if (parent.name || parent.id) parts.push(`It depends on ${text(parent.name || parent.id)}.`);
  if (children.length) parts.push(`${children.length} linked child ${children.length === 1 ? "object depends" : "objects depend"} on it.`);
  if (sceneNames.length) parts.push(`${sceneNames.slice(0, 2).join(" and ")} ${sceneNames.length === 1 ? "can affect it" : "can affect it"}.`);
  if (automationNames.length) parts.push(`${automationNames.slice(0, 2).join(" and ")} ${automationNames.length === 1 ? "can control it" : "can control it"}.`);
  if (schedules.length) parts.push(`${schedules.length} ${schedules.length === 1 ? "schedule is" : "schedules are"} linked.`);
  if (sensors.length) parts.push(`${sensors.length} ${sensors.length === 1 ? "sensor informs" : "sensors inform"} it.`);
  if (affectedHomes.length) parts.push(`${affectedHomes.length} ${affectedHomes.length === 1 ? "home is" : "homes are"} affected.`);
  if (transactions.length) parts.push(`${transactions.length} recent ${transactions.length === 1 ? "transaction is" : "transactions are"} linked.`);
  if (assignee) parts.push(`Current assignee is ${assignee}.`);
  if (controller) parts.push(`It is connected through ${controller}.`);
  return parts.join(" ");
}

function memoryLine(object: OperationalObject, input: CanonicalConversationRequest) {
  const memory = recordOf(input.memory_summary);
  const executions = Array.isArray(input.recent_executions) ? input.recent_executions : [];
  const activity = text(recordOf(input.conversation_context).activity_summary || recordOf(object.metadata).activity_summary);
  const summary = text(memory.summary || memory.headline || memory.last_event || memory.last_activity || activity);
  if (summary) return summary;
  const usually = text(memory.usual_time || memory.normal_time || memory.pattern);
  if (usually) return `${object.label} usually follows this pattern: ${usually}.`;
  if (executions.length) {
    const latest = recordOf(executions[0]);
    const latestSummary = text(latest.summary || latest.title || latest.status);
    return latestSummary ? `Last activity: ${latestSummary}.` : `${object.label} has ${executions.length} recent recorded ${executions.length === 1 ? "action" : "actions"}.`;
  }
  return "";
}

function evidenceLine(object: OperationalObject, response: Record<string, unknown>) {
  const sourceCount = Array.isArray(response.sources) ? response.sources.length : 0;
  const freshness = object.freshness ? ` Last updated ${new Date(object.freshness).toLocaleString()}.` : "";
  if (sourceCount) return `I checked ${sourceCount} relevant ${sourceCount === 1 ? "record" : "records"} for ${object.label}.${freshness}`;
  return `I checked the current ${objectTypeLabel(object)} record for ${object.label}.${freshness || " I don’t have a freshness time for it yet."}`;
}

function truthLanguage(state: TruthState, object: OperationalObject) {
  const label = object.label;
  const map: Record<TruthState, string> = {
    confirmed: `I've confirmed that for ${label}.`,
    observed: `I can see that in ${label}'s recent records.`,
    inferred: `Everything suggests that for ${label}.`,
    predicted: `Based on recent activity, I expect that for ${label}.`,
    pending_confirmation: `${label} responded, but I’m still waiting for final confirmation.`,
    unavailable: `I can’t verify ${label} right now.`,
    unsupported: `${label} doesn’t support that feature.`,
    permission_restricted: `You’re not allowed to do that on ${label} right now.`,
  };
  return map[state];
}

function broadSummaryRequested(message: string) {
  return /\b(how many|all devices|all visitors|whole house|whole home|entire estate|whole estate|everything|estate summary|home summary|list all|show all)\b/i.test(message);
}

function looksLikeBroadFallback(message: string) {
  return /\bthere (?:are|is) \d+|connected devices|current home|current estate|i can help|what can you do|available devices|records available/i.test(message);
}

function requestedPowerState(message: string) {
  const lower = message.toLowerCase();
  if (/\b(turn|switch|put|power)\b.*\b(on|up)\b|\bput it on\b|\bon this\b/i.test(lower)) return "on";
  if (/\b(turn|switch|put|power)\b.*\b(off|down)\b|\boff this\b|\bturn everything off\b/i.test(lower)) return "off";
  return "";
}

function isControlRequest(message: string) {
  return /\b(turn|switch|put|power|lock|unlock|open|close|dim|set|run|approve|extend|escalate|assign|pay|buy|fund)\b/i.test(message);
}

function isExplanationRequest(message: string) {
  return /\b(why|explain|reason|what caused|because)\b/i.test(message);
}

function relationshipEvidence(object: OperationalObject, input: CanonicalConversationRequest) {
  const relationships = { ...recordOf(object.relationships), ...recordOf(input.relationships) };
  const scenes = listNames(input.active_scenes || relationships.scenes, "scene");
  const automations = listNames(input.active_automations || relationships.automations, "automation");
  const sensors = listNames(relationships.sensors, "sensor");
  const occupiedRooms = Array.isArray(relationships.occupied_rooms) ? relationships.occupied_rooms : [];
  const affectedHomes = Array.isArray(relationships.affected_homes) ? relationships.affected_homes : [];
  const evidence: string[] = [];
  if (scenes.length) evidence.push(`${scenes.slice(0, 2).join(" and ")} can affect it`);
  if (automations.length) evidence.push(`${automations.slice(0, 2).join(" and ")} can control it`);
  if (sensors.length) evidence.push(`${sensors.slice(0, 2).join(" and ")} ${sensors.length === 1 ? "informs" : "inform"} it`);
  if (occupiedRooms.length) evidence.push(`${occupiedRooms.length} ${occupiedRooms.length === 1 ? "room is" : "rooms are"} still occupied`);
  if (affectedHomes.length) evidence.push(`${affectedHomes.length} ${affectedHomes.length === 1 ? "home is" : "homes are"} affected`);
  return evidence;
}

function spatialRelationships(object: OperationalObject, input: CanonicalConversationRequest) {
  return { ...recordOf(object.metadata), ...recordOf(object.relationships), ...recordOf(input.relationships) };
}

function isSpatialObject(object: OperationalObject) {
  return new Set<OperationalObjectType>([
    "estate",
    "building",
    "tower",
    "block",
    "floor",
    "wing",
    "zone",
    "corridor",
    "room",
    "home",
    "infrastructure_asset",
    "access_point",
    "emergency_asset",
    "twin_node",
  ]).has(object.object_type);
}

function isSpatialRequest(message: string) {
  return /\b(upstairs|downstairs|floor|building|tower|block|wing|corridor|zone|room|area|areas|where|located|contains|contain|inside|affected|offline|occupied|lights on|dark|consumes|power|water pressure|entrance|protecting|owns this|belongs)\b/i.test(message);
}

function namesFromRelationship(value: unknown, fallback: string) {
  return listNames(value, fallback).slice(0, 6);
}

function spatialHierarchyLine(object: OperationalObject, input: CanonicalConversationRequest) {
  const relationships = spatialRelationships(object, input);
  const parts = [
    text(relationships.estate_name || relationships.estate || object.estate_id),
    text(relationships.building_name || relationships.building || object.building_id),
    text(relationships.floor_name || relationships.floor),
    text(relationships.wing_name || relationships.wing),
    text(relationships.zone_name || relationships.zone),
    text(input.room_name || relationships.room_name || relationships.room || object.room_id),
  ].filter(Boolean);
  if (!parts.length) return "";
  return `${object.label} sits in ${parts.join(" → ")}.`;
}

function spatialContainmentLine(object: OperationalObject, input: CanonicalConversationRequest) {
  const relationships = spatialRelationships(object, input);
  const rooms = namesFromRelationship(relationships.rooms, "room");
  const floors = namesFromRelationship(relationships.floors, "floor");
  const zones = namesFromRelationship(relationships.zones, "zone");
  const devices = namesFromRelationship(relationships.devices, "device");
  const cameras = namesFromRelationship(relationships.cameras, "camera");
  const assets = namesFromRelationship(relationships.infrastructure_assets || relationships.assets, "asset");
  const people = namesFromRelationship(relationships.people || relationships.occupants || relationships.residents, "person");
  const parts: string[] = [];
  if (floors.length) parts.push(`${floors.length} ${floors.length === 1 ? "floor" : "floors"}`);
  if (zones.length) parts.push(`${zones.length} ${zones.length === 1 ? "zone" : "zones"}`);
  if (rooms.length) parts.push(`${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`);
  if (devices.length) parts.push(`${devices.length} ${devices.length === 1 ? "device" : "devices"}`);
  if (cameras.length) parts.push(`${cameras.length} ${cameras.length === 1 ? "camera" : "cameras"}`);
  if (assets.length) parts.push(`${assets.length} infrastructure ${assets.length === 1 ? "asset" : "assets"}`);
  if (people.length) parts.push(`${people.length} ${people.length === 1 ? "person" : "people"}`);
  if (!parts.length) return "";
  return `${object.label} contains ${parts.join(", ")}.`;
}

function spatialAreaAggregation(input: CanonicalConversationRequest, object: OperationalObject) {
  const relationships = spatialRelationships(object, input);
  const message = input.message.toLowerCase();
  const rooms = Array.isArray(relationships.rooms) ? relationships.rooms.map(recordOf) : [];
  const devices = Array.isArray(relationships.devices) ? relationships.devices.map(recordOf) : [];
  const cameras = Array.isArray(relationships.cameras) ? relationships.cameras.map(recordOf) : [];
  const maintenanceSource = Array.isArray(relationships.maintenance_requests)
    ? relationships.maintenance_requests
    : Array.isArray(relationships.maintenance)
      ? relationships.maintenance
      : [];
  const maintenance = maintenanceSource.map(recordOf);

  if (/occupied/.test(message)) {
    const occupied = rooms.filter((room) => /occupied|active|present/i.test(text(room.occupancy || room.status || room.state)));
    if (occupied.length) return `${occupied.map((room) => text(room.name || room.label || room.id)).filter(Boolean).join(", ")} ${occupied.length === 1 ? "is" : "are"} occupied.`;
    return `I don’t see confirmed occupied rooms for ${object.label} right now.`;
  }
  if (/lights on|rooms.*on|still.*on/.test(message)) {
    const onDevices = devices.filter((device) => /light|switch|relay/i.test(text(device.type || device.family || device.name || device.label)) && /on|active/i.test(text(device.state || device.status || device.primary_state)));
    if (onDevices.length) return `${onDevices.map((device) => text(device.room_name || device.room || device.name || device.label)).filter(Boolean).join(", ")} still ${onDevices.length === 1 ? "has" : "have"} lights on.`;
    return `I don’t see any confirmed lights still on in ${object.label}.`;
  }
  if (/offline|unavailable|down/.test(message)) {
    const offlineDevices = [...devices, ...cameras].filter((item) => /offline|unavailable|down|degraded/i.test(text(item.health || item.status || item.state)));
    if (offlineDevices.length) return `${offlineDevices.length} ${offlineDevices.length === 1 ? "object is" : "objects are"} offline or degraded in ${object.label}: ${offlineDevices.map((item) => text(item.name || item.label || item.id)).filter(Boolean).slice(0, 5).join(", ")}.`;
    return `I don’t see confirmed offline areas in ${object.label}.`;
  }
  if (/maintenance|unresolved|fault|issue/.test(message)) {
    const unresolved = maintenance.filter((item) => !/closed|resolved|completed/i.test(text(item.status)));
    if (unresolved.length) return `${unresolved.length} unresolved ${unresolved.length === 1 ? "maintenance item is" : "maintenance items are"} linked to ${object.label}.`;
    return `I don’t see unresolved maintenance linked to ${object.label}.`;
  }
  return "";
}

function spatialDependencyLine(object: OperationalObject, input: CanonicalConversationRequest) {
  const relationships = spatialRelationships(object, input);
  const dependencies = namesFromRelationship(relationships.dependencies || relationships.upstream_assets, "dependency");
  const affectedAreas = namesFromRelationship(relationships.affected_areas || relationships.affected_rooms || relationships.affected_homes, "area");
  const dependentObjects = namesFromRelationship(relationships.dependent_devices || relationships.dependent_objects || relationships.downstream_objects, "object");
  const parts: string[] = [];
  if (dependencies.length) parts.push(`It depends on ${dependencies.slice(0, 3).join(", ")}.`);
  if (dependentObjects.length) parts.push(`${dependentObjects.length} downstream ${dependentObjects.length === 1 ? "object depends" : "objects depend"} on it: ${dependentObjects.slice(0, 4).join(", ")}.`);
  if (affectedAreas.length) parts.push(`Affected areas include ${affectedAreas.slice(0, 4).join(", ")}.`);
  return parts.join(" ");
}

function spatialReasoningReply(input: CanonicalConversationRequest, object: OperationalObject) {
  if (!isSpatialRequest(input.message)) return "";
  const message = input.message.toLowerCase();
  const hierarchy = spatialHierarchyLine(object, input);
  const containment = spatialContainmentLine(object, input);
  const dependencies = spatialDependencyLine(object, input);
  const aggregate = spatialAreaAggregation(input, object);
  if (/\b(where|located|which room|which floor|which building|entrance|protecting|owns this|belongs)\b/i.test(message)) {
    return hierarchy || dependencies || `I don’t have a confirmed spatial location for ${object.label} yet.`;
  }
  if (/\b(contains|contain|inside|what is in|show me)\b/i.test(message) || /\b(upstairs|downstairs|second floor|floor|building|wing|block|tower)\b/i.test(message)) {
    return [hierarchy, containment, dependencies].filter(Boolean).join(" ") || `I don’t have contained-object evidence for ${object.label} yet.`;
  }
  if (aggregate) return `${aggregate} ${dependencies || recommendationFor(object, input)}`;
  if (/\b(why|dark|wrong|affected|failure|impact|depends|dependency)\b/i.test(message)) {
    return [objectStateLine(object), dependencies || containment, recommendationFor(object, input)].filter(Boolean).join(" ");
  }
  if (hierarchy || containment || dependencies) return [hierarchy, containment, dependencies, recommendationFor(object, input)].filter(Boolean).join(" ");
  return "";
}

function predictionEvidence(input: CanonicalConversationRequest) {
  const predictions = Array.isArray(input.predictive_findings) ? input.predictive_findings.map(recordOf) : [];
  return predictions
    .map((item) => text(item.summary || item.title || item.finding || item.recommended_action))
    .filter(Boolean)
    .slice(0, 2);
}

function recommendationFor(object: OperationalObject, input: CanonicalConversationRequest) {
  const lower = input.message.toLowerCase();
  const state = `${object.current_state || ""} ${input.primary_state || ""}`.toLowerCase();
  if ((object.object_type === "device" || object.object_type === "device_channel") && /\b(on|active)\b/.test(state)) {
    if (/\benergy|usage|power\b/.test(lower)) return "I recommend reviewing energy usage next.";
    return "Would you like to view history, check energy usage, or create an automation?";
  }
  if ((object.object_type === "device" || object.object_type === "device_channel") && /\b(off|inactive)\b/.test(state)) {
    return "Would you like to check health, view history, or create a schedule?";
  }
  if (object.object_type === "maintenance_request") return "I recommend checking the assignee and escalation path next.";
  if (object.object_type === "wallet" || object.object_type === "transaction") return "I recommend checking the receipt or recent transactions next.";
  if (object.object_type === "service_account" || object.object_type === "meter") return "I recommend checking tariff, billing, and vending readiness next.";
  if (object.object_type === "visitor" || object.object_type === "access_pass") return "I recommend reviewing access history before making changes.";
  if (object.object_type === "room" || object.object_type === "zone") return "I recommend checking active devices before changing the whole room.";
  return objectVoice(object).next;
}

function operationalReasoningReply(input: CanonicalConversationRequest, response: Record<string, unknown>, object: OperationalObject) {
  const requested = requestedPowerState(input.message);
  const state = `${object.current_state || ""} ${input.primary_state || ""}`.toLowerCase();
  const relationshipFacts = relationshipEvidence(object, input);
  const predictionFacts = predictionEvidence(input);
  const memory = memoryLine(object, input);
  const recommendation = recommendationFor(object, input);
  const spatialReply = spatialReasoningReply(input, object);
  if (spatialReply) return spatialReply;

  if (isExplanationRequest(input.message)) {
    const evidence = [...relationshipFacts, memory, ...predictionFacts].filter(Boolean);
    if (evidence.length) {
      return `${evidence.slice(0, 2).map(sentence).join(" ")} ${recommendation}`;
    }
    return `I don’t have enough evidence to explain that confidently yet. ${recommendation}`;
  }

  if (requested && (object.object_type === "device" || object.object_type === "device_channel")) {
    const isAlreadyOn = requested === "on" && /\b(on|active)\b/.test(state);
    const isAlreadyOff = requested === "off" && /\b(off|inactive)\b/.test(state);
    if (isAlreadyOn || isAlreadyOff) {
      return `${object.label} is already ${requested.toUpperCase()}. Nothing needed to change. ${recommendation}`;
    }
  }

  if (/\bturn everything off\b/i.test(input.message) && relationshipFacts.some((fact) => /occupied/.test(fact))) {
    return `${relationshipFacts.find((fact) => /occupied/.test(fact))}. I recommend switching off only the unoccupied areas first.`;
  }

  if (predictionFacts.length && !isControlRequest(input.message)) {
    return `${objectStateLine(object)} ${predictionFacts.map((item) => `Based on recent activity, ${item.charAt(0).toLowerCase()}${item.slice(1)}`).join(" ")} ${recommendation}`;
  }

  if (isControlRequest(input.message) && relationshipFacts.length && !executionStatus(response)) {
    return `${relationshipFacts.slice(0, 2).map(sentence).join(" ")} ${recommendation}`;
  }

  return "";
}

function executionStatus(response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const direct = text(execution.status).toLowerCase();
  const results = Array.isArray(execution.results) ? execution.results : [];
  const first = recordOf(results[0]);
  return text(first.status || direct).toLowerCase();
}

function executionRealityReply(object: OperationalObject, response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const status = executionStatus(response);
  const results = Array.isArray(execution.results) ? execution.results.map(recordOf) : [];
  const reason = text(execution.reason || execution.error || recordOf(results[0]).reason || recordOf(results[0]).message);
  if (/state_confirmed|executed|success|successful|completed|processed/.test(status)) {
    const state = naturalState(recordOf(results[0]).new_state || recordOf(results[0]).state || object.current_state);
    return state
      ? `Done. ${object.label} is now ${state}. ${objectVoice(object).healthy}`
      : `Done. ${object.label} completed the request successfully. ${objectVoice(object).healthy}`;
  }
  if (/provider accepted|accepted|partial|partial_confirmation/.test(status)) {
    return `${object.label} responded to the request. I’m still waiting for confirmation from the controller, so I’ll keep monitoring it.`;
  }
  if (/pending_confirmation|confirmation_required/.test(status) || response.requiresConfirmation || response.approvalRequired) {
    return contextualConfirmationReply(object, response);
  }
  if (/timeout|timed_out/.test(status)) {
    return `I couldn't complete that action. ${object.label} did not respond before the timeout, so I have not marked anything as changed.`;
  }
  if (/unsupported|validation_required/.test(status)) {
    return `${object.label} doesn’t support that feature. ${reason ? naturalizeUserCopy(reason) : "I can still show its status, health, and activity history."}`;
  }
  if (/permission|denied/.test(status)) {
    return `I can’t do that on ${object.label} from your current access level.`;
  }
  if (/failed|error/.test(status)) {
    return reason ? `I couldn't complete that action for ${object.label}. ${naturalizeUserCopy(reason)}` : `I couldn't complete that action for ${object.label}. Nothing has been confirmed as changed.`;
  }
  return "";
}

function contextualConfirmationReply(object: OperationalObject, response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const confirmations = Array.isArray(response.confirmations) ? response.confirmations.map(recordOf) : [];
  const pending = confirmations[0] || recordOf((Array.isArray(execution.results) ? execution.results : []).map(recordOf).find((row) => row.status === "pending_confirmation"));
  const summary = text(pending.summary || pending.title || execution.summary || response.understood);
  const capabilities = object.capabilities.map((item) => item.toLowerCase());
  if (object.object_type === "device" || object.object_type === "device_channel") {
    if (capabilities.some((item) => /switch|power|relay|lock|curtain|scene|automation/.test(item))) {
      return summary
        ? `${naturalizeUserCopy(summary)} Would you like me to continue?`
        : `I found the correct ${objectTypeLabel(object)}. Should I do that now?`;
    }
    return `${object.label} may not support that exact control. Should I continue with the nearest safe option?`;
  }
  if (object.object_type === "wallet" || object.object_type === "transaction") {
    return summary
      ? `${naturalizeUserCopy(summary)} Should I continue with this payment step?`
      : `This affects the financial record for ${object.label}. Should I continue?`;
  }
  if (object.object_type === "visitor" || object.object_type === "access_pass") {
    return summary
      ? `${naturalizeUserCopy(summary)} Should I apply that access change?`
      : `This changes access for ${object.label}. Should I continue?`;
  }
  if (object.object_type === "maintenance_request") {
    return summary
      ? `${naturalizeUserCopy(summary)} Should I update this request?`
      : `This will update ${object.label}. Should I continue?`;
  }
  return summary ? `${naturalizeUserCopy(summary)} Would you like me to continue?` : `I can do that for ${object.label}. Should I continue?`;
}

function objectCapabilityLine(object: OperationalObject) {
  const profile = objectPersonality(object);
  const actions = profile.actions.slice(0, 4).join(", ");
  const diagnostics = profile.diagnostics.slice(0, 4).join(", ");
  return `${profile.role} I can help with ${actions}, and explain ${diagnostics}.`;
}

function objectDefaultReply(object: OperationalObject, input: CanonicalConversationRequest) {
  const lines = [objectStateLine(object)];
  const memory = memoryLine(object, input);
  const relationships = relationshipLine(object, input);
  if (memory) lines.push(memory);
  if (relationships) lines.push(relationships);
  lines.push(memory || relationships ? objectVoice(object).next : objectCapabilityLine(object));
  return lines.join(" ");
}

function objectQuestionReply(input: CanonicalConversationRequest, response: Record<string, unknown>, object: OperationalObject) {
  const message = input.message.toLowerCase();
  const base = objectDefaultReply(object, input);
  if (/\b(activity|history|what happened|last time|last command|last execution|how long|how many times|who turned|who controlled)\b/i.test(message)) {
    const memory = memoryLine(object, input);
    return memory
      ? `${memory} ${relationshipLine(object, input) || ""}`.trim()
      : `I don’t have detailed recent activity for ${object.label} yet. I can still check its current status and relationships.`;
  }
  if (/\b(relationship|relationships|what controls|depends|affected|scene|automation|where is|belongs|parent|children)\b/i.test(message)) {
    return relationshipLine(object, input) || `I don’t see linked relationships for ${object.label} yet.`;
  }
  if (/\b(working|health|healthy|offline|online|fault|diagnose|why.*fail|why.*not|connection|status)\b/i.test(message)) {
    return base;
  }
  if (/\b(evidence|how do you know|are you sure|provider confirm|confirmed|last updated|prediction|fact)\b/i.test(message)) {
    return evidenceLine(object, response);
  }
  if (/\b(what can|who are you|what are you|help)\b/i.test(message)) {
    return `You're talking to ${object.label}. ${objectCapabilityLine(object)}`;
  }
  return "";
}

function contextualObjectActions(object: OperationalObject, input: CanonicalConversationRequest) {
  const actions: Array<Record<string, unknown>> = [];
  const state = `${object.current_state || ""} ${input.primary_state || ""}`.toLowerCase();
  const capabilities = new Set([...(object.capabilities || []), ...(input.supported_controls || [])].map((item) => item.toLowerCase()));
  const add = (label: string, prompt: string, risk = "read") => actions.push({ label, prompt, risk, operational_object: { object_type: object.object_type, canonical_id: object.canonical_id } });
  if (object.object_type === "device" || object.object_type === "device_channel") {
    if (capabilities.has("switch") || capabilities.has("power") || capabilities.has("switch_1") || /switch|light|plug|relay/.test([...capabilities].join(" "))) {
      add(/on|active/.test(state) ? "Turn Off" : "Turn On", /on|active/.test(state) ? "Turn it off" : "Turn it on", "control");
    }
    add("Show Activity", "Show activity");
    add("Health", "Is it working?");
    if (/off|inactive|closed/.test(state)) add("Create Schedule", "Create schedule");
    else add("Energy", "Show energy usage");
    add("Automation", "Create automation");
    add("Relationships", "What controls you?");
  } else if (object.object_type === "room" || object.object_type === "zone") {
    add("Active Devices", "What is on?");
    add("Turn Off Room", "Turn everything off", "control");
    add("Occupancy", "Is it occupied?");
    add("Activity", "What happened here today?");
  } else if (object.object_type === "visitor" || object.object_type === "access_pass") {
    add("Status", "Who is this?");
    add("Approve", "Approve this visitor", "approval");
    add("Extend", "Extend access by 30 minutes", "approval");
    add("History", "Has this visitor been here before?");
  } else if (object.object_type === "maintenance_request") {
    add("Status", "Why is this delayed?");
    add("Assignee", "Who is handling it?");
    add("Escalate", "Escalate it", "approval");
    add("History", "Show history");
  } else if (object.object_type === "wallet" || object.object_type === "transaction") {
    add("Status", object.object_type === "transaction" ? "Did this payment enter?" : "Show balance");
    add("Receipt", "Show receipt");
    add("History", "Show transactions");
  } else if (object.object_type === "service_account" || object.object_type === "meter") {
    add("Tariff", "What is my tariff?");
    add("Vending", "Can I buy electricity?");
    add("Transactions", "Show the last transaction");
  } else if (object.object_type === "camera") {
    add("Live State", "Is this camera working?");
    add("Events", "Show recent events");
    add("Diagnose", "Check connection");
  } else if (object.object_type === "scene") {
    add("Run Scene", "Run this scene", "control");
    add("Devices", "What devices do you control?");
    add("History", "When did this last run?");
  } else if (object.object_type === "automation") {
    add("Status", "Is this automation active?");
    add("History", "Show recent runs");
    add("Edit", "Change this automation", "approval");
  } else {
    add("Status", "What is happening?");
    add("Activity", "Show activity");
    add("Relationships", "What depends on this?");
    add("Evidence", "Show evidence");
  }
  return actions.slice(0, 6);
}

function isReadOnlyBroadDeviceIntent(message: string) {
  return /\b(show|list|which|what|check|find)\b[\s\S]{0,40}\b(offline|unavailable|down|failed)\b[\s\S]{0,30}\bdevices?\b/i.test(message)
    || /\b(show|list|which)\b[\s\S]{0,40}\bdevices?\b[\s\S]{0,30}\b(offline|unavailable|down|failed)\b/i.test(message);
}

function isExplicitBroadHomeReadIntent(message: string, scopeHint?: string | null) {
  const lower = message.toLowerCase();
  if (isReadOnlyBroadDeviceIntent(message)) return true;
  if (/\b(this|selected|current)\b[\s\S]{0,20}\b(device|channel|switch|tv|remote|light|socket|plug)\b/i.test(lower)) return false;
  if (/\b(channel|gang|switch)\s*[123]\b/i.test(lower)) return false;
  if (/\bfor\s+this\s+(device|channel|switch|tv|remote|light|socket|plug)\b/i.test(lower)) return false;
  if (/\bwhat(?:'s| is) happening\b[\s\S]{0,24}\b(home|house|apartment|unit)\b/i.test(lower)) return true;
  if (/\bwhat changed recently\b/i.test(lower)) return true;
  if (/\brecent changes\b[\s\S]{0,24}\b(home|house|apartment|unit)\b/i.test(lower)) return true;
  if (/\bwhat needs attention\b/i.test(lower)) return true;
  if (/\bis everything okay\b/i.test(lower)) return true;
  if (/\b(home|house|apartment|unit)\b[\s\S]{0,24}\b(report|summary|recent|changed|changes|offline|unavailable)\b/i.test(lower)) return true;
  if (/\b(show|list|check|find)\b[\s\S]{0,24}\b(all|home|house)\b[\s\S]{0,24}\b(devices|changes|activity|issues)\b/i.test(lower)) return true;
  return false;
}

function currentTurnExplicitlyGlobal(message: string) {
  const normalized = normalizeLookupText(message);
  return /\b(what can you do|what can u do|help me understand oyi|^help\b|what should i (?:check|cheek) first\??$|what needs attention overall|is everything okay at home)\b/i.test(text(message))
    || ["what can you do", "what can u do", "what should i check first", "what should i cheek first"].includes(normalized);
}

function currentTurnHasExplicitDomain(message: string) {
  return Boolean(domainForCurrentTurn(message));
}

function domainForCurrentTurn(message: string) {
  const lower = text(message).toLowerCase();
  if (/\b(wallet|balance|dues|payments?|transactions?|histry|history)\b/i.test(lower) && /\b(wallet|transactions?|payments?|balance|dues|histry|history)\b/i.test(lower)) return "wallet";
  if (/\b(utilities|utility|electricity|power|water|internet|gas)\b/i.test(lower)) return "utilities";
  const matched = MODULE_DOMAIN_ALIASES.find((entry) => entry.pattern.test(message));
  return matched?.domain || null;
}

function operationForCurrentTurn(message: string) {
  const lower = text(message).toLowerCase();
  if (/^\s*(open|go to|take me to)\b/i.test(lower)) return "navigate";
  if (/\bhow much\b[\s\S]{0,50}\b(spent|spend|paid|pay)\b/i.test(lower)) return "summarize";
  if (/\bwhat should i (?:check|cheek) first\b|\bwhat needs attention\b/i.test(lower)) return "recommend";
  if (/\bwhat can (?:you|u) do\b|\bcapabilit|^help\b/i.test(lower)) return "inform";
  if (/\b(show|list|view)\b/i.test(lower)) return "list";
  if (/\bwhat(?:'s| is) happening|summary|everything okay\b/i.test(lower)) return "summarize";
  if (isControlRequest(message)) return "execute";
  return "inform";
}

function currentTurnAllowsDeviceResolution(message: string) {
  const lower = text(message).toLowerCase();
  const domain = domainForCurrentTurn(message);
  if (domain && domain !== "devices") return false;
  if (currentTurnExplicitlyGlobal(message)) return false;
  if (roomPhraseFromMessage(message)) return false;
  if (/\b(wallet|transactions?|utilities|utility|electricity|water|internet|services?|visitors?|maintenance|scenes?|automations?)\b/i.test(lower)) return false;
  return isControlRequest(message)
    || /\b(device|channel|switch|socket|plug|light|lamp|tv|remote|ac|fan)\b/i.test(lower)
    || currentTurnReferencesInheritedTarget(message);
}

function resolveCurrentTurnAuthorityDecision(input: CanonicalConversationRequest, inherited: ObjectCandidate | null, options: { roomPhrase: string; broadReadOnlyDeviceIntent: boolean; semanticOperation: ReturnType<typeof interpretSemanticOperation> | null }): CurrentTurnAuthorityDecision {
  const message = text(input.message);
  const domain = domainForCurrentTurn(message);
  const operation = options.semanticOperation?.operationClass || operationForCurrentTurn(message);
  const explicitRoomPhrase = options.roomPhrase || null;
  const explicitObjectPhrase = namedDevicePhraseFromControlMessage(message);
  let scope: ScopeMode = "global_scope";
  if (options.broadReadOnlyDeviceIntent || domain === "utilities" || domain === "wallet" || currentTurnExplicitlyGlobal(message)) scope = "home_scope";
  if (explicitRoomPhrase) scope = "room_scope";
  if (options.semanticOperation?.scopeMode) scope = options.semanticOperation.scopeMode;
  const inheritedType = inherited?.object_type || null;
  const explicitChannelReplacement = Boolean(requestedChannelCode(message) && isControlRequest(message) && inherited && ["device", "device_channel"].includes(inherited.object_type));
  const hasBlockingCurrentTurnSemantics = Boolean(options.broadReadOnlyDeviceIntent || explicitRoomPhrase || options.semanticOperation || currentTurnExplicitlyGlobal(message) || (domain && domain !== "devices"));
  const mayUseInheritedExactTarget = Boolean(
    inherited
      && ["device", "device_channel"].includes(inherited.object_type)
      && !hasBlockingCurrentTurnSemantics
      && (currentTurnReferencesInheritedTarget(message) || explicitChannelReplacement),
  );
  return {
    operation,
    domain,
    scope,
    explicitRoomPhrase,
    explicitObjectPhrase,
    temporalScope: temporalScopeFor(message).mode,
    mayUseInheritedExactTarget,
    rejectionReason: inheritedType && !mayUseInheritedExactTarget
      ? hasBlockingCurrentTurnSemantics
        ? domain && domain !== "devices" ? `explicit_${domain}_domain` : explicitRoomPhrase ? "explicit_room_scope" : options.semanticOperation ? "explicit_domain_or_navigation" : "global_or_home_turn"
        : "not_referential"
      : null,
  };
}

function currentTurnReferencesInheritedTarget(message: string) {
  return /\b(it|this|that|same one|same device|same channel|this device|this channel|selected device|selected channel|current device|current channel|its)\b/i.test(text(message));
}

function pendingClarificationFromThread(context: Awaited<ReturnType<typeof loadOyiConversationContext>>): PendingClarification | null {
  const workflow = recordOf(context.state.active_workflow);
  const pending = recordOf(workflow.pending_clarification || workflow.clarification);
  if (!Object.keys(pending).length) return null;
  const expires = text(pending.expires_at);
  if (expires && Date.parse(expires) < Date.now()) return null;
  const candidates = Array.isArray(pending.candidates) ? pending.candidates.map(recordOf) : [];
  return {
    clarification_id: text(pending.clarification_id) || randomUUID(),
    thread_id: text(pending.thread_id),
    original_user_message: text(pending.original_user_message),
    operation: text(pending.operation) || "clarify",
    domain: text(pending.domain) || "devices",
    requested_action: text(pending.requested_action) || null,
    requested_state: text(pending.requested_state) || null,
    requested_phrase: text(pending.requested_phrase) || null,
    candidate_ids: Array.isArray(pending.candidate_ids) ? pending.candidate_ids.map(text).filter(Boolean) : candidates.map((candidate) => text(candidate.device_id || candidate.id)).filter(Boolean),
    candidates,
    selected_candidate_id: text(pending.selected_candidate_id) || null,
    unresolved_fields: Array.isArray(pending.unresolved_fields) ? pending.unresolved_fields.map(text).filter(Boolean) : [],
    created_at: text(pending.created_at) || new Date().toISOString(),
    expires_at: expires || null,
  };
}

function userCancelledClarification(message: string) {
  return /^(never mind|cancel|stop|forget it|no)$/i.test(text(message));
}

function matchPendingClarificationCandidate(pending: PendingClarification, message: string) {
  const normalized = normalizeLookupText(message);
  if (!normalized) return null;
  return pending.candidates.find((candidate) => {
    const id = normalizeLookupText(candidate.device_id || candidate.id);
    const label = normalizeLookupText(candidate.label || candidate.title || candidate.name);
    const room = normalizeLookupText(candidate.room_label || candidate.room || candidate.detail);
    const channel = normalizeLookupText(candidate.channel_code);
    return normalized === id
      || (label && (normalized === label || label.includes(normalized) || normalized.includes(label)))
      || (room && label && normalized.includes(room) && normalized.split(" ").some((token) => label.includes(token)))
      || (channel && normalized.includes(channel));
  }) || null;
}

function pendingClarificationWorkflow(contract: IntelligenceRequestContract): PendingClarification | null {
  if (contract.scope_mode !== "clarification" || !contract.ambiguity?.required) return null;
  return {
    clarification_id: randomUUID(),
    thread_id: contract.thread_id || "",
    original_user_message: "",
    operation: contract.operation_class,
    domain: contract.intent === "device_control" ? "devices" : domainForResolvedTurn(contract, null) || "devices",
    requested_action: text(contract.mutation.command) || null,
    requested_state: text(contract.mutation.desired_state) || null,
    requested_phrase: text(contract.target.label) || null,
    candidate_ids: (contract.ambiguity.candidates || []).map((candidate) => text(candidate.device_id || candidate.id)).filter(Boolean),
    candidates: contract.ambiguity.candidates || [],
    selected_candidate_id: null,
    unresolved_fields: ["target"],
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

function buildClarificationContinuationResponse(input: CanonicalConversationRequest, pending: PendingClarification, selected: Record<string, unknown>) {
  const label = cleanLabel(selected.label || selected.title || selected.name, "the selected device");
  const channel = text(selected.channel_code);
  const state = text(pending.requested_state || requestedPowerState(pending.original_user_message) || requestedPowerState(input.message));
  const needsChannel = pending.domain === "devices" && !channel && /light|switch|gang/i.test(`${pending.requested_phrase} ${label}`) && !/\bchannel\s*[123]\b/i.test(label);
  const actionText = state === "on" ? "turn on" : state === "off" ? "turn off" : text(pending.requested_action) || "continue";
  const question = needsChannel ? `Which channel should I ${actionText} on ${label}?` : `I found ${label}${channel ? `, ${channel.replace(/^switch_/i, "Channel ")}` : ""}. Confirm to ${actionText}.`;
  return {
    id: `oyi-runtime:${randomUUID()}`,
    thread_id: text(input.thread_id) || pending.thread_id || randomUUID(),
    intent: "device_control",
    understood: `Resolved clarification for ${label}.`,
    message: question,
    reply: question,
    display_mode: "detail" as const,
    confidence: 0.8,
    execution: {
      status: needsChannel ? "clarification_required" : "pending_confirmation",
      current_turn_execution: false,
      pending_clarification: needsChannel ? { ...pending, selected_candidate_id: text(selected.device_id || selected.id), unresolved_fields: ["channel"] } : null,
      target_id: text(selected.device_id || selected.id),
      channel_code: channel || null,
      desired_state: state || null,
    },
    sources: [],
    cards: [],
    suggested_actions: needsChannel ? [
      { type: "clarification_choice", label: "Channel 1", value: "switch_1" },
      { type: "clarification_choice", label: "Channel 2", value: "switch_2" },
      { type: "clarification_choice", label: "Channel 3", value: "switch_3" },
    ] : [],
    confirmations: needsChannel ? [] : [{
      type: "device_command_confirmation",
      target_id: text(selected.device_id || selected.id),
      target_type: channel ? "device_channel" : "device",
      label,
      channel_code: channel || null,
      command: state || null,
      desired_state: state || null,
      risk: "device_control",
    }],
    canonical_request_contract: null,
    resolved_turn: {
      rawMessage: text(input.message),
      intent: "device_control",
      operation: needsChannel ? "clarify" : "control",
      scope: needsChannel ? "ambiguous" : "exact_object",
      domain: "devices",
      object: { type: channel ? "device_channel" : "device", id: text(selected.device_id || selected.id), label, channel_code: channel || null },
      destination: null,
      ambiguity: { required: needsChannel, question, candidates: [] },
      authority: { allowed: true, required_permission: "devices.control", confirmation_required: !needsChannel, secure_review_required: false, denial_reason: null },
      presentation: { mode: needsChannel ? "clarification" : "approval" },
      temporal_scope: temporalScopeFor(input.message),
      confidence: 0.8,
    },
    presentation_policy: needsChannel
      ? { intent: "device_control", operation: "clarify", primary: "clarification", allowed_supporting_blocks: ["clarification"], allowed_action_types: ["clarification_choice"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "hidden", snapshot_mode: "none", auto_navigation: false }
      : { intent: "device_control", operation: "control", primary: "approval", allowed_supporting_blocks: ["approval", "command_result"], allowed_action_types: ["approval", "cancel"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "none", auto_navigation: false },
    facts: [],
  };
}

function canInheritedExactTargetSatisfyCurrentTurn(input: CanonicalConversationRequest, inherited: ObjectCandidate | null, options: { roomPhrase: string; broadReadOnlyDeviceIntent: boolean; semanticOperation: ReturnType<typeof interpretSemanticOperation> | null }) {
  if (!inherited || !["device", "device_channel"].includes(inherited.object_type)) return false;
  const authority = resolveCurrentTurnAuthorityDecision(input, inherited, options);
  if (!authority.mayUseInheritedExactTarget) return false;
  const message = text(input.message);
  const scopeHint = text(input.scope_mode_hint || recordOf(input.conversation_context).scope_mode_hint || recordOf(input.context).scope_mode_hint).toLowerCase();
  const intentHint = text(input.intent_hint || recordOf(input.conversation_context).intent_hint || recordOf(input.context).intent_hint).toLowerCase();
  if (options.broadReadOnlyDeviceIntent || options.roomPhrase || currentTurnExplicitlyGlobal(message) || options.semanticOperation) return false;
  if (currentTurnReferencesInheritedTarget(message)) return true;
  if (currentTurnHasExplicitDomain(message)) return false;
  if (scopeHint === "exact_target" && ["activity_history", "failure_history", "diagnosis", "relationships", "evidence", "current_state", "health_check", "command_outcome", "capability"].includes(intentHint)) return true;
  return false;
}

export function canonicalInheritedTargetEligibilityForTest(input: { message: string; object?: Record<string, unknown> | null; request?: Partial<CanonicalConversationRequest> }) {
  const request = {
    message: input.message,
    surface: "consumer",
    ...(input.request || {}),
  } as CanonicalConversationRequest;
  return canInheritedExactTargetSatisfyCurrentTurn(request, input.object as ObjectCandidate | null, {
    roomPhrase: roomPhraseFromMessage(input.message),
    broadReadOnlyDeviceIntent: isReadOnlyBroadDeviceIntent(input.message),
    semanticOperation: interpretSemanticOperation(input.message),
  });
}

export function canonicalCurrentTurnAuthorityForTest(input: { message: string; object?: Record<string, unknown> | null; request?: Partial<CanonicalConversationRequest> }) {
  const request = {
    message: input.message,
    surface: "consumer",
    ...(input.request || {}),
  } as CanonicalConversationRequest;
  const roomPhrase = roomPhraseFromMessage(input.message);
  return resolveCurrentTurnAuthorityDecision(request, input.object as ObjectCandidate | null, {
    roomPhrase,
    broadReadOnlyDeviceIntent: isExplicitBroadHomeReadIntent(input.message, text(input.request?.scope_mode_hint)),
    semanticOperation: interpretSemanticOperation(input.message),
  });
}

function requestedChannelCode(message: string) {
  const match = message.match(/\b(?:channel|gang|switch)\s*([123])\b/i);
  return match ? `switch_${match[1]}` : null;
}

function namedDevicePhraseFromControlMessage(message: string) {
  if (!isControlRequest(message)) return null;
  if (/\b(it|this|that|this channel|that device|same device|same channel)\b/i.test(message)) return null;
  if (requestedChannelCode(message) && !/\b(light|switch|socket|tv|ac|fan|lamp|plug|outlet|controller|device)\b/i.test(message)) return null;
  let phrase = text(message)
    .replace(/^\s*(please\s+)?(?:turn|switch|power|set)\s+/i, "")
    .replace(/\b(on|off|up|down)\b/ig, " ")
    .replace(/\b(the|my|a|an|to)\b/ig, " ")
    .replace(/[.?!]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!phrase || /^channel\s*[123]$/i.test(phrase)) return null;
  return phrase.length >= 3 ? phrase : null;
}

function roomPhraseFromMessage(message: string) {
  const match = text(message).match(/\b(?:in|inside|for|open|view|show|to)\s+(?:the\s+)?((?:ochiga(?:'s)?\s+)?(?:(?:second|first|third)\s+)?(?:bedroom|room|living room|sitting room|kitchen|bathroom|parlor|lounge|office|study|garage|balcony|dining room)\s*[a-z0-9-]*)\b/i);
  return match?.[1] ? cleanLabel(match[1], "") : "";
}

function deviceFamilyFromRow(row: Record<string, unknown>) {
  return text(row.category || row.type || recordOf(row.metadata).device_family || recordOf(row.metadata).family || "device");
}

function scoreDeviceCandidate(phrase: string, row: Record<string, unknown>, roomLabel: string | null, channelCode: string | null) {
  const normalizedPhrase = normalizeLookupText(phrase);
  const name = normalizeLookupText(row.name || recordOf(row.metadata).display_name || recordOf(row.metadata).label);
  const aliases = arrayOfStrings(recordOf(row.metadata).aliases).map(normalizeLookupText);
  const family = normalizeLookupText(deviceFamilyFromRow(row));
  const room = normalizeLookupText(roomLabel || recordOf(row.metadata).room_name || recordOf(row.metadata).roomName);
  const channel = normalizeLookupText(channelCode);
  let score = 0;
  if (name && normalizedPhrase === name) score += 1;
  if (aliases.includes(normalizedPhrase)) score += 0.95;
  if (name && (name.includes(normalizedPhrase) || normalizedPhrase.includes(name))) score += 0.65;
  if (room && normalizedPhrase.includes(room)) score += 0.35;
  if (family && normalizedPhrase.includes(family)) score += 0.25;
  if (/\blight|lamp\b/i.test(normalizedPhrase) && /\blight|switch|socket|plug\b/i.test(family)) score += 0.25;
  if (/\btv|television\b/i.test(normalizedPhrase) && /\btv|ir|remote\b/i.test(`${family} ${name}`)) score += 0.35;
  if (channel && normalizedPhrase.includes(channel)) score += 0.2;
  const tokens = normalizedPhrase.split(" ").filter(Boolean);
  const haystack = `${name} ${room} ${family} ${aliases.join(" ")}`;
  const matchedTokens = tokens.filter((token) => haystack.includes(token)).length;
  if (tokens.length) score += Math.min(0.35, matchedTokens / tokens.length * 0.35);
  return Math.min(1, score);
}

async function resolveNamedDeviceForRead(actor: AuthUser | null, oisContext: OisContext | null | undefined, input: CanonicalConversationRequest, phrase: string): Promise<DeviceResolutionResult> {
  const scope = currentScope(input, oisContext);
  if (!scope.home_id) return { status: "not_found", phrase };
  try {
    const { data, error } = await supabaseAdmin
      .from("devices")
      .select("id,name,home_id,room_id,category,type,capabilities,metadata")
      .eq("home_id", scope.home_id)
      .limit(100);
    if (error) throw error;
    const roomIds = Array.from(new Set((data || []).map((device: any) => text(device.room_id)).filter(Boolean)));
    const rooms = roomIds.length ? await supabaseAdmin.from("rooms").select("id,name").in("id", roomIds) : { data: [], error: null };
    const roomById = new Map((rooms.data || []).map((row: any) => [String(row.id), cleanLabel(row.name, "")]));
    const requestedChannel = requestedChannelCode(input.message);
    const candidates = (data || [])
      .map((row: any) => {
        const roomLabel = roomById.get(String(row.room_id)) || text(recordOf(row.metadata).room_name || recordOf(row.metadata).roomName) || null;
        const channelCode = requestedChannel || null;
        return {
          row,
          roomLabel,
          channelCode,
          score: scoreDeviceCandidate(phrase, row, roomLabel, channelCode),
        };
      })
      .filter((candidate) => candidate.score >= 0.58)
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) return { status: "not_found", phrase };
    const top = candidates[0];
    const tied = candidates.filter((candidate) => Math.abs(candidate.score - top.score) < 0.08);
    if (tied.length > 1) {
      return {
        status: "ambiguous",
        phrase,
        candidates: tied.slice(0, 5).map((candidate) => ({
          device_id: String(candidate.row.id),
          label: cleanLabel(candidate.row.name, "Device"),
          room_label: candidate.roomLabel,
          device_family: deviceFamilyFromRow(candidate.row),
          channel_code: candidate.channelCode,
        })),
      };
    }
    return {
      status: "resolved",
      device_id: String(top.row.id),
      channel_code: top.channelCode,
      label: cleanLabel(top.row.name, "Device"),
      room_id: text(top.row.room_id) || null,
      confidence: top.score,
    };
  } catch (error) {
    logger.warn("conversation_named_device_resolution_failed", { error, phrase, home_id: scope.home_id, actor_id: actor?.id || null });
    return { status: "not_found", phrase };
  }
}

function scoreRoomCandidate(phrase: string, row: Record<string, unknown>) {
  const normalizedPhrase = normalizeLookupText(phrase).replace(/\bsecond\b/g, "2").replace(/\bfirst\b/g, "1");
  const name = normalizeLookupText(row.name || recordOf(row.metadata).label).replace(/\bsecond\b/g, "2").replace(/\bfirst\b/g, "1");
  const aliases = arrayOfStrings(recordOf(row.metadata).aliases).map((item) => normalizeLookupText(item).replace(/\bsecond\b/g, "2").replace(/\bfirst\b/g, "1"));
  if (!normalizedPhrase || !name) return 0;
  let score = 0;
  if (normalizedPhrase === name) score += 1;
  if (aliases.includes(normalizedPhrase)) score += 0.95;
  if (name.includes(normalizedPhrase) || normalizedPhrase.includes(name)) score += 0.68;
  const tokens = normalizedPhrase.split(" ").filter(Boolean);
  const matchedTokens = tokens.filter((token) => `${name} ${aliases.join(" ")}`.includes(token)).length;
  if (tokens.length) score += Math.min(0.25, matchedTokens / tokens.length * 0.25);
  return Math.min(1, score);
}

async function resolveRoomForRead(actor: AuthUser | null, oisContext: OisContext | null | undefined, input: CanonicalConversationRequest, phrase: string): Promise<RoomResolutionResult> {
  const scope = currentScope(input, oisContext);
  if (!scope.home_id) return { status: "not_found", phrase };
  try {
    const { data, error } = await supabaseAdmin
      .from("rooms")
      .select("id,name,home_id,metadata")
      .eq("home_id", scope.home_id)
      .limit(80);
    if (error) throw error;
    const candidates = (data || [])
      .map((row: any) => ({ row, score: scoreRoomCandidate(phrase, row) }))
      .filter((candidate) => candidate.score >= 0.58)
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) return { status: "not_found", phrase };
    const top = candidates[0];
    const tied = candidates.filter((candidate) => Math.abs(candidate.score - top.score) < 0.08);
    if (tied.length > 1) {
      return { status: "ambiguous", phrase, candidates: tied.slice(0, 5).map((candidate) => ({ room_id: String(candidate.row.id), label: cleanLabel(candidate.row.name, "Room") })) };
    }
    return { status: "resolved", room_id: String(top.row.id), label: cleanLabel(top.row.name, "Room"), confidence: top.score };
  } catch (error) {
    logger.warn("conversation_room_resolution_failed", { error, phrase, home_id: scope.home_id, actor_id: actor?.id || null });
    return { status: "not_found", phrase };
  }
}

type OperationClass =
  | "read"
  | "report"
  | "recommend"
  | "list"
  | "navigate"
  | "propose_mutation"
  | "confirm_mutation"
  | "execute_mutation"
  | "compose"
  | "approve"
  | "reject"
  | "cancel"
  | "handoff"
  | "continue_workflow"
  | "clarify";

type CanonicalIntent =
  | "information"
  | "capability"
  | "current_state"
  | "health_check"
  | "recent_changes"
  | "activity_history"
  | "failure_history"
  | "explanation"
  | "investigation"
  | "diagnosis"
  | "relationships"
  | "device_availability_inventory"
  | "home_operational_summary"
  | "evidence"
  | "comparison"
  | "trend"
  | "forecast"
  | "recommendation"
  | "report"
  | "device_control"
  | "scene_execution"
  | "automation_operation"
  | "visitor_operation"
  | "access_operation"
  | "maintenance_operation"
  | "wallet_operation"
  | "service_operation"
  | "community_operation"
  | "notification_operation"
  | "configuration_operation"
  | "general_help"
  | "command_outcome"
  | "module_navigation"
  | "domain_list";

type ScopeMode =
  | "exact_target"
  | "room_scope"
  | "home_scope"
  | "building_scope"
  | "estate_scope"
  | "explicit_broad_scope"
  | "thread_scope"
  | "global_scope"
  | "clarification";

export type IntelligenceRequestContract = {
  conversation_request_id: string;
  thread_id: string | null;
  surface: OyiSurface;
  operation_class: OperationClass;
  intent: CanonicalIntent;
  scope_mode: ScopeMode;
  temporal_scope: {
    mode: "current" | "recent" | "today" | "yesterday" | "custom" | "historical" | "forecast";
    from: string | null;
    to: string | null;
  };
  target: {
    object_type: string | null;
    canonical_id: string | null;
    parent_id: string | null;
    channel_code: string | null;
    label: string | null;
  };
  mutation: {
    requested: boolean;
    confirmed: boolean;
    command: string | null;
    desired_state: unknown;
    risk_class: string | null;
  };
  evidence_requirements: {
    current_state: boolean;
    recent_events: boolean;
    execution_history: boolean;
    audit_history: boolean;
    relationships: boolean;
    permissions: boolean;
    provider_state: boolean;
    financial_ledger: boolean;
    access_records: boolean;
  };
  answer_builder: string;
  report_builder: string | null;
  truth_policy: string;
  confidence: number;
  ambiguity?: {
    required: boolean;
    reason: "ambiguous" | "not_found" | null;
    question: string | null;
    candidates: Array<Record<string, unknown>>;
  };
};

type ConversationOperation =
  | "inform"
  | "inspect"
  | "list"
  | "navigate_module"
  | "navigate_object"
  | "compose"
  | "control"
  | "approve"
  | "reject"
  | "cancel"
  | "handoff"
  | "clarify";

type ConversationPresentationPolicy = {
  intent: string;
  operation: string;
  primary: "sentence" | "text" | "status" | "table" | "summary_card" | "object_card" | "clarification" | "approval" | "navigation_transition" | "handoff" | "error";
  allowed_supporting_blocks: string[];
  allowed_action_types: string[];
  suppress_awareness: boolean;
  suppress_equivalent_awareness: boolean;
  suppress_context_chips: boolean;
  suppress_duplicate_status: boolean;
  evidence_visibility: "hidden" | "collapsed" | "visible";
  snapshot_mode: "none" | "historical" | "current_state_snapshot";
  auto_navigation: boolean;
};

type ResolvedConversationTurn = {
  rawMessage: string;
  intent: string;
  operation: ConversationOperation;
  scope: "exact_object" | "room" | "home" | "building" | "module" | "thread_reference" | "ambiguous";
  domain: string | null;
  object: {
    type: string;
    id: string;
    label: string | null;
    parent_id?: string | null;
    room_id?: string | null;
    channel_code?: string | null;
  } | null;
  destination: { key: string; parameters: Record<string, string> } | null;
  ambiguity: {
    required: boolean;
    question: string | null;
    candidates: Array<{ type: string; id: string; label: string; detail?: string | null }>;
  };
  authority: {
    allowed: boolean;
    required_permission: string | null;
    confirmation_required: boolean;
    secure_review_required: boolean;
    denial_reason: string | null;
  };
  presentation: { mode: ConversationPresentationPolicy["primary"] };
  temporal_scope: TurnInterpretation["temporalScope"];
  confidence: number;
};

type ResolvedOyiTurn = {
  request_id: string;
  thread_id: string;
  operation: string;
  domain: string | null;
  capability_key: string;
  scope: {
    estate_id: string | null;
    building_id: string | null;
    home_id: string | null;
    room_id: string | null;
  };
  target: CanonicalTarget | null;
  target_source:
    | "current_turn"
    | "active_workflow"
    | "valid_reference"
    | "page_context"
    | "thread_memory"
    | "authorised_fallback";
  temporal_scope: IntelligenceRequestContract["temporal_scope"] | null;
  authority: AuthorityDecision;
  workflow_id: string | null;
  presentation_policy: ConversationPresentationPolicy;
};

export type TurnInterpretation = {
  rawMessage: string;
  intent: CanonicalIntent;
  operationClass: OperationClass;
  requestedScope: ScopeMode;
  explicitObjectReferences: Array<{
    objectType: string | null;
    objectId: string | null;
    objectName: string | null;
    parentId: string | null;
    channelCode: string | null;
    sourceText: string;
    confidence: number;
  }>;
  pronounReference: {
    used: boolean;
    phrase: string | null;
    resolvedFrom: "thread_memory" | "page_launch" | null;
  };
  temporalScope: IntelligenceRequestContract["temporal_scope"];
  desiredPresentation: "sentence" | "status" | "list" | "table" | "detail" | "report" | "handoff";
  requiresLiveEvidence: boolean;
  requiresConfirmation: boolean;
  interpretationSource: string;
  confidence: number;
};

export type ConversationContextLayers = {
  pageLaunchContext: Record<string, unknown> | null;
  threadMemoryContext: Record<string, unknown> | null;
  currentTurnInterpretation: TurnInterpretation;
  liveEvidenceContext: Record<string, unknown> | null;
};

export type IntelligenceFact = {
  fact_id: string;
  domain: string;
  fact_type: string;
  scope: Record<string, string | null>;
  object: {
    object_type: string;
    canonical_id: string;
    label: string;
  } | null;
  statement: string;
  value: unknown;
  previous_value: unknown;
  occurred_at: string | null;
  observed_at: string;
  source_type: "live_state" | "database" | "execution_ledger" | "audit" | "event" | "calculation" | "prediction";
  source_id: string | null;
  truth_state: TruthState;
  confidence: number | null;
  freshness: string;
  privacy_class: string;
  permissions: string[];
  evidence: Array<Record<string, unknown>>;
};

type ConversationTableBlock = {
  type: "table";
  title?: string | null;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null>>;
  compact?: boolean;
  snapshot?: Record<string, string | null>;
};

function parseDeviceChannelIdentity(canonicalId: string | null | undefined) {
  const raw = text(canonicalId);
  const idx = raw.lastIndexOf(":");
  if (idx <= 0) return { parent_id: null, channel_code: null };
  return { parent_id: raw.slice(0, idx), channel_code: raw.slice(idx + 1) };
}

function temporalScopeFor(message: string): IntelligenceRequestContract["temporal_scope"] {
  const now = new Date();
  if (/\b(this|current)\s+month\b/i.test(message)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { mode: "custom", from: start.toISOString(), to: now.toISOString() };
  }
  if (/\byesterday\b/i.test(message)) {
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return { mode: "yesterday", from: start.toISOString(), to: end.toISOString() };
  }
  if (/\btoday\b/i.test(message)) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { mode: "today", from: start.toISOString(), to: now.toISOString() };
  }
  if (/\brecent|changed|activity|history|last\b/i.test(message)) {
    return { mode: "recent", from: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
  }
  if (/\bforecast|predict|trend\b/i.test(message)) return { mode: "forecast", from: null, to: null };
  return { mode: "current", from: null, to: now.toISOString() };
}

function desiredPresentationFor(intent: CanonicalIntent, scopeMode: ScopeMode): TurnInterpretation["desiredPresentation"] {
  if (intent === "report" || intent === "home_operational_summary") return "report";
  if (intent === "device_availability_inventory" || intent === "activity_history" || intent === "failure_history" || intent === "recent_changes") return "list";
  if (intent === "diagnosis" || intent === "investigation" || intent === "relationships" || intent === "evidence") return "detail";
  if (intent === "current_state" || intent === "health_check") return "status";
  if (scopeMode === "explicit_broad_scope" || scopeMode === "home_scope" || scopeMode === "building_scope") return "report";
  return "sentence";
}

function turnInterpretationFromContract(input: CanonicalConversationRequest, contract: IntelligenceRequestContract, targetResolution: Record<string, unknown>, source: string): TurnInterpretation {
  const message = text(input.message);
  const pronoun = message.match(/\b(it|this|that|this channel|that device|same device|same channel)\b/i);
  const explicitRefs: TurnInterpretation["explicitObjectReferences"] = [];
  if (contract.target.canonical_id || contract.target.label) {
    explicitRefs.push({
      objectType: contract.target.object_type,
      objectId: contract.target.canonical_id,
      objectName: contract.target.label,
      parentId: contract.target.parent_id,
      channelCode: contract.target.channel_code,
      sourceText: text(contract.target.label || contract.target.canonical_id || "current target"),
      confidence: Number(targetResolution.confidence) || contract.confidence || 0.72,
    });
  }
  return {
    rawMessage: message,
    intent: contract.intent,
    operationClass: contract.operation_class,
    requestedScope: contract.scope_mode,
    explicitObjectReferences: explicitRefs,
    pronounReference: {
      used: Boolean(pronoun),
      phrase: pronoun ? pronoun[0] : null,
      resolvedFrom: pronoun ? (source === "thread_state" ? "thread_memory" : "page_launch") : null,
    },
    temporalScope: contract.temporal_scope,
    desiredPresentation: desiredPresentationFor(contract.intent, contract.scope_mode),
    requiresLiveEvidence: contract.evidence_requirements.current_state || contract.evidence_requirements.provider_state,
    requiresConfirmation: contract.mutation.requested || contract.mutation.confirmed,
    interpretationSource: "canonical_backend",
    confidence: contract.confidence || Number(targetResolution.confidence) || 0.72,
  };
}

function genericThreadTitle(title: unknown) {
  return /^(oyi conversation|new conversation|chat|conversation)$/i.test(text(title).trim());
}

function titleFromTurn(message: string, contract: IntelligenceRequestContract, object: OperationalObject | null) {
  const label = cleanLabel(object?.label || contract.target.label, "");
  if (contract.intent === "capability") return label ? `${label} capabilities` : "Oyi capabilities";
  if (contract.intent === "home_operational_summary") return "Home status";
  if (contract.intent === "device_availability_inventory") return "Device availability";
  if (contract.intent === "activity_history") return label ? `${label} activity` : "Activity history";
  if (contract.intent === "failure_history") return label ? `${label} failures` : "Failure history";
  if (contract.intent === "diagnosis" || contract.intent === "investigation") return label ? `${label} investigation` : "Investigation";
  if (contract.intent === "relationships") return label ? `${label} relationships` : "Relationships";
  if (contract.intent === "current_state" || contract.intent === "health_check") return label ? `${label} status` : "Status check";
  const cleaned = cleanLabel(message, "");
  return cleaned ? cleaned.slice(0, 64) : "Oyi conversation";
}

async function currentThreadTitle(threadId: string) {
  if (!isUuid(threadId)) return null;
  const { data, error } = await supabaseAdmin
    .from("oyi_conversation_threads")
    .select("title")
    .eq("id", threadId)
    .maybeSingle();
  if (error) {
    logger.warn("conversation_thread_title_load_failed", { thread_id: threadId, error });
    return null;
  }
  return text(data?.title) || null;
}

function constructBroadScopeObject(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined, contract: IntelligenceRequestContract): OperationalObject | null {
  const scope = currentScope(input, oisContext);
  if (contract.scope_mode === "room_scope" && scope.room_id) {
    return {
      object_type: "room",
      canonical_id: scope.room_id,
      label: text(input.room_name || recordOf(input.context).room_name || recordOf(input.context).roomName) || "Room",
      estate_id: scope.estate_id,
      building_id: text(recordOf(input.context).building_id || recordOf(input.context).buildingId) || null,
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
      label: text(recordOf(input.context).home_name || recordOf(input.context).homeName) || "Home",
      estate_id: scope.estate_id,
      building_id: text(recordOf(input.context).building_id || recordOf(input.context).buildingId) || null,
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
  return null;
}

type OyiDestinationDefinition = {
  key: string;
  domain: string;
  object_type: string | null;
  mode: "module" | "list" | "detail" | "drawer" | "live_view" | "review" | "approval";
  supported_surfaces: OyiSurface[];
  required_parameters: string[];
  required_permission: string | null;
  label: string;
};

const SEMANTIC_DESTINATIONS: Record<string, OyiDestinationDefinition> = {
  "devices.module": { key: "devices.module", domain: "devices", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "devices.read", label: "Devices" },
  "devices.detail": { key: "devices.detail", domain: "devices", object_type: "device", mode: "detail", supported_surfaces: ["consumer", "facility"], required_parameters: ["device_id"], required_permission: "devices.read", label: "Device details" },
  "devices.channel": { key: "devices.channel", domain: "devices", object_type: "device_channel", mode: "detail", supported_surfaces: ["consumer"], required_parameters: ["device_id", "channel_code"], required_permission: "devices.read", label: "Device channel" },
  "visitors.module": { key: "visitors.module", domain: "visitors", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "visitors.read", label: "Visitors" },
  "visitors.detail": { key: "visitors.detail", domain: "visitors", object_type: "visitor", mode: "detail", supported_surfaces: ["consumer", "facility"], required_parameters: ["visitor_id"], required_permission: "visitors.read", label: "Visitor details" },
  "wallet.summary": { key: "wallet.summary", domain: "wallet", object_type: "wallet", mode: "module", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "wallet.read", label: "Wallet" },
  "wallet.transaction": { key: "wallet.transaction", domain: "transactions", object_type: "transaction", mode: "detail", supported_surfaces: ["consumer"], required_parameters: ["transaction_id"], required_permission: "wallet.read", label: "Transaction" },
  "wallet.review": { key: "wallet.review", domain: "wallet", object_type: "wallet", mode: "review", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "wallet.review", label: "Wallet review" },
  "maintenance.module": { key: "maintenance.module", domain: "maintenance", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "maintenance.read", label: "Maintenance" },
  "maintenance.detail": { key: "maintenance.detail", domain: "maintenance", object_type: "maintenance_request", mode: "detail", supported_surfaces: ["consumer", "facility"], required_parameters: ["request_id"], required_permission: "maintenance.read", label: "Maintenance request" },
  "scenes.module": { key: "scenes.module", domain: "scenes", object_type: null, mode: "module", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "scenes.read", label: "Scenes" },
  "scenes.detail": { key: "scenes.detail", domain: "scenes", object_type: "scene", mode: "detail", supported_surfaces: ["consumer"], required_parameters: ["scene_id"], required_permission: "scenes.read", label: "Scene" },
  "automations.module": { key: "automations.module", domain: "automations", object_type: null, mode: "module", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "automations.read", label: "Automations" },
  "automations.detail": { key: "automations.detail", domain: "automations", object_type: "automation", mode: "detail", supported_surfaces: ["consumer"], required_parameters: ["automation_id"], required_permission: "automations.read", label: "Automation" },
  "rooms.module": { key: "rooms.module", domain: "rooms", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "rooms.read", label: "Rooms" },
  "rooms.detail": { key: "rooms.detail", domain: "rooms", object_type: "room", mode: "detail", supported_surfaces: ["consumer", "facility"], required_parameters: ["room_name"], required_permission: "rooms.read", label: "Room" },
  "community.module": { key: "community.module", domain: "community", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "community.read", label: "Community" },
  "services.module": { key: "services.module", domain: "services", object_type: null, mode: "module", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "services.read", label: "Services" },
  "messages.module": { key: "messages.module", domain: "messages", object_type: null, mode: "module", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "messages.read", label: "Messages" },
  "notifications.module": { key: "notifications.module", domain: "notifications", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "notifications.read", label: "Notifications" },
  "security.module": { key: "security.module", domain: "security", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "security.read", label: "Security" },
  "utilities.module": { key: "utilities.module", domain: "utilities", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "utilities.read", label: "Utilities" },
  "cameras.module": { key: "cameras.module", domain: "cameras", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "cameras.read", label: "Cameras" },
  "camera.private_live_view": { key: "camera.private_live_view", domain: "cameras", object_type: "camera", mode: "live_view", supported_surfaces: ["consumer"], required_parameters: ["camera_id"], required_permission: "cameras.private.read", label: "Camera live view" },
  "camera.shared_live_view": { key: "camera.shared_live_view", domain: "cameras", object_type: "camera", mode: "live_view", supported_surfaces: ["facility"], required_parameters: ["camera_id"], required_permission: "cameras.shared.read", label: "Shared camera live view" },
  "incident.detail": { key: "incident.detail", domain: "incidents", object_type: "operational_incident", mode: "detail", supported_surfaces: ["consumer", "facility"], required_parameters: ["incident_id"], required_permission: "incidents.read", label: "Incident" },
  "digital_twin.object": { key: "digital_twin.object", domain: "digital_twin", object_type: "twin_node", mode: "detail", supported_surfaces: ["facility"], required_parameters: ["node_id"], required_permission: "digital_twin.read", label: "Digital twin object" },
};

const MODULE_DOMAIN_ALIASES: Array<{ domain: string; destination: string; pattern: RegExp }> = [
  { domain: "devices", destination: "devices.module", pattern: /\b(devices?|hardware|switches?|sockets?|lights?)\b/i },
  { domain: "visitors", destination: "visitors.module", pattern: /\b(visitors?|guests?|access requests?|passes?)\b/i },
  { domain: "wallet", destination: "wallet.summary", pattern: /\b(wallet|balance|dues|payments?|transactions?)\b/i },
  { domain: "maintenance", destination: "maintenance.module", pattern: /\b(maintenance|repairs?|tickets?|requests?)\b/i },
  { domain: "scenes", destination: "scenes.module", pattern: /\b(scenes?)\b/i },
  { domain: "automations", destination: "automations.module", pattern: /\b(automations?|routines?|schedules?)\b/i },
  { domain: "rooms", destination: "rooms.module", pattern: /\b(rooms?|spaces?)\b/i },
  { domain: "community", destination: "community.module", pattern: /\b(community|announcements?|posts?)\b/i },
  { domain: "services", destination: "services.module", pattern: /\b(services?|vendors?|providers?)\b/i },
  { domain: "messages", destination: "messages.module", pattern: /\b(messages?|chat|inbox)\b/i },
  { domain: "notifications", destination: "notifications.module", pattern: /\b(notifications?|alerts?)\b/i },
  { domain: "security", destination: "security.module", pattern: /\b(security)\b/i },
  { domain: "utilities", destination: "utilities.module", pattern: /\b(utilities|utility|power|water|internet|gas|electricity)\b/i },
  { domain: "cameras", destination: "cameras.module", pattern: /\b(cameras?|cctv)\b/i },
];

function interpretSemanticOperation(message: string) {
  const lower = message.toLowerCase();
  const verb = lower.match(/^\s*(open|go to|take me to|show|list|view)\b/i)?.[1] || "";
  if (!verb) return null;
  if (/^(show|list|view)$/i.test(verb) && roomPhraseFromMessage(message)) return null;
  if (
    isReadOnlyBroadDeviceIntent(message)
    || /\bwhat changed|changed recently|recent changes\b/i.test(lower)
    || /\b(activity|history|failures?|errors?|diagnose|diagnosis|relationships?|what controls|where.*belong)\b/i.test(lower)
    || /\bwhat(?:'s| is) happening\b[\s\S]{0,24}\b(home|house|apartment|unit)\b/i.test(lower)
      || /\bwhat needs attention|is everything okay|home summary|home report\b/i.test(lower)
  ) {
    return null;
  }
  const roomMatch = message.match(/^\s*(open|go to|take me to)\s+(?:the\s+)?((?:(?:second|first|third)\s+)?(?:bedroom|room|living room|kitchen|bathroom|parlor|lounge|office|study|garage|balcony|dining room)\s*[a-z0-9-]*)\b/i);
  if (roomMatch) {
    const roomName = cleanLabel(roomMatch[2], "");
    return {
      intent: "module_navigation" as CanonicalIntent,
      operationClass: "navigate" as OperationClass,
      scopeMode: "room_scope" as ScopeMode,
      answerBuilder: "semantic_navigation",
      domain: "rooms",
      destination: SEMANTIC_DESTINATIONS["rooms.detail"],
      parameters: { room_name: roomName },
    };
  }
  const matched = MODULE_DOMAIN_ALIASES.find((entry) => entry.pattern.test(message));
  if (!matched) return null;
  const destination = SEMANTIC_DESTINATIONS[matched.destination];
  const operationClass: OperationClass = /^open|go to|take me to$/i.test(verb) ? "navigate" : "list";
  return {
    intent: operationClass === "navigate" ? "module_navigation" as CanonicalIntent : "domain_list" as CanonicalIntent,
    operationClass,
    scopeMode: "home_scope" as ScopeMode,
    answerBuilder: operationClass === "navigate" ? "semantic_navigation" : "domain_list",
    domain: matched.domain,
    destination,
    parameters: {},
  };
}

function routeForSemanticDestination(destinationKey: string, surface: OyiSurface) {
  const consumerRoutes: Record<string, string> = {
    "devices.module": "/devices",
    "visitors.module": "/visitors",
    "wallet.summary": "/wallet",
    "maintenance.module": "/maintenance",
    "scenes.module": "/scenes",
    "automations.module": "/scenes?tab=automations",
    "rooms.module": "/rooms",
    "rooms.detail": "/room",
    "community.module": "/community",
    "services.module": "/services",
    "messages.module": "/messages",
    "notifications.module": "/notifications",
    "security.module": "/security",
    "utilities.module": "/utilities",
    "cameras.module": "/security?tab=cameras",
  };
  const facilityRoutes: Record<string, string> = {
    "devices.module": "/devices",
    "visitors.module": "/visitors",
    "maintenance.module": "/maintenance",
    "rooms.module": "/estate",
    "rooms.detail": "/estate",
    "community.module": "/community",
    "notifications.module": "/notifications",
    "security.module": "/security",
    "utilities.module": "/utilities",
    "cameras.module": "/cameras",
  };
  return (surface === "facility" ? facilityRoutes : consumerRoutes)[destinationKey] || "/";
}

function routeWithSemanticParameters(route: string, parameters: Record<string, string>) {
  const entries = Object.entries(parameters).filter(([, value]) => text(value));
  if (!entries.length) return route;
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&")}`;
}

function semanticOperationAction(message: string, surface: OyiSurface) {
  const operation = interpretSemanticOperation(message);
  if (!operation?.destination) return null;
  const allowed = operation.destination.supported_surfaces.includes(surface);
  const route = routeWithSemanticParameters(routeForSemanticDestination(operation.destination.key, surface), recordOf(operation.parameters) as Record<string, string>);
  return {
    operation,
    allowed,
    route,
    action: {
      type: operation.operationClass === "navigate" ? "navigation" : "open_module",
      label: operation.operationClass === "navigate" ? `Open ${operation.destination.label}` : `View ${operation.destination.label}`,
      route,
      destination: {
        key: operation.destination.key,
        domain: operation.destination.domain,
        mode: operation.destination.mode,
        parameters: recordOf(operation.parameters),
      },
      operation_class: operation.operationClass,
      risk: "read",
    },
  };
}

function resolveIntentContract(input: CanonicalConversationRequest, object: OperationalObject | null, targetResolution: Record<string, unknown>): IntelligenceRequestContract {
  const message = text(input.message);
  const lower = message.toLowerCase();
  const hint = text(input.intent_hint || recordOf(input.conversation_context).intent_hint || recordOf(input.context).intent_hint).toLowerCase();
  const operationHint = text(input.operation_class_hint || recordOf(input.conversation_context).operation_class_hint || recordOf(input.context).operation_class_hint).toLowerCase();
  const scopeHint = text(input.scope_mode_hint || recordOf(input.conversation_context).scope_mode_hint || recordOf(input.context).scope_mode_hint).toLowerCase();
  const conversationRequestId = text(recordOf(input.context).request_id || recordOf(input.conversation_context).conversation_request_id) || randomUUID();
  const targetType = text(object?.object_type || targetResolution.objectType) || null;
  const targetId = text(object?.canonical_id || targetResolution.objectId) || null;
  const parsedChannel = targetType === "device_channel" ? parseDeviceChannelIdentity(targetId) : { parent_id: null, channel_code: null };
  const explicitBroad = isExplicitBroadHomeReadIntent(message, scopeHint) || /\b(whole home|all devices|everything|home summary|home report|show offline)\b/i.test(lower);
  const semanticCandidate = interpretSemanticOperation(message);
  const mutationRequested = !semanticCandidate && isControlRequest(message) && !/\b(what happened|why|is|show|list|history|report|recommend|what can|changed|status|working|healthy|evidence|did that work|last command)\b/i.test(lower);
  const requestedChannel = mutationRequested ? requestedChannelCode(message) : null;
  const semanticOperation = !mutationRequested ? semanticCandidate : null;
  const targetAmbiguous = Boolean(targetResolution.ambiguous);
  const targetNotFound = Boolean(targetResolution.notFound);
  let intent: CanonicalIntent = "general_help";
  let operationClass: OperationClass = mutationRequested ? "execute_mutation" : "read";
  if (targetAmbiguous || (targetNotFound && mutationRequested)) {
    intent = targetNotFound ? "device_control" : "general_help";
    operationClass = "clarify";
  } else if (/\bhow much\b[\s\S]{0,60}\b(spent|spend|paid|pay)\b[\s\S]{0,60}\b(utilities|utility|electricity|power|water|internet|gas)\b/i.test(lower)) {
    intent = "wallet_operation";
    operationClass = "report";
  } else if (/\b(show|list|view)\b[\s\S]{0,30}\b(wallet|transaction|transactions|histry|history)\b/i.test(lower) || /\b(show|list|view)\s+wallet\s+history\b/i.test(lower)) {
    intent = /\bhistory|histry|transactions?\b/i.test(lower) ? "wallet_operation" : "domain_list";
    operationClass = "list";
  } else if (semanticOperation) {
    intent = semanticOperation.intent;
    operationClass = semanticOperation.operationClass;
  } else if (["activity_history", "failure_history", "diagnosis", "relationships", "evidence", "current_state", "health_check", "command_outcome", "capability", "device_availability_inventory", "home_operational_summary"].includes(hint)) {
    intent = hint as CanonicalIntent;
    operationClass = "read";
  } else if (isReadOnlyBroadDeviceIntent(message)) {
    intent = "device_availability_inventory";
    operationClass = "report";
  } else if (targetType === "room" && /\bwhat(?:'s| is) happening|needs attention|summary|everything okay\b/i.test(lower)) {
    intent = "home_operational_summary";
    operationClass = "report";
  } else if (targetType === "room" && /\b(show|list|view)\b[\s\S]{0,24}\b(devices?|hardware|lights?|switches?|sockets?)\b/i.test(lower)) {
    intent = "device_availability_inventory";
    operationClass = "list";
  } else if (targetType === "room" && /\bwhat changed|changed recently|recent changes|activity|history\b/i.test(lower)) {
    intent = "recent_changes";
    operationClass = "list";
  } else if (explicitBroad && /\bwhat(?:'s| is) happening|needs attention|home summary|home report|everything okay\b/i.test(lower)) {
    intent = "home_operational_summary";
    operationClass = "report";
  } else if (/\b(report|generate.*report|summary report)\b/i.test(lower)) {
    intent = "report";
    operationClass = "report";
  } else if (/\b(recommend|what should|next step|suggest)\b/i.test(lower)) {
    intent = "recommendation";
    operationClass = "recommend";
  } else if (/\bwhat changed|changed recently|recent changes\b/i.test(lower)) {
    intent = "recent_changes";
  } else if (/\b(last command|what happened to.*command|did that work|did it work|command outcome)\b/i.test(lower)) {
    intent = "command_outcome";
  } else if (/\b(show|view|list|check)\b[\s\S]{0,24}\b(failures?|errors?|timeouts?|rejections?)\b|\bfailures?\b/i.test(lower)) {
    intent = "failure_history";
  } else if (/\b(activity|history|what happened|timeline)\b/i.test(lower)) {
    intent = "activity_history";
  } else if (/\b(diagnose|diagnosis|check connection|investigate)\b/i.test(lower)) {
    intent = "diagnosis";
  } else if (/\b(relationship|relationships|what controls|where.*belong|scene|automation|dependencies)\b/i.test(lower)) {
    intent = "relationships";
  } else if (/\bwhy|explain|reason|investigate|what caused\b/i.test(lower)) {
    intent = /\binvestigate|why\b/i.test(lower) ? "investigation" : "explanation";
  } else if (/\bevidence|how do you know|are you sure|confirmed|last updated\b/i.test(lower)) {
    intent = "evidence";
  } else if (/\bworking|healthy|health|status|online|offline|unavailable|is this|is it|is everything okay\b/i.test(lower)) {
    intent = /\bworking|healthy|health\b/i.test(lower) ? "health_check" : "current_state";
  } else if (/\bwhat can|help|capabilit|controls this|what controls|relationship|scene|automation\b/i.test(lower)) {
    intent = /\bwhat can|help|capabilit\b/i.test(lower) ? "capability" : "capability";
  } else if (mutationRequested && /\brun\b.*\bscene\b/i.test(lower)) {
    intent = "scene_execution";
  } else if (mutationRequested) {
    intent = "device_control";
  }
  if (operationHint === "read") operationClass = "read";
  if (!["execute_mutation", "confirm_mutation", "propose_mutation", "compose", "approve", "reject", "cancel", "handoff", "report", "recommend", "navigate", "list", "clarify"].includes(operationClass)) operationClass = "read";
  const scopeMode: ScopeMode = targetAmbiguous || (targetNotFound && mutationRequested)
    ? "clarification"
    : intent === "wallet_operation"
    ? "home_scope"
    : targetType === "home"
    ? "home_scope"
    : targetType === "room"
    ? "room_scope"
    : scopeHint === "exact_target" && targetType && !explicitBroad
    && !semanticOperation
    ? "exact_target"
    : semanticOperation
    ? semanticOperation.scopeMode
    : explicitBroad
    ? "home_scope"
    : targetType
      ? "exact_target"
      : input.room_id
        ? "room_scope"
        : input.home_id
          ? "home_scope"
          : input.estate_id
            ? "estate_scope"
            : "global_scope";
  const answerBuilder = targetAmbiguous || (targetNotFound && mutationRequested)
    ? "clarification"
    : intent === "wallet_operation" && /\butilities|utility|electricity|power|water|internet|gas\b/i.test(lower)
    ? "utility_spending"
    : intent === "wallet_operation"
    ? "wallet_history"
    : semanticOperation
    ? semanticOperation.answerBuilder
    : intent === "report"
    ? "canonical_report_builder"
    : intent === "home_operational_summary"
      ? "home_operational_summary"
      : intent === "device_availability_inventory"
        ? "device_availability_inventory"
    : intent === "recent_changes" || intent === "activity_history"
      ? "recent_changes"
      : intent === "failure_history"
        ? "failure_history"
        : intent === "diagnosis" || intent === "investigation" || intent === "explanation"
          ? "device_diagnosis"
          : intent === "relationships"
            ? "device_relationships"
      : intent === "command_outcome"
        ? "command_outcome"
        : intent === "health_check"
          ? "device_health"
          : intent === "current_state"
            ? "current_state"
            : intent === "capability"
              ? "capability"
              : intent === "recommendation"
                ? "recommendation"
                : intent === "device_control" || intent === "scene_execution"
                  ? "canonical_action_execution"
                  : "general";
  const targetParentId = object?.parent_id || parsedChannel.parent_id;
  const targetChannelCode = requestedChannel || parsedChannel.channel_code || text(recordOf(object?.metadata).channel_code) || null;
  const targetCanonicalId = requestedChannel && targetParentId
    ? `${targetParentId}:${requestedChannel}`
    : targetId;
  const targetLabel = requestedChannel && object?.label
    ? object.label.replace(/Channel\s+[123]/i, requestedChannel.replace(/^switch_/i, "Channel "))
    : object?.label || text(targetResolution.objectName) || null;
  return {
    conversation_request_id: conversationRequestId,
    thread_id: text(input.thread_id) || null,
    surface: input.surface,
    operation_class: operationClass,
    intent,
    scope_mode: scopeMode,
    temporal_scope: temporalScopeFor(message),
    target: {
      object_type: targetType,
      canonical_id: targetCanonicalId,
      parent_id: targetParentId,
      channel_code: targetChannelCode,
      label: targetLabel,
    },
    mutation: {
      requested: mutationRequested,
      confirmed: /^(yes|yep|confirm|go ahead|do it|continue|execute)$/i.test(message),
      command: requestedPowerState(message) || null,
      desired_state: requestedPowerState(message) || null,
      risk_class: mutationRequested ? "control" : null,
    },
    evidence_requirements: {
      current_state: ["current_state", "health_check", "evidence", "report"].includes(intent),
      recent_events: ["recent_changes", "activity_history", "failure_history", "diagnosis", "investigation", "report"].includes(intent),
      execution_history: ["command_outcome", "recent_changes", "activity_history", "failure_history", "diagnosis", "investigation", "report"].includes(intent),
      audit_history: ["recent_changes", "activity_history", "failure_history", "report"].includes(intent),
      relationships: ["capability", "relationships", "recommendation", "report"].includes(intent),
      permissions: true,
      provider_state: ["current_state", "health_check", "device_control"].includes(intent),
      financial_ledger: ["wallet_operation", "report"].includes(intent),
      access_records: ["visitor_operation", "access_operation", "report"].includes(intent),
    },
    answer_builder: answerBuilder,
    report_builder: intent === "report" || intent === "home_operational_summary" || intent === "device_availability_inventory" ? `${scopeMode}_operational_report` : null,
    truth_policy: operationClass === "execute_mutation" ? "current_turn_execution_required" : "read_only_no_execution",
    confidence: semanticOperation ? 0.92 : Number(targetResolution.confidence) || (explicitBroad ? 0.9 : 0.76),
    ambiguity: targetAmbiguous || (targetNotFound && mutationRequested)
      ? {
        required: true,
        reason: targetNotFound ? "not_found" : "ambiguous",
        question: targetNotFound
          ? `I could not find a device called “${targetLabel || text(targetResolution.objectName) || "that"}” in this home. No command was sent.`
          : text(targetResolution.clarificationQuestion) || `Which ${targetLabel || "device"} do you mean?`,
        candidates: Array.isArray(targetResolution.candidates) ? targetResolution.candidates as Array<Record<string, unknown>> : [],
      }
      : undefined,
  };
}

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  };
}

function deviceFreshnessFromTimestamp(value: unknown) {
  const ts = Date.parse(text(value));
  if (!Number.isFinite(ts)) return { freshness: "unknown", truth_state: "unavailable" as TruthState, age_ms: null as number | null };
  const ageMs = Date.now() - ts;
  if (ageMs <= 2 * 60 * 1000) return { freshness: "fresh", truth_state: "confirmed" as TruthState, age_ms: ageMs };
  if (ageMs <= 15 * 60 * 1000) return { freshness: "stale", truth_state: "observed" as TruthState, age_ms: ageMs };
  return { freshness: "expired", truth_state: "observed" as TruthState, age_ms: ageMs };
}

function canonicalDeviceAvailabilityStatus(input: {
  online: unknown;
  freshness: string;
  providerHealth?: unknown;
}) {
  const provider = text(input.providerHealth).toLowerCase();
  if (["provider_disconnected", "disconnected", "integration_expired", "authentication_failed"].includes(provider)) return "provider_disconnected";
  if (input.freshness === "fresh" && input.online === true) return "online";
  if (input.freshness === "fresh" && input.online === false) return "offline";
  if (input.freshness === "stale") return "stale";
  if (input.freshness === "expired") return "expired";
  return "unknown";
}

async function loadHomeDeviceInventoryFacts(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  const scope = currentScope(input, oisContext);
  if (!scope.home_id) return [];
  try {
    const { data: devices, error: deviceError } = await supabaseAdmin
      .from("devices")
      .select("id,name,estate_id,home_id,room_id,parent_device_id,is_virtual,category,type,online,status,capabilities,metadata,last_seen_at,updated_at")
      .eq("home_id", scope.home_id)
      .limit(100);
	    if (deviceError) throw deviceError;
	    const ids = (devices || []).map((device: any) => String(device.id)).filter(Boolean);
    const roomIds = Array.from(new Set((devices || []).map((device: any) => text(device.room_id)).filter(Boolean)));
    const rooms = roomIds.length
      ? await supabaseAdmin.from("rooms").select("id,name").in("id", roomIds)
      : { data: [], error: null };
    if (rooms.error) logger.warn("conversation_home_room_names_load_failed", { error: rooms.error, home_id: scope.home_id });
    const roomById = new Map((rooms.data || []).map((row: any) => [String(row.id), cleanLabel(row.name, "")]));
	    const states = ids.length
	      ? await supabaseAdmin.from("device_states").select("device_id,status,last_seen,updated_at").in("device_id", ids)
	      : { data: [], error: null };
    if (states.error) throw states.error;
    const stateByDevice = new Map((states.data || []).map((row: any) => [String(row.device_id), row]));
    return (devices || [])
    .filter((device: any) => !scope.room_id || String(device.room_id || "") === String(scope.room_id))
    .map((device: any): IntelligenceFact => {
      const stateRow = stateByDevice.get(String(device.id)) as Record<string, unknown> | undefined;
      const status = recordOf(stateRow?.status || device.status);
	      const normalized = recordOf(status.normalized_state);
	      const onlineValue = status.online ?? normalized.online ?? device.online;
	      const observedAt = stateRow?.last_seen || stateRow?.updated_at || device.last_seen_at || device.updated_at || null;
	      const freshness = deviceFreshnessFromTimestamp(observedAt);
	      const providerHealth = status.provider_health || normalized.provider_health || recordOf(device.metadata).provider_health;
	      const availability = canonicalDeviceAvailabilityStatus({ online: onlineValue, freshness: freshness.freshness, providerHealth });
	      const label = cleanLabel(device.name, "Device");
      const roomName = roomById.get(String(device.room_id)) || text(recordOf(device.metadata).room_name || recordOf(device.metadata).roomName) || null;
	      return {
        fact_id: `home-device:${device.id}`,
        domain: "devices",
        fact_type: "device_availability",
        scope: { estate_id: device.estate_id || scope.estate_id, home_id: device.home_id || scope.home_id, room_id: device.room_id || null },
        object: { object_type: "device", canonical_id: String(device.id), label },
        statement: `${label}: ${availability.replace(/_/g, " ")}.`,
	        value: {
	          availability,
	          online: onlineValue ?? null,
	          category: device.category || null,
          type: device.type || null,
          is_virtual: Boolean(device.is_virtual),
          parent_device_id: device.parent_device_id || null,
          parent_device_name: recordOf(device.metadata).parent_device_name || recordOf(device.metadata).parentDeviceName || null,
          device_family: device.category || device.type || "device",
          room_name: roomName,
          provider_health: providerHealth || null,
	          freshness: freshness.freshness,
	          age_ms: freshness.age_ms,
	        },
        previous_value: null,
        occurred_at: observedAt ? String(observedAt) : null,
        observed_at: new Date().toISOString(),
        source_type: "database",
        source_id: String(device.id),
        truth_state: freshness.truth_state,
        confidence: freshness.freshness === "fresh" ? 0.86 : freshness.freshness === "stale" ? 0.68 : 0.48,
        freshness: freshness.freshness,
        privacy_class: "resident_device_private",
        permissions: ["read"],
        evidence: [{ source: "device_states", device_id: String(device.id), observed_at: observedAt, freshness: freshness.freshness }],
      };
    });
  } catch (error) {
    logger.warn("conversation_home_device_inventory_load_failed", { error, home_id: scope.home_id, estate_id: scope.estate_id });
    return [];
  }
}

async function loadWalletTransactionFacts(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined, contract: IntelligenceRequestContract) {
  const scope = currentScope(input, oisContext);
  if (!scope.home_id) return [];
  try {
    const fromIso = contract.temporal_scope.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id,wallet_id,home_id,user_id,direction,type,amount,reference,status,metadata,created_at,updated_at")
      .eq("home_id", scope.home_id)
      .gte("created_at", fromIso)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map((row: any): IntelligenceFact => {
      const metadata = recordOf(row.metadata);
      const category = text(metadata.category || metadata.service_category || row.type || "wallet");
      const description = cleanLabel(metadata.description || metadata.service_name || metadata.title || row.reference || row.type, "Wallet transaction");
      return {
        fact_id: `wallet-transaction:${row.id}`,
        domain: /electricity|water|internet|utility|power|gas/i.test(`${category} ${description}`) ? "utilities" : "wallet",
        fact_type: "wallet_transaction",
        scope: { estate_id: scope.estate_id, home_id: row.home_id || scope.home_id, room_id: null },
        object: { object_type: "transaction", canonical_id: String(row.id), label: description },
        statement: `${description}: ${row.direction || "transaction"} ${row.amount || 0}.`,
        value: {
          date: row.created_at || row.updated_at || null,
          description,
          type: text(row.type || category) || "transaction",
          direction: text(row.direction) || null,
          amount: Number(row.amount || 0),
          status: text(row.status) || "recorded",
          category,
          reference: text(row.reference) || null,
        },
        previous_value: null,
        occurred_at: row.created_at || row.updated_at || null,
        observed_at: new Date().toISOString(),
        source_type: "database",
        source_id: String(row.id),
        truth_state: "confirmed",
        confidence: 0.9,
        freshness: row.created_at || "historical",
        privacy_class: "resident_home_private",
        permissions: ["wallet.read"],
        evidence: [{ type: "wallet_transactions", id: row.id, status: row.status || null }],
      };
    });
  } catch (error) {
    logger.warn("conversation_wallet_transaction_load_failed", { error, home_id: scope.home_id, estate_id: scope.estate_id });
    return [];
  }
}

function exactTargetLiveReadIntent(contract: IntelligenceRequestContract) {
  return contract.scope_mode === "exact_target"
    && contract.operation_class === "read"
    && ["current_state", "health_check", "diagnosis", "investigation", "evidence"].includes(contract.intent);
}

function parentDeviceIdForContract(contract: IntelligenceRequestContract, object: OperationalObject | null) {
  if (object?.object_type === "device_channel") return object.parent_id || object.canonical_id.split(":")[0];
  if (object?.object_type === "device") return object.canonical_id;
  if (contract.target.object_type === "device_channel" && contract.target.canonical_id) return contract.target.parent_id || contract.target.canonical_id.split(":")[0];
  if (contract.target.object_type === "device" && contract.target.canonical_id) return contract.target.canonical_id;
  return "";
}

async function requestBoundedLiveEvidence(input: {
  contract: IntelligenceRequestContract;
  object: OperationalObject | null;
  conversationTarget: any;
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  activeContext: Record<string, unknown>;
  visibleState: Record<string, unknown> | null;
}) {
  if (!exactTargetLiveReadIntent(input.contract) || !input.object) return null;
  const freshness = text(input.object.freshness).toLowerCase();
  if (freshness === "fresh") return null;
  const deviceId = parentDeviceIdForContract(input.contract, input.object);
  if (!deviceId) return null;
  const startedAt = Date.now();
  logger.info("conversation_live_evidence_requested", {
    conversation_request_id: input.contract.conversation_request_id,
    device_id: deviceId,
    target_id: input.contract.target.canonical_id,
    intent: input.contract.intent,
    existing_freshness: input.object.freshness,
  });
  try {
    const refreshPromise = deviceRuntimeStateService.refresh(deviceId, "high", "conversation_exact_target_live_read");
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800));
    const refreshed = await Promise.race([refreshPromise, timeoutPromise]);
    if (!refreshed) {
      logger.info("conversation_live_evidence_timed_out", {
        conversation_request_id: input.contract.conversation_request_id,
        device_id: deviceId,
        duration_ms: Date.now() - startedAt,
      });
      return null;
    }
    logger.info("conversation_live_evidence_completed", {
      conversation_request_id: input.contract.conversation_request_id,
      device_id: deviceId,
      source: refreshed.source,
      freshness: refreshed.freshness,
      age_ms: refreshed.age_ms,
      duration_ms: Date.now() - startedAt,
    });
    return hydrateCanonicalTarget({
      actor: input.actor,
      oisContext: input.oisContext,
      target: input.conversationTarget,
      activeContext: input.activeContext,
      visibleState: input.visibleState,
    });
  } catch (error) {
    logger.info("conversation_live_evidence_timed_out", {
      conversation_request_id: input.contract.conversation_request_id,
      device_id: deviceId,
      reason: error instanceof Error ? error.message : "refresh_failed",
      duration_ms: Date.now() - startedAt,
    });
    return null;
  }
}

function truthFromFreshness(freshness: unknown, source?: unknown): IntelligenceFact["truth_state"] {
  const value = text(freshness).toLowerCase();
  const sourceText = text(source).toLowerCase();
  if (sourceText === "validated_visible_state") return "inferred";
  if (value === "fresh") return "confirmed";
  if (["stale", "ageing", "cached", "last_confirmed"].includes(value)) return "observed";
  if (["expired", "unknown", "unavailable", "provider_disconnected"].includes(value)) return "unavailable";
  return value ? "observed" : "unavailable";
}

function factFromObject(object: OperationalObject, hydrationFacts: Record<string, unknown>, input: CanonicalConversationRequest, oisContext: OisContext | null | undefined): IntelligenceFact {
  const scope = currentScope(input, oisContext);
  const stateFacts = recordOf(hydrationFacts.state);
  const truth = truthFromFreshness(object.freshness, recordOf(object.metadata).source);
  const statement = objectStateLine(object);
  return {
    fact_id: `object_state:${object.object_type}:${object.canonical_id}:${object.freshness || "unknown"}`,
    domain: object.object_type === "device" || object.object_type === "device_channel" ? "devices" : object.source_module || object.object_type,
    fact_type: "current_state",
    scope,
    object: { object_type: object.object_type, canonical_id: object.canonical_id, label: object.label },
    statement,
    value: {
      state: object.current_state,
      health: object.health,
      provider_health: stateFacts.provider_health || recordOf(object.metadata).provider_health || null,
      freshness: object.freshness,
    },
    previous_value: null,
    occurred_at: object.freshness,
    observed_at: new Date().toISOString(),
    source_type: "live_state",
    source_id: object.evidence_references[0] || null,
    truth_state: truth,
    confidence: truth === "confirmed" ? 0.9 : truth === "observed" ? 0.74 : 0.54,
    freshness: object.freshness || "unknown",
    privacy_class: object.home_id ? "resident_device_private" : "building_operational",
    permissions: object.permissions || [],
    evidence: [{ type: "hydration", facts: hydrationFacts }],
  };
}

function humanCommandDirection(value: unknown) {
  const command = recordOf(value);
  for (const [key, raw] of Object.entries(command)) {
    if (/^switch_\d+$/i.test(key) || ["switch", "power", "on"].includes(key)) {
      if (typeof raw === "boolean") return raw ? "On" : "Off";
    }
  }
  return "";
}

function residentCommandStatement(input: {
  channel?: string | null;
  status?: string | null;
  command?: unknown;
  safeError?: string | null;
  confirmationStatus?: string | null;
  physicalEffectStatus?: string | null;
}) {
  const channel = text(input.channel);
  const target = channel ? channel.replace(/^switch_/i, "Channel ") : "Device";
  const direction = humanCommandDirection(input.command);
  const status = text(input.status).toLowerCase();
  const confirmation = text(input.confirmationStatus).toLowerCase();
  const physical = text(input.physicalEffectStatus).toLowerCase();
  const prefix = direction ? `${target} ${direction}` : `${target} command`;
  if (confirmation === "not_observable" || physical === "unknown" || physical === "not_observable") return `${prefix} was accepted by the controller; Oyi cannot directly observe the physical response.`;
  if (/state_confirmed|executed|confirmed/.test(status)) return `${prefix} was confirmed.`;
  if (/provider_rejected|failed|state_mismatch|confirmation_timed_out|timeout/.test(status)) {
    return `${prefix} did not complete${input.safeError ? `: ${input.safeError}` : ""}.`;
  }
  if (/accepted|dispatching|awaiting/.test(status)) return `${prefix} was sent and is waiting for confirmation.`;
  return `${prefix} was recorded.`;
}

function dedupeFacts(facts: IntelligenceFact[]) {
  const seen = new Set<string>();
  const result: IntelligenceFact[] = [];
  for (const fact of facts) {
    const key = [
      fact.domain,
      fact.object?.canonical_id || "scope",
      fact.fact_type,
      JSON.stringify(fact.value),
      fact.source_id || "",
      fact.occurred_at ? fact.occurred_at.slice(0, 16) : "",
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fact);
  }
  return result;
}

function internalEventReason(value: unknown) {
  const haystack = typeof value === "string" ? value : JSON.stringify(value || {});
  if (/\bproximity\.(?:awareness\.checked|awareness_evaluated)\b/i.test(haystack)) return "proximity_awareness";
  if (/\baudit\.recorded\b/i.test(haystack)) return "audit_recorded";
  if (/\b(?:ai|oyi)\.(?:response\.generated|tool\.(?:requested|executed)|command\.received|system\.signal\.received)\b/i.test(haystack)) return "oyi_internal_lifecycle";
  if (/\b(?:tool\.(?:requested|executed)|response\.generated|command\.received)\b/i.test(haystack)) return "runtime_internal_lifecycle";
  if (/\bproximity alone\b|\bsuspicious access\b/i.test(haystack)) return "internal_reasoning";
  if (/\bsystem event\b/i.test(haystack)) return "generic_system_event";
  return null;
}

function isResidentVisibleOperationalFact(fact: IntelligenceFact) {
  const reason = internalEventReason({
    statement: fact.statement,
    domain: fact.domain,
    fact_type: fact.fact_type,
    value: fact.value,
    source_id: fact.source_id,
    evidence: fact.evidence,
  });
  if (!reason) return true;
  logger.info("conversation_internal_event_suppressed", {
    reason,
    fact_id: fact.fact_id,
    source_type: fact.source_type,
    source_id: fact.source_id,
    domain: fact.domain,
  });
  return false;
}

async function loadRecentChangeFacts(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined, contract: IntelligenceRequestContract, object: OperationalObject | null) {
  const scope = currentScope(input, oisContext);
  const fromIso = contract.temporal_scope.from || new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const facts: IntelligenceFact[] = [];
  const executionSelect = "id,device_id,home_id,estate_id,action,execution_status,result_summary,requested_at,completed_at,error_message,metadata,verified,verification_method";
  try {
    let q = supabaseAdmin.from("ai_execution_ledger").select(executionSelect).gte("requested_at", fromIso).order("requested_at", { ascending: false }).limit(25);
    if (object?.canonical_id && (object.object_type === "device" || object.object_type === "device_channel")) q = q.eq("device_id", object.object_type === "device_channel" ? object.parent_id || object.canonical_id.split(":")[0] : object.canonical_id);
    else if (scope.home_id) q = q.eq("home_id", scope.home_id);
    else if (scope.estate_id) q = q.eq("estate_id", scope.estate_id);
    const { data, error } = await q;
    if (error) throw error;
    const executionDeviceIds = Array.from(new Set((Array.isArray(data) ? data : []).map((row: any) => text(row.device_id)).filter(Boolean)));
    const executionDevices = executionDeviceIds.length
      ? await supabaseAdmin.from("devices").select("id,name,room_id,category,type,metadata").in("id", executionDeviceIds)
      : { data: [], error: null };
    if (executionDevices.error) logger.warn("conversation_recent_changes_device_names_load_failed", { error: executionDevices.error, home_id: scope.home_id });
    const executionRoomIds = Array.from(new Set((executionDevices.data || []).map((row: any) => text(row.room_id)).filter(Boolean)));
    const executionRooms = executionRoomIds.length
      ? await supabaseAdmin.from("rooms").select("id,name").in("id", executionRoomIds)
      : { data: [], error: null };
    if (executionRooms.error) logger.warn("conversation_recent_changes_room_names_load_failed", { error: executionRooms.error, home_id: scope.home_id });
    const roomNameById = new Map((executionRooms.data || []).map((row: any) => [String(row.id), cleanLabel(row.name, "")]));
    const deviceById = new Map((executionDevices.data || []).map((row: any) => [String(row.id), row]));
    for (const row of Array.isArray(data) ? data : []) {
      const result = recordOf(recordOf(row.metadata).result);
      const deviceInfo = deviceById.get(String(row.device_id)) as Record<string, unknown> | undefined;
      const roomId = text(result.room_id || deviceInfo?.room_id || scope.room_id) || null;
      if (contract.scope_mode === "room_scope" && scope.room_id && roomId !== scope.room_id) {
        logger.info("conversation_room_evidence_filtered", {
          reason: "execution_room_mismatch",
          requested_room_id: scope.room_id,
          fact_room_id: roomId,
          source_id: row.id,
        });
        continue;
      }
      const roomName = roomId ? roomNameById.get(roomId) || text(recordOf(deviceInfo?.metadata).room_name || recordOf(deviceInfo?.metadata).roomName) || null : null;
      const channel = text(result.channel_code);
      if (object?.object_type === "device_channel" && contract.target.channel_code && channel && channel !== contract.target.channel_code) continue;
      const finalStatus = text(result.final_status || result.confirmation_status || row.execution_status);
      const label = text(result.device_name || deviceInfo?.name) || "Device command";
      const confirmed = /state_confirmed|executed/i.test(finalStatus) || row.verified;
      const commandValue = result.normalized_command || result.expected_state || null;
      const statement = residentCommandStatement({
        channel,
        status: finalStatus,
        command: commandValue,
        safeError: text(result.safe_error_message || row.error_message) || null,
        confirmationStatus: text(result.confirmation_status) || null,
        physicalEffectStatus: text(result.physical_effect_status) || null,
      });
      facts.push({
        fact_id: `execution:${row.id}`,
        domain: "devices",
        fact_type: "command_execution",
        scope: { estate_id: row.estate_id || scope.estate_id, home_id: row.home_id || scope.home_id, room_id: roomId },
        object: { object_type: channel ? "device_channel" : "device", canonical_id: channel ? `${row.device_id}:${channel}` : String(row.device_id || ""), label: channel ? `${label} ${channel}` : label },
        statement,
        value: { status: finalStatus, command: commandValue, channel_code: channel || null, safe_error_message: text(result.safe_error_message || row.error_message) || null, room_name: roomName, device_family: text(deviceInfo?.category || deviceInfo?.type || result.device_family) || null },
        previous_value: result.previous_state || null,
        occurred_at: row.completed_at || row.requested_at || null,
        observed_at: new Date().toISOString(),
        source_type: "execution_ledger",
        source_id: String(row.id),
        truth_state: confirmed ? "confirmed" : "observed",
        confidence: confirmed ? 0.94 : 0.8,
        freshness: row.completed_at || row.requested_at || "unknown",
        privacy_class: row.home_id ? "resident_device_private" : "building_operational",
        permissions: [],
        evidence: [{ type: "execution_ledger", id: row.id, verification_method: row.verification_method || null, error: row.error_message || null }],
      });
    }
  } catch (error) {
    logger.warn("conversation_recent_changes_execution_load_failed", { error, home_id: scope.home_id, estate_id: scope.estate_id });
  }
  try {
    let q = supabaseAdmin.from("audit_events").select("id,action,resource_type,resource_id,estate_id,metadata,status,created_at").gte("created_at", fromIso).order("created_at", { ascending: false }).limit(20);
    if (scope.estate_id) q = q.eq("estate_id", scope.estate_id);
    const { data, error } = await q;
    if (error) throw error;
	    for (const row of Array.isArray(data) ? data : []) {
	      const metadata = recordOf(row.metadata);
	      const privacy = text(metadata.privacy_class);
	      const hiddenReason = internalEventReason({ action: row.action, metadata, resource_type: row.resource_type });
	      const auditOnly = /^device\./.test(text(row.action)) || Boolean(hiddenReason);
	      if (auditOnly) {
	        if (hiddenReason) logger.info("conversation_internal_event_suppressed", { reason: hiddenReason, source_type: "audit", source_id: row.id, domain: row.resource_type });
	        continue;
	      }
      if (scope.home_id && text(metadata.home_id) && text(metadata.home_id) !== scope.home_id) continue;
      facts.push({
        fact_id: `audit:${row.id}`,
        domain: text(row.resource_type) || "operations",
        fact_type: "audit_change",
        scope: { estate_id: row.estate_id || scope.estate_id, home_id: text(metadata.home_id) || scope.home_id, room_id: text(metadata.room_id) || null },
        object: row.resource_id ? { object_type: text(row.resource_type) || "record", canonical_id: String(row.resource_id), label: text(metadata.object_name || row.resource_type || row.action) || "Record" } : null,
        statement: `${human(row.action)} was recorded at ${safeDateLabel(row.created_at)}.`,
        value: { action: row.action, status: row.status },
        previous_value: null,
        occurred_at: row.created_at || null,
        observed_at: new Date().toISOString(),
        source_type: "audit",
        source_id: String(row.id),
        truth_state: "observed",
        confidence: 0.75,
        freshness: row.created_at || "unknown",
        privacy_class: privacy || "home_private",
        permissions: [],
        evidence: [{ type: "audit_events", id: row.id }],
      });
    }
  } catch (error) {
    logger.warn("conversation_recent_changes_audit_load_failed", { error, home_id: scope.home_id, estate_id: scope.estate_id });
  }
	  const recentExecutions = Array.isArray(input.recent_executions) ? input.recent_executions : Array.isArray(recordOf(recordOf(object?.relationships).recent_executions)) ? recordOf(object?.relationships).recent_executions as any[] : [];
	  for (const row of recentExecutions.map(recordOf).slice(0, 8)) {
	    const summary = text(row.summary || row.result_summary || row.status);
	    if (!summary) continue;
	    const hiddenReason = internalEventReason({ summary, row });
	    if (hiddenReason) {
	      logger.info("conversation_internal_event_suppressed", { reason: hiddenReason, source_type: "visible_recent_execution", source_id: text(row.id || row.command_execution_id) || null, domain: "devices" });
	      continue;
	    }
    facts.push({
      fact_id: `visible_execution:${row.id || row.command_execution_id || summary}`,
      domain: "devices",
      fact_type: "command_execution",
      scope,
      object: object ? { object_type: object.object_type, canonical_id: object.canonical_id, label: object.label } : null,
      statement: summary,
      value: row,
      previous_value: null,
      occurred_at: text(row.completed_at || row.requested_at || row.created_at) || null,
      observed_at: new Date().toISOString(),
      source_type: "execution_ledger",
      source_id: text(row.id || row.command_execution_id) || null,
      truth_state: "observed",
      confidence: 0.78,
      freshness: text(row.completed_at || row.requested_at || row.created_at) || "unknown",
      privacy_class: object?.home_id ? "resident_device_private" : "building_operational",
      permissions: [],
      evidence: [{ type: "visible_recent_execution" }],
    });
  }
  const deduped = dedupeFacts(facts.filter(isResidentVisibleOperationalFact)).sort((a, b) => Date.parse(b.occurred_at || b.observed_at) - Date.parse(a.occurred_at || a.observed_at));
  logger.info("conversation_fact_deduplicated", {
    source_count: facts.length,
    final_fact_count: deduped.length,
    grouping_keys: ["domain", "object", "fact_type", "value_transition", "source_id", "timestamp_window"],
  });
  return deduped;
}

function factAppliesToContract(fact: IntelligenceFact, contract: IntelligenceRequestContract) {
  return evaluateFactCompatibility(fact, contract).compatible;
}

function evaluateFactCompatibility(fact: IntelligenceFact, contract: IntelligenceRequestContract): { compatible: boolean; reason: string } {
  if (contract.scope_mode !== "exact_target" || !contract.target.canonical_id) return { compatible: true, reason: "scope_level_fact" };
  const haystack = `${fact.statement} ${fact.fact_type} ${fact.source_id || ""}`.toLowerCase();
  if (/ai\.|oyi\.system|proximity\.awareness|tool\.requested|tool\.executed|response\.generated|command\.received|audit\.recorded/.test(haystack)) {
    return { compatible: false, reason: "internal_or_proximity_noise" };
  }
  const factId = fact.object?.canonical_id || "";
  const parentId = contract.target.parent_id || contract.target.canonical_id.split(":")[0];
  if (contract.target.object_type === "device_channel" && contract.target.channel_code) {
    const compatible = factId === contract.target.canonical_id
      || (factId === parentId && text(recordOf(fact.value).channel_code) === contract.target.channel_code)
      || (factId.startsWith(`${parentId}:`) && factId.endsWith(`:${contract.target.channel_code}`));
    return { compatible, reason: compatible ? "exact_channel_match" : "different_channel_or_device" };
  }
  const compatible = factId === contract.target.canonical_id || factId.startsWith(`${contract.target.canonical_id}:`);
  return { compatible, reason: compatible ? "exact_device_match" : "different_device" };
}

function isUsefulDeviceActivityFact(fact: IntelligenceFact) {
  const haystack = `${fact.statement} ${fact.fact_type} ${fact.source_id || ""}`.toLowerCase();
  if (/ai\.|oyi\.system|proximity\.awareness|tool\.requested|tool\.executed|response\.generated|command\.received|audit\.recorded/.test(haystack)) return false;
  if (!safeDateLabel(fact.occurred_at, "")) {
    return /critical|failed|rejected|confirmed offline|alarm|security/i.test(haystack);
  }
  if (/system event/.test(haystack)) return false;
  return /command|confirmed|changed|connected|disconnected|failed|rejected|scene|automation|offline|online|maintenance|fault|timeout/.test(haystack);
}

function isFailureFact(fact: IntelligenceFact) {
  const haystack = `${fact.statement} ${JSON.stringify(fact.value)} ${fact.truth_state}`.toLowerCase();
  return /provider_rejected|authentication|device_not_linked|integration_expired|command failure|failed|state_mismatch|confirmation_timed_out|timeout|runtime refresh failed|confirmed offline|capability mismatch|rejected/.test(haystack)
    && !/\b(stale|expired|unknown)\b/.test(haystack.replace(/confirmation_timed_out/g, ""));
}

async function loadLatestCommandFact(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined, object: OperationalObject | null) {
  const scope = currentScope(input, oisContext);
  try {
    let q = supabaseAdmin.from("ai_execution_ledger").select("id,device_id,home_id,estate_id,action,execution_status,result_summary,requested_at,completed_at,error_message,metadata,verified,verification_method").order("requested_at", { ascending: false }).limit(1);
    if (object?.canonical_id && (object.object_type === "device" || object.object_type === "device_channel")) q = q.eq("device_id", object.object_type === "device_channel" ? object.parent_id || object.canonical_id.split(":")[0] : object.canonical_id);
    else if (scope.home_id) q = q.eq("home_id", scope.home_id);
    else if (scope.estate_id) q = q.eq("estate_id", scope.estate_id);
    const { data, error } = await q;
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;
    const result = recordOf(recordOf(row.metadata).result);
    const channel = text(result.channel_code);
    if (object?.object_type === "device_channel" && text(recordOf(object.metadata).channel_code) && channel && channel !== text(recordOf(object.metadata).channel_code)) return null;
    const status = text(result.final_status || result.confirmation_status || row.execution_status);
    const safeError = text(result.safe_error_message || row.error_message);
    return {
      id: String(row.id),
      device_id: text(row.device_id),
      channel_code: channel || null,
      status,
      provider_status: text(result.provider_status) || null,
      confirmation_status: text(result.confirmation_status) || null,
      physical_effect_status: text(result.physical_effect_status) || null,
      requested_at: row.requested_at || null,
      completed_at: row.completed_at || null,
      safe_error_message: safeError || null,
      verified: Boolean(row.verified),
      expected_state: result.expected_state || null,
      observed_state: result.observed_state || null,
    };
  } catch (error) {
    logger.warn("conversation_latest_command_load_failed", { error, home_id: scope.home_id, estate_id: scope.estate_id });
    return null;
  }
}

function securityRiskAllowed(claim: string, facts: IntelligenceFact[], threshold: number) {
  const count = facts.filter((fact) => {
    const statement = fact.statement.toLowerCase();
    return /denied|mismatch|revoked|failed access|security incident/.test(statement);
  }).length;
  const allowed = count >= threshold;
  logger.info("conversation_risk_claim_evaluated", { claim, evidence_count: count, threshold, allowed });
  return allowed;
}

function stripInternalLanguage(value: string) {
  const blocked = [
    /oyi compatibility awareness/gi,
    /compatibility awareness/gi,
    /execution ledger(?: record)?(?: is)?(?: not)?(?: currently)?(?: attached)?/gi,
    /compatibility source/gi,
    /synthetic signal/gi,
    /internal enum/gi,
    /signal normalization/gi,
  ];
  let next = value;
  for (const pattern of blocked) {
    if (pattern.test(next)) logger.info("conversation_internal_language_blocked", { pattern: String(pattern) });
    next = next.replace(pattern, "available evidence");
  }
  return next.replace(/\s+/g, " ").trim();
}

function enforceResidentAnswerQuality(answer: string, fallback: string) {
  const checks: Array<[string, RegExp]> = [
    ["raw_uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}\b/i],
    ["invalid_date", /\bInvalid Date\b/i],
    ["undefined_null", /\b(undefined|null)\b/i],
    ["internal_event_code", /\b(?:ai|oyi|device|audit|proximity|runtime)\.[a-z0-9_.-]+\b/i],
    ["privacy_policy_term", /\bprivacy_class|resident_device_private|organization_restricted|permitted surface|Facility projection\b/i],
    ["duplicate_timestamp", /\b([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM)?)\s*\(\s*\1\s*\)/i],
    ["freshness_contradiction", /cannot claim a live healthy connection[\s\S]{0,220}(controller connection is healthy|is healthy|currently reports)/i],
  ];
  for (const [category, pattern] of checks) {
    if (pattern.test(answer)) {
      logger.warn("conversation_answer_quality_blocked", { category });
      return fallback;
    }
  }
  return answer;
}

function channelSummary(facts: Record<string, unknown>) {
  const channels = recordOf(facts.channels);
  const states = recordOf(channels.switch_states);
  const entries = Object.entries(states).filter(([, value]) => typeof value === "boolean");
  if (!entries.length) return "";
  return entries.map(([code, value]) => `${code.replace(/^switch_/i, "Channel ")} is ${value ? "On" : "Off"}`).join("; ");
}

function providerHealthLabel(value: unknown) {
  const raw = text(recordOf(value).status || value).toLowerCase();
  if (!raw) return "unknown";
  if (["healthy", "online", "connected", "ok"].includes(raw)) return "healthy";
  if (["offline", "disconnected", "provider_disconnected", "reconnect_required"].includes(raw)) return "unavailable";
  return raw;
}

function providerHealthSentence(provider: string, evidence: ReturnType<typeof freshnessLabelFromEvidence>) {
  if (provider === "unknown") return "";
  if (evidence.current) return `Controller connection is ${provider}.`;
  if (provider === "healthy") return `The last available controller reading looked healthy, but it is not live evidence.`;
  if (provider === "unavailable") return `The controller connection was not available in the latest evidence.`;
  return `Controller connection in the latest evidence: ${provider}.`;
}

function buildCurrentStateAnswer(object: OperationalObject | null, hydrationFacts: Record<string, unknown>, contract: IntelligenceRequestContract) {
  if (!object) return "I do not have an exact object selected, so I can only answer from the current authorised scope.";
  const stateFacts = recordOf(hydrationFacts.state);
  const channelLine = channelSummary(hydrationFacts);
  const provider = providerHealthLabel(stateFacts.provider_health || recordOf(object.metadata).provider_health);
  const freshness = text(stateFacts.freshness || object.freshness);
  const truth = freshnessLabelFromEvidence(freshness, factFromObject(object, hydrationFacts, { message: "", surface: "consumer" } as CanonicalConversationRequest, null).truth_state, recordOf(object.metadata).source, stateFacts.runtime_timestamp || object.freshness);
  const state = naturalState(object.current_state) || "an unavailable state";
  const lines = truth.prefix.includes("for")
    ? [`Oyi ${truth.prefix} ${object.label}.`]
    : [`${object.label} ${truth.prefix} ${state}.`];
  if (object.health) lines.push(truth.current ? `Health is ${naturalState(object.health)}.` : `Last health reading: ${naturalState(object.health)}.`);
  const providerLine = providerHealthSentence(provider, truth);
  if (providerLine) lines.push(providerLine);
  if (channelLine) lines.push(channelLine.endsWith(".") ? channelLine : `${channelLine}.`);
  if (truth.caveat) lines.push(truth.caveat);
  if (object.object_type === "device_channel" && contract.target.channel_code) lines.push(`This answer is scoped only to ${contract.target.channel_code}; I did not substitute another channel.`);
  return lines.join(" ");
}

function buildHealthAnswer(object: OperationalObject | null, hydrationFacts: Record<string, unknown>, contract: IntelligenceRequestContract) {
  if (!object) return "I could not verify the selected object from the current authorised scope.";
  const stateFacts = recordOf(hydrationFacts.state);
  const provider = providerHealthLabel(stateFacts.provider_health || recordOf(object.metadata).provider_health);
  const state = naturalState(object.current_state) || "unknown";
  const channelLine = channelSummary(hydrationFacts);
  const truth = freshnessLabelFromEvidence(stateFacts.freshness || object.freshness, factFromObject(object, hydrationFacts, { message: "", surface: "consumer" } as CanonicalConversationRequest, null).truth_state, recordOf(object.metadata).source, stateFacts.runtime_timestamp || object.freshness);
  const status = truth.current && (provider === "healthy" || /online|available|healthy|connected/i.test(`${object.health || ""} ${stateFacts.availability || ""}`));
  const lead = status
    ? `${object.label} is communicating with Oyi from fresh confirmed evidence.`
    : `Oyi cannot claim a live healthy connection for ${object.label} from the current evidence.`;
  return [
    lead,
    truth.current ? `It currently reports ${state}.` : `${object.label} ${truth.prefix} ${state}.`,
    object.health ? (truth.current ? `Health is ${naturalState(object.health)}.` : `Last health reading: ${naturalState(object.health)}.`) : "",
    providerHealthSentence(provider, truth),
    channelLine ? `${channelLine}.` : "",
    truth.caveat,
  ].filter(Boolean).join(" ");
}

function buildCapabilityAnswer(object: OperationalObject | null, input: CanonicalConversationRequest) {
  if (!object || object.object_type === "home" || currentTurnExplicitlyGlobal(input.message)) return input.surface === "facility"
    ? "I can answer authorised building operations questions, generate reports, investigate incidents, and prepare safe actions when policy allows."
    : "I can help you understand and control authorised devices, review rooms and recent activity, manage visitors and maintenance, check wallet and utility information, and prepare scenes or automations safely.";
  return objectCapabilityLine(object);
}

function buildRecentChangesAnswer(facts: IntelligenceFact[], contract: IntelligenceRequestContract) {
  const meaningfulFacts = recentChangeRows(facts, contract).filter((fact) => safeDateLabel(fact.occurred_at, "")).slice(0, 12);
  const meaningful = groupRecentChangeRows(meaningfulFacts).slice(0, 12);
  securityRiskAllowed("suspicious_access", meaningfulFacts, 2);
  if (!meaningful.length) {
    if (contract.scope_mode === "exact_target" && contract.target.label) return `I do not see useful recent activity for ${contract.target.label} in the authorised evidence window.`;
    return contract.temporal_scope.mode === "recent"
      ? "I do not see meaningful recent changes in this authorised scope."
      : "I do not see concrete changes for that period in this authorised scope.";
  }
  const from = contract.temporal_scope.from ? safeDateLabel(contract.temporal_scope.from, "the recent window", "date_time") : "the recent window";
  const label = contract.scope_mode === "exact_target" && contract.target.label ? ` for ${contract.target.label}` : "";
  return `${meaningful.length} meaningful change${meaningful.length === 1 ? "" : "s"}${label} were recorded since ${from}. I filtered routine background records and internal checks.`;
}

function buildFailureHistoryAnswer(facts: IntelligenceFact[], contract: IntelligenceRequestContract) {
  const failures = facts.filter((fact) => factAppliesToContract(fact, contract) && isFailureFact(fact)).slice(0, 8);
  const label = contract.target.label || "the selected device";
  if (!failures.length) return `I do not see confirmed failures for ${label} in the authorised evidence window. Stale, expired, or unknown readings were not counted as failures.`;
  return [`Failures for ${label}:`, ...failures.map((fact) => {
    const at = safeDateLabel(fact.occurred_at, "");
    return `• ${fact.statement.replace(/\.$/, "")}${at ? ` (${at})` : ""}`;
  })].join("\n");
}

function buildDiagnosisAnswer(object: OperationalObject | null, hydrationFacts: Record<string, unknown>, facts: IntelligenceFact[], contract: IntelligenceRequestContract) {
  if (!object) return "I could not diagnose an exact selected object in this scope.";
  const stateFacts = recordOf(hydrationFacts.state);
  const failures = facts.filter((fact) => factAppliesToContract(fact, contract) && isFailureFact(fact));
  const provider = providerHealthLabel(stateFacts.provider_health || recordOf(object.metadata).provider_health);
  const state = naturalState(object.current_state) || "unknown";
  const channelLine = channelSummary(hydrationFacts);
  const freshness = freshnessLabelFromEvidence(stateFacts.freshness || object.freshness, factFromObject(object, hydrationFacts, { message: "", surface: "consumer" } as CanonicalConversationRequest, null).truth_state, recordOf(object.metadata).source, stateFacts.runtime_timestamp || object.freshness);
  const nextStep = failures.length
    ? "Safe next step: retry only after checking the provider connection or review the last failed command."
    : provider === "unavailable"
      ? "Safe next step: reconnect or refresh the controller integration before relying on live state."
      : "Safe next step: use a direct control only if you want to change the state; this diagnosis did not execute anything.";
  return [
    `Finding: ${failures.length ? `${failures.length} confirmed failure item${failures.length === 1 ? "" : "s"} are visible for ${object.label}.` : `No confirmed failure is visible for ${object.label}.`}`,
    `Supporting evidence: ${freshness.current ? "The latest reading confirms" : freshness.prefix} ${state}.`,
    channelLine ? `Channels: ${channelLine}.` : "",
    providerHealthSentence(provider, freshness),
    `Evidence freshness: ${freshness.caveat || "Freshness is not available."}`,
    failures[0] ? `Most relevant issue: ${failures[0].statement.replace(/\.$/, "")}.` : "",
    `Uncertainty: relay or controller state does not independently prove the physical appliance output.`,
    nextStep,
    "No action was performed.",
  ].filter(Boolean).join(" ");
}

function buildRelationshipsAnswer(object: OperationalObject | null, input: CanonicalConversationRequest, hydrationFacts: Record<string, unknown>, contract: IntelligenceRequestContract) {
  if (!object) return "I could not load relationships for an exact selected object in this scope.";
  const relationships = { ...recordOf(object.relationships), ...recordOf(hydrationFacts.relationships), ...recordOf(input.relationships) };
  const scenes = listNames(input.active_scenes || relationships.active_scenes || relationships.scenes, "scene");
  const automations = listNames(input.active_automations || relationships.active_automations || relationships.automations, "automation");
  const controls = arrayOfStrings(recordOf(hydrationFacts.classification).supported_controls || object.capabilities).slice(0, 6);
  const selected = recordOf(hydrationFacts.selected_channel);
  const channel = contract.target.channel_code ? `Selected channel: ${text(recordOf(selected.channel).name || recordOf(selected.channel).label) || contract.target.channel_code.replace(/^switch_/i, "Channel ")}.` : "";
  const roomName = text(relationships.room_name);
  const homeLabel = text(relationships.home_name || recordOf(hydrationFacts.identity).home_name);
  const lines = [
    `Relationships for ${object.label}:`,
    text(relationships.parent_device_name) ? `Parent hub: ${text(relationships.parent_device_name)}.` : "",
    channel,
    roomName ? `Room: ${roomName}.` : "",
    homeLabel ? `Home: ${homeLabel}.` : "",
    scenes.length ? `Scenes: ${scenes.slice(0, 4).join(", ")}.` : "Scenes: none linked in the current evidence.",
    automations.length ? `Automations: ${automations.slice(0, 4).join(", ")}.` : "Automations: none linked in the current evidence.",
    controls.length ? `Supported controls: ${controls.join(", ")}.` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function buildCommandOutcomeAnswer(command: Record<string, unknown> | null) {
  if (!command) return "I do not see an authorised recent command execution for this scope.";
  const status = text(command.status);
  const confirmation = text(command.confirmation_status).toLowerCase();
  const physicalStatus = text(command.physical_effect_status).toLowerCase();
  const channel = text(command.channel_code);
  const target = channel ? `${channel.replace(/^switch_/i, "Channel ")}` : "the device";
  const requestedAt = safeDateLabel(command.completed_at || command.requested_at, "", "relative");
  const when = requestedAt ? ` ${requestedAt}` : "";
  if (confirmation === "not_observable" || physicalStatus === "unknown" || physicalStatus === "not_observable") {
    return `Your last ${target} command was accepted by the connected controller${when}. Oyi cannot directly observe whether the physical appliance responded.`;
  }
  if (/state_confirmed|executed/i.test(status) || command.verified) {
    const physical = text(command.physical_effect_status).toLowerCase() === "confirmed"
      ? "Oyi has direct physical-effect evidence for the connected appliance."
      : "The device state was confirmed, but Oyi did not directly observe the connected appliance itself.";
    return `Your last ${target} command was accepted, and a fresh follow-up reading confirmed the requested device state${when}. ${physical}`;
  }
  if (/provider_rejected|failed|state_mismatch|confirmation_timed_out/i.test(status)) {
    return `${target} command did not complete successfully. ${text(command.safe_error_message) || "Oyi kept the last confirmed state rather than marking the device as changed."}`;
  }
  if (/accepted|dispatching|awaiting/.test(status)) return `The controller accepted the ${target} command, but Oyi has not yet confirmed the resulting device state.`;
  return `${target} command was recorded, but Oyi has not confirmed a resulting device-state change.`;
}

function buildReportAnswer(facts: IntelligenceFact[], object: OperationalObject | null, contract: IntelligenceRequestContract) {
  const changes = facts.slice(0, 6);
  const title = object ? `${object.label} report` : contract.scope_mode === "building_scope" ? "Building operational report" : "Home operational report";
  const unresolved = facts.filter((fact) => /failed|unavailable|warning|critical|timeout|denied/i.test(`${fact.statement} ${JSON.stringify(fact.value)}`));
  return [
    `${title}`,
    `Period: ${contract.temporal_scope.from || "current"} to ${contract.temporal_scope.to || new Date().toISOString()}.`,
    `Summary: ${changes.length ? `${changes.length} meaningful evidence item${changes.length === 1 ? "" : "s"} found.` : "No meaningful changes found."}`,
    `Unresolved items: ${unresolved.length}.`,
    changes.length ? `Key changes:\n${changes.map((fact) => `• ${fact.statement}`).join("\n")}` : "Key changes: none recorded.",
    "Limitations: Oyi reports only authorised records and does not infer physical appliance effects without separate sensing.",
  ].join("\n");
}

function buildDeviceAvailabilityInventoryAnswer(facts: IntelligenceFact[], contract?: IntelligenceRequestContract, message = "") {
  const availabilityFacts = facts.filter((fact) => fact.fact_type === "device_availability");
  if (!availabilityFacts.length) {
    return contract?.scope_mode === "room_scope"
      ? "I could not load an authorised device inventory for this room. I did not use an old selected device as a fallback."
      : "I could not load a current authorised device inventory for this home. I did not use an old selected device as a fallback.";
  }
  const asksForInventory = contract?.scope_mode === "room_scope" && /\b(show|list|view)\b[\s\S]{0,24}\b(devices?|hardware|lights?|switches?|sockets?)\b/i.test(text(message));
  if (asksForInventory) {
    const unavailable = availabilityFacts.filter((fact) => text(recordOf(fact.value).availability) !== "online").length;
    return `${availabilityFacts.length} authorised device${availabilityFacts.length === 1 ? "" : "s"} are listed for this room.${unavailable ? ` ${unavailable} need attention or clearer evidence.` : " None are currently flagged by the available evidence."}`;
  }
  const confirmedOffline = availabilityFacts.filter((fact) => text(recordOf(fact.value).availability) === "offline");
  const staleOrExpired = availabilityFacts.filter((fact) => ["stale", "expired"].includes(text(recordOf(fact.value).availability)));
  const unknown = availabilityFacts.filter((fact) => text(recordOf(fact.value).availability) === "unknown");
  if (!confirmedOffline.length) {
    const caveat = staleOrExpired.length
      ? ` ${staleOrExpired.length} device${staleOrExpired.length === 1 ? "" : "s"} have stale or expired readings, so I listed them separately instead of calling them offline.`
      : unknown.length
        ? ` ${unknown.length} device${unknown.length === 1 ? "" : "s"} have unknown availability.`
        : "";
    return `I do not see devices that are confirmed offline from fresh evidence in this home.${caveat}`;
  }
  const lines = confirmedOffline.slice(0, 12).map((fact) => {
    const when = safeDateLabel(fact.occurred_at, "", "relative");
    return `• ${fact.object?.label || "Device"}${when ? `, confirmed offline ${when}` : ""}`;
  });
  return [`Confirmed offline devices in this home:`, ...lines].join("\n");
}

function buildHomeOperationalSummaryAnswer(facts: IntelligenceFact[], contract?: IntelligenceRequestContract) {
  const availabilityFacts = facts.filter((fact) => fact.fact_type === "device_availability");
  const recentFacts = facts.filter((fact) => fact.fact_type !== "device_availability");
  const confirmedOffline = availabilityFacts.filter((fact) => text(recordOf(fact.value).availability) === "offline").length;
  const notRecent = availabilityFacts.filter((fact) => ["stale", "expired", "unknown"].includes(text(recordOf(fact.value).availability))).length;
  const confirmedOnline = availabilityFacts.filter((fact) => text(recordOf(fact.value).availability) === "online").length;
  const attention = recentFacts.filter((fact) => /failed|warning|critical|timeout|unavailable|denied|offline/i.test(`${fact.statement} ${JSON.stringify(fact.value)}`)).slice(0, 5);
  const scopeLabel = contract?.scope_mode === "room_scope" ? "room" : "home";
  const lines = [
    confirmedOffline || notRecent || attention.length
      ? `This ${scopeLabel} is generally stable, but ${confirmedOffline + notRecent + attention.length} item${confirmedOffline + notRecent + attention.length === 1 ? "" : "s"} need attention or clearer evidence.`
      : `Everything currently looks stable in this ${scopeLabel} based on the latest available evidence.`,
    availabilityFacts.length
      ? `Devices: ${confirmedOnline} confirmed online, ${confirmedOffline} confirmed offline, ${notRecent} not recently confirmed.`
      : "Devices: inventory evidence is unavailable right now.",
    attention.length
      ? `Needs attention: ${attention.length} item${attention.length === 1 ? "" : "s"} in the authorised evidence window.`
      : "Needs attention: no urgent item is visible in the authorised evidence window.",
  ];
  if (attention.length) {
    lines.push(...attention.map((fact) => `• ${fact.statement.replace(/\.$/, "")}`));
  }
  lines.push(`Oyi did not reuse a selected drawer target or perform any action for this ${scopeLabel}-scope answer.`);
  return lines.join("\n");
}

function recentChangeRows(facts: IntelligenceFact[], contract: IntelligenceRequestContract) {
  return facts.filter((fact) => {
    if (contract.scope_mode === "room_scope" && contract.target.canonical_id && fact.scope.room_id !== contract.target.canonical_id) return false;
    return factAppliesToContract(fact, contract) && isResidentVisibleOperationalFact(fact) && isUsefulDeviceActivityFact(fact);
  });
}

function groupRecentChangeRows(facts: IntelligenceFact[]) {
  const grouped = new Map<string, Record<string, string | number | null>>();
  for (const fact of facts) {
    const value = recordOf(fact.value);
    const command = recordOf(value.command || value.expected_state || value.normalized_command);
    const action = humanCommandDirection(command) || cleanLabel(text(value.action || value.status || fact.fact_type).replace(/_/g, " "), "Updated");
    const result = /not_observable|unknown/.test(text(value.physical_effect_status).toLowerCase())
      ? "Accepted; physical response not observable"
      : /confirmed|state_confirmed|executed/.test(text(value.status).toLowerCase())
        ? "Confirmed"
        : /failed|rejected|timeout|mismatch/.test(text(value.status).toLowerCase())
          ? "Failed"
          : cleanLabel(text(value.status).replace(/_/g, " "), "Recorded");
    const channel = text(value.channel_code).replace(/^switch_/i, "Channel ") || null;
    const device = residentSafeLabel(cleanLabel(fact.object?.label, "Device").replace(/\s+switch_\d+$/i, "").replace(/\s+Channel\s+\d+$/i, ""), "Device");
    const room = residentSafeLabel(recordOf(fact.value).room_name || fact.scope.room_id, "");
    const latest = fact.occurred_at || fact.observed_at;
    const key = [fact.object?.canonical_id || "scope", action, result, channel || ""].join(":").toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.count = Number(existing.count || 1) + 1;
      if (Date.parse(latest) > Date.parse(String(existing.occurred_at || ""))) existing.occurred_at = latest;
      continue;
    }
    grouped.set(key, {
      event_id: fact.source_id || fact.fact_id,
      target_type: fact.object?.object_type || "home",
      target_id: fact.object?.canonical_id || "",
      device_name: device,
      room_name: room || null,
      channel_label: channel,
      action,
      result,
      occurred_at: safeDateLabel(latest, "Time unavailable", "relative"),
      sort_at: latest || null,
      truth_state: fact.truth_state,
      device_family: text(recordOf(fact.value).device_family || recordOf(fact.value).category) || "device",
      count: 1,
    });
  }
  return Array.from(grouped.values()).sort((a, b) => Date.parse(String(b.sort_at || "")) - Date.parse(String(a.sort_at || "")));
}

function deviceAvailabilityRows(facts: IntelligenceFact[]) {
  return facts
    .filter((fact) => fact.fact_type === "device_availability")
    .map((fact) => {
      const value = recordOf(fact.value);
      const status = text(value.availability) || "unknown";
      const when = safeDateLabel(fact.occurred_at, "", "relative");
      const room = residentSafeLabel(value.room_name, "");
      const family = text(value.device_family || value.category || value.type) || "device";
      const rawName = residentSafeLabel(fact.object?.label, "");
      const isVirtual = Boolean(value.is_virtual || value.presentation_type === "virtual_appliance" || /ir.*(tv|ac|remote)|virtual/i.test(`${family} ${rawName}`));
      const parentName = residentSafeLabel(value.parent_device_name || value.physical_device_name, "");
      const displayName = rawName && !/^(device|air)$/i.test(rawName)
        ? isVirtual && parentName && !rawName.includes("—") ? `${rawName} — controlled through ${parentName}` : rawName
        : /tv/i.test(family) ? "TV — controlled through Smart IR Hub"
          : /ac|air|climate/i.test(family) ? "AC — controlled through Smart IR Hub"
            : /ir|hub|remote/i.test(family) ? "Smart IR Hub"
              : "Unnamed smart device";
      const explanation = status === "offline"
        ? "Fresh evidence reports this device offline."
        : status === "online"
          ? "Fresh evidence reports this device online."
          : status === "provider_disconnected"
            ? "The provider connection is not available."
            : status === "stale" || status === "expired"
              ? "The latest reading is not recent enough to confirm current availability."
              : "Oyi does not have enough evidence to confirm availability.";
      return {
        device_id: fact.object?.canonical_id || "",
        name: displayName,
        room: room || null,
        device_family: family,
        status,
        last_observed_at: when || null,
        explanation,
      };
    });
}

function walletTransactionRows(facts: IntelligenceFact[]) {
  return facts
    .filter((fact) => fact.fact_type === "wallet_transaction")
    .map((fact) => {
      const value = recordOf(fact.value);
      const amount = Number(value.amount || 0);
      const direction = text(value.direction).toLowerCase();
      const sign = direction === "debit" ? "-" : direction === "credit" ? "+" : "";
      return {
        transaction_id: fact.object?.canonical_id || fact.fact_id,
        date: safeDateLabel(fact.occurred_at, "Time unavailable", "date_time"),
        description: residentSafeLabel(value.description || fact.object?.label, "Wallet transaction"),
        type: cleanLabel(value.type, "transaction"),
        amount: `${sign}₦${Math.abs(amount).toLocaleString()}`,
        status: cleanLabel(value.status, "recorded"),
      };
    });
}

function utilitySpendingRows(facts: IntelligenceFact[]) {
  const utilities = facts.filter((fact) => {
    const value = recordOf(fact.value);
    return fact.domain === "utilities" || /electricity|water|internet|utility|power|gas/i.test(`${value.category} ${value.description} ${value.type}`);
  });
  const totals = new Map<string, number>();
  for (const fact of utilities) {
    const value = recordOf(fact.value);
    if (text(value.direction).toLowerCase() === "credit") continue;
    const rawCategory = text(value.category || value.type || value.description) || "Utilities";
    const category = /electricity|power/i.test(rawCategory) ? "Electricity"
      : /water/i.test(rawCategory) ? "Water"
        : /internet|data/i.test(rawCategory) ? "Internet"
          : /gas/i.test(rawCategory) ? "Gas"
            : "Utilities";
    totals.set(category, (totals.get(category) || 0) + Math.abs(Number(value.amount || 0)));
  }
  return Array.from(totals.entries()).map(([category, amount]) => ({
    category,
    amount: `₦${amount.toLocaleString()}`,
    status: "confirmed",
  }));
}

function buildWalletHistoryAnswer(facts: IntelligenceFact[]) {
  const rows = walletTransactionRows(facts);
  if (!rows.length) return "I do not see any wallet transactions in the selected period.";
  return `${rows.length} wallet transaction${rows.length === 1 ? "" : "s"} are available for the selected period. I did not navigate away or perform a financial action.`;
}

function buildUtilitySpendingAnswer(facts: IntelligenceFact[]) {
  const rows = utilitySpendingRows(facts);
  if (!rows.length) return "I could not confirm utility spending for the selected period from the available wallet and service records.";
  const total = rows.reduce((sum, row) => sum + Number(String(row.amount).replace(/[^0-9.-]+/g, "")), 0);
  return `You spent ₦${total.toLocaleString()} on confirmed utility transactions in the selected period. I did not perform any wallet, payment, or vending action.`;
}

function tableBlockForContract(contract: IntelligenceRequestContract, facts: IntelligenceFact[]): ConversationTableBlock | null {
  const snapshot = {
    snapshot_mode: contract.evidence_requirements.current_state || contract.intent === "device_availability_inventory" || contract.intent === "home_operational_summary" ? "current_state_snapshot" : "historical",
    snapshot_generated_at: new Date().toISOString(),
    evidence_cutoff_at: contract.temporal_scope.to || new Date().toISOString(),
    timezone: "UTC",
    scope: contract.scope_mode,
    target: contract.target.label || contract.target.canonical_id || null,
  };
  if (contract.intent === "device_availability_inventory") {
    const rows = deviceAvailabilityRows(facts)
      .filter((row) => contract.scope_mode === "room_scope" || row.status !== "online")
      .slice(0, 20);
    if (!rows.length) return null;
    return {
      type: "table",
      title: contract.scope_mode === "room_scope" && contract.target.label ? `${contract.target.label} devices` : "Device availability",
      compact: true,
      snapshot,
      columns: [
        { key: "name", label: "Device" },
        { key: "room", label: "Room" },
        { key: "status", label: "Status" },
        { key: "last_observed_at", label: "Last seen" },
        { key: "explanation", label: "Evidence" },
      ],
      rows,
    };
  }
  if (contract.intent === "recent_changes" || contract.intent === "activity_history") {
    const rows = groupRecentChangeRows(recentChangeRows(facts, contract)).slice(0, 12);
    if (!rows.length) return null;
    return {
      type: "table",
      title: contract.scope_mode === "exact_target"
        ? "Selected target activity"
        : contract.scope_mode === "room_scope" && contract.target.label
          ? `Recent ${contract.target.label} changes`
          : "Recent home changes",
      compact: true,
      snapshot,
      columns: [
        { key: "device_name", label: "Device" },
        { key: "room_name", label: "Room" },
        { key: "channel_label", label: "Channel" },
        { key: "action", label: "Action" },
        { key: "result", label: "Result" },
        { key: "occurred_at", label: "Time" },
      ],
      rows,
    };
  }
  if (contract.intent === "home_operational_summary") {
    const rows = deviceAvailabilityRows(facts).filter((row) => row.status !== "online").slice(0, 8);
    if (!rows.length) return null;
    return {
      type: "table",
      title: contract.scope_mode === "room_scope" && contract.target.label ? `${contract.target.label} attention items` : "Home attention items",
      compact: true,
      snapshot,
      columns: [
        { key: "name", label: "Item" },
        { key: "room", label: "Room" },
        { key: "status", label: "Status" },
        { key: "explanation", label: "Why it matters" },
      ],
      rows,
    };
  }
  if (contract.intent === "wallet_operation" && contract.answer_builder === "wallet_history") {
    const rows = walletTransactionRows(facts).slice(0, 20);
    if (!rows.length) return null;
    return {
      type: "table",
      title: "Wallet history",
      compact: true,
      snapshot,
      columns: [
        { key: "date", label: "Date" },
        { key: "description", label: "Description" },
        { key: "type", label: "Type" },
        { key: "amount", label: "Amount" },
        { key: "status", label: "Status" },
      ],
      rows,
    };
  }
  if (contract.intent === "wallet_operation" && contract.answer_builder === "utility_spending") {
    const rows = utilitySpendingRows(facts);
    if (!rows.length) return null;
    return {
      type: "table",
      title: "Utility spending",
      compact: true,
      snapshot,
      columns: [
        { key: "category", label: "Utility" },
        { key: "amount", label: "Amount" },
        { key: "status", label: "Evidence" },
      ],
      rows,
    };
  }
  return null;
}

function operationForResolvedTurn(contract: IntelligenceRequestContract): ConversationOperation {
  if (contract.operation_class === "navigate") return contract.target.object_type ? "navigate_object" : "navigate_module";
  if (contract.operation_class === "list") return "list";
  if (contract.operation_class === "execute_mutation" || contract.operation_class === "confirm_mutation") return "control";
  if (contract.operation_class === "propose_mutation" || contract.operation_class === "compose") return "compose";
  if (contract.operation_class === "approve") return "approve";
  if (contract.operation_class === "reject") return "reject";
  if (contract.operation_class === "handoff") return "handoff";
  if (contract.scope_mode === "clarification") return "clarify";
  if (contract.intent === "wallet_operation") return "list";
  if (contract.intent === "device_availability_inventory" || contract.intent === "recent_changes" || contract.intent === "activity_history" || contract.intent === "failure_history") return "list";
  if (contract.intent === "current_state" || contract.intent === "health_check" || contract.intent === "diagnosis" || contract.intent === "relationships" || contract.intent === "evidence") return "inspect";
  return "inform";
}

function scopeForResolvedTurn(contract: IntelligenceRequestContract): ResolvedConversationTurn["scope"] {
  if (contract.scope_mode === "exact_target") return "exact_object";
  if (contract.scope_mode === "room_scope") return "room";
  if (contract.scope_mode === "home_scope" || contract.scope_mode === "explicit_broad_scope") return "home";
  if (contract.scope_mode === "building_scope" || contract.scope_mode === "estate_scope") return "building";
  if (contract.scope_mode === "thread_scope") return "thread_reference";
  if (contract.scope_mode === "clarification") return "ambiguous";
  if (contract.intent === "module_navigation" || contract.intent === "domain_list") return "module";
  return "home";
}

function domainForResolvedTurn(contract: IntelligenceRequestContract, object: OperationalObject | null, semantic?: ReturnType<typeof semanticOperationAction> | null) {
  if (semantic?.operation?.domain) return semantic.operation.domain;
  const module = text(object?.source_module).toLowerCase();
  if (module) return module;
  const targetType = text(contract.target.object_type).toLowerCase();
  if (/device|switch|camera/.test(targetType)) return "devices";
  if (/room/.test(targetType)) return "rooms";
  if (/visitor|access/.test(targetType)) return "visitors";
  if (/maintenance/.test(targetType)) return "maintenance";
  if (/wallet|transaction/.test(targetType)) return "wallet";
  if (/incident/.test(targetType)) return "incidents";
  if (contract.intent === "wallet_operation" && contract.answer_builder === "utility_spending") return "utilities";
  if (contract.intent === "wallet_operation") return "wallet";
  if (contract.intent === "device_availability_inventory") return "devices";
  return null;
}

function presentationPolicyForContract(contract: IntelligenceRequestContract): ConversationPresentationPolicy {
  const base = {
    intent: contract.intent,
    operation: operationForResolvedTurn(contract),
  };
  if (contract.scope_mode === "clarification") {
    return { ...base, primary: "clarification", allowed_supporting_blocks: ["clarification"], allowed_action_types: ["clarification_choice"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "hidden", snapshot_mode: "none", auto_navigation: false };
  }
  if (contract.operation_class === "execute_mutation" || contract.operation_class === "confirm_mutation") {
    return { ...base, primary: "approval", allowed_supporting_blocks: ["approval", "command_result"], allowed_action_types: ["approval", "cancel"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "none", auto_navigation: false };
  }
  if (contract.intent === "device_availability_inventory" || contract.intent === "recent_changes" || contract.intent === "activity_history" || contract.intent === "failure_history" || contract.intent === "wallet_operation") {
    return { ...base, primary: "table", allowed_supporting_blocks: ["table", "navigation_action"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: contract.intent === "device_availability_inventory" ? "current_state_snapshot" : "historical", auto_navigation: false };
  }
  if (contract.intent === "module_navigation") {
    return { ...base, primary: "navigation_transition", allowed_supporting_blocks: ["navigation_action", "handoff"], allowed_action_types: ["navigation", "stay"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "hidden", snapshot_mode: "none", auto_navigation: true };
  }
  if ((contract.intent === "capability" || contract.intent === "general_help") && (contract.scope_mode === "home_scope" || contract.scope_mode === "global_scope")) {
    return { ...base, primary: "text", allowed_supporting_blocks: ["navigation_action"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "hidden", snapshot_mode: "none", auto_navigation: false };
  }
  if (contract.intent === "domain_list") {
    return { ...base, primary: "text", allowed_supporting_blocks: ["navigation_action"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "historical", auto_navigation: false };
  }
  if (contract.intent === "current_state" || contract.intent === "health_check") {
    return { ...base, primary: "status", allowed_supporting_blocks: ["status", "evidence"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: false, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "current_state_snapshot", auto_navigation: false };
  }
  return { ...base, primary: "text", allowed_supporting_blocks: ["object_card", "evidence", "navigation_action"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: false, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "none", auto_navigation: false };
}

function selectConversationBuilder(contract: IntelligenceRequestContract, object: OperationalObject | null): ConversationBuilderKey | null {
  const objectType = text(object?.object_type || contract.target.object_type);
  const exactDevice = contract.scope_mode === "exact_target" && (objectType === "device" || objectType === "device_channel");
  if (exactDevice && ["current_state", "health_check", "evidence"].includes(contract.intent)) return "device_status";
  if (exactDevice && ["activity_history", "recent_changes"].includes(contract.intent)) return "device_activity";
  if (exactDevice && contract.intent === "failure_history") return "device_failures";
  if (exactDevice && ["diagnosis", "investigation", "explanation"].includes(contract.intent)) return "device_diagnosis";
  if (exactDevice && contract.intent === "relationships") return "device_relationships";
  if (exactDevice && contract.intent === "device_control") return "device_control";
  if (contract.intent === "device_availability_inventory") return "offline_inventory";
  if (contract.intent === "home_operational_summary") return "home_summary";
  if (contract.intent === "recent_changes" || contract.intent === "activity_history") return "recent_changes";
  if (contract.intent === "wallet_operation" && contract.answer_builder === "wallet_history") return "wallet_history";
  if (contract.intent === "wallet_operation" && contract.answer_builder === "utility_spending") return "utility_spending";
  if (contract.intent === "wallet_operation") return "wallet_summary";
  if (contract.intent === "module_navigation") return "module_navigation";
  if (contract.intent === "domain_list") return "domain_list";
  if (contract.scope_mode === "clarification") return "clarification";
  if (contract.intent === "general_help" || contract.intent === "capability") return "general_help";
  return null;
}

function targetSourceForResolvedOyiTurn(source: unknown): ResolvedOyiTurn["target_source"] {
  const raw = text(source);
  if (raw === "current_turn_room_reference" || raw === "resolved_named_reference" || raw === "home_scope") return "current_turn";
  if (raw === "thread_state") return "thread_memory";
  if (raw === "page_selection" || raw === "active_page_object" || raw === "selected_subobject") return "page_context";
  if (raw === "clarification" || raw === "ambiguous") return "active_workflow";
  if (raw === "global_scope" || raw === "estate_scope") return "authorised_fallback";
  return "valid_reference";
}

function canonicalTargetFromContract(contract: IntelligenceRequestContract, object: OperationalObject | null): CanonicalTarget | null {
  const objectType = text(contract.target.object_type || object?.object_type);
  const canonicalId = text(contract.target.canonical_id || object?.canonical_id);
  if (!objectType || !canonicalId) return null;
  return {
    object_type: objectType,
    canonical_id: canonicalId,
    label: text(contract.target.label || object?.label) || null,
    parent_id: text(contract.target.parent_id || object?.parent_id) || null,
    channel_code: text(contract.target.channel_code || recordOf(object?.metadata).channel_code) || null,
  };
}

function resolvedOyiTurnFromContract(input: CanonicalConversationRequest, normalizedTurn: NormalizedUserTurn, contract: IntelligenceRequestContract, object: OperationalObject | null, options: { targetSource: unknown; workflowId?: string | null }): ResolvedOyiTurn {
  const semanticDomain = normalizedTurn.domain || (domainForResolvedTurn(contract, object, semanticOperationAction(input.message || "", input.surface)) as OyiDomain | null);
  const capabilityKey = capabilityKeyForTurn({ ...normalizedTurn, domain: semanticDomain || normalizedTurn.domain || "global" });
  return {
    request_id: contract.conversation_request_id,
    thread_id: text(contract.thread_id) || text(input.thread_id) || "",
    operation: normalizedTurn.operation,
    domain: semanticDomain,
    capability_key: capabilityKey,
    scope: {
      estate_id: input.estate_id || null,
      building_id: text(recordOf(input.context).building_id || recordOf(input.context).buildingId) || null,
      home_id: input.home_id || null,
      room_id: input.room_id || object?.room_id || null,
    },
    target: canonicalTargetFromContract(contract, object),
    target_source: targetSourceForResolvedOyiTurn(options.targetSource),
    temporal_scope: contract.temporal_scope || null,
    authority: decideAuthorityForTurn({ ...normalizedTurn, domain: semanticDomain || normalizedTurn.domain || "global" }),
    workflow_id: options.workflowId || null,
    presentation_policy: presentationPolicyForContract(contract),
  };
}

function workflowForResolvedTurn(input: CanonicalConversationRequest, normalizedTurn: NormalizedUserTurn, contract: IntelligenceRequestContract, object: OperationalObject | null, resolvedTurn: ResolvedOyiTurn): OyiWorkflow {
  const unresolvedInputs = contract.scope_mode === "clarification"
    ? ["target"]
    : contract.operation_class === "compose"
      ? ["review_details"]
      : contract.operation_class === "execute_mutation" && !contract.mutation.confirmed
        ? ["approval"]
        : [];
  return createWorkflow({
    thread_id: resolvedTurn.thread_id || text(input.thread_id) || randomUUID(),
    request_id: contract.conversation_request_id,
    capability_key: resolvedTurn.capability_key,
    domain: (resolvedTurn.domain || normalizedTurn.domain || "global") as OyiDomain,
    operation: normalizedTurn.operation,
    target: canonicalTargetFromContract(contract, object),
    unresolved_inputs: unresolvedInputs,
    authority_decision: resolvedTurn.authority,
    proposed_action: contract.mutation.requested ? {
      command: contract.mutation.command,
      desired_state: contract.mutation.desired_state,
      risk_class: contract.mutation.risk_class,
    } : null,
    ttl_ms: unresolvedInputs.length ? 30 * 60 * 1000 : null,
  });
}

function resolvedConversationTurnFromContract(input: CanonicalConversationRequest, contract: IntelligenceRequestContract, object: OperationalObject | null): ResolvedConversationTurn {
  const semantic = semanticOperationAction(input.message, input.surface);
  const destination = semantic?.operation?.destination
    ? { key: semantic.operation.destination.key, parameters: recordOf(semantic.operation.parameters) as Record<string, string> }
    : null;
  const presentation = presentationPolicyForContract(contract);
  const operation = semantic && contract.operation_class === "navigate"
    ? semantic.operation.destination.mode === "module" ? "navigate_module" : "navigate_object"
    : operationForResolvedTurn(contract);
  return {
    rawMessage: text(input.message),
    intent: contract.intent,
    operation,
    scope: destination && contract.operation_class === "navigate" && semantic?.operation.destination.mode === "detail" ? "room" : scopeForResolvedTurn(contract),
    domain: domainForResolvedTurn(contract, object, semantic),
    object: contract.target.canonical_id && contract.target.object_type ? {
      type: contract.target.object_type,
      id: contract.target.canonical_id,
      label: contract.target.label,
      parent_id: contract.target.parent_id,
      room_id: object?.room_id || null,
      channel_code: contract.target.channel_code,
    } : null,
    destination,
    ambiguity: {
      required: contract.scope_mode === "clarification" || Boolean(contract.ambiguity?.required),
      question: contract.ambiguity?.question || null,
      candidates: (contract.ambiguity?.candidates || []).map((candidate) => ({
        type: text(candidate.object_type || candidate.type || "device"),
        id: text(candidate.device_id || candidate.id),
        label: cleanLabel(candidate.label, "Device"),
        detail: text(candidate.room_label || candidate.detail || candidate.device_family) || null,
      })),
    },
    authority: {
      allowed: !semantic || semantic.allowed,
      required_permission: semantic?.operation.destination.required_permission || null,
      confirmation_required: contract.mutation.requested || contract.mutation.confirmed,
      secure_review_required: /wallet|access|credential|payment|financial/i.test(`${contract.intent} ${contract.target.object_type || ""}`),
      denial_reason: semantic && !semantic.allowed ? "destination_not_available_on_surface" : null,
    },
    presentation: { mode: presentation.primary },
    temporal_scope: contract.temporal_scope,
    confidence: contract.confidence,
  };
}

function normalizedCopy(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function residentSafeLabel(value: unknown, fallback: string) {
  const label = text(value);
  if (!label || isUuid(label) || /^[0-9a-f-]{18,}$/i.test(label)) return fallback;
  return label;
}

export function canonicalIntelligenceContractForTest(input: { message: string; object?: OperationalObject | null; request?: Partial<CanonicalConversationRequest> }) {
  const request = {
    message: input.message,
    surface: "consumer",
    ...(input.request || {}),
  } as CanonicalConversationRequest;
  const authority = resolveCurrentTurnAuthorityDecision(request, input.object as ObjectCandidate | null, {
    roomPhrase: roomPhraseFromMessage(input.message),
    broadReadOnlyDeviceIntent: isExplicitBroadHomeReadIntent(input.message, text(input.request?.scope_mode_hint)),
    semanticOperation: interpretSemanticOperation(input.message),
  });
  const object = authority.mayUseInheritedExactTarget || !["device", "device_channel"].includes(text(input.object?.object_type))
    ? input.object || null
    : authority.scope === "home_scope" && input.request?.home_id
      ? {
        object_type: "home",
        canonical_id: input.request.home_id,
        label: "Home",
        estate_id: input.request.estate_id || null,
        building_id: null,
        home_id: input.request.home_id,
        room_id: null,
        parent_id: null,
        source_module: "home",
        capabilities: ["conversation"],
        current_state: null,
        health: null,
        permissions: ["read"],
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: null,
      } as OperationalObject
      : null;
  return resolveIntentContract(request, object, {
    objectType: object?.object_type || null,
    objectId: object?.canonical_id || null,
    objectName: object?.label || null,
  });
}

export function canonicalDeviceHealthAnswerForTest(input: { object: OperationalObject; facts?: Record<string, unknown>; message?: string }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "Is this device working?", object: input.object });
  return buildHealthAnswer(input.object, input.facts || {}, contract);
}

export function canonicalRecentChangesAnswerForTest(input: { facts: IntelligenceFact[]; message?: string }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "What changed recently?" });
  return buildRecentChangesAnswer(dedupeFacts(input.facts), contract);
}

export function canonicalConversationTableBlockForTest(input: { facts: IntelligenceFact[]; message?: string; object?: OperationalObject | null; request?: Partial<CanonicalConversationRequest> }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "What changed recently?", object: input.object || null, request: input.request });
  return tableBlockForContract(contract, dedupeFacts(input.facts));
}

export function canonicalResolvedTurnForTest(input: { message: string; object?: OperationalObject | null; surface?: OyiSurface; request?: Partial<CanonicalConversationRequest> }) {
  const request = {
    message: input.message,
    surface: input.surface || "consumer",
    ...(input.request || {}),
  } as CanonicalConversationRequest;
  const contract = canonicalIntelligenceContractForTest({ message: input.message, object: input.object || null, request });
  const object = contract.target.object_type === input.object?.object_type && contract.target.canonical_id === input.object?.canonical_id ? input.object || null : null;
  return {
    contract,
    resolved_turn: resolvedConversationTurnFromContract(request, contract, object),
    presentation_policy: presentationPolicyForContract(contract),
  };
}

export function canonicalTimeLabelForTest(value: unknown, mode: "time" | "date_time" | "relative" = "date_time") {
  return safeDateLabel(value, "Time unavailable", mode);
}

export function canonicalClarificationContinuationForTest(input: { message: string; pending: PendingClarification }) {
  const selected = matchPendingClarificationCandidate(input.pending, input.message);
  if (!selected) return null;
  return buildClarificationContinuationResponse({ message: input.message, surface: "consumer", thread_id: input.pending.thread_id } as CanonicalConversationRequest, input.pending, selected);
}

export function canonicalDeviceAvailabilityAnswerForTest(input: { facts: IntelligenceFact[]; message?: string }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "Show offline devices." });
  return buildDeviceAvailabilityInventoryAnswer(dedupeFacts(input.facts));
}

export function canonicalReportAnswerForTest(input: { facts: IntelligenceFact[]; object?: OperationalObject | null; message?: string }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "Generate today's home report", object: input.object || null });
  return buildReportAnswer(dedupeFacts(input.facts), input.object || null, contract);
}

function buildRecommendationAnswer(object: OperationalObject | null, facts: IntelligenceFact[]) {
  if (object && !["home", "room"].includes(object.object_type)) return recommendationFor(object, { message: "recommend", surface: "consumer" } as CanonicalConversationRequest);
  const availability = facts.filter((fact) => fact.fact_type === "device_availability");
  const notRecent = availability
    .filter((fact) => ["stale", "expired", "unknown", "provider_disconnected", "offline"].includes(text(recordOf(fact.value).availability)))
    .slice(0, 3);
  if (notRecent.length) {
    const names = notRecent.map((fact) => cleanLabel(fact.object?.label, "device")).join(", ");
    const scope = object?.object_type === "room" ? ` in ${object.label}` : "";
    return `Start with ${names}${scope}. These have the clearest availability or freshness concern in the authorised evidence.`;
  }
  const failures = facts.filter((fact) => /failed|unavailable|timeout|warning|critical/i.test(`${fact.statement} ${JSON.stringify(fact.value)}`));
  return failures.length ? "I recommend checking the unresolved item with the freshest failed evidence first." : "No immediate action is required from the evidence I can see.";
}

type CanonicalBuiltAnswer = {
  supported: boolean;
  response: Record<string, unknown>;
  facts: IntelligenceFact[];
};

async function buildCanonicalAuthoritativeAnswer(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined, contract: IntelligenceRequestContract, object: OperationalObject | null, hydrationFacts: Record<string, unknown>): Promise<CanonicalBuiltAnswer> {
  const builderKey = selectConversationBuilder(contract, object);
  if (builderKey) {
    logger.info("conversation_builder_selected", {
      request_id: contract.conversation_request_id,
      thread_id: contract.thread_id,
      intent: contract.intent,
      operation: contract.operation_class,
      scope: contract.scope_mode,
      object_type: object?.object_type || contract.target.object_type,
      object_id: object?.canonical_id || contract.target.canonical_id,
      builder_key: builderKey,
    });
  } else {
    logger.info("conversation_builder_not_found", {
      request_id: contract.conversation_request_id,
      thread_id: contract.thread_id,
      intent: contract.intent,
      operation: contract.operation_class,
      scope: contract.scope_mode,
      object_type: object?.object_type || contract.target.object_type,
      object_id: object?.canonical_id || contract.target.canonical_id,
    });
  }
  logger.info("conversation_evidence_plan_created", {
    conversation_request_id: contract.conversation_request_id,
    required_sources: contract.evidence_requirements,
    permissions: object?.permissions || [],
    loaders: [contract.answer_builder, object?.source_module || input.module || "scope"],
  });
  logger.info("conversation_evidence_plan_built", {
    conversation_request_id: contract.conversation_request_id,
    answer_builder: contract.answer_builder,
    evidence_requirements: contract.evidence_requirements,
  });
  const baseFacts = object ? [factFromObject(object, hydrationFacts, input, oisContext)] : [];
  let facts = baseFacts;
  let answer = "";
  let displayMode: CanonicalConversationResponse["display_mode"] = "conversation";
  let execution: Record<string, unknown> = { status: "read_only", current_turn_execution: false };
  if (contract.scope_mode === "clarification" || contract.operation_class === "clarify") {
    answer = contract.ambiguity?.question || "I need one clarification before I can continue. No action was performed.";
    displayMode = "detail";
    const pendingClarification = pendingClarificationWorkflow(contract);
    if (pendingClarification) pendingClarification.original_user_message = input.message;
    execution = { status: "clarification_required", current_turn_execution: false, pending_clarification: pendingClarification };
    const shaped = {
      id: `oyi-runtime:${contract.conversation_request_id}`,
      thread_id: contract.thread_id || randomUUID(),
      intent: contract.intent,
      understood: "Clarification is required before Oyi can continue.",
      message: answer,
      reply: answer,
      display_mode: displayMode,
      confidence: 0.72,
      execution,
      sources: [],
      cards: [],
      suggested_actions: (contract.ambiguity?.candidates || []).map((candidate) => ({
        type: "clarification_choice",
        label: cleanLabel(candidate.label || candidate.title || candidate.name, "Choice"),
        value: text(candidate.device_id || candidate.id),
      })),
      confirmations: [],
      canonical_request_contract: contract,
      resolved_turn: resolvedConversationTurnFromContract(input, contract, object),
      presentation_policy: presentationPolicyForContract(contract),
      facts,
    };
    return { supported: true, response: shaped, facts };
  }
  if (contract.operation_class === "execute_mutation") {
    if (builderKey !== "device_control" || !object || !["device", "device_channel"].includes(object.object_type)) {
      return { supported: false, response: {}, facts };
    }
    const targetLabel = contract.target.label || object.label;
    const state = text(contract.mutation.command || contract.mutation.desired_state);
    answer = state
      ? `I found ${targetLabel}. Please confirm before I send the ${state.toUpperCase()} command. No command was sent yet.`
      : `I found ${targetLabel}, but I need the exact command before sending anything. No command was sent.`;
    displayMode = "detail";
    execution = {
      status: "pending_confirmation",
      current_turn_execution: false,
      target_id: contract.target.canonical_id,
      channel_code: contract.target.channel_code,
      command: contract.mutation.command,
      desired_state: contract.mutation.desired_state,
    };
    const shaped = {
      id: `oyi-runtime:${contract.conversation_request_id}`,
      thread_id: contract.thread_id || randomUUID(),
      intent: contract.intent,
      understood: `Prepared a safe confirmation for ${targetLabel}.`,
      message: answer,
      reply: answer,
      display_mode: displayMode,
      confidence: 0.82,
      execution,
      sources: [],
      cards: [],
      suggested_actions: [],
      confirmations: state ? [{
        type: "device_command_confirmation",
        target_id: contract.target.canonical_id,
        target_type: contract.target.object_type,
        label: targetLabel,
        channel_code: contract.target.channel_code,
        command: contract.mutation.command,
        desired_state: contract.mutation.desired_state,
        risk: "device_control",
      }] : [],
      canonical_request_contract: contract,
      resolved_turn: resolvedConversationTurnFromContract(input, contract, object),
      presentation_policy: presentationPolicyForContract(contract),
      facts,
    };
    return { supported: true, response: shaped, facts };
  }
  logger.info("conversation_read_only_execution_blocked", {
    operation_class: contract.operation_class,
    intent: contract.intent,
    target: contract.target,
  });
  if (contract.intent === "module_navigation" || contract.intent === "domain_list") {
    const semantic = semanticOperationAction(input.message, input.surface);
    if (!semantic) return { supported: false, response: {}, facts };
    if (!semantic.allowed) {
      answer = `${semantic.operation.destination.label} is not available on this surface. I did not navigate or perform any action.`;
      displayMode = "conversation";
      execution = { status: "denied", current_turn_execution: false, destination: semantic.operation.destination.key };
    } else {
      answer = contract.intent === "module_navigation"
        ? `Opening ${semantic.operation.destination.label}… Your conversation will remain available here.`
        : `Here is the ${semantic.operation.destination.label} workspace.`;
      displayMode = "conversation";
      execution = { status: "navigation_ready", current_turn_execution: false, destination: semantic.operation.destination.key, route: semantic.route, return_thread_id: contract.thread_id || null, requested_operation: contract.operation_class };
    }
  } else if (contract.intent === "recent_changes" || contract.intent === "activity_history") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildRecentChangesAnswer(facts, contract);
    displayMode = "list";
  } else if (contract.intent === "device_availability_inventory") {
    facts = dedupeFacts([...facts, ...await loadHomeDeviceInventoryFacts(input, oisContext)]);
    answer = buildDeviceAvailabilityInventoryAnswer(facts, contract, input.message);
    displayMode = "list";
  } else if (contract.intent === "home_operational_summary") {
    facts = dedupeFacts([...facts, ...await loadHomeDeviceInventoryFacts(input, oisContext), ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildHomeOperationalSummaryAnswer(facts, contract);
    displayMode = "report";
  } else if (contract.intent === "wallet_operation" && contract.answer_builder === "wallet_history") {
    facts = dedupeFacts([...facts, ...await loadWalletTransactionFacts(input, oisContext, contract)]);
    answer = buildWalletHistoryAnswer(facts);
    displayMode = "list";
  } else if (contract.intent === "wallet_operation" && contract.answer_builder === "utility_spending") {
    facts = dedupeFacts([...facts, ...await loadWalletTransactionFacts(input, oisContext, contract)]);
    answer = buildUtilitySpendingAnswer(facts);
    displayMode = "list";
  } else if (contract.intent === "failure_history") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildFailureHistoryAnswer(facts, contract);
    displayMode = "list";
  } else if (contract.intent === "command_outcome") {
    const command = await loadLatestCommandFact(input, oisContext, object);
    answer = buildCommandOutcomeAnswer(command);
    execution = { status: "read_only", referenced_execution: command, current_turn_execution: false };
  } else if (contract.intent === "report") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildReportAnswer(facts, object, contract);
    displayMode = "report";
  } else if (contract.intent === "health_check") {
    answer = buildHealthAnswer(object, hydrationFacts, contract);
  } else if (contract.intent === "diagnosis" || contract.intent === "investigation" || contract.intent === "explanation") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildDiagnosisAnswer(object, hydrationFacts, facts, contract);
    displayMode = "detail";
  } else if (contract.intent === "relationships") {
    answer = buildRelationshipsAnswer(object, input, hydrationFacts, contract);
    displayMode = "detail";
  } else if (contract.intent === "current_state" || contract.intent === "evidence") {
    answer = buildCurrentStateAnswer(object, hydrationFacts, contract);
  } else if (contract.intent === "capability") {
    answer = buildCapabilityAnswer(object, input);
  } else if (contract.intent === "recommendation") {
    facts = dedupeFacts([...facts, ...await loadHomeDeviceInventoryFacts(input, oisContext), ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildRecommendationAnswer(object, facts);
    displayMode = "detail";
  } else {
    return { supported: false, response: {}, facts };
  }
  const deduped = dedupeFacts(facts);
  for (const fact of deduped.slice(0, 12)) {
    logger.info("conversation_fact_loaded", {
      fact_id: fact.fact_id,
      truth_state: fact.truth_state,
      freshness: fact.freshness,
    });
  }
  logger.info("conversation_answer_builder_selected", {
    builder: contract.answer_builder,
    builder_key: builderKey,
    reason: "canonical_supported_intent",
  });
  logger.info("conversation_execution_correlation_checked", {
    conversation_request_id: contract.conversation_request_id,
    execution_id: text(recordOf(execution.referenced_execution).id) || null,
    matched: false,
    reason: ["read", "report", "recommend", "navigate", "list"].includes(contract.operation_class) ? "read_only_current_turn" : "no_execution",
  });
  const safeAnswer = enforceResidentAnswerQuality(
    naturalizeUserCopy(stripInternalLanguage(answer)).replace(/^Done[.,]?\s*/i, ""),
    object
      ? `I checked ${object.label}, but the available evidence is not clean enough to summarize safely. I did not widen to other devices or perform any action.`
      : "I checked the authorised evidence, but it is not clean enough to summarize safely. I did not perform any action.",
  );
  const tableBlock = tableBlockForContract(contract, deduped);
  const cards = tableBlock ? [tableBlock] : [];
  const resolvedTurn = resolvedConversationTurnFromContract(input, contract, object);
  const presentationPolicy = presentationPolicyForContract(contract);
  const suppressAwareness = Boolean(presentationPolicy.suppress_equivalent_awareness) && presentationPolicy.primary === "table";
  const suppressSources = presentationPolicy.suppress_context_chips || presentationPolicy.primary === "table";
  const awarenessSummary = contract.intent === "recent_changes" || contract.intent === "activity_history"
    ? "Recent meaningful activity was reviewed."
    : contract.intent === "device_availability_inventory"
      ? "Home device availability was checked."
      : contract.intent === "home_operational_summary"
        ? "Home status was reviewed."
        : safeAnswer.split("\n")[0];
  const awareness = !suppressAwareness && normalizedCopy(awarenessSummary) && normalizedCopy(awarenessSummary) !== normalizedCopy(safeAnswer)
    ? {
      headline: contract.intent === "recent_changes" ? "Recent changes reviewed" : contract.intent === "report" ? "Report ready" : "Oyi answer grounded",
      summary: awarenessSummary,
      severity: "info",
    }
    : undefined;
  return {
    supported: true,
    facts: deduped,
    response: {
      id: `oyi-runtime:${contract.conversation_request_id}`,
      thread_id: contract.thread_id || randomUUID(),
      intent: contract.intent,
      understood: contract.target.label ? `Answering ${contract.intent.replace(/_/g, " ")} for ${contract.target.label}.` : `Answering ${contract.intent.replace(/_/g, " ")} for the current ${contract.scope_mode.replace(/_/g, " ")}.`,
      message: safeAnswer,
      reply: safeAnswer,
      display_mode: displayMode,
      confidence: deduped.length ? 0.88 : 0.72,
      execution,
      sources: suppressSources ? [] : deduped.slice(0, 6).map((fact) => ({ id: fact.source_id || fact.fact_id, type: fact.source_type, label: fact.statement, truth_state: fact.truth_state })),
      cards,
      suggested_actions: contract.intent === "module_navigation" || contract.intent === "domain_list"
        ? (semanticOperationAction(input.message, input.surface)?.allowed ? [semanticOperationAction(input.message, input.surface)?.action].filter(Boolean).map((action) => ({ ...action, return_thread_id: contract.thread_id || null, requested_operation: contract.operation_class, auto_navigation: contract.operation_class === "navigate" })) as Array<Record<string, unknown>> : [])
        : contract.intent === "device_availability_inventory"
          ? [{ type: "navigation", operation_class: "navigate", label: "Open Devices", route: "/devices", destination: { key: "devices.module", parameters: {} } }]
          : object ? contextualObjectActions(object, input).filter((action) => recordOf(action).risk !== "control").slice(0, 4) : [],
      ...(awareness ? { awareness } : {}),
      canonical_request_contract: contract,
      resolved_turn: resolvedTurn,
      presentation_policy: presentationPolicy,
      facts: deduped,
    },
  };
}

function safePersistenceError(error: unknown) {
  const err = recordOf(error);
  return {
    error_code: text(err.code || err.status || err.name) || null,
    error_message: text(err.message) || "Conversation persistence failed",
    error_details: text(err.details) || null,
    error_hint: text(err.hint) || null,
  };
}

function responseIdentifier(response: Record<string, unknown>, conversationRequestId: string) {
  return text(response.id) || `oyi-runtime:${conversationRequestId}`;
}

async function cleanupCanonicalTurnRows(input: { threadId: string; userMessageId: string; assistantMessageId: string; deleteThread: boolean }) {
  if (!isUuid(input.threadId)) return;
  try {
    await supabaseAdmin
      .from("oyi_conversation_messages")
      .delete()
      .eq("thread_id", input.threadId)
      .in("id", [input.userMessageId, input.assistantMessageId]);
    if (input.deleteThread) await cleanupCanonicalOrphanThread(input.threadId);
  } catch (error) {
    logger.warn("conversation_turn_compensation_failed", {
      thread_id: input.threadId,
      user_message_id: input.userMessageId,
      assistant_message_id: input.assistantMessageId,
      ...safePersistenceError(error),
    });
  }
}

async function persistCanonicalAuthoritativeMessages(actor: AuthUser | null, input: CanonicalConversationRequest, response: Record<string, unknown>, truth: CanonicalTruth, object: OperationalObject | null, contract: IntelligenceRequestContract) {
  const threadId = text(response.thread_id) || text(input.thread_id) || randomUUID();
  const newlyCreatedThread = !isUuid(text(input.thread_id));
  const now = new Date().toISOString();
  const assistantId = randomUUID();
  const userMessageId = randomUUID();
  const canonicalResponseId = responseIdentifier(response, contract.conversation_request_id);
  const existingTitle = await currentThreadTitle(threadId);
  const title = existingTitle && !genericThreadTitle(existingTitle) ? existingTitle : titleFromTurn(input.message, contract, object);
  const turnInterpretation = turnInterpretationFromContract(input, contract, {
    objectType: contract.target.object_type,
    objectId: contract.target.canonical_id,
    objectName: contract.target.label,
    confidence: contract.confidence,
  }, object ? "page_launch" : "thread_state");
  const contextLayers: ConversationContextLayers = {
    pageLaunchContext: recordOf(input.operational_object).canonical_id || input.target?.target_id ? {
      operational_object: input.operational_object || null,
      target: input.target || null,
    } : null,
    threadMemoryContext: object ? {
      object_type: object.object_type,
      canonical_id: object.canonical_id,
      label: object.label,
      parent_id: object.parent_id,
      channel_code: text(recordOf(object.metadata).channel_code) || contract.target.channel_code || null,
    } : null,
    currentTurnInterpretation: turnInterpretation,
    liveEvidenceContext: {
      required: turnInterpretation.requiresLiveEvidence,
      truth_state: truth.truth_state,
      freshness: truth.freshness,
      evidence_count: Array.isArray(response.facts) ? response.facts.length : 0,
    },
  };
  const executionRecord = recordOf(response.execution);
  const normalizedTurnMetadata = recordOf(executionRecord.normalized_turn);
  const resolvedOyiTurnMetadata = recordOf(executionRecord.resolved_oyi_turn);
  const workflowMetadata = recordOf(executionRecord.workflow);
  const actionMetadata = recordOf(executionRecord.action);
  const threadMetadata = {
    thread_state_version: 2,
    active_target: object ? { object_type: object.object_type, object_id: object.canonical_id, object_name: object.label } : null,
    conversation_state: {
      version: 1,
      entities: [],
      active_list: [],
      last_displayed_records: [],
      active_workflow: Object.keys(workflowMetadata).length
        ? workflowMetadata
        : executionRecord.pending_clarification
          ? { pending_clarification: recordOf(executionRecord.pending_clarification) }
          : null,
      conversation_state: Object.keys(workflowMetadata).length
        ? text(workflowMetadata.status) || "active"
        : executionRecord.pending_clarification ? "confirming" : "idle",
    },
    thread_memory_context: contextLayers.threadMemoryContext,
    conversation_context_layers: contextLayers,
    preview: cleanLabel(response.message || response.reply || input.message, "").slice(0, 180),
    last_intent: contract.intent,
    last_scope: contract.scope_mode,
    last_operational_object: object ? { type: object.object_type, id: object.canonical_id, label: object.label } : null,
    current_turn_execution: null,
    referenced_historical_execution: recordOf(response.execution).referenced_execution || null,
    canonical_request_contract: contract,
    resolved_turn: recordOf(response.resolved_turn),
    resolved_oyi_turn: resolvedOyiTurnMetadata,
    normalized_turn: normalizedTurnMetadata,
    workflow: workflowMetadata,
    action: actionMetadata,
    presentation_policy: recordOf(response.presentation_policy),
    turn_interpretation: turnInterpretation,
  };
  let failedStage = "unknown";
  try {
    logger.info("conversation_turn_persist_started", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      user_message_id: userMessageId,
      assistant_message_id: assistantId,
      response_id: canonicalResponseId,
      surface: input.surface,
      intent: contract.intent,
      builder_key: selectConversationBuilder(contract, object),
    });
    failedStage = "thread_upsert";
    const threadWrite = await supabaseAdmin.from("oyi_conversation_threads").upsert({
      id: threadId,
      user_id: actor?.id || null,
      surface: input.surface,
      estate_id: input.estate_id || actor?.estate_id || null,
      home_id: input.home_id || actor?.home_id || null,
      module: input.module || null,
      title,
      updated_at: now,
      metadata: threadMetadata,
    } as any);
    if (threadWrite.error) throw threadWrite.error;
    logger.info("conversation_persistence_stage_completed", { stage: "thread_upsert", table: "oyi_conversation_threads", thread_id: threadId, conversation_request_id: contract.conversation_request_id });

    failedStage = "user_message_insert";
    const userWrite = await supabaseAdmin.from("oyi_conversation_messages").insert({
      id: userMessageId,
      thread_id: threadId,
      user_id: actor?.id || null,
      role: "user",
      content: input.message,
      metadata: {
        surface: input.surface,
        module: input.module || null,
        conversation_request_id: contract.conversation_request_id,
        canonical_request_contract: contract,
        normalized_turn: normalizedTurnMetadata,
        resolved_oyi_turn: resolvedOyiTurnMetadata,
        workflow: workflowMetadata,
        action: actionMetadata,
        turn_interpretation: turnInterpretation,
        conversation_context_layers: contextLayers,
      },
      created_at: now,
    } as any);
    if (userWrite.error) throw userWrite.error;
    logger.info("conversation_turn_user_persisted", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      user_message_id: userMessageId,
    });

    failedStage = "assistant_message_insert";
    const assistantWrite = await supabaseAdmin.from("oyi_conversation_messages").insert({
      id: assistantId,
      thread_id: threadId,
      user_id: actor?.id || null,
      role: "assistant",
      content: cleanLabel(response.message || response.reply, "Oyi reviewed the current operational context."),
      cards: Array.isArray(response.cards) ? response.cards : [],
      sources: Array.isArray(response.sources) ? response.sources : [],
      suggested_actions: Array.isArray(response.suggested_actions) ? response.suggested_actions : [],
      metadata: {
        truth,
        operational_object: object,
        canonical_response_authoritative: true,
        single_authoritative_response: true,
        response_id: canonicalResponseId,
        assistant_message_id: assistantId,
        conversation_request_id: contract.conversation_request_id,
        canonical_request_contract: contract,
        resolved_turn: recordOf(response.resolved_turn),
        resolved_oyi_turn: resolvedOyiTurnMetadata,
        normalized_turn: normalizedTurnMetadata,
        workflow: workflowMetadata,
        action: actionMetadata,
        presentation_policy: recordOf(response.presentation_policy),
        warnings: Array.isArray(response.warnings) ? response.warnings : [],
        persistence_saved: true,
        turn_interpretation: turnInterpretation,
        conversation_context_layers: contextLayers,
        facts: Array.isArray(response.facts) ? response.facts : [],
      },
      created_at: new Date(Date.now() + 1).toISOString(),
    } as any);
    if (assistantWrite.error) throw assistantWrite.error;
    logger.info("conversation_turn_assistant_persisted", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      assistant_message_id: assistantId,
    });

    failedStage = "current_turn_verification";
    const verified = await verifyCanonicalCurrentTurnPersistence(threadId, userMessageId, assistantId, contract.conversation_request_id);
    if (!verified.ok) throw new Error(verified.error || "Conversation turn persistence could not be verified");
    logger.info("conversation_turn_persist_verified", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      user_message_id: userMessageId,
      assistant_message_id: assistantId,
    });

    failedStage = "thread_summary_update";
    const messageSummary = await verifyCanonicalThreadPersistence(threadId, 2);
    const summaryWrite = await supabaseAdmin
      .from("oyi_conversation_threads")
      .update({
        title,
        updated_at: new Date().toISOString(),
        metadata: {
          ...threadMetadata,
          message_count: messageSummary.count,
          last_user_message_id: userMessageId,
          last_assistant_message_id: assistantId,
          last_conversation_request_id: contract.conversation_request_id,
        },
      } as any)
      .eq("id", threadId);
    if (summaryWrite.error) throw summaryWrite.error;
    logger.info("conversation_persistence_stage_completed", { stage: "thread_summary_update", table: "oyi_conversation_threads", thread_id: threadId, conversation_request_id: contract.conversation_request_id });

    logger.info("conversation_final_answer_selected", {
      response_id: assistantId,
      builder: contract.answer_builder,
      truth_state: truth.truth_state,
      persistence_message_id: assistantId,
    });
    logger.info("conversation_authoritative_response_persisted", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      persisted_message_id: assistantId,
      response_state: contract.operation_class === "report" ? "report_ready" : contract.operation_class === "recommend" ? "recommendation" : "informational",
      final_answer_authority: "canonical",
    });
    logger.info(input.thread_id ? "conversation_thread_continued" : "conversation_thread_created", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      actor_id: actor?.id || null,
      surface: input.surface,
      intent: contract.intent,
      requested_scope: contract.scope_mode,
      target_type: contract.target.object_type,
      target_id: contract.target.canonical_id,
      confidence: contract.confidence,
    });
    return threadId;
  } catch (error) {
    await cleanupCanonicalTurnRows({ threadId, userMessageId, assistantMessageId: assistantId, deleteThread: newlyCreatedThread });
    (response as any).persistence_warning = "This answer was not saved to conversation history.";
    logger.warn("conversation_turn_persist_failed", {
      failed_stage: failedStage,
      table: failedStage === "thread_upsert" || failedStage === "thread_summary_update" ? "oyi_conversation_threads" : "oyi_conversation_messages",
      thread_id: threadId,
      user_message_id: userMessageId,
      assistant_message_id: assistantId,
      conversation_request_id: contract.conversation_request_id,
      actor_id: actor?.id || null,
      surface: input.surface,
      intent: contract.intent,
      builder_key: selectConversationBuilder(contract, object),
      ...safePersistenceError(error),
    });
    logger.warn("conversation_authoritative_persist_failed", { failed_stage: failedStage, thread_id: threadId, conversation_request_id: contract.conversation_request_id, ...safePersistenceError(error) });
    return null;
  }
}

async function verifyCanonicalCurrentTurnPersistence(threadId: string, userMessageId: string, assistantMessageId: string, conversationRequestId: string) {
  const result = await supabaseAdmin
    .from("oyi_conversation_messages")
    .select("id,thread_id,role,metadata")
    .in("id", [userMessageId, assistantMessageId]);
  if (result.error) return { ok: false, count: 0, error: result.error.message };
  const rows = Array.isArray(result.data) ? result.data : [];
  const byId = new Map(rows.map((row: any) => [String(row.id), row]));
  const user = byId.get(userMessageId) as any;
  const assistant = byId.get(assistantMessageId) as any;
  const matchesRequest = (row: any) => text(recordOf(row?.metadata).conversation_request_id) === conversationRequestId;
  const ok = Boolean(
    user
    && assistant
    && user.thread_id === threadId
    && assistant.thread_id === threadId
    && user.role === "user"
    && assistant.role === "assistant"
    && matchesRequest(user)
    && matchesRequest(assistant)
  );
  return { ok, count: rows.length, error: ok ? null : "Current conversation turn messages were not persisted with matching request ids" };
}

async function verifyCanonicalThreadPersistence(threadId: string, minimumMessages = 2) {
  const countResult = await supabaseAdmin
    .from("oyi_conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId);
  if (countResult.error) return { ok: false, count: 0, error: countResult.error.message };
  const count = Number(countResult.count || 0);
  return { ok: count >= minimumMessages, count, error: count >= minimumMessages ? null : "Conversation messages were not persisted" };
}

async function cleanupCanonicalOrphanThread(threadId: string) {
  if (!isUuid(threadId)) return;
  const summary = await verifyCanonicalThreadPersistence(threadId, 1);
  if (summary.count > 0) return;
  const { error } = await supabaseAdmin.from("oyi_conversation_threads").delete().eq("id", threadId);
  if (error) logger.warn("conversation_orphan_thread_cleanup_failed", { thread_id: threadId, error });
}

function shapeObjectConversation(input: CanonicalConversationRequest, response: Record<string, unknown>, object: OperationalObject | null) {
  if (!object) return response;
  const next = { ...response };
  const status = executionStatus(response);
  const existing = cleanLabel(response.reply || response.message, "");
  const executionReply = executionRealityReply(object, response);
  const reasoningReply = !executionReply ? operationalReasoningReply(input, response, object) : "";
  let objectReply = executionReply || reasoningReply || objectQuestionReply(input, response, object);
  if (!objectReply && !broadSummaryRequested(input.message) && looksLikeBroadFallback(existing)) objectReply = objectDefaultReply(object, input);
  if (!objectReply && !broadSummaryRequested(input.message) && /^(yes|yep|yeah|proceed|confirm|go ahead|do it|continue|execute)$/i.test(input.message.trim())) {
    objectReply = contextualConfirmationReply(object, response);
  }
  if (objectReply) {
    next.message = objectReply;
    next.reply = objectReply;
    next.understood = text(next.understood) || `I am answering for ${object.label}.`;
  }
  if (objectReply && /\b(evidence|how do you know|are you sure|provider confirm|confirmed|last updated|prediction|fact)\b/i.test(input.message)) {
    next.truth_note = truthLanguage(truthStateFromCompatibility(next), object);
  }
  const existingActions = Array.isArray(next.suggested_actions) ? next.suggested_actions : [];
  next.suggested_actions = contextualObjectActions(object, input).length
    ? contextualObjectActions(object, input)
    : existingActions;
  if (next.message) next.message = naturalizeUserCopy(next.message);
  if (next.reply) next.reply = naturalizeUserCopy(next.reply);
  return next;
}

export function canonicalObjectConversationForTest(input: { message: string; object: OperationalObject; response?: Record<string, unknown>; request?: Partial<CanonicalConversationRequest> }) {
  const request = {
    message: input.message,
    surface: "consumer" as const,
    ...input.request,
  } as CanonicalConversationRequest;
  return shapeObjectConversation(request, input.response || { message: "There are 27 devices connected.", execution: { status: "read_only" } }, input.object);
}

function compatibilityInputFromCanonical(input: CanonicalConversationRequest, operationalObject: OperationalObject | null): OyiChatInput {
  const objectMetadata = recordOf(operationalObject?.metadata);
  return {
    surface: input.surface,
    estate_id: input.estate_id || operationalObject?.estate_id || null,
    home_id: input.home_id || operationalObject?.home_id || null,
    module: input.module || operationalObject?.source_module || null,
    role: input.role || null,
    message: input.message,
    thread_id: input.thread_id || null,
    context: input.context as OisContext | null,
    device_id: input.device_id || (operationalObject?.object_type === "device" ? operationalObject.canonical_id : operationalObject?.object_type === "device_channel" ? operationalObject.parent_id : null),
    device_name: input.device_name || (operationalObject?.object_type === "device" || operationalObject?.object_type === "device_channel" ? operationalObject.label : null),
    room_id: input.room_id || operationalObject?.room_id || null,
    room_name: input.room_name || null,
    control_profile: input.control_profile || null,
    primary_state: input.primary_state || operationalObject?.current_state || null,
    health_status: input.health_status || operationalObject?.health || null,
    supported_controls: input.supported_controls || operationalObject?.capabilities || null,
    channel_definitions: input.channel_definitions || (Array.isArray(objectMetadata.channel_definitions) ? objectMetadata.channel_definitions as Array<Record<string, unknown>> : null),
    memory_summary: input.memory_summary || null,
    relationships: input.relationships || (operationalObject?.relationships as Record<string, unknown>) || null,
    predictive_findings: input.predictive_findings || null,
    recent_executions: input.recent_executions || null,
    active_scenes: input.active_scenes || null,
    active_automations: input.active_automations || null,
    conversation_context: {
      ...(input.conversation_context || {}),
      canonical_operational_object: operationalObject,
      canonical_truth_requested: true,
    },
    persist: false,
  };
}

async function persistCanonicalShapedAssistantMessage(threadId: string, response: Record<string, unknown>, truth: CanonicalTruth, operationalObject: OperationalObject | null) {
  if (!threadId) return;
  try {
    const { data } = await supabaseAdmin
      .from("oyi_conversation_messages")
      .select("id,metadata")
      .eq("thread_id", threadId)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.id) return;
    const metadata = recordOf((data as any).metadata);
    await supabaseAdmin
      .from("oyi_conversation_messages")
      .update({
        content: cleanLabel(response.message || response.reply, "Oyi reviewed the current operational context."),
        suggested_actions: Array.isArray(response.suggested_actions) ? response.suggested_actions : [],
        metadata: {
          ...metadata,
          truth,
          operational_object: operationalObject,
          evidence_references: truth.object?.evidence_references || [],
          active_target: operationalObject ? {
            object_type: operationalObject.object_type,
            object_id: operationalObject.canonical_id,
            object_name: operationalObject.label,
            module: operationalObject.source_module,
          } : null,
          canonical_response_shaped: true,
        },
      } as any)
      .eq("id", data.id);
  } catch {
    // Conversation persistence is best effort; the live canonical response remains authoritative.
  }
}

export async function runCanonicalConversation(actor: AuthUser | null, oisContext: OisContext | null | undefined, input: CanonicalConversationRequest): Promise<CanonicalConversationResponse> {
  input = sanitizeConversationInputTargets(input);
  const normalizedTurn = normalizeUserTurn(input.message);
  logger.info("oyi_turn_normalized", {
    request_id: text(recordOf(input.context).request_id) || null,
    thread_id: input.thread_id || null,
    domain: normalizedTurn.domain,
    operation: normalizedTurn.operation,
    correction_count: normalizedTurn.corrections.length,
    entity_count: normalizedTurn.entities.length,
    reference_count: normalizedTurn.references.length,
    mutation_intent: normalizedTurn.mutation_intent,
  });
  const threadContext = await loadOyiConversationContext(actor, {
    surface: input.surface,
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    thread_id: input.thread_id || null,
    message: input.message,
  } as OyiChatInput);
  const pendingClarification = pendingClarificationFromThread(threadContext);
  if (pendingClarification) {
    if (userCancelledClarification(input.message)) {
      const answer = "Cancelled. No command was sent.";
      const contract = resolveIntentContract(input, null, { objectType: null, objectId: null, objectName: null, confidence: 0.8 });
      const shaped = {
        id: `oyi-runtime:${contract.conversation_request_id}`,
        thread_id: text(input.thread_id) || randomUUID(),
        intent: "clarification_cancelled",
        understood: "Pending clarification cancelled.",
        message: answer,
        reply: answer,
        display_mode: "conversation" as const,
        confidence: 0.8,
        execution: { status: "cancelled", current_turn_execution: false, pending_clarification: null },
        cards: [],
        sources: [],
        suggested_actions: [],
        confirmations: [],
        resolved_turn: resolvedConversationTurnFromContract(input, contract, null),
        presentation_policy: presentationPolicyForContract(contract),
        facts: [],
      };
      const truth = canonicalTruthFor(shaped, null);
      const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, shaped, truth, null, contract);
      return {
        id: shaped.id,
        thread_id: persistedThreadId || null,
        intent: shaped.intent,
        understood: shaped.understood,
        summary: answer,
        answer,
        reply: answer,
        message: answer,
        display_mode: "conversation",
        truth,
        operational_object: null,
        context: { surface: input.surface, estate_id: input.estate_id || oisContext?.estate_id || null, home_id: input.home_id || oisContext?.home_id || null, module: input.module || oisContext?.module || null, context_source: "thread_state", warnings: [] },
        resolved_turn: recordOf(shaped.resolved_turn) as ResolvedConversationTurn,
        execution: shaped.execution,
        cards: [],
        sources: [],
        suggested_actions: [],
        presentation_policy: recordOf(shaped.presentation_policy) as ConversationPresentationPolicy,
        confirmations: [],
        warnings: persistedThreadId ? [] : ["This answer was not saved to conversation history."],
        persistence_saved: Boolean(persistedThreadId),
        source: "oyi_canonical_runtime",
        safe_mode: true,
        approvalRequired: false,
        requiresConfirmation: false,
      };
    }
    const selectedCandidate = matchPendingClarificationCandidate(pendingClarification, input.message);
    if (selectedCandidate) {
      const contract = resolveIntentContract(input, null, { objectType: "device", objectId: text(selectedCandidate.device_id || selectedCandidate.id), objectName: text(selectedCandidate.label || selectedCandidate.title || selectedCandidate.name), confidence: 0.82 });
      const shaped = buildClarificationContinuationResponse(input, pendingClarification, selectedCandidate);
      const truth = canonicalTruthFor(shaped, null);
      const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, shaped, truth, null, contract);
      return {
        id: shaped.id,
        thread_id: persistedThreadId || null,
        intent: shaped.intent,
        understood: shaped.understood,
        summary: shaped.message,
        answer: shaped.message,
        reply: shaped.reply,
        message: shaped.message,
        display_mode: "detail",
        truth,
        operational_object: null,
        context: { surface: input.surface, estate_id: input.estate_id || oisContext?.estate_id || null, home_id: input.home_id || oisContext?.home_id || null, module: input.module || oisContext?.module || null, context_source: "thread_state", warnings: [] },
        resolved_turn: recordOf(shaped.resolved_turn) as ResolvedConversationTurn,
        execution: shaped.execution,
        cards: shaped.cards,
        sources: shaped.sources,
        suggested_actions: shaped.suggested_actions,
        presentation_policy: recordOf(shaped.presentation_policy) as ConversationPresentationPolicy,
        confirmations: shaped.confirmations,
        warnings: persistedThreadId ? [] : ["This answer was not saved to conversation history."],
        persistence_saved: Boolean(persistedThreadId),
        source: "oyi_canonical_runtime",
        safe_mode: true,
        approvalRequired: Boolean(shaped.confirmations.length),
        requiresConfirmation: Boolean(shaped.confirmations.length),
      };
    }
  }
  const explicitCandidate = explicitObjectCandidate(input);
  const threadCandidate = threadObjectCandidate(threadContext);
  const activeContextRecord = recordOf(input.active_intelligence_context || recordOf(input.context).active_intelligence_context || recordOf(recordOf(input.context).runtime_context).active_context || recordOf(input.conversation_context).active_context);
  const selectedSubobjectRecord = recordOf(activeContextRecord.selected_subobject || recordOf(input.conversation_context).selected_subobject);
  const scopeHint = text(input.scope_mode_hint || recordOf(input.conversation_context).scope_mode_hint || recordOf(input.context).scope_mode_hint);
  const broadReadOnlyDeviceIntent = isExplicitBroadHomeReadIntent(input.message || "", scopeHint);
  const initialRoomPhrase = !broadReadOnlyDeviceIntent ? roomPhraseFromMessage(input.message || "") : "";
  const initialSemanticOperation = interpretSemanticOperation(input.message || "");
  const inheritedCandidate = explicitCandidate || threadCandidate;
  const currentTurnAuthority = resolveCurrentTurnAuthorityDecision(input, inheritedCandidate, {
    roomPhrase: initialRoomPhrase,
    broadReadOnlyDeviceIntent,
    semanticOperation: initialSemanticOperation,
  });
  const inheritedExactTargetAllowed = currentTurnAuthority.mayUseInheritedExactTarget && canInheritedExactTargetSatisfyCurrentTurn(input, inheritedCandidate, {
    roomPhrase: initialRoomPhrase,
    broadReadOnlyDeviceIntent,
    semanticOperation: initialSemanticOperation,
  });
  const requestedChannel = requestedChannelCode(input.message || "");
  const shouldRebindRequestedChannel = Boolean(requestedChannel && isControlRequest(input.message || "") && !broadReadOnlyDeviceIntent);
  if (Object.keys(activeContextRecord).length) {
    logger.info("conversation_page_launch_context_received", {
      request_id: text(recordOf(input.context).request_id) || null,
      thread_id: input.thread_id || null,
      context_id: text(activeContextRecord.context_id) || null,
      context_version: Number(activeContextRecord.context_version) || null,
      target_type: text(recordOf(activeContextRecord.primary_object).object_type || recordOf(input.operational_object).object_type) || null,
      target_id: text(recordOf(activeContextRecord.primary_object).canonical_id || recordOf(input.operational_object).canonical_id) || null,
    });
  }
  if (threadCandidate) {
    logger.info("conversation_thread_memory_restored", {
      thread_id: input.thread_id || null,
      target_type: threadCandidate.object_type,
      target_id: threadCandidate.canonical_id,
      target_source: threadCandidate.source,
    });
  }
  logger.info("conversation_current_turn_authority_resolved", {
    request_id: text(recordOf(input.context).request_id) || null,
    thread_id: input.thread_id || null,
    operation: currentTurnAuthority.operation,
    domain: currentTurnAuthority.domain,
    scope: currentTurnAuthority.scope,
    explicit_room_phrase: currentTurnAuthority.explicitRoomPhrase,
    explicit_object_phrase: currentTurnAuthority.explicitObjectPhrase,
    temporal_scope: currentTurnAuthority.temporalScope,
    inherited_object_type: inheritedCandidate?.object_type || null,
    inherited_object_id: inheritedCandidate?.canonical_id || null,
    may_use_inherited_exact_target: currentTurnAuthority.mayUseInheritedExactTarget,
    rejection_reason: currentTurnAuthority.rejectionReason,
  });
  if (broadReadOnlyDeviceIntent) {
    logger.info("read_only_command_execution_blocked", {
      intent: isReadOnlyBroadDeviceIntent(input.message || "") ? "show_offline_devices" : "broad_home_read",
      target: "home_scope",
      attempted_operation: "device_command_context_reuse",
    });
    logger.info("conversation_inherited_target_cleared", {
      reason: "explicit_broad_read_turn",
      previous_target_id: text(recordOf(input.operational_object).canonical_id || input.target?.target_id || selectedSubobjectRecord.canonical_id) || null,
      scope_hint: scopeHint || null,
    });
  }
  if (inheritedCandidate && !inheritedExactTargetAllowed) {
    logger.info("conversation_inherited_target_rejected", {
      reason: broadReadOnlyDeviceIntent ? "explicit_broad_scope" : initialRoomPhrase ? "explicit_room_scope" : initialSemanticOperation ? "explicit_domain_or_navigation" : currentTurnExplicitlyGlobal(input.message || "") ? "global_turn" : "not_referential",
      inherited_target_type: inheritedCandidate.object_type,
      inherited_target_id: inheritedCandidate.canonical_id,
      scope_hint: scopeHint || null,
    });
  } else if (inheritedCandidate && inheritedExactTargetAllowed) {
    logger.info("conversation_inherited_target_accepted", {
      reason: currentTurnReferencesInheritedTarget(input.message || "") ? "referential_turn" : "exact_scope_hint",
      inherited_target_type: inheritedCandidate.object_type,
      inherited_target_id: inheritedCandidate.canonical_id,
      scope_hint: scopeHint || null,
    });
  }
  let targetResolution = resolveConversationTarget({
    query: input.message,
    explicitTarget: inheritedExactTargetAllowed ? input.target as any : null,
    selectedObject: inheritedExactTargetAllowed ? (Object.keys(selectedSubobjectRecord).length ? selectedSubobjectRecord as any : input.operational_object as any) : null,
    pageObject: inheritedExactTargetAllowed && explicitCandidate ? {
      object_type: explicitCandidate.object_type,
      object_id: explicitCandidate.canonical_id,
      object_name: explicitCandidate.label || null,
    } : null,
    threadTarget: inheritedExactTargetAllowed && threadCandidate ? {
      object_type: threadCandidate.object_type,
      object_id: threadCandidate.canonical_id,
      object_name: threadCandidate.label,
    } : null,
    context: {
      surface: input.surface,
      module: input.module || oisContext?.module || "other",
      route: text(recordOf(input.context).route),
      estate_id: input.estate_id || oisContext?.estate_id || null,
      building_id: text(recordOf(input.context).building_id || recordOf(input.context).buildingId) || null,
      home_id: input.home_id || oisContext?.home_id || null,
      room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
      object_type: inheritedExactTargetAllowed ? explicitCandidate?.object_type || null : null,
      object_id: inheritedExactTargetAllowed ? explicitCandidate?.canonical_id || null : null,
      object_name: inheritedExactTargetAllowed ? explicitCandidate?.label || null : null,
      active_intelligence_context: activeContextRecord,
    } as any,
  });
  if (shouldRebindRequestedChannel && requestedChannel && targetResolution.objectType === "device_channel" && targetResolution.objectId) {
    const parsed = parseDeviceChannelIdentity(targetResolution.objectId);
    if (parsed.parent_id && parsed.channel_code !== requestedChannel) {
      targetResolution = {
        ...targetResolution,
        objectId: `${parsed.parent_id}:${requestedChannel}`,
        objectName: text(targetResolution.objectName).replace(/Channel\s+[123]/i, requestedChannel.replace(/^switch_/i, "Channel ")) || targetResolution.objectName,
      } as any;
      logger.info("conversation_target_scope_normalized", {
        reason: "explicit_channel_requested",
        requested_channel: requestedChannel,
        previous_channel: parsed.channel_code,
        resolved_target_id: targetResolution.objectId,
      });
    }
  }
  const namedControlPhrase = currentTurnAllowsDeviceResolution(input.message || "") ? namedDevicePhraseFromControlMessage(input.message || "") : null;
  if (namedControlPhrase && !broadReadOnlyDeviceIntent) {
    const namedResolution = await resolveNamedDeviceForRead(actor, oisContext, input, namedControlPhrase);
    if (namedResolution.status === "resolved") {
      targetResolution = {
        ...targetResolution,
        objectType: namedResolution.channel_code ? "device_channel" : "device",
        objectId: namedResolution.channel_code ? `${namedResolution.device_id}:${namedResolution.channel_code}` : namedResolution.device_id,
        objectName: namedResolution.label,
        source: "resolved_named_reference",
        confidence: namedResolution.confidence,
      } as any;
      logger.info("conversation_target_bound", {
        request_id: text(recordOf(input.context).request_id) || null,
        target_type: targetResolution.objectType,
        target_id: targetResolution.objectId,
        target_source: "current_turn_named_device",
        phrase: namedControlPhrase,
        confidence: namedResolution.confidence,
      });
    } else if (namedResolution.status === "ambiguous") {
      const ambiguousTargetResolution: any = {
        ...targetResolution,
        objectType: null,
        objectId: null,
        objectName: namedControlPhrase,
        source: "ambiguous",
        confidence: 0.52,
        ambiguous: true,
        clarificationQuestion: `Which ${namedControlPhrase} do you mean?`,
        candidates: namedResolution.candidates,
      };
      targetResolution = ambiguousTargetResolution;
      logger.info("conversation_target_bound", {
        request_id: text(recordOf(input.context).request_id) || null,
        target_source: "current_turn_named_device_ambiguous",
        phrase: namedControlPhrase,
        candidates: namedResolution.candidates.length,
      });
    } else {
      const missingTargetResolution: any = {
        ...targetResolution,
        objectType: null,
        objectId: null,
        objectName: namedControlPhrase,
        source: "resolved_named_reference",
        confidence: 0.5,
        notFound: true,
      };
      targetResolution = missingTargetResolution;
      logger.info("conversation_target_bound", {
        request_id: text(recordOf(input.context).request_id) || null,
        target_source: "current_turn_named_device_not_found",
        phrase: namedControlPhrase,
      });
    }
  }
  const roomPhrase = initialRoomPhrase;
  if (roomPhrase && !namedControlPhrase) {
    const roomResolution = await resolveRoomForRead(actor, oisContext, input, roomPhrase);
    if (roomResolution.status === "resolved") {
      targetResolution = {
        ...targetResolution,
        objectType: "room",
        objectId: roomResolution.room_id,
        objectName: roomResolution.label,
        source: "current_turn_room_reference",
        confidence: roomResolution.confidence,
      } as any;
      input = { ...input, room_id: roomResolution.room_id, room_name: roomResolution.label };
      logger.info("conversation_target_bound", {
        request_id: text(recordOf(input.context).request_id) || null,
        target_type: "room",
        target_id: roomResolution.room_id,
        target_source: "current_turn_room_reference",
        phrase: roomPhrase,
        confidence: roomResolution.confidence,
      });
    } else if (roomResolution.status === "ambiguous") {
      targetResolution = {
        ...targetResolution,
        objectType: null,
        objectId: null,
        objectName: roomPhrase,
        source: "ambiguous",
        confidence: 0.52,
        ambiguous: true,
        clarificationQuestion: `Which ${roomPhrase} do you mean?`,
        candidates: roomResolution.candidates.map((candidate) => ({ type: "room", id: candidate.room_id, label: candidate.label })),
      } as any;
    }
  }
  if ((broadReadOnlyDeviceIntent || currentTurnAuthority.scope === "home_scope") && (input.home_id || oisContext?.home_id)) {
    targetResolution = {
      ...targetResolution,
      objectType: "home",
      objectId: input.home_id || oisContext?.home_id || null,
      objectName: text(recordOf(input.context).home_name || recordOf(input.context).homeName) || "Home",
      source: "home_scope",
      confidence: Math.max(Number(targetResolution.confidence) || 0, 0.9),
    };
    logger.info("conversation_explicit_scope_applied", {
      request_id: text(recordOf(input.context).request_id) || null,
      scope: "home_scope",
      target_id: targetResolution.objectId,
      source: "current_turn_explicit_scope",
    });
  }
  const visibleStateRecord = recordOf(activeContextRecord.visible_state || recordOf(input.conversation_context).visible_state || recordOf(recordOf(input.operational_object).metadata).visible_state);
  logger.info("conversation_target_resolved", {
    request_id: text(recordOf(input.context).request_id) || null,
    context_id: text(activeContextRecord.context_id) || null,
    context_version: Number(activeContextRecord.context_version) || null,
    object_type: targetResolution.objectType,
    canonical_id: targetResolution.objectId,
    visible_target_id: text(recordOf(activeContextRecord.visible_state).object_id || recordOf(recordOf(activeContextRecord.visible_state).summary).object_id) || null,
    submitted_target_id: text(recordOf(input.operational_object).canonical_id || input.target?.target_id) || null,
    resolved_target_id: targetResolution.objectId || null,
    target_consistency: (text(recordOf(input.operational_object).canonical_id || input.target?.target_id) && text(recordOf(input.operational_object).canonical_id || input.target?.target_id) !== text(targetResolution.objectId))
      ? "mismatch"
      : "matched",
    target_override_reason: targetResolution.source,
    target_source: targetResolution.source,
    target_confidence: targetResolution.confidence,
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  });
  let hydration = await hydrateCanonicalTarget({
    actor,
    oisContext,
    target: targetResolution,
    activeContext: activeContextRecord,
    visibleState: Object.keys(visibleStateRecord).length ? visibleStateRecord : null,
  });
  let resolved: ResolvedOperationalObject = {
    object: hydration.object,
    source: broadReadOnlyDeviceIntent ? "home_scope" : explicitCandidate?.source || threadCandidate?.source || "page_selection",
    warnings: hydration.status === "hydrated" ? [] : hydration.reason ? [hydration.reason] : [],
  };
  if (!inheritedExactTargetAllowed && resolved.object && ["device", "device_channel"].includes(resolved.object.object_type) && !["resolved_named_reference", "current_turn_room_reference", "home_scope"].includes(text(targetResolution.source))) {
    resolved = { object: null, source: "home_scope", warnings: [] };
  }
  if (!resolved.object && inheritedExactTargetAllowed && targetResolution.objectType !== "home" && targetResolution.source !== "explicit_canonical_target" && targetResolution.source !== "selected_subobject" && targetResolution.source !== "active_page_object") {
    const preferredCandidate = inheritedCandidate;
    resolved = await resolveCandidate(actor, oisContext, preferredCandidate);
  }
  const requestContract = resolveIntentContract(input, resolved.object, targetResolution as any);
  const turnInterpretation = turnInterpretationFromContract(input, requestContract, targetResolution as any, resolved.source);
  const resolvedOyiTurn = resolvedOyiTurnFromContract(input, normalizedTurn, requestContract, resolved.object, { targetSource: targetResolution.source || resolved.source });
  const activeWorkflow = workflowForResolvedTurn(input, normalizedTurn, requestContract, resolved.object, resolvedOyiTurn);
  const domainCapability = getDomainCapability((resolvedOyiTurn.domain || normalizedTurn.domain || "global") as OyiDomain);
  const builderForTurn = selectConversationBuilder(requestContract, resolved.object);
  logger.info("oyi_turn_resolved", {
    request_id: resolvedOyiTurn.request_id,
    thread_id: resolvedOyiTurn.thread_id,
    domain: resolvedOyiTurn.domain,
    operation: resolvedOyiTurn.operation,
    capability_key: resolvedOyiTurn.capability_key,
    target_type: resolvedOyiTurn.target?.object_type || null,
    target_id: resolvedOyiTurn.target?.canonical_id || null,
    target_source: resolvedOyiTurn.target_source,
  });
  logger.info("oyi_target_authority_decided", {
    request_id: resolvedOyiTurn.request_id,
    thread_id: resolvedOyiTurn.thread_id,
    domain: resolvedOyiTurn.domain,
    operation: resolvedOyiTurn.operation,
    authority_result: resolvedOyiTurn.authority.allowed ? "allowed" : "denied",
    tier: resolvedOyiTurn.authority.tier,
    approval_required: resolvedOyiTurn.authority.approval_required,
    secure_review_required: resolvedOyiTurn.authority.secure_review_required,
  });
  if (domainCapability) {
    logger.info("oyi_capability_selected", {
      request_id: resolvedOyiTurn.request_id,
      thread_id: resolvedOyiTurn.thread_id,
      domain: domainCapability.domain,
      operation: resolvedOyiTurn.operation,
      capability_key: resolvedOyiTurn.capability_key,
      builder_key: builderForTurn,
    });
  } else {
    logger.info("oyi_capability_missing", {
      request_id: resolvedOyiTurn.request_id,
      thread_id: resolvedOyiTurn.thread_id,
      domain: resolvedOyiTurn.domain,
      operation: resolvedOyiTurn.operation,
      capability_key: resolvedOyiTurn.capability_key,
    });
  }
  logger.info("oyi_workflow_created", {
    request_id: activeWorkflow.request_id,
    thread_id: activeWorkflow.thread_id,
    workflow_id: activeWorkflow.workflow_id,
    domain: activeWorkflow.domain,
    operation: activeWorkflow.operation,
    status: activeWorkflow.status,
    target_type: activeWorkflow.target?.object_type || null,
  });
  logger.info("oyi_presentation_policy_applied", {
    request_id: resolvedOyiTurn.request_id,
    thread_id: resolvedOyiTurn.thread_id,
    domain: resolvedOyiTurn.domain,
    operation: resolvedOyiTurn.operation,
    primary: resolvedOyiTurn.presentation_policy.primary,
  });
  logger.info("conversation_turn_interpreted", {
    request_id: requestContract.conversation_request_id,
    correlation_id: text(recordOf(input.context).correlation_id) || null,
    runtime_id: text(recordOf(input.context).runtime_id) || null,
    thread_id: requestContract.thread_id,
    actor_id: actor?.id || null,
    surface: input.surface,
    intent: turnInterpretation.intent,
    operation_class: turnInterpretation.operationClass,
    requested_scope: turnInterpretation.requestedScope,
    target_type: requestContract.target.object_type,
    target_id: requestContract.target.canonical_id,
    target_source: targetResolution.source,
    confidence: turnInterpretation.confidence,
  });
  if (turnInterpretation.pronounReference.used) {
    logger.info("conversation_pronoun_resolved", {
      request_id: requestContract.conversation_request_id,
      thread_id: requestContract.thread_id,
      phrase: turnInterpretation.pronounReference.phrase,
      resolved_from: turnInterpretation.pronounReference.resolvedFrom,
      target_id: requestContract.target.canonical_id,
    });
  }
  if (turnInterpretation.requiresLiveEvidence) {
    logger.info("conversation_live_evidence_required", {
      request_id: requestContract.conversation_request_id,
      intent: requestContract.intent,
      target_id: requestContract.target.canonical_id,
      scope: requestContract.scope_mode,
    });
  }
  if (!resolved.object) {
    const scopeObject = constructBroadScopeObject(input, oisContext || null, requestContract);
    if (scopeObject) {
      resolved = {
        object: scopeObject,
        source: "home_scope",
        warnings: hydration.status === "hydrated" ? [] : hydration.reason ? [hydration.reason] : [],
      };
      hydration = {
        ...hydration,
        object: scopeObject,
        status: "hydrated",
        source: "canonical_backend",
        truth_state: "observed",
        facts: {},
      } as any;
      logger.info("conversation_target_bound", {
        request_id: requestContract.conversation_request_id,
        target_type: scopeObject.object_type,
        target_id: scopeObject.canonical_id,
        target_source: "current_turn_explicit_scope",
        confidence: requestContract.confidence,
      });
    }
  }
  const moduleFacts = buildModuleFacts({
    surface: input.surface,
    module: input.module || oisContext?.module || "other",
    route: text(recordOf(input.context).route),
    estate_id: input.estate_id || oisContext?.estate_id || null,
    building_id: text(recordOf(input.context).building_id || recordOf(input.context).buildingId) || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
    object_type: resolved.object?.object_type || null,
    object_id: resolved.object?.canonical_id || null,
    object_name: resolved.object?.label || null,
    privacy_class: resolved.object?.home_id ? "home_private" : "building_operational",
  } as any, {
    capabilities: resolved.object?.capabilities || [],
    current_state: resolved.object?.current_state || null,
    health: resolved.object?.health || null,
    relationships: resolved.object?.relationships || {},
    hydration_status: hydration.status,
    hydration_source: hydration.source,
    hydration_truth_state: hydration.truth_state,
    hydration_facts: hydration.facts,
    hydration_evidence: hydration.evidence,
  });
  logger.info("conversation_request_contract_resolved", {
    request_id: requestContract.conversation_request_id,
    thread_id: requestContract.thread_id,
    submitted_target: {
      operational_object_id: text(recordOf(input.operational_object).canonical_id) || null,
      target_id: input.target?.target_id || null,
    },
    resolved_target: requestContract.target,
    operation_class: requestContract.operation_class,
    intent: requestContract.intent,
    scope: requestContract.scope_mode,
    target: requestContract.target,
    temporal_scope: requestContract.temporal_scope,
    builder: requestContract.answer_builder,
  });
  const refreshedHydration = await requestBoundedLiveEvidence({
    contract: requestContract,
    object: resolved.object,
    conversationTarget: targetResolution,
    actor,
    oisContext,
    activeContext: activeContextRecord,
    visibleState: Object.keys(visibleStateRecord).length ? visibleStateRecord : null,
  });
  if (refreshedHydration?.status === "hydrated") {
    hydration = refreshedHydration;
    resolved = {
      object: hydration.object,
      source: "page_selection",
      warnings: [],
    };
  }
  const exactTargetRequested = !Boolean((targetResolution as any).ambiguous) && !Boolean((targetResolution as any).notFound) && Boolean(inheritedExactTargetAllowed || ["explicit_canonical_target", "selected_subobject", "active_page_object", "resolved_named_reference"].includes(targetResolution.source));
  if (exactTargetRequested && !resolved.object) {
    const label = cleanLabel(explicitCandidate?.label || targetResolution.objectName, "the selected item");
    const answer = `I know you are asking about ${label}, but I could not retrieve its current information in this scope.`;
    const shaped = {
      id: `oyi-runtime:${randomUUID()}`,
      thread_id: text(input.thread_id) || randomUUID(),
      intent: "target_unavailable",
      understood: `Inspect ${label}`,
      message: answer,
      reply: answer,
      display_mode: "detail",
      confidence: 0.86,
      awareness: {
        headline: `${label} is unavailable to Oyi Core right now`,
        summary: "The active context was preserved, and Oyi did not widen to unrelated records.",
        severity: "attention",
      },
    };
    const truth = canonicalTruthFor(shaped, null);
    const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, shaped, truth, null, requestContract);
    const responseWarnings = [
      ...resolved.warnings,
      ...(!persistedThreadId ? ["This answer was not saved to conversation history."] : []),
    ];
    return {
      id: shaped.id,
      thread_id: persistedThreadId || null,
      intent: shaped.intent,
      understood: shaped.understood,
      summary: shaped.message,
      answer,
      reply: answer,
      message: answer,
      display_mode: "detail",
      truth,
      operational_object: null,
      context: {
        surface: input.surface,
        estate_id: input.estate_id || oisContext?.estate_id || null,
        home_id: input.home_id || oisContext?.home_id || null,
        module: input.module || oisContext?.module || null,
        context_source: resolved.source,
        warnings: responseWarnings,
        target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationReason: hydration.reason, scopeWidened: false },
        module_facts: moduleFacts,
      },
      resolved_turn: resolvedConversationTurnFromContract(input, requestContract, null),
      execution: {
        normalized_turn: normalizedTurn,
        resolved_oyi_turn: resolvedOyiTurn,
        workflow: activeWorkflow,
      },
      cards: [],
      sources: [],
      suggested_actions: [],
      awareness: shaped.awareness,
      presentation_policy: presentationPolicyForContract(requestContract),
      confirmations: [],
      warnings: responseWarnings,
      persistence_saved: Boolean(persistedThreadId),
      source: "oyi_canonical_runtime",
      safe_mode: true,
      approvalRequired: false,
      requiresConfirmation: false,
    };
  }
  const canonicalBuilt = await buildCanonicalAuthoritativeAnswer(input, oisContext || null, requestContract, resolved.object, hydration.facts || {});
  if (canonicalBuilt.supported) {
    const shapedCanonical = canonicalBuilt.response;
    const truth = canonicalTruthFor(shapedCanonical, resolved.object);
    const threadId = text(shapedCanonical.thread_id) || text(input.thread_id) || randomUUID();
    const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, { ...shapedCanonical, thread_id: threadId }, truth, resolved.object, requestContract);
    const responseWarnings = [
      ...resolved.warnings,
      ...(targetResolution.ambiguous && targetResolution.clarificationQuestion ? [targetResolution.clarificationQuestion] : []),
      ...(threadContext.warning ? [threadContext.warning] : []),
      ...(!persistedThreadId ? ["This answer was not saved to conversation history."] : []),
    ];
    logger.info("conversation_final_answer_selected", {
      conversation_request_id: requestContract.conversation_request_id,
      thread_id: persistedThreadId || null,
      operation_class: requestContract.operation_class,
      intent: requestContract.intent,
      scope_mode: requestContract.scope_mode,
      answer_builder: requestContract.answer_builder,
      evidence_fact_count: canonicalBuilt.facts.length,
      evidence_freshness_summary: canonicalBuilt.facts.map((fact) => fact.freshness).slice(0, 6),
      truth_state_summary: truth.truth_state,
      compatibility_invoked: false,
      compatibility_reason: null,
      final_answer_authority: "canonical",
      persisted_message_id: text(shapedCanonical.id).replace(/^oyi-runtime:/, "") || null,
      response_state: requestContract.operation_class === "report" ? "report_ready" : requestContract.operation_class === "recommend" ? "recommendation" : "informational",
    });
    return {
      id: text(shapedCanonical.id) || `oyi-runtime:${requestContract.conversation_request_id}`,
      thread_id: persistedThreadId || null,
      intent: cleanLabel(shapedCanonical.intent, requestContract.intent),
      understood: text(shapedCanonical.understood) || null,
      summary: cleanLabel(shapedCanonical.understood || shapedCanonical.message, "Oyi reviewed the current operational context."),
      answer: cleanLabel(shapedCanonical.reply || shapedCanonical.message, "Oyi reviewed the current operational context."),
      reply: cleanLabel(shapedCanonical.reply || shapedCanonical.message, "Oyi reviewed the current operational context."),
      message: cleanLabel(shapedCanonical.message || shapedCanonical.reply, "Oyi reviewed the current operational context."),
      display_mode: (text(shapedCanonical.display_mode) as CanonicalConversationResponse["display_mode"]) || "conversation",
      truth,
      operational_object: resolved.object,
      context: {
        surface: input.surface,
        estate_id: input.estate_id || oisContext?.estate_id || null,
        home_id: input.home_id || oisContext?.home_id || null,
        module: input.module || oisContext?.module || null,
        context_source: resolved.source,
        warnings: responseWarnings,
        target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationTruthState: hydration.truth_state, hydrationReason: hydration.reason, scopeWidened: false },
        module_facts: moduleFacts,
        request_contract: requestContract,
      },
      resolved_turn: recordOf(shapedCanonical.resolved_turn) as ResolvedConversationTurn,
      execution: {
        ...recordOf(shapedCanonical.execution),
        normalized_turn: normalizedTurn,
        resolved_oyi_turn: resolvedOyiTurn,
        workflow: activeWorkflow,
      },
      cards: Array.isArray(shapedCanonical.cards) ? shapedCanonical.cards as Array<Record<string, unknown>> : [],
      sources: Array.isArray(shapedCanonical.sources) ? shapedCanonical.sources as Array<Record<string, unknown>> : [],
      suggested_actions: Array.isArray(shapedCanonical.suggested_actions) ? shapedCanonical.suggested_actions as Array<Record<string, unknown>> : [],
      awareness: shapedCanonical.awareness ? recordOf(shapedCanonical.awareness) : undefined,
      presentation_policy: recordOf(shapedCanonical.presentation_policy) as ConversationPresentationPolicy,
      confirmations: Array.isArray(shapedCanonical.confirmations) ? shapedCanonical.confirmations as Array<Record<string, unknown>> : [],
      warnings: responseWarnings,
      persistence_saved: Boolean(persistedThreadId),
      source: "oyi_canonical_runtime",
      safe_mode: true,
      approvalRequired: Boolean(shapedCanonical.approvalRequired || shapedCanonical.requiresConfirmation || (Array.isArray(shapedCanonical.confirmations) && shapedCanonical.confirmations.length)),
      requiresConfirmation: Boolean(shapedCanonical.requiresConfirmation || shapedCanonical.approvalRequired || (Array.isArray(shapedCanonical.confirmations) && shapedCanonical.confirmations.length)),
    };
  }
  if (requestContract.operation_class === "read" || requestContract.operation_class === "report" || requestContract.operation_class === "recommend") {
    logger.info("conversation_read_only_execution_blocked", {
      operation_class: requestContract.operation_class,
      intent: requestContract.intent,
      target: requestContract.target,
      attempted_operation: "legacy_mutation_fallback",
    });
    if (requestContract.scope_mode === "exact_target" && resolved.object) {
      const answer = `I can answer for ${resolved.object.label}, but this exact read operation is not supported yet. I did not widen to the home inventory or execute any command.`;
      const shapedCanonical = {
        id: `oyi-runtime:${requestContract.conversation_request_id}`,
        thread_id: requestContract.thread_id || randomUUID(),
        intent: requestContract.intent,
        understood: `Exact target retained for ${resolved.object.label}.`,
        message: answer,
        reply: answer,
        display_mode: "detail",
        confidence: 0.7,
        execution: { status: "read_only", current_turn_execution: false, normalized_turn: normalizedTurn, resolved_oyi_turn: resolvedOyiTurn, workflow: activeWorkflow },
        sources: [],
        cards: [],
        suggested_actions: contextualObjectActions(resolved.object, input).filter((action) => recordOf(action).risk !== "control").slice(0, 4),
        awareness: { headline: "Exact target retained", summary: answer, severity: "info" },
        presentation_policy: presentationPolicyForContract(requestContract),
        facts: [],
      };
      const truth = canonicalTruthFor(shapedCanonical, resolved.object);
      const threadId = text(shapedCanonical.thread_id) || text(input.thread_id) || randomUUID();
      const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, { ...shapedCanonical, thread_id: threadId }, truth, resolved.object, requestContract);
      const responseWarnings = [
        ...resolved.warnings,
        ...(!persistedThreadId ? ["This answer was not saved to conversation history."] : []),
      ];
      logger.info("conversation_inventory_fallback_blocked", {
        target_id: requestContract.target.canonical_id,
        targeted_intent: requestContract.intent,
        reason: "exact_target_read_authority",
      });
      return {
        id: text(shapedCanonical.id),
        thread_id: persistedThreadId || null,
        intent: requestContract.intent,
        understood: text(shapedCanonical.understood),
        summary: answer,
        answer,
        reply: answer,
        message: answer,
        display_mode: "detail",
        truth,
        operational_object: resolved.object,
        context: {
          surface: input.surface,
          estate_id: input.estate_id || oisContext?.estate_id || null,
          home_id: input.home_id || oisContext?.home_id || null,
          module: input.module || oisContext?.module || null,
          context_source: resolved.source,
          warnings: responseWarnings,
          target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationTruthState: hydration.truth_state, hydrationReason: hydration.reason, scopeWidened: false },
          module_facts: moduleFacts,
          request_contract: requestContract,
        },
        resolved_turn: resolvedConversationTurnFromContract(input, requestContract, resolved.object),
        execution: { status: "read_only", current_turn_execution: false },
        cards: [],
        sources: [],
        suggested_actions: Array.isArray(shapedCanonical.suggested_actions) ? shapedCanonical.suggested_actions as Array<Record<string, unknown>> : [],
        awareness: shapedCanonical.awareness,
        presentation_policy: recordOf(shapedCanonical.presentation_policy) as ConversationPresentationPolicy,
        confirmations: [],
        warnings: responseWarnings,
        persistence_saved: Boolean(persistedThreadId),
        source: "oyi_canonical_runtime",
        safe_mode: true,
        approvalRequired: false,
        requiresConfirmation: false,
      };
    }
  }
  const compatibilityInput = compatibilityInputFromCanonical(input, resolved.object);
  const compatibility = await runOyiUnifiedChat(actor, compatibilityInput) as Record<string, unknown>;
  const shapedCompatibility = shapeObjectConversation(input, compatibility, resolved.object);
  const truth = canonicalTruthFor(shapedCompatibility, resolved.object);
  const threadId = text(shapedCompatibility.thread_id) || text(input.thread_id) || randomUUID();
  const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, { ...shapedCompatibility, thread_id: threadId }, truth, resolved.object, requestContract);
  const responseWarnings = [
    ...resolved.warnings,
    ...(targetResolution.ambiguous && targetResolution.clarificationQuestion ? [targetResolution.clarificationQuestion] : []),
    ...(threadContext.warning ? [threadContext.warning] : []),
    ...(!persistedThreadId ? ["This answer was not saved to conversation history."] : []),
  ];
  return {
    id: text(shapedCompatibility.id) || `oyi-runtime:${randomUUID()}`,
    thread_id: persistedThreadId || null,
    intent: cleanLabel(shapedCompatibility.intent, "information"),
    understood: text(shapedCompatibility.understood) || null,
    summary: cleanLabel(shapedCompatibility.understood || shapedCompatibility.message, "Oyi reviewed the current operational context."),
    answer: cleanLabel(shapedCompatibility.reply || shapedCompatibility.message, "Oyi reviewed the current operational context."),
    reply: cleanLabel(shapedCompatibility.reply || shapedCompatibility.message, "Oyi reviewed the current operational context."),
    message: cleanLabel(shapedCompatibility.message || shapedCompatibility.reply, "Oyi reviewed the current operational context."),
    display_mode: (text(shapedCompatibility.display_mode) as CanonicalConversationResponse["display_mode"]) || "conversation",
    truth,
    operational_object: resolved.object,
    context: {
      surface: input.surface,
      estate_id: input.estate_id || oisContext?.estate_id || null,
      home_id: input.home_id || oisContext?.home_id || null,
      module: input.module || oisContext?.module || null,
      context_source: resolved.source,
      warnings: responseWarnings,
      target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationTruthState: hydration.truth_state, hydrationReason: hydration.reason, scopeWidened: false },
      module_facts: moduleFacts,
    },
    resolved_turn: recordOf(shapedCompatibility.resolved_turn) as ResolvedConversationTurn,
    execution: {
      ...recordOf(shapedCompatibility.execution),
      normalized_turn: normalizedTurn,
      resolved_oyi_turn: resolvedOyiTurn,
      workflow: activeWorkflow,
    },
    cards: Array.isArray(shapedCompatibility.cards) ? shapedCompatibility.cards as Array<Record<string, unknown>> : [],
    sources: Array.isArray(shapedCompatibility.sources) ? shapedCompatibility.sources as Array<Record<string, unknown>> : [],
    suggested_actions: Array.isArray(shapedCompatibility.suggested_actions) ? shapedCompatibility.suggested_actions as Array<Record<string, unknown>> : [],
    awareness: shapedCompatibility.awareness ? recordOf(shapedCompatibility.awareness) : undefined,
    presentation_policy: presentationPolicyForContract(requestContract),
    confirmations: Array.isArray(shapedCompatibility.confirmations) ? shapedCompatibility.confirmations as Array<Record<string, unknown>> : [],
    warnings: responseWarnings,
    persistence_saved: Boolean(persistedThreadId),
    source: "oyi_canonical_runtime",
    safe_mode: true,
    approvalRequired: Boolean(shapedCompatibility.approvalRequired || shapedCompatibility.requiresConfirmation || recordOf(shapedCompatibility.execution).status === "pending_confirmation"),
    requiresConfirmation: Boolean(shapedCompatibility.requiresConfirmation || shapedCompatibility.approvalRequired || recordOf(shapedCompatibility.execution).status === "pending_confirmation"),
  };
}

export function adaptCanonicalToCompatibilityChat(response: CanonicalConversationResponse) {
  return {
    ok: true,
    id: response.id,
    thread_id: response.thread_id,
    message: response.message,
    reply: response.reply,
    intent: response.intent,
    understood: response.understood,
    execution: response.execution,
    display_mode: response.display_mode,
    cards: response.cards,
    sources: response.sources,
    suggested_actions: response.suggested_actions,
    awareness: response.awareness,
    presentation_policy: response.presentation_policy,
    operational_object: response.operational_object,
    truth: response.truth,
    context: response.context,
    confirmations: response.confirmations,
    approvalRequired: response.approvalRequired,
    requiresConfirmation: response.requiresConfirmation,
    warnings: response.warnings,
    persistence_saved: response.persistence_saved,
    safe_mode: true,
  };
}

export function adaptCanonicalToAiChat(response: CanonicalConversationResponse) {
  return {
    message: response.reply,
    reply: response.reply,
    intent: response.intent,
    understood: response.understood,
    execution: response.execution,
    display_mode: response.display_mode,
    panel: null,
    deviceId: response.operational_object?.object_type === "device" ? response.operational_object.canonical_id : null,
    actions: [],
    tools: [],
    confirmations: response.confirmations,
    cards: response.cards,
    sources: response.sources,
    suggested_actions: response.suggested_actions,
    awareness: response.awareness || null,
    presentation_policy: response.presentation_policy,
    thread_id: response.thread_id,
    safe_mode: true,
    requiresConfirmation: response.requiresConfirmation,
    approvalRequired: response.approvalRequired,
    truth: response.truth,
    operational_object: response.operational_object,
    context: response.context,
    warnings: response.warnings,
    persistence_saved: response.persistence_saved,
    resolved_turn: response.resolved_turn,
  };
}
