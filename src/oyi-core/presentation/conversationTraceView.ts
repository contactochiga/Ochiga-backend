// Intelligence System Visibility, Slice 7 -- read side of the durable
// canonical trace store. Reads only the sanitized projection columns
// (oyi_conversation_traces holds nothing else); never joins messages,
// threads or any identity table. Expired rows are excluded on every read,
// independent of whether the retention job has run yet.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { CONVERSATION_TRACE_TABLE, conversationTraceEnabled } from "../observability/conversationTraceRecorder";
import {
  OBSERVED_TRACE_STAGES,
  TRACE_RESOLUTION_OUTCOMES,
  TRACE_RESPONSE_STATUSES,
  TRACE_SURFACES,
  TRACE_TERMINAL_OUTCOMES,
  TRACE_WORKERS,
  TRACE_DOMAINS,
  traceRetentionDays,
  safeToken,
} from "../observability/conversationTraceProjection";

const LIST_COLUMNS = "trace_id,thread_ref,surface,worker,actor_class,domain,operation,mutation_intent,capability_key,resolution_outcome,authority_result,terminal_outcome,response_status,persistence_saved,confirmation_required,lineage,started_at,total_latency_ms";
const MAX_PAGE_SIZE = 50;
const SUMMARY_SAMPLE_LIMIT = 5000;
// Latency aggregates are only reported once a worker/window has at least
// this many turns; below it a median is not a meaningful statistic.
export const TRACE_LATENCY_MIN_SAMPLE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRUCTURAL_FAILURES = new Set(["runtime_error", "canonical_unsupported", "capability_no_match", "business_surface_fallback", "declared_disabled", "authority_denied"]);

export type TraceListFilters = {
  since?: string | null;
  until?: string | null;
  worker?: string | null;
  surface?: string | null;
  domain?: string | null;
  capability?: string | null;
  resolution_outcome?: string | null;
  authority_result?: string | null;
  terminal_outcome?: string | null;
  response_status?: string | null;
  has_lineage?: boolean | null;
  thread_ref?: string | null;
};

const oneOf = (value: unknown, allowed: readonly string[]) => (typeof value === "string" && allowed.includes(value) ? value : null);
const isoOrNull = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);

// Caller input is narrowed to closed vocabularies before reaching a query.
export function normalizeTraceFilters(raw: Record<string, unknown>): TraceListFilters {
  return {
    since: isoOrNull(raw.since),
    until: isoOrNull(raw.until),
    worker: oneOf(raw.worker, TRACE_WORKERS),
    surface: oneOf(raw.surface, TRACE_SURFACES),
    domain: oneOf(raw.domain, TRACE_DOMAINS),
    capability: safeToken(raw.capability),
    resolution_outcome: oneOf(raw.resolution_outcome, TRACE_RESOLUTION_OUTCOMES),
    authority_result: oneOf(raw.authority_result, ["allowed", "denied"]),
    terminal_outcome: oneOf(raw.terminal_outcome, TRACE_TERMINAL_OUTCOMES),
    response_status: oneOf(raw.response_status, TRACE_RESPONSE_STATUSES),
    has_lineage: raw.has_lineage === "true" || raw.has_lineage === true ? true : null,
    thread_ref: typeof raw.thread_ref === "string" && /^th_[0-9a-f]{20}$/.test(raw.thread_ref) ? raw.thread_ref : null,
  };
}

function lineageLinks(lineage: Record<string, unknown>) {
  const links: Array<{ kind: string; label: string; section: string; ref: string }> = [];
  const id = (k: string) => (typeof lineage?.[k] === "string" && UUID.test(lineage[k] as string) ? (lineage[k] as string) : null);
  if (id("workflow_id")) links.push({ kind: "workflow", label: "Conversation workflow", section: "actions-workflows", ref: `conversation_workflow:${id("workflow_id")}` });
  if (id("communication_id")) links.push({ kind: "communication", label: "Communication", section: "actions-workflows", ref: `communication:${id("communication_id")}` });
  if (id("goal_id")) links.push({ kind: "goal", label: "Goal", section: "goals-decisions/goal", ref: id("goal_id")! });
  if (id("decision_id")) links.push({ kind: "decision", label: "Decision", section: "goals-decisions/decision", ref: id("decision_id")! });
  if (id("action_id")) links.push({ kind: "action", label: "Governed action recorded", section: "", ref: "" });
  if (id("proposal_id")) links.push({ kind: "proposal", label: "Office action proposal recorded", section: "", ref: "" });
  return links;
}

function listRow(row: any) {
  const lineage = row.lineage && typeof row.lineage === "object" ? row.lineage : {};
  return {
    trace_id: row.trace_id,
    thread_ref: row.thread_ref,
    started_at: row.started_at,
    surface: row.surface,
    worker: row.worker,
    actor_class: row.actor_class,
    domain: row.domain,
    operation: row.operation,
    mutation_intent: row.mutation_intent,
    capability_key: row.capability_key,
    resolution_outcome: row.resolution_outcome,
    authority_result: row.authority_result,
    terminal_outcome: row.terminal_outcome,
    response_status: row.response_status,
    persistence_saved: row.persistence_saved,
    confirmation_required: row.confirmation_required,
    has_lineage: Object.keys(lineage).length > 0,
    total_latency_ms: row.total_latency_ms,
  };
}

export async function listConversationTraces(filters: TraceListFilters, page = 1, pageSize = 20) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 20));
  const p = Math.max(1, Math.floor(page) || 1);
  const nowIso = new Date().toISOString();
  let q: any = supabaseAdmin.from(CONVERSATION_TRACE_TABLE).select(LIST_COLUMNS, { count: "exact" }).gt("expires_at", nowIso);
  if (filters.since) q = q.gte("started_at", filters.since);
  if (filters.until) q = q.lte("started_at", filters.until);
  if (filters.worker) q = q.eq("worker", filters.worker);
  if (filters.surface) q = q.eq("surface", filters.surface);
  if (filters.domain) q = q.eq("domain", filters.domain);
  if (filters.capability) q = q.eq("capability_key", filters.capability);
  if (filters.resolution_outcome) q = q.eq("resolution_outcome", filters.resolution_outcome);
  if (filters.authority_result) q = q.eq("authority_result", filters.authority_result);
  if (filters.terminal_outcome) q = q.eq("terminal_outcome", filters.terminal_outcome);
  if (filters.response_status) q = q.eq("response_status", filters.response_status);
  if (filters.has_lineage) q = q.neq("lineage", "{}");
  if (filters.thread_ref) q = q.eq("thread_ref", filters.thread_ref);
  const { data, error, count } = await q.order("started_at", { ascending: false }).range((p - 1) * size, p * size - 1);
  if (error) throw error;
  const total = count ?? 0;
  return { items: (data || []).map(listRow), pagination: { page: p, page_size: size, total, total_pages: Math.max(1, Math.ceil(total / size)) } };
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

// One bounded query over the last `windowHours`, aggregated in memory over
// non-sensitive columns only. Serves Activity & Trace KPIs, Overview and
// Workers so they never disagree.
export async function summarizeConversationTraces(windowHours = 24) {
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from(CONVERSATION_TRACE_TABLE)
    .select("worker,terminal_outcome,response_status,authority_result,total_latency_ms")
    .gte("started_at", since)
    .gt("expires_at", new Date().toISOString())
    .order("started_at", { ascending: false })
    .limit(SUMMARY_SAMPLE_LIMIT);
  if (error) throw error;
  const rows = (data || []) as Array<{ worker: string; terminal_outcome: string; response_status: string; authority_result: string | null; total_latency_ms: number }>;
  const byTerminal: Record<string, number> = Object.fromEntries(TRACE_TERMINAL_OUTCOMES.map((t) => [t, 0]));
  const latencyStats = (subset: typeof rows) => {
    if (subset.length < TRACE_LATENCY_MIN_SAMPLE) return { available: false as const, reason: "insufficient_sample", sample: subset.length, min_sample: TRACE_LATENCY_MIN_SAMPLE };
    const sorted = subset.map((r) => r.total_latency_ms).sort((a, b) => a - b);
    return { available: true as const, sample: subset.length, median_ms: percentile(sorted, 0.5), p95_ms: percentile(sorted, 0.95) };
  };
  rows.forEach((r) => { byTerminal[r.terminal_outcome] = (byTerminal[r.terminal_outcome] || 0) + 1; });
  const byWorker = Object.fromEntries(
    TRACE_WORKERS.filter((w) => w !== "other").map((w) => {
      const subset = rows.filter((r) => r.worker === w);
      return [w, {
        turns: subset.length,
        no_match_or_terminal: subset.filter((r) => ["capability_no_match", "canonical_unsupported", "business_surface_fallback", "declared_disabled"].includes(r.terminal_outcome)).length,
        failures: subset.filter((r) => r.terminal_outcome === "runtime_error" || r.response_status !== "returned").length,
        latency: latencyStats(subset),
      }];
    })
  );
  return {
    window_hours: windowHours,
    truncated: rows.length >= SUMMARY_SAMPLE_LIMIT,
    turns: rows.length,
    by_terminal_outcome: byTerminal,
    structural_failures: rows.filter((r) => STRUCTURAL_FAILURES.has(r.terminal_outcome)).length,
    no_match: byTerminal.capability_no_match || 0,
    authority_denied: byTerminal.authority_denied || 0,
    runtime_errors: byTerminal.runtime_error || 0,
    persistence_failures: rows.filter((r) => r.response_status === "returned_unsaved").length,
    latency: latencyStats(rows),
    by_worker: byWorker,
  };
}

export async function getConversationTrace(traceId: string) {
  if (!UUID.test(traceId)) return null;
  const { data, error } = await supabaseAdmin
    .from(CONVERSATION_TRACE_TABLE)
    .select("*")
    .eq("trace_id", traceId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row: any = data;
  let sameConversation: number | null = null;
  if (row.thread_ref) {
    const { count } = await supabaseAdmin.from(CONVERSATION_TRACE_TABLE).select("trace_id", { count: "exact", head: true }).eq("thread_ref", row.thread_ref).gt("expires_at", new Date().toISOString());
    sameConversation = count ?? null;
  }
  const stages = Array.isArray(row.stages) ? row.stages.filter((s: any) => (OBSERVED_TRACE_STAGES as readonly string[]).includes(s?.stage)) : [];
  const observed = new Set(stages.map((s: any) => s.stage));
  return {
    ...listRow(row),
    target_class: row.target_class,
    target_resolution_source: row.target_resolution_source,
    capability_rollout: row.capability_rollout,
    authority_tier: row.authority_tier,
    authority_denial_reason: row.authority_denial_reason,
    evidence_planned: row.evidence_planned,
    evidence_count: row.evidence_count,
    workflow_restored: row.workflow_restored,
    workflow_state: row.workflow_state,
    execution_state: row.execution_state,
    compatibility_label_seen: row.compatibility_label_seen,
    error_class: row.error_class,
    completed_at: row.completed_at,
    expires_at: row.expires_at,
    stages: stages.map((s: any) => ({ stage: s.stage, offset_ms: Number(s.offset_ms) || 0, duration_ms: Number(s.duration_ms) || 0 })),
    stage_coverage: OBSERVED_TRACE_STAGES.map((stage) => ({ stage, observed: observed.has(stage) })),
    lineage_links: lineageLinks(row.lineage || {}),
    same_conversation_traces: sameConversation,
  };
}

export function conversationTraceStoreConfig() {
  return { write_enabled: conversationTraceEnabled(), retention_days: traceRetentionDays() };
}
