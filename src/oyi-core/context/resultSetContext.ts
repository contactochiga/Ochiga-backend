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
};

export type ResultSetContext = {
  version: 1;
  domain: string;
  capability_key: string | null;
  operation: string | null;
  object_refs: ResultSetObjectRef[];
  timeframe: IntelligenceRequestContract["temporal_scope"] | null;
  filters: Record<string, unknown>;
  metric: string | null;
  result_count: number;
  selected_object_ref: ResultSetObjectRef | null;
  source_request_id: string;
  source_thread_id: string | null;
  source_message: string;
  created_at: string;
};

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
  };
}

// Builds the generic result-set context from whatever facts a turn actually
// answered with, preserving the order the loader presented them in (that
// order IS the "first"/"second" ordinal semantics — see §19 of the
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
    object_refs: [selected],
    result_count: 1,
    selected_object_ref: selected,
    source_request_id: input.contract.conversation_request_id,
    source_thread_id: input.contract.thread_id || null,
    source_message: input.message,
    created_at: new Date().toISOString(),
  };
}

export async function loadThreadResultSetContext(threadId: string | null | undefined): Promise<ResultSetContext | null> {
  if (!threadId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("oyi_conversation_threads")
      .select("metadata")
      .eq("id", threadId)
      .maybeSingle();
    if (error) throw error;
    const metadata = recordOf(data?.metadata);
    const resultSet = metadata.last_result_set;
    if (!resultSet || typeof resultSet !== "object") return null;
    const parsed = resultSet as ResultSetContext;
    if (!Array.isArray(parsed.object_refs) || !parsed.object_refs.length) return null;
    return parsed;
  } catch (error) {
    logger.warn("oyi_result_set_context_load_failed", { thread_id: threadId, error });
    return null;
  }
}
