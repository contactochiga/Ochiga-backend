// Wave 7 Slice 5 -- canonical Decision persistence/service boundary. The
// ONLY place anything writes to oyi_decisions. See src/contracts/decision.ts
// for what a Decision is and is not.
//
// Non-negotiable: nothing in this file ever calls a provider, sends a
// device command, sends a message, or mutates any physical/external
// state. It only ever reads/writes the oyi_decisions row itself.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { operationalMetrics } from "../../observability/metrics";
import type { CreateDecisionInput, DecisionRecord, DecisionStatus } from "../../contracts/decision";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

// Stable semantic identity -- never positional/index-derived (Slice 2's
// own lesson). The same real-world selection (same entity, same selected
// action, same originating signal if any) always derives the same key,
// so a retried/replayed producer call is naturally idempotent via the
// table's own unique index rather than any in-process dedup logic.
export function decisionKey(input: { entityType: string; entityId: string; actionType: string; canonicalSignalKey?: string | null }): string {
  return `decision:${text(input.entityType)}:${text(input.entityId)}:${text(input.actionType)}:${text(input.canonicalSignalKey) || "no-signal"}`;
}

function rowToRecord(row: any): DecisionRecord {
  return {
    id: row.id,
    decision_key: row.decision_key,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action_type: row.action_type,
    title: row.title,
    reason: row.reason ?? null,
    status: row.status,
    requires_human: Boolean(row.requires_human),
    selected_by: row.selected_by,
    authority_mode: row.authority_mode,
    policy_source: row.policy_source ?? null,
    canonical_signal_key: row.canonical_signal_key ?? null,
    recommendation_key: row.recommendation_key ?? null,
    goal_id: row.goal_id ?? null,
    plan_id: row.plan_id ?? null,
    incident_id: row.incident_id ?? null,
    awareness_key: row.awareness_key ?? null,
    superseded_by: row.superseded_by ?? null,
    metadata: row.metadata || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    decided_at: row.decided_at ?? null,
    closed_at: row.closed_at ?? null,
  };
}

function inputToRow(input: CreateDecisionInput): Record<string, unknown> {
  return {
    decision_key: input.decision_key,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    action_type: input.action_type,
    title: input.title,
    reason: input.reason ?? null,
    status: input.status,
    requires_human: input.requires_human,
    selected_by: input.selected_by,
    authority_mode: input.authority_mode,
    policy_source: input.policy_source ?? null,
    canonical_signal_key: input.canonical_signal_key ?? null,
    recommendation_key: input.recommendation_key ?? null,
    goal_id: input.goal_id ?? null,
    plan_id: input.plan_id ?? null,
    incident_id: input.incident_id ?? null,
    awareness_key: input.awareness_key ?? null,
    metadata: input.metadata || {},
  };
}

export type CreateDecisionResult = { decision: DecisionRecord; created: boolean };

// Idempotent: a unique-violation on decision_key means the identical
// semantic selection already has a durable row -- that existing row is
// returned (created:false), never a duplicate and never an error the
// caller has to handle specially.
export async function createDecision(input: CreateDecisionInput): Promise<CreateDecisionResult> {
  const row = inputToRow(input);
  const { data, error } = await supabaseAdmin.from("oyi_decisions").insert(row).select("*").single();
  if (!error && data) {
    operationalMetrics.increment("oyi_decision_created_total", { entity_type: input.entity_type, status: input.status });
    return { decision: rowToRecord(data), created: true };
  }
  if (error && error.code === POSTGRES_UNIQUE_VIOLATION) {
    const existing = await getDecisionByKey(input.decision_key);
    if (existing) {
      operationalMetrics.increment("oyi_decision_idempotent_reuse_total", { entity_type: input.entity_type });
      return { decision: existing, created: false };
    }
  }
  throw new Error(error?.message || "Failed to create decision.");
}

export async function getDecision(id: string): Promise<DecisionRecord | null> {
  const { data, error } = await supabaseAdmin.from("oyi_decisions").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return rowToRecord(data);
}

export async function getDecisionByKey(key: string): Promise<DecisionRecord | null> {
  const { data, error } = await supabaseAdmin.from("oyi_decisions").select("*").eq("decision_key", key).maybeSingle();
  if (error || !data) return null;
  return rowToRecord(data);
}

export async function listDecisionsForEntity(entityType: string, entityId: string, statuses?: DecisionStatus[]): Promise<DecisionRecord[]> {
  let query = supabaseAdmin.from("oyi_decisions").select("*").eq("entity_type", entityType).eq("entity_id", entityId).order("created_at", { ascending: false }).limit(50);
  if (statuses?.length) query = query.in("status", statuses);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(rowToRecord);
}

// The three real, non-terminal statuses (see DECISION_TERMINAL_STATUSES).
const ACTIVE_STATUSES: DecisionStatus[] = ["selected", "awaiting_human", "approved"];

export async function listActiveDecisionsForEntity(entityType: string, entityId: string): Promise<DecisionRecord[]> {
  return listDecisionsForEntity(entityType, entityId, ACTIVE_STATUSES);
}

// Intelligence Visibility, Slice 2 -- platform-wide (no entity filter)
// status listing, for a caller like Office's Intelligence Overview that
// needs "every decision currently awaiting_human" across every entity,
// not one entity's decisions. Same table, same real DecisionStatus
// values as listDecisionsForEntity above -- just without the mandatory
// entity_type/entity_id scope that function's own schema-driven query
// shape requires.
export async function listDecisionsByStatuses(statuses: DecisionStatus[], limit = 50): Promise<DecisionRecord[]> {
  if (!statuses.length) return [];
  const { data, error } = await supabaseAdmin
    .from("oyi_decisions")
    .select("*")
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map(rowToRecord);
}

// Intelligence Visibility, Slice 2 -- count-only siblings for Overview's
// KPI numbers. head:true never returns rows.
export async function countDecisionsByStatuses(statuses: DecisionStatus[]): Promise<number> {
  if (!statuses.length) return 0;
  const { count, error } = await supabaseAdmin.from("oyi_decisions").select("id", { count: "exact", head: true }).in("status", statuses);
  if (error) return 0;
  return count || 0;
}

// "Recently resolved" = has a real decided_at timestamp within the
// window, regardless of which way it resolved (approved/rejected/
// superseded/cancelled all set decided_at per DecisionStore's own
// transitionDecisionStatus) -- the real field the schema already tracks,
// not an invented simplified status.
export async function countDecisionsResolvedSince(sinceIso: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from("oyi_decisions").select("id", { count: "exact", head: true }).not("decided_at", "is", null).gte("decided_at", sinceIso);
  if (error) return 0;
  return count || 0;
}

export async function listDecisionsByCanonicalSignalKey(canonicalSignalKey: string): Promise<DecisionRecord[]> {
  const { data, error } = await supabaseAdmin.from("oyi_decisions").select("*").eq("canonical_signal_key", canonicalSignalKey).order("created_at", { ascending: false }).limit(50);
  if (error || !data) return [];
  return data.map(rowToRecord);
}

export type DecisionPrecondition = { in: DecisionStatus[] };

export type DecisionTransitionOutcome =
  | { code: "applied"; decision: DecisionRecord }
  | { code: "already_in_target"; decision: DecisionRecord }
  | { code: "conflict"; currentStatus: DecisionStatus }
  | { code: "not_found" }
  | { code: "db_error"; message: string };

// CAS lifecycle mutation, mirroring the established
// transitionMaintenanceStatus/transitionVisitorAccessStatus pattern
// (Wave 6 Final B): UPDATE ... WHERE id=? AND status IN (precondition)
// RETURNING *; zero rows back means either the row doesn't exist, is
// already at the target, or a conflicting transition won the race --
// classified by a follow-up read, never assumed.
export async function transitionDecisionStatus(
  id: string,
  precondition: DecisionPrecondition,
  patch: Partial<Pick<DecisionRecord, "status" | "decided_at" | "closed_at" | "superseded_by" | "reason">>
): Promise<DecisionTransitionOutcome> {
  const fullPatch: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  const { data: claimed, error } = await supabaseAdmin
    .from("oyi_decisions")
    .update(fullPatch)
    .eq("id", id)
    .in("status", precondition.in)
    .select("*")
    .maybeSingle();

  if (error) return { code: "db_error", message: error.message };
  if (claimed) {
    operationalMetrics.increment("oyi_decision_transition_total", { outcome: "applied", status: String(patch.status || claimed.status) });
    return { code: "applied", decision: rowToRecord(claimed) };
  }

  const current = await getDecision(id);
  if (!current) return { code: "not_found" };
  if (patch.status && current.status === patch.status) {
    operationalMetrics.increment("oyi_decision_transition_total", { outcome: "already_in_target", status: current.status });
    return { code: "already_in_target", decision: current };
  }
  operationalMetrics.increment("oyi_decision_transition_total", { outcome: "conflict", status: current.status });
  return { code: "conflict", currentStatus: current.status };
}

// Non-CAS, additive-only lineage attachment -- a Decision's producer may
// not know the resulting goal_id until after the goal is created (the
// Decision necessarily precedes it). Only ever fills a currently-null
// goal_id; never overwrites an existing one.
export async function attachGoalToDecision(decisionId: string, goalId: string): Promise<void> {
  await supabaseAdmin
    .from("oyi_decisions")
    .update({ goal_id: goalId, updated_at: new Date().toISOString() })
    .eq("id", decisionId)
    .is("goal_id", null);
}
