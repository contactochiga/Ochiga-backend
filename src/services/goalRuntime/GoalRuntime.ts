// Oyi Autonomous Work Runtime -- durable goal persistence. Mirrors
// CommunicationRuntime.ts's own shape (plan/persist/verify pattern) and
// officeActionProposal.ts's governed propose->confirm split, applied to
// a longer-lived unit of work instead of a single action.
import { randomUUID } from "crypto";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import type { GoalRecord, GoalStatus } from "../../contracts/goal";

function rowToRecord(row: any): GoalRecord {
  return {
    id: row.id,
    correlation_id: row.correlation_id,
    requesting_actor_id: row.requesting_actor_id,
    surface: row.surface,
    conversation_thread_id: row.conversation_thread_id,
    organization_scope: row.organization_scope,
    objective: row.objective,
    target_entities: row.target_entities || {},
    status: row.status,
    success_condition: row.success_condition || { type: "manual" },
    stop_condition: row.stop_condition || { type: "none" },
    reply_branches: row.reply_branches || [],
    plan: row.plan || [],
    current_step_index: row.current_step_index ?? 0,
    schedule: row.schedule || { deadline: null, recurrence: null, timezone: null },
    event_conditions: row.event_conditions || [],
    communication_preferences: row.communication_preferences || { allowed_channels: ["email", "whatsapp"], escalation_policy: "notify_requester" },
    max_attempts: row.max_attempts ?? 5,
    attempts_completed: row.attempts_completed ?? 0,
    observations: row.observations || [],
    evidence: row.evidence || [],
    linked_crm_records: row.linked_crm_records || {},
    linked_tasks: row.linked_tasks || [],
    linked_meetings: row.linked_meetings || [],
    linked_automations: row.linked_automations || [],
    linked_communication_threads: row.linked_communication_threads || [],
    execution_history: row.execution_history || [],
    last_evaluated_at: row.last_evaluated_at,
    next_evaluation_at: row.next_evaluation_at,
    completion_reason: row.completion_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function recordToRow(record: Partial<GoalRecord> & { id: string }): Record<string, unknown> {
  const row: Record<string, unknown> = { id: record.id, updated_at: new Date().toISOString() };
  const map: Array<keyof GoalRecord> = [
    "correlation_id", "requesting_actor_id", "surface", "conversation_thread_id", "organization_scope",
    "objective", "target_entities", "status", "success_condition", "stop_condition", "reply_branches", "plan",
    "current_step_index", "schedule", "event_conditions", "communication_preferences",
    "max_attempts", "attempts_completed", "observations", "evidence", "linked_crm_records",
    "linked_tasks", "linked_meetings", "linked_automations", "linked_communication_threads",
    "execution_history", "last_evaluated_at", "next_evaluation_at", "completion_reason", "created_at",
  ];
  for (const key of map) {
    if (record[key] !== undefined) row[key] = record[key];
  }
  return row;
}

export class GoalRuntime {
  async create(input: Omit<GoalRecord, "id" | "created_at" | "updated_at">): Promise<GoalRecord> {
    const now = new Date().toISOString();
    const row = recordToRow({ ...input, id: randomUUID(), created_at: now } as GoalRecord);
    const { data, error } = await supabaseAdmin.from("oyi_goals").insert(row).select("*").single();
    if (error || !data) throw new Error(error?.message || "Failed to create goal.");
    return rowToRecord(data);
  }

  async get(id: string): Promise<GoalRecord | null> {
    const { data, error } = await supabaseAdmin.from("oyi_goals").select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return rowToRecord(data);
  }

  async listForActor(actorId: string, threadId?: string | null, statuses?: GoalStatus[]): Promise<GoalRecord[]> {
    let query = supabaseAdmin.from("oyi_goals").select("*").eq("requesting_actor_id", actorId).order("created_at", { ascending: false }).limit(50);
    if (threadId) query = query.eq("conversation_thread_id", threadId);
    if (statuses?.length) query = query.in("status", statuses);
    const { data, error } = await query;
    if (error || !data) return [];
    return data.map(rowToRecord);
  }

  // Status-agnostic "most recent goal in this thread" -- for pronoun
  // continuity ("did he answer?" referring to the goal just discussed).
  async mostRecentForThread(actorId: string, threadId: string): Promise<GoalRecord | null> {
    const { data, error } = await supabaseAdmin
      .from("oyi_goals")
      .select("*")
      .eq("requesting_actor_id", actorId)
      .eq("conversation_thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return rowToRecord(data);
  }

  async persist(record: GoalRecord): Promise<GoalRecord> {
    const { data, error } = await supabaseAdmin.from("oyi_goals").update(recordToRow(record)).eq("id", record.id).select("*").single();
    if (error || !data) return record;
    return rowToRecord(data);
  }

  // Exactly-once claim for the scheduler tick -- same CAS pattern as
  // scenes.ts's claimAndRunAutomation: the UPDATE's WHERE clause only
  // matches if next_evaluation_at is still what the due-scan read, so a
  // second concurrent tick (or a retry) gets zero rows back and backs off
  // instead of double-executing.
  async claimForEvaluation(goalId: string, expectedNextEvaluationAt: string | null): Promise<GoalRecord | null> {
    let query = supabaseAdmin.from("oyi_goals").update({ status: "executing", updated_at: new Date().toISOString() }).eq("id", goalId);
    query = expectedNextEvaluationAt ? query.eq("next_evaluation_at", expectedNextEvaluationAt) : query.is("next_evaluation_at", null);
    const { data, error } = await query.select("*").maybeSingle();
    if (error || !data) return null;
    return rowToRecord(data);
  }

  async listDue(limit = 10): Promise<GoalRecord[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("oyi_goals")
      .select("*")
      .in("status", ["active", "observing", "action_due", "waiting", "reevaluating"])
      .not("next_evaluation_at", "is", null)
      .lte("next_evaluation_at", nowIso)
      .order("next_evaluation_at", { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return data.map(rowToRecord);
  }

  // Event-driven wake (Part C -- "prefer events over polling"): every
  // active/waiting goal watching this thread_reference, so an inbound
  // reply can trigger immediate reevaluation instead of waiting for the
  // next poll tick.
  async findGoalsWatchingThread(threadReference: string): Promise<GoalRecord[]> {
    const { data, error } = await supabaseAdmin
      .from("oyi_goals")
      .select("*")
      .in("status", ["active", "observing", "waiting", "reevaluating"])
      .contains("linked_communication_threads", JSON.stringify([threadReference]));
    if (error || !data) return [];
    return data.map(rowToRecord);
  }
}

export const goalRuntime = new GoalRuntime();
