// Wave 7 Slice 4 -- Human-in-the-Loop Unification View. A read-only
// projection over the real, existing human-intervention sources this
// slice's own research confirmed. It is NOT a second writer: every
// action (approve/reject/confirm/cancel) still routes through the
// authoritative domain's own existing endpoint/service exactly as it
// does today. This module only answers "what currently needs a human,
// from what a caller is already authorized to see."
//
// Sources included, each already-authoritative and already-queryable
// through an EXISTING function this module calls rather than re-reading
// tables itself:
//   - Facility `automation_approvals` (status='pending_approval') via
//     facilityAutomationService.ts::listAutomationApprovals() -- real,
//     estate-scoped, already used by the real /automation/approvals
//     route with no additional role gate beyond estate membership.
//   - Office `GovernedActionProposal` (status='pending') via
//     officeActionProposal.ts::loadPendingOfficeActionProposal() -- the
//     ONLY real query shape for this source is (threadId, actorId); no
//     broader listing capability exists anywhere in this codebase today.
//   - GoalRuntime `oyi_goals.status='needs_human'` via
//     GoalRuntime.ts::listForActor() -- real, actor-scoped. Goals with a
//     null requesting_actor_id (system/material-event-created) are NOT
//     reachable through this query by any actor -- a real, disclosed gap
//     (docs/WAVE7_SLICE4_HUMAN_IN_THE_LOOP_UNIFICATION_VIEW.md), not
//     silently worked around with a new broad query this slice was not
//     asked to build.
//   - `OyiWorkflow` (oyi_conversation_workflows, status in
//     awaiting_approval|ready_for_review|awaiting_clarification) via
//     WorkflowRepository::getActive() -- same (threadId, actorId)-only
//     query shape as the Office proposal source.
//
// Sources deliberately excluded (documented, not silently dropped):
// Office handoff (Backend holds no durable, re-queryable record of a
// handoff it requested -- requestOfficeHandoff() is a one-shot outbound
// call whose response is never persisted); Office crm_tasks (Backend has
// no direct database access to Office's separate Supabase project and no
// existing bridge read-list function exists); communication AI-takeover
// (CommunicationFailureReason's "human_takeover_active" is declared but
// has zero writers anywhere -- not a real, observable state today);
// Facility maintenance work (real work, not a human DECISION/INPUT gate
// -- excluded per this slice's own "do not convert ordinary work into
// approval" instruction).
// Wave 7 Slice 5 -- a fifth source added additively: `oyi_decisions`
// (status='awaiting_human') via decisionStore.listActiveDecisionsForEntity()
// -- real, but scoped to a specific (entity_type, entity_id) pair, the
// only query shape a Decision's own schema supports today (it carries no
// actor/estate scope field the way automation_approvals/goals do). See
// docs/WAVE7_SLICE5_CANONICAL_DECISION_OBJECT.md for why this scope was
// chosen instead of widening this module's own query contract further.
import { listAutomationApprovals, listAllPendingApprovals } from "../../services/facilityAutomationService";
import { goalRuntime } from "../../services/goalRuntime/GoalRuntime";
import { loadPendingOfficeActionProposal } from "../context/officeActionProposal";
import { SupabaseWorkflowRepository } from "../workflows/WorkflowRepository";
import { listActiveDecisionsForEntity, listDecisionsByStatuses } from "../../services/decisionStore/DecisionStore";
import { communicationRuntime } from "../../services/communicationRuntime/CommunicationRuntime";
import { normalizeLifecycleStage, type LifecycleStageResult } from "./lifecycleStage";

export type HumanInterventionSourceType = "automation_approval" | "conversation_proposal" | "goal_escalation" | "workflow" | "decision" | "communication_confirmation";

// Evidence-derived, not the suggested default list taken blindly:
//   AUTHORIZATION   -- a specific automation execution requires sign-off
//                      before it proceeds (automation_approvals).
//   CONFIRMATION    -- a specific proposed mutation/action awaits a
//                      yes/no from the actor who initiated it
//                      (GovernedActionProposal; OyiWorkflow
//                      awaiting_approval/ready_for_review).
//   INPUT_REQUIRED  -- the system cannot even form a proposal without
//                      more information from a human (OyiWorkflow
//                      awaiting_clarification).
//   ESCALATION      -- an automated process (a Goal's own decision loop)
//                      hit a condition it cannot resolve itself
//                      (stop-condition match, exhausted attempts,
//                      negative reply) and now needs a human to decide
//                      what happens next -- not an approval, nothing
//                      proposed awaits a yes/no.
export type HumanInterventionType = "AUTHORIZATION" | "CONFIRMATION" | "INPUT_REQUIRED" | "ESCALATION";

export type HumanInterventionObligation = {
  id: string; // `${source_type}:${source_id}` -- derived from the authoritative source, never minted
  source_type: HumanInterventionSourceType;
  source_id: string;
  intervention_type: HumanInterventionType;
  native_status: string;
  normalized_stage: LifecycleStageResult;
  title: string;
  reason: string | null;
  created_at: string;
  due_at: string | null;
  actor: { id: string | null; estate_id: string | null };
  required_role: string | null;
  required_permission: string | null;
  lineage: { canonical_signal_key: string | null };
  scope: { estate_id: string | null; thread_id: string | null };
  // Intelligence Visibility, Slice 2 -- which of the four governed
  // workers this obligation belongs to, ONLY where the source object
  // carries a real surface field (goal/workflow/communication all do;
  // automation_approval is structurally facility-only; decision carries
  // none today). Never inferred/guessed -- null means genuinely unknown,
  // not "office" by default.
  surface: string | null;
};

export type HumanInterventionQuery = {
  estateId?: string | null;
  goalActorId?: string | null;
  thread?: { threadId: string; actorId: string } | null;
  decisionEntity?: { entityType: string; entityId: string } | null;
};

export type HumanInterventionSourceHealth = {
  source_type: HumanInterventionSourceType;
  queried: boolean;
  ok: boolean;
  error: string | null;
  count: number;
};

export type HumanInterventionResult = {
  obligations: HumanInterventionObligation[];
  sources: HumanInterventionSourceHealth[];
  // true only if every source this query actually attempted to load
  // succeeded. false means the obligation list is a lower bound, not a
  // complete answer -- callers must not present it as "nothing needs
  // attention" when complete is false.
  complete: boolean;
};

const WORKFLOW_CONFIRMATION_STATUSES = new Set(["awaiting_approval", "ready_for_review"]);
const WORKFLOW_INPUT_STATUSES = new Set(["awaiting_clarification"]);

function textOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function approvalTitle(row: Record<string, any>): string {
  return textOrNull(row.target_label) || `${textOrNull(row.action_id) || "automation"} on ${textOrNull(row.entity_type) || "an entity"}`;
}

function goalTitle(objective: unknown): string {
  return textOrNull(objective) || "A goal";
}

async function loadAutomationApprovalSource(estateId: string): Promise<{ health: HumanInterventionSourceHealth; obligations: HumanInterventionObligation[] }> {
  try {
    const rows = await listAutomationApprovals(estateId, "pending_approval");
    const obligations = rows.map((row: any) => ({
      id: `automation_approval:${row.id}`,
      source_type: "automation_approval" as const,
      source_id: String(row.id),
      intervention_type: "AUTHORIZATION" as const,
      native_status: String(row.status),
      normalized_stage: normalizeLifecycleStage({ objectType: "automation_approval", status: row.status }),
      title: approvalTitle(row),
      reason: textOrNull(row.reason),
      created_at: String(row.created_at),
      due_at: textOrNull(row.expires_at),
      actor: { id: null, estate_id: String(row.estate_id) },
      required_role: null,
      required_permission: null,
      lineage: { canonical_signal_key: null },
      scope: { estate_id: String(row.estate_id), thread_id: null },
      surface: "facility",
    }));
    return { health: { source_type: "automation_approval", queried: true, ok: true, error: null, count: obligations.length }, obligations };
  } catch (error: any) {
    return { health: { source_type: "automation_approval", queried: true, ok: false, error: String(error?.message || error), count: 0 }, obligations: [] };
  }
}

async function loadGoalEscalationSource(actorId: string): Promise<{ health: HumanInterventionSourceHealth; obligations: HumanInterventionObligation[] }> {
  try {
    const goals = await goalRuntime.listForActor(actorId, undefined, ["needs_human"]);
    const obligations = goals.map((goal) => ({
      id: `goal_escalation:${goal.id}`,
      source_type: "goal_escalation" as const,
      source_id: goal.id,
      intervention_type: "ESCALATION" as const,
      native_status: String(goal.status),
      normalized_stage: normalizeLifecycleStage({ objectType: "goal", status: goal.status }),
      title: goalTitle(goal.objective),
      reason: textOrNull((goal as any).completion_reason),
      created_at: String((goal as any).created_at || ""),
      due_at: null,
      actor: { id: goal.requesting_actor_id, estate_id: null },
      required_role: null,
      required_permission: null,
      lineage: { canonical_signal_key: goal.canonical_signal_key },
      scope: { estate_id: null, thread_id: goal.conversation_thread_id },
      surface: textOrNull(goal.surface),
    }));
    return { health: { source_type: "goal_escalation", queried: true, ok: true, error: null, count: obligations.length }, obligations };
  } catch (error: any) {
    return { health: { source_type: "goal_escalation", queried: true, ok: false, error: String(error?.message || error), count: 0 }, obligations: [] };
  }
}

async function loadConversationProposalSource(threadId: string, actorId: string): Promise<{ health: HumanInterventionSourceHealth; obligations: HumanInterventionObligation[] }> {
  try {
    const proposal = await loadPendingOfficeActionProposal(threadId, actorId);
    if (!proposal) return { health: { source_type: "conversation_proposal", queried: true, ok: true, error: null, count: 0 }, obligations: [] };
    const obligation: HumanInterventionObligation = {
      id: `conversation_proposal:${proposal.proposal_id}`,
      source_type: "conversation_proposal",
      source_id: proposal.proposal_id,
      intervention_type: "CONFIRMATION",
      native_status: String(proposal.status),
      normalized_stage: normalizeLifecycleStage({ objectType: "conversation_proposal", status: proposal.status }),
      title: textOrNull(proposal.description) || `${proposal.operation} on ${proposal.target_entity_type}`,
      reason: null,
      created_at: String(proposal.created_at),
      due_at: textOrNull(proposal.expires_at),
      actor: { id: proposal.actor_id, estate_id: null },
      required_role: null,
      required_permission: null,
      lineage: { canonical_signal_key: null },
      scope: { estate_id: null, thread_id: proposal.thread_id },
      surface: "office_internal",
    };
    return { health: { source_type: "conversation_proposal", queried: true, ok: true, error: null, count: 1 }, obligations: [obligation] };
  } catch (error: any) {
    return { health: { source_type: "conversation_proposal", queried: true, ok: false, error: String(error?.message || error), count: 0 }, obligations: [] };
  }
}

const workflowRepository = new SupabaseWorkflowRepository();

async function loadWorkflowSource(threadId: string, actorId: string): Promise<{ health: HumanInterventionSourceHealth; obligations: HumanInterventionObligation[] }> {
  try {
    const workflow = await workflowRepository.getActive(threadId, actorId);
    if (!workflow) return { health: { source_type: "workflow", queried: true, ok: true, error: null, count: 0 }, obligations: [] };
    const status = String(workflow.status);
    let interventionType: HumanInterventionType | null = null;
    if (WORKFLOW_CONFIRMATION_STATUSES.has(status)) interventionType = "CONFIRMATION";
    else if (WORKFLOW_INPUT_STATUSES.has(status)) interventionType = "INPUT_REQUIRED";
    if (!interventionType) return { health: { source_type: "workflow", queried: true, ok: true, error: null, count: 0 }, obligations: [] };
    const obligation: HumanInterventionObligation = {
      id: `workflow:${workflow.workflow_id}`,
      source_type: "workflow",
      source_id: workflow.workflow_id,
      intervention_type: interventionType,
      native_status: status,
      normalized_stage: normalizeLifecycleStage({ objectType: "workflow", status }),
      title: textOrNull(workflow.operation) || textOrNull(workflow.capability_key) || "A device-action workflow",
      reason: workflow.unresolved_inputs && workflow.unresolved_inputs.length ? `Missing: ${workflow.unresolved_inputs.join(", ")}` : null,
      created_at: workflow.created_at,
      due_at: textOrNull(workflow.expires_at),
      actor: { id: workflow.actor_id, estate_id: workflow.target?.estate_id || null },
      required_role: null,
      required_permission: null,
      lineage: { canonical_signal_key: null },
      scope: { estate_id: workflow.target?.estate_id || null, thread_id: workflow.thread_id },
      surface: textOrNull(workflow.surface),
    };
    return { health: { source_type: "workflow", queried: true, ok: true, error: null, count: 1 }, obligations: [obligation] };
  } catch (error: any) {
    return { health: { source_type: "workflow", queried: true, ok: false, error: String(error?.message || error), count: 0 }, obligations: [] };
  }
}

async function loadDecisionSource(entityType: string, entityId: string): Promise<{ health: HumanInterventionSourceHealth; obligations: HumanInterventionObligation[] }> {
  try {
    const decisions = await listActiveDecisionsForEntity(entityType, entityId);
    const awaitingHuman = decisions.filter((d) => d.status === "awaiting_human");
    const obligations = awaitingHuman.map((d) => ({
      id: `decision:${d.id}`,
      source_type: "decision" as const,
      source_id: d.id,
      // A Decision's own human-required state is, by this slice's own
      // ontology, an AUTHORIZATION gate (a specific selected course of
      // action awaiting sign-off) -- the same category automation_approvals
      // uses, not a fresh category invented for this one source.
      intervention_type: "AUTHORIZATION" as const,
      native_status: d.status,
      normalized_stage: normalizeLifecycleStage({ objectType: "decision", status: d.status }),
      title: d.title,
      reason: d.reason,
      created_at: d.created_at,
      due_at: null,
      actor: { id: d.selected_by === "system" ? null : d.selected_by, estate_id: null },
      required_role: null,
      required_permission: null,
      lineage: { canonical_signal_key: d.canonical_signal_key },
      scope: { estate_id: null, thread_id: null },
      surface: null,
    }));
    return { health: { source_type: "decision", queried: true, ok: true, error: null, count: obligations.length }, obligations };
  } catch (error: any) {
    return { health: { source_type: "decision", queried: true, ok: false, error: String(error?.message || error), count: 0 }, obligations: [] };
  }
}

// ---------------------------------------------------------------------
// Intelligence Visibility, Slice 2 -- PLATFORM-WIDE variant.
//
// loadHumanInterventionObligations() above is, by its own query shape,
// scoped to a single estate/actor/thread/entity -- correct for a live
// conversation turn, but structurally unable to answer Office's "what
// needs a human right now, across the whole platform" question: there is
// no single estateId/actorId/threadId/entityId to pass for a
// platform-wide dashboard. Real audit of every source this file composes
// (see the store-level additions this slice made: listAllPendingApprovals,
// GoalRuntime.listByStatuses, listDecisionsByStatuses,
// WorkflowRepository.listActive, communicationRuntime.listByStatus)
// confirmed each is backed by its own real, dedicated table that CAN be
// queried unscoped -- except conversation_proposal, whose only storage is
// a JSONB sibling key on oyi_conversation_threads.metadata with no
// broader listing capability (and no index that would make an unscoped
// scan safe or fast), exactly as this file's own top-of-file audit
// already documented for the per-actor case. That source is therefore
// EXCLUDED here too, not silently worked around with a new table this
// slice was not asked to build.
//
// communication_confirmation is a NEW fifth source (Section 6 of this
// slice's own brief: "communication confirmations"), reusing the real
// CommunicationStatus="awaiting_confirmation" value and the real
// oyi_communications table CommunicationRuntime already owns -- not a new
// state or a new store.
const PLATFORM_INTERVENTION_LIMIT_DEFAULT = 50;

async function loadPlatformAutomationApprovalSource(limit: number): Promise<{ health: HumanInterventionSourceHealth; obligations: HumanInterventionObligation[] }> {
  try {
    const rows = await listAllPendingApprovals(limit);
    const obligations = rows.map((row: any) => ({
      id: `automation_approval:${row.id}`,
      source_type: "automation_approval" as const,
      source_id: String(row.id),
      intervention_type: "AUTHORIZATION" as const,
      native_status: String(row.status),
      normalized_stage: normalizeLifecycleStage({ objectType: "automation_approval", status: row.status }),
      title: approvalTitle(row),
      reason: textOrNull(row.reason),
      created_at: String(row.created_at),
      due_at: textOrNull(row.expires_at),
      actor: { id: null, estate_id: String(row.estate_id) },
      required_role: null,
      required_permission: null,
      lineage: { canonical_signal_key: null },
      scope: { estate_id: String(row.estate_id), thread_id: null },
      surface: "facility",
    }));
    return { health: { source_type: "automation_approval", queried: true, ok: true, error: null, count: obligations.length }, obligations };
  } catch (error: any) {
    return { health: { source_type: "automation_approval", queried: true, ok: false, error: String(error?.message || error), count: 0 }, obligations: [] };
  }
}

async function loadPlatformGoalEscalationSource(limit: number): Promise<{ health: HumanInterventionSourceHealth; obligations: HumanInterventionObligation[] }> {
  try {
    const goals = await goalRuntime.listByStatuses(["needs_human"], limit);
    const obligations = goals.map((goal) => ({
      id: `goal_escalation:${goal.id}`,
      source_type: "goal_escalation" as const,
      source_id: goal.id,
      intervention_type: "ESCALATION" as const,
      native_status: String(goal.status),
      normalized_stage: normalizeLifecycleStage({ objectType: "goal", status: goal.status }),
      title: goalTitle(goal.objective),
      reason: textOrNull((goal as any).completion_reason),
      created_at: String((goal as any).created_at || ""),
      due_at: null,
      actor: { id: goal.requesting_actor_id, estate_id: null },
      required_role: null,
      required_permission: null,
      lineage: { canonical_signal_key: goal.canonical_signal_key },
      scope: { estate_id: null, thread_id: goal.conversation_thread_id },
      surface: textOrNull(goal.surface),
    }));
    return { health: { source_type: "goal_escalation", queried: true, ok: true, error: null, count: obligations.length }, obligations };
  } catch (error: any) {
    return { health: { source_type: "goal_escalation", queried: true, ok: false, error: String(error?.message || error), count: 0 }, obligations: [] };
  }
}

async function loadPlatformWorkflowSource(limit: number): Promise<{ health: HumanInterventionSourceHealth; obligations: HumanInterventionObligation[] }> {
  try {
    const workflows = await workflowRepository.listActive(limit);
    const obligations: HumanInterventionObligation[] = [];
    for (const workflow of workflows) {
      const status = String(workflow.status);
      let interventionType: HumanInterventionType | null = null;
      if (WORKFLOW_CONFIRMATION_STATUSES.has(status)) interventionType = "CONFIRMATION";
      else if (WORKFLOW_INPUT_STATUSES.has(status)) interventionType = "INPUT_REQUIRED";
      if (!interventionType) continue; // active-but-not-yet-human-facing (e.g. collecting_inputs/executing) -- real work, not a human gate, same exclusion rule as the per-thread loader.
      obligations.push({
        id: `workflow:${workflow.workflow_id}`,
        source_type: "workflow",
        source_id: workflow.workflow_id,
        intervention_type: interventionType,
        native_status: status,
        normalized_stage: normalizeLifecycleStage({ objectType: "workflow", status }),
        title: textOrNull(workflow.operation) || textOrNull(workflow.capability_key) || "A device-action workflow",
        reason: workflow.unresolved_inputs && workflow.unresolved_inputs.length ? `Missing: ${workflow.unresolved_inputs.join(", ")}` : null,
        created_at: workflow.created_at,
        due_at: textOrNull(workflow.expires_at),
        actor: { id: workflow.actor_id, estate_id: workflow.target?.estate_id || null },
        required_role: null,
        required_permission: null,
        lineage: { canonical_signal_key: null },
        scope: { estate_id: workflow.target?.estate_id || null, thread_id: workflow.thread_id },
        surface: textOrNull(workflow.surface),
      });
    }
    return { health: { source_type: "workflow", queried: true, ok: true, error: null, count: obligations.length }, obligations };
  } catch (error: any) {
    return { health: { source_type: "workflow", queried: true, ok: false, error: String(error?.message || error), count: 0 }, obligations: [] };
  }
}

async function loadPlatformDecisionSource(limit: number): Promise<{ health: HumanInterventionSourceHealth; obligations: HumanInterventionObligation[] }> {
  try {
    const decisions = await listDecisionsByStatuses(["awaiting_human"], limit);
    const obligations = decisions.map((d) => ({
      id: `decision:${d.id}`,
      source_type: "decision" as const,
      source_id: d.id,
      intervention_type: "AUTHORIZATION" as const,
      native_status: d.status,
      normalized_stage: normalizeLifecycleStage({ objectType: "decision", status: d.status }),
      title: d.title,
      reason: d.reason,
      created_at: d.created_at,
      due_at: null,
      actor: { id: d.selected_by === "system" ? null : d.selected_by, estate_id: null },
      required_role: null,
      required_permission: null,
      lineage: { canonical_signal_key: d.canonical_signal_key },
      scope: { estate_id: null, thread_id: null },
      surface: null,
    }));
    return { health: { source_type: "decision", queried: true, ok: true, error: null, count: obligations.length }, obligations };
  } catch (error: any) {
    return { health: { source_type: "decision", queried: true, ok: false, error: String(error?.message || error), count: 0 }, obligations: [] };
  }
}

// communication_confirmation title deliberately built from channel+intent
// ONLY -- never subject/body/recipient (see CommunicationRecord's own
// contract: recipient carries name/email/phone/whatsapp_phone, subject/
// body/plain_text/html carry the actual message). intent is documented on
// the contract itself as "short human-readable label... not a closed
// taxonomy", the same class of field capability domain_label already
// safely exposes.
function communicationTitle(record: { channel: string; intent: string }): string {
  const intent = textOrNull(record.intent);
  return intent ? `${record.channel}: ${intent}` : `A pending ${record.channel} message`;
}

async function loadPlatformCommunicationConfirmationSource(limit: number): Promise<{ health: HumanInterventionSourceHealth; obligations: HumanInterventionObligation[] }> {
  try {
    const records = await communicationRuntime.listByStatus("awaiting_confirmation", limit);
    const obligations = records.map((record) => ({
      id: `communication_confirmation:${record.communication_id}`,
      source_type: "communication_confirmation" as const,
      source_id: record.communication_id,
      intervention_type: "CONFIRMATION" as const,
      native_status: String(record.status),
      normalized_stage: normalizeLifecycleStage({ objectType: "communication", status: record.status }),
      title: communicationTitle(record),
      reason: null,
      created_at: record.created_at,
      due_at: null, // CommunicationRecord carries no confirmation TTL field today -- honestly null, not guessed.
      actor: { id: record.actor_id, estate_id: null },
      required_role: null,
      required_permission: record.governance?.permission_scope ? String(record.governance.permission_scope) : null,
      lineage: { canonical_signal_key: null },
      scope: { estate_id: null, thread_id: record.conversation_thread_id },
      surface: textOrNull(record.surface),
    }));
    return { health: { source_type: "communication_confirmation", queried: true, ok: true, error: null, count: obligations.length }, obligations };
  } catch (error: any) {
    return { health: { source_type: "communication_confirmation", queried: true, ok: false, error: String(error?.message || error), count: 0 }, obligations: [] };
  }
}

// The one platform-wide entry point -- Office's Intelligence Overview and
// /office/intelligence/interventions both call this, never the per-scope
// loadHumanInterventionObligations() above (which they have no
// estateId/actorId/threadId/entityId to satisfy). Parallel reads across
// all five sources; complete=false (same contract as the per-scope
// function) if any source's own query failed, so a caller never presents
// a partial list as "nothing needs attention."
export async function loadPlatformHumanInterventionObligations(limit: number = PLATFORM_INTERVENTION_LIMIT_DEFAULT): Promise<HumanInterventionResult> {
  const results = await Promise.all([
    loadPlatformAutomationApprovalSource(limit),
    loadPlatformGoalEscalationSource(limit),
    loadPlatformDecisionSource(limit),
    loadPlatformWorkflowSource(limit),
    loadPlatformCommunicationConfirmationSource(limit),
  ]);
  const obligations: HumanInterventionObligation[] = [];
  const sources: HumanInterventionSourceHealth[] = [];
  for (const result of results) {
    sources.push(result.health);
    obligations.push(...result.obligations);
  }
  obligations.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { obligations, sources, complete: sources.every((s) => s.ok) };
}

// Read-only. Composes only whichever sources the caller supplies a real,
// already-authorized scope for -- it never widens visibility beyond what
// that scope already permits through the source's own existing endpoint.
// No dedup logic runs: the four sources are independent domains
// (Facility automation vs. Office conversation vs. GoalRuntime vs. the
// device-action workflow machine) with no stable cross-reference proving
// any two rows describe the same real-world obligation, so nothing here
// heuristically merges them (see docs, "dedup policy").
export async function loadHumanInterventionObligations(query: HumanInterventionQuery): Promise<HumanInterventionResult> {
  const obligations: HumanInterventionObligation[] = [];
  const sources: HumanInterventionSourceHealth[] = [];

  if (query.estateId) {
    const { health, obligations: rows } = await loadAutomationApprovalSource(query.estateId);
    sources.push(health);
    obligations.push(...rows);
  }
  if (query.goalActorId) {
    const { health, obligations: rows } = await loadGoalEscalationSource(query.goalActorId);
    sources.push(health);
    obligations.push(...rows);
  }
  if (query.thread) {
    const [proposalResult, workflowResult] = await Promise.all([
      loadConversationProposalSource(query.thread.threadId, query.thread.actorId),
      loadWorkflowSource(query.thread.threadId, query.thread.actorId),
    ]);
    sources.push(proposalResult.health);
    obligations.push(...proposalResult.obligations);
    sources.push(workflowResult.health);
    obligations.push(...workflowResult.obligations);
  }
  if (query.decisionEntity) {
    const { health, obligations: rows } = await loadDecisionSource(query.decisionEntity.entityType, query.decisionEntity.entityId);
    sources.push(health);
    obligations.push(...rows);
  }

  return { obligations, sources, complete: sources.every((s) => s.ok) };
}
