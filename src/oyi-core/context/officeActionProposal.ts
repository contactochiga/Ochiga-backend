// Oyi Conversational Runtime Completion Programme, Phase 3 — Governed
// Action Proposals for office_internal.
//
// ARCHITECTURE NOTE (the one material deviation from a single-turn
// AUTHORIZE->EXECUTE flow, explained per the Phase 3 brief before being
// implemented): Backend has no database connection to Office's tasks/
// meetings/support tables at all -- a separate Supabase project, Office
// calls Backend, never the reverse (confirmed throughout this
// programme). Office's OWN mutation engine, updateOperationalRecord()
// (ochiga-office/src/lead-agents/office-operational-workflows.js), is
// already the canonical, already-audited, already-permission-checked
// (authorizePermission(authContext, policy.manage) before every write,
// appendAudit after) execution path for these records -- the SAME path
// every existing manual "Mark In Progress" button already uses. Backend
// cannot bypass or duplicate that; it can only PROPOSE. So execution is
// necessarily client-triggered through Office's existing PATCH route
// (apiPatchOperational), not a second execution path -- Backend's role
// is confined to UNDERSTAND -> GROUND -> PROPOSE, and, on the following
// turn, VERIFY -> RECORD by re-reading the fresh context Office's
// frontend sends after a successful PATCH. This is why
// OyiWorkflow/ActionService (built for direct-backend-execution device
// adapters) is deliberately NOT reused here -- the shape doesn't fit an
// execution owner outside Backend's own process. Reused instead: the
// SAME oyi_conversation_threads.metadata JSONB write path Phase 2 already
// established (a sibling key, not a new table), and CapabilityRiskClass/
// ConfirmationPolicy from the existing capability contract rather than a
// new risk taxonomy.
import { randomUUID } from "crypto";
import { logger } from "../../observability/logger";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import type {
  GovernedActionProposal,
  OfficeActionExecuteDirective,
  OfficeActionProposalView,
  OfficeMutationRiskLevel,
} from "../../contracts/governedAction";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

// ---------------------------------------------------------------------
// Mirrored from ochiga-office's STATUS_TRANSITIONS (office-operational-
// workflows.js) -- duplicated intentionally, same convention already
// used for classifyDomain's keyword patterns elsewhere in this
// programme: Backend has no import path into the Office repo, and this
// table only needs to be right enough to avoid PROPOSING a transition
// Office's own engine (the real authority) would reject anyway. Office's
// PATCH route re-validates independently regardless -- this is a
// pre-flight courtesy, not the enforcement.
// ---------------------------------------------------------------------
const TASK_STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress", "completed", "cancelled"],
  in_progress: ["open", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};
const MEETING_STATUS_TRANSITIONS: Record<string, string[]> = {
  scheduled: ["completed", "cancelled"],
  active: ["scheduled", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};
const SUPPORT_STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress", "waiting_customer", "waiting_internal", "resolved", "closed"],
  in_progress: ["waiting_customer", "waiting_internal", "resolved", "closed"],
  waiting_customer: ["in_progress", "resolved", "closed"],
  waiting_internal: ["in_progress", "resolved", "closed"],
  resolved: ["in_progress", "closed"],
  closed: [],
};

function validateTransition(transitions: Record<string, string[]>, current: string, next: string): { valid: boolean; reason: string | null } {
  const from = text(current).toLowerCase();
  const to = text(next).toLowerCase();
  if (!to || to === from) return { valid: false, reason: "already in that state" };
  const allowed = transitions[from] || [];
  if (!allowed.includes(to)) return { valid: false, reason: `cannot move from ${from || "its current state"} to ${to}` };
  return { valid: true, reason: null };
}

// ---------------------------------------------------------------------
// Mutation-intent parsing -- deliberately narrow, deliberately explicit.
// Each parser requires BOTH a recognizable verb and a recognizable
// target value; anything it can't confidently extract returns null
// rather than guessing, per "must not execute if ambiguous or missing
// information."
// ---------------------------------------------------------------------
export type TaskMutationIntent =
  | { operation: "status_transition"; field: "status"; rawValue: string; canonicalValue: string }
  | { operation: "reassign_owner"; field: "assignee"; rawValue: string; canonicalValue: string }
  | { operation: "change_due_date"; field: "due_at"; rawValue: string; canonicalValue: string };

const TASK_STATUS_WORDS: Array<[RegExp, string]> = [
  [/\bin[- ]?progress\b|\bstarted\b/i, "in_progress"],
  [/\bdone\b|\bcomplete\b|\bcompleted\b|\bfinished\b/i, "completed"],
  [/\bcancell?ed\b/i, "cancelled"],
  [/\breopen(?:ed)?\b|\bback to open\b/i, "open"],
];

function parseTaskStatusIntent(message: string): TaskMutationIntent | null {
  const m = text(message);
  if (!/\b(?:move|change|update|mark|set)\b/i.test(m)) return null;
  for (const [pattern, canonical] of TASK_STATUS_WORDS) {
    const match = m.match(pattern);
    if (match) return { operation: "status_transition", field: "status", rawValue: match[0], canonicalValue: canonical };
  }
  return null;
}

function parseTaskAssigneeIntent(message: string): TaskMutationIntent | null {
  const match = text(message).match(/\b(?:assign|reassign)(?:\s+this)?(?:\s+task)?\s+to\s+([A-Za-z][A-Za-z '.-]{1,60})/i);
  if (!match) return null;
  const name = match[1].trim().replace(/[.?!]+$/, "");
  if (!name || /^(?:me|myself|him|her|them|someone|anyone)$/i.test(name)) return null;
  return { operation: "reassign_owner", field: "assignee", rawValue: name, canonicalValue: name };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function nextWeekdayIso(name: string): string | null {
  const target = WEEKDAYS.indexOf(name.toLowerCase());
  if (target < 0) return null;
  const now = new Date();
  const current = now.getUTCDay();
  let delta = (target - current + 7) % 7;
  if (delta === 0) delta = 7; // "Friday" always means the NEXT Friday, never today.
  const result = new Date(now);
  result.setUTCDate(now.getUTCDate() + delta);
  result.setUTCHours(12, 0, 0, 0);
  return result.toISOString();
}

function parseTaskDueDateIntent(message: string): TaskMutationIntent | null {
  const m = text(message);
  const match = m.match(/\b(?:due date|due|deadline)\b(?:.*?)\bto\b\s+(.+?)[.?!]?$/i) || m.match(/\breschedule\b(?:.*?)\bto\b\s+(.+?)[.?!]?$/i);
  if (!match) return null;
  const phrase = match[1].trim();
  const weekday = WEEKDAYS.find((w) => new RegExp(`\\b${w}\\b`, "i").test(phrase));
  let iso: string | null = null;
  if (weekday) {
    iso = nextWeekdayIso(weekday);
  } else if (/\btomorrow\b/i.test(phrase)) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(12, 0, 0, 0);
    iso = d.toISOString();
  } else {
    const parsed = Date.parse(phrase);
    iso = Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (!iso) return null;
  return { operation: "change_due_date", field: "due_at", rawValue: phrase, canonicalValue: iso };
}

export function parseTaskMutationIntent(message: string): TaskMutationIntent | null {
  return parseTaskStatusIntent(message) || parseTaskAssigneeIntent(message) || parseTaskDueDateIntent(message);
}

export type MeetingMutationIntent = { operation: "status_transition"; field: "status"; rawValue: string; canonicalValue: string };

export function parseMeetingMutationIntent(message: string): MeetingMutationIntent | null {
  const m = text(message);
  if (/\bcancel\b/i.test(m) && /\bmeeting\b|\bthis\b/i.test(m)) {
    return { operation: "status_transition", field: "status", rawValue: "cancel", canonicalValue: "cancelled" };
  }
  return null;
}

export type SupportMutationIntent = {
  operation: "resolve_case";
  field: "status";
  rawValue: string;
  canonicalValue: "resolved";
  resolutionNotes: string | null;
};

export function parseSupportMutationIntent(message: string): SupportMutationIntent | null {
  const m = text(message);
  if (!/\bresolve[d]?\b|\bmark(?:ed)?\b.*\bresolved\b|\bclose this (?:case|ticket)\b/i.test(m)) return null;
  const noteMatch = m.match(/\bresolve[d]?(?:\s+this)?(?:\s+(?:case|ticket|support case))?\s*[-:—]\s*(.+)$/i);
  const resolutionNotes = noteMatch ? noteMatch[1].trim() : null;
  return { operation: "resolve_case", field: "status", rawValue: "resolved", canonicalValue: "resolved", resolutionNotes };
}

export { TASK_STATUS_TRANSITIONS, MEETING_STATUS_TRANSITIONS, SUPPORT_STATUS_TRANSITIONS, validateTransition };

// ---------------------------------------------------------------------
// Confirmation / cancellation phrase detection -- wider than
// ConversationOrchestrator.ts's isConfirmationText/isCancellationText
// (which only match exact single-token strings like "yes"/"do it", not
// natural sentences like "Yes, do it." from the Phase 3 brief's own
// example). Deliberately separate functions rather than widening the
// shared ones, which are also used for Consumer/Facility device
// confirmations and shouldn't have their matching surface changed here.
// ---------------------------------------------------------------------
const OFFICE_CONFIRM_PATTERN = /^(?:yes|yeah|yep|confirm|confirmed|proceed|go ahead|do it)\b/i;
const OFFICE_CANCEL_PATTERN = /^(?:no|nope|cancel(?: that)?|never ?mind|don'?t do (?:it|that)|stop|actually,? (?:no|don'?t))\b/i;

export function isOfficeConfirmationText(message: string): boolean {
  return OFFICE_CONFIRM_PATTERN.test(text(message));
}

export function isOfficeCancellationText(message: string): boolean {
  return OFFICE_CANCEL_PATTERN.test(text(message));
}

// ---------------------------------------------------------------------
// Proposal lifecycle: build (pure) / validate-stored (pure) / load (DB).
// Save happens by folding the SAME object into threadMetadata inside
// persistCanonicalConversationTurn, mirroring officeConversationContext.
// ts's business_active_context -- no second write path.
// ---------------------------------------------------------------------
const PROPOSAL_TTL_MS = 10 * 60 * 1000; // 10 minutes -- long enough to read a confirmation card, short enough that a stale "yes" days later can't silently execute.

export function buildGovernedActionProposal(input: {
  threadId: string;
  actorId: string;
  domain: string;
  targetEntityType: string;
  targetEntityId: string;
  operation: string;
  field: string;
  rawValue: string;
  canonicalValue: unknown;
  description: string;
  previousState: Record<string, unknown> | null;
  authorization: { allowed: boolean; reason: string | null; required_permissions: string[] };
  validation: { valid: boolean; reason: string | null };
  riskLevel: OfficeMutationRiskLevel;
  executeDirective: OfficeActionExecuteDirective;
}): GovernedActionProposal {
  const now = new Date();
  const proposalId = randomUUID();
  return {
    proposal_id: proposalId,
    thread_id: input.threadId,
    actor_id: input.actorId,
    domain: input.domain,
    target_entity_type: input.targetEntityType,
    target_entity_id: input.targetEntityId,
    operation: input.operation,
    parameters: { field: input.field, raw_value: input.rawValue, canonical_value: input.canonicalValue },
    description: input.description,
    previous_state: input.previousState,
    proposed_state: { [input.field]: input.canonicalValue },
    authorization: input.authorization,
    validation: input.validation,
    confirmation_required: true,
    risk_level: input.riskLevel,
    idempotency_key: proposalId,
    status: "pending",
    execution_reference: null,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
    executed_at: null,
    verification_result: null,
    failure_reason: null,
    execute_directive: input.executeDirective,
  };
}

export function proposalPublicView(proposal: GovernedActionProposal): OfficeActionProposalView {
  return {
    proposal_id: proposal.proposal_id,
    domain: proposal.domain,
    target_entity_type: proposal.target_entity_type,
    target_entity_id: proposal.target_entity_id,
    operation: proposal.operation,
    description: proposal.description,
    previous_state: proposal.previous_state,
    proposed_state: proposal.proposed_state,
    risk_level: proposal.risk_level,
    status: proposal.status,
    // Only ever populated once the proposal has actually been confirmed
    // server-side (see the confirmation branch in ConversationOrchestrator.
    // ts) -- a merely-pending proposal never carries an execute directive,
    // so a client bug can't skip the confirm step.
    execute_directive: proposal.status === "confirmed" ? proposal.execute_directive : null,
  };
}

// Pure validation, unit-testable without a live DB (mirrors
// officeConversationContext.ts's usableOfficeActiveContext exactly).
// Never returns a proposal belonging to a different actor or thread, or
// one that's expired or already resolved.
export function usablePendingProposal(
  stored: Partial<GovernedActionProposal> | null | undefined,
  actorId: string | null | undefined,
  threadId: string | null | undefined,
  now: number = Date.now()
): GovernedActionProposal | null {
  return usableProposalWithStatus(stored, actorId, threadId, "pending", now);
}

// Same actor/thread/expiry/shape guarantees as usablePendingProposal, but
// for an arbitrary status -- used for the post-confirmation VERIFICATION
// turn, where the stored proposal is expected to already be "confirmed"
// rather than "pending" (see ConversationOrchestrator.ts).
export function usableProposalWithStatus(
  stored: Partial<GovernedActionProposal> | null | undefined,
  actorId: string | null | undefined,
  threadId: string | null | undefined,
  status: GovernedActionProposal["status"],
  now: number = Date.now()
): GovernedActionProposal | null {
  if (!stored || !actorId || !threadId) return null;
  if (text(stored.actor_id) !== text(actorId)) return null;
  if (text(stored.thread_id) !== text(threadId)) return null;
  if (stored.status !== status) return null;
  if (!stored.expires_at || Date.parse(stored.expires_at) < now) return null;
  if (!stored.proposal_id || !stored.target_entity_id) return null;
  return stored as GovernedActionProposal;
}

async function loadStoredProposal(threadId: string | null | undefined, actorId: string | null | undefined): Promise<Partial<GovernedActionProposal> | null> {
  if (!threadId || !isUuid(threadId) || !actorId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("oyi_conversation_threads")
      .select("metadata,user_id")
      .eq("id", threadId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (text((data as any).user_id) !== text(actorId)) return null;
    return recordOf(recordOf((data as any).metadata).pending_action_proposal) as Partial<GovernedActionProposal>;
  } catch (error) {
    logger.warn("oyi_office_action_proposal_load_failed", { thread_id: threadId, error });
    return null;
  }
}

export async function loadPendingOfficeActionProposal(
  threadId: string | null | undefined,
  actorId: string | null | undefined
): Promise<GovernedActionProposal | null> {
  const stored = await loadStoredProposal(threadId, actorId);
  return usablePendingProposal(stored, actorId, threadId);
}

// Status-agnostic: used only to carry a still-valid proposal forward
// across a turn that doesn't touch it at all (e.g. an unrelated read
// question asked while a proposal is "pending" OR already "confirmed"
// and awaiting its verification turn) -- an unrelated turn must not
// silently wipe an in-flight proposal regardless of which stage it's in.
export async function loadAnyOfficeActionProposal(
  threadId: string | null | undefined,
  actorId: string | null | undefined
): Promise<GovernedActionProposal | null> {
  const stored = await loadStoredProposal(threadId, actorId);
  if (!stored || !actorId || !threadId) return null;
  if (text(stored.actor_id) !== text(actorId)) return null;
  if (text(stored.thread_id) !== text(threadId)) return null;
  if (!stored.expires_at || Date.parse(stored.expires_at) < Date.now()) return null;
  if (!stored.proposal_id || !stored.target_entity_id) return null;
  return stored as GovernedActionProposal;
}

export async function loadConfirmedOfficeActionProposal(
  threadId: string | null | undefined,
  actorId: string | null | undefined
): Promise<GovernedActionProposal | null> {
  const stored = await loadStoredProposal(threadId, actorId);
  return usableProposalWithStatus(stored, actorId, threadId, "confirmed");
}
