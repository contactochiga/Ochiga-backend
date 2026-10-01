// Intelligence System Visibility, Slice 6 -- Memory & Context.
//
// Observes the MEMORY SYSTEM, never anyone's memories. Every query in this
// file is a head-only count (`{ count, head: true }`): no conversation
// text, thread/owner/home IDs, result-set records, drafts, objectives or
// memory values are ever selected, so none can reach Node, let alone the
// response. Context-type TTLs come from the owning modules' own exported
// constants -- never restated here.
//
// Bounding: every TTL-bearing context lives in oyi_conversation_threads.
// metadata and is written by the same upsert that sets the thread's
// updated_at, so a still-live context can only sit on a thread updated
// within that context's own TTL. Each active-context count is therefore
// restricted to `updated_at >= now - ttl` (a small recent window) before
// its JSON-path expiry filter runs.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { OFFICE_ACTIVE_CONTEXT_TTL_MS } from "../context/officeConversationContext";
import { PUBLIC_OPPORTUNITY_OBJECTIVE_TTL_MS } from "../context/publicOpportunityObjective";
import { COMMUNICATION_DRAFT_TTL_MS } from "../context/communicationDraft";
import { COMMUNICATION_PROPOSAL_TTL_MS } from "../context/communicationProposal";
import { PROPOSAL_TTL_MS } from "../context/officeActionProposal";
import { GOAL_PROPOSAL_TTL_MS } from "../context/goalProposal";
import { PERSON_CONTEXT_TTL_MS } from "../context/personContext";
import { LAST_VERIFIED_ACTION_TTL_MS } from "../context/officeAutomationSuggestion";
import { RESIDENT_CONTEXT_RETENTION_MS, RESIDENT_MEMORY_ADMITTED_TYPES, residentMemoryProjection } from "../context/residentMemoryContext";
import { SupabaseWorkflowRepository, activeWorkflowStatuses } from "../workflows/WorkflowRepository";

const THREADS = "oyi_conversation_threads";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Mirrors OyiSurface (services/oyiUnifiedIntelligenceService.ts); a
// static smoke guard fails if that type changes without this list.
export const CONVERSATION_SURFACES = ["consumer", "facility", "office", "watch", "edge", "public_corporate", "office_internal"] as const;

type ExpiryRule =
  | { kind: "expires_at" } // metadata.<key>.expires_at > now
  | { kind: "sliding"; field: string } // metadata.<key>.<field> > now - ttl
  | { kind: "none" }; // no TTL -- thread-scoped

export type ContextTypeDescriptor = {
  key: string;
  label: string;
  metadata_key: string | null;
  purpose: string;
  persistence: "ephemeral_ttl" | "thread_scoped" | "durable";
  ttl_ms: number | null;
  expiry_model: string;
  pending_action: boolean;
  expiry: ExpiryRule;
};

export const CONTEXT_TYPE_DESCRIPTORS: ContextTypeDescriptor[] = [
  {
    key: "result_set",
    label: "Result Sets",
    metadata_key: "result_sets",
    purpose: "Lets follow-ups (\"the second one\", \"only the urgent ones\") resolve against the list Oyi just showed, one set per domain.",
    persistence: "thread_scoped",
    ttl_ms: null,
    expiry_model: "Lives with its thread; replaced per domain when a later turn produces a new list.",
    pending_action: false,
    expiry: { kind: "none" },
  },
  {
    key: "business_active_context",
    label: "Active Business Context",
    metadata_key: "business_active_context",
    purpose: "Keeps the Office record currently under discussion in focus across turns.",
    persistence: "ephemeral_ttl",
    ttl_ms: OFFICE_ACTIVE_CONTEXT_TTL_MS,
    expiry_model: "Expires at a fixed time after it was last set.",
    pending_action: false,
    expiry: { kind: "expires_at" },
  },
  {
    key: "public_opportunity_objective",
    label: "Public Opportunity Objective",
    metadata_key: "public_opportunity_objective",
    purpose: "Tracks what a public enquirer is trying to achieve so the conversation can progress toward it.",
    persistence: "ephemeral_ttl",
    ttl_ms: PUBLIC_OPPORTUNITY_OBJECTIVE_TTL_MS,
    expiry_model: "Sliding: expires this long after its last update.",
    pending_action: false,
    expiry: { kind: "sliding", field: "updated_at" },
  },
  {
    key: "communication_draft",
    label: "Communication Draft",
    metadata_key: "draft_communication",
    purpose: "Holds a message being composed so it can be revised before any send is proposed.",
    persistence: "ephemeral_ttl",
    ttl_ms: COMMUNICATION_DRAFT_TTL_MS,
    expiry_model: "Expires at a fixed time after it was drafted.",
    pending_action: false,
    expiry: { kind: "expires_at" },
  },
  {
    key: "communication_proposal",
    label: "Pending Communication",
    metadata_key: "pending_communication",
    purpose: "A send awaiting the user's explicit confirmation.",
    persistence: "ephemeral_ttl",
    ttl_ms: COMMUNICATION_PROPOSAL_TTL_MS,
    expiry_model: "Expires if not confirmed in time -- a stale \"yes\" cannot send it later.",
    pending_action: true,
    expiry: { kind: "expires_at" },
  },
  {
    key: "action_proposal",
    label: "Pending Governed Action",
    metadata_key: "pending_action_proposal",
    purpose: "A governed Office action awaiting confirmation.",
    persistence: "ephemeral_ttl",
    ttl_ms: PROPOSAL_TTL_MS,
    expiry_model: "Expires if not confirmed in time -- a stale \"yes\" cannot execute it later.",
    pending_action: true,
    expiry: { kind: "expires_at" },
  },
  {
    key: "goal_proposal",
    label: "Pending Goal",
    metadata_key: "pending_goal",
    purpose: "A proposed goal awaiting the user's agreement before it is created.",
    persistence: "ephemeral_ttl",
    ttl_ms: GOAL_PROPOSAL_TTL_MS,
    expiry_model: "Expires if not agreed in time.",
    pending_action: true,
    expiry: { kind: "expires_at" },
  },
  {
    key: "recipient_disambiguation",
    label: "Recipient Disambiguation",
    metadata_key: "pending_recipient_disambiguation",
    purpose: "Waits for the user to say which of several matching people they meant.",
    persistence: "ephemeral_ttl",
    ttl_ms: PERSON_CONTEXT_TTL_MS,
    expiry_model: "Expires at a fixed time after the question was asked.",
    pending_action: false,
    expiry: { kind: "expires_at" },
  },
  {
    key: "last_verified_action",
    label: "Last Verified Action",
    metadata_key: "last_verified_office_action",
    purpose: "Lets \"do that every Friday\" refer to the action just verified.",
    persistence: "ephemeral_ttl",
    ttl_ms: LAST_VERIFIED_ACTION_TTL_MS,
    expiry_model: "Sliding from verification time.",
    pending_action: false,
    expiry: { kind: "sliding", field: "verified_at" },
  },
  {
    key: "workflow",
    label: "Workflows",
    metadata_key: null,
    purpose: "Multi-step conversational work (collecting inputs, review, approval, execution).",
    persistence: "durable",
    ttl_ms: null,
    expiry_model: "Durable record that moves through its status lifecycle; does not expire.",
    pending_action: false,
    expiry: { kind: "none" },
  },
];

// Resident-memory write paths, as wired in code today. A static smoke
// guard re-derives each live_callers figure from source, so this cannot
// silently go stale if someone wires (or removes) a writer.
export const RESIDENT_MEMORY_WRITE_PATHS = [
  {
    key: "governed_scoped_admission",
    label: "Governed scoped admission",
    function_name: "writeScopedMemory",
    status: "not_wired" as const,
    live_callers: 0,
    admission_checks: "Only oyi/watch agents; only user/home/estate scope.",
    note: "Implemented with admission checks, but nothing calls it.",
  },
  {
    key: "legacy_chat_compatibility",
    label: "Legacy /ai/chat compatibility writer",
    function_name: "recordIntelligenceMemory",
    status: "active" as const,
    live_callers: 1,
    admission_checks: "None -- direct upsert, no admission filter.",
    note: "Called on every /ai/chat message. In practice writes only recent_intelligence_query: its per-tool branches require an \"executed\" result, which this route never passes.",
  },
];

type Timed<T> = { ok: true; value: T } | { ok: false; error: string };

export type MemoryContextView = Awaited<ReturnType<typeof buildMemoryContextView>>;

export async function buildMemoryContextView(now = Date.now()) {
  const timings: Record<string, number> = {};
  let queryCount = 0;
  async function timed<T>(name: string, fn: () => Promise<T>): Promise<Timed<T>> {
    const startedAt = Date.now();
    try {
      const value = await fn();
      timings[name] = Date.now() - startedAt;
      return { ok: true, value };
    } catch (err: any) {
      timings[name] = Date.now() - startedAt;
      return { ok: false, error: err?.message || String(err) };
    }
  }
  async function headCount(table: string, apply: (q: any) => any, method: "exact" | "estimated" = "exact"): Promise<number> {
    queryCount += 1;
    const { count, error } = await apply(supabaseAdmin.from(table).select("*", { count: method, head: true }));
    if (error) throw new Error(error.message || "count_failed");
    return count ?? 0;
  }
  const iso = (ms: number) => new Date(ms).toISOString();

  // --- conversation continuity ---
  const continuity = timed("conversation_continuity", async () => {
    const [threadsTotal, messagesTotal, active24h, active7d, ...bySurface] = await Promise.all([
      headCount(THREADS, (q) => q, "estimated"),
      headCount("oyi_conversation_messages", (q) => q, "estimated"),
      headCount(THREADS, (q) => q.gte("updated_at", iso(now - DAY_MS))),
      headCount(THREADS, (q) => q.gte("updated_at", iso(now - 7 * DAY_MS))),
      ...CONVERSATION_SURFACES.map((surface) => headCount(THREADS, (q) => q.eq("surface", surface).gte("updated_at", iso(now - 7 * DAY_MS)))),
    ]);
    const surfaceCounts: Record<string, number> = {};
    CONVERSATION_SURFACES.forEach((surface, i) => { surfaceCounts[surface] = bySurface[i]; });
    return {
      threads_total: threadsTotal,
      messages_total: messagesTotal,
      totals_count_method: "estimated" as const,
      active_threads_24h: active24h,
      active_threads_7d: active7d,
      active_threads_7d_by_surface: surfaceCounts,
    };
  });

  // --- ephemeral context, one bounded count per type ---
  const contextCounts = CONTEXT_TYPE_DESCRIPTORS.map((descriptor) =>
    timed(`context_${descriptor.key}`, async () => {
      if (descriptor.key === "workflow") {
        queryCount += 1;
        return new SupabaseWorkflowRepository().countByStatuses(activeWorkflowStatuses);
      }
      if (descriptor.key === "result_set") {
        // No TTL: count recently active threads that still carry one.
        return headCount(THREADS, (q) => q.gte("updated_at", iso(now - DAY_MS)).not("metadata->>active_domain", "is", null));
      }
      const ttl = descriptor.ttl_ms as number;
      const path = `metadata->${descriptor.metadata_key}`;
      return headCount(THREADS, (q) => {
        const bounded = q.gte("updated_at", iso(now - ttl));
        return descriptor.expiry.kind === "sliding"
          ? bounded.gt(`${path}->>${descriptor.expiry.field}`, iso(now - ttl))
          : bounded.gt(`${path}->>expires_at`, iso(now));
      });
    })
  );

  // --- resident memory (durable) ---
  const residentMemory = timed("resident_memory", async () => {
    const retentionCutoff = iso(now - RESIDENT_CONTEXT_RETENTION_MS);
    const [total, withinRetention, seen24h, seen7d, written24h, written7d, ...byType] = await Promise.all([
      headCount("resident_memory", (q) => q),
      headCount("resident_memory", (q) => q.gte("last_seen_at", retentionCutoff)),
      headCount("resident_memory", (q) => q.gte("last_seen_at", iso(now - DAY_MS))),
      headCount("resident_memory", (q) => q.gte("last_seen_at", iso(now - 7 * DAY_MS))),
      headCount("resident_memory", (q) => q.gte("updated_at", iso(now - DAY_MS))),
      headCount("resident_memory", (q) => q.gte("updated_at", iso(now - 7 * DAY_MS))),
      ...RESIDENT_MEMORY_ADMITTED_TYPES.map((type) => headCount("resident_memory", (q) => q.eq("memory_type", type))),
    ]);
    const admittedByType: Record<string, number> = {};
    RESIDENT_MEMORY_ADMITTED_TYPES.forEach((type, i) => { admittedByType[type] = byType[i]; });
    const admittedTotal = byType.reduce((a, b) => a + b, 0);
    return {
      total_items: total,
      by_admitted_type: admittedByType,
      not_admitted_by_read_path: Math.max(0, total - admittedTotal),
      within_retention: withinRetention,
      beyond_retention: Math.max(0, total - withinRetention),
      age_by_last_seen: {
        within_24h: seen24h,
        within_7d: seen7d - seen24h,
        within_retention_window: withinRetention - seen7d,
        beyond_retention_window: Math.max(0, total - withinRetention),
      },
      written_24h: written24h,
      written_7d: written7d,
    };
  });

  const [continuityResult, residentResult, ...contextResults] = await Promise.all([continuity, residentMemory, ...contextCounts]);

  // Structural visibility classes, derived from the real read-path
  // projection (never restated): what each admitted type becomes.
  const visibilityClasses = RESIDENT_MEMORY_ADMITTED_TYPES.map((type) => {
    const projected = residentMemoryProjection({ id: "structural-probe", user_id: "structural-probe", memory_type: type, last_seen_at: iso(now), memory_value: {} });
    return { memory_type: type, kind: projected?.kind ?? null, audience: projected?.audience ?? null, trust: projected?.trust ?? null, retention: projected?.retention ?? null };
  });

  const contextTypes = CONTEXT_TYPE_DESCRIPTORS.map((descriptor, i) => {
    const result = contextResults[i];
    return {
      key: descriptor.key,
      label: descriptor.label,
      purpose: descriptor.purpose,
      persistence: descriptor.persistence,
      ttl_ms: descriptor.ttl_ms,
      expiry_model: descriptor.expiry_model,
      pending_action: descriptor.pending_action,
      active: result.ok ? { available: true, count: result.value } : { available: false, count: null },
      active_definition:
        descriptor.key === "workflow" ? "Durable workflows in a non-terminal status."
        : descriptor.key === "result_set" ? "Threads active in the last 24h that still hold a result set."
        : "Unexpired instances on recently updated threads.",
    };
  });

  const ttlTypes = contextTypes.filter((t) => t.persistence === "ephemeral_ttl");
  const sumAvailable = (rows: typeof contextTypes) => rows.every((r) => r.active.available) ? rows.reduce((a, r) => a + (r.active.count || 0), 0) : null;
  const sources = {
    conversation_continuity: continuityResult.ok,
    resident_memory: residentResult.ok,
    ...Object.fromEntries(contextTypes.map((t) => [`context_${t.key}`, t.active.available])),
  };
  const slowest = Object.entries(timings).sort((a, b) => b[1] - a[1])[0];

  return {
    complete: Object.values(sources).every(Boolean),
    sources,
    continuity: continuityResult.ok ? { available: true as const, ...continuityResult.value } : { available: false as const },
    context_summary: {
      active_ttl_contexts: sumAvailable(ttlTypes),
      pending_contextual_actions: sumAvailable(contextTypes.filter((t) => t.pending_action)),
    },
    context_types: contextTypes,
    resident_memory: {
      ...(residentResult.ok ? { available: true as const, ...residentResult.value } : { available: false as const }),
      retention_ms: RESIDENT_CONTEXT_RETENTION_MS,
      admitted_types: [...RESIDENT_MEMORY_ADMITTED_TYPES],
      visibility_classes: visibilityClasses,
      read_path: {
        status: "active" as const,
        function_name: "loadResidentMemoryContext",
        description: "Read into governed conversation context for the owning actor only, within the retention window.",
      },
      write_paths: RESIDENT_MEMORY_WRITE_PATHS,
      admission_status: "ungoverned_legacy_writer_only" as const,
    },
    performance: {
      query_count: queryCount,
      source_timings_ms: timings,
      slowest_source: slowest ? { name: slowest[0], ms: slowest[1] } : null,
    },
  };
}
