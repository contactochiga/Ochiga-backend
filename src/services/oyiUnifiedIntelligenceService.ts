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
export type AwarenessSeverity = "normal" | "info" | "attention" | "critical";

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
  body: string;
  severity: AwarenessSeverity;
  destination: string;
  cards: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  score: number;
  generated_at: string;
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

function severityRank(value: unknown) {
  const raw = String(value || "").toLowerCase();
  if (/critical|emergency|breach|tamper|security/.test(raw)) return 3;
  if (/warning|attention|offline|overdue|failed|risk/.test(raw)) return 2;
  if (/info|pending|visitor|maintenance/.test(raw)) return 1;
  return 0;
}

function severityFromRank(rank: number): AwarenessSeverity {
  if (rank >= 3) return "critical";
  if (rank >= 2) return "attention";
  if (rank >= 1) return "info";
  return "normal";
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

function eventBucket(event: any) {
  const category = String(event.category || event.event_type || "operational").toLowerCase();
  const text = `${category} ${event.event_type || ""} ${event.title || ""} ${event.summary || ""}`.toLowerCase();
  if (/camera|cctv|stream/.test(text)) return "camera";
  if (/visitor|access/.test(text)) return "visitors";
  if (/maintenance|repair|work.?order/.test(text)) return "maintenance";
  if (/device|offline|switch|sensor|edge|runtime/.test(text)) return "devices";
  if (/security|critical|emergency|tamper/.test(text)) return "security";
  if (/community|notice|message|report/.test(text)) return "community";
  if (/wallet|payment|service|utility|water|electric|internet/.test(text)) return "utilities";
  if (/workflow/.test(text)) return "workflow";
  return "activity";
}

function cardTypeForBucket(bucket: string) {
  if (bucket === "visitors") return "visitors";
  if (bucket === "maintenance") return "maintenance";
  if (bucket === "devices") return "devices";
  if (bucket === "security") return "security";
  if (bucket === "camera") return "camera";
  if (bucket === "workflow") return "workflow";
  if (bucket === "community") return "community";
  if (bucket === "utilities") return "utilities";
  return "attention";
}

function buildCards(surface: OyiSurface, context: Awaited<ReturnType<typeof loadUnifiedContext>>) {
  const buckets = new Map<string, any[]>();
  for (const event of context.events.slice(0, 40)) {
    const bucket = eventBucket(event);
    buckets.set(bucket, [...(buckets.get(bucket) || []), event]);
  }
  if (context.predictions.length) buckets.set("workflow", [...(buckets.get("workflow") || []), ...context.predictions.map((prediction: any) => ({ ...prediction, title: prediction.title, summary: prediction.summary, occurred_at: prediction.created_at }))]);
  const cards = Array.from(buckets.entries()).slice(0, 6).map(([bucket, rows]) => ({
    type: cardTypeForBucket(bucket),
    title: bucket === "activity" ? (surface === "facility" ? "Operational activity" : "Recent home activity") : `${bucket.charAt(0).toUpperCase()}${bucket.slice(1)} signals`,
    summary: rows.length === 1 ? String(rows[0]?.summary || rows[0]?.title || "One item requires review.") : `${rows.length} recent item${rows.length === 1 ? "" : "s"} from ${bucket.replace(/_/g, " ")}.`,
    items: rows.slice(0, 5).map((row: any) => ({
      id: row.id || row.workflow_id || null,
      title: row.title || row.prediction_type || row.event_type || "Update",
      summary: row.summary || row.recommended_action || "Review this item.",
      status: row.status || row.workflow_status || row.severity || null,
      occurred_at: row.occurred_at || row.created_at || null,
    })),
  }));
  return cards;
}

function buildAwareness(surface: OyiSurface, context: Awaited<ReturnType<typeof loadUnifiedContext>>): AwarenessResult {
  const routes = ROUTES[surface] || ROUTES.consumer;
  const candidates = context.events.slice(0, 60).map((event: any) => {
    const bucket = eventBucket(event);
    return {
      bucket,
      rank: severityRank(`${event.category} ${event.event_type} ${event.title} ${event.summary}`),
      title: String(event.title || "Update"),
      summary: String(event.summary || "Review recent activity."),
      route: routes[bucket] || routes.activity || "/activity",
      source: event.source || event.metadata?.source_table || "intelligence_events",
    };
  });

  for (const prediction of context.predictions || []) {
    candidates.push({
      bucket: "workflow",
      rank: severityRank(`${prediction.severity} ${prediction.title} ${prediction.summary}`),
      title: String(prediction.title || "Prediction requires review"),
      summary: String(prediction.recommended_action || prediction.summary || "Review this recommendation."),
      route: routes.workflow || routes.activity || "/activity",
      source: "ochiga_intelligence_predictions",
    });
  }

  for (const workflow of context.workflows || []) {
    if (["completed", "cancelled"].includes(String(workflow.workflow_status))) continue;
    candidates.push({
      bucket: "workflow",
      rank: severityRank(`${workflow.workflow_priority} ${workflow.workflow_status} ${workflow.title}`),
      title: String(workflow.title || "Workflow requires attention"),
      summary: String(workflow.summary || workflow.recommended_action || "Review this workflow."),
      route: routes.workflow || routes.activity || "/activity",
      source: "ochiga_workflows",
    });
  }

  const top = candidates.sort((a, b) => b.rank - a.rank)[0];
  const cards = buildCards(surface, context);
  if (!top) {
    return {
      headline: surface === "facility" ? "Estate operating normally." : "Home is operating normally.",
      body: surface === "facility" ? "No operational action is required right now." : "No action required right now.",
      severity: "normal",
      destination: routes.calm || "/activity",
      cards,
      sources: [],
      score: 0,
      generated_at: new Date().toISOString(),
    };
  }

  const headlineByBucket: Record<string, string> = surface === "facility"
    ? {
        security: "Security needs review.",
        camera: "Camera event requires attention.",
        visitors: "Visitor access needs review.",
        maintenance: "Maintenance needs attention.",
        devices: "Infrastructure needs review.",
        utilities: "Utility signal needs review.",
        community: "Community item needs moderation.",
        workflow: "Operational workflow needs attention.",
        activity: "Operations have recent activity.",
      }
    : {
        security: "Security event detected.",
        visitors: "Visitor awaiting approval.",
        maintenance: "Maintenance requires attention.",
        devices: "Device attention required.",
        utilities: "Service update available.",
        community: "Community update available.",
        workflow: "Recommendation available.",
        activity: "Home activity updated.",
      };

  return {
    headline: headlineByBucket[top.bucket] || top.title,
    body: top.summary,
    severity: severityFromRank(top.rank),
    destination: top.route,
    cards,
    sources: [{ label: top.source, route: top.route }],
    score: Math.min(100, Math.max(0, top.rank * 25 + candidates.length)),
    generated_at: new Date().toISOString(),
  };
}

function buildSources(surface: OyiSurface, context: Awaited<ReturnType<typeof loadUnifiedContext>>) {
  const rows = new Map<string, any>();
  const routes = ROUTES[surface] || ROUTES.consumer;
  for (const event of context.events.slice(0, 40)) {
    const bucket = eventBucket(event);
    rows.set(bucket, { label: bucket.replace(/_/g, " "), route: routes[bucket] || routes.activity, table: event.metadata?.source_table || event.source || undefined });
  }
  if (context.predictions.length) rows.set("predictions", { label: "predictions", route: routes.workflow, table: "ochiga_intelligence_predictions" });
  if (context.workflows.length) rows.set("workflows", { label: "workflows", route: routes.workflow, table: "ochiga_workflows" });
  return Array.from(rows.values()).slice(0, 8);
}

function buildSuggestedActions(surface: OyiSurface, message: string, awareness: AwarenessResult, context: Awaited<ReturnType<typeof loadUnifiedContext>>) {
  const routes = ROUTES[surface] || ROUTES.consumer;
  const lower = message.toLowerCase();
  const actions = new Map<string, any>();
  const add = (label: string, route?: string, risk = "read") => {
    if (!route) return;
    actions.set(`${label}:${route}`, { label, route, risk });
  };
  add("Open attention item", awareness.destination, "read");
  if (/maintenance|repair|work/.test(lower) || context.events.some((e: any) => eventBucket(e) === "maintenance")) add("Open maintenance", routes.maintenance, "read");
  if (/visitor|access|gate/.test(lower) || context.events.some((e: any) => eventBucket(e) === "visitors")) add("Open visitors", routes.visitors, "read");
  if (/device|infrastructure|offline|health/.test(lower) || context.events.some((e: any) => eventBucket(e) === "devices")) add(surface === "facility" ? "Open infrastructure" : "Open devices", routes.devices, "read");
  if (/camera|security|cctv/.test(lower) || context.events.some((e: any) => ["camera", "security"].includes(eventBucket(e)))) add(surface === "facility" ? "Open security" : "Open security activity", routes.security, "read");
  if (/utility|service|wallet|payment|water|electric|internet/.test(lower)) add(surface === "facility" ? "Open utilities" : "Open services", routes.utilities, "read");
  if (context.workflows.length) add("Review workflows", routes.workflow, "read");
  return Array.from(actions.values()).slice(0, 6);
}

function answerMessage(surface: OyiSurface, message: string, awareness: AwarenessResult, context: Awaited<ReturnType<typeof loadUnifiedContext>>) {
  const lower = message.toLowerCase();
  const predictionCount = context.predictionSummary.prediction_count || 0;
  const workflowOpen = context.workflowSummary.open_workflows || 0;
  const attentionCount = context.summary.attention_count || 0;
  const latest = context.summary.latest?.[0];
  const tone = surface === "facility" ? "operations" : "home";

  if (/what('?s| is) happening|summary|today|status/.test(lower)) {
    if (attentionCount || predictionCount || workflowOpen) {
      return `Here is the current ${tone} picture: ${awareness.headline} ${awareness.body} I found ${attentionCount} attention signal${attentionCount === 1 ? "" : "s"}, ${predictionCount} open prediction${predictionCount === 1 ? "" : "s"}, and ${workflowOpen} open workflow${workflowOpen === 1 ? "" : "s"}.`;
    }
    return `${awareness.headline} ${awareness.body}`;
  }

  if (/needs attention|attention|urgent|risk|problem|issue/.test(lower)) {
    return attentionCount || predictionCount || workflowOpen
      ? `${awareness.headline} ${awareness.body} I’ve grouped the relevant sources below so you can open the right operational surface.`
      : `${surface === "facility" ? "No facility item" : "No home item"} currently needs attention from the signals I can see.`;
  }

  if (/what should i do|next|recommend|action/.test(lower)) {
    const action = context.predictionSummary.recommended_actions?.[0] || context.summary.suggested_actions?.[0] || "Review the latest activity.";
    return `${awareness.headline} Recommended next step: ${action}`;
  }

  if (/maintenance|visitor|device|camera|security|utility|community|workflow/.test(lower)) {
    return `${awareness.headline} I found the related ${surface === "facility" ? "operational" : "home"} items and added routes below. I will not perform approvals, assignments, access changes, payments, or device actions without explicit confirmation.`;
  }

  if (latest) return `${awareness.headline} Latest signal: ${latest.title}. ${latest.summary || awareness.body}`;
  return `${awareness.headline} ${awareness.body}`;
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
      const cards = buildCards(surface, context);
      const sources = buildSources(surface, context);
      const suggestedActions = buildSuggestedActions(surface, message, awareness, context);
      const response: any = {
        ok: true,
        message: answerMessage(surface, message, awareness, context),
        cards,
        sources,
        suggested_actions: suggestedActions,
        awareness: {
          headline: awareness.headline,
          body: awareness.body,
          severity: awareness.severity,
          destination: awareness.destination,
        },
        thread_id: validUuid(input.thread_id) ? String(input.thread_id) : randomUUID(),
        role_policy: getIntelligencePermissionPolicy(actor),
        warnings: context.warnings,
      };
      response.thread_id = await persistThread(actor, input, response, message);
      return response;
    }
  );
}
