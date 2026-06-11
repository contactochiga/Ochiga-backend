import { supabaseAdmin } from "../supabase/supabaseClient";
import type { AuthUser } from "../middleware/auth";
import type { IntelligenceAgentId, IntelligenceSurface } from "./types";

export type AgentObservationInput = {
  agent_id: IntelligenceAgentId | string;
  action: string;
  tool?: string | null;
  surface?: IntelligenceSurface | string | null;
  actor?: AuthUser | null;
  success: boolean;
  failure_reason?: string | null;
  latency_ms?: number | null;
  metadata?: Record<string, unknown>;
};

function isMissingObservabilityTable(error: any) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("ochiga_agent_observability") && (msg.includes("does not exist") || msg.includes("could not find") || msg.includes("relation"));
}

export async function recordAgentObservation(input: AgentObservationInput) {
  const row = {
    agent_id: String(input.agent_id || "unknown"),
    action: String(input.action || "unknown"),
    tool: input.tool || null,
    surface: input.surface || null,
    actor_id: input.actor?.id || null,
    estate_id: input.actor?.estate_id || null,
    home_id: input.actor?.home_id || null,
    success: input.success,
    failure_reason: input.failure_reason || null,
    latency_ms: input.latency_ms ?? null,
    metadata: input.metadata || {},
  };

  const { error } = await supabaseAdmin.from("ochiga_agent_observability").insert(row as any);
  if (error) {
    if (isMissingObservabilityTable(error)) return { ok: false, skipped: true, reason: "observability_table_missing" };
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

export async function observeAgentAction<T>(input: Omit<AgentObservationInput, "success" | "failure_reason" | "latency_ms">, fn: () => Promise<T>) {
  const started = Date.now();
  try {
    const result = await fn();
    await recordAgentObservation({ ...input, success: true, latency_ms: Date.now() - started });
    return result;
  } catch (err: any) {
    await recordAgentObservation({ ...input, success: false, failure_reason: err?.message || "failed", latency_ms: Date.now() - started });
    throw err;
  }
}

export async function getAgentObservabilitySummary(limit = 100) {
  const { data, error } = await supabaseAdmin
    .from("ochiga_agent_observability")
    .select("agent_id,action,tool,success,latency_ms,occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(Math.max(1, Math.min(500, limit)));

  if (error) {
    if (isMissingObservabilityTable(error)) return { available: false, warning: "observability_table_missing", recent: [] };
    return { available: false, warning: error.message, recent: [] };
  }

  const rows = data || [];
  const failures = rows.filter((row: any) => row.success === false).length;
  const latencies = rows.map((row: any) => Number(row.latency_ms)).filter((n) => Number.isFinite(n));
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  return { available: true, total_recent: rows.length, failures, average_latency_ms: avgLatency, recent: rows.slice(0, 10) };
}
