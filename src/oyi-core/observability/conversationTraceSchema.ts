import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { projectConversationTrace, TRACE_FIELD_CLASSIFICATION } from "./conversationTraceProjection";

export const TRACE_COLUMNS = Object.keys(TRACE_FIELD_CLASSIFICATION).join(",");
export type TracePreflightStatus = "compatible" | "missing_migration" | "database_unavailable" | "permission_denied" | "contract_mismatch";
export type TracePreflight = { status: TracePreflightStatus; stage: string; code: string | null; elapsed_ms: number };
let last: TracePreflight | null = null;
export const traceSchemaHealth = () => last;
export function classifyTraceSchemaError(error: any): TracePreflightStatus {
  const code = String(error?.code || error?.cause?.code || "");
  if (["42703", "42P01", "PGRST204", "PGRST205", "PGRST202"].includes(code)) return "missing_migration";
  if (["42501", "PGRST301", "PGRST302", "401", "403"].includes(code)) return "permission_denied";
  if (/^(?:08|53|57|UND_|ECONN|ETIMEDOUT)/.test(code) || !code || ["20", "23"].includes(code) || ["AbortError", "TimeoutError"].includes(error?.name)) return "database_unavailable";
  return "contract_mismatch";
}

// Bounded synthetic write/read/delete canary, containing no conversation data.
// Service-only privileges are required. Certification calls this before corpus
// execution; startup readiness uses the same contract. Never changes schema.
export async function preflightConversationTrace(options: { timeoutMs?: number; client?: typeof supabaseAdmin } = {}): Promise<TracePreflight> {
  const db = options.client || supabaseAdmin;
  const timeout = Math.max(100, Math.min(options.timeoutMs || 3000, 10000));
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const id = randomUUID();
  let stage = "schema_read", inserted = false;
  try {
    const schema = await db.from("oyi_conversation_traces").select(TRACE_COLUMNS).limit(0).abortSignal(controller.signal);
    if (schema.error) throw schema.error;
    stage = "writer_canary";
    const row = projectConversationTrace({ events: [], startedAt: started, completedAt: started, requestId: null,
      threadId: null, surface: "consumer", actor: null, response: null, error: null });
    row.trace_id = id;
    // Never appear as a real conversation in dashboards, even if cleanup is
    // interrupted. Readers already exclude expired rows; retention can reap it.
    row.expires_at = new Date(started - 1).toISOString();
    row.planner_admitted = false;
    row.planner_admission_reason = "no_applicable_evidence_class";
    const write = await db.from("oyi_conversation_traces").insert(row).abortSignal(controller.signal);
    if (write.error) throw write.error;
    inserted = true;
    stage = "reader_canary";
    const read = await db.from("oyi_conversation_traces").select(TRACE_COLUMNS).eq("trace_id", id).abortSignal(controller.signal).single();
    if (read.error) throw read.error;
    if (!read.data || (read.data as any).planner_admission_reason !== row.planner_admission_reason
      || (read.data as any).trace_id !== id) throw { code: "reader_contract_mismatch" };
    stage = "persistence_contract";
    // Invalid inputs must be rejected before writes. This proves the required
    // RPC migration and service-only execute privilege, not just trace columns.
    const saveProbe = await db.rpc("oyi_persist_canonical_turn", { p_thread: {}, p_user: {}, p_assistant: {}, p_request_id: null }).abortSignal(controller.signal);
    if (saveProbe.error?.code !== "22023") throw saveProbe.error || { code: "persistence_contract_mismatch" };
    const collapseProbe = await db.rpc("oyi_collapse_canonical_exchange", { p_thread_id: id, p_request_ids: [], p_original: "", p_answer: "", p_keep_last: false }).abortSignal(controller.signal);
    if (collapseProbe.error?.code !== "22023") throw collapseProbe.error || { code: "collapse_contract_mismatch" };
    stage = "cleanup_canary";
    const cleanup = await db.from("oyi_conversation_traces").delete().eq("trace_id", id).abortSignal(controller.signal);
    if (cleanup.error) throw cleanup.error;
    inserted = false;
    return last = { status: "compatible", stage: "complete", code: null, elapsed_ms: Date.now() - started };
  } catch (error: any) {
    const code = /^[A-Za-z0-9_]{1,40}$/.test(String(error?.code || "")) ? error.code : "unavailable";
    return last = { status: classifyTraceSchemaError(error), stage, code, elapsed_ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    if (inserted) {
      // Independent bounded cleanup after an aborted canary; retention remains
      // the fallback if the database is unavailable. Never delete other rows.
      await db.from("oyi_conversation_traces").delete().eq("trace_id", id).abortSignal(AbortSignal.timeout(500)).then(() => undefined, () => undefined);
    }
  }
}
