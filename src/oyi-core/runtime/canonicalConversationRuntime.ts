import { randomUUID } from "crypto";
import type { AuthUser } from "../../middleware/auth";
import type { OisContext, OyiTarget } from "../../types/oisContext";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import {
  loadOyiConversationContext,
  runOyiUnifiedChat,
  type OyiChatInput,
  type OyiSurface,
} from "../../services/oyiUnifiedIntelligenceService";

export type OperationalObjectType =
  | "estate"
  | "building"
  | "floor"
  | "home"
  | "room"
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
    floor: "floor",
    home: "home",
    room: "room",
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
  const explicit = recordOf(input.operational_object || contextRecord.operational_object);
  const explicitType = objectTypeFromEntityType(explicit.object_type || explicit.type);
  const explicitId = text(explicit.canonical_id || explicit.target_id || explicit.id);
  if (explicitType && explicitId) {
    return {
      object_type: explicitType,
      canonical_id: explicitId,
      label: text(explicit.label || explicit.title) || null,
      estate_id: text(explicit.estate_id) || input.estate_id || null,
      home_id: text(explicit.home_id) || input.home_id || null,
      room_id: text(explicit.room_id) || input.room_id || null,
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
      const { data } = await maybeSingle("home_service_accounts", "id,estate_id,home_id,service_type,provider,status,identifier,updated_at", candidate.canonical_id);
      const row = data as any;
      if (!row?.id) break;
      if (homeScoped && String(row.home_id || "") !== String(homeScoped)) {
        warnings.push("This service account is outside the active home scope.");
        break;
      }
      object = {
        object_type: "service_account",
        canonical_id: String(row.id),
        label: cleanLabel(candidate.label || `${row.service_type || "Service"} account`, "Service account"),
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
        relationships: { provider: row.provider || null, identifier: row.identifier || null },
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

function compatibilityInputFromCanonical(input: CanonicalConversationRequest, operationalObject: OperationalObject | null): OyiChatInput {
  return {
    surface: input.surface,
    estate_id: input.estate_id || operationalObject?.estate_id || null,
    home_id: input.home_id || operationalObject?.home_id || null,
    module: input.module || operationalObject?.source_module || null,
    role: input.role || null,
    message: input.message,
    thread_id: input.thread_id || null,
    context: input.context as OisContext | null,
    device_id: input.device_id || (operationalObject?.object_type === "device" ? operationalObject.canonical_id : null),
    device_name: input.device_name || (operationalObject?.object_type === "device" ? operationalObject.label : null),
    room_id: input.room_id || operationalObject?.room_id || null,
    room_name: input.room_name || null,
    control_profile: input.control_profile || null,
    primary_state: input.primary_state || operationalObject?.current_state || null,
    health_status: input.health_status || operationalObject?.health || null,
    supported_controls: input.supported_controls || null,
    channel_definitions: input.channel_definitions || null,
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
  const preferredCandidate = explicitCandidate || threadCandidate;
  const resolved = await resolveCandidate(actor, oisContext, preferredCandidate);
  const compatibilityInput = compatibilityInputFromCanonical(input, resolved.object);
  const compatibility = await runOyiUnifiedChat(actor, compatibilityInput) as Record<string, unknown>;
  const truth = canonicalTruthFor(compatibility, resolved.object);
  return {
    id: text(compatibility.id) || `oyi-runtime:${randomUUID()}`,
    thread_id: text(compatibility.thread_id) || text(input.thread_id) || randomUUID(),
    intent: cleanLabel(compatibility.intent, "information"),
    understood: text(compatibility.understood) || null,
    summary: cleanLabel(compatibility.understood || compatibility.message, "Oyi reviewed the current operational context."),
    answer: cleanLabel(compatibility.reply || compatibility.message, "Oyi reviewed the current operational context."),
    reply: cleanLabel(compatibility.reply || compatibility.message, "Oyi reviewed the current operational context."),
    message: cleanLabel(compatibility.message || compatibility.reply, "Oyi reviewed the current operational context."),
    display_mode: (text(compatibility.display_mode) as CanonicalConversationResponse["display_mode"]) || "conversation",
    truth,
    operational_object: resolved.object,
    context: {
      surface: input.surface,
      estate_id: input.estate_id || oisContext?.estate_id || null,
      home_id: input.home_id || oisContext?.home_id || null,
      module: input.module || oisContext?.module || null,
      context_source: resolved.source,
      warnings: [...resolved.warnings, ...(threadContext.warning ? [threadContext.warning] : [])],
    },
    execution: recordOf(compatibility.execution),
    cards: Array.isArray(compatibility.cards) ? compatibility.cards as Array<Record<string, unknown>> : [],
    sources: Array.isArray(compatibility.sources) ? compatibility.sources as Array<Record<string, unknown>> : [],
    suggested_actions: Array.isArray(compatibility.suggested_actions) ? compatibility.suggested_actions as Array<Record<string, unknown>> : [],
    awareness: compatibility.awareness ? recordOf(compatibility.awareness) : undefined,
    confirmations: Array.isArray(compatibility.confirmations) ? compatibility.confirmations as Array<Record<string, unknown>> : [],
    warnings: [...resolved.warnings, ...(threadContext.warning ? [threadContext.warning] : [])],
    source: "oyi_canonical_runtime",
    safe_mode: true,
    approvalRequired: Boolean(compatibility.approvalRequired || compatibility.requiresConfirmation || recordOf(compatibility.execution).status === "pending_confirmation"),
    requiresConfirmation: Boolean(compatibility.requiresConfirmation || compatibility.approvalRequired || recordOf(compatibility.execution).status === "pending_confirmation"),
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
