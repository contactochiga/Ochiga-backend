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
};

export type CanonicalConversationResponse = {
  id: string;
  thread_id: string;
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
  execution: Record<string, unknown>;
  cards: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  suggested_actions: Array<Record<string, unknown>>;
  awareness?: Record<string, unknown>;
  confirmations: Array<Record<string, unknown>>;
  warnings: string[];
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

function explicitObjectCandidate(input: CanonicalConversationRequest): ObjectCandidate | null {
  const contextRecord = recordOf(input.context);
  const activeContext = recordOf(contextRecord.active_intelligence_context || recordOf(contextRecord.runtime_context).active_context || recordOf(input.conversation_context).active_context);
  const activeSelected = recordOf(activeContext.selected_subobject);
  const activePrimary = recordOf(activeContext.primary_object);
  const explicit = recordOf(input.operational_object || contextRecord.operational_object || (Object.keys(activeSelected).length ? activeSelected : activePrimary));
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
      };
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
      };
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
  ];
  for (const [pattern, replacement] of replacements) next = next.replace(pattern, replacement);
  return next.replace(/\s+/g, " ").trim();
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

type OperationClass =
  | "read"
  | "report"
  | "recommend"
  | "propose_mutation"
  | "confirm_mutation"
  | "execute_mutation"
  | "continue_workflow"
  | "clarify";

type CanonicalIntent =
  | "capability"
  | "current_state"
  | "health_check"
  | "recent_changes"
  | "activity_history"
  | "explanation"
  | "investigation"
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
  | "command_outcome";

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

function parseDeviceChannelIdentity(canonicalId: string | null | undefined) {
  const raw = text(canonicalId);
  const idx = raw.lastIndexOf(":");
  if (idx <= 0) return { parent_id: null, channel_code: null };
  return { parent_id: raw.slice(0, idx), channel_code: raw.slice(idx + 1) };
}

function temporalScopeFor(message: string): IntelligenceRequestContract["temporal_scope"] {
  const now = new Date();
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

function resolveIntentContract(input: CanonicalConversationRequest, object: OperationalObject | null, targetResolution: Record<string, unknown>): IntelligenceRequestContract {
  const message = text(input.message);
  const lower = message.toLowerCase();
  const conversationRequestId = text(recordOf(input.context).request_id || recordOf(input.conversation_context).conversation_request_id) || randomUUID();
  const targetType = text(object?.object_type || targetResolution.objectType) || null;
  const targetId = text(object?.canonical_id || targetResolution.objectId) || null;
  const parsedChannel = targetType === "device_channel" ? parseDeviceChannelIdentity(targetId) : { parent_id: null, channel_code: null };
  const explicitBroad = isReadOnlyBroadDeviceIntent(message) || /\b(whole home|all devices|everything|home summary|home report|show offline|what changed recently)\b/i.test(lower);
  const mutationRequested = isControlRequest(message) && !/\b(what happened|why|is|show|list|history|report|recommend|what can|changed|status|working|healthy|evidence|did that work|last command)\b/i.test(lower);
  let intent: CanonicalIntent = "general_help";
  let operationClass: OperationClass = mutationRequested ? "execute_mutation" : "read";
  if (/\b(report|generate.*report|summary report)\b/i.test(lower)) {
    intent = "report";
    operationClass = "report";
  } else if (/\b(recommend|what should|next step|suggest)\b/i.test(lower)) {
    intent = "recommendation";
    operationClass = "recommend";
  } else if (/\bwhat changed|changed recently|recent changes\b/i.test(lower)) {
    intent = "recent_changes";
  } else if (/\b(last command|what happened to.*command|did that work|did it work|command outcome)\b/i.test(lower)) {
    intent = "command_outcome";
  } else if (/\b(activity|history|what happened|timeline)\b/i.test(lower)) {
    intent = "activity_history";
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
  if (operationClass !== "execute_mutation" && operationClass !== "report" && operationClass !== "recommend") operationClass = "read";
  const scopeMode: ScopeMode = explicitBroad
    ? "explicit_broad_scope"
    : targetType
      ? "exact_target"
      : input.room_id
        ? "room_scope"
        : input.home_id
          ? "home_scope"
          : input.estate_id
            ? "estate_scope"
            : "global_scope";
  const answerBuilder = intent === "report"
    ? "canonical_report_builder"
    : intent === "recent_changes" || intent === "activity_history"
      ? "recent_changes"
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
      canonical_id: targetId,
      parent_id: object?.parent_id || parsedChannel.parent_id,
      channel_code: parsedChannel.channel_code || text(recordOf(object?.metadata).channel_code) || null,
      label: object?.label || text(targetResolution.objectName) || null,
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
      recent_events: ["recent_changes", "activity_history", "investigation", "report"].includes(intent),
      execution_history: ["command_outcome", "recent_changes", "activity_history", "investigation", "report"].includes(intent),
      audit_history: ["recent_changes", "activity_history", "report"].includes(intent),
      relationships: ["capability", "recommendation", "report"].includes(intent),
      permissions: true,
      provider_state: ["current_state", "health_check", "device_control"].includes(intent),
      financial_ledger: ["wallet_operation", "report"].includes(intent),
      access_records: ["visitor_operation", "access_operation", "report"].includes(intent),
    },
    answer_builder: answerBuilder,
    report_builder: intent === "report" ? `${scopeMode}_operational_report` : null,
    truth_policy: operationClass === "execute_mutation" ? "current_turn_execution_required" : "read_only_no_execution",
  };
}

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  };
}

function factFromObject(object: OperationalObject, hydrationFacts: Record<string, unknown>, input: CanonicalConversationRequest, oisContext: OisContext | null | undefined): IntelligenceFact {
  const scope = currentScope(input, oisContext);
  const stateFacts = recordOf(hydrationFacts.state);
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
    truth_state: object.freshness ? "observed" : "unavailable",
    confidence: object.freshness ? 0.86 : 0.62,
    freshness: object.freshness || "unknown",
    privacy_class: object.home_id ? "resident_device_private" : "building_operational",
    permissions: object.permissions || [],
    evidence: [{ type: "hydration", facts: hydrationFacts }],
  };
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
    for (const row of Array.isArray(data) ? data : []) {
      const result = recordOf(recordOf(row.metadata).result);
      const channel = text(result.channel_code);
      const finalStatus = text(result.final_status || row.execution_status);
      const label = text(result.device_name || row.device_id) || "Device command";
      const confirmed = /state_confirmed|executed/i.test(finalStatus) || row.verified;
      facts.push({
        fact_id: `execution:${row.id}`,
        domain: "devices",
        fact_type: "command_execution",
        scope: { estate_id: row.estate_id || scope.estate_id, home_id: row.home_id || scope.home_id, room_id: text(result.room_id) || scope.room_id },
        object: { object_type: channel ? "device_channel" : "device", canonical_id: channel ? `${row.device_id}:${channel}` : String(row.device_id || ""), label: channel ? `${label} ${channel}` : label },
        statement: `${channel ? `Channel ${channel.replace(/^switch_/i, "")}` : "Device"} command ${confirmed ? "confirmed" : finalStatus || "recorded"} at ${new Date(row.completed_at || row.requested_at).toLocaleTimeString()}.`,
        value: { status: finalStatus, command: result.normalized_command || result.expected_state || null, channel_code: channel || null },
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
      const auditOnly = /^device\./.test(text(row.action)) || text(row.action) === "audit.recorded";
      if (auditOnly) continue;
      if (scope.home_id && text(metadata.home_id) && text(metadata.home_id) !== scope.home_id) continue;
      facts.push({
        fact_id: `audit:${row.id}`,
        domain: text(row.resource_type) || "operations",
        fact_type: "audit_change",
        scope: { estate_id: row.estate_id || scope.estate_id, home_id: text(metadata.home_id) || scope.home_id, room_id: text(metadata.room_id) || null },
        object: row.resource_id ? { object_type: text(row.resource_type) || "record", canonical_id: String(row.resource_id), label: text(metadata.object_name || row.resource_type || row.action) || "Record" } : null,
        statement: `${human(row.action)} was recorded at ${new Date(row.created_at).toLocaleTimeString()}.`,
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
  const deduped = dedupeFacts(facts).sort((a, b) => Date.parse(b.occurred_at || b.observed_at) - Date.parse(a.occurred_at || a.observed_at));
  logger.info("conversation_fact_deduplicated", {
    source_count: facts.length,
    final_fact_count: deduped.length,
    grouping_keys: ["domain", "object", "fact_type", "value_transition", "source_id", "timestamp_window"],
  });
  return deduped;
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

function buildCurrentStateAnswer(object: OperationalObject | null, hydrationFacts: Record<string, unknown>, contract: IntelligenceRequestContract) {
  if (!object) return "I do not have an exact object selected, so I can only answer from the current authorised scope.";
  const stateFacts = recordOf(hydrationFacts.state);
  const channelLine = channelSummary(hydrationFacts);
  const provider = providerHealthLabel(stateFacts.provider_health || recordOf(object.metadata).provider_health);
  const freshness = text(stateFacts.freshness || object.freshness);
  const lines = [`${object.label} currently reports ${naturalState(object.current_state) || "an unavailable state"}.`];
  if (object.health) lines.push(`Health is ${naturalState(object.health)}.`);
  if (provider !== "unknown") lines.push(`The controller connection is ${provider}.`);
  if (channelLine) lines.push(channelLine.endsWith(".") ? channelLine : `${channelLine}.`);
  if (freshness) lines.push(`Latest evidence freshness: ${freshness}.`);
  if (object.object_type === "device_channel" && contract.target.channel_code) lines.push(`This answer is scoped only to ${contract.target.channel_code}; I did not substitute another channel.`);
  return lines.join(" ");
}

function buildHealthAnswer(object: OperationalObject | null, hydrationFacts: Record<string, unknown>, contract: IntelligenceRequestContract) {
  if (!object) return "I could not verify the selected object from the current authorised scope.";
  const stateFacts = recordOf(hydrationFacts.state);
  const provider = providerHealthLabel(stateFacts.provider_health || recordOf(object.metadata).provider_health);
  const state = naturalState(object.current_state) || "unknown";
  const channelLine = channelSummary(hydrationFacts);
  const status = provider === "healthy" || /online|available|healthy|connected/i.test(`${object.health || ""} ${stateFacts.availability || ""}`);
  const lead = status
    ? `${object.label} is communicating with Oyi from the latest available evidence.`
    : `Oyi cannot fully verify ${object.label} right now.`;
  return [lead, `It currently reports ${state}.`, object.health ? `Health is ${naturalState(object.health)}.` : "", provider !== "unknown" ? `The controller connection is ${provider}.` : "", channelLine ? `${channelLine}.` : "", object.freshness ? `Last evidence: ${object.freshness}.` : ""].filter(Boolean).join(" ");
}

function buildCapabilityAnswer(object: OperationalObject | null, input: CanonicalConversationRequest) {
  if (!object) return input.surface === "facility"
    ? "I can answer authorised building operations questions, generate reports, investigate incidents, and prepare safe actions when policy allows."
    : "I can answer home questions, explain device state, report recent changes, inspect scenes and automations, and prepare safe actions when you explicitly ask.";
  return objectCapabilityLine(object);
}

function buildRecentChangesAnswer(facts: IntelligenceFact[], contract: IntelligenceRequestContract) {
  const meaningful = facts.filter((fact) => !/audit.recorded|compatibility/i.test(fact.statement)).slice(0, 8);
  securityRiskAllowed("suspicious_access", meaningful, 2);
  if (!meaningful.length) {
    return contract.temporal_scope.mode === "recent"
      ? "I do not see meaningful recent changes in this authorised scope. A presence or proximity signal alone is not evidence of an access problem."
      : "I do not see concrete changes for that period in this authorised scope.";
  }
  const from = contract.temporal_scope.from ? new Date(contract.temporal_scope.from).toLocaleString() : "the recent window";
  const items = meaningful.map((fact) => {
    const at = fact.occurred_at ? new Date(fact.occurred_at).toLocaleTimeString() : "time unavailable";
    return `• ${fact.statement.replace(/\.$/, "")} (${at})`;
  });
  return [`Since ${from}:`, ...items, "I did not treat proximity alone as suspicious access without denial or mismatch evidence."].join("\n");
}

function buildCommandOutcomeAnswer(command: Record<string, unknown> | null) {
  if (!command) return "I do not see an authorised recent command execution for this scope.";
  const status = text(command.status);
  const channel = text(command.channel_code);
  const target = channel ? `${channel.replace(/^switch_/i, "Channel ")}` : "the device";
  if (/state_confirmed|executed/i.test(status) || command.verified) {
    return `${target} command was confirmed. Provider status: ${text(command.provider_status) || "recorded"}. State confirmation: ${text(command.confirmation_status) || status}. Physical effect: ${text(command.physical_effect_status) || "not independently sensed"}.`;
  }
  if (/provider_rejected|failed|state_mismatch|confirmation_timed_out/i.test(status)) {
    return `${target} command did not complete successfully. ${text(command.safe_error_message) || "Oyi kept the last confirmed state rather than marking the device as changed."}`;
  }
  return `${target} command is ${status || "recorded"} and has not been confirmed as a physical appliance effect.`;
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

export function canonicalIntelligenceContractForTest(input: { message: string; object?: OperationalObject | null; request?: Partial<CanonicalConversationRequest> }) {
  return resolveIntentContract({
    message: input.message,
    surface: "consumer",
    ...(input.request || {}),
  } as CanonicalConversationRequest, input.object || null, {
    objectType: input.object?.object_type || null,
    objectId: input.object?.canonical_id || null,
    objectName: input.object?.label || null,
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

export function canonicalReportAnswerForTest(input: { facts: IntelligenceFact[]; object?: OperationalObject | null; message?: string }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "Generate today's home report", object: input.object || null });
  return buildReportAnswer(dedupeFacts(input.facts), input.object || null, contract);
}

function buildRecommendationAnswer(object: OperationalObject | null, facts: IntelligenceFact[]) {
  if (object) return recommendationFor(object, { message: "recommend", surface: "consumer" } as CanonicalConversationRequest);
  const failures = facts.filter((fact) => /failed|unavailable|timeout|warning|critical/i.test(`${fact.statement} ${JSON.stringify(fact.value)}`));
  return failures.length ? "I recommend checking the unresolved item with the freshest failed evidence first." : "No immediate action is required from the evidence I can see.";
}

type CanonicalBuiltAnswer = {
  supported: boolean;
  response: Record<string, unknown>;
  facts: IntelligenceFact[];
};

async function buildCanonicalAuthoritativeAnswer(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined, contract: IntelligenceRequestContract, object: OperationalObject | null, hydrationFacts: Record<string, unknown>): Promise<CanonicalBuiltAnswer> {
  logger.info("conversation_evidence_plan_created", {
    conversation_request_id: contract.conversation_request_id,
    required_sources: contract.evidence_requirements,
    permissions: object?.permissions || [],
    loaders: [contract.answer_builder, object?.source_module || input.module || "scope"],
  });
  const baseFacts = object ? [factFromObject(object, hydrationFacts, input, oisContext)] : [];
  let facts = baseFacts;
  let answer = "";
  let displayMode: CanonicalConversationResponse["display_mode"] = "conversation";
  let execution: Record<string, unknown> = { status: "read_only", current_turn_execution: false };
  if (contract.operation_class === "execute_mutation") {
    return { supported: false, response: {}, facts };
  }
  logger.info("conversation_read_only_execution_blocked", {
    operation_class: contract.operation_class,
    intent: contract.intent,
    target: contract.target,
  });
  if (contract.intent === "recent_changes" || contract.intent === "activity_history") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildRecentChangesAnswer(facts, contract);
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
  } else if (contract.intent === "current_state" || contract.intent === "evidence" || contract.intent === "investigation" || contract.intent === "explanation") {
    answer = buildCurrentStateAnswer(object, hydrationFacts, contract);
  } else if (contract.intent === "capability") {
    answer = buildCapabilityAnswer(object, input);
  } else if (contract.intent === "recommendation") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
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
    reason: "canonical_supported_intent",
  });
  logger.info("conversation_execution_correlation_checked", {
    conversation_request_id: contract.conversation_request_id,
    execution_id: text(recordOf(execution.referenced_execution).id) || null,
    matched: false,
    reason: contract.operation_class === "read" || contract.operation_class === "report" || contract.operation_class === "recommend" ? "read_only_current_turn" : "no_execution",
  });
  const safeAnswer = naturalizeUserCopy(stripInternalLanguage(answer)).replace(/^Done[.,]?\s*/i, "");
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
      sources: deduped.slice(0, 6).map((fact) => ({ id: fact.source_id || fact.fact_id, type: fact.source_type, label: fact.statement, truth_state: fact.truth_state })),
      cards: displayMode === "report" ? [{ type: "report", title: contract.report_builder || "Operational report", summary: safeAnswer, items: deduped.slice(0, 6) }] : [],
      suggested_actions: object ? contextualObjectActions(object, input).filter((action) => recordOf(action).risk !== "control").slice(0, 4) : [],
      awareness: {
        headline: contract.intent === "recent_changes" ? "Recent changes reviewed" : contract.intent === "report" ? "Report ready" : "Oyi answer grounded",
        summary: safeAnswer.split("\n")[0],
        severity: "info",
      },
      canonical_request_contract: contract,
      facts: deduped,
    },
  };
}

async function persistCanonicalAuthoritativeMessages(actor: AuthUser | null, input: CanonicalConversationRequest, response: Record<string, unknown>, truth: CanonicalTruth, object: OperationalObject | null, contract: IntelligenceRequestContract) {
  const threadId = text(response.thread_id) || text(input.thread_id) || randomUUID();
  const now = new Date().toISOString();
  const assistantId = text(response.id).replace(/^oyi-runtime:/, "") || randomUUID();
  try {
    await supabaseAdmin.from("oyi_conversation_threads").upsert({
      id: threadId,
      user_id: actor?.id || null,
      surface: input.surface,
      estate_id: input.estate_id || actor?.estate_id || null,
      home_id: input.home_id || actor?.home_id || null,
      module: input.module || null,
      title: input.message.slice(0, 96) || "Oyi conversation",
      updated_at: now,
      metadata: {
        thread_state_version: 2,
        active_target: object ? { object_type: object.object_type, object_id: object.canonical_id, object_name: object.label } : null,
        current_turn_execution: null,
        referenced_historical_execution: recordOf(response.execution).referenced_execution || null,
        canonical_request_contract: contract,
      },
    } as any);
    await supabaseAdmin.from("oyi_conversation_messages").insert([
      {
        thread_id: threadId,
        user_id: actor?.id || null,
        role: "user",
        content: input.message,
        metadata: { surface: input.surface, module: input.module || null, conversation_request_id: contract.conversation_request_id, canonical_request_contract: contract },
        created_at: now,
      },
      {
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
          response_id: assistantId,
          conversation_request_id: contract.conversation_request_id,
          canonical_request_contract: contract,
          facts: Array.isArray(response.facts) ? response.facts : [],
        },
        created_at: new Date(Date.now() + 1).toISOString(),
      },
    ] as any);
    logger.info("conversation_final_answer_selected", {
      response_id: assistantId,
      builder: contract.answer_builder,
      truth_state: truth.truth_state,
      persistence_message_id: assistantId,
    });
  } catch (error) {
    logger.warn("conversation_authoritative_persist_failed", { error, thread_id: threadId, conversation_request_id: contract.conversation_request_id });
  }
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
  const threadContext = await loadOyiConversationContext(actor, {
    surface: input.surface,
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    thread_id: input.thread_id || null,
    message: input.message,
  } as OyiChatInput);
  const explicitCandidate = explicitObjectCandidate(input);
  const threadCandidate = threadObjectCandidate(threadContext);
  const activeContextRecord = recordOf(input.active_intelligence_context || recordOf(input.context).active_intelligence_context || recordOf(recordOf(input.context).runtime_context).active_context || recordOf(input.conversation_context).active_context);
  const selectedSubobjectRecord = recordOf(activeContextRecord.selected_subobject || recordOf(input.conversation_context).selected_subobject);
  const broadReadOnlyDeviceIntent = isReadOnlyBroadDeviceIntent(input.message || "");
  if (broadReadOnlyDeviceIntent) {
    logger.info("read_only_command_execution_blocked", {
      intent: "show_offline_devices",
      target: "home_scope",
      attempted_operation: "device_command_context_reuse",
    });
  }
  const targetResolution = resolveConversationTarget({
    query: input.message,
    explicitTarget: input.target as any,
    selectedObject: broadReadOnlyDeviceIntent ? null : Object.keys(selectedSubobjectRecord).length ? selectedSubobjectRecord as any : input.operational_object as any,
    pageObject: !broadReadOnlyDeviceIntent && explicitCandidate ? {
      object_type: explicitCandidate.object_type,
      object_id: explicitCandidate.canonical_id,
      object_name: explicitCandidate.label || null,
    } : null,
    threadTarget: broadReadOnlyDeviceIntent ? null : threadCandidate ? {
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
      object_type: explicitCandidate?.object_type || null,
      object_id: explicitCandidate?.canonical_id || null,
      object_name: explicitCandidate?.label || null,
      active_intelligence_context: activeContextRecord,
    } as any,
  });
  const visibleStateRecord = recordOf(activeContextRecord.visible_state || recordOf(input.conversation_context).visible_state || recordOf(recordOf(input.operational_object).metadata).visible_state);
  logger.info("conversation_target_resolved", {
    request_id: text(recordOf(input.context).request_id) || null,
    context_id: text(activeContextRecord.context_id) || null,
    context_version: Number(activeContextRecord.context_version) || null,
    object_type: targetResolution.objectType,
    canonical_id: targetResolution.objectId,
    target_source: targetResolution.source,
    target_confidence: targetResolution.confidence,
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  });
  const hydration = await hydrateCanonicalTarget({
    actor,
    oisContext,
    target: targetResolution,
    activeContext: activeContextRecord,
    visibleState: Object.keys(visibleStateRecord).length ? visibleStateRecord : null,
  });
  let resolved: ResolvedOperationalObject = {
    object: hydration.object,
    source: explicitCandidate?.source || threadCandidate?.source || "page_selection",
    warnings: hydration.status === "hydrated" ? [] : hydration.reason ? [hydration.reason] : [],
  };
  if (!resolved.object && targetResolution.source !== "explicit_canonical_target" && targetResolution.source !== "selected_subobject" && targetResolution.source !== "active_page_object") {
    const preferredCandidate = explicitCandidate || threadCandidate;
    resolved = await resolveCandidate(actor, oisContext, preferredCandidate);
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
  const requestContract = resolveIntentContract(input, resolved.object, targetResolution as any);
  logger.info("conversation_request_contract_resolved", {
    request_id: requestContract.conversation_request_id,
    operation_class: requestContract.operation_class,
    intent: requestContract.intent,
    scope: requestContract.scope_mode,
    target: requestContract.target,
    temporal_scope: requestContract.temporal_scope,
    builder: requestContract.answer_builder,
  });
  const exactTargetRequested = Boolean(explicitCandidate || ["explicit_canonical_target", "selected_subobject", "active_page_object"].includes(targetResolution.source));
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
    return {
      id: shaped.id,
      thread_id: shaped.thread_id,
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
        warnings: resolved.warnings,
        target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationReason: hydration.reason, scopeWidened: false },
        module_facts: moduleFacts,
      },
      execution: {},
      cards: [],
      sources: [],
      suggested_actions: [],
      awareness: shaped.awareness,
      confirmations: [],
      warnings: resolved.warnings,
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
    await persistCanonicalAuthoritativeMessages(actor, input, { ...shapedCanonical, thread_id: threadId }, truth, resolved.object, requestContract);
    return {
      id: text(shapedCanonical.id) || `oyi-runtime:${requestContract.conversation_request_id}`,
      thread_id: threadId,
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
        warnings: [
          ...resolved.warnings,
          ...(targetResolution.ambiguous && targetResolution.clarificationQuestion ? [targetResolution.clarificationQuestion] : []),
          ...(threadContext.warning ? [threadContext.warning] : []),
        ],
        target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationTruthState: hydration.truth_state, hydrationReason: hydration.reason, scopeWidened: false },
        module_facts: moduleFacts,
        request_contract: requestContract,
      },
      execution: recordOf(shapedCanonical.execution),
      cards: Array.isArray(shapedCanonical.cards) ? shapedCanonical.cards as Array<Record<string, unknown>> : [],
      sources: Array.isArray(shapedCanonical.sources) ? shapedCanonical.sources as Array<Record<string, unknown>> : [],
      suggested_actions: Array.isArray(shapedCanonical.suggested_actions) ? shapedCanonical.suggested_actions as Array<Record<string, unknown>> : [],
      awareness: shapedCanonical.awareness ? recordOf(shapedCanonical.awareness) : undefined,
      confirmations: [],
      warnings: [
        ...resolved.warnings,
        ...(targetResolution.ambiguous && targetResolution.clarificationQuestion ? [targetResolution.clarificationQuestion] : []),
        ...(threadContext.warning ? [threadContext.warning] : []),
      ],
      source: "oyi_canonical_runtime",
      safe_mode: true,
      approvalRequired: false,
      requiresConfirmation: false,
    };
  }
  if (requestContract.operation_class === "read" || requestContract.operation_class === "report" || requestContract.operation_class === "recommend") {
    logger.info("conversation_read_only_execution_blocked", {
      operation_class: requestContract.operation_class,
      intent: requestContract.intent,
      target: requestContract.target,
      attempted_operation: "legacy_mutation_fallback",
    });
  }
  const compatibilityInput = compatibilityInputFromCanonical(input, resolved.object);
  const compatibility = await runOyiUnifiedChat(actor, compatibilityInput) as Record<string, unknown>;
  const shapedCompatibility = shapeObjectConversation(input, compatibility, resolved.object);
  const truth = canonicalTruthFor(shapedCompatibility, resolved.object);
  const threadId = text(shapedCompatibility.thread_id) || text(input.thread_id) || randomUUID();
  await persistCanonicalShapedAssistantMessage(threadId, shapedCompatibility, truth, resolved.object);
  return {
    id: text(shapedCompatibility.id) || `oyi-runtime:${randomUUID()}`,
    thread_id: threadId,
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
      warnings: [
        ...resolved.warnings,
        ...(targetResolution.ambiguous && targetResolution.clarificationQuestion ? [targetResolution.clarificationQuestion] : []),
        ...(threadContext.warning ? [threadContext.warning] : []),
      ],
      target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationTruthState: hydration.truth_state, hydrationReason: hydration.reason, scopeWidened: false },
      module_facts: moduleFacts,
    },
    execution: recordOf(shapedCompatibility.execution),
    cards: Array.isArray(shapedCompatibility.cards) ? shapedCompatibility.cards as Array<Record<string, unknown>> : [],
    sources: Array.isArray(shapedCompatibility.sources) ? shapedCompatibility.sources as Array<Record<string, unknown>> : [],
    suggested_actions: Array.isArray(shapedCompatibility.suggested_actions) ? shapedCompatibility.suggested_actions as Array<Record<string, unknown>> : [],
    awareness: shapedCompatibility.awareness ? recordOf(shapedCompatibility.awareness) : undefined,
    confirmations: Array.isArray(shapedCompatibility.confirmations) ? shapedCompatibility.confirmations as Array<Record<string, unknown>> : [],
    warnings: [
      ...resolved.warnings,
      ...(targetResolution.ambiguous && targetResolution.clarificationQuestion ? [targetResolution.clarificationQuestion] : []),
      ...(threadContext.warning ? [threadContext.warning] : []),
    ],
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
    operational_object: response.operational_object,
    truth: response.truth,
    context: response.context,
    confirmations: response.confirmations,
    approvalRequired: response.approvalRequired,
    requiresConfirmation: response.requiresConfirmation,
    warnings: response.warnings,
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
    thread_id: response.thread_id,
    safe_mode: true,
    requiresConfirmation: response.requiresConfirmation,
    approvalRequired: response.approvalRequired,
    truth: response.truth,
    operational_object: response.operational_object,
  };
}
