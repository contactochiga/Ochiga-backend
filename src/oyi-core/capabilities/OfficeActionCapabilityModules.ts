// Oyi Conversational Runtime Completion Programme, Phase 3 — Governed
// Action Proposals, capability modules.
//
// These are PROPOSAL-ONLY capabilities: createDraft() never writes to any
// database. It resolves the active record (via Phase 2 continuity's
// already-populated *_context slot), pre-validates the requested change
// against a mirrored copy of Office's own transition graph, and returns a
// structured proposal for the user to confirm or cancel. The actual
// mutation happens only through Office's own existing, already-audited
// updateOperationalRecord() PATCH route, triggered client-side after
// confirmation -- see officeActionProposal.ts for the full architecture
// note on why this is a two-turn propose/execute split rather than a
// single-turn authorize-and-execute.
import type { CapabilityContext, CapabilityModule } from "../contracts/capability";
import type { DomainResult } from "../contracts/domainResult";
import type { SemanticFrame } from "../contracts/semanticFrame";
import type { GovernedActionProposal } from "../../contracts/governedAction";
import { resultPresentation } from "./ReadCapabilityModules";
import {
  taskContextSlot,
  meetingContextSlot,
  supportContextSlot,
  automationContextSlot,
  portfolioContextSlot,
  partnershipContextSlot,
  unavailableResult,
} from "./OfficeCorporateCapabilityModules";
import { loadThreadResultSetContext } from "../context/resultSetContext";
import {
  parseTaskMutationIntent,
  parseMeetingMutationIntent,
  parseSupportMutationIntent,
  parseAutomationMutationIntent,
  isAutomationMutationMessage,
  parsePortfolioMutationIntent,
  parsePartnershipMutationIntent,
  parseBatchTargetIntent,
  parseBatchMutationIntent,
  isTaskMutationMessage,
  buildGovernedActionProposal,
  buildBatchGovernedActionProposal,
  proposalPublicView,
  TASK_STATUS_TRANSITIONS,
  MEETING_STATUS_TRANSITIONS,
  SUPPORT_STATUS_TRANSITIONS,
  PORTFOLIO_STATUS_TRANSITIONS,
  PARTNERSHIP_STATUS_TRANSITIONS,
  validateTransition,
} from "../context/officeActionProposal";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function threadAndActor(context: CapabilityContext): { threadId: string; actorId: string } | null {
  const threadId = text(context.input.thread_id);
  const actorId = text(context.actor?.id);
  if (!threadId || !actorId) return null;
  return { threadId, actorId };
}

function draftUnavailable(answer: string): DomainResult {
  return unavailableResult(answer);
}

// Milestone 2 -- shared across every *BatchDraft builder below. "all"
// takes every ref, "count" takes the first N, "ordinal" (a single
// named position -- "pause the second one") takes exactly one ref at
// that position, or none if the list is shorter than that (never
// wraps/guesses a different target).
function resolveBatchTargets<T>(
  objectRefs: T[],
  batchTarget: { type: "all" } | { type: "count"; count: number } | { type: "ordinal"; position: number }
): T[] {
  if (batchTarget.type === "all") return objectRefs;
  if (batchTarget.type === "ordinal") {
    const ref = objectRefs[batchTarget.position - 1];
    return ref ? [ref] : [];
  }
  return objectRefs.slice(0, batchTarget.count);
}

function proposalResult(answer: string, proposal: ReturnType<typeof buildGovernedActionProposal>): DomainResult {
  return {
    status: "awaiting_confirmation",
    answer,
    presentation_policy: resultPresentation("approval"),
    metadata: {
      confirmations: [proposalPublicView(proposal)],
      pending_action_proposal: proposal,
    },
  };
}

// ---------------------------------------------------------------------
// Tasks — batch (Phase 4, PR 4): "the first two", "all of them" against
// the thread's last office_tasks list turn (office_tasks.query.read).
// Builds N independent child proposals using the SAME per-operation
// shape as the single-record path below, just parameterized by a
// ResultSetObjectRef instead of the single open task_context slot --
// each child's "current" state comes from the ref's own already-
// persisted label/status/attributes (Phase 4 PR 3's same no-re-fetch
// principle), not a fresh read. A target that fails pre-validation
// (e.g. already completed) is skipped and named in the description
// rather than silently dropped or blocking the whole batch.
// ---------------------------------------------------------------------
async function buildTaskBatchDraft(context: CapabilityContext, batchTarget: { type: "count"; count: number } | { type: "all" } | { type: "ordinal"; position: number }): Promise<DomainResult> {
  const intent = parseBatchMutationIntent(context.input.message);
  if (!intent) {
    return draftUnavailable('I didn\'t catch a clear change to make for that group. Try something like "move the first two to Monday" or "assign these to <name>".');
  }
  const ids = threadAndActor(context);
  if (!ids) {
    return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
  }
  const resultSet = await loadThreadResultSetContext(context.input.thread_id);
  if (!resultSet || resultSet.domain !== "office_tasks" || !resultSet.object_refs.length) {
    return draftUnavailable("I don't have a recent list of tasks to reference — ask to see your tasks first, then tell me which ones to change.");
  }
  const targets = resolveBatchTargets(resultSet.object_refs, batchTarget);
  if (!targets.length) {
    return draftUnavailable("There's nothing in that list to change.");
  }

  const children: GovernedActionProposal[] = [];
  const includedLabels: string[] = [];
  const skipped: string[] = [];

  for (const ref of targets) {
    const label = ref.label || "This task";
    if (intent.operation === "status_transition") {
      const currentStatus = text(ref.attributes.status) || "open";
      const validation = validateTransition(TASK_STATUS_TRANSITIONS, currentStatus, intent.canonicalValue);
      if (!validation.valid) {
        skipped.push(`"${label}" (${validation.reason})`);
        continue;
      }
      children.push(
        buildGovernedActionProposal({
          threadId: ids.threadId,
          actorId: ids.actorId,
          domain: "office_tasks",
          targetEntityType: "task",
          targetEntityId: ref.canonical_id,
          operation: intent.operation,
          field: intent.field,
          rawValue: intent.rawValue,
          canonicalValue: intent.canonicalValue,
          description: `Move "${label}" from ${titleCase(currentStatus)} to ${titleCase(intent.canonicalValue)}.`,
          previousState: { status: currentStatus },
          authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
          validation,
          riskLevel: "low_risk_action",
          executeDirective: { namespace: "crm", collection: "tasks", record_id: ref.canonical_id, patch: { status: intent.canonicalValue } },
        })
      );
      includedLabels.push(label);
      continue;
    }
    if (intent.operation === "reassign_owner") {
      const previousOwner = text(ref.attributes.owner) || null;
      children.push(
        buildGovernedActionProposal({
          threadId: ids.threadId,
          actorId: ids.actorId,
          domain: "office_tasks",
          targetEntityType: "task",
          targetEntityId: ref.canonical_id,
          operation: intent.operation,
          field: intent.field,
          rawValue: intent.rawValue,
          canonicalValue: intent.canonicalValue,
          description: `Assign "${label}" to ${intent.canonicalValue}${previousOwner ? ` (currently ${previousOwner})` : ""}.`,
          previousState: { assignee: previousOwner },
          authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
          validation: { valid: true, reason: null },
          riskLevel: "consequential_action",
          executeDirective: { namespace: "crm", collection: "tasks", record_id: ref.canonical_id, patch: { assignee: intent.canonicalValue } },
        })
      );
      includedLabels.push(label);
      continue;
    }
    if (intent.operation === "change_priority") {
      const previousPriority = text(ref.attributes.priority) || null;
      children.push(
        buildGovernedActionProposal({
          threadId: ids.threadId,
          actorId: ids.actorId,
          domain: "office_tasks",
          targetEntityType: "task",
          targetEntityId: ref.canonical_id,
          operation: intent.operation,
          field: intent.field,
          rawValue: intent.rawValue,
          canonicalValue: intent.canonicalValue,
          description: `Set "${label}" to ${intent.canonicalValue} priority${previousPriority ? ` (currently ${previousPriority})` : ""}.`,
          previousState: { priority: previousPriority },
          authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
          validation: { valid: true, reason: null },
          riskLevel: "low_risk_action",
          executeDirective: { namespace: "crm", collection: "tasks", record_id: ref.canonical_id, patch: { priority: intent.canonicalValue } },
        })
      );
      includedLabels.push(label);
      continue;
    }
    // change_due_date
    const previousDue = text(ref.attributes.due_at) || null;
    children.push(
      buildGovernedActionProposal({
        threadId: ids.threadId,
        actorId: ids.actorId,
        domain: "office_tasks",
        targetEntityType: "task",
        targetEntityId: ref.canonical_id,
        operation: intent.operation,
        field: intent.field,
        rawValue: intent.rawValue,
        canonicalValue: intent.canonicalValue,
        description: `Move "${label}"'s due date to ${new Date(intent.canonicalValue as string).toDateString()}.`,
        previousState: { due_at: previousDue },
        authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
        validation: { valid: true, reason: null },
        riskLevel: "low_risk_action",
        executeDirective: { namespace: "crm", collection: "tasks", record_id: ref.canonical_id, patch: { due_at: intent.canonicalValue } },
      })
    );
    includedLabels.push(label);
  }

  if (!children.length) {
    return draftUnavailable(`None of those tasks can make that change right now: ${skipped.join("; ")}.`);
  }

  const verb =
    intent.operation === "status_transition"
      ? `move to ${titleCase(intent.canonicalValue)}`
      : intent.operation === "reassign_owner"
      ? `assign to ${intent.canonicalValue}`
      : intent.operation === "change_priority"
      ? `set to ${intent.canonicalValue} priority`
      : `move the due date to ${new Date(intent.canonicalValue as string).toDateString()}`;
  let description = `Ready to ${verb} for ${children.length} task${children.length === 1 ? "" : "s"}: ${includedLabels.map((l) => `"${l}"`).join(", ")}.`;
  if (skipped.length) description += ` Skipped ${skipped.length}: ${skipped.join("; ")}.`;

  const proposal = buildBatchGovernedActionProposal({
    threadId: ids.threadId,
    actorId: ids.actorId,
    domain: "office_tasks",
    operation: intent.operation,
    description,
    riskLevel: intent.operation === "reassign_owner" ? "consequential_action" : "low_risk_action",
    children,
  });
  return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
}

// ---------------------------------------------------------------------
// Tasks — status transition / owner reassignment / due-date change.
// ---------------------------------------------------------------------
function officeTasksWriteModule(): CapabilityModule {
  return {
    key: "office_tasks.write",
    domain: "office_tasks",
    rolloutStatus: "enabled",
    operations: ["status_transition", "reassign_owner", "change_due_date"],
    supported_surfaces: ["office_internal"],
    scope_requirements: [],
    permission_requirements: ["tasks.manage"],
    risk_class: "low_risk_action",
    confirmation_policy: "explicit_confirmation",
    evidence_requirements: [],
    presentation_policy: { primary: "approval", expose_evidence: "summary", allow_internal_ids: false },
    supports: (frame: SemanticFrame) => frame.domain === "office_tasks" && isTaskMutationMessage(frame.normalizedText),
    async resolve() {
      return { supported: true, reason: null };
    },
    async collectEvidence() {
      return [];
    },
    createDraft: async (context: CapabilityContext): Promise<DomainResult> => {
      const batchTarget = parseBatchTargetIntent(context.input.message);
      if (batchTarget) {
        return buildTaskBatchDraft(context, batchTarget);
      }
      const task = taskContextSlot(context);
      if (!task || !task.task_ref) {
        return draftUnavailable("I don't have a specific task open to check — select one in Tasks first, then ask me about it.");
      }
      const intent = parseTaskMutationIntent(context.input.message);
      if (!intent) {
        return draftUnavailable('I didn\'t catch a clear change to make. Try something like "move this to in progress", "assign this to <name>", or "change the due date to Friday".');
      }
      const ids = threadAndActor(context);
      if (!ids) {
        return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
      }
      const label = task.title || "This task";

      if (intent.operation === "status_transition") {
        const current = text(task.status) || "open";
        const validation = validateTransition(TASK_STATUS_TRANSITIONS, current, intent.canonicalValue);
        if (!validation.valid) {
          return draftUnavailable(`"${label}" can't move from ${titleCase(current)} to ${titleCase(intent.canonicalValue)} (${validation.reason}).`);
        }
        const description = `Ready to move "${label}" from ${titleCase(current)} to ${titleCase(intent.canonicalValue)}.`;
        const proposal = buildGovernedActionProposal({
          threadId: ids.threadId,
          actorId: ids.actorId,
          domain: "office_tasks",
          targetEntityType: "task",
          targetEntityId: task.task_ref,
          operation: intent.operation,
          field: intent.field,
          rawValue: intent.rawValue,
          canonicalValue: intent.canonicalValue,
          description,
          previousState: { status: current },
          authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
          validation,
          riskLevel: "low_risk_action",
          executeDirective: { namespace: "crm", collection: "tasks", record_id: task.task_ref, patch: { status: intent.canonicalValue } },
        });
        return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
      }

      if (intent.operation === "reassign_owner") {
        const previousOwner = task.owner || null;
        const description = `Ready to assign "${label}" to ${intent.canonicalValue}${previousOwner ? ` (currently ${previousOwner})` : ""}.`;
        const proposal = buildGovernedActionProposal({
          threadId: ids.threadId,
          actorId: ids.actorId,
          domain: "office_tasks",
          targetEntityType: "task",
          targetEntityId: task.task_ref,
          operation: intent.operation,
          field: intent.field,
          rawValue: intent.rawValue,
          canonicalValue: intent.canonicalValue,
          description,
          previousState: { assignee: previousOwner },
          authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
          validation: { valid: true, reason: null },
          riskLevel: "consequential_action",
          executeDirective: { namespace: "crm", collection: "tasks", record_id: task.task_ref, patch: { assignee: intent.canonicalValue } },
        });
        return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
      }

      if (intent.operation === "change_priority") {
        const previousPriority = task.priority || null;
        const description = `Ready to set "${label}" to ${intent.canonicalValue} priority${previousPriority ? ` (currently ${previousPriority})` : ""}.`;
        const proposal = buildGovernedActionProposal({
          threadId: ids.threadId,
          actorId: ids.actorId,
          domain: "office_tasks",
          targetEntityType: "task",
          targetEntityId: task.task_ref,
          operation: intent.operation,
          field: intent.field,
          rawValue: intent.rawValue,
          canonicalValue: intent.canonicalValue,
          description,
          previousState: { priority: previousPriority },
          authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
          validation: { valid: true, reason: null },
          riskLevel: "low_risk_action",
          executeDirective: { namespace: "crm", collection: "tasks", record_id: task.task_ref, patch: { priority: intent.canonicalValue } },
        });
        return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
      }

      // change_due_date
      const previousDue = task.due_at || null;
      const dueDate = new Date(intent.canonicalValue as string);
      const description = `Ready to move "${label}"'s due date to ${dueDate.toDateString()}.`;
      const proposal = buildGovernedActionProposal({
        threadId: ids.threadId,
        actorId: ids.actorId,
        domain: "office_tasks",
        targetEntityType: "task",
        targetEntityId: task.task_ref,
        operation: intent.operation,
        field: intent.field,
        rawValue: intent.rawValue,
        canonicalValue: intent.canonicalValue,
        description,
        previousState: { due_at: previousDue },
        authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
        validation: { valid: true, reason: null },
        riskLevel: "low_risk_action",
        executeDirective: { namespace: "crm", collection: "tasks", record_id: task.task_ref, patch: { due_at: intent.canonicalValue } },
      });
      return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
    },
  };
}

// Milestone 2 -- batch/ordinal targeting against a persisted meetings
// list result set (office_meetings.query.read), same shape as the other
// *BatchDraft builders. Added specifically to fix a production bug: "What
// meetings do I have tomorrow?" -> "Move the first one to 3pm" is one of
// the brief's own acceptance examples, and previously had no batch path
// for Meetings at all -- a single-ordinal reference like "the first one"
// fell through to the generic read-only follow-up resolver before ever
// reaching this capability (see ConversationOrchestrator.ts's
// REVISION_DOMAIN_INTENT_PARSER bailout, the other half of this fix).
async function buildMeetingBatchDraft(context: CapabilityContext, batchTarget: { type: "count"; count: number } | { type: "all" } | { type: "ordinal"; position: number }): Promise<DomainResult> {
  const intent = parseMeetingMutationIntent(context.input.message);
  if (!intent) {
    return draftUnavailable('I didn\'t catch a clear change to make for that group. Try something like "move the first one to 3pm" or "cancel the second one".');
  }
  const ids = threadAndActor(context);
  if (!ids) {
    return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
  }
  const resultSet = await loadThreadResultSetContext(context.input.thread_id);
  if (!resultSet || resultSet.domain !== "office_meetings" || !resultSet.object_refs.length) {
    return draftUnavailable("I don't have a recent list of meetings to reference — ask what meetings you have first, then tell me which one to change.");
  }
  const targets = resolveBatchTargets(resultSet.object_refs, batchTarget);
  if (!targets.length) {
    return draftUnavailable("There's nothing in that list to change.");
  }

  const children: GovernedActionProposal[] = [];
  const includedLabels: string[] = [];
  const skipped: string[] = [];
  for (const ref of targets) {
    const label = ref.label || "This meeting";
    if (intent.operation === "reschedule") {
      // scheduled_at lives on the ref's own occurred_at (see meetingOpenFact
      // in OfficeCorporateCapabilityModules.ts), not attributes -- ATTRIBUTE_KEYS
      // (resultSetContext.ts) has no scheduled_at entry.
      const previousScheduledAt = ref.occurred_at || null;
      children.push(
        buildGovernedActionProposal({
          threadId: ids.threadId,
          actorId: ids.actorId,
          domain: "office_meetings",
          targetEntityType: "meeting",
          targetEntityId: ref.canonical_id,
          operation: intent.operation,
          field: intent.field,
          rawValue: intent.rawValue,
          canonicalValue: intent.canonicalValue,
          description: `Move "${label}" to ${new Date(intent.canonicalValue).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
          previousState: { scheduled_at: previousScheduledAt },
          authorization: { allowed: true, reason: null, required_permissions: ["meetings.manage"] },
          validation: { valid: true, reason: null },
          riskLevel: "low_risk_action",
          executeDirective: { namespace: "office", collection: "meetings", record_id: ref.canonical_id, patch: { scheduled_at: intent.canonicalValue } },
        })
      );
      includedLabels.push(label);
      continue;
    }
    // status_transition (cancel)
    const currentStatus = text(ref.attributes.status) || "scheduled";
    const validation = validateTransition(MEETING_STATUS_TRANSITIONS, currentStatus, intent.canonicalValue);
    if (!validation.valid) {
      skipped.push(`"${label}" (${validation.reason})`);
      continue;
    }
    children.push(
      buildGovernedActionProposal({
        threadId: ids.threadId,
        actorId: ids.actorId,
        domain: "office_meetings",
        targetEntityType: "meeting",
        targetEntityId: ref.canonical_id,
        operation: intent.operation,
        field: intent.field,
        rawValue: intent.rawValue,
        canonicalValue: intent.canonicalValue,
        description: `Cancel "${label}".`,
        previousState: { status: currentStatus },
        authorization: { allowed: true, reason: null, required_permissions: ["meetings.manage"] },
        validation,
        riskLevel: "consequential_action",
        executeDirective: { namespace: "office", collection: "meetings", record_id: ref.canonical_id, patch: { status: "cancelled" } },
      })
    );
    includedLabels.push(label);
  }

  if (!children.length) {
    return draftUnavailable(`None of those meetings can make that change right now: ${skipped.join("; ")}.`);
  }
  const verb = intent.operation === "reschedule" ? `move to ${new Date(intent.canonicalValue).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "cancel";
  let description = `Ready to ${verb} for ${children.length} meeting${children.length === 1 ? "" : "s"}: ${includedLabels.map((l) => `"${l}"`).join(", ")}.`;
  if (skipped.length) description += ` Skipped ${skipped.length}: ${skipped.join("; ")}.`;
  const proposal = buildBatchGovernedActionProposal({
    threadId: ids.threadId,
    actorId: ids.actorId,
    domain: "office_meetings",
    operation: intent.operation,
    description,
    riskLevel: intent.operation === "reschedule" ? "low_risk_action" : "consequential_action",
    children,
  });
  return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
}

// ---------------------------------------------------------------------
// Meetings — cancel.
// ---------------------------------------------------------------------
function officeMeetingsWriteModule(): CapabilityModule {
  return {
    key: "office_meetings.write",
    domain: "office_meetings",
    rolloutStatus: "enabled",
    operations: ["status_transition", "reschedule"],
    supported_surfaces: ["office_internal"],
    scope_requirements: [],
    permission_requirements: ["meetings.manage"],
    risk_class: "consequential_action",
    confirmation_policy: "explicit_confirmation",
    evidence_requirements: [],
    presentation_policy: { primary: "approval", expose_evidence: "summary", allow_internal_ids: false },
    supports: (frame: SemanticFrame) => frame.domain === "office_meetings" && Boolean(parseMeetingMutationIntent(frame.normalizedText)),
    async resolve() {
      return { supported: true, reason: null };
    },
    async collectEvidence() {
      return [];
    },
    createDraft: async (context: CapabilityContext): Promise<DomainResult> => {
      const batchTarget = parseBatchTargetIntent(context.input.message);
      if (batchTarget) {
        return buildMeetingBatchDraft(context, batchTarget);
      }
      const meeting = meetingContextSlot(context);
      if (!meeting || !meeting.meeting_ref) {
        return draftUnavailable("I don't have a specific meeting open to check — select one in Meetings first, then ask me about it.");
      }
      const intent = parseMeetingMutationIntent(context.input.message);
      if (!intent) {
        return draftUnavailable('I didn\'t catch a clear change to make. Try "cancel this meeting" or "move this to 3pm".');
      }
      const ids = threadAndActor(context);
      if (!ids) {
        return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
      }
      const label = meeting.title || "This meeting";

      if (intent.operation === "reschedule") {
        const previousScheduledAt = meeting.scheduled_at || null;
        const description = `Ready to move "${label}" to ${new Date(intent.canonicalValue).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`;
        const proposal = buildGovernedActionProposal({
          threadId: ids.threadId,
          actorId: ids.actorId,
          domain: "office_meetings",
          targetEntityType: "meeting",
          targetEntityId: meeting.meeting_ref,
          operation: intent.operation,
          field: intent.field,
          rawValue: intent.rawValue,
          canonicalValue: intent.canonicalValue,
          description,
          previousState: { scheduled_at: previousScheduledAt },
          authorization: { allowed: true, reason: null, required_permissions: ["meetings.manage"] },
          validation: { valid: true, reason: null },
          riskLevel: "low_risk_action",
          executeDirective: { namespace: "office", collection: "meetings", record_id: meeting.meeting_ref, patch: { scheduled_at: intent.canonicalValue } },
        });
        return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
      }

      // status_transition (only cancel today)
      const current = text(meeting.status) || "scheduled";
      const validation = validateTransition(MEETING_STATUS_TRANSITIONS, current, intent.canonicalValue);
      if (!validation.valid) {
        return draftUnavailable(`"${label}" can't move from ${titleCase(current)} to ${titleCase(intent.canonicalValue)} (${validation.reason}).`);
      }
      const description = `Ready to cancel "${label}".`;
      const proposal = buildGovernedActionProposal({
        threadId: ids.threadId,
        actorId: ids.actorId,
        domain: "office_meetings",
        targetEntityType: "meeting",
        targetEntityId: meeting.meeting_ref,
        operation: intent.operation,
        field: intent.field,
        rawValue: intent.rawValue,
        canonicalValue: intent.canonicalValue,
        description,
        previousState: { status: current },
        authorization: { allowed: true, reason: null, required_permissions: ["meetings.manage"] },
        validation,
        riskLevel: "consequential_action",
        executeDirective: { namespace: "office", collection: "meetings", record_id: meeting.meeting_ref, patch: { status: "cancelled" } },
      });
      return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
    },
  };
}

// ---------------------------------------------------------------------
// Support — resolve case. Office's own updateOperationalRecord requires
// resolution_notes for a resolved transition (sanitizePatch throws
// resolution_notes_required otherwise) -- if the message doesn't supply
// one, this asks for it rather than fabricating a placeholder note.
// ---------------------------------------------------------------------
// Milestone 2 — batch assign/priority against a persisted support-case
// list result set (office_support.query.read), same shape as Tasks'
// buildTaskBatchDraft. resolve_case is deliberately excluded from batch
// -- it requires a per-case resolution note the message can't supply
// per-target, so a batch "resolve" would either fabricate identical
// notes across cases or silently drop the requirement; neither is
// acceptable, so batch resolve simply isn't offered.
async function buildSupportBatchDraft(context: CapabilityContext, batchTarget: { type: "count"; count: number } | { type: "all" } | { type: "ordinal"; position: number }): Promise<DomainResult> {
  const intent = parseSupportMutationIntent(context.input.message);
  if (!intent || intent.operation === "resolve_case") {
    return draftUnavailable('I didn\'t catch a clear change to make for that group. Try something like "assign those to <name>" or "make those high priority".');
  }
  const ids = threadAndActor(context);
  if (!ids) {
    return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
  }
  const resultSet = await loadThreadResultSetContext(context.input.thread_id);
  if (!resultSet || resultSet.domain !== "office_support" || !resultSet.object_refs.length) {
    return draftUnavailable("I don't have a recent list of support cases to reference — ask to see them first, then tell me which ones to change.");
  }
  const targets = resolveBatchTargets(resultSet.object_refs, batchTarget);
  if (!targets.length) {
    return draftUnavailable("There's nothing in that list to change.");
  }

  const children: GovernedActionProposal[] = [];
  const includedLabels: string[] = [];
  for (const ref of targets) {
    const label = ref.label || "This case";
    const field = intent.field;
    const previous = text(ref.attributes[field]) || null;
    children.push(
      buildGovernedActionProposal({
        threadId: ids.threadId,
        actorId: ids.actorId,
        domain: "office_support",
        targetEntityType: "support_case",
        targetEntityId: ref.canonical_id,
        operation: intent.operation,
        field,
        rawValue: intent.rawValue,
        canonicalValue: intent.canonicalValue,
        description:
          intent.operation === "reassign_owner"
            ? `Assign "${label}" to ${intent.canonicalValue}${previous ? ` (currently ${previous})` : ""}.`
            : `Set "${label}" to ${intent.canonicalValue} priority${previous ? ` (currently ${previous})` : ""}.`,
        previousState: { [field]: previous },
        authorization: { allowed: true, reason: null, required_permissions: ["support.assign"] },
        validation: { valid: true, reason: null },
        riskLevel: intent.operation === "reassign_owner" ? "consequential_action" : "low_risk_action",
        executeDirective: { namespace: "office", collection: "support", record_id: ref.canonical_id, patch: { [field]: intent.canonicalValue } },
      })
    );
    includedLabels.push(label);
  }

  const verb = intent.operation === "reassign_owner" ? `assign to ${intent.canonicalValue}` : `set to ${intent.canonicalValue} priority`;
  const description = `Ready to ${verb} for ${children.length} case${children.length === 1 ? "" : "s"}: ${includedLabels.map((l) => `"${l}"`).join(", ")}.`;
  const proposal = buildBatchGovernedActionProposal({
    threadId: ids.threadId,
    actorId: ids.actorId,
    domain: "office_support",
    operation: intent.operation,
    description,
    riskLevel: intent.operation === "reassign_owner" ? "consequential_action" : "low_risk_action",
    children,
  });
  return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
}

function officeSupportWriteModule(): CapabilityModule {
  return {
    key: "office_support.write",
    domain: "office_support",
    rolloutStatus: "enabled",
    operations: ["resolve_case", "reassign_owner", "change_priority"],
    supported_surfaces: ["office_internal"],
    scope_requirements: [],
    permission_requirements: ["support.assign"],
    risk_class: "consequential_action",
    confirmation_policy: "explicit_confirmation",
    evidence_requirements: [],
    presentation_policy: { primary: "approval", expose_evidence: "summary", allow_internal_ids: false },
    supports: (frame: SemanticFrame) => frame.domain === "office_support" && Boolean(parseSupportMutationIntent(frame.normalizedText)),
    async resolve() {
      return { supported: true, reason: null };
    },
    async collectEvidence() {
      return [];
    },
    createDraft: async (context: CapabilityContext): Promise<DomainResult> => {
      const batchTarget = parseBatchTargetIntent(context.input.message);
      if (batchTarget) {
        return buildSupportBatchDraft(context, batchTarget);
      }
      const support = supportContextSlot(context);
      if (!support || !support.support_case_ref) {
        return draftUnavailable("I don't have a specific support case open to check — select one in Support first, then ask me about it.");
      }
      const intent = parseSupportMutationIntent(context.input.message);
      if (!intent) {
        return draftUnavailable('I didn\'t catch a clear change to make. Try "resolve this case - <what fixed it>", "assign this to <name>", or "make this high priority".');
      }
      const ids = threadAndActor(context);
      if (!ids) {
        return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
      }
      const label = support.title || "This case";

      if (intent.operation === "reassign_owner") {
        const previousOwner = support.assigned_staff || null;
        const description = `Ready to assign "${label}" to ${intent.canonicalValue}${previousOwner ? ` (currently ${previousOwner})` : ""}.`;
        const proposal = buildGovernedActionProposal({
          threadId: ids.threadId,
          actorId: ids.actorId,
          domain: "office_support",
          targetEntityType: "support_case",
          targetEntityId: support.support_case_ref,
          operation: intent.operation,
          field: intent.field,
          rawValue: intent.rawValue,
          canonicalValue: intent.canonicalValue,
          description,
          previousState: { assigned_staff: previousOwner },
          authorization: { allowed: true, reason: null, required_permissions: ["support.assign"] },
          validation: { valid: true, reason: null },
          riskLevel: "consequential_action",
          executeDirective: { namespace: "office", collection: "support", record_id: support.support_case_ref, patch: { assigned_staff: intent.canonicalValue } },
        });
        return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
      }

      if (intent.operation === "change_priority") {
        const previousPriority = support.priority || null;
        const description = `Ready to set "${label}" to ${intent.canonicalValue} priority${previousPriority ? ` (currently ${previousPriority})` : ""}.`;
        const proposal = buildGovernedActionProposal({
          threadId: ids.threadId,
          actorId: ids.actorId,
          domain: "office_support",
          targetEntityType: "support_case",
          targetEntityId: support.support_case_ref,
          operation: intent.operation,
          field: intent.field,
          rawValue: intent.rawValue,
          canonicalValue: intent.canonicalValue,
          description,
          previousState: { priority: previousPriority },
          authorization: { allowed: true, reason: null, required_permissions: ["support.assign"] },
          validation: { valid: true, reason: null },
          riskLevel: "low_risk_action",
          executeDirective: { namespace: "office", collection: "support", record_id: support.support_case_ref, patch: { priority: intent.canonicalValue } },
        });
        return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
      }

      // resolve_case
      if (!intent.resolutionNotes) {
        return draftUnavailable(`What was the resolution for "${label}"? I'll need a brief note before I can propose marking it resolved — try "resolve this case - <what fixed it>".`);
      }
      const current = text(support.status) || "open";
      const validation = validateTransition(SUPPORT_STATUS_TRANSITIONS, current, intent.canonicalValue);
      if (!validation.valid) {
        return draftUnavailable(`"${label}" can't move from ${titleCase(current)} to ${titleCase(intent.canonicalValue)} (${validation.reason}).`);
      }
      const description = `Ready to resolve "${label}": ${intent.resolutionNotes}`;
      const proposal = buildGovernedActionProposal({
        threadId: ids.threadId,
        actorId: ids.actorId,
        domain: "office_support",
        targetEntityType: "support_case",
        targetEntityId: support.support_case_ref,
        operation: intent.operation,
        field: intent.field,
        rawValue: intent.rawValue,
        canonicalValue: intent.canonicalValue,
        description,
        previousState: { status: current },
        authorization: { allowed: true, reason: null, required_permissions: ["support.assign"] },
        validation,
        riskLevel: "consequential_action",
        executeDirective: { namespace: "office", collection: "support", record_id: support.support_case_ref, patch: { status: "resolved", resolution_notes: intent.resolutionNotes } },
      });
      return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
    },
  };
}

// ---------------------------------------------------------------------
// Automations — pause/resume. New in Milestone 2: no write capability
// existed for this domain before. No STATUS_TRANSITIONS validation
// (see parseAutomationMutationIntent's header note) -- the only
// "invalid" case is already being in the requested state, checked
// directly.
// ---------------------------------------------------------------------
async function buildAutomationBatchDraft(context: CapabilityContext, batchTarget: { type: "count"; count: number } | { type: "all" } | { type: "ordinal"; position: number }): Promise<DomainResult> {
  const intent = parseAutomationMutationIntent(context.input.message);
  if (!intent) {
    return draftUnavailable('I didn\'t catch a clear change to make for that group. Try "pause the second one" or "resume all of them".');
  }
  const ids = threadAndActor(context);
  if (!ids) {
    return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
  }
  const resultSet = await loadThreadResultSetContext(context.input.thread_id);
  if (!resultSet || resultSet.domain !== "automations" || !resultSet.object_refs.length) {
    return draftUnavailable("I don't have a recent list of automations to reference — ask to see them first, then tell me which ones to change.");
  }
  const targets = resolveBatchTargets(resultSet.object_refs, batchTarget);
  if (!targets.length) {
    return draftUnavailable("There's nothing in that list to change.");
  }

  const children: GovernedActionProposal[] = [];
  const includedLabels: string[] = [];
  const skipped: string[] = [];
  for (const ref of targets) {
    const label = ref.label || "This automation";
    const currentlyEnabled = ref.attributes.enabled === "true";
    if (currentlyEnabled === intent.canonicalValue) {
      skipped.push(`"${label}" (already ${intent.canonicalValue ? "active" : "paused"})`);
      continue;
    }
    children.push(
      buildGovernedActionProposal({
        threadId: ids.threadId,
        actorId: ids.actorId,
        domain: "automations",
        targetEntityType: "automation",
        targetEntityId: ref.canonical_id,
        operation: intent.operation,
        field: intent.field,
        rawValue: intent.rawValue,
        canonicalValue: intent.canonicalValue,
        description: `${intent.canonicalValue ? "Resume" : "Pause"} "${label}".`,
        previousState: { enabled: currentlyEnabled },
        authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
        validation: { valid: true, reason: null },
        riskLevel: "low_risk_action",
        executeDirective: { namespace: "automations", collection: "automations", record_id: ref.canonical_id, patch: { enabled: intent.canonicalValue } },
      })
    );
    includedLabels.push(label);
  }

  if (!children.length) {
    return draftUnavailable(`None of those automations can make that change right now: ${skipped.join("; ")}.`);
  }
  let description = `Ready to ${intent.canonicalValue ? "resume" : "pause"} ${children.length} automation${children.length === 1 ? "" : "s"}: ${includedLabels.map((l) => `"${l}"`).join(", ")}.`;
  if (skipped.length) description += ` Skipped ${skipped.length}: ${skipped.join("; ")}.`;
  const proposal = buildBatchGovernedActionProposal({
    threadId: ids.threadId,
    actorId: ids.actorId,
    domain: "automations",
    operation: intent.operation,
    description,
    riskLevel: "low_risk_action",
    children,
  });
  return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
}

function officeAutomationsWriteModule(): CapabilityModule {
  return {
    key: "office_automations.write",
    domain: "automations",
    rolloutStatus: "enabled",
    operations: ["pause", "resume"],
    supported_surfaces: ["office_internal"],
    scope_requirements: [],
    permission_requirements: ["tasks.manage"],
    risk_class: "low_risk_action",
    confirmation_policy: "explicit_confirmation",
    evidence_requirements: [],
    presentation_policy: { primary: "approval", expose_evidence: "summary", allow_internal_ids: false },
    supports: (frame: SemanticFrame) => frame.domain === "automations" && isAutomationMutationMessage(frame.normalizedText),
    async resolve() {
      return { supported: true, reason: null };
    },
    async collectEvidence() {
      return [];
    },
    createDraft: async (context: CapabilityContext): Promise<DomainResult> => {
      const batchTarget = parseBatchTargetIntent(context.input.message);
      if (batchTarget) {
        return buildAutomationBatchDraft(context, batchTarget);
      }
      const automation = automationContextSlot(context);
      if (!automation || !automation.automation_ref) {
        return draftUnavailable("I don't have a specific automation open to check — select one in Automations first, then ask me about it.");
      }
      const intent = parseAutomationMutationIntent(context.input.message);
      if (!intent) {
        return draftUnavailable('I didn\'t catch a clear change to make. Try "pause this" or "resume this".');
      }
      const ids = threadAndActor(context);
      if (!ids) {
        return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
      }
      const label = automation.name || "This automation";
      if (Boolean(automation.enabled) === intent.canonicalValue) {
        return draftUnavailable(`"${label}" is already ${intent.canonicalValue ? "active" : "paused"}.`);
      }
      const description = `Ready to ${intent.canonicalValue ? "resume" : "pause"} "${label}".`;
      const proposal = buildGovernedActionProposal({
        threadId: ids.threadId,
        actorId: ids.actorId,
        domain: "automations",
        targetEntityType: "automation",
        targetEntityId: automation.automation_ref,
        operation: intent.operation,
        field: intent.field,
        rawValue: intent.rawValue,
        canonicalValue: intent.canonicalValue,
        description,
        previousState: { enabled: Boolean(automation.enabled) },
        authorization: { allowed: true, reason: null, required_permissions: ["tasks.manage"] },
        validation: { valid: true, reason: null },
        riskLevel: "low_risk_action",
        executeDirective: { namespace: "automations", collection: "automations", record_id: automation.automation_ref, patch: { enabled: intent.canonicalValue } },
      });
      return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
    },
  };
}

// ---------------------------------------------------------------------
// Portfolio / Partnerships — status transition only, single-record.
// New in Milestone 2: neither domain had any write capability before.
// No batch (no example in the brief calls for one, and each has a
// smaller/more sensitive state machine than Tasks/Support's).
// ---------------------------------------------------------------------
function officePortfolioWriteModule(): CapabilityModule {
  return {
    key: "office_portfolio.write",
    domain: "office_portfolio",
    rolloutStatus: "enabled",
    operations: ["status_transition"],
    supported_surfaces: ["office_internal"],
    scope_requirements: [],
    permission_requirements: ["portfolio.manage"],
    risk_class: "consequential_action",
    confirmation_policy: "explicit_confirmation",
    evidence_requirements: [],
    presentation_policy: { primary: "approval", expose_evidence: "summary", allow_internal_ids: false },
    supports: (frame: SemanticFrame) => frame.domain === "office_portfolio" && Boolean(parsePortfolioMutationIntent(frame.normalizedText)),
    async resolve() {
      return { supported: true, reason: null };
    },
    async collectEvidence() {
      return [];
    },
    createDraft: async (context: CapabilityContext): Promise<DomainResult> => {
      const portfolio = portfolioContextSlot(context);
      if (!portfolio || !portfolio.portfolio_ref) {
        return draftUnavailable("I don't have a specific portfolio entry open to check — select one in Portfolio first, then ask me about it.");
      }
      const intent = parsePortfolioMutationIntent(context.input.message);
      if (!intent) {
        return draftUnavailable('I didn\'t catch a clear change to make. Try "mark this as normal" or "move this to on hold".');
      }
      const ids = threadAndActor(context);
      if (!ids) {
        return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
      }
      const label = portfolio.name || "This portfolio entry";
      const current = text(portfolio.status) || "normal";
      const validation = validateTransition(PORTFOLIO_STATUS_TRANSITIONS, current, intent.canonicalValue);
      if (!validation.valid) {
        return draftUnavailable(`"${label}" can't move from ${titleCase(current)} to ${titleCase(intent.canonicalValue)} (${validation.reason}).`);
      }
      const description = `Ready to move "${label}" from ${titleCase(current)} to ${titleCase(intent.canonicalValue)}.`;
      const proposal = buildGovernedActionProposal({
        threadId: ids.threadId,
        actorId: ids.actorId,
        domain: "office_portfolio",
        targetEntityType: "portfolio_entry",
        targetEntityId: portfolio.portfolio_ref,
        operation: intent.operation,
        field: intent.field,
        rawValue: intent.rawValue,
        canonicalValue: intent.canonicalValue,
        description,
        previousState: { status: current },
        authorization: { allowed: true, reason: null, required_permissions: ["portfolio.manage"] },
        validation,
        riskLevel: "consequential_action",
        executeDirective: { namespace: "office", collection: "portfolio", record_id: portfolio.portfolio_ref, patch: { status: intent.canonicalValue } },
      });
      return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
    },
  };
}

function officePartnershipsWriteModule(): CapabilityModule {
  return {
    key: "office_partnerships.write",
    domain: "corporate_partnerships",
    rolloutStatus: "enabled",
    operations: ["status_transition"],
    supported_surfaces: ["office_internal"],
    scope_requirements: [],
    permission_requirements: ["partnerships.manage"],
    risk_class: "consequential_action",
    confirmation_policy: "explicit_confirmation",
    evidence_requirements: [],
    presentation_policy: { primary: "approval", expose_evidence: "summary", allow_internal_ids: false },
    supports: (frame: SemanticFrame) => frame.domain === "corporate_partnerships" && Boolean(parsePartnershipMutationIntent(frame.normalizedText)),
    async resolve() {
      return { supported: true, reason: null };
    },
    async collectEvidence() {
      return [];
    },
    createDraft: async (context: CapabilityContext): Promise<DomainResult> => {
      const partnership = partnershipContextSlot(context);
      if (!partnership || !partnership.partnership_ref) {
        return draftUnavailable("I don't have a specific partnership open to check — select one in Partnerships first, then ask me about it.");
      }
      const intent = parsePartnershipMutationIntent(context.input.message);
      if (!intent) {
        return draftUnavailable('I didn\'t catch a clear change to make. Try "move this to active" or "mark this as paused".');
      }
      const ids = threadAndActor(context);
      if (!ids) {
        return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
      }
      const label = partnership.organization_name || "This partnership";
      const current = text(partnership.review_status) || "new";
      const validation = validateTransition(PARTNERSHIP_STATUS_TRANSITIONS, current, intent.canonicalValue);
      if (!validation.valid) {
        return draftUnavailable(`"${label}" can't move from ${titleCase(current)} to ${titleCase(intent.canonicalValue)} (${validation.reason}).`);
      }
      const description = `Ready to move "${label}" from ${titleCase(current)} to ${titleCase(intent.canonicalValue)}.`;
      const proposal = buildGovernedActionProposal({
        threadId: ids.threadId,
        actorId: ids.actorId,
        domain: "corporate_partnerships",
        targetEntityType: "partnership_relationship",
        targetEntityId: partnership.partnership_ref,
        operation: intent.operation,
        field: intent.field,
        rawValue: intent.rawValue,
        canonicalValue: intent.canonicalValue,
        description,
        previousState: { review_status: current },
        authorization: { allowed: true, reason: null, required_permissions: ["partnerships.manage"] },
        validation,
        riskLevel: "consequential_action",
        executeDirective: { namespace: "office", collection: "partnerships", record_id: partnership.partnership_ref, patch: { review_status: intent.canonicalValue } },
      });
      return proposalResult(`${description} Reply "yes" to confirm, or "no" to cancel.`, proposal);
    },
  };
}

export function buildOfficeActionCapabilities(): CapabilityModule[] {
  return [
    officeTasksWriteModule(),
    officeMeetingsWriteModule(),
    officeSupportWriteModule(),
    officeAutomationsWriteModule(),
    officePortfolioWriteModule(),
    officePartnershipsWriteModule(),
  ];
}
