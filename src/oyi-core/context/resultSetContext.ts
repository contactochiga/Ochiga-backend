import { randomUUID } from "crypto";
import { logger } from "../../observability/logger";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import type { IntelligenceFact } from "../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../interpretation/conversationIntentRouting";

export type ResultSetObjectRef = {
  object_type: string;
  canonical_id: string;
  label: string;
  occurred_at: string | null;
  metric: string | null;
  metric_value: number | null;
  status: string | null;
  // Generic descriptive fields (priority/severity/category/...) pulled from
  // whatever the fact's value actually has — this is what filter continuity
  // ("show only the high priority ones") matches against, without any
  // per-domain field-name knowledge in the resolver itself.
  attributes: Record<string, string>;
};

export type ResultSetContext = {
  version: 1;
  result_set_id: string;
  domain: string;
  capability_key: string | null;
  operation: string | null;
  object_refs: ResultSetObjectRef[];
  timeframe: IntelligenceRequestContract["temporal_scope"] | null;
  filters: Record<string, string>;
  metric: string | null;
  result_count: number;
  selected_object_ref: ResultSetObjectRef | null;
  source_request_id: string;
  source_thread_id: string | null;
  source_message: string;
  created_at: string;
};

// Thread metadata now keeps one result set PER DOMAIN (not a single
// overwritten slot) so a domain switch ("what about my visitors today?")
// doesn't erase the ability to later say "go back to that maintenance
// issue" — see §10 of the closure spec. active_domain is which one a bare
// ordinal/pronoun follow-up (no domain cue) resolves against.
export type ResultSetsByDomain = Record<string, ResultSetContext>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Common numeric fields across domains (amount for wallet/utilities/service
// transactions, unit_cost for tariffs, action_count for scenes/automations,
// balance for wallets) — first one present on a fact's value wins.
const NUMERIC_METRIC_KEYS = ["amount", "unit_cost", "action_count", "balance"];
const STATUS_KEYS = ["status", "last_run_status", "account_status"];
// owner/due_at/overdue added in Phase 4, PR 3 -- generic-sounding
// enough to apply to future office_* list domains (Meetings/Support
// also have an owner and a due-by concept), not Tasks-specific. Purely
// additive: existing domains that never populate these keys are
// unaffected.
const ATTRIBUTE_KEYS = ["status", "priority", "severity", "category", "last_run_status", "account_status", "is_official", "owner", "due_at", "overdue"];

function extractMetric(value: Record<string, unknown>): { metric: string | null; metric_value: number | null } {
  for (const key of NUMERIC_METRIC_KEYS) {
    const raw = value[key];
    if (raw !== undefined && raw !== null && raw !== "" && Number.isFinite(Number(raw))) {
      return { metric: key, metric_value: Number(raw) };
    }
  }
  return { metric: null, metric_value: null };
}

function extractStatus(value: Record<string, unknown>): string | null {
  for (const key of STATUS_KEYS) {
    const raw = value[key];
    if (raw !== undefined && raw !== null) {
      const cleaned = text(raw).toLowerCase();
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function extractAttributes(value: Record<string, unknown>): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const key of ATTRIBUTE_KEYS) {
    const raw = value[key];
    if (raw === undefined || raw === null || raw === "") continue;
    attributes[key] = text(raw).toLowerCase();
  }
  return attributes;
}

export function objectRefFromFact(fact: IntelligenceFact): ResultSetObjectRef | null {
  if (!fact.object || !fact.object.canonical_id) return null;
  const value = recordOf(fact.value);
  const { metric, metric_value } = extractMetric(value);
  return {
    object_type: fact.object.object_type,
    canonical_id: fact.object.canonical_id,
    label: fact.object.label || fact.object.object_type,
    occurred_at: fact.occurred_at || fact.observed_at || null,
    metric,
    metric_value,
    status: extractStatus(value),
    attributes: extractAttributes(value),
  };
}

// Builds the generic result-set context from whatever facts a turn actually
// answered with, preserving the order the loader presented them in (that
// order IS the "first"/"second" ordinal semantics — see §33 of the
// programme spec: ordinal must never fall back to undefined DB row order,
// and every evidence loader in this codebase already applies an explicit
// .order() clause, so presentation order is deterministic by construction).
export function buildResultSetContext(input: {
  domain: string | null;
  capabilityKey: string | null;
  operation: string | null;
  facts: IntelligenceFact[];
  contract: Pick<IntelligenceRequestContract, "conversation_request_id" | "thread_id" | "temporal_scope">;
  message: string;
}): ResultSetContext | null {
  const usable = input.facts.filter((fact) => fact.truth_state !== "unavailable");
  const object_refs = usable.map(objectRefFromFact).filter((ref): ref is ResultSetObjectRef => Boolean(ref));
  if (!object_refs.length) return null;
  const domain = input.domain || usable[0]?.domain || "unknown";
  let metric: string | null = null;
  for (const ref of object_refs) {
    if (ref.metric) { metric = ref.metric; break; }
  }
  return {
    version: 1,
    result_set_id: randomUUID(),
    domain,
    capability_key: input.capabilityKey,
    operation: input.operation,
    object_refs,
    timeframe: input.contract.temporal_scope ? { ...input.contract.temporal_scope } : null,
    filters: {},
    metric,
    result_count: object_refs.length,
    selected_object_ref: object_refs.length === 1 ? object_refs[0] : null,
    source_request_id: input.contract.conversation_request_id,
    source_thread_id: input.contract.thread_id || null,
    source_message: input.message,
    created_at: new Date().toISOString(),
  };
}

// A follow-up that narrows a result set down to exactly one object
// (ordinal/attribute/pronoun resolution) re-persists a 1-item context with
// selected_object_ref set, so the NEXT follow-up ("why is it still open?"
// right after "which one is oldest?") continues to resolve without needing
// the user to re-specify anything.
export function narrowedResultSetContext(previous: ResultSetContext, selected: ResultSetObjectRef, input: { contract: Pick<IntelligenceRequestContract, "conversation_request_id" | "thread_id" | "temporal_scope">; message: string }): ResultSetContext {
  return {
    ...previous,
    result_set_id: randomUUID(),
    object_refs: [selected],
    result_count: 1,
    selected_object_ref: selected,
    source_request_id: input.contract.conversation_request_id,
    source_thread_id: input.contract.thread_id || null,
    source_message: input.message,
    created_at: new Date().toISOString(),
  };
}

// A filter follow-up ("show only the high priority ones") narrows the SAME
// previously-presented list to the subset matching an attribute keyword —
// unlike narrowedResultSetContext, this may keep more than one object.
// filters accumulate (previous constraints are preserved, see §11).
export function filteredResultSetContext(previous: ResultSetContext, matched: ResultSetObjectRef[], filterKey: string, filterValue: string, input: { contract: Pick<IntelligenceRequestContract, "conversation_request_id" | "thread_id" | "temporal_scope">; message: string }): ResultSetContext {
  return {
    ...previous,
    result_set_id: randomUUID(),
    object_refs: matched,
    result_count: matched.length,
    selected_object_ref: matched.length === 1 ? matched[0] : null,
    filters: { ...previous.filters, [filterKey]: filterValue },
    source_request_id: input.contract.conversation_request_id,
    source_thread_id: input.contract.thread_id || null,
    source_message: input.message,
    created_at: new Date().toISOString(),
  };
}

function parseResultSetsByDomain(metadata: Record<string, unknown>): { resultSets: ResultSetsByDomain; activeDomain: string | null } {
  const stored = metadata.result_sets;
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    const resultSets = stored as ResultSetsByDomain;
    const activeDomain = text(metadata.active_domain) || null;
    return { resultSets, activeDomain: activeDomain && resultSets[activeDomain] ? activeDomain : null };
  }
  // Legacy shape from the prior Programme 1 pass: a single overwritten
  // last_result_set with no per-domain map. Read-compatible, never written
  // again once this pass's persistence runs.
  const legacy = metadata.last_result_set;
  if (legacy && typeof legacy === "object") {
    const parsed = legacy as ResultSetContext;
    if (Array.isArray(parsed.object_refs) && parsed.object_refs.length && parsed.domain) {
      return { resultSets: { [parsed.domain]: parsed }, activeDomain: parsed.domain };
    }
  }
  return { resultSets: {}, activeDomain: null };
}

export async function loadThreadResultSetsContext(threadId: string | null | undefined): Promise<{ resultSets: ResultSetsByDomain; activeDomain: string | null }> {
  if (!threadId) return { resultSets: {}, activeDomain: null };
  try {
    const { data, error } = await supabaseAdmin
      .from("oyi_conversation_threads")
      .select("metadata")
      .eq("id", threadId)
      .maybeSingle();
    if (error) throw error;
    return parseResultSetsByDomain(recordOf(data?.metadata));
  } catch (error) {
    logger.warn("oyi_result_set_context_load_failed", { thread_id: threadId, error });
    return { resultSets: {}, activeDomain: null };
  }
}

// Convenience for the common case: the currently active domain's result
// set, or null if there isn't one.
export async function loadThreadResultSetContext(threadId: string | null | undefined): Promise<ResultSetContext | null> {
  const { resultSets, activeDomain } = await loadThreadResultSetsContext(threadId);
  return activeDomain ? resultSets[activeDomain] || null : null;
}
