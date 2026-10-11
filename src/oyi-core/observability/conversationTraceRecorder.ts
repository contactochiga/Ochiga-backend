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
  const code = error && typeof error === "object" ? (error as any).code : null;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : "trace_write_failed";
}

function reportFailure(stage: "projection" | "insert", error: unknown) {
  writeHealth = { status: "failed", code: safeCode(error) };
  operationalMetrics.increment("oyi_conversation_trace_write_total", { outcome: "failed", stage });
  const now = Date.now();
  if (now - lastFailureLogAt >= FAILURE_LOG_INTERVAL_MS) {
    logger.warn("oyi_conversation_trace_write_failed", { stage, error_code: safeCode(error), suppressed_since_last: suppressedFailures });
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
  const { error } = await supabaseAdmin.from(CONVERSATION_TRACE_TABLE)
    .upsert(record as any, { onConflict: "trace_id", ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(2000));
  if (error) throw error;
};
let insertImpl: TraceInsert = defaultInsert;
export function __setConversationTraceInsertForTests(fn: TraceInsert | null) {
  insertImpl = fn || defaultInsert;
}

export type TraceRecordOutcome = { attempted: boolean; trace_id: string | null; status: "pending" | "saved" | "failed" | "disabled" | "unconfigured"; error_code?: string };

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
  const receipt: TraceRecordOutcome = { attempted: true, trace_id: record.trace_id, status: "pending" };
  const insert = insertImpl;
  const write = (async () => {
    try {
      // Only the default idempotent transport retries, never a custom adapter.
      for (let attempt = 0; ; attempt++) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([insert(record), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject({ code: "trace_timeout" }), 2200);
          })]);
          break;
        } catch (error) {
          const code = safeCode(error);
          if (attempt || insert !== defaultInsert || !["trace_timeout", "trace_write_failed", "UND_ERR_SOCKET", "ECONNRESET", "08006", "57014", "20", "23"].includes(code)) throw error;
        } finally { if (timer) clearTimeout(timer); }
      }
      receipt.status = "saved";
      writeHealth = { status: "saved", code: null };
      operationalMetrics.increment("oyi_conversation_trace_write_total", { outcome: "saved", stage: "insert" });
      operationalMetrics.observe("oyi_conversation_trace_write_ms", Date.now() - startedAt, {});
    } catch (error) {
      receipt.status = "failed";
      receipt.error_code = safeCode(error);
      reportFailure("insert", error);
    }
  })();
  inFlight.add(write);
  void write.finally(() => inFlight.delete(write));
  return receipt;
}

// Await every in-flight trace write (tests and graceful shutdown only).
export async function flushConversationTraceWrites(): Promise<void> {
  while (inFlight.size) await Promise.allSettled(Array.from(inFlight));
}
