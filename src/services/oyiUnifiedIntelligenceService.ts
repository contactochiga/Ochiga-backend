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
import type { ProposedAiTool } from "../ai/commandRouter";

export type OyiSurface = "consumer" | "facility" | "office" | "watch" | "edge";
export type AwarenessSeverity = "normal" | "info" | "attention" | "warning" | "critical";

type OyiChatInput = {
  surface?: OyiSurface;
  estate_id?: string | null;
  home_id?: string | null;
  module?: string | null;
  role?: string | null;
  message: string;
  thread_id?: string | null;
};

type ConversationEntity = {
  type: "device" | "visitor" | "maintenance" | "service" | "wallet" | "community" | "report" | "awareness";
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

const SURFACES: OyiSurface[] = ["consumer", "facility", "office", "watch", "edge"];
const SUMMARY_BY_SURFACE: Record<OyiSurface, IntelligenceSummaryType> = {
  consumer: "consumer",
  facility: "facility",
  office: "office",
  watch: "watch",
  edge: "edge",
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
    utilities: "/utilities",
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

function emptyConversationState(): ConversationState {
  return { version: 1, entities: [] };
}

function entityTypeFromCard(card: any): ConversationEntity["type"] | null {
  const value = `${card?.type || ""} ${card?.title || ""}`.toLowerCase();
  if (/visitor|guest|access/.test(value)) return "visitor";
  if (/maintenance|support|repair/.test(value)) return "maintenance";
  if (/device|infrastructure|camera|sensor/.test(value)) return "device";
  if (/wallet|payment|transaction/.test(value)) return "wallet";
  if (/service|utility|water|electric|internet/.test(value)) return "service";
  if (/community|notice|announcement/.test(value)) return "community";
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

function conversationStateFromResponse(previous: ConversationState, response: any, userMessage: string): ConversationState {
  const results = Array.isArray(response?.execution?.results) ? response.execution.results : [];
  const pending = results.find((row: any) => row?.status === "pending_confirmation" && row?.ledger_id);
  const entities = Array.isArray(response?.conversation_entities)
    ? response.conversation_entities.slice(0, 50)
    : entitiesFromCards(response?.cards || []);
  const activeTopic = response?.conversation_topic || topicForIntent(response?.intent) || previous.active_topic || null;
  const activeResultState = response?.conversation_result_state || (activeTopic ? (entities.length ? "list" : "empty") : previous.active_result_state || null);
  return {
    version: 1,
    last_intent: response?.intent || previous.last_intent,
    last_user_message: userMessage.slice(0, 500),
    entities: activeResultState === "empty" ? [] : entities.length ? entities : previous.entities.slice(0, 20),
    active_topic: activeTopic,
    active_result_state: activeResultState,
    list_offset: Number.isFinite(Number(response?.conversation_offset)) ? Number(response.conversation_offset) : previous.list_offset || 0,
    pending_confirmation_id: pending?.ledger_id || null,
    pending_action_summary: pending?.summary || null,
  };
}

function ordinalEntity(message: string, entities: ConversationEntity[]) {
  const lower = message.toLowerCase();
  const ordinal = /\bfirst\b/.test(lower) ? 0 : /\bsecond\b/.test(lower) ? 1 : /\bthird\b/.test(lower) ? 2 : /\blast\b/.test(lower) ? Math.max(0, entities.length - 1) : 0;
  return entities[ordinal] || null;
}

function isFollowUpMessage(message: string) {
  const value = message.trim().toLowerCase();
  if (["why", "why?", "when", "when?", "who", "who?"].includes(value)) return true;
  return /\b(approve|reject|assign|show me more|more details|what should i do next|do it|go ahead|that one|this one|the first|the second|the third|when was|who reported|why did|it)\b/i.test(value);
}

function topicForIntent(intent?: OyiIntentCategory): ConversationEntity["type"] | null {
  if (intent === "visitor_operation") return "visitor";
  if (intent === "maintenance_operation") return "maintenance";
  if (intent === "device_status" || intent === "device_control") return "device";
  if (intent === "wallet_operation") return "wallet";
  if (intent === "service_operation") return "service";
  if (intent === "community_operation") return "community";
  if (intent === "report_generation" || intent === "investigation") return "report";
  if (intent === "awareness" || intent === "recommendation") return "awareness";
  return null;
}

function topicLabel(topic?: ConversationState["active_topic"] | null, plural = false) {
  const labels: Record<string, string> = { visitor: plural ? "visitor requests" : "visitor request", maintenance: plural ? "maintenance issues" : "maintenance issue", device: plural ? "devices" : "device", service: plural ? "service requests" : "service request", wallet: plural ? "wallet records" : "wallet record", community: plural ? "community reports" : "community report", report: plural ? "reports" : "report", awareness: plural ? "attention items" : "attention item" };
  return labels[String(topic || "")] || (plural ? "records" : "record");
}

function followUpIntent(message: string, state: ConversationState): OyiIntentCategory {
  const lower = message.toLowerCase();
  if (/why\?|when\?|who\?|more details/.test(lower)) return "investigation";
  if (/show me more/.test(lower)) return state.last_intent || "general_help";
  return state.last_intent || "general_help";
}

function expandFollowUpMessage(message: string, state: ConversationState) {
  if (!isFollowUpMessage(message)) return message;
  const entity = ordinalEntity(message, state.entities);
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
  const entity = ordinalEntity(message, normalized.entities);
  const lower = message.trim().toLowerCase();
  const resolution = normalized.active_result_state === "empty" && normalized.active_topic
    ? /show (me )?(the )?(first|second|third|last) one|that one|this one/i.test(message) ? "empty_ordinal"
      : /^(why|why\?)|why did/i.test(message) ? "empty_explanation"
      : "empty_topic"
    : !entity && normalized.active_topic && /^(why|why\?|when|when\?|who|who\?)|when was|who reported|why did/i.test(message) ? "topic_clarification"
      : !entity && /show (me )?(the )?(first|second|third|last) one|that one|this one/i.test(message) ? "no_active_list"
        : /show me more/.test(lower) ? "continuation"
          : entity ? "entity" : "none";
  return {
    is_follow_up: isFollowUpMessage(message),
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
      headline: facility ? "Utility services need review." : "Service status needs review.",
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
  const openWorkflows = (context.workflows || []).filter((workflow: any) => !["completed", "cancelled"].includes(String(workflow.workflow_status || workflow.status).toLowerCase()));
  if (openWorkflows.length) {
    buckets.set("workflows", [
      ...(buckets.get("workflows") || []),
      ...openWorkflows.map((workflow: any) => ({ ...workflow, occurred_at: workflow.created_at, source: "ochiga_workflows" })),
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
  if (/utility|service|wallet|payment|water|electric|internet/.test(lower)) add("Review utility or payment status.", domainRoute(surface, "utilities"), "read");
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
};

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
  { key: "visitors", surfaces: ["consumer", "facility"], phrases: /visitor|guest|access pass|visitor approval/i, intent: "visitor_operation", tool_id: "summarize_visitors", label: "visitor requests", unavailable: "I can’t see visitor records for this context yet." },
  { key: "maintenance", surfaces: ["consumer", "facility"], phrases: /maintenance|repair|service ticket|work order/i, intent: "maintenance_operation", tool_id: "summarize_maintenance", label: "maintenance issues", unavailable: "I can’t see maintenance records for this context yet." },
  { key: "devices", surfaces: ["consumer", "facility"], phrases: /device|light|switch|socket|hardware/i, intent: "device_status", tool_id: "summarize_devices", label: "devices", unavailable: "I can’t see device records for this context yet." },
  { key: "rooms", surfaces: ["consumer"], phrases: /room|rooms|space|spaces/i, intent: "general_help", label: "rooms and spaces", unavailable: "I don’t have room records available through this chat context yet." },
  { key: "scenes", surfaces: ["consumer"], phrases: /scene|scenes/i, intent: "general_help", label: "scenes", unavailable: "I don’t have scene records available through this chat context yet." },
  { key: "automation", surfaces: ["consumer"], phrases: /automation|automations|routine|routines/i, intent: "general_help", label: "automations", unavailable: "I don’t have automation records available through this chat context yet." },
  { key: "services", surfaces: ["consumer", "facility"], phrases: /service|services|fiber|internet plan/i, intent: "service_operation", label: "services", unavailable: "I don’t have service records available through this chat context yet." },
  { key: "wallet", surfaces: ["consumer", "facility"], phrases: /wallet|payment|payments|transaction|transactions|balance|charge/i, intent: "wallet_operation", tool_id: "summarize_wallet", label: "wallet information", unavailable: "I can’t see wallet records for this context yet." },
  { key: "community", surfaces: ["consumer", "facility"], phrases: /community|announcement|announcements|notice|notices|complaint|feedback/i, intent: "community_operation", tool_id: "summarize_community", label: "community updates", unavailable: "There are no recent community updates available in this context." },
  { key: "activity", surfaces: ["consumer", "facility"], phrases: /activity|timeline|recent activity|who did what/i, intent: "investigation", tool_id: "summarize_recent_activity", label: "activity", unavailable: "I don’t have activity records available in this context yet." },
  { key: "notifications", surfaces: ["consumer", "facility"], phrases: /notification|notifications|alert|alerts/i, intent: "notification_operation", label: "notifications", unavailable: "There are no notifications available in this context." },
  { key: "security", surfaces: ["consumer", "facility"], phrases: /security|alarm|gate|door/i, intent: "investigation", label: "security activity", unavailable: "I don’t have security records available in this chat context yet." },
  { key: "utilities", surfaces: ["consumer", "facility"], phrases: /utility|utilities|water|electricity|electric|meter/i, intent: "service_operation", label: "utility information", unavailable: "I don’t have utility records available in this chat context yet." },
  { key: "profile", surfaces: ["consumer"], phrases: /profile|home context|my home|household/i, intent: "general_help", label: "home context", unavailable: "I don’t have additional home profile records available in this chat context yet." },
  { key: "cameras", surfaces: ["facility"], phrases: /camera|cameras|cctv|camera event/i, intent: "device_status", label: "camera events", unavailable: "There are no camera events currently visible." },
  { key: "infrastructure", surfaces: ["facility"], phrases: /infrastructure|runtime|edge node|stream health/i, intent: "device_status", tool_id: "summarize_devices", label: "infrastructure records", unavailable: "I don’t have infrastructure records available in this chat context yet." },
  { key: "sensors", surfaces: ["facility"], phrases: /sensor|sensors|environment|temperature|humidity/i, intent: "device_status", label: "sensor readings", unavailable: "I don’t have sensor readings available in this chat context yet." },
  { key: "traffic", surfaces: ["facility"], phrases: /traffic|mobility|parking|vehicle flow/i, intent: "general_help", label: "traffic and mobility records", unavailable: "I don’t have traffic or mobility records available in this chat context yet." },
  { key: "staff", surfaces: ["facility"], phrases: /staff|team|operator|operators/i, intent: "general_help", label: "staff records", unavailable: "I don’t have staff records available in this chat context yet." },
  { key: "reports", surfaces: ["facility"], phrases: /report|reports|daily estate/i, intent: "report_generation", label: "reports", unavailable: "I don’t have report records available in this chat context yet." },
  { key: "estate", surfaces: ["facility"], phrases: /estate structure|estate|homes|home list|building|units/i, intent: "general_help", label: "estate structure", unavailable: "I don’t have estate structure records available in this chat context yet." },
];

function detectDomainIntent(message: string, surface: OyiSurface): DomainIntent | null {
  return DOMAIN_INTENTS.find((domain) => domain.surfaces.includes(surface) && domain.phrases.test(message)) || null;
}

export function detectOyiDomainForTest(message: string, surface: OyiSurface) {
  return detectDomainIntent(message, surface)?.key || null;
}

export function resolveOyiDomainIntentForTest(message: string, surface: OyiSurface) {
  const domain = detectDomainIntent(message, surface);
  const classified = classifyOyiOperatingIntentForTest(message);
  return { domain: domain?.key || null, intent: domain?.intent || classified, awareness_fallback_used: !domain && classified === "awareness" };
}

export function classifyOyiOperatingIntentForTest(message: string): OyiIntentCategory {
  const text = message.toLowerCase().replace(/[’`]/g, "'");
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
    service_operation: "I’ll review the available service and utility information.",
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
  if (intent === "service_operation") rows.push(action(surface === "facility" ? "Review utilities" : "Review services", routes.utilities));
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

function operationalConversationMessage(intent: OyiIntentCategory, entities: ConversationEntity[], fallback: string, message = "") {
  const topic = topicForIntent(intent);
  if (!topic) return fallback;
  if (!entities.length) {
    if (topic === "visitor") return "There are currently no visitor requests awaiting approval.";
    if (topic === "maintenance") return "There are currently no open maintenance issues.";
    if (topic === "device") return "There are currently no matching device or infrastructure records to show.";
    if (topic === "service") return "There are currently no service issues to show.";
    if (topic === "community") return "There are currently no community reports to show.";
    if (topic === "wallet") return "There are currently no wallet records to show.";
    return `There are currently no ${topicLabel(topic, true)} to show.`;
  }
  const open = topic === "maintenance" ? entities.filter((row) => /open|new|assigned|scheduled|progress|waiting/i.test(String(row.status || ""))) : entities;
  const pending = topic === "visitor" && /pending|approval|waiting/.test(message.toLowerCase())
    ? entities.filter((row) => /pending|requested/i.test(String(row.status || "")))
    : entities;
  const relevant = topic === "maintenance" ? open : pending;
  if (!relevant.length) {
    if (topic === "maintenance") return "There are currently no open maintenance issues.";
    if (topic === "visitor") return "There are currently no visitor requests awaiting approval.";
  }
  const label = topicLabel(topic, true);
  return `There ${relevant.length === 1 ? "is" : "are"} ${relevant.length} ${label} available.\n${plainEntityList(relevant)}\nWhich one would you like to inspect?`;
}

function activeEntitiesForMessage(intent: OyiIntentCategory, entities: ConversationEntity[], message: string) {
  const lower = message.toLowerCase();
  if (intent === "visitor_operation" && /pending|approval|waiting/.test(lower)) {
    return entities.filter((row) => /pending|requested/i.test(String(row.status || "")));
  }
  if (intent === "maintenance_operation" && /open|issue|overdue|maintenance/.test(lower)) {
    return entities.filter((row) => /open|new|assigned|scheduled|progress|waiting/i.test(String(row.status || "")));
  }
  return entities;
}

async function loadConversationContext(actor: AuthUser | null, input: OyiChatInput): Promise<ConversationContext> {
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
          entities: Array.isArray(raw.entities) ? raw.entities.slice(0, 20) : [],
        } as ConversationState
      : emptyConversationState();
    return { state, estate_id: data.estate_id || null, home_id: data.home_id || null };
  } catch {
    return { state: emptyConversationState(), warning: "Previous conversation context is unavailable." };
  }
}

async function resolveFollowUpOperation(actor: AuthUser | null, input: OyiChatInput, state: ConversationState): Promise<OperatingResult | null> {
  const message = String(input.message || "").trim();
  if (!isFollowUpMessage(message)) return null;
  const entity = ordinalEntity(message, state.entities);
  const intent = followUpIntent(message, state);
  const surface = safeSurface(input.surface);
  const details = entity?.details || {};
  const dateLabel = (value: unknown, label: string) => value ? `${label} ${new Date(String(value)).toLocaleString()}.` : "The available record does not include that time.";

  if (state.active_result_state === "empty" && state.active_topic) {
    if (/show (me )?(the )?(first|second|third|last) one|that one|this one/i.test(message)) {
      return { intent, understood: `The current ${topicLabel(state.active_topic, true)} list is empty.`, message: `There is no ${/second|third/.test(message.toLowerCase()) ? "matching" : "first"} ${topicLabel(state.active_topic)} to show because none are currently available in this context.`, cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" } };
    }
    if (/^(why|why\?)|why did/i.test(message)) {
      return { intent: "investigation", understood: `The current ${topicLabel(state.active_topic, true)} list is empty.`, message: `Because there are no ${topicLabel(state.active_topic, true)} in the current ${surface === "facility" ? "estate" : "home"} context.`, cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" } };
    }
  }

  if (!entity && state.active_topic && /^(why|why\?|when|when\?|who|who\?)|when was|who reported|why did/i.test(message)) {
    return { intent: "investigation", understood: `The active topic is ${topicLabel(state.active_topic, true)}.`, message: `Which ${topicLabel(state.active_topic)} do you mean? You can say “the first one” or name it.`, cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" } };
  }

  if (!entity && /show (me )?(the )?(first|second|third|last) one|that one|this one/i.test(message)) {
    return { intent, understood: "There is no active result list.", message: "I don’t have an active list open right now. Ask me to show visitor requests, maintenance issues, devices, or activity first.", cards: [], sources: [], suggested_actions: [], execution: { status: "read_only" } };
  }

  if (/show (me )?(the )?(first|second|third|last) one|^(why|when|who)\??$|when was|who reported|why did/i.test(message) && entity) {
    if (/^when\??$|when was/i.test(message)) {
      return { intent: "investigation", understood: `I found ${entity.title}.`, message: `${entity.title} is currently ${entity.status || "recorded"}. ${dateLabel(details.created_at || details.updated_at, "It was recorded")}`, cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" } };
    }
    if (/^who\??$|who reported/i.test(message)) {
      return { intent: "investigation", understood: `I found ${entity.title}.`, message: details.reported_by ? `${entity.title} was reported by ${String(details.reported_by)}.` : `I found ${entity.title}, but the available record does not identify who reported it.`, cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" } };
    }
    if (/^why\??$|why did/i.test(message)) {
      const explanation = details.summary ? `The available record says: ${String(details.summary)}.` : `Its current status is ${entity.status || "recorded"}.`;
      return { intent: "investigation", understood: `I found ${entity.title}.`, message: `${entity.title}: ${explanation} I do not have enough verified evidence to state a cause beyond the recorded details.`, cards: [], sources: userFacingSources(surface, "report"), suggested_actions: [], execution: { status: "read_only" } };
    }
    return { intent, understood: `I found ${entity.title}.`, message: `${entity.title} is currently ${entity.status || "recorded"}.${details.created_at ? ` Recorded ${new Date(String(details.created_at)).toLocaleString()}.` : ""}`, cards: [], sources: userFacingSources(surface, "operation"), suggested_actions: operatingSuggestedActions(surface, intent), execution: { status: "read_only" } };
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

  if (/^(do it|go ahead|confirm|yes)$/i.test(message)) {
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
    return {
      intent,
      understood: "I’ll confirm the pending action from this conversation.",
      message: confirmed.ok
        ? String(record?.result_summary || "The requested action has been processed.")
        : "I could not confirm that action. It may have expired or is no longer available.",
      cards: [],
      sources: userFacingSources(surface, "operation"),
      suggested_actions: operatingSuggestedActions(surface, intent),
      execution: { status: "processed", results: [{ status, summary: record?.result_summary || confirmed.error || "Action confirmation processed." }] },
    };
  }

  if (/^(approve|reject)\b/i.test(message) && entity?.type === "visitor") {
    return {
      intent: "visitor_operation",
      understood: `I found ${entity.title} from the previous visitor results.`,
      message: `I found ${entity.title}. Visitor approval is not enabled as an Oyi chat action yet, so no access decision was made. Review the visitor in Visitor Access to complete it safely.`,
      cards: [], sources: userFacingSources(surface, "operation"),
      suggested_actions: operatingSuggestedActions(surface, "visitor_operation"), execution: { status: "validation_required" },
    };
  }

  if (/^assign\b/i.test(message) && entity?.type === "maintenance") {
    return {
      intent: "maintenance_operation",
      understood: `I found ${entity.title} from the previous maintenance results.`,
      message: `I found ${entity.title}. Assignment needs the existing maintenance workflow so the assignee and audit record are captured correctly. No assignment has been made yet.`,
      cards: [], sources: userFacingSources(surface, "operation"),
      suggested_actions: operatingSuggestedActions(surface, "maintenance_operation"), execution: { status: "validation_required" },
    };
  }

  return null;
}

async function runOperatingLayer(actor: AuthUser | null, input: OyiChatInput, context: Awaited<ReturnType<typeof loadUnifiedContext>>, awareness: AwarenessResult): Promise<OperatingResult> {
  const surface = safeSurface(input.surface);
  const message = String(input.message || "");
  const domain = detectDomainIntent(message, surface);
  const classifiedIntent = classifyOyiOperatingIntentForTest(message);
  const intent = domain?.key === "devices" && isDomainMutationRequest(message)
    ? classifiedIntent === "device_control" ? classifiedIntent : "device_control"
    : domain?.intent || classifiedIntent;
  const understood = understoodText(surface, intent);

  if (domain && isDomainMutationRequest(message) && domain.key !== "devices") {
    return domainActionPreparation(domain, message, surface);
  }

  if (intent === "awareness" || intent === "recommendation" || intent === "general_help") {
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

  const proposedTools = actor ? (domain?.tool_id && intent !== "device_control" ? [{ tool_id: domain.tool_id, arguments: { estate_id: input.estate_id || null, home_id: input.home_id || null } }] : proposedToolsForIntent(intent, message, input)) : [];
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
    const conversationTopic = topicForIntent(intent);
    return {
      intent,
      understood,
      message: routed.results.some((item: any) => item.status === "pending_confirmation")
        ? `${commandSummary(routed.results)} No action has been performed yet.`.trim()
        : operationalConversationMessage(intent, activeEntities, commandSummary(routed.results), message),
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
  try {
    await supabaseAdmin.from("oyi_conversation_threads").upsert({
      id: threadId,
      user_id: actor?.id || null,
      surface: safeSurface(input.surface),
      estate_id: input.estate_id || actor?.estate_id || null,
      home_id: input.home_id || actor?.home_id || null,
      module: input.module || null,
      title: userMessage.slice(0, 96) || "Oyi conversation",
      updated_at: now,
      metadata: { role_policy: getIntelligencePermissionPolicy(actor), conversation_state: conversationState },
    } as any);
    await supabaseAdmin.from("oyi_conversation_messages").insert([
      {
        thread_id: threadId,
        user_id: actor?.id || null,
        role: "user",
        content: userMessage,
        metadata: { surface: input.surface, module: input.module },
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
        },
        created_at: new Date(Date.now() + 1).toISOString(),
      },
    ] as any);
  } catch (err: any) {
    response.persistence_warning = err?.message || "Conversation storage unavailable";
  }
  return threadId;
}

function threadRow(row: any) {
  return {
    id: row.id,
    surface: row.surface,
    estate_id: row.estate_id,
    home_id: row.home_id,
    module: row.module,
    title: row.title || "Oyi conversation",
    created_at: row.created_at,
    updated_at: row.updated_at,
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
      return { ok: true, threads: (data || []).map(threadRow), role_policy: getIntelligencePermissionPolicy(actor) };
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
        .limit(200);
      if (messages.error) return { ok: false, error: messages.error.message, thread: threadRow(thread.data), messages: [] };
      return { ok: true, thread: threadRow(thread.data), messages: (messages.data || []).map(messageRow), role_policy: getIntelligencePermissionPolicy(actor) };
    }
  );
}

export async function getOyiUnifiedAwareness(actor: AuthUser | null, input: { surface?: OyiSurface; estate_id?: string | null; home_id?: string | null }) {
  const surface = safeSurface(input.surface);
  return observeAgentAction(
    { agent_id: surface === "facility" ? "facility" : "oyi", action: "oyi.awareness", tool: "oyi:awareness", surface, actor },
    async () => {
      const context = await loadUnifiedContext(actor, { surface, estate_id: input.estate_id, home_id: input.home_id });
      const awareness = buildAwareness(surface, context, actor);
      return { ok: true, ...awareness, role_policy: getIntelligencePermissionPolicy(actor), warnings: context.warnings };
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
      const conversation = await loadConversationContext(actor, input);
      const effectiveInput: OyiChatInput = {
        ...input,
        surface,
        message: expandFollowUpMessage(message, conversation.state),
        estate_id: input.estate_id || conversation.estate_id || null,
        home_id: input.home_id || conversation.home_id || null,
      };
      const context = await loadUnifiedContext(actor, { surface, estate_id: effectiveInput.estate_id, home_id: effectiveInput.home_id });
      const awareness = buildAwareness(surface, context, actor);
      const followUp = await resolveFollowUpOperation(actor, effectiveInput, conversation.state);
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
        thread_id: validUuid(effectiveInput.thread_id) ? String(effectiveInput.thread_id) : randomUUID(),
        role_policy: getIntelligencePermissionPolicy(actor),
        warnings: [...context.warnings, ...(conversation.warning ? [conversation.warning] : [])],
      };
      const nextConversationState = conversationStateFromResponse(conversation.state, response, message);
      response.thread_id = await persistThread(actor, effectiveInput, response, message, nextConversationState);
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
