// Oyi Autonomous Work Runtime -- the decision loop (Part D). Pure
// evaluation logic: given a due goal, decide success/stop/next-action,
// execute the next step through the EXISTING CommunicationRuntime (the
// same one the conversational and automation paths already use -- no
// second execution mechanism), and return the updated goal for the
// caller to persist. Never loops unboundedly: every path either
// advances the plan, completes, or stops -- bounded by max_attempts and
// the plan's own fixed length.
import { communicationRuntime } from "../communicationRuntime/CommunicationRuntime";
import { classifyInboundReply, coarseSentimentFromOutcome } from "../communicationRuntime/replyClassifier";
import { resolveRecipientByEntity } from "../recipientResolutionService";
import { createFollowUpTask } from "../officeTaskBridgeService";
import type {
  GoalRecord,
  GoalPlanStep,
  GoalReplyBranch,
  GoalExecutionHistoryItem,
  GoalEvidenceItem,
} from "../../contracts/goal";
import type { CommunicationRequest, InboundReplyOutcome } from "../../contracts/communication";

function nowIso() {
  return new Date().toISOString();
}

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3600_000).toISOString();
}

async function latestInboundAcross(threadReferences: string[], sinceIso: string | null) {
  for (const ref of threadReferences) {
    const thread = await communicationRuntime.getThread(ref, 10);
    const inbound = thread.find((m) => m.direction === "inbound" && (!sinceIso || new Date(m.created_at).getTime() > new Date(sinceIso).getTime()));
    if (inbound) return inbound;
  }
  return null;
}

function pushHistory(history: GoalExecutionHistoryItem[], item: GoalExecutionHistoryItem): GoalExecutionHistoryItem[] {
  return [...history, item].slice(-100);
}

function pushEvidence(evidence: GoalEvidenceItem[], item: GoalEvidenceItem): GoalEvidenceItem[] {
  return [...evidence, item].slice(-100);
}

async function executeStep(goal: GoalRecord, step: GoalPlanStep): Promise<{ ok: boolean; detail: string; providerMessageId: string | null }> {
  if (step.action_type === "escalate") {
    // No provider call -- escalation just surfaces to the requester via
    // the existing NotificationService-equivalent read path (Office
    // visibility, Part M); nothing to dispatch here.
    return { ok: true, detail: "Escalated to requester.", providerMessageId: null };
  }
  if (step.action_type === "create_task") {
    let assigneeEmail: string | null = null;
    if (goal.requesting_actor_id) {
      const staff = await resolveRecipientByEntity("staff", goal.requesting_actor_id).catch(() => null);
      assigneeEmail = staff?.email || null;
    }
    const result = await createFollowUpTask({
      title: step.body || `Follow up: ${goal.objective}`,
      description: `Auto-created by Oyi as a step in this goal: ${goal.objective}`,
      leadId: goal.target_entities.lead_id,
      assigneeEmail,
    });
    return { ok: result.ok, detail: result.ok ? `Task ${result.taskId} created.` : result.reason || "Task creation failed.", providerMessageId: null };
  }
  if (step.channel === "voice_call") {
    // Telephony (Part F) -- honest, not fabricated: no provider is
    // configured anywhere in this environment (confirmed via audit).
    // The plan step itself is real; the dispatch honestly fails rather
    // than pretending a call happened.
    const request: CommunicationRequest = {
      conversation_thread_id: goal.conversation_thread_id,
      actor_id: goal.requesting_actor_id,
      surface: goal.surface,
      source: "automation",
      source_record_type: "goal",
      source_record_id: goal.id,
      intent: "goal_plan_step",
      channel: "voice_call",
      recipient_hint: {
        email: goal.target_entities.email,
        phone: goal.target_entities.phone,
        whatsapp_phone: goal.target_entities.whatsapp_phone,
        lead_id: goal.target_entities.lead_id,
        contact_id: goal.target_entities.contact_id,
      },
      body: step.body || "(voice call -- no message body)",
      pre_authorized: true,
    };
    const plan = await communicationRuntime.plan(request);
    if (plan.status !== "ready") return { ok: false, detail: plan.status === "rejected" ? plan.detail : plan.reason, providerMessageId: null };
    const authorized = communicationRuntime.authorize(plan.record, { confirmed: true });
    const { result } = await communicationRuntime.dispatch(authorized);
    return { ok: result.status === "sent", detail: result.failure_detail || "Call initiated.", providerMessageId: result.provider_message_id };
  }
  // email / whatsapp / sms / internal_message -- the same governed
  // dispatch every conversational/automation send already uses,
  // pre_authorized because the OVERALL goal was already confirmed by
  // the requester (no redundant per-step confirmation, matching the
  // automation runtime's own rule).
  const request: CommunicationRequest = {
    conversation_thread_id: goal.conversation_thread_id,
    actor_id: goal.requesting_actor_id,
    surface: goal.surface,
    source: "automation",
    source_record_type: "goal",
    source_record_id: goal.id,
    intent: "goal_plan_step",
    channel: step.channel as CommunicationRequest["channel"],
    recipient_hint: {
      email: goal.target_entities.email,
      phone: goal.target_entities.phone,
      whatsapp_phone: goal.target_entities.whatsapp_phone,
      lead_id: goal.target_entities.lead_id,
      contact_id: goal.target_entities.contact_id,
    },
    body: step.body || goal.objective,
    pre_authorized: true,
  };
  const plan = await communicationRuntime.plan(request);
  if (plan.status !== "ready") {
    return { ok: false, detail: plan.status === "rejected" ? plan.detail : plan.reason, providerMessageId: null };
  }
  const authorized = communicationRuntime.authorize(plan.record, { confirmed: true });
  const { result } = await communicationRuntime.dispatch(authorized);
  return { ok: result.status === "sent", detail: result.failure_detail || "Sent.", providerMessageId: result.provider_message_id };
}

// Applies a matched GoalReplyBranch (contracts/goal.ts) -- lets a
// classified reply BRANCH the goal instead of only advancing/completing
// it linearly. create_task calls the REAL Office Task bridge
// (officeTaskBridgeService.ts -> crm_tasks); never claims a task was
// created when the bridge call actually failed.
async function applyReplyBranch(goal: GoalRecord, branch: GoalReplyBranch, now: string): Promise<GoalRecord> {
  if (branch.action === "complete") {
    return { ...goal, status: "completed", completion_reason: "Reply matched a completion condition.", next_evaluation_at: null };
  }
  if (branch.action === "stop") {
    return { ...goal, status: "blocked", completion_reason: "Reply matched a stop condition.", next_evaluation_at: null };
  }
  if (branch.action === "escalate") {
    return { ...goal, status: "needs_human", completion_reason: "Reply matched an escalation condition.", next_evaluation_at: null };
  }
  // create_task
  let assigneeEmail: string | null = null;
  if (goal.requesting_actor_id) {
    const staff = await resolveRecipientByEntity("staff", goal.requesting_actor_id).catch(() => null);
    assigneeEmail = staff?.email || null;
  }
  const taskTitle = branch.task_title || `Follow up: ${goal.objective}`;
  const taskResult = await createFollowUpTask({
    title: taskTitle,
    description: `Auto-created by Oyi following a reply on this goal: ${goal.objective}`,
    leadId: goal.target_entities.lead_id,
    assigneeEmail,
  });
  return {
    ...goal,
    status: taskResult.ok ? "completed" : "needs_human",
    completion_reason: taskResult.ok ? `Reply matched -- created task "${taskTitle}".` : `Reply matched a create_task branch, but task creation failed: ${taskResult.reason}`,
    linked_tasks: taskResult.taskId ? [...goal.linked_tasks, taskResult.taskId] : goal.linked_tasks,
    execution_history: pushHistory(goal.execution_history, {
      occurred_at: now,
      step_index: null,
      action: "reply_branch.create_task",
      outcome: taskResult.ok ? "success" : "failed",
      detail: taskResult.ok ? `Task ${taskResult.taskId} created.` : taskResult.reason || "unknown error",
    }),
    next_evaluation_at: null,
  };
}

// Evaluates one due goal and returns the updated (NOT YET PERSISTED)
// record. The caller (goalScheduler.ts) persists it. Bounded: every
// branch below either completes the goal, stops it, or advances exactly
// one plan step and schedules exactly one future evaluation -- never an
// unbounded loop within a single call.
export async function evaluateGoal(goal: GoalRecord): Promise<GoalRecord> {
  const now = nowIso();
  let updated: GoalRecord = { ...goal, last_evaluated_at: now };

  // 1) Hard stop: deadline passed.
  if (updated.schedule.deadline && new Date(updated.schedule.deadline).getTime() < Date.now()) {
    return { ...updated, status: "expired", completion_reason: "Deadline passed before the goal completed.", next_evaluation_at: null };
  }
  // 2) Hard stop: attempts exhausted.
  if (updated.attempts_completed >= updated.max_attempts) {
    return { ...updated, status: "blocked", completion_reason: "Maximum attempts reached without meeting the success condition.", next_evaluation_at: null };
  }

  // 3) Check success condition / reply branches against real evidence --
  // never fabricated. The classification itself was already computed
  // ONCE by the inbound event pipeline at receive time
  // (inboundEventPipeline.ts) and stored on the communication row;
  // read it rather than re-classifying (never a second, parallel
  // intelligence system). The lazy classifyInboundReply() fallback below
  // only fires for a row some other, non-pipeline path persisted without
  // ever classifying it.
  if (updated.linked_communication_threads.length) {
    const inbound = await latestInboundAcross(updated.linked_communication_threads, updated.observations.at(-1)?.observed_at || updated.created_at);
    if (inbound) {
      const alreadyObserved = updated.observations.some((o) => o.source_reference === inbound.communication_id);
      if (!alreadyObserved) {
        const outcome: InboundReplyOutcome = inbound.outcome_classification || (await classifyInboundReply(inbound.body || "")).outcome;
        updated = {
          ...updated,
          observations: [...updated.observations, { observed_at: now, kind: "inbound_reply", detail: inbound.body || "", source_reference: inbound.communication_id }],
          evidence: pushEvidence(updated.evidence, { recorded_at: now, kind: `inbound_reply:${outcome}`, summary: (inbound.body || "").slice(0, 200), reference: inbound.communication_id }),
        };

        // Unconditional governance -- a real unsubscribe reply stops
        // THIS goal outright, regardless of its own success/stop
        // conditions or reply_branches. The opt-out record itself was
        // already written by the inbound pipeline at receive time, so
        // future sends to this recipient are already blocked at
        // CommunicationRuntime.plan() -- this just makes sure the goal
        // stops trying too, instead of hitting that rejection on its
        // next scheduled step.
        if (outcome === "unsubscribe") {
          return { ...updated, status: "cancelled", completion_reason: "The recipient asked not to be contacted again.", next_evaluation_at: null };
        }

        // Explicit branch -- "if he says he's interested, create a task."
        const branch = updated.reply_branches.find((b) => b.on_outcomes.includes(outcome));
        if (branch) {
          return applyReplyBranch(updated, branch, now);
        }

        if (updated.success_condition.type === "reply_received") {
          return { ...updated, status: "completed", completion_reason: "A reply was received.", next_evaluation_at: null };
        }
        if (updated.success_condition.type === "positive_reply") {
          const sentiment = coarseSentimentFromOutcome(outcome);
          if (sentiment === "positive") {
            return { ...updated, status: "completed", completion_reason: "A positive reply was received.", next_evaluation_at: null };
          }
          if (sentiment === "negative" && updated.stop_condition.type === "negative_reply") {
            return { ...updated, status: "blocked", completion_reason: "A negative reply was received.", next_evaluation_at: null };
          }
          // Neutral/unknown reply -- not a stop condition on its own;
          // continue the plan (the reply is recorded as evidence either way).
        }
      }
    }
  }

  // 4) Advance the staged plan.
  const step = updated.plan[updated.current_step_index];
  if (!step) {
    return { ...updated, status: "completed", completion_reason: "Plan finished with no explicit success condition met.", next_evaluation_at: null };
  }
  if (step.status === "done" || step.status === "skipped") {
    // Shouldn't normally happen (current_step_index should already have
    // advanced), but never re-execute a finished step.
    return { ...updated, current_step_index: updated.current_step_index + 1, next_evaluation_at: now };
  }

  // A step whose skip_if condition is already satisfied (e.g. the
  // WhatsApp fallback when a reply already arrived) is skipped, not executed.
  if (step.skip_if === "reply_received" && updated.observations.some((o) => o.kind === "inbound_reply")) {
    const nextPlan = updated.plan.map((s) => (s.step_index === step.step_index ? { ...s, status: "skipped" as const, executed_at: now } : s));
    return { ...updated, plan: nextPlan, current_step_index: updated.current_step_index + 1, next_evaluation_at: now };
  }

  if (step.action_type === "escalate") {
    const outcome = await executeStep(updated, step);
    const nextPlan = updated.plan.map((s) => (s.step_index === step.step_index ? { ...s, status: "done" as const, executed_at: now, result: { ok: outcome.ok } } : s));
    return {
      ...updated,
      status: "needs_human",
      plan: nextPlan,
      current_step_index: updated.current_step_index + 1,
      execution_history: pushHistory(updated.execution_history, { occurred_at: now, step_index: step.step_index, action: "escalate", outcome: "success", detail: outcome.detail }),
      next_evaluation_at: null,
      completion_reason: "Escalated to the requester for a decision.",
    };
  }

  const outcome = await executeStep(updated, step);
  const nextPlan = updated.plan.map((s) =>
    s.step_index === step.step_index ? { ...s, status: (outcome.ok ? "done" : "failed") as GoalPlanStep["status"], executed_at: now, result: { ok: outcome.ok, detail: outcome.detail, provider_message_id: outcome.providerMessageId } } : s
  );
  const threadRef = updated.target_entities.whatsapp_phone
    ? `whatsapp:${updated.target_entities.whatsapp_phone}`
    : updated.target_entities.email
    ? `email:${updated.target_entities.email.toLowerCase()}`
    : null;
  const linkedThreads = threadRef && !updated.linked_communication_threads.includes(threadRef) ? [...updated.linked_communication_threads, threadRef] : updated.linked_communication_threads;

  const nextIndex = updated.current_step_index + 1;
  const hasMoreSteps = nextIndex < updated.plan.length;
  const nextStep = hasMoreSteps ? updated.plan[nextIndex] : null;

  return {
    ...updated,
    plan: nextPlan,
    current_step_index: nextIndex,
    attempts_completed: updated.attempts_completed + 1,
    linked_communication_threads: linkedThreads,
    execution_history: pushHistory(updated.execution_history, {
      occurred_at: now,
      step_index: step.step_index,
      action: `${step.action_type}:${step.channel}`,
      outcome: outcome.ok ? "success" : "failed",
      detail: outcome.detail,
    }),
    status: !outcome.ok ? "blocked" : hasMoreSteps ? "waiting" : "completed",
    completion_reason: !outcome.ok ? `Step failed: ${outcome.detail}` : hasMoreSteps ? null : "Plan completed with no further steps.",
    next_evaluation_at: outcome.ok && hasMoreSteps ? addHours(now, nextStep!.wait_hours) : null,
  };
}
