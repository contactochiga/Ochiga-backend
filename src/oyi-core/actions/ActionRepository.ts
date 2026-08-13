import type { OyiAction } from "../contracts/action";
import type { CanonicalTarget } from "../contracts/target";
import { supabaseAdmin } from "../../supabase/supabaseClient";

export interface ActionRepository {
  get(actionId: string): Promise<OyiAction | null>;
  findActiveEquivalent(idempotencyKey: string): Promise<OyiAction | null>;
  save(action: OyiAction, options?: { expectedRevision?: number | null }): Promise<OyiAction>;
  recordEvent?(input: { action: OyiAction; event_type: string; from_status?: string | null; to_status?: string | null; actor_id?: string | null; source?: string; summary?: string | null; metadata?: Record<string, unknown> }): Promise<void>;
  recordEvidence?(actionId: string, evidence: Array<Record<string, unknown>>): Promise<void>;
}

export class InMemoryActionRepository implements ActionRepository {
  private readonly actions = new Map<string, OyiAction>();
  private readonly events: Record<string, unknown>[] = [];
  async get(actionId: string) {
    return this.actions.get(actionId) || null;
  }
  async findActiveEquivalent(idempotencyKey: string) {
    return Array.from(this.actions.values()).find((action) => action.idempotency_key === idempotencyKey && !terminalActionStatuses.includes(action.status)) || null;
  }
  async save(action: OyiAction, options: { expectedRevision?: number | null } = {}) {
    const existing = this.actions.get(action.action_id);
    if (options.expectedRevision != null && existing && existing.revision !== options.expectedRevision) {
      const error: any = new Error("Action revision conflict");
      error.code = "ACTION_REVISION_CONFLICT";
      error.current = existing;
      throw error;
    }
    this.actions.set(action.action_id, action);
    return action;
  }
  async recordEvent(input: { action: OyiAction; event_type: string; from_status?: string | null; to_status?: string | null; actor_id?: string | null; source?: string; summary?: string | null; metadata?: Record<string, unknown> }) {
    this.events.push(input);
  }
  async recordEvidence(actionId: string, evidence: Array<Record<string, unknown>>) {
    const action = this.actions.get(actionId);
    if (action) this.actions.set(actionId, { ...action, evidence: [...action.evidence, ...evidence] });
  }
}

const terminalActionStatuses = ["confirmed", "unobservable", "timed_out", "failed", "cancelled", "superseded", "provider_rejected"];
const activeActionStatuses = ["draft", "awaiting_confirmation", "approved", "queued", "sent", "provider_accepted", "verifying"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function targetFromRow(row: Record<string, any>): CanonicalTarget {
  return {
    object_type: String(row.target_type || "device"),
    canonical_id: String(row.target_id || ""),
    label: row.target_label || null,
    channel_code: row.target_channel_code || null,
  };
}

function actionFromRow(row: Record<string, any>): OyiAction {
  const executorReference = asRecord(row.executor_reference);
  return {
    action_id: String(row.action_id),
    workflow_id: String(row.workflow_id),
    thread_id: row.thread_id || null,
    actor_id: row.actor_id || null,
    capability_key: String(row.capability_key || ""),
    domain: row.domain,
    target: targetFromRow(row),
    requested_operation: String(row.requested_operation || ""),
    requested_state: row.requested_state ?? null,
    status: row.status,
    idempotency_key: String(row.idempotency_key || ""),
    revision: Number(row.revision || 1),
    approved_at: row.approved_at || null,
    queued_at: row.queued_at || null,
    sent_at: row.sent_at || null,
    provider_accepted_at: row.provider_accepted_at || null,
    verification_started_at: row.verification_started_at || null,
    executed_at: row.sent_at || row.provider_accepted_at || null,
    completed_at: row.completed_at || null,
    execution_id: typeof executorReference.execution_id === "string" ? executorReference.execution_id : null,
    verification_id: typeof executorReference.verification_id === "string" ? executorReference.verification_id : null,
    executor_reference: Object.keys(executorReference).length ? executorReference : null,
    result: Object.keys(asRecord(row.result)).length ? asRecord(row.result) : null,
    safe_error: Object.keys(asRecord(row.safe_error)).length ? asRecord(row.safe_error) : null,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function actionRow(action: OyiAction) {
  return {
    action_id: action.action_id,
    workflow_id: action.workflow_id,
    thread_id: action.thread_id || null,
    actor_id: action.actor_id || null,
    domain: action.domain,
    capability_key: action.capability_key,
    target_type: action.target.object_type,
    target_id: action.target.canonical_id,
    target_channel_code: action.target.channel_code || null,
    target_label: action.target.label || null,
    requested_operation: action.requested_operation,
    requested_state: action.requested_state === undefined ? null : action.requested_state,
    status: action.status,
    idempotency_key: action.idempotency_key,
    revision: action.revision,
    approved_at: action.approved_at,
    queued_at: action.queued_at,
    sent_at: action.sent_at,
    provider_accepted_at: action.provider_accepted_at,
    verification_started_at: action.verification_started_at,
    completed_at: action.completed_at,
    executor_reference: action.executor_reference || {
      execution_id: action.execution_id,
      verification_id: action.verification_id,
    },
    result: action.result,
    safe_error: action.safe_error,
    evidence: action.evidence || [],
    updated_at: action.updated_at,
  };
}

export class SupabaseActionRepository implements ActionRepository {
  async get(actionId: string) {
    const { data, error } = await supabaseAdmin
      .from("oyi_actions")
      .select("*")
      .eq("action_id", actionId)
      .maybeSingle();
    if (error) throw error;
    return data ? actionFromRow(data as any) : null;
  }

  async findActiveEquivalent(idempotencyKey: string) {
    const { data, error } = await supabaseAdmin
      .from("oyi_actions")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .in("status", activeActionStatuses)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? actionFromRow(data as any) : null;
  }

  async save(action: OyiAction, options: { expectedRevision?: number | null } = {}) {
    const row = actionRow(action);
    if (options.expectedRevision != null) {
      const { data, error } = await supabaseAdmin
        .from("oyi_actions")
        .update(row as any)
        .eq("action_id", action.action_id)
        .eq("revision", options.expectedRevision)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        const current = await this.get(action.action_id);
        const conflict: any = new Error("Action revision conflict");
        conflict.code = "ACTION_REVISION_CONFLICT";
        conflict.current = current;
        throw conflict;
      }
      return actionFromRow(data as any);
    }
    const { data, error } = await supabaseAdmin
      .from("oyi_actions")
      .upsert(row as any, { onConflict: "action_id" })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return actionFromRow((data || row) as any);
  }

  async recordEvent(input: { action: OyiAction; event_type: string; from_status?: string | null; to_status?: string | null; actor_id?: string | null; source?: string; summary?: string | null; metadata?: Record<string, unknown> }) {
    const { error } = await supabaseAdmin.from("oyi_action_events").insert({
      action_id: input.action.action_id,
      event_type: input.event_type,
      from_status: input.from_status || null,
      to_status: input.to_status || null,
      actor_id: input.actor_id || input.action.actor_id || null,
      source: input.source || "oyi_core",
      summary: input.summary || null,
      metadata: input.metadata || {},
    } as any);
    if (error) throw error;
  }

  async recordEvidence(actionId: string, evidence: Array<Record<string, unknown>>) {
    if (!evidence.length) return;
    const rows = evidence.map((item) => ({
      action_id: actionId,
      evidence_type: String(item.evidence_type || item.type || "evidence"),
      evidence_id: item.evidence_id ? String(item.evidence_id) : null,
      source_type: item.source_type ? String(item.source_type) : null,
      source_id: item.source_id ? String(item.source_id) : null,
      metadata: item,
    }));
    const { error } = await supabaseAdmin.from("oyi_action_evidence").insert(rows as any);
    if (error) throw error;
  }
}
