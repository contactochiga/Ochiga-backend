// Wave 7 Slice 3 -- Lifecycle Vocabulary Normalization. A pure reporting
// translation, not a lifecycle authority. Every object type below keeps
// its own real status field, its own real writers, and its own real
// domain transition logic exactly as-is; this module only offers a
// shared word for "what stage is this in" so cross-object reporting/UI
// does not have to re-implement bespoke status filters per object (the
// kind of ad-hoc filter this slice's own research found duplicated,
// inconsistently, in places like buildExecutiveBriefing()). Calling
// normalizeLifecycleStage() never reads or writes a database row and
// never mutates its input.
//
// Every mapping entry below is grounded in a real, grep-verified writer
// or a real, grep-verified declared-but-currently-unreachable literal
// found during this slice's own inventory (see
// docs/WAVE7_SLICE3_LIFECYCLE_VOCABULARY_NORMALIZATION.md for the full
// evidence table with file:line citations). A status string that is not
// listed here was deliberately not invented -- it resolves to "unknown"
// instead, per this slice's own explicit "do not infer undocumented
// literals" instruction.

export type LifecycleObjectType =
  | "recommendation"
  | "plan"
  | "goal"
  | "task"
  | "automation_approval"
  | "automation_run"
  | "workflow"
  | "conversation_proposal"
  | "communication"
  | "handoff"
  | "decision";

export type LifecycleStage =
  | "not_started"
  | "awaiting_human_decision"
  | "awaiting_human_input"
  | "in_progress"
  | "paused"
  | "succeeded"
  | "no_outcome"
  | "failed_execution"
  | "policy_denied"
  | "rejected_by_human"
  | "dismissed"
  | "cancelled"
  | "expired"
  | "superseded"
  | "unknown";

export type NormalizeLifecycleStageInput = {
  objectType: LifecycleObjectType;
  status: unknown;
};

export type LifecycleStageResult = {
  objectType: LifecycleObjectType;
  rawStatus: string | null;
  stage: LifecycleStage;
  terminal: boolean;
  awaitingHuman: boolean;
  mapped: boolean;
};

type StageEntry = { stage: LifecycleStage; terminal: boolean; awaitingHuman: boolean };

function entry(stage: LifecycleStage, terminal: boolean, awaitingHuman: boolean): StageEntry {
  return { stage, terminal, awaitingHuman };
}

// operational_recommendations.status -- real writers: "pending"
// (materialization.ts), "resolved" (Final A incident-resolution RPC),
// "dismissed" (canonicalIntelligenceStore.recordFeedback). "open" is the
// real in-memory pre-materialization value (operationalRecommendations.ts)
// and never appears in the database, but IS a real value seen by any
// consumer reading the ephemeral bundle directly (e.g. buildExecutiveBriefing).
// "expired" is declared in the type but has no writer anywhere -- mapped
// defensively for forward-safety, not because it is reachable today.
// "monitoring" is deliberately NOT mapped here: it is only ever written to
// the separate operational_incidents.status field, never to a
// recommendation. A recommendation with status "monitoring" has never been
// observed and must resolve to "unknown", not be silently accepted.
const RECOMMENDATION_STATUS_MAP: Record<string, StageEntry> = {
  open: entry("awaiting_human_decision", false, true),
  pending: entry("awaiting_human_decision", false, true),
  resolved: entry("succeeded", true, false),
  dismissed: entry("dismissed", true, false),
  expired: entry("expired", true, false),
};

// operational_plans.status / AutomationPlanStatus -- real writers:
// "planned", "awaiting_approval", "prepared" (all at safeAutomation.ts
// plan creation only). "expired"/"cancelled" are declared but have no
// writer anywhere in the live codebase -- no code path ever mutates
// operational_plans.status after creation, so every plan that exists
// today is permanently non-terminal from a reporting standpoint. Mapped
// defensively for forward-safety.
const PLAN_STATUS_MAP: Record<string, StageEntry> = {
  planned: entry("in_progress", false, false),
  awaiting_approval: entry("awaiting_human_decision", false, true),
  prepared: entry("in_progress", false, false),
  expired: entry("expired", true, false),
  cancelled: entry("cancelled", true, false),
};

// oyi_goals.status (GoalStatus, src/contracts/goal.ts) -- real
// creation-time writers found: "active" (officeMaterialEventAdapter.ts)
// and "proposed" (ConversationOrchestrator.ts). "understood" is declared
// but has zero writers anywhere. "confirmed" has no confirmed writer for
// a GOAL specifically (the many "confirmed" hits elsewhere in the
// codebase are a different, unrelated device/communication/proposal
// confirmation vocabulary) -- both are mapped defensively, not asserted
// live. "blocked" IS a real, actively-written terminal-in-practice
// status (goalEvaluator.ts: stop-condition match, max-attempts reached,
// negative reply -- each clears next_evaluation_at so the scheduler
// never revisits the goal) but is deliberately NOT included in the
// domain's own exported GOAL_TERMINAL_STATUSES. This mapper honors that
// domain source of truth for `terminal` even though the stage name
// implies finality -- see the documentation's disclosed-tension note.
const GOAL_STATUS_MAP: Record<string, StageEntry> = {
  understood: entry("not_started", false, false),
  proposed: entry("awaiting_human_decision", false, true),
  confirmed: entry("in_progress", false, false),
  active: entry("in_progress", false, false),
  observing: entry("in_progress", false, false),
  action_due: entry("in_progress", false, false),
  executing: entry("in_progress", false, false),
  verifying: entry("in_progress", false, false),
  waiting: entry("in_progress", false, false),
  reevaluating: entry("in_progress", false, false),
  paused: entry("paused", false, false),
  completed: entry("succeeded", true, false),
  blocked: entry("failed_execution", false, false),
  failed: entry("failed_execution", true, false),
  cancelled: entry("cancelled", true, false),
  expired: entry("expired", true, false),
  needs_human: entry("awaiting_human_input", false, true),
};

// Office crm_tasks status, as seen through Backend's own
// TASK_STATUS_TRANSITIONS bridge constant (officeActionProposal.ts).
// Backend has no direct database access to Office's crm_tasks table --
// this is the complete real vocabulary Backend's own bridge code
// declares and depends on. "completed"/"cancelled" are terminal because
// TASK_STATUS_TRANSITIONS maps both to an empty transition-target array.
const TASK_STATUS_MAP: Record<string, StageEntry> = {
  open: entry("not_started", false, false),
  in_progress: entry("in_progress", false, false),
  completed: entry("succeeded", true, false),
  cancelled: entry("cancelled", true, false),
};

// Facility automation_approvals.status -- 9 declared values (Wave 0/5
// audit), all with real writers per that prior audit's own findings.
const AUTOMATION_APPROVAL_STATUS_MAP: Record<string, StageEntry> = {
  pending_approval: entry("awaiting_human_decision", false, true),
  approved: entry("in_progress", false, false),
  executing: entry("in_progress", false, false),
  succeeded: entry("succeeded", true, false),
  failed: entry("failed_execution", true, false),
  verification_failed: entry("failed_execution", true, false),
  rejected: entry("rejected_by_human", true, false),
  cancelled: entry("cancelled", true, false),
  expired: entry("expired", true, false),
};

// ExecutionLedgerRecord.status (ExecutionStatus,
// src/oyi-core/runtime/executionLedger.ts) -- the cross-cutting
// signal/automation execution ledger. Real writers found: "recorded"
// (signal accepted, execution opened) and "executed" (accepted
// completion). "failed" is a REAL writer (service.ts, twice) that is
// NOT declared in the ExecutionStatus type at all -- an undeclared-but-
// real literal, the mirror image of the plan/recommendation/goal
// declared-but-dead literals found elsewhere in this inventory.
// "pending_confirmation"/"confirmed"/"denied"/"expired" are declared in
// the type but no writer was found for any of them -- mapped
// defensively from their names, not asserted live.
const AUTOMATION_RUN_STATUS_MAP: Record<string, StageEntry> = {
  pending_confirmation: entry("awaiting_human_decision", false, true),
  confirmed: entry("in_progress", false, false),
  denied: entry("rejected_by_human", true, false),
  expired: entry("expired", true, false),
  recorded: entry("in_progress", false, false),
  executed: entry("succeeded", true, false),
  failed: entry("failed_execution", true, false),
};

// WorkflowStatus (src/oyi-core/contracts/workflow.ts) -- confirmed the
// genuinely live declaration (imported by WorkflowService,
// WorkflowStateMachine, WorkflowRepository, ActionService,
// ConversationOrchestrator, DeviceActionCapabilityModules). Terminality
// below is copied directly from WorkflowStateMachine.ts's own exported
// TERMINAL array, not re-derived. "permission_restricted" is mapped to
// "policy_denied" specifically because it is the one real, named
// instance in this whole inventory of an authority/permission check
// concluding a workflow, as distinct from a human explicitly rejecting
// something or an execution genuinely failing.
//
// NOTE: two OTHER, separately-declared "WorkflowStatus" types also exist
// in this codebase (src/oyi-core/runtime/conversationWorkflowRuntime.ts
// and the legacy src/intelligence-core/workflows.ts) with different
// literal sets. They are deliberately NOT mapped here -- see this
// slice's documentation's same-class search for why, and do not add
// their literals to this table without re-verifying which type a given
// caller is actually using.
const WORKFLOW_STATUS_MAP: Record<string, StageEntry> = {
  collecting_inputs: entry("in_progress", false, false),
  awaiting_clarification: entry("awaiting_human_input", false, true),
  ready_for_review: entry("awaiting_human_decision", false, true),
  awaiting_approval: entry("awaiting_human_decision", false, true),
  approved: entry("in_progress", false, false),
  executing: entry("in_progress", false, false),
  verifying: entry("in_progress", false, false),
  answered: entry("succeeded", true, false),
  empty: entry("no_outcome", true, false),
  unavailable: entry("no_outcome", true, false),
  unsupported: entry("no_outcome", true, false),
  permission_restricted: entry("policy_denied", true, false),
  completed: entry("succeeded", true, false),
  failed: entry("failed_execution", true, false),
  cancelled: entry("cancelled", true, false),
  expired: entry("expired", true, false),
  superseded: entry("superseded", true, false),
};

// OfficeActionProposalStatus / GovernedActionProposal
// (src/contracts/governedAction.ts) -- the "conversation proposal"
// object. 6 declared values, read directly from source.
const CONVERSATION_PROPOSAL_STATUS_MAP: Record<string, StageEntry> = {
  pending: entry("awaiting_human_decision", false, true),
  confirmed: entry("in_progress", false, false),
  cancelled: entry("cancelled", true, false),
  expired: entry("expired", true, false),
  superseded: entry("superseded", true, false),
  executed: entry("succeeded", true, false),
};

// CommunicationRuntime dispatch status (src/services/communicationRuntime
// /CommunicationRuntime.ts) -- real inline writers found for every value
// below. "rejected" is mapped to "policy_denied", not
// "rejected_by_human": every real "rejected" reason found in source
// (recipient_opted_out, validation failure, rate_limited) is a system/
// policy check, never an explicit human decision.
const COMMUNICATION_STATUS_MAP: Record<string, StageEntry> = {
  clarification_required: entry("awaiting_human_input", false, true),
  rejected: entry("policy_denied", true, false),
  ready: entry("in_progress", false, false),
  confirmed: entry("in_progress", false, false),
  sending: entry("in_progress", false, false),
  sent: entry("succeeded", true, false),
  failed: entry("failed_execution", true, false),
  cancelled: entry("cancelled", true, false),
};

// office_handoffs status, as seen through officeHandoffBridge.ts --
// deliberately empty. Office is the sole authority for handoff status;
// Backend's own bridge code declares the field as an untyped `string`
// and never compares it against any literal anywhere. There is no real,
// evidenced Backend-side vocabulary to map, so every handoff status
// honestly resolves to "unknown" rather than inventing one.
const HANDOFF_STATUS_MAP: Record<string, StageEntry> = {};

// Wave 7 Slice 5 -- oyi_decisions.status (DecisionStatus,
// src/contracts/decision.ts). This is a genuinely NEW, real, persisted
// lifecycle (not merely a reporting convenience) -- terminality below is
// copied directly from the domain's own exported
// DECISION_TERMINAL_STATUSES, not re-derived. "selected"/"approved" both
// map to in_progress: a Decision does not "succeed" or "complete" the
// way an execution does -- it remains the currently-valid selected
// course of action until superseded/rejected/cancelled, so neither
// literal maps to "succeeded".
const DECISION_STATUS_MAP: Record<string, StageEntry> = {
  selected: entry("in_progress", false, false),
  awaiting_human: entry("awaiting_human_decision", false, true),
  approved: entry("in_progress", false, false),
  rejected: entry("rejected_by_human", true, false),
  superseded: entry("superseded", true, false),
  cancelled: entry("cancelled", true, false),
};

const STATUS_MAPS: Record<LifecycleObjectType, Record<string, StageEntry>> = {
  recommendation: RECOMMENDATION_STATUS_MAP,
  plan: PLAN_STATUS_MAP,
  goal: GOAL_STATUS_MAP,
  task: TASK_STATUS_MAP,
  automation_approval: AUTOMATION_APPROVAL_STATUS_MAP,
  automation_run: AUTOMATION_RUN_STATUS_MAP,
  workflow: WORKFLOW_STATUS_MAP,
  conversation_proposal: CONVERSATION_PROPOSAL_STATUS_MAP,
  communication: COMMUNICATION_STATUS_MAP,
  handoff: HANDOFF_STATUS_MAP,
  decision: DECISION_STATUS_MAP,
};

function normalizedKey(status: unknown): string | null {
  if (typeof status !== "string") return null;
  const trimmed = status.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

// Pure translation only. Never persists, never mutates its input, and
// never replaces an object's own authoritative status field -- callers
// keep reading/writing the real status exactly as they do today. An
// unrecognized objectType/status pairing (unknown literal, wrong object
// type for a given literal, null/missing status, unexpected casing)
// always resolves to stage "unknown" with mapped:false -- it never
// defaults to a false-positive stage like "in_progress" or "succeeded".
export function normalizeLifecycleStage(input: NormalizeLifecycleStageInput): LifecycleStageResult {
  const objectType = input?.objectType;
  const key = normalizedKey(input?.status);
  const rawStatus = typeof input?.status === "string" ? input.status : key;
  const map = objectType ? STATUS_MAPS[objectType] : undefined;
  const found = map && key ? map[key] : undefined;
  if (!found) {
    return { objectType, rawStatus, stage: "unknown", terminal: false, awaitingHuman: false, mapped: false };
  }
  return { objectType, rawStatus, stage: found.stage, terminal: found.terminal, awaitingHuman: found.awaitingHuman, mapped: true };
}

export function isKnownLifecycleObjectType(value: unknown): value is LifecycleObjectType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STATUS_MAPS, value);
}
