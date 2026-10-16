// Service-only certification/diagnostic reader of the existing canonical stores.
// Never persists, replays a turn, repairs evidence, or selects by answer text.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { traceFailureClass, type TraceRecordOutcome } from "./conversationTraceRecorder";

export type CertificationAttempt = {
  attempt_id: string; request_id: string; thread_id: string | null;
  turn_ref: string | null; thread_ref: string | null; surface: string;
  outcome: "returned" | "ownership_rejected" | "exception";
  expected_persistence: "pair" | "none"; response_saved: boolean | null;
  trace_id: string | null; receipt: TraceRecordOutcome | null;
  duplicate_reported?: boolean;
};

export async function reconcileConversationAttempts(attempts: CertificationAttempt[], options: { timeoutMs?: number; pollMs?: number; client?: typeof supabaseAdmin } = {}) {
  if (!attempts.length || attempts.length > 2000 || new Set(attempts.map(a => a.attempt_id)).size !== attempts.length) throw new Error("invalid_attempt_manifest");
  const db = options.client || supabaseAdmin, started = Date.now();
  const deadline = started + Math.max(50, Math.min(options.timeoutMs ?? 6000, 15000));
  const duplicateCounts = new Map<string, number>();
  for (const a of attempts) duplicateCounts.set(a.request_id, (duplicateCounts.get(a.request_id) || 0) + 1);
  async function inspect(a: CertificationAttempt) {
    const base = { ...a, receipt: a.receipt ? { ...a.receipt } : null, deliveries: duplicateCounts.get(a.request_id)!, message_ids: [] as string[], message_count: 0,
      trace_present: false, trace_verified: false, persistence_verified: false, classification: "missing_correlation", lookup_error: null as string | null,
      lookup_attempts: 0, lookup_failures: 0, last_lookup_error: null as string | null, last_completed_lookup_ms: null as number | null };
    if (!a.request_id || !a.trace_id || !a.turn_ref) return base;
    if ((a.outcome === "ownership_rejected") !== (a.expected_persistence === "none")) return { ...base, classification: "invalid_persistence_expectation" };
    if (attempts.filter(other => other.trace_id === a.trace_id).length > 1) return { ...base, classification: "duplicate_trace_identity" };
    if (Date.now() >= deadline) return { ...base, classification: "reconciliation_deadline" };
    base.lookup_attempts = 1;
    const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
    try {
      // Use the indexed canonical thread whenever present. Request identity
      // still filters the exact pair; no scan by text or latest-N selection.
      let messages = db.from("oyi_conversation_messages").select("id,thread_id,role,metadata").eq("metadata->>trace_request_id", a.request_id);
      if (a.thread_id) messages = messages.eq("thread_id", a.thread_id);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const [t, m] = await Promise.race([Promise.all([
        db.from("oyi_conversation_traces").select("trace_id,turn_ref,thread_ref,surface,persistence_saved,authority_result,terminal_outcome").eq("trace_id", a.trace_id).abortSignal(signal).maybeSingle(),
        messages.limit(5).abortSignal(signal),
      ]), new Promise<never>((_, reject) => { timer = setTimeout(() => reject({ code: "trace_timeout" }), Math.max(1, deadline - Date.now())); })]).finally(() => { if (timer) clearTimeout(timer); });
      // The client can flatten AbortError/TimeoutError into an unclassified
      // response object. Use our actual deadline signal, never message text.
      if (t.error || m.error) return { ...base, classification: "lookup_unavailable", lookup_error: signal.aborted ? "timeout" : traceFailureClass(t.error || m.error) };
      base.last_completed_lookup_ms = Date.now() - started;
      const rows = m.data || [], trace = t.data;
      base.message_ids = rows.map(r => r.id); base.message_count = rows.length; base.trace_present = Boolean(trace);
      const pair = rows.length === 2 && rows.every(r => r.thread_id === a.thread_id) && rows.map(r => r.role).sort().join(",") === "assistant,user";
      base.persistence_verified = a.expected_persistence === "none" ? rows.length === 0 : pair;
      if (trace && (trace.turn_ref !== a.turn_ref || trace.thread_ref !== a.thread_ref || trace.surface !== a.surface
        || (a.outcome === "ownership_rejected" && (trace.authority_result !== "denied" || trace.terminal_outcome !== "authority_denied" || trace.persistence_saved !== false)))) {
        return { ...base, classification: "trace_contract_mismatch" };
      }
      base.trace_verified = Boolean(trace);
      if (!base.persistence_verified) return { ...base, classification: rows.length === 0 ? "missing_expected_save" : "unexpected_message_set" };
      if (!trace) return { ...base, classification: ["timed_out", "uncertain", "pending"].includes(a.receipt?.delivery_state || "") ? "uncertain_trace_delivery" : "missing_trace" };
      if (a.outcome === "ownership_rejected") return { ...base, classification: "rejected_correlated" };
      if (a.outcome === "exception") return { ...base, classification: "exception_correlated_review_required" };
      if (a.response_saved !== true || trace.persistence_saved !== true) return { ...base, classification: "save_unconfirmed_durable_pair" };
      return { ...base, classification: a.receipt?.delivery_state === "saved_verified" ? "saved_correlated" : "durable_trace_recovered" };
    } catch (error) { return { ...base, classification: "lookup_unavailable", lookup_error: signal.aborted ? "timeout" : traceFailureClass(error) }; }
  }
  const rows = new Map<string, Awaited<ReturnType<typeof inspect>>>();
  let pending = [...attempts];
  do {
    // Bounded concurrency, deterministic manifest order. Each request has the
    // same overall deadline; no N-times-deadline serial loop.
    for (let i = 0; i < pending.length; i += 8) {
      const batch = await Promise.all(pending.slice(i, i + 8).map(inspect));
      for (const row of batch) {
        const previous = rows.get(row.attempt_id);
        if (row.classification === "reconciliation_deadline" && previous) continue;
        row.lookup_attempts += previous?.lookup_attempts || 0;
        row.lookup_failures = (previous?.lookup_failures || 0) + (row.lookup_error ? 1 : 0);
        row.last_lookup_error = row.lookup_error || previous?.last_lookup_error || null;
        // A failed re-poll is not new absence evidence and must not erase a
        // completed negative lookup. These classifications remain fail-closed.
        // Retain its observation time and expose the latest lookup failure.
        if (row.classification === "lookup_unavailable" && previous?.last_completed_lookup_ms !== null && previous?.last_completed_lookup_ms !== undefined
          && ["missing_trace", "uncertain_trace_delivery", "missing_expected_save"].includes(previous.classification)) {
          rows.set(row.attempt_id, { ...previous, lookup_error: row.lookup_error, last_lookup_error: row.last_lookup_error,
            lookup_attempts: row.lookup_attempts, lookup_failures: row.lookup_failures });
        } else rows.set(row.attempt_id, row);
      }
    }
    pending = attempts.filter(a => ["missing_trace", "uncertain_trace_delivery", "missing_expected_save", "lookup_unavailable"].includes(rows.get(a.attempt_id)?.classification || ""));
    if (pending.length && Date.now() < deadline) await new Promise(r => setTimeout(r, Math.min(options.pollMs ?? 50, Math.max(1, deadline - Date.now()))));
  } while (pending.length && Date.now() < deadline);
  const records = attempts.map(a => rows.get(a.attempt_id)!);
  return { attempted: attempts.length, elapsed_ms: Date.now() - started,
    ready: records.every(r => ["saved_correlated", "rejected_correlated", "durable_trace_recovered"].includes(r.classification)),
    persisted_pairs: records.filter(r => r.expected_persistence === "pair" && r.persistence_verified).length,
    traces_verified: records.filter(r => r.trace_verified).length, records };
}

// Required booleans must be measured by the protected runner, not inferred from
// a schema canary alone. Missing fields fail closed. No schema or policy changes.
export const CERTIFICATION_PREFLIGHT_GATES = ["runtime_hash", "fixture_hash", "schema_rpc", "effective_authority", "ordinary_correlation", "rejection_correlation", "multipart_persistence", "failure_injection", "provider_off", "execution_isolated"] as const;
export function certificationPreflightDecision(gates: Partial<Record<typeof CERTIFICATION_PREFLIGHT_GATES[number], boolean>>) {
  const failed = CERTIFICATION_PREFLIGHT_GATES.filter(k => gates[k] !== true);
  return { ready: failed.length === 0, failed };
}
