// Oyi Autonomous Work Runtime -- canonical goal model. Orchestrates the
// EXISTING domain systems (CommunicationRuntime, recipient resolution,
// the Shared Automation Runtime's scheduler-tick pattern, governed
// action proposals) rather than duplicating them. A goal's "plan" is a
// staged sequence of steps; the decision loop (goalRuntime.ts) advances
// through it, dispatching each step through the system that already
// owns that kind of action.

import type { InboundReplyOutcome } from "./communication";

export type GoalStatus =
  | "understood"
  | "proposed"
  | "confirmed"
  | "active"
  | "observing"
  | "action_due"
  | "executing"
  | "verifying"
  | "waiting"
  | "reevaluating"
  | "paused"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled"
  | "expired"
  | "needs_human";

export const GOAL_TERMINAL_STATUSES: GoalStatus[] = ["completed", "cancelled", "expired", "failed"];
export const GOAL_DUE_STATUSES: GoalStatus[] = ["active", "observing", "action_due", "waiting", "reevaluating"];

export type GoalTargetEntities = {
  lead_id: string | null;
  contact_id: string | null;
  user_id: string | null;
  organization_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp_phone: string | null;

  // Wave 7 Slice 6 -- GoalRuntime domain generalization. Optional (not
  // required-nullable like the fields above) specifically so every
  // existing Office/commercial call site's own object literal keeps
  // compiling unchanged -- these three describe what an OPERATIONAL
  // (Facility/Consumer) goal concerns, never what an Office/commercial
  // goal concerns; the two families are mutually exclusive in practice,
  // never required to coexist. Absence is the honest default for every
  // goal that predates this column and for every Office goal going
  // forward. Identity ONLY -- see goalDeviceActor.ts and
  // DeviceCommandAuthority for why target identity is never treated as
  // authorization.
  estate_id?: string | null;
  home_id?: string | null;
  device_id?: string | null;

  // Wave 7 Slice 7 -- lead/opportunity identity resolution. Optional, for
  // the same reason as the operational fields above: Office's real
  // crm_opportunities.id (the specific commercial pursuit this goal
  // concerns, e.g. one of several simultaneous JV sites for the same
  // lead), when the producing material event supplied one. Absent for
  // every goal created before this field existed and for any producer
  // that only knows the lead, never fabricated as a synthetic identity.
  opportunity_id?: string | null;

  // Wave 8 Slice 4 -- Commercial Outcome Evaluator. The one structured
  // field a commercial Goal can use to state its intended Office
  // Opportunity stage (a real literal from Office's own PIPELINE_STAGES
  // vocabulary -- see commercialStageOrder.ts's own documented mirror).
  // Optional, for the same reason as every other field in this block: no
  // existing Goal producer sets this today (confirmed by audit -- no
  // structured commercial target contract existed before this field was
  // added), so it is honestly absent everywhere until a future producer
  // populates it. commercialOutcomeEvaluator.ts treats its absence as
  // "no target specified," never as an invented default.
  commercial_target_stage?: string | null;
};

export type GoalSuccessCondition =
  | { type: "reply_received" }
  | { type: "positive_reply" }
  | { type: "task_completed"; task_id: string }
  | { type: "call_answered" }
  | { type: "manual" };

export type GoalStopCondition =
  | { type: "max_attempts_reached" }
  | { type: "deadline_passed" }
  | { type: "negative_reply" }
  | { type: "none" };

// "device" mirrors the existing "escalation" precedent -- a non-communication
// step still has to fill this required field honestly; neither literal
// implies a message channel.
export type GoalPlanStepChannel = "email" | "whatsapp" | "sms" | "voice_call" | "internal_message" | "escalation" | "device";
export type GoalPlanStepStatus = "pending" | "due" | "executing" | "done" | "skipped" | "failed";

// Wave 7 Slice 6 -- the minimum a device step needs to reach the
// canonical execution boundary (executionRegistry.ts::executeRegisteredAction
// -> DeviceCommandAuthority -> executeDeviceCommandForActor). Deliberately
// narrow: three real, already-registered action ids only (device.on/off/toggle
// -- intelligence-core/executionRegistry.ts's own real, available:true set),
// no provider-specific payload duplicated here. `command` is passed through
// unchanged to the same executor every other device.* caller already uses.
export type GoalDeviceCommand = {
  device_id: string;
  action_id: "device.on" | "device.off" | "device.toggle";
  command: Record<string, unknown>;
};

// One stage of a staged follow-up plan, e.g. step 0 = send the proposal
// now; step 1 = wait 48h, if no reply WhatsApp; step 2 = wait 48h, if
// still no reply, call. wait_hours is measured from the PRECEDING
// step's completion, not from goal creation.
export type GoalPlanStep = {
  step_index: number;
  channel: GoalPlanStepChannel;
  action_type: "send_communication" | "call" | "escalate" | "wait_for_reply" | "create_task" | "device_action";
  body: string | null;
  wait_hours: number;
  // The condition that, if already true when this step becomes due,
  // skips it (e.g. "no_reply" -- skip the WhatsApp fallback step if a
  // reply already arrived during the wait).
  skip_if: "reply_received" | "positive_reply" | "task_completed" | null;
  status: GoalPlanStepStatus;
  executed_at: string | null;
  result: Record<string, unknown> | null;

  // Wave 7 Slice 6 -- optional, non-null ONLY for action_type ===
  // "device_action". Every existing plan-step object literal keeps
  // compiling unchanged (optional, not required-nullable) since no
  // Office/commercial step ever sets it.
  device_command?: GoalDeviceCommand | null;
};

export type GoalObservation = {
  observed_at: string;
  kind: string; // e.g. "inbound_reply", "communication_delivered", "communication_failed", "task_status_changed"
  detail: string;
  source_reference: string | null; // e.g. a communication_id or thread_reference
};

export type GoalEvidenceItem = {
  recorded_at: string;
  kind: string;
  summary: string;
  reference: string | null; // communication_id / task_id / call reference
};

export type GoalExecutionHistoryItem = {
  occurred_at: string;
  step_index: number | null;
  action: string;
  outcome: "success" | "failed" | "skipped";
  detail: string;
};

export type GoalSchedule = {
  deadline: string | null;
  recurrence: string | null;
  timezone: string | null;
};

export type GoalCommunicationPreferences = {
  allowed_channels: GoalPlanStepChannel[];
  escalation_policy: "notify_requester" | "none";
};

// Live Reply Loop programme -- lets a reply BRANCH the goal instead of
// only advancing/completing it linearly ("if he says he's interested,
// create a task for me to call him"; "stop contacting him if he says
// he's not interested"). Checked against the classified
// InboundReplyOutcome (replyClassifier.ts) before the plain success/
// stop-condition checks in evaluateGoal(). "unsubscribe" is handled
// UNCONDITIONALLY by evaluateGoal() regardless of whether a goal
// declares a branch for it -- that one is governance, not preference.
export type GoalReplyBranch = {
  on_outcomes: InboundReplyOutcome[];
  action: "complete" | "stop" | "escalate" | "create_task";
  task_title: string | null; // required when action === "create_task"
};

export type GoalRecord = {
  id: string;
  correlation_id: string;
  requesting_actor_id: string | null;
  surface: string;
  conversation_thread_id: string | null;
  organization_scope: string | null;

  // Wave 7 Slice 2 -- identity-chain repair (lineage, not identity/
  // authority/execution). The canonical_signal_key
  // (materialization.ts::canonicalSignalKey) of the signal that
  // motivated this goal's creation, when one genuinely exists and was
  // known at creation time. NULL is the honest answer for every goal
  // that isn't signal-driven -- a conversational proposal, a manually
  // created goal, a legacy goal predating this column -- never
  // back-filled or inferred from timestamp/text/entity similarity. This
  // is a REQUIRED field (not optional) specifically so every caller of
  // GoalRuntime.create() has to make an explicit, deliberate choice
  // between a real key and null, rather than silently omitting lineage.
  canonical_signal_key: string | null;

  objective: string;
  target_entities: GoalTargetEntities;

  status: GoalStatus;
  success_condition: GoalSuccessCondition;
  stop_condition: GoalStopCondition;
  reply_branches: GoalReplyBranch[];

  plan: GoalPlanStep[];
  current_step_index: number;

  schedule: GoalSchedule;
  event_conditions: unknown[];
  communication_preferences: GoalCommunicationPreferences;

  max_attempts: number;
  attempts_completed: number;

  observations: GoalObservation[];
  evidence: GoalEvidenceItem[];

  linked_crm_records: Record<string, unknown>;
  linked_tasks: string[];
  linked_meetings: string[];
  linked_automations: string[];
  linked_communication_threads: string[];

  execution_history: GoalExecutionHistoryItem[];

  last_evaluated_at: string | null;
  next_evaluation_at: string | null;
  completion_reason: string | null;

  created_at: string;
  updated_at: string;
};
