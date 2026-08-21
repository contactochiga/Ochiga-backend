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
import { taskContextSlot, meetingContextSlot, supportContextSlot, unavailableResult } from "./OfficeCorporateCapabilityModules";
import { loadThreadResultSetContext } from "../context/resultSetContext";
import {
  parseTaskMutationIntent,
  parseMeetingMutationIntent,
  parseSupportMutationIntent,
  parseBatchTargetIntent,
  parseBatchMutationIntent,
  isTaskMutationMessage,
  buildGovernedActionProposal,
  buildBatchGovernedActionProposal,
  proposalPublicView,
  TASK_STATUS_TRANSITIONS,
  MEETING_STATUS_TRANSITIONS,
  SUPPORT_STATUS_TRANSITIONS,
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
async function buildTaskBatchDraft(context: CapabilityContext, batchTarget: { type: "count"; count: number } | { type: "all" }): Promise<DomainResult> {
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
  const targets = batchTarget.type === "all" ? resultSet.object_refs : resultSet.object_refs.slice(0, batchTarget.count);
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

// ---------------------------------------------------------------------
// Meetings — cancel.
// ---------------------------------------------------------------------
function officeMeetingsWriteModule(): CapabilityModule {
  return {
    key: "office_meetings.write",
    domain: "office_meetings",
    rolloutStatus: "enabled",
    operations: ["status_transition"],
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
      const meeting = meetingContextSlot(context);
      if (!meeting || !meeting.meeting_ref) {
        return draftUnavailable("I don't have a specific meeting open to check — select one in Meetings first, then ask me about it.");
      }
      const intent = parseMeetingMutationIntent(context.input.message);
      if (!intent) {
        return draftUnavailable('I didn\'t catch a clear change to make. Try "cancel this meeting".');
      }
      const ids = threadAndActor(context);
      if (!ids) {
        return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
      }
      const label = meeting.title || "This meeting";
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
function officeSupportWriteModule(): CapabilityModule {
  return {
    key: "office_support.write",
    domain: "office_support",
    rolloutStatus: "enabled",
    operations: ["resolve_case"],
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
      const support = supportContextSlot(context);
      if (!support || !support.support_case_ref) {
        return draftUnavailable("I don't have a specific support case open to check — select one in Support first, then ask me about it.");
      }
      const intent = parseSupportMutationIntent(context.input.message);
      if (!intent) {
        return draftUnavailable('I didn\'t catch a clear change to make. Try "resolve this case - <what fixed it>".');
      }
      if (!intent.resolutionNotes) {
        return draftUnavailable(`What was the resolution for "${support.title || "this case"}"? I'll need a brief note before I can propose marking it resolved — try "resolve this case - <what fixed it>".`);
      }
      const ids = threadAndActor(context);
      if (!ids) {
        return draftUnavailable("I can't safely propose a change without a stable conversation — please try again.");
      }
      const label = support.title || "This case";
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

export function buildOfficeActionCapabilities(): CapabilityModule[] {
  return [officeTasksWriteModule(), officeMeetingsWriteModule(), officeSupportWriteModule()];
}
