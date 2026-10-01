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
// Ordering/reliability: best-effort, at-most-once per turn. Each row is
// self-contained (own started_at), so no ordering between rows is assumed.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import { operationalMetrics } from "../../observability/metrics";
import { projectConversationTrace, type ConversationTraceRecord, type TraceProjectionInput } from "./conversationTraceProjection";

export const CONVERSATION_TRACE_TABLE = "oyi_conversation_traces";

export function conversationTraceEnabled(): boolean {
  return String(process.env.OYI_CONVERSATION_TRACE_ENABLED ?? "true").toLowerCase() !== "false";
}

const inFlight = new Set<Promise<void>>();
const FAILURE_LOG_INTERVAL_MS = 60_000;
let lastFailureLogAt = 0;
let suppressedFailures = 0;

function safeCode(error: unknown): string {
  const code = error && typeof error === "object" ? (error as any).code : null;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : "trace_write_failed";
}

function reportFailure(stage: "projection" | "insert", error: unknown) {
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
  const { error } = await supabaseAdmin.from(CONVERSATION_TRACE_TABLE).insert(record as any);
  if (error) throw error;
};
let insertImpl: TraceInsert = defaultInsert;
export function __setConversationTraceInsertForTests(fn: TraceInsert | null) {
  insertImpl = fn || defaultInsert;
}

export type TraceRecordOutcome = { attempted: boolean; trace_id: string | null };

// Synchronous, non-throwing entry point. Returns immediately; the write
// continues in the background.
export function recordConversationTrace(input: TraceProjectionInput): TraceRecordOutcome {
  if (!conversationTraceEnabled()) {
    operationalMetrics.increment("oyi_conversation_trace_write_total", { outcome: "disabled", stage: "config" });
    return { attempted: false, trace_id: null };
  }
  let record: ConversationTraceRecord;
  try {
    record = projectConversationTrace(input);
  } catch (error) {
    reportFailure("projection", error);
    return { attempted: false, trace_id: null };
  }
  const startedAt = Date.now();
  const write = (async () => {
    try {
      await insertImpl(record);
      operationalMetrics.increment("oyi_conversation_trace_write_total", { outcome: "saved", stage: "insert" });
      operationalMetrics.observe("oyi_conversation_trace_write_ms", Date.now() - startedAt, {});
    } catch (error) {
      reportFailure("insert", error);
    }
  })();
  inFlight.add(write);
  void write.finally(() => inFlight.delete(write));
  return { attempted: true, trace_id: record.trace_id };
}

// Await every in-flight trace write (tests and graceful shutdown only).
export async function flushConversationTraceWrites(): Promise<void> {
  while (inFlight.size) await Promise.allSettled(Array.from(inFlight));
}
