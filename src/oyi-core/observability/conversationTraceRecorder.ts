// Intelligence System Visibility, Slice 7 -- the ONE durable trace writer.
//
// Called exactly once per ConversationOrchestrator.run() invocation by the
// orchestrator's finalization boundary (never from individual return
// paths). Trace persistence is operational observability, not
// conversation persistence:
//   - it starts AFTER the canonical response (and its own persistence)
//     is complete, and is never awaited by the conversation path;
//   - it can never throw into the caller (projection + insert are both
//     guarded);
//   - a failure is observable (metric + throttled structured warning) and
//     the trace is never reported as saved when it was not.
// Ordering/reliability: asynchronous bounded delivery, idempotent retry of
// the same row. A returned receipt is pending, never a durability promise.
// Each row is
// self-contained (own started_at), so no ordering between rows is assumed.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import { operationalMetrics } from "../../observability/metrics";
import { projectConversationTrace, traceReferenceKeyConfigured, TRACE_REFERENCE_KEY_MIN_LENGTH, type ConversationTraceRecord, type TraceProjectionInput } from "./conversationTraceProjection";

export const CONVERSATION_TRACE_TABLE = "oyi_conversation_traces";

export function conversationTraceEnabled(): boolean {
  return String(process.env.OYI_CONVERSATION_TRACE_ENABLED ?? "true").toLowerCase() !== "false";
}

// Recording status: "active" (enabled + reference key configured),
// "disabled" (explicit kill switch), "unconfigured" (no usable
// OYI_TRACE_REFERENCE_KEY -- traces are not persisted; conversations are
// entirely unaffected).
export type TraceRecordingStatus = "active" | "disabled" | "unconfigured";
export function conversationTraceRecordingStatus(): TraceRecordingStatus {
  if (!conversationTraceEnabled()) return "disabled";
  return traceReferenceKeyConfigured() ? "active" : "unconfigured";
}

const UNCONFIGURED_LOG_INTERVAL_MS = 10 * 60_000;
let lastUnconfiguredLogAt = 0;

const inFlight = new Set<Promise<void>>();
const FAILURE_LOG_INTERVAL_MS = 60_000;
let lastFailureLogAt = 0;
let suppressedFailures = 0;
let writeHealth: { status: "unknown" | "saved" | "failed"; code: string | null } = { status: "unknown", code: null };
export const conversationTraceWriteHealth = () => ({ ...writeHealth });

function safeCode(error: unknown): string {
  const e = error as any, code = String(e?.code || e?.cause?.code || "");
  return /^(?:[0-9]{2}[A-Z0-9]{3}|PGRST[0-9]{3})$/.test(code) || ["UND_ERR_SOCKET", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "trace_timeout", "trace_verification_mismatch"].includes(code) ? code
    : ["AbortError", "TimeoutError"].includes(e?.name) ? "trace_timeout" : "trace_write_failed";
}

export function traceFailureClass(error: unknown): string {
  const code = safeCode(error);
  if (["42703", "42P01", "PGRST204", "PGRST205", "PGRST202"].includes(code)) return "schema";
  if (["42501", "PGRST301", "PGRST302"].includes(code)) return "permission";
  if (["trace_timeout", "ETIMEDOUT", "57014"].includes(code)) return "timeout";
  if (/^(?:UND_|ECONN)/.test(code)) return "transport";
  if (/^(?:08|53|57)/.test(code)) return "database_unavailable";
  if (code === "trace_verification_mismatch") return "verification_mismatch";
  if (/^[0-9]{2}[A-Z0-9]{3}$/.test(code)) return "database_rejection";
  return "unknown";
}

function reportFailure(stage: "projection" | "insert" | "verify", error: unknown, traceId?: string) {
  writeHealth = { status: "failed", code: safeCode(error) };
  operationalMetrics.increment("oyi_conversation_trace_write_total", { outcome: "failed", stage });
  const now = Date.now();
  if (now - lastFailureLogAt >= FAILURE_LOG_INTERVAL_MS) {
    logger.warn("oyi_conversation_trace_write_failed", { stage, error_code: safeCode(error), failure_class: traceFailureClass(error), trace_id: traceId || null, suppressed_since_last: suppressedFailures });
    lastFailureLogAt = now;
    suppressedFailures = 0;
  } else {
    suppressedFailures += 1;
  }
}

// Test seam: the insert implementation (defaults to Supabase).
type TraceInsert = (record: ConversationTraceRecord) => Promise<void>;
const defaultInsert: TraceInsert = async (record) => {
  // Retry of an ambiguous delivery uses this same UUID; append-only DO NOTHING
  // cannot overwrite an already recorded trace or duplicate it.
  const signal = AbortSignal.timeout(2000);
  const { error } = await supabaseAdmin.from(CONVERSATION_TRACE_TABLE)
    .upsert(record as any, { onConflict: "trace_id", ignoreDuplicates: true }).abortSignal(signal);
  if (error) throw signal.aborted ? { code: "trace_timeout" } : error;
};
let insertImpl: TraceInsert = defaultInsert;
export function __setConversationTraceInsertForTests(fn: TraceInsert | null) {
  insertImpl = fn || defaultInsert;
}

export type TraceRecordOutcome = { attempted: boolean; trace_id: string | null; status: "pending" | "saved" | "failed" | "disabled" | "unconfigured"; error_code?: string;
  delivery_state?: "pending" | "saved_verified" | "failed" | "timed_out" | "uncertain";
  failure_class?: string; stage?: "insert" | "verify"; attempts?: number; turn_ref?: string | null };

// Private in-process correlation for callers handling exceptions. Never mutate
// an authorization error, serialize its payload or persist rejected content.
const rejectedReceipts = new WeakMap<object, { request_id: string; receipt: TraceRecordOutcome }>();
export function retainExceptionTrace(error: unknown, requestId: string, receipt: TraceRecordOutcome) {
  if (error && typeof error === "object") rejectedReceipts.set(error, { request_id: requestId, receipt });
}
export function exceptionTraceCorrelation(error: unknown) {
  return error && typeof error === "object" ? rejectedReceipts.get(error) ?? null : null;
}

async function verifyRecord(record: ConversationTraceRecord) {
  const signal = AbortSignal.timeout(2000);
  const { data, error } = await supabaseAdmin.from(CONVERSATION_TRACE_TABLE)
    .select("trace_id,turn_ref,thread_ref,persistence_saved,authority_result,terminal_outcome,response_status")
    .eq("trace_id", record.trace_id).abortSignal(signal).maybeSingle();
  if (error) throw signal.aborted ? { code: "trace_timeout" } : error;
  if (!data || Object.keys(data).some(k => (data as any)[k] !== (record as any)[k])) throw { code: "trace_verification_mismatch" };
}

// Synchronous, non-throwing entry point. Returns immediately; the write
// continues in the background.
export function recordConversationTrace(input: TraceProjectionInput): TraceRecordOutcome {
  const status = conversationTraceRecordingStatus();
  if (status === "disabled") {
    operationalMetrics.increment("oyi_conversation_trace_write_total", { outcome: "disabled", stage: "config" });
    return { attempted: false, trace_id: null, status: "disabled" };
  }
  if (status === "unconfigured") {
    operationalMetrics.increment("oyi_conversation_trace_write_total", { outcome: "unconfigured", stage: "config" });
    const now = Date.now();
    if (now - lastUnconfiguredLogAt >= UNCONFIGURED_LOG_INTERVAL_MS) {
      // Never logs the key (or any part of it) -- only that it is unusable.
      logger.warn("oyi_conversation_trace_unconfigured", { reason: "OYI_TRACE_REFERENCE_KEY missing or too short", min_length: TRACE_REFERENCE_KEY_MIN_LENGTH });
      lastUnconfiguredLogAt = now;
    }
    return { attempted: false, trace_id: null, status: "unconfigured" };
  }
  let record: ConversationTraceRecord;
  try {
    record = projectConversationTrace(input);
  } catch (error) {
    reportFailure("projection", error);
    return { attempted: false, trace_id: null, status: "failed", error_code: "projection_failed" };
  }
  const startedAt = Date.now();
  const receipt: TraceRecordOutcome = { attempted: true, trace_id: record.trace_id, status: "pending", delivery_state: "pending", turn_ref: record.turn_ref, attempts: 0 };
  const insert = insertImpl;
  const write = (async () => {
    try {
      // Only the default idempotent transport retries, never a custom adapter.
      for (let attempt = 0; ; attempt++) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          receipt.attempts = attempt + 1;
          receipt.stage = "insert";
          // The stage variable is local: late callbacks cannot mutate a receipt.
          let stage: "insert" | "verify" = "insert";
          await Promise.race([(async () => { await insert(record); stage = "verify"; await verifyRecord(record); })(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject({ code: "trace_timeout" }), 2200);
          })]).catch(error => { receipt.stage = stage; throw error; });
          receipt.stage = "verify";
          break;
        } catch (error) {
          const code = safeCode(error);
          if (attempt || insert !== defaultInsert || !["trace_timeout", "trace_write_failed", "UND_ERR_SOCKET", "ECONNRESET", "08006", "57014", "20", "23"].includes(code)) throw error;
        } finally { if (timer) clearTimeout(timer); }
      }
      receipt.status = "saved";
      receipt.delivery_state = "saved_verified";
      writeHealth = { status: "saved", code: null };
      operationalMetrics.increment("oyi_conversation_trace_write_total", { outcome: "saved", stage: "insert" });
      operationalMetrics.observe("oyi_conversation_trace_write_ms", Date.now() - startedAt, {});
    } catch (error) {
      receipt.status = "failed";
      receipt.error_code = safeCode(error);
      receipt.failure_class = traceFailureClass(error);
      receipt.delivery_state = receipt.failure_class === "timeout" ? "timed_out"
        : receipt.stage === "verify" || ["transport", "unknown"].includes(receipt.failure_class) ? "uncertain" : "failed";
      reportFailure(receipt.stage || "insert", error, record.trace_id);
    }
  })();
  inFlight.add(write);
  void write.finally(() => inFlight.delete(write));
  return receipt;
}

// Await every in-flight trace write (tests and graceful shutdown only).
export async function flushConversationTraceWrites(timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + Math.max(1, Math.min(timeoutMs, 10000));
  while (inFlight.size && Date.now() < deadline) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled(Array.from(inFlight)), new Promise(resolve => { timer = setTimeout(resolve, deadline - Date.now()); })]);
    if (timer) clearTimeout(timer);
  }
  return inFlight.size === 0;
}
