import { randomUUID } from "crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";
import type { AuthUser } from "../middleware/auth";
import { listPersistedIntelligenceEvents, type IntelligenceEventFilters } from "../intelligence-core/eventBus";
import { loadNormalizedTimelineEvents } from "../intelligence-core/normalizers";
import { applyRoleScopeToFilters, filterEventsForActor, getIntelligencePermissionPolicy } from "../intelligence-core/permissionEngine";
import { buildIntelligenceSummary, type IntelligenceSummaryType } from "../intelligence-core/summaryEngine";
import { listIntelligencePredictions, summarizePredictions } from "../intelligence-core/predictionEngine";
import { listWorkflows, summarizeWorkflows } from "../intelligence-core/workflows";
import { observeAgentAction } from "../intelligence-core/observability";
import { rankActiveWorkflowsForAwareness } from "../intelligence-core/awarenessWorkflowProvider";
import { classifyUniversalIntent } from "../intelligence-core/intentRouter";
import type { ProposedAiTool } from "../ai/commandRouter";
import { interpretWithLanguageTeacher, languageTeacherResultToMessage, shouldAskLanguageTeacher } from "../language-teacher/languageTeacherService";
import type { OisContext } from "../types/oisContext";
import { decorateOyiTargets } from "./oyi/oyiTargetService";
import { oyiCoreRuntime } from "../oyi-core/service";

// Transitional compatibility service:
// src/oyi-core is the canonical runtime for normalized signals, awareness,
// reasoning, recommendations, automation, conversation, and executive output.
// This service stays in place only to preserve older /oyi/awareness and
// /oyi/chat payload contracts while the remaining clients complete cutover.

export type OyiSurface = "consumer" | "facility" | "office" | "watch" | "edge" | "public_corporate" | "office_internal";
export type AwarenessSeverity = "normal" | "info" | "attention" | "warning" | "critical";

export type OyiChatInput = {
  surface?: OyiSurface;
  estate_id?: string | null;
  home_id?: string | null;
  module?: string | null;
  role?: string | null;
  message: string;
  thread_id?: string | null;
  context?: OisContext | null;
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
  persist?: boolean;
};

type ConversationEntity = {
  type: "device" | "visitor" | "maintenance" | "service" | "wallet" | "community" | "report" | "awareness" | "queue" | "workflow" | "room" | "scene" | "automation" | "notification" | "activity" | "security" | "camera" | "infrastructure" | "sensor" | "traffic" | "staff" | "estate" | "profile";
  id?: string | null;
  title: string;
  status?: string | null;
  details?: Record<string, unknown>;
};

type ConversationState = {
  version: 1;
  last_intent?: OyiIntentCategory;
  last_user_message?: string;
  entities: ConversationEntity[];
  active_domain?: string | null;
  active_entity_type?: ConversationEntity["type"] | null;
  active_entity?: ConversationEntity | null;
  active_entity_id?: string | null;
  active_entity_label?: string | null;
  active_list_position?: number | null;
  active_entity_position?: number | null;
  active_list_count?: number;
  active_action?: string | null;
  active_workflow?: Record<string, unknown> | null;
  last_response_type?: string | null;
  active_list?: ConversationEntity[];
  last_displayed_records?: ConversationEntity[];
  conversation_state?: "idle" | "browsing" | "inspecting" | "confirming" | "executing" | "reviewing";
  active_topic?: ConversationEntity["type"] | null;
  active_result_state?: "empty" | "list" | "entity" | null;
  list_offset?: number;
  pending_confirmation_id?: string | null;
  pending_action_summary?: string | null;
};

type ConversationContext = {
  state: ConversationState;
  estate_id?: string | null;
  home_id?: string | null;
  warning?: string;
};

type AwarenessResult = {
  headline: string;
  summary: string;
  body: string;
  severity: AwarenessSeverity;
  recommended_action: string;
  destination: string;
  cards: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  suggested_actions: Array<Record<string, unknown>>;
  awareness_score: number;
  score: number;
  generated_at: string;
};

type ThreadListInput = {
  surface?: OyiSurface;
  estate_id?: string | null;
  home_id?: string | null;
  limit?: number;
};

type CompatibilityChatResponse = {
  ok: true;
  message: string;
  intent: string;
  understood: string;
  execution: Record<string, unknown>;
  display_mode: "conversation" | "awareness";
  cards: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  suggested_actions: Array<Record<string, unknown>>;
  awareness?: AwarenessResult;
};

const SURFACES: OyiSurface[] = ["consumer", "facility", "office", "watch", "edge", "public_corporate", "office_internal"];
const SUMMARY_BY_SURFACE: Record<OyiSurface, IntelligenceSummaryType> = {
  consumer: "consumer",
  facility: "facility",
  office: "office",
  watch: "watch",
  edge: "edge",
  public_corporate: "office",
  office_internal: "office",
};

const ROUTES: Record<string, Record<string, string>> = {
  consumer: {
    activity: "/activity?filter=attention",
    maintenance: "/maintenance",
    visitors: "/visitors",
    devices: "/devices",
    security: "/activity?filter=attention",
    camera: "/activity?filter=attention",
    community: "/community",
    utilities: "/services",
    wallet: "/wallet",
    workflow: "/activity?filter=attention",
    calm: "/activity",
  },
  facility: {
    activity: "/alerts",
    maintenance: "/maintenance",
    visitors: "/visitors",
    devices: "/devices",
    security: "/security-access",
    camera: "/cameras",
    community: "/community",
    utilities: "/services",
    wallet: "/wallets",
    workflow: "/facility-intelligence",
    calm: "/overview",
  },
  office: {
    activity: "/",
    maintenance: "/",
    visitors: "/",
    devices: "/",
    security: "/",
    camera: "/",
    community: "/",
    utilities: "/",
    wallet: "/",
    workflow: "/",
    calm: "/",
  },
  watch: {},
  edge: {},
};

function safeSurface(value: unknown): OyiSurface {
  const surface = String(value || "consumer").toLowerCase() as OyiSurface;
  return SURFACES.includes(surface) ? surface : "consumer";
}

function validUuid(value?: string | null) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function genericThreadTitle(value: unknown) {
  return /^(oyi conversation|new conversation|chat|conversation)$/i.test(String(value || "").trim());
}

function cleanThreadPreview(value: unknown) {
  return String(value || "")
    .replace(/\b(?:ai|oyi|device|audit|proximity|runtime)\.[a-z0-9_.-]+\b/gi, "event")
    .replace(/\bInvalid Date\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || null;
}

function humanLabel(value?: unknown) {
  const label = String(value || "").trim();
  if (!label || validUuid(label)) return null;
  return label;
}

function durationLabel(ms: number) {
  const totalMinutes = Math.max(1, Math.round(Math.abs(ms) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d${hours ? ` ${hours}h` : ""}`;
  if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ""}`;
  return `${minutes}m`;
}

function workflowDueMessage(title: string, dueAt?: unknown) {
  if (!dueAt) return `${title} does not have a due date in the available workflow record.`;
  const due = new Date(String(dueAt));
  if (Number.isNaN(due.getTime())) return `${title} has an invalid due date in the available workflow record.`;
  const delta = due.getTime() - Date.now();
  if (delta < 0) return `${title} was due ${due.toLocaleString()}. It is overdue by ${durationLabel(delta)}.`;
  return `${title} is due ${due.toLocaleString()}. It is due in ${durationLabel(delta)}.`;
}

function awarenessSeverityToSignalSeverity(value?: AwarenessSeverity) {
  if (value === "critical") return "critical" as const;
  if (value === "warning") return "warning" as const;
  if (value === "attention") return "attention" as const;
  return "info" as const;
}

function awarenessSignalType(destination?: string | null) {
  const value = String(destination || "").trim().toLowerCase();
  if (/security|incident|camera|access/.test(value)) return "security" as const;
  if (/visitor/.test(value)) return "human" as const;
  if (/wallet|finance|payment/.test(value)) return "financial" as const;
  if (/community|message|communication/.test(value)) return "community" as const;
  if (/maintenance|service/.test(value)) return "maintenance" as const;
  if (/utility|environment|meter|device|infrastructure/.test(value)) return "infrastructure" as const;
  return "operational" as const;
}

function awarenessDomain(destination?: string | null) {
  const value = String(destination || "").trim().toLowerCase();
  if (/security|incident|camera|access/.test(value)) return "security";
  if (/visitor/.test(value)) return "visitor";
  if (/wallet|finance|payment/.test(value)) return "financial";
  if (/community|message|communication/.test(value)) return "community";
  if (/maintenance/.test(value)) return "maintenance";
  if (/service/.test(value)) return "service";
  if (/utility/.test(value)) return "utility";
  if (/environment/.test(value)) return "environmental";
  if (/device|infrastructure|provider|edge/.test(value)) return "infrastructure";
  return "operational";
}

function compatibilitySignalFromAwareness(
  awareness: AwarenessResult,
  actor: AuthUser | null,
  input: { surface?: OyiSurface; estate_id?: string | null; home_id?: string | null; context?: OisContext | null }
) {
  const context = input.context || null;
  const headlineSlug = String(awareness.headline || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return {
    id: `compat:${input.surface || "consumer"}:${headlineSlug || "awareness"}`,
    type: awarenessSignalType(awareness.destination),
    source: "oyi_compatibility_awareness",
    domain: awarenessDomain(awareness.destination),
    entity: {
      id: awareness.destination || headlineSlug || "awareness",
      name: awareness.headline,
      type: awarenessDomain(awareness.destination),
      status: awareness.severity,
    },
    estate: {
      id: input.estate_id || context?.estate_id || actor?.estate_id || "",
      name: "",
    },
    building: {
      id: "",
      name: "",
    },
    room: {
      id: input.home_id || context?.home_id || actor?.home_id || "",
      name: "",
    },
    actor: {
      id: actor?.id || "",
      name: actor?.username || actor?.email || "",
      role: actor?.role || "system",
    },
    severity: awarenessSeverityToSignalSeverity(awareness.severity),
    confidence: Math.max(0.45, Math.min(0.95, Number(awareness.awareness_score ?? awareness.score ?? 0.72) / 100 || 0.72)),
    timestamp: awareness.generated_at || new Date().toISOString(),
    context: {
      surface: input.surface || "consumer",
      module: context?.module || null,
      recommended_action: awareness.recommended_action,
      summary: awareness.summary,
    },
    metadata: {
      message: awareness.body || awareness.summary || awareness.headline,
      summary: awareness.summary || awareness.headline,
      recommended_action: awareness.recommended_action,
      destination: awareness.destination,
      compatibility_source: "legacy_oyi_awareness",
    },
    evidence: Array.isArray(awareness.sources)
      ? awareness.sources.slice(0, 5).map((item, index) => ({
          id: String(item?.id || `compat-evidence-${index + 1}`),
          type: String(item?.type || "compatibility_source"),
          source: String(item?.source || "legacy_oyi_awareness"),
          summary: String(item?.summary || item?.title || awareness.headline),
          timestamp: String(item?.timestamp || awareness.generated_at || new Date().toISOString()),
          metadata: item,
        }))
      : [],
  };
}

function isReadOnlyCompatibilityMessage(message: string) {
  const value = String(message || "").trim().toLowerCase();
  const readOnly =
    /attention|summary|summar|status|posture|health|what happened|what changed|why|explain|recommend|what should|evidence|verify|verification/.test(
      value
    );
  const mutating =
    /approve|reject|assign|create|open gate|grant|deny|turn on|turn off|switch on|switch off|run automation|execute|fund|pay|remove|delete|broadcast|post /.test(
      value
    );
  return readOnly && !mutating;
}

export function shouldUseOyiCoreCompatibilityChatForTest(message: string) {
  return isReadOnlyCompatibilityMessage(message);
}

function compatibilityConversationPayload(
  actor: AuthUser | null,
  input: OyiChatInput,
  awareness: AwarenessResult
): CompatibilityChatResponse | null {
  const signal = compatibilitySignalFromAwareness(awareness, actor, input);
  const response = oyiCoreRuntime.conversation(
    {
      id: `compat:${input.surface || "consumer"}:${Date.now()}`,
      query: input.message,
      estateId: input.estate_id || input.context?.estate_id || actor?.estate_id || null,
      unitId: input.home_id || input.context?.home_id || actor?.home_id || null,
      actor: {
        id: actor?.id || null,
        name: actor?.username || actor?.email || null,
        role: actor?.role || null,
        permissions: Array.isArray(actor?.permissions) ? actor.permissions : [],
      },
      context: input.context || undefined,
      requestedDomain: detectDomainIntent(normalizeOyiMessage(input.message), safeSurface(input.surface))?.key || null,
    },
    {
      signals: [signal],
      context: input.context || undefined,
      permissions: Array.isArray(actor?.permissions) ? actor.permissions : [],
    }
  );

  const summary = String(response.summary || response.answer || "").trim();
  const answer = String(response.answer || response.summary || "").trim();
  if (!summary && !answer) return null;

  return {
    ok: true,
    message: answer || summary,
    intent: response.intent,
    understood: summary || "Oyi Core reviewed the current operational context.",
    execution: {
      status: "read_only",
      source: "oyi_core_compatibility",
      approval_required: response.approvalRequired,
      confidence: response.confidence,
    },
    display_mode: awareness.severity === "normal" ? "conversation" : "awareness",
    cards: [],
    sources: awareness.sources || [],
    suggested_actions:
      awareness.suggested_actions ||
      response.availableActions.map((action) => ({
        label: action.title,
        action: action.type,
        target: action.target || null,
      })),
    awareness: awareness.severity === "normal" ? undefined : awareness,
  };
}

function emptyConversationState(): ConversationState {
  return { version: 1, entities: [], active_list: [], last_displayed_records: [], conversation_state: "idle" };
}

function arrayOfObjects(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
}

function recordOf(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function explicitDeviceEntity(input: OyiChatInput): ConversationEntity | null {
  const deviceId = String(input.device_id || "").trim();
  if (!deviceId) return null;
  const recentExecutions = arrayOfObjects(input.recent_executions);
  const activeScenes = arrayOfObjects(input.active_scenes);
  const activeAutomations = arrayOfObjects(input.active_automations);
  return {
    type: "device",
    id: deviceId,
    title: String(input.device_name || "Selected device").trim() || "Selected device",
    status: String(input.primary_state || input.health_status || "available").trim() || null,
    details: {
      room_id: input.room_id || null,
      room_name: input.room_name || null,
      control_profile: input.control_profile || null,
      primary_state: input.primary_state || null,
      health_status: input.health_status || null,
      supported_controls: Array.isArray(input.supported_controls) ? input.supported_controls : [],
      channel_definitions: Array.isArray(input.channel_definitions) ? input.channel_definitions : [],
      memory_summary: recordOf(input.memory_summary),
      relationships: recordOf(input.relationships),
      predictive_findings: arrayOfObjects(input.predictive_findings),
      recent_executions: recentExecutions,
      active_scenes: activeScenes,
      active_automations: activeAutomations,
      conversation_context: recordOf(input.conversation_context),
      activity_summary:
        String(
          recordOf(input.memory_summary).summary ||
          recentExecutions[0]?.summary ||
          input.primary_state ||
          "",
        ).trim() || null,
    },
  };
}

function entityTypeFromOperationalObject(value: unknown): ConversationEntity["type"] | null {
  const raw = String(value || "").toLowerCase();
  if (raw === "device" || raw === "device_channel") return "device";
  if (raw === "room" || raw === "home") return "room";
  if (raw === "visitor" || raw === "access_pass") return "visitor";
  if (raw === "maintenance_request") return "maintenance";
  if (raw === "wallet" || raw === "transaction") return "wallet";
  if (raw === "service_account" || raw === "meter") return "service";
  if (raw === "community_post") return "community";
  if (raw === "message_thread") return "community";
  if (raw === "notification") return "notification";
  if (raw === "camera") return "camera";
  if (raw === "infrastructure_asset" || raw === "provider") return "infrastructure";
  if (raw === "scene") return "scene";
  if (raw === "automation") return "automation";
  if (raw === "operational_incident" || raw === "operational_event") return "security";
  if (raw === "estate" || raw === "building" || raw === "floor" || raw === "zone" || raw === "twin_node") return "estate";
  return null;
}

function explicitOperationalObjectEntity(input: OyiChatInput): ConversationEntity | null {
  const object = recordOf(recordOf(input.conversation_context).canonical_operational_object);
  const type = entityTypeFromOperationalObject(object.object_type);
  const id = String(object.canonical_id || "").trim();
  if (!type || !id) return explicitDeviceEntity(input);
  const label = String(object.label || "Selected object").trim() || "Selected object";
  return {
    type,
    id,
    title: label,
    status: String(object.current_state || object.health || "available").trim() || null,
    details: {
      ...(recordOf(object.metadata)),
      object_type: object.object_type || null,
      estate_id: object.estate_id || input.estate_id || null,
      home_id: object.home_id || input.home_id || null,
      room_id: object.room_id || input.room_id || null,
      parent_id: object.parent_id || null,
      source_module: object.source_module || input.module || null,
      current_state: object.current_state || null,
      health_status: object.health || null,
      capabilities: Array.isArray(object.capabilities) ? object.capabilities : [],
      relationships: recordOf(object.relationships),
      freshness: object.freshness || null,
    },
  };
}

function primeConversationStateWithInput(previous: ConversationState, input: OyiChatInput): ConversationState {
  const entity = explicitOperationalObjectEntity(input);
  if (!entity) return previous;
  const previousActiveId = String(previous.active_entity_id || previous.active_entity?.id || "").trim();
  if (previousActiveId && previousActiveId === String(entity.id || "")) {
    return {
      ...previous,
      active_entity: entity,
      active_entity_id: String(entity.id || ""),
      active_entity_label: entity.title,
      active_entity_type: entity.type,
      active_topic: entity.type,
      active_domain: previous.active_domain || String(entity.details?.source_module || entity.type),
      entities: previous.entities.length ? previous.entities : [entity],
      active_list: previous.active_list?.length ? previous.active_list : [entity],
      last_displayed_records: previous.last_displayed_records?.length ? previous.last_displayed_records : [entity],
      active_result_state: previous.active_result_state || "entity",
      conversation_state: previous.conversation_state === "idle" ? "inspecting" : previous.conversation_state,
    };
  }
  return {
    version: 1,
    last_intent: previous.last_intent,
    last_user_message: previous.last_user_message,
    entities: [entity],
    active_domain: String(entity.details?.source_module || entity.type),
    active_entity_type: entity.type,
    active_entity: entity,
    active_entity_id: String(entity.id || ""),
    active_entity_label: entity.title,
    active_list_position: 0,
    active_entity_position: 0,
    active_list_count: 1,
    active_action: previous.active_action || null,
    active_workflow: null,
    last_response_type: previous.last_response_type || "conversation",
    active_list: [entity],
    last_displayed_records: [entity],
    conversation_state: "inspecting",
    active_topic: entity.type,
    active_result_state: "entity",
    list_offset: 0,
    pending_confirmation_id: null,
    pending_action_summary: null,
  };
}

function entityTypeFromCard(card: any): ConversationEntity["type"] | null {
  const value = `${card?.type || ""} ${card?.title || ""}`.toLowerCase();
  if (/visitor|guest|access/.test(value)) return "visitor";
  if (/maintenance|support|repair/.test(value)) return "maintenance";
  if (/room|space/.test(value)) return "room";
  if (/scene/.test(value)) return "scene";
  if (/automation|routine/.test(value)) return "automation";
  if (/camera/.test(value)) return "camera";
  if (/infrastructure|edge/.test(value)) return "infrastructure";
  if (/sensor|environment/.test(value)) return "sensor";
  if (/device|hardware/.test(value)) return "device";
  if (/wallet|payment|transaction/.test(value)) return "wallet";
  if (/service|utility|water|electric|internet/.test(value)) return "service";
  if (/community|notice|announcement/.test(value)) return "community";
  if (/notification|alert/.test(value)) return "notification";
  if (/security|incident/.test(value)) return "security";
  if (/traffic|mobility/.test(value)) return "traffic";
  if (/staff|operator|team/.test(value)) return "staff";
  if (/estate|building|unit|home/.test(value)) return "estate";
  if (/workflow/.test(value)) return "workflow";
  if (/report|audit|investigation/.test(value)) return "report";
  if (/attention|normal|awareness/.test(value)) return "awareness";
  return null;
}

function entityIdFromRow(row: any) {
  return row?.entity_id || row?.entityId || row?.device_id || row?.deviceId || row?.visitor_id || row?.visitorId || row?.maintenance_id || row?.maintenanceId || row?.request_id || row?.requestId || row?.id || null;
}

function entitiesFromCards(cards: any[]): ConversationEntity[] {
  const seen = new Set<string>();
  const entities: ConversationEntity[] = [];
  for (const card of cards || []) {
    const type = entityTypeFromCard(card);
    if (!type) continue;
    for (const row of Array.isArray(card?.items) ? card.items : []) {
      const title = String(row?.title || row?.label || row?.name || "").trim();
      if (!title) continue;
      const id = entityIdFromRow(row);
      const key = `${type}:${id || title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entities.push({
        type,
        id: id ? String(id) : null,
        title: title.slice(0, 140),
        status: String(row?.status || row?.subtitle || "") || null,
        details: {
          created_at: row?.created_at || row?.timestamp || null,
          updated_at: row?.updated_at || row?.timestamp || null,
          reported_by: row?.reported_by || row?.created_by_name || row?.reporter_name || null,
          summary: row?.summary || row?.description || null,
        },
      });
    }
  }
  return entities.slice(0, 20);
}

function topicForDomain(domain?: string | null): ConversationState["active_topic"] | null {
  const value = String(domain || "").toLowerCase();
  if (/workflow/.test(value)) return "workflow";
  if (/visitor|access/.test(value)) return "visitor";
  if (/maintenance|repair/.test(value)) return "maintenance";
  if (/room|space/.test(value)) return "room";
  if (/scene/.test(value)) return "scene";
  if (/automation|routine/.test(value)) return "automation";
  if (/camera/.test(value)) return "camera";
  if (/infrastructure|edge/.test(value)) return "infrastructure";
  if (/sensor|environment/.test(value)) return "sensor";
  if (/device|hardware/.test(value)) return "device";
  if (/wallet|finance|payment/.test(value)) return "wallet";
  if (/service|utility/.test(value)) return "service";
  if (/community|notice/.test(value)) return "community";
  if (/activity|timeline/.test(value)) return "activity";
  if (/notification|alert/.test(value)) return "notification";
  if (/security|incident/.test(value)) return "security";
  if (/traffic|mobility/.test(value)) return "traffic";
  if (/staff|operator|team/.test(value)) return "staff";
  if (/estate|building|home|unit/.test(value)) return "estate";
  if (/profile|household/.test(value)) return "profile";
  if (/report|audit/.test(value)) return "report";
  if (/queue|request/.test(value)) return "queue";
  if (/awareness|attention/.test(value)) return "awareness";
  return null;
}

function conversationStateFromResponse(previous: ConversationState, response: any, userMessage: string): ConversationState {
  const results = Array.isArray(response?.execution?.results) ? response.execution.results : [];
  const pending = results.find((row: any) => row?.status === "pending_confirmation" && row?.ledger_id);
  const hasResponseEntities = Array.isArray(response?.conversation_entities);
  const responseEntities = hasResponseEntities
    ? response.conversation_entities.slice(0, 50)
    : entitiesFromCards(response?.cards || []);
  const activeEntity = response?.conversation_active_entity || null;
  const domainSwitch = Boolean(response?.domain && response.domain !== previous.active_domain);
  // A detail/investigation reply must retain the list and domain it came from.
  const entities = hasResponseEntities
    ? responseEntities
    : activeEntity && !domainSwitch ? previous.entities.slice(0, 50) : responseEntities.length ? responseEntities : domainSwitch ? [] : previous.entities.slice(0, 50);
  const activeTopic = response?.conversation_topic
    || topicForDomain(response?.domain)
    || (activeEntity && !domainSwitch ? previous.active_topic : null)
    || topicForIntent(response?.intent)
    || (domainSwitch ? null : previous.active_topic)
    || null;
  const activeResultState = response?.conversation_result_state
    || (activeEntity ? "entity" : hasResponseEntities ? (entities.length ? "list" : "empty") : previous.active_result_state || null);
  const workflow = response?.execution_workflow !== undefined ? response.execution_workflow : domainSwitch ? null : previous.active_workflow || null;
  const workflowStage = String((workflow as any)?.stage || "");
  const conversationState = workflowStage === "confirmation_required" ? "confirming"
    : /execution_started/.test(workflowStage) ? "executing"
    : /execution_result|verification|cancelled/.test(workflowStage) ? "reviewing"
    : activeEntity ? "inspecting"
    : activeResultState === "list" ? "browsing"
    : previous.conversation_state || "idle";
  return {
    version: 1,
    last_intent: response?.intent || previous.last_intent,
    last_user_message: userMessage.slice(0, 500),
    entities: activeResultState === "empty" ? [] : entities.slice(0, 50),
    active_domain: response?.domain || previous.active_domain || null,
    active_entity_type: activeEntity?.type || (activeResultState === "list" || activeResultState === "empty" || domainSwitch ? null : previous.active_entity_type || null),
    active_entity: activeEntity || (activeResultState === "list" || activeResultState === "empty" || domainSwitch ? null : previous.active_entity || null),
    active_entity_id: activeEntity?.id || (activeResultState === "list" || activeResultState === "empty" || domainSwitch ? null : previous.active_entity_id || null),
    active_entity_label: activeEntity?.title || (activeResultState === "list" || activeResultState === "empty" || domainSwitch ? null : previous.active_entity_label || null),
    active_list_position: Number.isFinite(Number(activeEntity?.position)) ? Number(activeEntity.position) : activeResultState === "list" || activeResultState === "empty" || domainSwitch ? null : previous.active_list_position || null,
    active_entity_position: Number.isFinite(Number(activeEntity?.position)) ? Number(activeEntity.position) : activeResultState === "list" || activeResultState === "empty" || domainSwitch ? null : previous.active_entity_position || null,
    active_list_count: activeResultState === "empty" ? 0 : entities.length,
    active_action: response?.conversation_action !== undefined ? response.conversation_action : domainSwitch ? null : previous.active_action || null,
    active_workflow: workflow,
    last_response_type: response?.display_mode || previous.last_response_type || "conversation",
    active_list: activeResultState === "empty" ? [] : entities.slice(0, 50),
    last_displayed_records: activeResultState === "empty" ? [] : entities.slice(0, 50),
    conversation_state: conversationState,
    active_topic: activeTopic,
    active_result_state: activeResultState,
    list_offset: Number.isFinite(Number(response?.conversation_offset)) ? Number(response.conversation_offset) : previous.list_offset || 0,
    pending_confirmation_id: pending?.ledger_id || (workflowStage === "execution_result" || workflowStage === "cancelled" || domainSwitch ? null : previous.pending_confirmation_id || null),
    pending_action_summary: pending?.summary || (workflowStage === "execution_result" || workflowStage === "cancelled" || domainSwitch ? null : previous.pending_action_summary || null),
  };
}

function ordinalIndex(message: string, entityCount: number) {
  const lower = message.trim().toLowerCase();
  if (/\b(?:the\s+)?first(?:\s+one)?\b|\b1st\b|^(?:number\s+)?(?:one|1)$/.test(lower)) return 0;
  if (/\b(?:the\s+)?second(?:\s+one)?\b|\b2nd\b|^(?:number\s+)?(?:two|2)$/.test(lower)) return 1;
  if (/\b(?:the\s+)?third(?:\s+one)?\b|\b3rd\b|^(?:number\s+)?(?:three|3)$/.test(lower)) return 2;
  if (/\b(?:the\s+)?(?:last|latest|most recent)(?:\s+one|\s+report)?\b/.test(lower)) return Math.max(0, entityCount - 1);
  return null;
}

function normalizeEntityReference(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function namedEntity(message: string, entities: ConversationEntity[]) {
  const reference = String(message || "")
    .replace(/^(?:show|open|inspect|select|choose|view|tell me about|details? (?:for|of)|the)\s+/i, "")
    .replace(/[?!.,]+$/g, "")
    .trim();
  const query = normalizeEntityReference(reference);
  if (query.length < 3 || /^(?:it|that one|this one|why|when|who|history|activity|more)$/.test(query)) return null;
  const exact = entities.find((entity) => normalizeEntityReference(entity.title) === query);
  if (exact) return exact;
  return entities.find((entity) => {
    const label = normalizeEntityReference(entity.title);
    return label.includes(query) || query.includes(label);
  }) || null;
}

function ordinalEntity(message: string, entities: ConversationEntity[]) {
  const index = ordinalIndex(message, entities.length);
  return index === null ? null : entities[index] || null;
}

function activeEntityFromState(state: ConversationState) {
  const workflow = state.active_workflow as any;
  if (!state.active_entity_id && !state.active_entity_label && workflow?.workflow) {
    return workflowEntity(workflow.workflow);
  }
  if (!state.active_entity_id && !state.active_entity_label && state.entities.length === 1) return state.entities[0];
  if (!state.active_entity_id && !state.active_entity_label) return state.active_entity || null;
  return state.entities.find((entity) => (state.active_entity_id && entity.id === state.active_entity_id) || (state.active_entity_label && entity.title === state.active_entity_label)) || state.active_entity || null;
}

function naturalExecutionSource(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (/scene/.test(raw)) return "from a scene";
  if (/automation/.test(raw)) return "from an automation";
  if (/physical|manual/.test(raw)) return "from a manual switch action";
  if (/facility/.test(raw)) return "from facility";
  if (/provider/.test(raw)) return "from a provider sync";
  if (/watch/.test(raw)) return "from your watch";
  if (/phone|app|consumer/.test(raw)) return "from your phone";
  return `from ${raw.replace(/_/g, " ")}`;
}

function summarizeDeviceExecutions(entity: ConversationEntity) {
  const details = entity.details || {};
  const rows = Array.isArray(details.recent_executions) ? details.recent_executions as Array<Record<string, unknown>> : [];
  const title = entity.title;
  if (!rows.length) {
    const memory = recordOf(details.memory_summary);
    const summary = String(memory.summary || details.activity_summary || "").trim();
    return summary
      ? `${summary} I do not have a longer execution history attached to this device context yet.`
      : `I do not have recent activity attached for ${title} yet.`;
  }
  const latest = rows[0] || {};
  const time = latest.occurred_at ? new Date(String(latest.occurred_at)).toLocaleString() : null;
  const count = rows.length;
  const source = naturalExecutionSource(latest.source);
  const recentSummary = String(latest.summary || latest.title || "Recent device activity").trim();
  const countLine = `${title} was involved in ${count} recent ${count === 1 ? "action" : "actions"} I can see.`;
  const latestLine = `The most recent action was${time ? ` at ${time}` : " recently"}${source ? ` ${source}` : ""}.`;
  return `${countLine} ${latestLine} ${recentSummary}`.trim();
}

function summarizeDeviceRelationships(entity: ConversationEntity) {
  const details = entity.details || {};
  const relationships = recordOf(details.relationships);
  const room = String(details.room_name || relationships.room_name || "").trim();
  const parent = recordOf(relationships.parent_device);
  const children = Array.isArray(relationships.child_devices) ? relationships.child_devices as Array<Record<string, unknown>> : [];
  const scenes = Array.isArray(details.active_scenes) ? details.active_scenes as Array<Record<string, unknown>> : [];
  const automations = Array.isArray(details.active_automations) ? details.active_automations as Array<Record<string, unknown>> : [];
  const parts: string[] = [];
  if (room) parts.push(`${entity.title} is assigned to ${room}.`);
  if (parent.name) parts.push(`It depends on ${String(parent.name)} as its parent device.`);
  if (children.length) parts.push(`${children.length} child ${children.length === 1 ? "device is" : "devices are"} linked to it.`);
  if (scenes.length) parts.push(`${scenes.length} active ${scenes.length === 1 ? "scene affects" : "scenes affect"} it.`);
  if (automations.length) parts.push(`${automations.length} active ${automations.length === 1 ? "automation can control" : "automations can control"} it.`);
  if (!parts.length) return `I do not have linked scene, automation, parent, or child relationships attached for ${entity.title} yet.`;
  return parts.join(" ");
}

function summarizeDeviceDiagnosis(entity: ConversationEntity) {
  const details = entity.details || {};
  const conversationContext = recordOf(details.conversation_context);
  const findings = Array.isArray(details.predictive_findings) ? details.predictive_findings as Array<Record<string, unknown>> : [];
  const health = String(details.health_status || conversationContext.health || "unknown").replace(/_/g, " ").trim();
  const provider = String(conversationContext.provider_availability || "").replace(/_/g, " ").trim();
  const primaryState = String(details.primary_state || conversationContext.current_state || "").replace(/_/g, " ").trim();
  const leadFinding = findings[0] ? String(findings[0].summary || findings[0].headline || findings[0].title || "").trim() : "";
  const parts = [
    `${entity.title} is currently ${primaryState || "awaiting confirmation"}.`,
    health ? `Health is ${health}.` : "",
    provider ? `Provider availability is ${provider}.` : "",
    leadFinding || "",
  ].filter(Boolean);
  return parts.join(" ");
}

function referencedEntity(message: string, state: ConversationState) {
  const ordinal = ordinalEntity(message, state.entities);
  if (ordinal) return ordinal;
  const named = namedEntity(message, state.entities);
  if (named) return named;
  const lower = message.trim().toLowerCase();
  if (/\b(it|he|she|they|him|her|that one|this one|this device)\b|^(?:why|when|who|how)(?:\?|$)|^(?:show )?(?:activity|history|details|evidence|diagnostics)$|what (?:is|was|happened|should i do next)|what next|next action|when was|who (?:created|reported|owns)|status|blocking|overdue|verify|^(?:approve|reject|remove|assign|turn|switch|run)\b/i.test(lower)) {
    return activeEntityFromState(state);
  }
  return null;
}

function isFollowUpMessage(message: string, state?: ConversationState) {
  const value = message.trim().toLowerCase();
  if (["why", "why?", "when", "when?", "who", "who?"].includes(value)) return true;
  if (state && referencedEntity(message, state)) return true;
  return /\b(approve|reject|remove|assign|verify|owner|status|created|updated|evidence|diagnostics|blocking|overdue|what happened|show me more|more details|show activity|show history|show details|what should i do next|do it|go ahead|proceed|confirm|cancel|yes|no|that one|this one|this device|first|second|third|latest|most recent|number one|number two|number three|1st|2nd|3rd|when was|who created|who reported|who owns|why did|it|he|she|they|him|her)\b|^(?:one|two|three|1|2|3)$/i.test(value);
}

function topicForIntent(intent?: OyiIntentCategory): ConversationEntity["type"] | null {
  if (intent === "visitor_operation") return "visitor";
  if (intent === "maintenance_operation") return "maintenance";
  if (intent === "device_status" || intent === "device_control") return "device";
  if (intent === "wallet_operation") return "wallet";
  if (intent === "service_operation") return "service";
  if (intent === "community_operation") return "community";
  if (intent === "report_generation") return "report";
  if (intent === "awareness" || intent === "recommendation") return "awareness";
  return null;
}

function topicLabel(topic?: ConversationState["active_topic"] | null, plural = false) {
  const labels: Record<string, string> = {
    visitor: plural ? "visitor requests" : "visitor request",
    maintenance: plural ? "maintenance requests" : "maintenance request",
    device: plural ? "devices" : "device",
    service: plural ? "service requests" : "service request",
    wallet: plural ? "wallet records" : "wallet record",
    community: plural ? "community reports" : "community report",
    report: plural ? "reports" : "report",
    queue: plural ? "operational requests" : "operational request",
    workflow: plural ? "workflows" : "workflow",
    awareness: plural ? "attention items" : "attention item",
    room: plural ? "rooms or spaces" : "room or space",
    scene: plural ? "scenes" : "scene",
    automation: plural ? "automations" : "automation",
    notification: plural ? "notifications" : "notification",
    activity: plural ? "activity records" : "activity record",
    security: plural ? "security incidents" : "security incident",
    camera: plural ? "camera events" : "camera event",
    infrastructure: plural ? "infrastructure records" : "infrastructure record",
    sensor: plural ? "sensor readings" : "sensor reading",
    traffic: plural ? "traffic records" : "traffic record",
    staff: plural ? "staff tasks" : "staff task",
    estate: plural ? "estate structure records" : "estate structure record",
    profile: plural ? "home profile records" : "home profile record",
  };
  return labels[String(topic || "")] || (plural ? "records" : "record");
}

function emptyOrdinalMessage(topic?: ConversationState["active_topic"] | null, ordinal = "first") {
  if (topic === "visitor") return `There is no ${ordinal} visitor request to show because no visitor requests are currently pending.`;
  if (topic === "maintenance") return `There is no ${ordinal} maintenance request to show because no maintenance requests are currently open.`;
  if (topic === "community") return `There is no ${ordinal} community report to show because no community reports are currently available.`;
  if (topic === "workflow") return `There is no ${ordinal} workflow to show because no active workflows require attention.`;
  if (topic === "queue") return `There is no ${ordinal} operational request to show because no operational requests are currently available.`;
  return `There is no ${ordinal} ${topicLabel(topic)} to show because none are currently available in this context.`;
}

function followUpIntent(message: string, state: ConversationState): OyiIntentCategory {
  const lower = message.toLowerCase();
  if (/why\?|when\?|who\?|more details/.test(lower)) return "investigation";
  if (/show me more/.test(lower)) return state.last_intent || "general_help";
  return state.last_intent || "general_help";
}

function expandFollowUpMessage(message: string, state: ConversationState) {
  if (!isFollowUpMessage(message, state)) return message;
  const entity = referencedEntity(message, state);
  const lower = message.toLowerCase().trim();
  if (/show me more|more details/.test(lower)) return state.last_user_message || message;
  if (/^why\??$/.test(lower) && entity) return `Why is ${entity.title} in its current state?`;
  if (/^when\??$/.test(lower) && entity) return `When was ${entity.title} last updated?`;
  if (/^who\??$/.test(lower) && entity) return `Who is associated with ${entity.title}?`;
  return message;
}

export function resolveConversationFollowUpForTest(message: string, state: Partial<ConversationState>) {
  const normalized: ConversationState = {
    ...emptyConversationState(),
    ...state,
    entities: Array.isArray(state.entities) ? state.entities as ConversationEntity[] : [],
  };
  const entity = referencedEntity(message, normalized);
  const lower = message.trim().toLowerCase();
  const resolution = normalized.active_result_state === "empty" && normalized.active_topic
    ? /show (me )?(the )?(first|second|third|last|latest|most recent) one|(?:open|show) (?:the )?(?:first|second|third|last|latest|most recent|\d(?:st|nd|rd)?)(?: one)?|\b(?:the\s+)?(?:first|second|third|last|latest|most recent)(?:\s+one)?\b|^(?:number\s+)?(?:one|two|three|1|2|3)$|that one|this one/i.test(message) ? "empty_ordinal"
      : /^(why|why\?)|why did/i.test(message) ? "empty_explanation"
      : "empty_topic"
    : !entity && normalized.active_topic && /^(why|why\?|when|when\?|who|who\?)|when was|who reported|who owns|why did|what should i do next|what next|next action|blocking|overdue|verify/i.test(message) ? "topic_clarification"
      : !entity && /show (me )?(the )?(first|second|third|last|latest|most recent) one|(?:open|show) (?:the )?(?:first|second|third|last|latest|most recent|\d(?:st|nd|rd)?)(?: one)?|\b(?:the\s+)?(?:first|second|third|last|latest|most recent)(?:\s+one)?\b|^(?:number\s+)?(?:one|two|three|1|2|3)$|that one|this one/i.test(message) ? "no_active_list"
        : /show me more/.test(lower) ? "continuation"
          : entity ? "entity" : "none";
  return {
    is_follow_up: isFollowUpMessage(message, normalized),
    intent: followUpIntent(message, normalized),
    entity: entity ? { type: entity.type, id: entity.id || null, title: entity.title } : null,
    expanded_message: expandFollowUpMessage(message, normalized),
    pending_confirmation_id: normalized.pending_confirmation_id || null,
    active_topic: normalized.active_topic || null,
    active_result_state: normalized.active_result_state || null,
    resolution,
  };
}

function parseLimit(raw: unknown, fallback = 20) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(100, value));
}

function maxSeverityRank(severity: AwarenessSeverity) {
  if (severity === "critical") return 4;
  if (severity === "warning") return 3;
  if (severity === "attention") return 2;
  if (severity === "info") return 1;
  return 0;
}

function mergeEvents(persisted: any[], normalized: any[], limit: number) {
  const byKey = new Map<string, any>();
  for (const event of [...persisted, ...normalized]) {
    const key = String(event.id || `${event.source}:${event.metadata?.source_event_id || event.occurred_at}:${event.title}`);
    if (!byKey.has(key)) byKey.set(key, event);
  }
  return Array.from(byKey.values())
    .sort((a, b) => new Date(b.occurred_at || b.created_at).getTime() - new Date(a.occurred_at || a.created_at).getTime())
    .slice(0, limit);
}

function buildFilters(actor: AuthUser | null, input: { estate_id?: string | null; home_id?: string | null; limit?: number } = {}): IntelligenceEventFilters {
  return applyRoleScopeToFilters(
    {
      actor,
      estate_id: input.estate_id || actor?.estate_id || null,
      home_id: input.home_id || actor?.home_id || null,
      limit: input.limit || 100,
    },
    actor
  );
}

async function loadUnifiedContext(actor: AuthUser | null, input: { surface: OyiSurface; estate_id?: string | null; home_id?: string | null }) {
  const filters = buildFilters(actor, { estate_id: input.estate_id, home_id: input.home_id, limit: 120 });
  const [persisted, normalized, predictionResult, workflowResult] = await Promise.all([
    listPersistedIntelligenceEvents({ ...filters, limit: 120 }),
    loadNormalizedTimelineEvents({ ...filters, limit: 120 }),
    listIntelligencePredictions({ actor, estate_id: filters.estate_id, home_id: filters.home_id, status: "open", limit: 30 }),
    listWorkflows(actor, { limit: 50 }).catch((err: any) => ({ ok: false, workflows: [], warning: err?.message || "Workflow query failed" })),
  ]);

  const events = filterEventsForActor(mergeEvents(persisted.events || [], normalized.events || [], 120), actor);
  const predictions = predictionResult.predictions || [];
  const workflows = (workflowResult as any).workflows || [];
  const summary = buildIntelligenceSummary(SUMMARY_BY_SURFACE[input.surface], events, actor);
  const predictionSummary = summarizePredictions(predictions);
  const workflowSummary = summarizeWorkflows(workflows);
  const warnings = [persisted.warning, ...(normalized.warnings || []), predictionResult.warning, (workflowResult as any).warning, (workflowResult as any).error].filter(Boolean);

  return { filters, events, predictions, workflows, summary, predictionSummary, workflowSummary, warnings };
}

type AwarenessDomain =
  | "security"
  | "visitors"
  | "maintenance"
  | "infrastructure"
  | "devices"
  | "camera"
  | "utilities"
  | "finance"
  | "community"
  | "automation"
  | "predictions"
  | "workflows"
  | "activity";

type AwarenessSignal = {
  domain: AwarenessDomain;
  severity: AwarenessSeverity;
  headline: string;
  summary: string;
  recommended_action: string;
  route: string;
  source: string;
  items: any[];
  priority: number;
  attention_score: number;
  score_breakdown: {
    severity: number;
    recency: number;
    risk: number;
    relevance: number;
    source_reliability: number;
    actionability: number;
    surface_priority: number;
  };
};

function eventText(event: any) {
  return `${event.category || ""} ${event.event_type || ""} ${event.title || ""} ${event.summary || ""} ${event.source || ""}`.toLowerCase();
}

function isInternalAiEvent(event: any) {
  const text = eventText(event);
  return /ai response generated|ai tool executed|ai tool requested|ai command received|workflow evaluated|prediction generated|oyi\.chat|oyi\.awareness|tool executed|tool requested/.test(text);
}

function isSuccessfulRoutineEvent(event: any) {
  const text = eventText(event);
  const status = String(event.status || event.metadata?.status || "").toLowerCase();
  const success = /success|successful|completed|ok|executed/.test(text) || /success|completed|ok/.test(status);
  return success && /device command executed|command executed|switch updated|light switch updated|turned on|turned off|scene executed|automation executed|normal activity/.test(text);
}

function dedupeRows(rows: any[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      row.id || row.metadata?.source_event_id || "",
      row.event_type || row.prediction_type || row.workflow_type || "",
      row.device_id || row.camera_id || row.home_id || row.estate_id || "",
      row.title || row.summary || "",
      String(row.occurred_at || row.created_at || "").slice(0, 16),
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function eventBucket(event: any): AwarenessDomain {
  const category = String(event.category || event.event_type || "operational").toLowerCase();
  const text = `${category} ${event.event_type || ""} ${event.title || ""} ${event.summary || ""}`.toLowerCase();
  if (/security|critical|emergency|tamper|breach|intrusion|unauthorized/.test(text)) return "security";
  if (/camera|cctv|stream/.test(text)) return "camera";
  if (/visitor|access/.test(text)) return "visitors";
  if (/maintenance|repair|work.?order/.test(text)) return "maintenance";
  if (/edge|runtime|infrastructure|offline|sync|webhook|api|storage/.test(text)) return "infrastructure";
  if (/device|switch|sensor|relay|socket/.test(text)) return "devices";
  if (/community|notice|message|report/.test(text)) return "community";
  if (/wallet|payment|invoice|outstanding|fee|charge|balance/.test(text)) return "finance";
  if (/service|utility|water|electric|internet/.test(text)) return "utilities";
  if (/automation|scene|schedule/.test(text)) return "automation";
  if (/workflow/.test(text)) return "workflows";
  return "activity";
}

function cardTypeForBucket(bucket: string) {
  if (bucket === "visitors") return "visitors";
  if (bucket === "maintenance") return "maintenance";
  if (bucket === "devices" || bucket === "infrastructure") return "devices";
  if (bucket === "security") return "security";
  if (bucket === "camera") return "camera";
  if (bucket === "workflows" || bucket === "predictions") return "workflow";
  if (bucket === "community") return "community";
  if (bucket === "utilities" || bucket === "finance") return bucket === "finance" ? "wallet" : "utilities";
  return "attention";
}

function signalSeverity(domain: AwarenessDomain, rows: any[], fallback: AwarenessSeverity = "info") {
  const text = rows.map((row) => `${row.severity || ""} ${row.status || ""} ${row.workflow_priority || ""} ${row.workflow_status || ""} ${row.title || ""} ${row.summary || ""}`).join(" ").toLowerCase();
  if (/critical|emergency|breach|tamper|intrusion|security incident/.test(text)) return "critical";
  if (/outage|offline|failed|overdue|disruption|risk|warning|expired/.test(text)) return "warning";
  if (/pending|awaiting|open|assigned|in_progress|attention|visitor|maintenance/.test(text)) return "attention";
  if (domain === "activity" || domain === "automation") return "info";
  return fallback;
}

function awarenessDomainCopy(surface: OyiSurface, domain: AwarenessDomain, count: number, severity: AwarenessSeverity) {
  const plural = count === 1 ? "item" : "items";
  const facility = surface === "facility";
  const copy: Record<AwarenessDomain, { headline: string; summary: string; action: string }> = {
    security: {
      headline: severity === "critical" ? "Security requires immediate attention." : facility ? "Security requires review." : "Security requires attention.",
      summary: facility ? `${count} security ${plural} should be reviewed by operations.` : `${count} security ${plural} should be reviewed.`,
      action: facility ? "Review the security queue and confirm whether escalation is needed." : "Review the security item before taking any other action.",
    },
    visitors: {
      headline: facility ? "Visitor access needs attention." : "Visitor approval is waiting.",
      summary: `${count} visitor ${plural} may require review or approval.`,
      action: "Review the pending visitor request.",
    },
    maintenance: {
      headline: facility ? "Maintenance requires operational attention." : "Maintenance requires attention.",
      summary: `${count} maintenance ${plural} remain active or unresolved.`,
      action: facility ? "Assign or follow up on the unresolved maintenance issue." : "Review the open maintenance request.",
    },
    infrastructure: {
      headline: facility ? "Infrastructure health requires review." : "Device health requires review.",
      summary: `${count} infrastructure ${plural} indicate degraded health or runtime risk.`,
      action: "Investigate the affected infrastructure component.",
    },
    devices: {
      headline: facility ? "Device operations need review." : "Device attention required.",
      summary: `${count} device ${plural} show activity that may need review.`,
      action: facility ? "Check device health before changing configuration." : "Review device status before taking action.",
    },
    camera: {
      headline: "Camera operations require review.",
      summary: `${count} camera ${plural} indicate security, stream, or health activity.`,
      action: "Review the camera event and confirm stream health.",
    },
    utilities: {
      headline: facility ? "Infrastructure services need review." : "Service status needs review.",
      summary: `${count} utility ${plural} may affect service continuity.`,
      action: "Review the affected utility service.",
    },
    finance: {
      headline: facility ? "Finance or wallet status needs review." : "Payment status needs review.",
      summary: `${count} finance ${plural} may require payment or reconciliation.`,
      action: facility ? "Review outstanding charges or wallet activity." : "Review the outstanding balance or payment status.",
    },
    community: {
      headline: facility ? "Community activity needs moderation." : "Community update available.",
      summary: `${count} community ${plural} may need reading or moderation.`,
      action: facility ? "Review the community item for moderation." : "Review the community update.",
    },
    automation: {
      headline: "Automation activity is running normally.",
      summary: `${count} automation ${plural} were recorded recently.`,
      action: "No automation action is required unless the result looks unexpected.",
    },
    predictions: {
      headline: facility ? "Prediction requires operational review." : "Recommendation available.",
      summary: `${count} prediction ${plural} indicate possible future risk or opportunity.`,
      action: "Review the prediction evidence before deciding next steps.",
    },
    workflows: {
      headline: facility ? "Operational workflow needs attention." : "Workflow requires attention.",
      summary: `${count} workflow ${plural} are open or waiting for review.`,
      action: facility ? "Review the open workflow and assign ownership if needed." : "Review the workflow recommendation.",
    },
    activity: {
      headline: facility ? "Operations have recent activity." : "Home activity is normal.",
      summary: `${count} recent activity ${plural} were recorded without a clear risk signal.`,
      action: "No immediate action is required from this activity.",
    },
  };
  return copy[domain];
}

function domainRoute(surface: OyiSurface, domain: AwarenessDomain) {
  const routes = ROUTES[surface] || ROUTES.consumer;
  if (domain === "infrastructure") return routes.devices || routes.activity || "/";
  if (domain === "predictions" || domain === "workflows") return routes.workflow || routes.activity || "/";
  if (domain === "finance") return routes.wallet || routes.utilities || routes.activity || "/";
  return routes[domain] || routes.activity || routes.calm || "/";
}

function sourceReliability(rows: any[]) {
  const text = rows.map((row) => `${row.source || ""} ${row.metadata?.source_table || ""} ${row.metadata?.provider || ""}`).join(" ").toLowerCase();
  if (/camera_events|device_events|home_timeline|maintenance|visitors|notifications|wallet|provider|tuya|edge|ochiga_intelligence_predictions|ochiga_workflows/.test(text)) return 12;
  if (/normalized|activity|timeline/.test(text)) return 8;
  return 5;
}

function recencyScore(rows: any[], now = Date.now()) {
  const latest = rows
    .map((row) => new Date(row.occurred_at || row.created_at || row.updated_at || 0).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (!latest) return 4;
  const minutes = Math.max(0, (now - latest) / 60000);
  if (minutes <= 15) return 15;
  if (minutes <= 60) return 12;
  if (minutes <= 360) return 9;
  if (minutes <= 1440) return 6;
  return 3;
}

function riskScore(domain: AwarenessDomain, severity: AwarenessSeverity, rows: any[]) {
  const text = rows.map((row) => `${row.title || ""} ${row.summary || ""} ${row.severity || ""} ${row.status || ""}`).join(" ").toLowerCase();
  const severityBase = severity === "critical" ? 25 : severity === "warning" ? 19 : severity === "attention" ? 13 : severity === "info" ? 3 : 0;
  const domainRisk: Record<AwarenessDomain, number> = {
    security: 18,
    camera: 15,
    infrastructure: 14,
    utilities: 11,
    maintenance: 10,
    visitors: 9,
    devices: 7,
    finance: 7,
    community: 5,
    workflows: 6,
    predictions: 6,
    automation: 2,
    activity: 1,
  };
  const languageRisk = /breach|tamper|intrusion|emergency|outage|offline|overdue|failed|expired|unpaid|unauthorized/.test(text) ? 8 : 0;
  return severityBase + domainRisk[domain] + languageRisk;
}

function actionabilityScore(domain: AwarenessDomain, severity: AwarenessSeverity, rows: any[]) {
  const text = rows.map((row) => `${row.title || ""} ${row.summary || ""} ${row.status || ""} ${row.recommended_action || ""}`).join(" ").toLowerCase();
  if (severity === "normal" || (severity === "info" && rows.every(isSuccessfulRoutineEvent))) return 0;
  if (/pending|awaiting|approve|assign|overdue|offline|failed|review|unpaid|open|required|requires/.test(text)) return 15;
  if (["security", "visitors", "maintenance", "infrastructure", "utilities"].includes(domain)) return 10;
  return 4;
}

function relevanceScore(surface: OyiSurface, domain: AwarenessDomain, actor: AuthUser | null) {
  const role = String(actor?.role || "").toLowerCase();
  if (surface === "facility") {
    if (/security|facility|admin|operator|manager|super/.test(role)) return ["security", "camera", "infrastructure", "utilities", "maintenance", "visitors"].includes(domain) ? 14 : 8;
    return 8;
  }
  if (surface === "consumer") {
    if (/resident|owner|tenant|admin|member/.test(role)) return ["security", "visitors", "maintenance", "devices", "utilities", "finance"].includes(domain) ? 14 : 7;
    return 8;
  }
  return 8;
}

function surfacePriorityScore(surface: OyiSurface, domain: AwarenessDomain) {
  const order: AwarenessDomain[] = surface === "facility"
    ? ["security", "camera", "infrastructure", "utilities", "maintenance", "visitors", "community", "finance", "workflows", "predictions", "devices", "activity", "automation"]
    : ["security", "visitors", "maintenance", "devices", "utilities", "infrastructure", "workflows", "predictions", "community", "finance", "automation", "activity", "camera"];
  const index = order.indexOf(domain);
  if (index === -1) return 0;
  return Math.max(0, 13 - index);
}

function scoreSignal(surface: OyiSurface, actor: AuthUser | null, signal: Omit<AwarenessSignal, "attention_score" | "score_breakdown">) {
  const severity = signal.severity === "critical" ? 28 : signal.severity === "warning" ? 22 : signal.severity === "attention" ? 16 : signal.severity === "info" ? 2 : 0;
  const recency = recencyScore(signal.items);
  const risk = riskScore(signal.domain, signal.severity, signal.items);
  const relevance = relevanceScore(surface, signal.domain, actor);
  const reliability = sourceReliability(signal.items);
  const actionability = actionabilityScore(signal.domain, signal.severity, signal.items);
  const surfacePriority = surfacePriorityScore(surface, signal.domain);
  const routinePenalty = signal.items.every(isSuccessfulRoutineEvent) ? 35 : 0;
  const duplicatePenalty = Math.max(0, signal.items.length - dedupeRows(signal.items).length) * 4;
  const attention_score = Math.max(0, Math.min(100, severity + recency + risk + relevance + reliability + actionability + surfacePriority - routinePenalty - duplicatePenalty));
  return {
    attention_score,
    score_breakdown: {
      severity,
      recency,
      risk,
      relevance,
      source_reliability: reliability,
      actionability,
      surface_priority: surfacePriority,
    },
  };
}

function buildSignals(surface: OyiSurface, context: Awaited<ReturnType<typeof loadUnifiedContext>>, actor: AuthUser | null = null) {
  const buckets = new Map<AwarenessDomain, any[]>();
  for (const event of context.events.slice(0, 80)) {
    if (isInternalAiEvent(event)) continue;
    const bucket = eventBucket(event);
    buckets.set(bucket, [...(buckets.get(bucket) || []), event]);
  }
  if (context.predictions.length) {
    buckets.set("predictions", [
      ...(buckets.get("predictions") || []),
      ...context.predictions.map((prediction: any) => ({ ...prediction, occurred_at: prediction.created_at, source: "ochiga_intelligence_predictions" })),
    ]);
  }
  const openWorkflows = rankActiveWorkflowsForAwareness(context.workflows || []);
  if (openWorkflows.length) {
    for (const workflow of openWorkflows) {
      const type = String(workflow.workflow_type || "").toLowerCase();
      const domain: AwarenessDomain = /security|camera/.test(type) ? "security"
        : /visitor/.test(type) ? "visitors"
        : /maintenance/.test(type) ? "maintenance"
        : /wallet/.test(type) ? "finance"
        : /service/.test(type) ? "utilities"
        : "workflows";
      buckets.set(domain, [...(buckets.get(domain) || []), { ...workflow, occurred_at: workflow.updated_at || workflow.created_at, source: "ochiga_workflows", workflow_driven: true }]);
    }
    buckets.set("workflows", [
      ...(buckets.get("workflows") || []),
      ...openWorkflows.map((workflow: any) => ({ ...workflow, occurred_at: workflow.updated_at || workflow.created_at, source: "ochiga_workflows", workflow_driven: true })),
    ]);
  }

  const priorityOrder: AwarenessDomain[] = surface === "facility"
    ? ["security", "camera", "infrastructure", "utilities", "maintenance", "visitors", "community", "finance", "workflows", "predictions", "devices", "activity", "automation"]
    : ["security", "visitors", "maintenance", "devices", "utilities", "infrastructure", "workflows", "predictions", "community", "finance", "automation", "activity", "camera"];

  return Array.from(buckets.entries()).map(([domain, rows]) => {
    const uniqueRows = dedupeRows(rows);
    const severity = uniqueRows.every(isSuccessfulRoutineEvent) ? "info" : signalSeverity(domain, uniqueRows);
    const copy = awarenessDomainCopy(surface, domain, uniqueRows.length, severity);
    const priority = priorityOrder.indexOf(domain);
    const signal = {
      domain,
      severity,
      headline: copy.headline,
      summary: copy.summary,
      recommended_action: copy.action,
      route: domainRoute(surface, domain),
      source: String(uniqueRows[0]?.source || uniqueRows[0]?.metadata?.source_table || domain),
      items: uniqueRows.slice(0, 5),
      priority: priority === -1 ? 99 : priority,
    };
    return { ...signal, ...scoreSignal(surface, actor, signal) } satisfies AwarenessSignal;
  });
}

function buildCardsFromSignals(signals: AwarenessSignal[]) {
  return signals.slice(0, 6).map((signal) => ({
    type: cardTypeForBucket(signal.domain),
    title: signal.headline.replace(/\.$/, ""),
    summary: signal.summary,
    items: signal.items.slice(0, 5).map((row: any) => ({
      id: row.id || row.workflow_id || null,
      title: row.location || row.device_name || row.camera_name || row.name || row.title || row.prediction_type || "Supporting evidence",
      summary: row.recommended_action || row.summary || row.status || "Review this supporting item.",
      status: row.status || row.workflow_status || row.severity || signal.severity,
      occurred_at: row.occurred_at || row.created_at || null,
    })),
    score: signal.attention_score,
  }));
}

function pickPrimarySignal(signals: AwarenessSignal[]) {
  return [...signals].sort((a, b) => {
    const scoreDelta = b.attention_score - a.attention_score;
    if (Math.abs(scoreDelta) >= 8) return scoreDelta;
    const severityDelta = maxSeverityRank(b.severity) - maxSeverityRank(a.severity);
    if (severityDelta) return severityDelta;
    return a.priority - b.priority;
  })[0] || null;
}

function scoreFromDecision(severity: AwarenessSeverity, signals: AwarenessSignal[]) {
  const topScore = Math.max(0, ...signals.map((signal) => signal.attention_score || 0));
  const base = severity === "critical" ? 20 : severity === "warning" ? 42 : severity === "attention" ? 64 : severity === "info" ? 84 : 96;
  const pressure = Math.min(18, Math.floor(topScore / 8) + Math.max(0, signals.length - 1) * 2);
  return Math.max(0, Math.min(100, base - pressure));
}

function calmAwareness(surface: OyiSurface, signals: AwarenessSignal[], generatedAt: string): AwarenessResult {
  const routes = ROUTES[surface] || ROUTES.consumer;
  const facility = surface === "facility";
  const summary = facility
    ? "No critical security alerts detected. Visitor, maintenance, infrastructure, and utility signals are stable."
    : "No security issues detected. No visitor approvals are pending. Maintenance, services, and device activity appear normal.";
  const score = scoreFromDecision("normal", signals);
  return {
    headline: facility ? "Estate operations are stable." : "Your home is operating normally.",
    summary,
    body: summary,
    severity: "normal",
    recommended_action: "No action is currently required.",
    destination: routes.calm || "/activity",
    cards: [
      {
        type: "attention",
        title: facility ? "Operations stable" : "Home operating normally",
        summary,
        items: [],
        score,
        category: "normal",
      },
      ...buildCardsFromSignals(signals.filter((signal) => signal.severity === "info" && signal.attention_score < 55).slice(0, 2)).map((card) => ({
        ...card,
        title: "Normal activity",
      })),
    ],
    sources: [],
    suggested_actions: [],
    awareness_score: score,
    score,
    generated_at: generatedAt,
  };
}

function buildAwareness(surface: OyiSurface, context: Awaited<ReturnType<typeof loadUnifiedContext>>, actor: AuthUser | null = null): AwarenessResult {
  const generatedAt = new Date().toISOString();
  const signals = buildSignals(surface, context, actor);
  const actionableSignals = signals.filter((signal) => maxSeverityRank(signal.severity) >= maxSeverityRank("attention") && signal.attention_score >= 50);
  const primary = pickPrimarySignal(actionableSignals);
  if (!primary) return calmAwareness(surface, signals, generatedAt);

  const secondary = actionableSignals.find((signal) => signal.domain !== primary.domain);
  const summary = secondary ? `${primary.summary} ${secondary.summary}` : primary.summary;
  const cards = buildCardsFromSignals([primary, ...actionableSignals.filter((signal) => signal.domain !== primary.domain)]);
  const sources = actionableSignals.slice(0, 6).map((signal) => ({ label: signal.domain.replace(/_/g, " "), route: signal.route, table: signal.source }));
  const suggested_actions = actionableSignals.slice(0, 5).map((signal) => ({
    label: signal.recommended_action,
    route: signal.route,
    risk: "read",
  }));
  const score = scoreFromDecision(primary.severity, actionableSignals);
  return {
    headline: primary.headline,
    summary,
    body: summary,
    severity: primary.severity,
    recommended_action: primary.recommended_action,
    destination: primary.route,
    cards,
    sources,
    suggested_actions,
    awareness_score: score,
    score,
    generated_at: generatedAt,
  };
}

function buildSources(surface: OyiSurface, context: Awaited<ReturnType<typeof loadUnifiedContext>>) {
  const rows = new Map<string, any>();
  for (const signal of buildSignals(surface, context)) {
    rows.set(signal.domain, { label: signal.domain.replace(/_/g, " "), route: signal.route, table: signal.source });
  }
  return Array.from(rows.values()).slice(0, 8);
}

function buildSuggestedActions(surface: OyiSurface, message: string, awareness: AwarenessResult, context: Awaited<ReturnType<typeof loadUnifiedContext>>) {
  const lower = message.toLowerCase();
  const signals = buildSignals(surface, context);
  const actions = new Map<string, any>();
  const add = (label: string, route?: string, risk = "read") => {
    if (!route) return;
    actions.set(`${label}:${route}`, { label, route, risk });
  };
  add(awareness.recommended_action, awareness.destination, "read");
  for (const signal of signals.filter((item) => maxSeverityRank(item.severity) >= maxSeverityRank("attention") && item.attention_score >= 50).slice(0, 5)) {
    add(signal.recommended_action, signal.route, "read");
  }
  if (/maintenance|repair|work/.test(lower)) add("Review the maintenance queue.", domainRoute(surface, "maintenance"), "read");
  if (/visitor|access|gate/.test(lower)) add("Review visitor access.", domainRoute(surface, "visitors"), "read");
  if (/device|infrastructure|offline|health/.test(lower)) add("Check infrastructure health.", domainRoute(surface, surface === "facility" ? "infrastructure" : "devices"), "read");
  if (/camera|security|cctv/.test(lower)) add("Review security activity.", domainRoute(surface, "security"), "read");
  if (/utility|service|wallet|payment|water|electric|internet/.test(lower)) add("Review infrastructure services or payment status.", domainRoute(surface, "utilities"), "read");
  return Array.from(actions.values()).slice(0, 6);
}

type OyiIntentCategory =
  | "awareness"
  | "investigation"
  | "device_control"
  | "device_status"
  | "visitor_operation"
  | "maintenance_operation"
  | "wallet_operation"
  | "service_operation"
  | "community_operation"
  | "notification_operation"
  | "report_generation"
  | "capability_query"
  | "recommendation"
  | "general_help";

type OperatingResult = {
  intent: OyiIntentCategory;
  understood: string;
  message: string;
  cards: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  suggested_actions: Array<Record<string, unknown>>;
  execution?: Record<string, unknown>;
  conversation_entities?: ConversationEntity[];
  conversation_offset?: number;
  conversation_topic?: ConversationState["active_topic"];
  conversation_result_state?: ConversationState["active_result_state"];
  display_mode?: "conversation" | "list" | "detail" | "audit" | "report" | "awareness";
  domain?: string | null;
  conversation_active_entity?: ConversationEntity & { position?: number };
  conversation_action?: string | null;
  execution_workflow?: Record<string, unknown> | null;
};

function executionWorkflowFromResults(action: string, results: any[]) {
  const pending = results.find((row) => row?.status === "pending_confirmation");
  if (pending) return {
    stage: "confirmation_required",
    action,
    candidate_entities: Array.isArray(pending?.data?.entities) ? pending.data.entities : [],
    confirmation_id: pending.ledger_id || null,
    message: pending.summary || "Confirmation is required before Oyi executes this action.",
  };
  const completed = results.filter((row) => row?.status === "executed").length;
  const failed = results.filter((row) => ["failed", "denied"].includes(String(row?.status))).length;
  return {
    stage: "execution_result",
    action,
    completed,
    failed,
    verification: "Provider and command results were recorded in the Oyi audit trail.",
  };
}

type DomainIntent = {
  key: string;
  surfaces: OyiSurface[];
  phrases: RegExp;
  intent: OyiIntentCategory;
  tool_id?: ProposedAiTool["tool_id"];
  label: string;
  unavailable: string;
};

const DOMAIN_INTENTS: DomainIntent[] = [
  { key: "operational_queue", surfaces: ["facility"], phrases: /(?:(?:open|show|review)\s+(?:the\s+)?(?:most\s+)?(?:important\s+issue|recent(?:\s+operational)?\s+requests?|pending\s+(?:issues?|requests?|tasks?)|assigned\s+tasks?|operator\s+requests?|operator\s+request|recent\s+requests?|work\s+queue|open\s+requests?|today(?:'s)?\s+handover|handover|unassigned\s+work|escalated\s+(?:work|incidents?|operations?)|(?:work|items?)\s+(?:awaiting|requiring)\s+verification)|what\s+(?:is|needs)\s+(?:overdue|blocked|escalated|unassigned|urgent|requiring\s+verification)|what\s+must\s+be\s+handed\s+over|summarize\s+unresolved\s+operations)/i, intent: "investigation", tool_id: "summarize_module", label: "recent operational requests", unavailable: "There are currently no recent operational requests to show." },
  { key: "workflows", surfaces: ["consumer", "facility", "office"], phrases: /(?:show|open|list|review)\s+(?:active|open|pending)?\s*workflows?|workflow\s+(?:status|queue|owner|overdue|blocking)/i, intent: "investigation", label: "workflows", unavailable: "There are currently no active workflows requiring attention." },
  { key: "visitors", surfaces: ["consumer", "facility"], phrases: /visitor|vistors|visistor|guest|guest access|gate pass|access pass|access code|visitor access|visitor approval/i, intent: "visitor_operation", tool_id: "summarize_module", label: "visitor requests", unavailable: "I can’t see visitor records for this context yet." },
  { key: "maintenance", surfaces: ["consumer", "facility"], phrases: /maintenance|maint request|mainterequest|repair|fault report|issue request|service ticket|work order/i, intent: "maintenance_operation", tool_id: "summarize_module", label: "maintenance issues", unavailable: "I can’t see maintenance records for this context yet." },
  { key: "devices", surfaces: ["consumer", "facility"], phrases: /device|appliance|smart device|light|switch|socket|hardware|relay|ac\b/i, intent: "device_status", tool_id: "summarize_devices", label: "devices", unavailable: "I can’t see device records for this context yet." },
  { key: "rooms", surfaces: ["consumer"], phrases: /room|rooms|space|spaces/i, intent: "general_help", tool_id: "summarize_module", label: "rooms and spaces", unavailable: "I don’t have room records available through this chat context yet." },
  { key: "scenes", surfaces: ["consumer"], phrases: /scene|scenes/i, intent: "general_help", tool_id: "summarize_module", label: "scenes", unavailable: "I don’t have scene records available through this chat context yet." },
  { key: "automation", surfaces: ["consumer"], phrases: /automation|automations|routine|routines/i, intent: "general_help", tool_id: "summarize_module", label: "automations", unavailable: "I don’t have automation records available through this chat context yet." },
  { key: "services", surfaces: ["consumer", "facility"], phrases: /service|services|fiber|internet plan|service request/i, intent: "service_operation", tool_id: "summarize_module", label: "services", unavailable: "I don’t have service records available through this chat context yet." },
  { key: "wallet", surfaces: ["consumer", "facility"], phrases: /wallet|payment|payments|transaction|transactions|balance|charge|service charge|dues|levy|bill|receipt|accounting/i, intent: "wallet_operation", tool_id: "summarize_module", label: "wallet information", unavailable: "I can’t see wallet records for this context yet." },
  { key: "community", surfaces: ["consumer", "facility"], phrases: /community|announcement|announcements|notice|notices|complaint|feedback|post|message|update|communications/i, intent: "community_operation", tool_id: "summarize_module", label: "community updates", unavailable: "There are no recent community updates available in this context." },
  { key: "activity", surfaces: ["consumer", "facility"], phrases: /activity|timeline|recent activity|who did what/i, intent: "investigation", tool_id: "summarize_module", label: "activity", unavailable: "I don’t have activity records available in this context yet." },
  { key: "notifications", surfaces: ["consumer", "facility"], phrases: /notification|notifications|alert|alerts/i, intent: "notification_operation", tool_id: "summarize_module", label: "notifications", unavailable: "There are no notifications available in this context." },
  { key: "security", surfaces: ["consumer", "facility"], phrases: /security|incident|incidents|alarm|gate|door|access control/i, intent: "investigation", tool_id: "summarize_module", label: "security activity", unavailable: "I don’t have security records available in this chat context yet." },
  { key: "utilities", surfaces: ["consumer", "facility"], phrases: /utility|utilities|water|electricity|electric|meter|power|generator/i, intent: "service_operation", tool_id: "summarize_module", label: "infrastructure services information", unavailable: "I don’t have infrastructure service records available in this chat context yet." },
  { key: "profile", surfaces: ["consumer"], phrases: /profile|home context|my home|household/i, intent: "general_help", tool_id: "summarize_module", label: "home context", unavailable: "I don’t have additional home profile records available in this chat context yet." },
  { key: "cameras", surfaces: ["facility"], phrases: /camera|cameras|cctv|camera event/i, intent: "device_status", tool_id: "summarize_module", label: "camera events", unavailable: "There are no camera events currently visible." },
  { key: "infrastructure", surfaces: ["facility"], phrases: /infrastructure|runtime|edge node|stream health/i, intent: "device_status", tool_id: "summarize_devices", label: "infrastructure records", unavailable: "I don’t have infrastructure records available in this chat context yet." },
  { key: "sensors", surfaces: ["facility"], phrases: /sensor|sensors|environment|temperature|humidity/i, intent: "device_status", tool_id: "summarize_module", label: "sensor readings", unavailable: "I don’t have sensor readings available in this chat context yet." },
  { key: "traffic", surfaces: ["facility"], phrases: /traffic|mobility|parking|vehicle flow/i, intent: "general_help", tool_id: "summarize_module", label: "traffic and mobility records", unavailable: "I don’t have traffic or mobility records available in this chat context yet." },
  { key: "staff", surfaces: ["facility"], phrases: /staff|team|operator|operators|staff task|staff tasks|technician|cleaner|electrician|mechanic/i, intent: "general_help", tool_id: "summarize_module", label: "staff records", unavailable: "I don’t have staff records available in this chat context yet." },
  { key: "reports", surfaces: ["facility"], phrases: /report|reports|daily estate/i, intent: "report_generation", tool_id: "summarize_module", label: "reports", unavailable: "I don’t have report records available in this chat context yet." },
  { key: "estate", surfaces: ["facility"], phrases: /estate structure|estate|homes|home list|building|units/i, intent: "general_help", tool_id: "summarize_module", label: "estate structure", unavailable: "I don’t have estate structure records available in this chat context yet." },
];

function detectDomainIntent(message: string, surface: OyiSurface): DomainIntent | null {
  return DOMAIN_INTENTS.find((domain) => domain.surfaces.includes(surface) && domain.phrases.test(message)) || null;
}

function normalizeOyiMessage(message: string) {
  return String(message || "")
    .replace(/\b(?:maintainance|maintenence|maintainence|maintenace)\b/gi, "maintenance")
    .replace(/\bmainterequest\b/gi, "maintenance request")
    .replace(/\bmaint request\b/gi, "maintenance request")
    .replace(/\b(?:vistors|visistor)\b/gi, "visitors")
    .replace(/\bvisitor acess\b/gi, "visitor access")
    .replace(/who(?:'s| is) visiting|who is at (?:my )?(?:home|house)|who came in|any visitors|who(?:'s| is) active|guest access|gate pass|access code/gi, "show visitor access")
    .replace(/turn lights on|switch on lights|enable lights|power on lights/gi, "turn on lights")
    .replace(/turn lights off|switch off lights|disable lights|power off lights|power it down|switch it off/gi, "turn off lights")
    .replace(/repair request|fault report|issue request|work order/gi, "maintenance request")
    .replace(/show maintenance issue/gi, "show maintenance issues")
    .replace(/show visitor requests?/gi, "show visitor access")
    .trim()
    .replace(/[?!.]+$/, "");
}

export function normalizeOyiMessageForTest(message: string) {
  return normalizeOyiMessage(message);
}

export function detectOyiDomainForTest(message: string, surface: OyiSurface) {
  return detectDomainIntent(normalizeOyiMessage(message), surface)?.key || null;
}

export function resolveOyiDomainIntentForTest(message: string, surface: OyiSurface) {
  const normalized = normalizeOyiMessage(message);
  const domain = detectDomainIntent(normalized, surface);
  const classified = classifyOyiOperatingIntentForTest(normalized);
  return { domain: domain?.key || null, intent: domain?.intent || classified, awareness_fallback_used: !domain && classified === "awareness" };
}

export function classifyOyiOperatingIntentForTest(message: string): OyiIntentCategory {
  const text = normalizeOyiMessage(message).toLowerCase().replace(/[’`]/g, "'");
  if (/what can you do|what can you control|what can you show|capabilit|available actions|help me/.test(text)) return "capability_query";
  if (/visitor|guest|visitor access|visitor approval|invite .*visitor|add .+ as visitor|create visitor/.test(text)) return "visitor_operation";
  if (/maintenance|repair|service ticket|open issue|overdue ticket/.test(text)) return "maintenance_operation";
  if (/who opened|who approved|who is associated|when (did|was|is)|why is|what caused|last device command|activity around|incident/.test(text)) return "investigation";
  if (/offline devices|device health|camera status|device status|summarize device|show .*devices|infrastructure issue|camera event/.test(text)) return "device_status";
  if (/turn on|turn off|switch on|switch off|set .*temperature|control .*device|control .*light|control .*ac|pump|generator|gate/.test(text)) return "device_control";
  if (/what'?s happening|what is happening|needs attention|what should i do|everything okay|urgent|changed today|overnight|status|summary/.test(text)) return "awareness";
  if (/wallet|balance|transaction|payment|charge|statement/.test(text)) return "wallet_operation";
  if (/service request|service status|utility|water|electric|internet|fiber/.test(text)) return "service_operation";
  if (/announcement|notice|resident notice|community|complaint|feedback/.test(text)) return "community_operation";
  if (/notification|notify|alert/.test(text)) return "notification_operation";
  if (/report|daily estate|home activity report|maintenance report|visitor report|incident report|who did what/.test(text)) return "report_generation";
  if (/recommend|next action|suggest/.test(text)) return "recommendation";
  return "general_help";
}

function capabilityMessage(surface: OyiSurface) {
  return surface === "facility"
    ? "I can help manage estate operations. I can summarize what needs attention, review devices and infrastructure, check visitor activity, track maintenance, support service operations, summarize wallet and finance activity, prepare reports, and carry out permitted operational actions through safety checks."
    : "I can help you understand and operate your home. I can check what’s happening, summarize device status, show offline devices, review visitor activity, track maintenance, explain wallet activity, and generate home reports. Where useful, I can also carry out permitted actions safely.";
}

function understoodText(surface: OyiSurface, intent: OyiIntentCategory) {
  const audience = surface === "facility" ? "estate" : "home";
  const labels: Record<OyiIntentCategory, string> = {
    awareness: `I’ll review the current ${audience} state.`,
    investigation: "I’ll look through the available operational history.",
    device_control: "I’ll check whether that device action can be completed safely.",
    device_status: "I’ll check the available device and infrastructure status.",
    visitor_operation: "I’ll review the relevant visitor activity.",
    maintenance_operation: "I’ll review the maintenance situation.",
    wallet_operation: "I’ll review the available wallet and payment information.",
    service_operation: "I’ll review the available infrastructure service information.",
    community_operation: "I’ll review the available community activity.",
    notification_operation: "I’ll review the relevant notifications.",
    report_generation: "I’ll prepare a summary from the available operational records.",
    capability_query: "I’ll outline the ways I can help in this context.",
    recommendation: `I’ll identify the most useful next step for this ${audience}.`,
    general_help: "I’ll help with the information available in this context.",
  };
  return labels[intent];
}

function awarenessSupportCards(awareness: AwarenessResult, includeCalmState = false) {
  if (awareness.severity === "normal" && !includeCalmState) return [];
  return [{
    type: awareness.severity === "normal" ? "normal" : "attention",
    title: awareness.headline,
    summary: awareness.summary || awareness.recommended_action,
    items: awareness.recommended_action && awareness.severity !== "normal"
      ? [{ title: "Recommended action", status: awareness.recommended_action }]
      : [],
  }];
}

function userFacingSources(surface: OyiSurface, type: "awareness" | "operation" | "report") {
  const scope = surface === "facility" ? "Estate operations" : "Home activity";
  if (type === "report") return [{ label: `${scope} report` }];
  if (type === "operation") return [{ label: "Oyi action record" }];
  return [{ label: scope }];
}

function operatingSuggestedActions(surface: OyiSurface, intent: OyiIntentCategory) {
  const routes = ROUTES[surface] || ROUTES.consumer;
  const action = (label: string, route?: string, risk = "read") => route ? { label, route, risk } : null;
  const rows: Array<Record<string, unknown> | null> = [];
  if (intent === "device_control" || intent === "device_status") rows.push(action(surface === "facility" ? "Check infrastructure health" : "Open devices", routes.devices));
  if (intent === "visitor_operation") rows.push(action("Review visitor access", routes.visitors));
  if (intent === "maintenance_operation") rows.push(action("Review maintenance queue", routes.maintenance));
  if (intent === "wallet_operation") rows.push(action("Review wallet", routes.wallet));
  if (intent === "service_operation") rows.push(action(surface === "facility" ? "Review infrastructure services" : "Review services", routes.utilities));
  if (intent === "community_operation") rows.push(action("Review community", routes.community));
  if (intent === "report_generation") rows.push(action(surface === "facility" ? "Open reports" : "Open activity", surface === "facility" ? "/reports" : "/activity"));
  if (intent === "capability_query") {
    rows.push(action(surface === "facility" ? "Check estate status" : "Check home status", routes.calm || routes.activity));
    rows.push(action(surface === "facility" ? "Review infrastructure" : "Review devices", routes.devices));
    rows.push(action("Review visitors", routes.visitors));
  }
  rows.push(action("Review current awareness", routes.calm || routes.activity));
  return rows.filter(Boolean).slice(0, 5) as Array<Record<string, unknown>>;
}

function proposedToolsForIntent(intent: OyiIntentCategory, message: string, input: OyiChatInput): ProposedAiTool[] {
  const args = { estate_id: input.estate_id || null, home_id: input.home_id || null };
  if (intent === "device_control") return [{ tool_id: "device_command", arguments: args }];
  if (intent === "device_status") return [{ tool_id: "summarize_devices", arguments: args }];
  if (intent === "maintenance_operation" && /create|new request|raise|log/.test(message.toLowerCase())) return [{ tool_id: "create_maintenance_request", arguments: args }];
  if (intent === "wallet_operation") return [{ tool_id: "summarize_wallet", arguments: args }];
  if (intent === "maintenance_operation") return [{ tool_id: "summarize_maintenance", arguments: args }, { tool_id: "summarize_support", arguments: args }];
  if (intent === "visitor_operation") return [{ tool_id: "summarize_visitors", arguments: args }];
  if (intent === "community_operation") return [{ tool_id: "summarize_community", arguments: args }];
  if (intent === "capability_query") return [{ tool_id: "get_ai_status", arguments: args }];
  return [];
}

function isDomainMutationRequest(message: string) {
  return /\b(add|invite|create|approve|reject|assign|pay|purchase|buy|turn on|turn off|switch on|switch off|control)\b/i.test(message);
}

function domainActionPreparation(domain: DomainIntent, message: string, surface: OyiSurface): OperatingResult {
  const name = domain.key === "visitors"
    ? message.match(/(?:add|invite|create)\s+([a-z][a-z .'-]{1,80}?)(?:\s+as\s+(?:a\s+)?visitor|\s+visitor|$)/i)?.[1]?.trim()
    : null;
  const subject = name ? ` a visitor invite for ${name}` : ` the requested ${domain.label.replace(/s$/, "")} action`;
  const workflow = domain.key === "visitors" ? "Visitor Access" : domain.key === "wallet" || domain.key === "utilities" || domain.key === "services" ? "payment or service" : domain.key === "maintenance" ? "maintenance" : "device";
  return {
    intent: domain.intent,
    understood: `I understood a ${domain.label} action request.`,
    message: `I can help prepare${subject}, but ${workflow} changes still need confirmation through the ${workflow} workflow.`,
    cards: [], sources: [], suggested_actions: [], execution: { status: "validation_required" }, display_mode: "conversation", domain: domain.key,
  };
}

function domainUnavailableResult(domain: DomainIntent): OperatingResult {
  return {
    intent: domain.intent,
    understood: `I understood that you are asking about ${domain.label}.`,
    message: domain.unavailable,
    cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" }, display_mode: "conversation", domain: domain.key,
    conversation_entities: [],
    conversation_topic: topicForDomain(domain.key) || topicForIntent(domain.intent),
    conversation_result_state: "empty",
  };
}

function wantsSupportingCards(message: string, intent: OyiIntentCategory) {
  return /\b(audit|evidence|analysis|detailed inspection|inspect in detail|full report|generate report|prepare report|export report)\b/i.test(message);
}

function displayModeFor(intent: OyiIntentCategory, message: string, hasCards = false): OperatingResult["display_mode"] {
  if (intent === "awareness" || intent === "recommendation") return "awareness";
  if (/\b(generate|prepare|export)\b.*\breport\b|\bfull report\b/i.test(message)) return "report";
  if (/\b(audit|evidence|analysis)\b/i.test(message)) return intent === "investigation" ? "audit" : "audit";
  if (/detailed inspection|inspect in detail|show .* details/i.test(message)) return "detail";
  if (hasCards && /\b(evidence|analysis|audit|report|details?)\b/i.test(message)) return "list";
  return "conversation";
}

export function displayModeForTest(message: string, intent: OyiIntentCategory, hasCards = false) {
  return displayModeFor(intent, message, hasCards);
}

export function responsePresentationForTest(message: string, intent: OyiIntentCategory, hasCards = false) {
  const display_mode = displayModeFor(intent, message, hasCards);
  return { display_mode, support_payload_attached: display_mode !== "conversation" };
}

export function oyiRequestResolutionForTest(message: string, surface: OyiSurface, state: Partial<ConversationState> = {}) {
  const normalized = normalizeOyiMessage(message);
  const explicitDomain = detectDomainIntent(normalized, surface);
  const context: ConversationState = { ...emptyConversationState(), ...state, entities: Array.isArray(state.entities) ? state.entities as ConversationEntity[] : [] };
  return {
    domain: explicitDomain?.key || null,
    should_resolve_follow_up: !explicitDomain && isFollowUpMessage(message, context),
  };
}

function commandSummary(results: any[]) {
  const first = results[0] || {};
  if (!results.length) return "No executable operation was selected.";
  if (first.summary) return String(first.summary);
  if (first.status === "pending_confirmation") return "I need confirmation before completing that operation.";
  if (first.status === "denied") return "That operation is not permitted for your current role or context.";
  if (first.status === "failed") return "That operation could not be completed.";
  return "The operation was processed.";
}

function plainEntityList(entities: ConversationEntity[]) {
  return entities.slice(0, 5).map((entity, index) => `${index + 1}. ${entity.title}${entity.status ? ` — ${entity.status}` : ""}`).join("\n");
}

function maintenanceView(message: string) {
  const lower = message.toLowerCase();
  if (/completed|resolved|closed|cancelled|history/.test(lower)) return "history";
  if (/open|pending|unresolved|overdue/.test(lower)) return "open";
  return "all";
}

function operationalConversationMessage(surface: OyiSurface, intent: OyiIntentCategory, entities: ConversationEntity[], fallback: string, message = "", domainKey?: string | null) {
  const topic = topicForDomain(domainKey) || topicForIntent(intent);
  const maintenanceMode = topic === "maintenance" ? maintenanceView(message) : "all";
  if (!topic) return fallback;
  if (!entities.length) {
    if (topic === "visitor") return "There are currently no visitor requests awaiting approval.";
    if (topic === "maintenance") return maintenanceMode === "history"
      ? "There are no completed maintenance records available in this context."
      : maintenanceMode === "open"
        ? "There are currently no open maintenance issues."
        : "There are currently no maintenance records available in this context.";
    if (topic === "device") return surface === "facility"
      ? "I could not find registered infrastructure devices for this facility context."
      : "I could not find registered devices for this home context.";
    if (domainKey === "utilities") return "There are currently no infrastructure service issues to show.";
    if (topic === "camera") return "I could not find registered cameras for this facility context.";
    if (topic === "activity") return "There is currently no activity available in this context.";
    if (topic === "service") return "There are currently no service issues to show.";
    if (topic === "community") return "There are currently no community reports to show.";
    if (topic === "wallet") return "There are currently no wallet records to show.";
    return `There are currently no ${topicLabel(topic, true)} to show.`;
  }
  const maintenance = topic === "maintenance"
    ? maintenanceMode === "history"
      ? entities.filter((row) => /completed|resolved|closed|cancelled/i.test(String(row.status || "")))
      : maintenanceMode === "open"
        ? entities.filter((row) => /open|new|assigned|scheduled|progress|waiting|overdue/i.test(String(row.status || "")))
        : entities
    : entities;
  const pending = topic === "visitor" && /pending|approval|waiting/.test(message.toLowerCase())
    ? entities.filter((row) => /pending|requested/i.test(String(row.status || "")))
    : entities;
  const relevant = topic === "maintenance" ? maintenance : pending;
  if (!relevant.length) {
    if (topic === "maintenance") return maintenanceMode === "history"
      ? "There are no completed maintenance records available in this context."
      : maintenanceMode === "open"
        ? "There are currently no open maintenance issues."
        : "There are currently no maintenance records available in this context.";
    if (topic === "visitor") return "There are currently no visitor requests awaiting approval.";
  }
  const label = domainKey === "utilities"
    ? relevant.length === 1 ? "infrastructure service issue" : "infrastructure service issues"
    : topic === "maintenance" && maintenanceMode === "history"
      ? relevant.length === 1 ? "completed maintenance record" : "completed maintenance records"
      : topicLabel(topic, relevant.length !== 1);
  return `There ${relevant.length === 1 ? "is" : "are"} ${relevant.length} ${label} available.\n${plainEntityList(relevant)}\nWhich one would you like to inspect?`;
}

export function moduleConversationResultForTest(input: {
  surface: OyiSurface;
  intent: OyiIntentCategory;
  domain?: string | null;
  message: string;
  entities: ConversationEntity[];
}) {
  return operationalConversationMessage(input.surface, input.intent, input.entities, "Module registry unavailable.", input.message, input.domain);
}

export function deviceConversationResultForTest(input: {
  surface: OyiSurface;
  message: string;
  entities: ConversationEntity[];
}) {
  const entities = activeEntitiesForMessage("device_status", input.entities, input.message);
  return {
    entities,
    message: operationalConversationMessage(input.surface, "device_status", entities, "Device registry unavailable.", input.message),
  };
}

export function deviceTimelineNarrativeForTest(input: {
  latest_state_at?: unknown;
  last_seen_at?: unknown;
  provider_reported_at?: unknown;
}) {
  const sameMoment = (first: unknown, second: unknown) => first && second && new Date(String(first)).getTime() === new Date(String(second)).getTime();
  return [
    input.latest_state_at ? `Latest state update was received ${new Date(String(input.latest_state_at)).toLocaleString()}.` : "No latest state-update time is available.",
    input.last_seen_at
      ? sameMoment(input.latest_state_at, input.last_seen_at)
        ? "That update also confirmed the device online."
        : `The device was last confirmed online ${new Date(String(input.last_seen_at)).toLocaleString()}.`
      : "No separate provider online confirmation is available.",
    input.provider_reported_at && !sameMoment(input.provider_reported_at, input.latest_state_at) && !sameMoment(input.provider_reported_at, input.last_seen_at)
      ? `The provider reported this event ${new Date(String(input.provider_reported_at)).toLocaleString()}.`
      : "",
  ].filter(Boolean).join(" ");
}

function activeEntitiesForMessage(intent: OyiIntentCategory, entities: ConversationEntity[], message: string) {
  const lower = message.toLowerCase();
  if (intent === "visitor_operation" && /pending|approval|waiting/.test(lower)) {
    return entities.filter((row) => /pending|requested/i.test(String(row.status || "")));
  }
  if (intent === "maintenance_operation" && /open|pending|unresolved|overdue/.test(lower)) {
    return entities.filter((row) => /open|new|assigned|scheduled|progress|waiting/i.test(String(row.status || "")));
  }
  if (intent === "device_status") {
    if (/offline|down|unavailable/.test(lower)) return entities.filter((row) => /offline|down|unavailable/i.test(String(row.status || row.details?.online_state || "")));
    if (/online|active|available/.test(lower)) return entities.filter((row) => /online|active|available/i.test(String(row.status || row.details?.online_state || "")));
  }
  return entities;
}

function workflowEntity(row: any): ConversationEntity | null {
  if (!row) return null;
  const metadata = row.metadata || {};
  const id = row.id || row.workflow_id || null;
  const title = String(row.title || row.workflow_type || "Workflow").trim();
  if (!title) return null;
  return {
    type: "workflow",
    id: id ? String(id) : null,
    title,
    status: String(row.workflow_status || row.status || "open"),
    details: {
      workflow_type: row.workflow_type || null,
      priority: row.workflow_priority || row.priority || null,
      owner: row.workflow_owner || row.owner || row.responsible_agent || row.responsible || null,
      assignee: row.workflow_assignee || row.assignee || row.assigned_to || null,
      creator: row.created_by || row.creator || row.actor_id || row.origin_agent || metadata.created_by || null,
      created_by: row.created_by || row.creator || row.actor_id || row.origin_agent || metadata.created_by || null,
      due_at: row.workflow_due_at || row.due_at || null,
      escalation_at: row.workflow_escalation_at || row.escalation_at || null,
      resolution: row.workflow_resolution || row.resolution || null,
      blocker_reason: row.blocker_reason || row.workflow_blocker || metadata.blocker_reason || metadata.blocker || null,
      verification_state: row.verification_state || metadata.verification_state || metadata.verification?.state || null,
      assigned_at: row.assigned_at || metadata.assigned_at || (/assigned|accepted|in_progress/i.test(String(row.workflow_status || row.status || "")) ? row.updated_at : null),
      completed_at: row.completed_at || metadata.completed_at || null,
      summary: row.summary || row.description || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    },
  };
}

function activeWorkflowEntities(context: Awaited<ReturnType<typeof loadUnifiedContext>>) {
  const active = rankActiveWorkflowsForAwareness(context.workflows || []);
  return active.map(workflowEntity).filter(Boolean).slice(0, 50) as ConversationEntity[];
}

function queueEntity(row: any, index: number): ConversationEntity | null {
  if (!row) return null;
  if (row.workflow_type || row.workflow_status) return workflowEntity(row);
  const title = String(row.title || row.summary || row.event_type || `Operational request ${index + 1}`).trim();
  if (!title) return null;
  const type = entityTypeFromCard({ type: row.category || row.event_type, title }) || topicForDomain(row.category || row.event_type || "") || "queue";
  return {
    type,
    id: entityIdFromRow(row) ? String(entityIdFromRow(row)) : null,
    title: title.slice(0, 140),
    status: String(row.status || row.workflow_status || row.severity || "recorded"),
    details: {
      created_at: row.created_at || row.occurred_at || null,
      updated_at: row.updated_at || row.occurred_at || null,
      reported_by: row.actor_name || row.created_by_name || row.reporter_name || row.actor_id || null,
      summary: row.summary || row.description || null,
    },
  };
}

function operationalQueueEntities(context: Awaited<ReturnType<typeof loadUnifiedContext>>, awareness: AwarenessResult) {
  const workflowRows = rankActiveWorkflowsForAwareness(context.workflows || []);
  const attentionRows = (context.events || []).filter((event: any) => {
    if (isInternalAiEvent(event) || isSuccessfulRoutineEvent(event)) return false;
    return /critical|warning|attention|pending|open|assigned|in_progress|failed|overdue/i.test(`${event.severity || ""} ${event.status || ""} ${event.title || ""} ${event.summary || ""}`);
  });
  const awarenessRows = (awareness.cards || []).flatMap((card: any) => Array.isArray(card?.items) ? card.items : []);
  const rows = [...workflowRows, ...attentionRows, ...awarenessRows];
  const seen = new Set<string>();
  return rows.map(queueEntity).filter((entity): entity is ConversationEntity => {
    if (!entity) return false;
    const key = `${entity.type}:${entity.id || entity.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 50);
}

function workflowDomainResult(context: Awaited<ReturnType<typeof loadUnifiedContext>>, domain: DomainIntent): OperatingResult {
  const entities = activeWorkflowEntities(context);
  if (!entities.length) {
    return { ...domainUnavailableResult(domain), conversation_entities: [], conversation_topic: "workflow", conversation_result_state: "empty" };
  }
  return {
    intent: "investigation",
    understood: "I found active workflows for this context.",
    message: `There ${entities.length === 1 ? "is" : "are"} ${entities.length} active ${topicLabel("workflow", true)}.\n${plainEntityList(entities)}\nWhich one would you like to inspect?`,
    cards: [],
    sources: [],
    suggested_actions: [],
    execution: { status: "read_only", provider: "workflow_orchestrator" },
    conversation_entities: entities,
    conversation_offset: 0,
    conversation_topic: "workflow",
    conversation_result_state: "list",
    display_mode: "conversation",
    domain: domain.key,
  };
}

function operationalQueueResult(context: Awaited<ReturnType<typeof loadUnifiedContext>>, awareness: AwarenessResult, domain: DomainIntent, message = ""): OperatingResult {
  const entities = operationalQueueEntities(context, awareness);
  if (!entities.length) {
    return { ...domainUnavailableResult(domain), conversation_entities: [], conversation_topic: "queue", conversation_result_state: "empty" };
  }
  if (/most important|highest priority|top issue|main issue|urgent/i.test(message)) {
    const entity = entities[0];
    return {
      intent: "investigation",
      understood: "I opened the highest-ranked operational issue I can see.",
      message: `${entity.title} is the most important issue I can see right now. It is currently ${entity.status || "recorded"}.`,
      cards: [],
      sources: [],
      suggested_actions: [],
      execution: { status: "read_only", provider: "operational_queue" },
      conversation_entities: entities,
      conversation_active_entity: { ...entity, position: 0 },
      conversation_offset: 0,
      conversation_topic: "queue",
      conversation_result_state: "entity",
      display_mode: "conversation",
      domain: domain.key,
    };
  }
  return {
    intent: "investigation",
    understood: "I found recent operational requests across your facility.",
    message: `I found recent operational requests across your facility.\n${plainEntityList(entities)}\nWhich one would you like to inspect?`,
    cards: [],
    sources: [],
    suggested_actions: [],
    execution: { status: "read_only", provider: "operational_queue" },
    conversation_entities: entities,
    conversation_offset: 0,
    conversation_topic: "queue",
    conversation_result_state: "list",
    display_mode: "conversation",
    domain: domain.key,
  };
}

export async function loadOyiConversationContext(actor: AuthUser | null, input: OyiChatInput): Promise<ConversationContext> {
  if (!actor?.id || !validUuid(input.thread_id)) return { state: emptyConversationState() };
  try {
    const { data, error } = await supabaseAdmin
      .from("oyi_conversation_threads")
      .select("id,user_id,surface,estate_id,home_id,metadata")
      .eq("id", String(input.thread_id))
      .eq("user_id", actor.id)
      .maybeSingle();
    if (error || !data) return { state: emptyConversationState(), warning: "Previous conversation context is unavailable." };
    if (safeSurface(data.surface) !== safeSurface(input.surface)) return { state: emptyConversationState(), warning: "This conversation belongs to a different Oyi workspace." };
    if (input.estate_id && data.estate_id && String(input.estate_id) !== String(data.estate_id)) return { state: emptyConversationState(), warning: "This conversation belongs to a different estate context." };
    if (input.home_id && data.home_id && String(input.home_id) !== String(data.home_id)) return { state: emptyConversationState(), warning: "This conversation belongs to a different home context." };
    const raw = data.metadata?.conversation_state;
    const state = raw && typeof raw === "object"
      ? {
          ...emptyConversationState(),
          ...raw,
          entities: Array.isArray(raw.entities) ? raw.entities.slice(0, 50) : Array.isArray(raw.active_list) ? raw.active_list.slice(0, 50) : [],
        } as ConversationState
      : emptyConversationState();
    return { state, estate_id: data.estate_id || null, home_id: data.home_id || null };
  } catch {
    return { state: emptyConversationState(), warning: "Previous conversation context is unavailable." };
  }
}

async function prepareConversationExecution(input: {
  actor: AuthUser;
  entity: ConversationEntity;
  action_id: string;
  action_label: string;
  surface: OyiSurface;
  estate_id?: string | null;
  home_id?: string | null;
  assignee?: string | null;
}) {
  const { createWorkflow } = await import("../intelligence-core/workflows");
  const workflowType = input.entity.type === "visitor" ? "visitor_access" : input.entity.type === "maintenance" ? "maintenance" : input.entity.type === "service" ? "service_request" : "device_action";
  const responsible = input.surface === "facility" ? "facility" : "oyi";
  const sourceEventId = `chat:${input.action_id}:${input.entity.id || input.entity.title}:${input.actor.id}`;
  const { data: existing } = await supabaseAdmin
    .from("ochiga_workflows")
    .select("*")
    .eq("source_event_id", sourceEventId)
    .in("workflow_status", ["created", "assigned", "accepted", "in_progress"])
    .maybeSingle();
  if (existing) return { ok: true, workflow: existing, reused: true };
  const created = await createWorkflow({
    workflow_type: workflowType,
    title: `${input.action_label}: ${input.entity.title}`,
    summary: `Oyi prepared ${input.action_label.toLowerCase()} for ${input.entity.title}.`,
    priority: "medium",
    origin_agent: input.surface === "facility" ? "facility" : "oyi",
    responsible_agent: responsible,
    actor: input.actor,
    estate_id: input.estate_id || input.actor.estate_id || null,
    home_id: input.home_id || input.actor.home_id || null,
    source_event_id: sourceEventId,
    metadata: { entity_type: input.entity.type, entity_id: input.entity.id || null, action_id: input.action_id, assignee: input.assignee || null, confirmation_required: true },
  });
  return created;
}

async function resolveFollowUpOperation(actor: AuthUser | null, input: OyiChatInput, state: ConversationState): Promise<OperatingResult | null> {
  const message = String(input.message || "").trim();
  if (!isFollowUpMessage(message, state)) return null;
  const entity = referencedEntity(message, state);
  const intent = followUpIntent(message, state);
  const surface = safeSurface(input.surface);
  const details = entity?.details || {};
  const dateLabel = (value: unknown, label: string) => value ? `${label} ${new Date(String(value)).toLocaleString()}.` : "The available record does not include that time.";
  const preserveConversation = (result: OperatingResult): OperatingResult => ({
    ...result,
    domain: result.domain || state.active_domain || null,
    conversation_topic: result.conversation_topic || state.active_topic || null,
    conversation_result_state: result.conversation_result_state || (result.conversation_active_entity ? "entity" : state.active_result_state || null),
    conversation_entities: result.conversation_entities || state.entities,
  });

  if (state.active_result_state === "empty" && state.active_topic) {
    if (/show (me )?(the )?(first|second|third|last|latest|most recent|\d(?:st|nd|rd)?) one|(?:open|show) (?:the )?(?:first|second|third|last|latest|most recent|\d(?:st|nd|rd)?)(?: one)?|\b(?:the\s+)?(?:first|second|third|last|latest|most recent)(?:\s+one)?\b|that one|this one|^(?:number\s+)?(?:one|two|three|1|2|3)$/i.test(message)) {
      const lower = message.toLowerCase();
      const ordinal = /second|two|2/.test(lower) ? "second" : /third|three|3/.test(lower) ? "third" : /last|latest|most recent/.test(lower) ? "last" : "first";
      return preserveConversation({ intent, understood: `The current ${topicLabel(state.active_topic, true)} list is empty.`, message: emptyOrdinalMessage(state.active_topic, ordinal), cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" } });
    }
    if (/^(why|why\?)|why did/i.test(message)) {
      return preserveConversation({ intent: "investigation", understood: `The current ${topicLabel(state.active_topic, true)} list is empty.`, message: `Because there are no ${topicLabel(state.active_topic, true)} in the current ${surface === "facility" ? "estate" : "home"} context.`, cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" } });
    }
    if (/status|details|history|activity|evidence|verify|what happened|when was|who created|who reported|who owns|blocking|overdue/i.test(message)) {
      return preserveConversation({ intent: "investigation", understood: `The current ${topicLabel(state.active_topic, true)} list is empty.`, message: `No ${topicLabel(state.active_topic)} is currently selected because there are no ${topicLabel(state.active_topic, true)} available in this context.`, cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" } });
    }
  }

  if (!entity && state.active_topic && /^(why|why\?|when|when\?|who|who\?)|when was|who created|who reported|who owns|why did|status|details|history|activity|evidence|verify|what happened|what should i do next|what next|next action|blocking|overdue/i.test(message)) {
    return preserveConversation({ intent: "investigation", understood: `The active topic is ${topicLabel(state.active_topic, true)}.`, message: `Which ${topicLabel(state.active_topic)} do you mean? You can say “the first one” or name it.`, cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" } });
  }

  if (!entity && /show (me )?(the )?(first|second|third|last|latest|most recent) one|that one|this one/i.test(message)) {
    return { intent, understood: "There is no active result list.", message: "I don’t have an active list open right now. Ask me to show visitor requests, maintenance issues, devices, or activity first.", cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" } };
  }

  const activeEntity = entity ? { ...entity, position: Math.max(0, state.entities.findIndex((row) => row.id === entity.id && row.type === entity.type)) } : null;

  if (/^assign\b/i.test(message) && entity && !["maintenance", "service"].includes(entity.type)) {
    return preserveConversation({
      intent: "maintenance_operation",
      understood: `I found ${entity.title}, but it is not a maintenance or service request.`,
      message: "I can only assign maintenance or service requests from this conversation. Ask me to show maintenance requests first, then choose the request you want assigned.",
      cards: [], sources: [], suggested_actions: [], execution: { status: "validation_required" },
      conversation_active_entity: activeEntity || undefined,
    });
  }

  if (/^(approve|reject|remove)\b/i.test(message) && entity?.type === "visitor") {
    if (!actor?.id || !entity.id) return preserveConversation({ intent: "visitor_operation", understood: `I found ${entity.title}.`, message: "I need an authenticated visitor record before I can prepare that access action.", cards: [], sources: [], suggested_actions: [], execution: { status: "validation_required" }, conversation_active_entity: activeEntity! });
    const action_id = /^approve/i.test(message) ? "visitor.approve" : /^reject/i.test(message) ? "visitor.revoke" : "visitor.revoke";
    const actionLabel = action_id === "visitor.approve" ? "Approve visitor access" : "Revoke visitor access";
    const workflow = await prepareConversationExecution({ actor, entity, action_id, action_label: actionLabel, surface, estate_id: input.estate_id, home_id: input.home_id });
    if (!workflow.ok || !workflow.workflow) return preserveConversation({ intent: "visitor_operation", understood: `I found ${entity.title}.`, message: "I could not prepare the visitor workflow. No access change was made.", cards: [], sources: [], suggested_actions: [], execution: { status: "failed" }, conversation_active_entity: activeEntity! });
    return preserveConversation({ intent: "visitor_operation", understood: `I found ${entity.title}.`, message: `${actionLabel} will change this visitor’s access. Proceed?`, cards: [], sources: [], suggested_actions: [], execution: { status: "pending_confirmation" }, conversation_active_entity: activeEntity!, conversation_action: action_id, execution_workflow: { stage: "confirmation_required", workflow: workflow.workflow, action_id, entity_id: entity.id, action_label: actionLabel } });
  }

  if (/^assign\b/i.test(message) && (entity?.type === "maintenance" || entity?.type === "service")) {
    const assignee = message.match(/\bto\s+([a-z][a-z .'-]{1,80})$/i)?.[1]?.trim() || null;
    if (!actor?.id || !entity.id) return preserveConversation({ intent: "maintenance_operation", understood: `I found ${entity.title}.`, message: "I need an authenticated maintenance record before I can prepare an assignment.", cards: [], sources: [], suggested_actions: [], execution: { status: "validation_required" }, conversation_active_entity: activeEntity! });
    if (!assignee) return preserveConversation({ intent: "maintenance_operation", understood: `I found ${entity.title}.`, message: "Who should I assign this maintenance request to?", cards: [], sources: [], suggested_actions: [], execution: { status: "validation_required" }, conversation_active_entity: activeEntity! });
    const workflow = await prepareConversationExecution({ actor, entity, action_id: entity.type === "service" ? "service.assign" : "maintenance.assign", action_label: `Assign to ${assignee}`, surface, estate_id: input.estate_id, home_id: input.home_id, assignee });
    if (!workflow.ok || !workflow.workflow) return preserveConversation({ intent: "maintenance_operation", understood: `I found ${entity.title}.`, message: "I could not prepare the maintenance assignment. No change was made.", cards: [], sources: [], suggested_actions: [], execution: { status: "failed" }, conversation_active_entity: activeEntity! });
    const actionId = entity.type === "service" ? "service.assign" : "maintenance.assign";
    return preserveConversation({ intent: entity.type === "service" ? "service_operation" : "maintenance_operation", understood: `I found ${entity.title}.`, message: `Assign ${entity.title} to ${assignee}?`, cards: [], sources: [], suggested_actions: [], execution: { status: "pending_confirmation" }, conversation_active_entity: activeEntity!, conversation_action: actionId, execution_workflow: { stage: "confirmation_required", workflow: workflow.workflow, action_id: actionId, entity_id: entity.id, assignee, action_label: `Assign to ${assignee}` } });
  }

  if (/^(?:turn|switch|power)\b.*\b(?:on|off)\b/i.test(message) && entity?.type === "device" && activeEntity) {
    if (!actor?.id) {
      return preserveConversation({ intent: "device_control", understood: `I found ${entity.title}.`, message: "I need an authenticated operator session before I can prepare that device action.", cards: [], sources: [], suggested_actions: [], execution: { status: "validation_required" }, conversation_active_entity: activeEntity, conversation_action: "device_control" });
    }
    const actionPrompt = /\boff\b/i.test(message) ? `Turn off ${entity.title}` : `Turn on ${entity.title}`;
    const proposedTools = proposedToolsForIntent("device_control", actionPrompt, input)
      .map((tool) => ({ ...tool, arguments: { ...(tool.arguments || {}), device_id: entity.id, home_id: surface === "facility" ? null : input.home_id || actor.home_id || null } }));
    if (!proposedTools.length) {
      return preserveConversation({ intent: "device_control", understood: `I found ${entity.title}.`, message: `I can prepare control for ${entity.title}, but no supported device command is available for it in this context.`, cards: [], sources: [], suggested_actions: [], execution: { status: "validation_required" }, conversation_active_entity: activeEntity, conversation_action: "device_control" });
    }
    const { routeAiCommand } = await import("../ai/commandRouter");
    const routed = await routeAiCommand(undefined, {
      actor,
      prompt: actionPrompt,
      surface,
      scope: surface === "facility" ? "facility" : input.home_id || actor.home_id ? "home" : "estate",
      estateId: input.estate_id || actor.estate_id || null,
      homeId: input.home_id || actor.home_id || null,
      proposedTools,
    });
    return preserveConversation({
      intent: "device_control",
      understood: `I found ${entity.title} and prepared the requested device action.`,
      message: routed.results.some((row: any) => row.status === "pending_confirmation")
        ? `${commandSummary(routed.results)} No action has been performed yet.`
        : commandSummary(routed.results),
      cards: [], sources: [], suggested_actions: [],
      execution: { status: "processed", safe_mode: routed.safe_mode, scope: routed.scope, results: routed.results },
      conversation_active_entity: activeEntity,
      conversation_action: "device_control",
      execution_workflow: executionWorkflowFromResults("device_control", routed.results),
    });
  }

  if (entity?.type === "device" && activeEntity && /verify|online|offline|status|diagnostics/i.test(message)) {
    const latestState: Record<string, any> = details.latest_state && typeof details.latest_state === "object" ? details.latest_state as Record<string, any> : {};
    const power = typeof latestState.switch === "boolean" ? (latestState.switch ? "on" : "off")
      : typeof latestState.power === "boolean" ? (latestState.power ? "on" : "off")
        : typeof latestState.on === "boolean" ? (latestState.on ? "on" : "off") : null;
    const online = String(details.online_state || "unknown");
    const latestStateAt = details.latest_state_at || details.updated_at || null;
    const lastSeenAt = details.last_seen_at || null;
    const providerReportedAt = details.provider_reported_at || null;
    const status = online === "unknown" ? "The registry does not have a confirmed online state" : `It is ${online}`;
    const state = power ? ` and currently ${power}` : "";
    const timeline = deviceTimelineNarrativeForTest({ latest_state_at: latestStateAt, last_seen_at: lastSeenAt, provider_reported_at: providerReportedAt });
    return preserveConversation({
      intent: "device_status",
      understood: `I checked the latest visible status for ${entity.title}.`,
      message: `${entity.title}: ${status}${state}. ${timeline}`,
      cards: [], sources: [], suggested_actions: [], execution: { status: "read_only", provider: "device_registry" },
      conversation_active_entity: activeEntity,
    });
  }

  if (entity?.type === "device" && activeEntity && /show (?:full )?(?:activity|history)|recent activity|what happened|how many times|full history|show failures|manual switch|physical actions|scene activity|automation activity/i.test(message)) {
    return preserveConversation({
      intent: "investigation",
      understood: `I checked the recent activity for ${entity.title}.`,
      message: summarizeDeviceExecutions(entity),
      cards: [],
      sources: userFacingSources(surface, "operation"),
      suggested_actions: [],
      execution: { status: "read_only", provider: "device_activity" },
      conversation_active_entity: activeEntity,
    });
  }

  if (entity?.type === "device" && activeEntity && /relationship|dependencies|depend on|what scenes|what automations|what controls you|view relationships/i.test(message)) {
    return preserveConversation({
      intent: "investigation",
      understood: `I checked the current relationships for ${entity.title}.`,
      message: summarizeDeviceRelationships(entity),
      cards: [],
      sources: userFacingSources(surface, "operation"),
      suggested_actions: [],
      execution: { status: "read_only", provider: "device_relationships" },
      conversation_active_entity: activeEntity,
    });
  }

  if (entity?.type === "device" && activeEntity && /diagnose|check connection|why is .*offline|why is it offline|explain failure|check device/i.test(message)) {
    return preserveConversation({
      intent: "investigation",
      understood: `I checked the latest health context for ${entity.title}.`,
      message: summarizeDeviceDiagnosis(entity),
      cards: [],
      sources: userFacingSources(surface, "operation"),
      suggested_actions: [],
      execution: { status: "read_only", provider: "device_health" },
      conversation_active_entity: activeEntity,
    });
  }

  if (/show (me )?(the )?(first|second|third|last|latest|most recent) one|^(?:number\s+)?(?:one|two|three|1|2|3)$|\b(?:1st|2nd|3rd)\b|^(why|when|who|how)\??$|when was|who created|who reported|who owns|why did|what happened|what should i do next|what next|next action|status|evidence|verify|show (?:activity|history)|^(?:show|open|inspect|select|view|tell me about)\b/i.test(message) && entity && activeEntity) {
    if (entity.type === "workflow" && /who owns|who is responsible|owner|assignee|assigned/i.test(message)) {
      const owner = humanLabel(details.owner) || humanLabel(details.assignee);
      return preserveConversation({ intent: "investigation", understood: `I found ${entity.title}.`, message: owner ? `${entity.title} is currently owned by ${owner}.` : `I found ${entity.title}, but the available workflow record does not identify a named owner.`, cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" }, conversation_active_entity: activeEntity });
    }
    if (entity.type === "workflow" && /when was.*assigned|assigned at|assignment time/i.test(message)) {
      return preserveConversation({ intent: "investigation", understood: `I found ${entity.title}.`, message: `${entity.title} is currently ${entity.status || "recorded"}. ${dateLabel(details.assigned_at || details.updated_at, "It was assigned")}`, cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" }, conversation_active_entity: activeEntity });
    }
    if (entity.type === "workflow" && /blocking|blocked|why/i.test(message)) {
      const resolution = String(details.blocker_reason || details.resolution || details.summary || "").trim();
      return preserveConversation({ intent: "investigation", understood: `I found ${entity.title}.`, message: resolution ? `${entity.title}: ${resolution}` : `${entity.title} is not marked with a specific blocker in the available workflow record.`, cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" }, conversation_active_entity: activeEntity });
    }
    if (entity.type === "workflow" && /overdue|due/i.test(message)) {
      return preserveConversation({ intent: "investigation", understood: `I found ${entity.title}.`, message: workflowDueMessage(entity.title, details.due_at), cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" }, conversation_active_entity: activeEntity });
    }
    if (entity.type === "workflow" && /verify/i.test(message)) {
      const verificationState = humanLabel(details.verification_state) || "pending";
      return preserveConversation({ intent: "investigation", understood: `I found ${entity.title}.`, message: `${entity.title} verification is ${verificationState}. I will not mark it verified unless a supported verification action completes successfully.`, cards: [], sources: userFacingSources(surface, "operation"), suggested_actions: [], execution: { status: "validation_required" }, conversation_active_entity: activeEntity });
    }
    if (entity.type === "workflow" && /what should i do next|what next|next action/i.test(message)) {
      const blocker = humanLabel(details.blocker_reason);
      const verificationState = humanLabel(details.verification_state);
      const due = details.due_at ? workflowDueMessage(entity.title, details.due_at) : "";
      const owner = humanLabel(details.owner) || humanLabel(details.assignee);
      const next = blocker
        ? `Resolve the blocker first: ${blocker}.`
        : /completed/i.test(String(entity.status || "")) && verificationState !== "verified"
          ? "Verify the completed workflow before closing attention on it."
          : owner
            ? `Follow up with ${owner} and confirm the next operational update.`
            : "Review the workflow details and assign an owner if one is missing.";
      return preserveConversation({ intent: "recommendation", understood: `I found ${entity.title}.`, message: `${next}${due ? ` ${due}` : ""}`, cards: [], sources: userFacingSources(surface, "operation"), suggested_actions: [], execution: { status: "read_only" }, conversation_active_entity: activeEntity });
    }
    if (entity.type === "workflow" && /history|activity|details|evidence|what happened|status/i.test(message)) {
      const summary = humanLabel(details.summary) || humanLabel(details.resolution) || `${entity.title} is currently ${entity.status || "recorded"}.`;
      const parts = [
        summary,
        `Status: ${entity.status || "recorded"}.`,
        humanLabel(details.owner) || humanLabel(details.assignee) ? `Owner: ${humanLabel(details.owner) || humanLabel(details.assignee)}.` : "",
        details.created_at ? `Created ${new Date(String(details.created_at)).toLocaleString()}.` : "",
        details.assigned_at ? `Assigned ${new Date(String(details.assigned_at)).toLocaleString()}.` : "",
        details.updated_at ? `Last updated ${new Date(String(details.updated_at)).toLocaleString()}.` : "",
        humanLabel(details.verification_state) ? `Verification: ${humanLabel(details.verification_state)}.` : "",
      ].filter(Boolean);
      return preserveConversation({ intent: "investigation", understood: `I found ${entity.title}.`, message: parts.join(" "), cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" }, conversation_active_entity: activeEntity });
    }
    if (/^when\??$|when was|created|updated/i.test(message)) {
      const target = /updated/i.test(message) ? details.updated_at : details.created_at || details.updated_at;
      const label = /updated/i.test(message) ? "It was last updated" : "It was recorded";
      return preserveConversation({ intent: "investigation", understood: `I found ${entity.title}.`, message: `${entity.title} is currently ${entity.status || "recorded"}. ${dateLabel(target, label)}`, cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" }, conversation_active_entity: activeEntity });
    }
    if (/^who\??$|who created|who reported|who owns/i.test(message)) {
      const person = humanLabel(details.owner) || humanLabel(details.assignee) || humanLabel(details.reported_by) || humanLabel((details as any).created_by);
      const unavailable = /owns|owner/i.test(message) ? "an owner name" : entity.type === "visitor" ? "the creator name" : "who reported or created it";
      return preserveConversation({ intent: "investigation", understood: `I found ${entity.title}.`, message: person ? `${entity.title} is associated with ${person}.` : `I found ${entity.title}, but the available record does not include ${unavailable}.`, cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" }, conversation_active_entity: activeEntity });
    }
    if (/^why\??$|why did/i.test(message)) {
      const explanation = details.summary ? `The available record says: ${String(details.summary)}.` : `Its current status is ${entity.status || "recorded"}.`;
      return preserveConversation({ intent: "investigation", understood: `I found ${entity.title}.`, message: `${entity.title}: ${explanation} I do not have enough verified evidence to state a cause beyond the recorded details.`, cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" }, conversation_active_entity: activeEntity });
    }
    if (/status|details|history|activity|evidence|what happened/i.test(message)) {
      const summary = humanLabel(details.summary) || `${entity.title} is currently ${entity.status || "recorded"}.`;
      return preserveConversation({ intent: "investigation", understood: `I found ${entity.title}.`, message: `${summary}${details.updated_at ? ` Last updated ${new Date(String(details.updated_at)).toLocaleString()}.` : ""}`, cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" }, conversation_active_entity: activeEntity });
    }
    return preserveConversation({ intent, understood: `I found ${entity.title}.`, message: `${entity.title} is currently ${entity.status || "recorded"}.${details.created_at ? ` Recorded ${new Date(String(details.created_at)).toLocaleString()}.` : ""}`, cards: [], sources: userFacingSources(surface, "operation"), suggested_actions: operatingSuggestedActions(surface, intent), execution: { status: "read_only" }, conversation_active_entity: activeEntity });
  }

  if (/show me more|more details/i.test(message) && state.entities.length) {
    const offset = Math.min(state.list_offset || 0, Math.max(0, state.entities.length - 1));
    const next = state.entities.slice(offset + 5, offset + 10);
    if (!next.length) return { intent, understood: "I reached the end of the available results.", message: "That is everything available in this conversation. Tell me which item you would like to inspect.", cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" } };
    return {
      intent,
      understood: "I’ll continue with the next available records.",
      message: `Here are ${next.length} more ${next[0].type === "maintenance" ? "maintenance requests" : `${next[0].type} records`}.`,
      cards: [{ type: "list", title: "More results", summary: "Additional records from this conversation.", items: next.map((row) => ({ title: row.title, status: row.status || "recorded" })) }],
      sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" },
      conversation_entities: state.entities, conversation_offset: offset + 5,
    } as OperatingResult;
  }

  if (/^(cancel|no)$/i.test(message) && state.pending_confirmation_id && actor?.id) {
    const { updateAiConfirmation } = await import("../ai/commandRouter");
    const cancelled = await updateAiConfirmation(actor, state.pending_confirmation_id, "denied");
    return preserveConversation({ intent, understood: "I’ll cancel the pending action from this conversation.", message: cancelled.ok ? "Cancelled. No action was executed." : "I could not cancel that action. It may already be complete or expired.", cards: [], sources: [], suggested_actions: [], execution: { status: "processed", results: [{ status: cancelled.ok ? "denied" : "failed", summary: cancelled.record?.result_summary || cancelled.error || "Cancellation processed." }] }, conversation_action: state.active_action || "cancelled_action", execution_workflow: { stage: "execution_result", action: state.active_action || "cancelled_action", completed: 0, failed: 0, verification: "The cancellation result was recorded." } });
  }

  if (/^(cancel|no)$/i.test(message) && state.active_action) {
    return preserveConversation({
      intent,
      understood: "I’ll cancel the prepared action from this conversation.",
      message: state.active_entity_label
        ? `Cancelled. No change was made to ${state.active_entity_label}.`
        : "Cancelled. No operational change was made.",
      cards: [], sources: [], suggested_actions: [], execution: { status: "cancelled" },
      conversation_action: state.active_action,
      execution_workflow: { stage: "cancelled", action: state.active_action, completed: 0, failed: 0, verification: "No action was executed." },
    });
  }

  if (/^(do it|go ahead|confirm|yes|proceed)$/i.test(message)) {
    const pendingWorkflow = state.active_workflow as any;
    if (actor?.id && pendingWorkflow?.stage === "confirmation_required" && pendingWorkflow?.action_id && pendingWorkflow?.entity_id) {
      const { executeRegisteredAction } = await import("../intelligence-core/executionRegistry");
      const { transitionWorkflow } = await import("../intelligence-core/workflows");
      const workflow = pendingWorkflow.workflow;
      if (workflow?.id) await transitionWorkflow({ workflow, status: "in_progress", actor, agent_id: surface === "facility" ? "facility" : "oyi", summary: `Confirmed ${pendingWorkflow.action_label || pendingWorkflow.action_id}.` });
      const executed = await executeRegisteredAction({ action_id: pendingWorkflow.action_id, actor, entity_id: pendingWorkflow.entity_id, assignee: pendingWorkflow.assignee || null, confirmed: true, source: "app" });
      const executionReason = "reason" in executed ? String(executed.reason || "validation failed") : "validation failed";
      if (workflow?.id) await transitionWorkflow({ workflow: { ...workflow, workflow_status: "in_progress" }, status: executed.ok ? "completed" : "failed", actor, agent_id: surface === "facility" ? "facility" : "oyi", summary: executed.ok ? `${pendingWorkflow.action_label || pendingWorkflow.action_id} completed.` : `Execution failed: ${executionReason}.` });
      let verification: any = null;
      if (executed.ok && workflow?.id) {
        const verifier = await import("../intelligence-core/verificationService");
        const verifiedWorkflow = { ...workflow, workflow_status: "completed" };
        if (/^visitor\./.test(pendingWorkflow.action_id)) {
          const expected = pendingWorkflow.action_id === "visitor.approve" ? "approved" : pendingWorkflow.action_id === "visitor.expire" ? "expired" : "denied";
          verification = await verifier.verifyVisitorStatus({ workflow: verifiedWorkflow, visitor_id: pendingWorkflow.entity_id, expected_status: expected });
        } else if (/^maintenance\./.test(pendingWorkflow.action_id)) {
          const expected = pendingWorkflow.action_id === "maintenance.assign" ? "assigned" : pendingWorkflow.action_id === "maintenance.complete" ? "completed" : "cancelled";
          verification = await verifier.verifyMaintenanceStatus({ workflow: verifiedWorkflow, request_id: pendingWorkflow.entity_id, expected_status: expected });
        }
      }
      return preserveConversation({ intent, understood: `I confirmed ${pendingWorkflow.action_label || pendingWorkflow.action_id}.`, message: executed.ok ? `${pendingWorkflow.action_label || "The requested action"} was completed${verification?.state === "verified" ? " and verified" : ""}.` : `I could not complete that action: ${executionReason}. No unverified change was reported.`, cards: [], sources: [], suggested_actions: [], execution: { status: executed.ok ? "executed" : executed.status, results: [executed], verification }, conversation_action: pendingWorkflow.action_id, execution_workflow: { stage: "execution_result", ...pendingWorkflow, completed: executed.ok ? 1 : 0, failed: executed.ok ? 0 : 1, verification: verification?.summary || (executed.ok ? "The source workflow was updated and will be verified from authoritative state." : "Execution failed before verification.") } });
    }
    if (!actor?.id || !state.pending_confirmation_id) {
      return {
        intent,
        understood: "I need a pending Oyi action to confirm.",
        message: "I do not have a pending action to confirm in this conversation. Tell me what you would like Oyi to do.",
        cards: [], sources: [], suggested_actions: operatingSuggestedActions(surface, intent), execution: { status: "validation_required" },
      };
    }
    const { updateAiConfirmation } = await import("../ai/commandRouter");
    const confirmed = await updateAiConfirmation(actor, state.pending_confirmation_id, "confirmed");
    const record = confirmed.record;
    const status = record?.execution_status || (confirmed.ok ? "executed" : "failed");
    return preserveConversation({
      intent,
      understood: "I’ll confirm the pending action from this conversation.",
      message: confirmed.ok
        ? String(record?.result_summary || "The requested action has been processed.")
        : "I could not confirm that action. It may have expired or is no longer available.",
      cards: [],
      sources: userFacingSources(surface, "operation"),
      suggested_actions: operatingSuggestedActions(surface, intent),
      execution: { status: "processed", results: [{ status, summary: record?.result_summary || confirmed.error || "Action confirmation processed." }] },
      conversation_action: String(record?.tool_id || state.active_action || "confirmed_action"),
      execution_workflow: { stage: "execution_result", action: String(record?.tool_id || state.active_action || "confirmed_action"), completed: record?.execution_status === "executed" ? 1 : 0, failed: record?.execution_status === "executed" ? 0 : 1, verification: "The confirmed action result was recorded." },
    });
  }

  return null;
}

async function runOperatingLayer(actor: AuthUser | null, input: OyiChatInput, context: Awaited<ReturnType<typeof loadUnifiedContext>>, awareness: AwarenessResult): Promise<OperatingResult> {
  const surface = safeSurface(input.surface);
  let message = normalizeOyiMessage(input.message || "");
  let domain = detectDomainIntent(message, surface);
  let classifiedIntent = classifyOyiOperatingIntentForTest(message);
  if (shouldAskLanguageTeacher({ domain, intent: classifiedIntent, phrase: input.message })) {
    const languageResult = await interpretWithLanguageTeacher({
      phrase: input.message,
      surface,
      context: {
        estate_id: input.estate_id || null,
        home_id: input.home_id || null,
        module: input.module || null,
      },
    });
    if (languageResult && languageResult.confidence >= Number(process.env.LANGUAGE_TEACHER_MIN_CONFIDENCE || 0.65)) {
      const taughtMessage = normalizeOyiMessage(languageTeacherResultToMessage(languageResult, message));
      const taughtDomain = detectDomainIntent(taughtMessage, surface)
        || DOMAIN_INTENTS.find((entry) => entry.key === languageResult.domain && entry.surfaces.includes(surface))
        || null;
      message = taughtMessage;
      domain = taughtDomain;
      classifiedIntent = languageResult.intent as OyiIntentCategory;
    }
  }
  const intent = domain?.key === "devices" && isDomainMutationRequest(message)
    ? classifiedIntent === "device_control" ? classifiedIntent : "device_control"
    : domain?.intent || classifiedIntent;
  const understood = understoodText(surface, intent);

  if (domain && isDomainMutationRequest(message) && domain.key !== "devices") {
    return domainActionPreparation(domain, message, surface);
  }

  if (domain?.key === "workflows") {
    return workflowDomainResult(context, domain);
  }

  if (!domain && (intent === "awareness" || intent === "recommendation" || intent === "general_help")) {
    return {
      intent,
      understood,
      message: answerMessage(surface, message, awareness),
      cards: awarenessSupportCards(awareness, /what('?s| is) happening|status|everything okay/.test(message.toLowerCase())),
      sources: userFacingSources(surface, "awareness"),
      suggested_actions: awareness.suggested_actions.length ? awareness.suggested_actions : buildSuggestedActions(surface, message, awareness, context),
      execution: { status: "read_only", provider: "awareness" },
      display_mode: intent === "general_help" ? "conversation" : "awareness",
    };
  }

  if (intent === "capability_query") {
    return {
      intent,
      understood,
      message: capabilityMessage(surface),
      cards: [],
      sources: [],
      suggested_actions: operatingSuggestedActions(surface, intent),
      execution: { status: "read_only", provider: "capability_registry" },
      display_mode: "conversation",
    };
  }

  if (intent === "visitor_operation" && /\b(add|invite|create)\b/i.test(message)) {
    const name = message.match(/(?:add|invite|create)\s+([a-z][a-z .'-]{1,80}?)(?:\s+as\s+(?:a\s+)?visitor|\s+visitor|$)/i)?.[1]?.trim();
    return {
      intent,
      understood: name ? `I understood that you want to prepare a visitor invite for ${name}.` : "I understood that you want to prepare a visitor invite.",
      message: `I can help prepare${name ? ` a visitor invite for ${name}` : " a visitor invite"}, but visitor creation still needs confirmation through the Visitor Access workflow.`,
      cards: [], sources: [], suggested_actions: operatingSuggestedActions(surface, intent), execution: { status: "validation_required" }, display_mode: "conversation",
      conversation_topic: "visitor", conversation_result_state: null,
    };
  }

  const proposedTools = actor ? (domain?.tool_id && intent !== "device_control"
    ? [{ tool_id: domain.tool_id, arguments: { estate_id: input.estate_id || null, home_id: input.home_id || null, module: domain.key } }]
    : proposedToolsForIntent(intent, message, input)) : [];
  if (actor && proposedTools.length) {
    const { routeAiCommand } = await import("../ai/commandRouter");
    const routed = await routeAiCommand(undefined, {
      actor,
      prompt: message,
      surface,
      scope: surface === "facility" ? "facility" : input.home_id || actor.home_id ? "home" : "estate",
      estateId: input.estate_id || actor.estate_id || null,
      homeId: input.home_id || actor.home_id || null,
      proposedTools,
    });
    const availableCards = routed.results.flatMap((result: any) => Array.isArray(result?.data?.cards) ? result.data.cards : []);
    const conversationEntities = routed.results.flatMap((result: any) => Array.isArray(result?.data?.conversation_entities) ? result.data.conversation_entities : []);
    const activeEntities = activeEntitiesForMessage(intent, conversationEntities, message);
    const displayMode = displayModeFor(intent, message, wantsSupportingCards(message, intent) && activeEntities.length > 0);
    const supportPayload = displayMode !== "conversation";
    const cards = supportPayload && activeEntities.length ? availableCards.slice(0, 3) : [];
    const conversationTopic = domain?.key === "operational_queue" ? "queue" : topicForDomain(domain?.key) || topicForIntent(intent);
    return {
      intent,
      understood,
      message: routed.results.some((item: any) => item.status === "pending_confirmation")
        ? `${commandSummary(routed.results)} No action has been performed yet.`.trim()
        : operationalConversationMessage(surface, intent, activeEntities, commandSummary(routed.results), message, domain?.key),
      cards,
      sources: supportPayload ? userFacingSources(surface, "operation") : [],
      suggested_actions: supportPayload ? operatingSuggestedActions(surface, intent) : [],
      execution: { status: "processed", safe_mode: routed.safe_mode, scope: routed.scope, results: routed.results },
      conversation_entities: activeEntities,
      conversation_offset: 0,
      conversation_topic: conversationTopic,
      conversation_result_state: conversationTopic ? (activeEntities.length ? "list" : "empty") : null,
      display_mode: displayMode,
      domain: domain?.key || null,
      conversation_action: ["device_control", "maintenance_operation", "visitor_operation", "wallet_operation", "service_operation"].includes(intent) ? intent : null,
      execution_workflow: executionWorkflowFromResults(intent, routed.results),
    };
  }

  if (domain) return domainUnavailableResult(domain);

  const reportLike = intent === "report_generation" || intent === "investigation";
  const provider = reportLike ? "reporting/investigation" : "operating_context";
  const focus = intent === "investigation"
    ? "I can investigate available activity, audit, visitor, maintenance, device, and notification records for this context."
    : intent === "report_generation"
    ? "I can generate an operational report from awareness, events, predictions, workflows, and visible module records."
    : "I can summarize the requested operational area from available context.";
  return {
    intent,
    understood,
    message: `${focus} ${awareness.severity === "normal" ? "No urgent issue is currently ranked above normal activity." : awareness.recommended_action}`,
    cards: reportLike
      ? [{
          type: intent === "investigation" ? "investigation" : "report",
          title: surface === "facility" ? "Estate operations summary" : "Home activity summary",
          summary: awareness.summary || awareness.recommended_action,
          items: [],
        }]
      : awarenessSupportCards(awareness),
    sources: userFacingSources(surface, reportLike ? "report" : "awareness"),
    suggested_actions: operatingSuggestedActions(surface, intent),
    execution: { status: "read_only", provider },
    display_mode: displayModeFor(intent, message, reportLike),
  };
}

function answerMessage(surface: OyiSurface, message: string, awareness: AwarenessResult) {
  const lower = message.toLowerCase();
  const facility = surface === "facility";

  if (/what('?s| is) happening|summary|today|status/.test(lower)) {
    return `${awareness.headline} ${awareness.summary}`;
  }

  if (/needs attention|attention|urgent|risk|problem|issue/.test(lower)) {
    if (awareness.severity === "normal") {
      return facility
        ? "No operational item currently needs attention. Estate operations are stable from the signals I can see."
        : "No home item currently needs attention. Your home is operating normally from the signals I can see.";
    }
    return `${awareness.headline} ${awareness.summary} Recommended action: ${awareness.recommended_action}`;
  }

  if (/what should i do|next|recommend|action/.test(lower)) {
    return awareness.severity === "normal"
      ? "No action is currently required."
      : `${awareness.recommended_action} ${awareness.summary}`;
  }

  if (/maintenance|visitor|device|camera|security|utility|community|workflow/.test(lower)) {
    return `${awareness.headline} ${awareness.summary} I can show the relevant supporting evidence, but I will not perform approvals, assignments, access changes, payments, or device actions without explicit confirmation.`;
  }

  return `${awareness.headline} ${awareness.summary}`;
}

export function buildOyiAwarenessScenarioForTest(input: {
  surface: OyiSurface;
  message?: string;
  actor?: Partial<AuthUser> | null;
  events?: any[];
  predictions?: any[];
  workflows?: any[];
}) {
  const surface = safeSurface(input.surface);
  const context = {
    filters: {},
    events: input.events || [],
    predictions: input.predictions || [],
    workflows: input.workflows || [],
    summary: { attention_count: 0, latest: [], suggested_actions: [] },
    predictionSummary: { prediction_count: input.predictions?.length || 0, critical_prediction_count: 0, recommended_actions: [] },
    workflowSummary: { open_workflows: input.workflows?.length || 0, overdue_workflows: 0, escalated_workflows: 0, critical_workflows: 0 },
    warnings: [],
  } as any;
  const actor = (input.actor || null) as AuthUser | null;
  const awareness = buildAwareness(surface, context, actor);
  return {
    awareness,
    message: answerMessage(surface, input.message || "What's happening?", awareness),
  };
}

async function persistThread(actor: AuthUser | null, input: OyiChatInput, response: any, userMessage: string, conversationState: ConversationState) {
  const now = new Date().toISOString();
  const threadId = validUuid(input.thread_id) ? String(input.thread_id) : randomUUID();
  const newlyCreatedThread = !validUuid(input.thread_id);
  const activeEntity = response?.conversation_active_entity || conversationState.active_entity || explicitOperationalObjectEntity(input);
  const entityDetails = recordOf(activeEntity?.details);
  const sourceMetadata = {
    source_surface: safeSurface(input.surface),
    source_module: input.module || null,
    object_type: activeEntity?.type || null,
    object_id: activeEntity?.id || null,
    object_name: activeEntity?.title || null,
    estate_id: input.estate_id || actor?.estate_id || null,
    home_id: input.home_id || actor?.home_id || null,
    room_id: entityDetails.room_id || input.room_id || null,
    room_name: entityDetails.room_name || input.room_name || null,
    task_state: conversationState.conversation_state || null,
  };
  try {
    const threadWrite = await supabaseAdmin.from("oyi_conversation_threads").upsert({
      id: threadId,
      user_id: actor?.id || null,
      surface: safeSurface(input.surface),
      estate_id: input.estate_id || actor?.estate_id || null,
      home_id: input.home_id || actor?.home_id || null,
      module: input.module || null,
      title: userMessage.slice(0, 96) || "Oyi conversation",
      updated_at: now,
      metadata: {
        role_policy: getIntelligencePermissionPolicy(actor),
        conversation_state: conversationState,
        ...sourceMetadata,
        resolved_context_snapshot: input.context || {
          surface: safeSurface(input.surface),
          estate_id: input.estate_id || actor?.estate_id || null,
          home_id: input.home_id || actor?.home_id || null,
          module: input.module || null,
        },
      },
    } as any);
    if (threadWrite.error) throw threadWrite.error;
    const messageWrite = await supabaseAdmin.from("oyi_conversation_messages").insert([
      {
        thread_id: threadId,
        user_id: actor?.id || null,
        role: "user",
        content: userMessage,
        metadata: { surface: input.surface, module: input.module, ...sourceMetadata },
        created_at: now,
      },
      {
        thread_id: threadId,
        user_id: actor?.id || null,
        role: "assistant",
        content: response.message,
        cards: response.cards || [],
        sources: response.sources || [],
        suggested_actions: response.suggested_actions || [],
        metadata: {
          awareness: response.awareness,
          intent: response.intent || null,
          understood: response.understood || null,
          execution: response.execution || null,
          display_mode: response.display_mode || "conversation",
          domain: response.domain || null,
          recommended_action: response.recommended_action || null,
          awareness_score: response.awareness_score || null,
          intent_routing: response.internal_intent || null,
          ...sourceMetadata,
        },
        created_at: new Date(Date.now() + 1).toISOString(),
      },
    ] as any);
    if (messageWrite.error) throw messageWrite.error;
    const verification = await verifyThreadTurnPersistence(threadId, 2);
    if (!verification.ok) throw new Error(verification.error || "Conversation turn persistence could not be verified");
    response.persistence_verified = true;
    return threadId;
  } catch (err: any) {
    if (newlyCreatedThread) await cleanupOrphanConversationThread(threadId);
    response.persistence_warning = err?.message || "Conversation storage unavailable";
    response.thread_id = null;
    console.warn("[oyi-thread]", "turn_persistence_failed", {
      thread_id: threadId,
      newly_created_thread: newlyCreatedThread,
      error: response.persistence_warning,
    });
  }
  return null;
}

async function threadMessageSummary(threadId: string) {
  const countResult = await supabaseAdmin
    .from("oyi_conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId);
  const latestResult = await supabaseAdmin
    .from("oyi_conversation_messages")
    .select("id,role,content,metadata,suggested_actions,created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(6);
  if (countResult.error) console.warn("[oyi-thread]", "message_count_failed", { thread_id: threadId, error: countResult.error.message });
  if (latestResult.error) console.warn("[oyi-thread]", "preview_failed", { thread_id: threadId, error: latestResult.error.message });
  const latestRows = latestResult.data || [];
  const previewRow = latestRows.find((message: any) => cleanThreadPreview(message.content));
  const latestMetadata = latestRows.find((message: any) => message?.metadata)?.metadata || {};
  const latestActions = latestRows.flatMap((message: any) => Array.isArray(message?.suggested_actions) ? message.suggested_actions : []);
  return {
    preview: cleanThreadPreview(previewRow?.content || latestMetadata.preview),
    message_count: Number(countResult.count || 0),
    latest_metadata: latestMetadata,
    latest_actions: latestActions,
  };
}

async function verifyThreadTurnPersistence(threadId: string, minimumMessages = 2) {
  const countResult = await supabaseAdmin
    .from("oyi_conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId);
  if (countResult.error) return { ok: false, count: 0, error: countResult.error.message };
  const count = Number(countResult.count || 0);
  return { ok: count >= minimumMessages, count, error: count >= minimumMessages ? null : "Conversation messages were not persisted" };
}

async function cleanupOrphanConversationThread(threadId: string) {
  const summary = await threadMessageSummary(threadId);
  if (summary.message_count > 0) return;
  const { error } = await supabaseAdmin
    .from("oyi_conversation_threads")
    .delete()
    .eq("id", threadId);
  if (error) console.warn("[oyi-thread]", "orphan_cleanup_failed", { thread_id: threadId, error: error.message });
}

async function enrichThreadRows(rows: any[]) {
  return Promise.all((rows || []).map(async (row) => threadRow(row, await threadMessageSummary(String(row.id)))));
}

function lastOperationalObject(metadata: Record<string, any>) {
  const object = metadata.last_operational_object || metadata.active_target || metadata.thread_memory_context || {};
  const type = object.type || object.object_type || null;
  const id = object.id || object.object_id || object.canonical_id || null;
  if (!type || !id) return null;
  return { type: String(type), id: String(id), label: humanLabel(object.label || object.object_name || object.objectName) };
}

function activeWorkflowForThread(metadata: Record<string, any>, summary: { latest_metadata?: Record<string, any>; latest_actions?: Array<Record<string, any>> } = {}) {
  const stateWorkflow = metadata.conversation_state?.active_workflow && typeof metadata.conversation_state.active_workflow === "object"
    ? metadata.conversation_state.active_workflow
    : {};
  const directWorkflow = metadata.workflow && typeof metadata.workflow === "object" ? metadata.workflow : {};
  const latestWorkflow = summary.latest_metadata?.workflow && typeof summary.latest_metadata.workflow === "object" ? summary.latest_metadata.workflow : {};
  const actionWorkflow = (summary.latest_actions || []).find((action: any) => action?.workflow_id) || {};
  const workflow = { ...stateWorkflow, ...directWorkflow, ...latestWorkflow, ...actionWorkflow };
  const workflowId = workflow.workflow_id ? String(workflow.workflow_id) : "";
  if (!workflowId) return null;
  const status = String(workflow.status || workflow.workflow_status || "").trim();
  if (/^(answered|completed|failed|cancelled|expired|superseded)$/i.test(status)) return null;
  return {
    workflow_id: workflowId,
    action_id: workflow.action_id ? String(workflow.action_id) : null,
    status: status || null,
    capability_key: workflow.capability_key ? String(workflow.capability_key) : null,
    missing_input: workflow.missing_input ? String(workflow.missing_input) : null,
    target_id: workflow.target_id ? String(workflow.target_id) : null,
    channel_code: workflow.channel_code ? String(workflow.channel_code) : null,
  };
}

function threadRow(row: any, summary: { preview?: string | null; message_count?: number; latest_metadata?: Record<string, any>; latest_actions?: Array<Record<string, any>> } = {}) {
  const metadata = row.metadata || {};
  const latestMetadata = summary.latest_metadata || {};
  const title = row.title && !genericThreadTitle(row.title)
    ? row.title
    : humanLabel(metadata.title || metadata.last_intent)
      || cleanThreadPreview(summary.preview || metadata.preview)
      || "Oyi conversation";
  return {
    id: row.id,
    surface: row.surface,
    estate_id: row.estate_id,
    home_id: row.home_id,
    module: row.module,
    title,
    preview: summary.preview || cleanThreadPreview(metadata.preview),
    message_count: Number(summary.message_count || metadata.message_count || 0),
    started_at: row.created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_intent: metadata.last_intent || latestMetadata.intent || latestMetadata.canonical_request_contract?.intent || null,
    last_scope: metadata.last_scope || latestMetadata.canonical_request_contract?.scope_mode || null,
    last_operational_object: lastOperationalObject(metadata),
    active_workflow: activeWorkflowForThread(metadata, summary),
    metadata: row.metadata || {},
  };
}

function messageRow(row: any) {
  return {
    id: row.id,
    thread_id: row.thread_id,
    role: row.role,
    content: row.content || "",
    cards: Array.isArray(row.cards) ? row.cards : [],
    sources: Array.isArray(row.sources) ? row.sources : [],
    suggested_actions: Array.isArray(row.suggested_actions) ? row.suggested_actions : [],
    metadata: row.metadata || {},
    created_at: row.created_at,
  };
}

function scopedThreadQuery(actor: AuthUser, input: ThreadListInput = {}) {
  const surface = safeSurface(input.surface);
  let query = supabaseAdmin
    .from("oyi_conversation_threads")
    .select("id,user_id,surface,estate_id,home_id,module,title,metadata,created_at,updated_at")
    .eq("user_id", actor.id)
    .eq("surface", surface)
    .order("updated_at", { ascending: false })
    .limit(parseLimit(input.limit, 24));
  const estateId = input.estate_id || actor.estate_id || null;
  const homeId = input.home_id || actor.home_id || null;
  if (estateId) query = query.eq("estate_id", estateId);
  if (homeId) query = query.eq("home_id", homeId);
  return query;
}

export async function listOyiConversationThreads(actor: AuthUser | null, input: ThreadListInput = {}) {
  if (!actor?.id) return { ok: false, error: "Authentication required", threads: [] };
  const surface = safeSurface(input.surface);
  return observeAgentAction(
    { agent_id: surface === "facility" ? "facility" : "oyi", action: "oyi.threads.list", tool: "oyi:threads", surface, actor },
    async () => {
      const { data, error } = await scopedThreadQuery(actor, input);
      if (error) return { ok: false, error: error.message, threads: [] };
      const threads = (await enrichThreadRows(data || [])).filter((thread) => Number(thread.message_count || 0) > 0);
      return { ok: true, threads, role_policy: getIntelligencePermissionPolicy(actor) };
    }
  );
}

export async function getOyiConversationMessages(actor: AuthUser | null, threadId: string) {
  if (!actor?.id) return { ok: false, error: "Authentication required", messages: [] };
  if (!validUuid(threadId)) return { ok: false, error: "Invalid thread id", messages: [] };
  return observeAgentAction(
    { agent_id: "oyi", action: "oyi.threads.messages", tool: "oyi:thread.messages", surface: "api", actor },
    async () => {
      const thread = await supabaseAdmin
        .from("oyi_conversation_threads")
        .select("id,user_id,surface,estate_id,home_id,module,title,metadata,created_at,updated_at")
        .eq("id", threadId)
        .eq("user_id", actor.id)
        .maybeSingle();
      if (thread.error) return { ok: false, error: thread.error.message, messages: [] };
      if (!thread.data) return { ok: false, error: "Thread not found", messages: [] };
      const messages = await supabaseAdmin
        .from("oyi_conversation_messages")
        .select("id,thread_id,user_id,role,content,cards,sources,suggested_actions,metadata,created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(200);
      if (messages.error) return { ok: false, error: messages.error.message, thread: threadRow(thread.data), messages: [] };
      return { ok: true, thread: threadRow(thread.data, await threadMessageSummary(threadId)), messages: (messages.data || []).map(messageRow), role_policy: getIntelligencePermissionPolicy(actor) };
    }
  );
}

export async function getOyiUnifiedAwareness(actor: AuthUser | null, input: { surface?: OyiSurface; estate_id?: string | null; home_id?: string | null; context?: OisContext | null }) {
  const surface = safeSurface(input.surface);
  return observeAgentAction(
    { agent_id: surface === "facility" ? "facility" : "oyi", action: "oyi.awareness", tool: "oyi:awareness", surface, actor },
    async () => {
      const context = await loadUnifiedContext(actor, { surface, estate_id: input.estate_id, home_id: input.home_id });
      // Compatibility-only: awareness payloads still use the legacy contract
      // while chat/read-only summaries progressively cut over to src/oyi-core.
      const awareness = buildAwareness(surface, context, actor);
      return { ok: true, ...decorateOyiTargets(awareness), role_policy: getIntelligencePermissionPolicy(actor), warnings: context.warnings };
    }
  );
}

export async function runOyiUnifiedChat(actor: AuthUser | null, input: OyiChatInput) {
  const surface = safeSurface(input.surface);
  const message = String(input.message || "").trim();
  if (!message) return { ok: false, error: "message is required" };

  return observeAgentAction(
    { agent_id: surface === "facility" ? "facility" : "oyi", action: "oyi.chat", tool: "oyi:chat", surface, actor },
    async () => {
      const loadedConversation = await loadOyiConversationContext(actor, input);
      const conversation = {
        ...loadedConversation,
        state: primeConversationStateWithInput(loadedConversation.state, input),
      };
      const explicitDomain = detectDomainIntent(normalizeOyiMessage(message), surface);
      const effectiveInput: OyiChatInput = {
        ...input,
        surface,
        message: explicitDomain ? message : expandFollowUpMessage(message, conversation.state),
        estate_id: input.estate_id || conversation.estate_id || null,
        home_id: input.home_id || conversation.home_id || null,
      };
      const internalIntent = classifyUniversalIntent({ message: effectiveInput.message, surface: surface as any, estate_id: effectiveInput.estate_id, home_id: effectiveInput.home_id });
      const context = await loadUnifiedContext(actor, { surface, estate_id: effectiveInput.estate_id, home_id: effectiveInput.home_id });
      const awareness = buildAwareness(surface, context, actor);
      const followUp = explicitDomain ? null : await resolveFollowUpOperation(actor, effectiveInput, conversation.state);
      if (!followUp && isReadOnlyCompatibilityMessage(effectiveInput.message)) {
        const runtimeCompat = compatibilityConversationPayload(actor, effectiveInput, awareness);
        if (runtimeCompat) {
          const response: any = {
            ...runtimeCompat,
            thread_id: validUuid(effectiveInput.thread_id) ? String(effectiveInput.thread_id) : randomUUID(),
            role_policy: getIntelligencePermissionPolicy(actor),
            warnings: [...context.warnings, ...(conversation.warning ? [conversation.warning] : [])],
          };
          Object.assign(response, decorateOyiTargets(response));
          if (effectiveInput.persist !== false) {
            await persistThread(actor, effectiveInput, response, message, conversation.state);
          }
          return response;
        }
      }
      const operation = followUp || await runOperatingLayer(actor, effectiveInput, context, awareness);
      const displayMode = operation.display_mode || displayModeFor(operation.intent, message, operation.cards.length > 0);
      const supportPayloadAttached = displayMode !== "conversation";
      const cards = supportPayloadAttached ? operation.cards : [];
      const sources = supportPayloadAttached ? operation.sources : [];
      const suggestedActions = supportPayloadAttached ? operation.suggested_actions : [];
      const response: any = {
        ok: true,
        message: operation.message,
        intent: operation.intent,
        understood: operation.understood,
        execution: operation.execution,
        display_mode: displayMode,
        domain: operation.domain || detectDomainIntent(message, surface)?.key || null,
        cards,
        sources,
        suggested_actions: suggestedActions,
        awareness: supportPayloadAttached && displayMode === "awareness" ? { ...awareness, suggested_actions: suggestedActions } : undefined,
        recommended_action: supportPayloadAttached && displayMode === "awareness" ? awareness.recommended_action : undefined,
        awareness_score: supportPayloadAttached && displayMode === "awareness" ? awareness.awareness_score : undefined,
        support_payload_attached: supportPayloadAttached,
        conversation_entities: operation.conversation_entities,
        conversation_offset: operation.conversation_offset,
        conversation_topic: operation.conversation_topic,
        conversation_result_state: operation.conversation_result_state,
        conversation_active_entity: operation.conversation_active_entity,
        conversation_action: operation.conversation_action,
        execution_workflow: operation.execution_workflow,
        internal_intent: internalIntent,
        thread_id: validUuid(effectiveInput.thread_id) ? String(effectiveInput.thread_id) : randomUUID(),
        role_policy: getIntelligencePermissionPolicy(actor),
        warnings: [...context.warnings, ...(conversation.warning ? [conversation.warning] : [])],
      };
      Object.assign(response, decorateOyiTargets(response, operation.conversation_active_entity || response.conversation_active_entity));
      const nextConversationState = conversationStateFromResponse(conversation.state, response, message);
      if (effectiveInput.persist !== false) {
        response.thread_id = await persistThread(actor, effectiveInput, response, message, nextConversationState);
      }
      console.info("[oyi-chat]", JSON.stringify({
        message,
        domain: response.domain,
        intent: response.intent,
        display_mode: response.display_mode,
        support_payload_attached: response.support_payload_attached,
        surface,
        awareness_fallback_used: response.display_mode === "awareness" && !response.domain,
        response: String(response.message || "").slice(0, 240),
      }));
      return response;
    }
  );
}
