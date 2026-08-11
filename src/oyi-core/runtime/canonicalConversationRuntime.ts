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
import {
  namedDevicePhraseFromControlMessage,
  requestedChannelCode,
  resolveConversationTarget,
  resolveNamedDeviceForRead,
  resolveRoomForRead,
  roomPhraseFromMessage,
  type DeviceResolutionResult,
  type RoomResolutionResult,
} from "./conversationTargetResolver";
import { hydrateCanonicalTarget } from "./canonicalTargetHydrationRegistry";
import { deviceRuntimeStateService } from "../../services/deviceRuntimeStateService";
import { normalizeUserTurn, type NormalizedUserTurn, type OyiDomain } from "./languageUnderstanding";
import { capabilityKeyForTurn, decideAuthorityForTurn, getDomainCapability, type AuthorityDecision } from "./domainCapabilityRegistry";
import { createWorkflow, type CanonicalTarget, type OyiWorkflow } from "./conversationWorkflowRuntime";
import { freshnessLabelFromEvidence, safeDateLabel } from "../presentation/timeFreshness";
import {
  buildCommandOutcomeAnswer,
  buildDeviceAvailabilityInventoryAnswer,
  buildHomeOperationalSummaryAnswer,
  buildRecentChangesAnswer,
  buildReportAnswer,
  buildWalletHistoryAnswer,
  tableBlockForContract,
  type ConversationTableBlock,
  type PresentationFactPredicates,
} from "../presentation/conversationAnswerPresentation";
import {
  currentTurnAllowsDeviceResolution as intentCurrentTurnAllowsDeviceResolution,
  currentTurnExplicitlyGlobal,
  currentTurnHasExplicitDomain,
  domainForCurrentTurn,
  interpretSemanticOperation as interpretSemanticOperationForRouting,
  isExplicitBroadHomeReadIntent,
  isReadOnlyBroadDeviceIntent,
  operationForCurrentTurn as intentOperationForCurrentTurn,
  semanticOperationAction as semanticOperationActionForRouting,
  type CanonicalIntent,
  type IntelligenceRequestContract,
  type OperationClass,
  type ScopeMode,
} from "../interpretation/conversationIntentRouting";
import {
  temporalScopeFor,
  turnInterpretationFromContract,
  type ConversationContextLayers,
  type TurnInterpretation,
} from "../context/conversationContextLayers";
import {
  constructBroadScopeObject,
  explicitObjectCandidate,
  sanitizeConversationInputTargets,
  threadObjectCandidate,
} from "../context/conversationTargetCandidates";
import {
  hydrateOperationalObjectCandidate,
  type ConversationObjectCandidate as ObjectCandidate,
  type ResolvedOperationalObject,
} from "../context/conversationObjectHydration";
import {
  buildDeviceControlProposal,
  buildDeviceCurrentStateAnswer,
  buildDeviceDiagnosisAnswer,
  buildDeviceFailureHistoryAnswer,
  buildDeviceHealthAnswer,
  buildDeviceRelationshipsAnswer,
} from "../domains/devices/deviceConversationAnswers";
import {
  dedupeIntelligenceFacts as dedupeFacts,
  factFromOperationalObject,
  isResidentVisibleOperationalFact,
  loadHomeDeviceInventoryFacts,
  loadLatestCommandFact,
  loadRecentDeviceChangeFacts as loadRecentChangeFacts,
} from "../domains/devices/deviceEvidence";
import {
  maintenanceConfirmationReply,
  maintenanceContextualActions,
  maintenanceLinkedIssueSummary,
  maintenanceObjectProfile,
  maintenanceObjectVoice,
  maintenanceRecommendation,
} from "../domains/maintenance/maintenanceConversationAnswers";
import { unresolvedMaintenanceRecordsForContext } from "../domains/maintenance/maintenanceEvidence";
import { buildUtilitySpendingAnswer } from "../domains/utilities/utilityConversationAnswers";
import { loadUtilitySpendingFacts } from "../domains/utilities/utilityEvidence";
import { loadWalletTransactionFacts } from "../domains/wallet/walletEvidence";
import {
  visitorConfirmationReply,
  visitorContextualActions,
  visitorObjectProfile,
  visitorObjectVoice,
  visitorRecommendation,
} from "../domains/visitors/visitorConversationAnswers";
import {
  securityConfirmationReply,
  securityContextualActions,
  securityObjectProfile,
  securityObjectVoice,
  securityRecommendation,
} from "../domains/security/securityConversationAnswers";
import { securityRiskAllowed } from "../domains/security/securityEvidence";
import {
  serviceConfirmationReply,
  serviceContextualActions,
  serviceObjectProfile,
  serviceObjectVoice,
  serviceRecommendation,
} from "../domains/services/serviceConversationAnswers";
import { buildSurfaceCapabilityAnswer } from "../policy/surfaceConversationPolicy";

export { resolveContextSourceForTest } from "../context/conversationObjectHydration";
export { isConversationContainerObject } from "../context/conversationTargetCandidates";

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

const INHERITABLE_EXACT_TARGET_TYPES = new Set(["device", "device_channel", "maintenance_request", "visitor", "access_pass", "operational_incident", "access_point", "service_account", "meter"]);

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
    visitor: visitorObjectProfile("visitor"),
    access_pass: visitorObjectProfile("access_pass"),
    maintenance_request: maintenanceObjectProfile(),
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
    service_account: serviceObjectProfile("service_account"),
    infrastructure_asset: {
      role: "I track this asset's health, dependencies, incidents, services, and operational impact.",
      diagnostics: ["health", "dependencies", "incidents", "affected homes"],
      actions: ["diagnose", "show dependencies", "review incidents"],
    },
    access_point: securityObjectProfile("access_point"),
    emergency_asset: {
      role: "I track this emergency asset's location, readiness, inspection state, and affected area.",
      diagnostics: ["readiness", "location", "inspection", "coverage"],
      actions: ["show location", "review inspection", "check coverage"],
    },
    camera: securityObjectProfile("camera"),
    meter: serviceObjectProfile("meter"),
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
    operational_incident: securityObjectProfile("operational_incident"),
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
    ...visitorObjectVoice(),
  };
  if (type === "maintenance_request") return {
    ...maintenanceObjectVoice(),
  };
  if (type === "service_account" || type === "meter") return {
    ...serviceObjectVoice(),
  };
  if (type === "camera" || type === "access_point" || type === "operational_incident") return {
    ...securityObjectVoice(type),
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
    const unresolved = unresolvedMaintenanceRecordsForContext(object, input);
    return maintenanceLinkedIssueSummary(object, unresolved.length);
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
  if (object.object_type === "maintenance_request") return maintenanceRecommendation();
  if (object.object_type === "wallet" || object.object_type === "transaction") return "I recommend checking the receipt or recent transactions next.";
  if (object.object_type === "service_account" || object.object_type === "meter") return serviceRecommendation();
  if (object.object_type === "visitor" || object.object_type === "access_pass") return visitorRecommendation();
  if (object.object_type === "access_point" || object.object_type === "camera" || object.object_type === "operational_incident") return securityRecommendation(object);
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
    return visitorConfirmationReply(object, response);
  }
  if (object.object_type === "maintenance_request") {
    return maintenanceConfirmationReply(object, response);
  }
  if (object.object_type === "service_account" || object.object_type === "meter") {
    return serviceConfirmationReply(object, response);
  }
  if (object.object_type === "access_point" || object.object_type === "camera" || object.object_type === "operational_incident") {
    return securityConfirmationReply(object, response);
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
    actions.push(...visitorContextualActions(object));
  } else if (object.object_type === "maintenance_request") {
    actions.push(...maintenanceContextualActions(object));
  } else if (object.object_type === "wallet" || object.object_type === "transaction") {
    add("Status", object.object_type === "transaction" ? "Did this payment enter?" : "Show balance");
    add("Receipt", "Show receipt");
    add("History", "Show transactions");
  } else if (object.object_type === "service_account" || object.object_type === "meter") {
    actions.push(...serviceContextualActions(object));
  } else if (object.object_type === "camera") {
    actions.push(...securityContextualActions(object));
  } else if (object.object_type === "access_point" || object.object_type === "operational_incident") {
    actions.push(...securityContextualActions(object));
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

function resolveCurrentTurnAuthorityDecision(input: CanonicalConversationRequest, inherited: ObjectCandidate | null, options: { roomPhrase: string; broadReadOnlyDeviceIntent: boolean; semanticOperation: ReturnType<typeof interpretSemanticOperation> | null }): CurrentTurnAuthorityDecision {
  const message = text(input.message);
  const domain = domainForCurrentTurn(message);
  const operation = options.semanticOperation?.operationClass || operationForCurrentTurn(message);
  const explicitRoomPhrase = options.roomPhrase || null;
  const explicitObjectPhrase = namedDevicePhraseFromControlMessage(message, { isControlRequest });
  let scope: ScopeMode = "global_scope";
  if (options.broadReadOnlyDeviceIntent || domain === "utilities" || domain === "wallet" || currentTurnExplicitlyGlobal(message)) scope = "home_scope";
  if (explicitRoomPhrase) scope = "room_scope";
  if (options.semanticOperation?.scopeMode) scope = options.semanticOperation.scopeMode;
  const inheritedType = inherited?.object_type || null;
  const inheritedDomain = inheritedType === "visitor" || inheritedType === "access_pass"
    ? "visitors"
    : inheritedType === "maintenance_request"
      ? "maintenance"
      : inheritedType === "operational_incident" || inheritedType === "access_point"
        ? "security"
      : inheritedType === "service_account" || inheritedType === "meter"
        ? "services"
      : inheritedType === "device" || inheritedType === "device_channel"
        ? "devices"
        : null;
  const referentialTurn = currentTurnReferencesInheritedTarget(message);
  const explicitChannelReplacement = Boolean(requestedChannelCode(message) && isControlRequest(message) && inherited && ["device", "device_channel"].includes(inherited.object_type));
  const domainBlocksInherited = Boolean(domain && domain !== "devices" && !(referentialTurn && domain === inheritedDomain));
  const hasBlockingCurrentTurnSemantics = Boolean(options.broadReadOnlyDeviceIntent || explicitRoomPhrase || options.semanticOperation || currentTurnExplicitlyGlobal(message) || domainBlocksInherited);
  const mayUseInheritedExactTarget = Boolean(
    inherited
      && INHERITABLE_EXACT_TARGET_TYPES.has(inherited.object_type)
      && !hasBlockingCurrentTurnSemantics
      && (referentialTurn || explicitChannelReplacement),
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
  return /\b(it|this|that|same one|same device|same channel|this device|this channel|selected device|selected channel|current device|current channel|its|he|she|they|him|her|that visitor|this visitor|that pass|this pass)\b/i.test(text(message));
}

function interpretSemanticOperation(message: string) {
  return interpretSemanticOperationForRouting(message, { roomPhraseFromMessage });
}

function semanticOperationAction(message: string, surface: OyiSurface) {
  return semanticOperationActionForRouting(message, surface, { roomPhraseFromMessage });
}

function operationForCurrentTurn(message: string) {
  return intentOperationForCurrentTurn(message, isControlRequest);
}

function currentTurnAllowsDeviceResolution(message: string) {
  return intentCurrentTurnAllowsDeviceResolution(message, {
    roomPhraseFromMessage,
    isControlRequest,
    currentTurnReferencesInheritedTarget,
  });
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
  if (!inherited || !INHERITABLE_EXACT_TARGET_TYPES.has(inherited.object_type)) return false;
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
  const currentTurnDomain = domainForCurrentTurn(message);
  const maintenanceReadRequested = currentTurnDomain === "maintenance"
    && /\b(what|show|list|view|status|has|who|history|open|closed|resolved|overdue|issues?|requests?|tickets?)\b/i.test(lower)
    && !/\b(create|report|raise|log|assign|escalate|close|cancel|reopen|update)\b/i.test(lower);
  const maintenanceActionRequested = currentTurnDomain === "maintenance"
    && /\b(create|report|raise|log|assign|escalate|close|cancel|reopen|update)\b/i.test(lower);
  const visitorReadRequested = currentTurnDomain === "visitors"
    && /\b(who|what|when|has|is|can|show|list|view|status|history|expected|pending|arrived|arrival|came in|come in|valid|expired|currently)\b/i.test(lower)
    && !/\b(create|invite|add|approve|deny|reject|revoke|cancel|extend|give|grant|allow|remove)\b/i.test(lower);
  const visitorActionRequested = currentTurnDomain === "visitors"
    && /\b(create|invite|add|approve|deny|reject|revoke|cancel|extend|give|grant|allow|remove)\b/i.test(lower);
  const securityReadRequested = currentTurnDomain === "security"
    && /\b(what|why|show|list|view|status|has|is|are|any|alerts?|incidents?|issues?|history|unusual|gate|door|alarm|security|resolved|acknowledged)\b/i.test(lower)
    && !/\b(lock|unlock|disable|enable|acknowledge|acknowledged|escalate|assign|resolve|close|turn on|turn off)\b/i.test(lower);
  const securityActionRequested = currentTurnDomain === "security"
    && /\b(lock|unlock|disable|enable|acknowledge|escalate|assign|resolve|close|turn on|turn off)\b/i.test(lower);
  const serviceStatusQuestion = /\b(status|has|is|are|when|what|which|show|list|view|available|active|history|provider|technician|coming)\b/i.test(lower);
  const serviceTargetContext = currentTurnDomain === "services" || targetType === "service_account" || targetType === "meter";
  const serviceReadRequested = serviceTargetContext
    && /\b(what|which|when|show|list|view|status|has|is|are|available|active|requests?|bookings?|scheduled|history|provider|technician|coming)\b/i.test(lower)
    && !(/\b(book|schedule|request|cancel|reschedule|approve|modify|change|create|submit)\b/i.test(lower)
      && !(/\brequest\b/i.test(lower) && serviceStatusQuestion && !/\b(book|schedule|request a|create|submit|cancel|reschedule|approve|modify|change)\b/i.test(lower)));
  const serviceActionRequested = serviceTargetContext
    && /\b(book|schedule|request|cancel|reschedule|approve|modify|change|create|submit)\b/i.test(lower)
    && !(/\brequest\b/i.test(lower) && serviceStatusQuestion && !/\b(book|schedule|request a|create|submit|cancel|reschedule|approve|modify|change)\b/i.test(lower));
  const mutationRequested = !semanticCandidate && !maintenanceReadRequested && !visitorReadRequested && !visitorActionRequested && !securityReadRequested && !securityActionRequested && !serviceReadRequested && !serviceActionRequested && isControlRequest(message) && !/\b(what happened|why|is|show|list|history|report|recommend|what can|changed|status|working|healthy|evidence|did that work|last command)\b/i.test(lower);
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
  } else if (maintenanceReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (maintenanceActionRequested) {
    intent = "maintenance_operation";
    operationClass = "compose";
  } else if (visitorReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (visitorActionRequested) {
    intent = "visitor_operation";
    operationClass = "compose";
  } else if (securityReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (securityActionRequested) {
    intent = "security_operation";
    operationClass = "compose";
  } else if (serviceReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (serviceActionRequested) {
    intent = "service_operation";
    operationClass = "compose";
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
    : semanticOperation
    ? semanticOperation.scopeMode
    : scopeHint === "exact_target" && targetType && !explicitBroad
    && !semanticOperation
    ? "exact_target"
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
  const semanticBroadTarget = Boolean(semanticOperation && semanticOperation.scopeMode === "home_scope" && semanticOperation.operationClass === "list");
  const domainBroadTarget = Boolean(
    ["maintenance", "visitors", "security", "services"].includes(currentTurnDomain || "")
    && ["list", "report"].includes(operationClass)
    && /\b(all|any|show|list|unresolved|open|expected|pending|alerts?|incidents?|issues?|requests?|services?|bookings?)\b/i.test(lower),
  );
  const retainedTargetType = semanticBroadTarget || domainBroadTarget ? null : targetType;
  return {
    conversation_request_id: conversationRequestId,
    thread_id: text(input.thread_id) || null,
    surface: input.surface,
    operation_class: operationClass,
    intent,
    scope_mode: scopeMode,
    temporal_scope: temporalScopeFor(message),
    target: {
      object_type: retainedTargetType,
      canonical_id: retainedTargetType ? targetCanonicalId : null,
      parent_id: retainedTargetType ? targetParentId : null,
      channel_code: retainedTargetType ? targetChannelCode : null,
      label: retainedTargetType ? targetLabel : null,
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

function factFromObject(object: OperationalObject, hydrationFacts: Record<string, unknown>, input: CanonicalConversationRequest, oisContext: OisContext | null | undefined): IntelligenceFact {
  return factFromOperationalObject(object, hydrationFacts, input, oisContext, { objectStateLine });
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

const presentationFactPredicates: PresentationFactPredicates = {
  factAppliesToContract,
  isResidentVisibleOperationalFact,
  isUsefulDeviceActivityFact,
  securityRiskAllowed,
};

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

function buildCapabilityAnswer(object: OperationalObject | null, input: CanonicalConversationRequest) {
  return buildSurfaceCapabilityAnswer({ object, request: input, objectCapabilityLine });
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

function domainForResolvedTurn(contract: IntelligenceRequestContract, object: OperationalObject | null, semantic?: ReturnType<typeof semanticOperationAction> | null, message = "") {
  const currentTurnDomain = domainForCurrentTurn(message);
  if (["maintenance", "visitors", "security", "services"].includes(currentTurnDomain || "")) return currentTurnDomain;
  if (semantic?.operation?.domain) return semantic.operation.domain;
  const module = text(object?.source_module).toLowerCase();
  const targetType = text(contract.target.object_type).toLowerCase();
  if (module) return module;
  if (/device|switch|camera/.test(targetType)) return "devices";
  if (/room/.test(targetType)) return "rooms";
  if (/visitor|access/.test(targetType)) return "visitors";
  if (/maintenance/.test(targetType)) return "maintenance";
  if (/wallet|transaction/.test(targetType)) return "wallet";
  if (/incident/.test(targetType)) return "incidents";
  if (contract.intent === "wallet_operation" && contract.answer_builder === "utility_spending") return "utilities";
  if (contract.intent === "wallet_operation") return "wallet";
  if (contract.intent === "maintenance_operation") return "maintenance";
  if (contract.intent === "visitor_operation" || contract.intent === "access_operation") return "visitors";
  if (contract.intent === "security_operation") return "security";
  if (contract.intent === "service_operation") return "services";
  if (contract.intent === "domain_list") return domainForCurrentTurn(message);
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
    domain: domainForResolvedTurn(contract, object, semantic, input.message),
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
  return buildDeviceHealthAnswer(input.object, input.facts || {}, { factFromObject });
}

export function canonicalRecentChangesAnswerForTest(input: { facts: IntelligenceFact[]; message?: string }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "What changed recently?" });
  return buildRecentChangesAnswer(dedupeFacts(input.facts), contract, presentationFactPredicates);
}

export function canonicalConversationTableBlockForTest(input: { facts: IntelligenceFact[]; message?: string; object?: OperationalObject | null; request?: Partial<CanonicalConversationRequest> }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "What changed recently?", object: input.object || null, request: input.request });
  return tableBlockForContract(contract, dedupeFacts(input.facts), presentationFactPredicates);
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
    const proposal = buildDeviceControlProposal({ contract, object });
    answer = proposal.answer;
    displayMode = "detail";
    execution = proposal.execution;
    const shaped = {
      id: `oyi-runtime:${contract.conversation_request_id}`,
      thread_id: contract.thread_id || randomUUID(),
      intent: contract.intent,
      understood: proposal.understood,
      message: answer,
      reply: answer,
      display_mode: displayMode,
      confidence: 0.82,
      execution,
      sources: [],
      cards: [],
      suggested_actions: [],
      confirmations: proposal.confirmations,
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
    answer = buildRecentChangesAnswer(facts, contract, presentationFactPredicates);
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
    facts = dedupeFacts([...facts, ...await loadUtilitySpendingFacts(input, oisContext, contract)]);
    answer = buildUtilitySpendingAnswer(facts);
    displayMode = "list";
  } else if (contract.intent === "failure_history") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildDeviceFailureHistoryAnswer(facts, contract, { factAppliesToContract, isFailureFact });
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
    answer = buildDeviceHealthAnswer(object, hydrationFacts, { factFromObject });
  } else if (contract.intent === "diagnosis" || contract.intent === "investigation" || contract.intent === "explanation") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildDeviceDiagnosisAnswer(object, hydrationFacts, facts, contract, { factFromObject, factAppliesToContract, isFailureFact });
    displayMode = "detail";
  } else if (contract.intent === "relationships") {
    answer = buildDeviceRelationshipsAnswer(object, input, hydrationFacts, contract, { listNames, arrayOfStrings });
    displayMode = "detail";
  } else if (contract.intent === "current_state" || contract.intent === "evidence") {
    answer = buildDeviceCurrentStateAnswer(object, hydrationFacts, contract, { factFromObject });
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
  const tableBlock = tableBlockForContract(contract, deduped, presentationFactPredicates);
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
  const namedControlPhrase = currentTurnAllowsDeviceResolution(input.message || "") ? namedDevicePhraseFromControlMessage(input.message || "", { isControlRequest }) : null;
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
    resolved = await hydrateOperationalObjectCandidate({
      actor,
      oisContext,
      candidate: preferredCandidate,
      activeContext: activeContextRecord,
      visibleState: Object.keys(visibleStateRecord).length ? visibleStateRecord : null,
      surface: input.surface,
    });
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
