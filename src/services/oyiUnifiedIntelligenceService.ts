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
};

function eventText(event: any) {
  return `${event.category || ""} ${event.event_type || ""} ${event.title || ""} ${event.summary || ""} ${event.source || ""}`.toLowerCase();
}

function isInternalAiEvent(event: any) {
  const text = eventText(event);
  return /ai response generated|ai tool executed|ai tool requested|ai command received|workflow evaluated|prediction generated|oyi\.chat|oyi\.awareness|tool executed|tool requested/.test(text);
}

function eventBucket(event: any): AwarenessDomain {
  const category = String(event.category || event.event_type || "operational").toLowerCase();
  const text = `${category} ${event.event_type || ""} ${event.title || ""} ${event.summary || ""}`.toLowerCase();
  if (/camera|cctv|stream/.test(text)) return "camera";
  if (/visitor|access/.test(text)) return "visitors";
  if (/maintenance|repair|work.?order/.test(text)) return "maintenance";
  if (/edge|runtime|infrastructure|offline|sync|webhook|api|storage/.test(text)) return "infrastructure";
  if (/device|switch|sensor|relay|socket/.test(text)) return "devices";
  if (/security|critical|emergency|tamper/.test(text)) return "security";
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

function buildSignals(surface: OyiSurface, context: Awaited<ReturnType<typeof loadUnifiedContext>>) {
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
    ? ["security", "camera", "visitors", "maintenance", "infrastructure", "devices", "utilities", "finance", "community", "predictions", "workflows", "activity", "automation"]
    : ["security", "visitors", "maintenance", "devices", "infrastructure", "utilities", "finance", "automation", "community", "predictions", "workflows", "activity"];

  return Array.from(buckets.entries()).map(([domain, rows]) => {
    const severity = signalSeverity(domain, rows);
    const copy = awarenessDomainCopy(surface, domain, rows.length, severity);
    const priority = priorityOrder.indexOf(domain);
    return {
      domain,
      severity,
      headline: copy.headline,
      summary: copy.summary,
      recommended_action: copy.action,
      route: domainRoute(surface, domain),
      source: String(rows[0]?.source || rows[0]?.metadata?.source_table || domain),
      items: rows.slice(0, 5),
      priority: priority === -1 ? 99 : priority,
    } satisfies AwarenessSignal;
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
  }));
}

function pickPrimarySignal(signals: AwarenessSignal[]) {
  return [...signals].sort((a, b) => {
    const severityDelta = maxSeverityRank(b.severity) - maxSeverityRank(a.severity);
    if (severityDelta) return severityDelta;
    return a.priority - b.priority;
  })[0] || null;
}

function scoreFromDecision(severity: AwarenessSeverity, signals: AwarenessSignal[]) {
  const base = severity === "critical" ? 25 : severity === "warning" ? 48 : severity === "attention" ? 68 : severity === "info" ? 82 : 96;
  const pressure = Math.min(12, Math.max(0, signals.length - 1) * 2);
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
    cards: buildCardsFromSignals(signals.filter((signal) => signal.severity === "info").slice(0, 3)),
    sources: [],
    suggested_actions: [],
    awareness_score: score,
    score,
    generated_at: generatedAt,
  };
}

function buildAwareness(surface: OyiSurface, context: Awaited<ReturnType<typeof loadUnifiedContext>>): AwarenessResult {
  const generatedAt = new Date().toISOString();
  const signals = buildSignals(surface, context);
  const actionableSignals = signals.filter((signal) => maxSeverityRank(signal.severity) >= maxSeverityRank("attention"));
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
  for (const signal of signals.filter((item) => maxSeverityRank(item.severity) >= maxSeverityRank("attention")).slice(0, 5)) {
    add(signal.recommended_action, signal.route, "read");
  }
  if (/maintenance|repair|work/.test(lower)) add("Review the maintenance queue.", domainRoute(surface, "maintenance"), "read");
  if (/visitor|access|gate/.test(lower)) add("Review visitor access.", domainRoute(surface, "visitors"), "read");
  if (/device|infrastructure|offline|health/.test(lower)) add("Check infrastructure health.", domainRoute(surface, surface === "facility" ? "infrastructure" : "devices"), "read");
  if (/camera|security|cctv/.test(lower)) add("Review security activity.", domainRoute(surface, "security"), "read");
  if (/utility|service|wallet|payment|water|electric|internet/.test(lower)) add("Review utility or payment status.", domainRoute(surface, "utilities"), "read");
  return Array.from(actions.values()).slice(0, 6);
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

async function persistThread(actor: AuthUser | null, input: OyiChatInput, response: any, userMessage: string) {
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
      metadata: { role_policy: getIntelligencePermissionPolicy(actor) },
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
        metadata: { awareness: response.awareness },
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
      const awareness = buildAwareness(surface, context);
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
      const context = await loadUnifiedContext(actor, { surface, estate_id: input.estate_id, home_id: input.home_id });
      const awareness = buildAwareness(surface, context);
      const cards = awareness.cards;
      const sources = buildSources(surface, context);
      const suggestedActions = buildSuggestedActions(surface, message, awareness, context);
      const response: any = {
        ok: true,
        message: answerMessage(surface, message, awareness),
        cards,
        sources,
        suggested_actions: suggestedActions,
        awareness: { ...awareness, suggested_actions: suggestedActions },
        recommended_action: awareness.recommended_action,
        awareness_score: awareness.awareness_score,
        thread_id: validUuid(input.thread_id) ? String(input.thread_id) : randomUUID(),
        role_policy: getIntelligencePermissionPolicy(actor),
        warnings: context.warnings,
      };
      response.thread_id = await persistThread(actor, input, response, message);
      return response;
    }
  );
}
