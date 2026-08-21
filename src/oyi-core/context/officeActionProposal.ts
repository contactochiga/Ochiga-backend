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
// Milestone 2 — mirrored from ochiga-office's own STATUS_TRANSITIONS
// (office-operational-workflows.js) for the two domains that had no
// write capability at all before this. Same "pre-flight courtesy, not
// the enforcement" note as the three tables above applies.
const PORTFOLIO_STATUS_TRANSITIONS: Record<string, string[]> = {
  active: ["on_hold", "completed", "cancelled"],
  normal: ["attention", "on_hold"],
  attention: ["normal", "on_hold"],
  on_hold: ["active", "normal", "cancelled"],
  completed: [],
  cancelled: [],
};
const PARTNERSHIP_STATUS_TRANSITIONS: Record<string, string[]> = {
  new: ["under_review", "active", "declined"],
  under_review: ["active", "declined"],
  active: ["paused", "closed"],
  paused: ["active", "closed"],
  closed: [],
  declined: [],
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
  | { operation: "change_due_date"; field: "due_at"; rawValue: string; canonicalValue: string }
  | { operation: "change_priority"; field: "priority"; rawValue: string; canonicalValue: string };

// Milestone 2 — "make those high priority" / "make this low priority",
// generic enough it's shared verbatim by the Support priority parser
// below (same field, same three real values in both collections'
// FIELD_POLICY).
const PRIORITY_WORDS: Array<[RegExp, string]> = [
  [/\bhigh priority\b|\burgent\b/i, "high"],
  [/\bmedium priority\b|\bnormal priority\b/i, "medium"],
  [/\blow priority\b/i, "low"],
];

export function parsePriorityIntent(message: string): { rawValue: string; canonicalValue: string } | null {
  const m = text(message);
  if (!/\b(?:make|set|mark|change)\b/i.test(m)) return null;
  for (const [pattern, canonical] of PRIORITY_WORDS) {
    const match = m.match(pattern);
    if (match) return { rawValue: match[0], canonicalValue: canonical };
  }
  return null;
}

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
  // (?:this|these|them) added in Phase 4, PR 4 -- "assign these to Tony"
  // is the natural batch phrasing alongside the pre-existing single-
  // record "assign this to Tony"; purely additive, no existing match
  // narrows. "give" added in Phase 4, PR 5 -- "and give it to Tony" is
  // the natural way to ADD an owner onto an already-pending revision
  // (see mergeTaskRevisionIntoProposal), same reasoning.
  const match = text(message).match(/\b(?:assign|reassign|give)(?:\s+this|\s+these|\s+those|\s+them|\s+it)?(?:\s+tasks?)?\s+to\s+([A-Za-z][A-Za-z '.-]{1,60})/i);
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

function datePhraseToIso(phrase: string): string | null {
  const weekday = WEEKDAYS.find((w) => new RegExp(`\\b${w}\\b`, "i").test(phrase));
  if (weekday) return nextWeekdayIso(weekday);
  if (/\btomorrow\b/i.test(phrase)) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(12, 0, 0, 0);
    return d.toISOString();
  }
  const parsed = Date.parse(phrase);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function parseTaskDueDateIntent(message: string): TaskMutationIntent | null {
  const m = text(message);
  const match = m.match(/\b(?:due date|due|deadline)\b(?:.*?)\bto\b\s+(.+?)[.?!]?$/i) || m.match(/\breschedule\b(?:.*?)\bto\b\s+(.+?)[.?!]?$/i);
  if (!match) return null;
  const phrase = match[1].trim();
  const iso = datePhraseToIso(phrase);
  if (!iso) return null;
  return { operation: "change_due_date", field: "due_at", rawValue: phrase, canonicalValue: iso };
}

function parseTaskPriorityIntent(message: string): TaskMutationIntent | null {
  const priority = parsePriorityIntent(message);
  if (!priority) return null;
  return { operation: "change_priority", field: "priority", rawValue: priority.rawValue, canonicalValue: priority.canonicalValue };
}

export function parseTaskMutationIntent(message: string): TaskMutationIntent | null {
  return parseTaskStatusIntent(message) || parseTaskAssigneeIntent(message) || parseTaskDueDateIntent(message) || parseTaskPriorityIntent(message);
}

// ---------------------------------------------------------------------
// Batch target parsing (Phase 4, PR 4) -- "the first two", "the first
// 3", "all of them" / "all the overdue ones". Deliberately narrow, same
// discipline as the single-record parsers above: only ever recognizes
// an EXPLICIT count or an explicit "all", never guesses a number from
// vague language ("a few", "some").
//
// Milestone 2 -- adds a SINGLE-ordinal target ("pause the second one",
// "the first automation"), reusing the exact same batch machinery for
// a target list of length 1 rather than inventing a parallel single-
// target execution path. This closes a real production bug found in
// live verification: "pause the second one" / "move the first one to
// 3pm" previously fell through to the generic read-only ordinal
// follow-up resolver (attemptFollowUpResolution, which runs BEFORE
// capability routing) and got answered as a "tell me about it" lookup
// instead of proposing the mutation -- same collision class as the
// Milestone 1 "the first two" bug, just for the singular case Tasks'
// own batch flow never exercised (Tasks mutations always used "move
// THIS to..." for a single target, never "the first one"). See
// ConversationOrchestrator.ts's WRITE_DOMAIN_MUTATION_CHECK for the
// other half of this fix -- the follow-up resolver must defer to
// capability routing whenever the message is ALSO a genuine mutation
// for the active list's domain.
// ---------------------------------------------------------------------
export type BatchTargetIntent = { type: "count"; count: number } | { type: "all" } | { type: "ordinal"; position: number };

const BATCH_COUNT_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const ORDINAL_POSITION_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

export function parseBatchTargetIntent(message: string): BatchTargetIntent | null {
  const m = text(message).toLowerCase();
  const countMatch = m.match(/\bthe first (two|three|four|five|six|seven|eight|nine|ten|\d+)\b/);
  if (countMatch) {
    const raw = countMatch[1];
    const count = BATCH_COUNT_WORDS[raw] ?? parseInt(raw, 10);
    if (Number.isFinite(count) && count > 1) return { type: "count", count };
  }
  if (/\ball(?: of them| of these| the overdue ones| the open ones)?\b/.test(m) || /\beverything\b/.test(m)) {
    return { type: "all" };
  }
  // Milestone 2 -- "assign THOSE to Adoyi" (referring back to the
  // currently active/just-filtered list as a whole, not a specific
  // count) is one of the brief's own acceptance examples ("Which ones
  // are critical?" -> "Assign those to Adoyi."). Only ever consulted
  // once a real mutation verb has already matched (parseBatchTargetIntent
  // is only called from a write capability's supports()/createDraft()),
  // so treating a bare "those"/"these" as "everything currently in
  // scope" is safe and unambiguous in this context.
  if (/\b(?:those|these)\b/.test(m)) {
    return { type: "all" };
  }
  const ordinalMatch = m.match(/\bthe (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b(?:\s+one)?/);
  if (ordinalMatch) {
    return { type: "ordinal", position: ORDINAL_POSITION_WORDS[ordinalMatch[1]] };
  }
  return null;
}

// Batch-only, lenient due-date fallback: "move the first two to Monday"
// has no "due"/"deadline"/"reschedule" keyword the single-record
// parseTaskDueDateIntent requires, but is unambiguous once a batch
// target is already present. Only ever tried after parseBatchTargetIntent
// has matched (see isTaskMutationMessage/officeTasksWriteModule's batch
// branch), so it never widens matching for a single-record message.
export function parseBatchMutationIntent(message: string): TaskMutationIntent | null {
  const direct = parseTaskMutationIntent(message);
  if (direct) return direct;
  const match = text(message).match(/\bto\s+(.+?)[.?!]?$/i);
  if (!match) return null;
  const phrase = match[1].trim();
  const iso = datePhraseToIso(phrase);
  if (!iso) return null;
  return { operation: "change_due_date", field: "due_at", rawValue: phrase, canonicalValue: iso };
}

// Single source of truth for "is this message trying to mutate a task"
// across BOTH office_tasks.write's own supports() and office_tasks.read/
// office_tasks.query.read's exclusion guards -- keeps the three-way
// mutual exclusion correct now that batch messages ("move the first two
// to Monday") don't match the single-record parseTaskMutationIntent
// alone.
export function isTaskMutationMessage(message: string): boolean {
  if (parseTaskMutationIntent(message)) return true;
  const batchTarget = parseBatchTargetIntent(message);
  return Boolean(batchTarget && parseBatchMutationIntent(message));
}

// ---------------------------------------------------------------------
// Revision parsing -- a short correction sent while a proposal is
// already PENDING ("actually make it Monday", "change Tony to Adoyi")
// legitimately doesn't repeat the original trigger phrase ("change the
// due date to"/"assign this to"). Rather than requiring the full phrase
// every time, this is tried ONLY when a pending proposal already exists
// (see ConversationOrchestrator.ts's handleOfficeActionProposalTurn),
// reusing the SAME per-operation value parsers above in a looser mode
// that trusts the pending proposal's own operation to say what KIND of
// value is being revised. Deliberately bounded to short messages (<=6
// words) so an unrelated longer sentence can never be misread as a
// revision.
const REVISION_PREFIX = /^(?:actually,?\s*|no,?\s*|wait,?\s*)?(?:make it|change it to|change that to|change [a-z]+ to|instead,?\s*make it|instead)\s*/i;

export function reconstructTaskTriggerPhrase(intent: TaskMutationIntent): string {
  if (intent.operation === "status_transition") return `move this to ${intent.canonicalValue.replace(/_/g, " ")}`;
  if (intent.operation === "reassign_owner") return `assign this to ${intent.canonicalValue}`;
  if (intent.operation === "change_priority") return `make this ${intent.canonicalValue} priority`;
  return `change the due date to ${intent.canonicalValue}`;
}

export function parseTaskRevisionIntent(message: string, pendingOperation: string): TaskMutationIntent | null {
  const raw = text(message);
  if (!raw || raw.split(/\s+/).length > 6) return null;
  const candidate = raw.replace(REVISION_PREFIX, "").trim().replace(/[.?!]+$/, "") || raw;
  if (!candidate) return null;
  if (pendingOperation === "status_transition") {
    for (const [pattern, canonical] of TASK_STATUS_WORDS) {
      if (pattern.test(candidate)) return { operation: "status_transition", field: "status", rawValue: candidate, canonicalValue: canonical };
    }
    return null;
  }
  if (pendingOperation === "reassign_owner") {
    if (!/^[A-Za-z][A-Za-z '.-]{1,60}$/.test(candidate) || /^(?:me|myself|him|her|them|someone|anyone)$/i.test(candidate)) return null;
    return { operation: "reassign_owner", field: "assignee", rawValue: candidate, canonicalValue: candidate };
  }
  if (pendingOperation === "change_due_date") {
    const iso = datePhraseToIso(candidate);
    if (!iso) return null;
    return { operation: "change_due_date", field: "due_at", rawValue: candidate, canonicalValue: iso };
  }
  if (pendingOperation === "change_priority") {
    const priority = parsePriorityIntent(`make it ${candidate}`) || parsePriorityIntent(candidate);
    if (!priority && !/^(?:high|medium|normal|low)$/i.test(candidate)) return null;
    const canonical = priority?.canonicalValue || candidate.toLowerCase().replace("normal", "medium");
    return { operation: "change_priority", field: "priority", rawValue: candidate, canonicalValue: canonical };
  }
  return null;
}

export type MeetingMutationIntent =
  | { operation: "status_transition"; field: "status"; rawValue: string; canonicalValue: string }
  | { operation: "reschedule"; field: "scheduled_at"; rawValue: string; canonicalValue: string };

// Reuses the same weekday/tomorrow/date-phrase parsing as Tasks' due
// date, plus a bare time-of-day ("3pm"/"15:00") applied to today (or
// tomorrow if that time has already passed) -- "move the first one to
// 3pm" from the acceptance examples has no day at all, just a time.
function timePhraseToIso(phrase: string): string | null {
  const timeMatch = phrase.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!timeMatch) return null;
  let hour = parseInt(timeMatch[1], 10);
  const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
  const meridiem = timeMatch[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour < 8) hour += 12; // "move it to 3" means 3pm during business hours, not 3am.
  if (hour > 23 || minute > 59) return null;
  const result = new Date();
  result.setUTCHours(hour, minute, 0, 0);
  if (result.getTime() < Date.now()) result.setUTCDate(result.getUTCDate() + 1);
  return result.toISOString();
}

function meetingReschedulePhraseToIso(phrase: string): string | null {
  return datePhraseToIso(phrase) || timePhraseToIso(phrase);
}

export function parseMeetingMutationIntent(message: string): MeetingMutationIntent | null {
  const m = text(message);
  if (/\bcancel\b/i.test(m) && /\bmeeting\b|\bthis\b/i.test(m)) {
    return { operation: "status_transition", field: "status", rawValue: "cancel", canonicalValue: "cancelled" };
  }
  const rescheduleMatch = m.match(/\b(?:move|reschedule|change)\b(?:.*?)\bto\b\s+(.+?)[.?!]?$/i);
  if (rescheduleMatch) {
    const iso = meetingReschedulePhraseToIso(rescheduleMatch[1].trim());
    if (iso) return { operation: "reschedule", field: "scheduled_at", rawValue: rescheduleMatch[1].trim(), canonicalValue: iso };
  }
  return null;
}

export type SupportMutationIntent =
  | { operation: "resolve_case"; field: "status"; rawValue: string; canonicalValue: "resolved"; resolutionNotes: string | null }
  | { operation: "reassign_owner"; field: "assigned_staff"; rawValue: string; canonicalValue: string }
  | { operation: "change_priority"; field: "priority"; rawValue: string; canonicalValue: string };

function parseSupportResolveIntent(message: string): SupportMutationIntent | null {
  const m = text(message);
  if (!/\bresolve[d]?\b|\bmark(?:ed)?\b.*\bresolved\b|\bclose this (?:case|ticket)\b/i.test(m)) return null;
  const noteMatch = m.match(/\bresolve[d]?(?:\s+this)?(?:\s+(?:case|ticket|support case))?\s*[-:—]\s*(.+)$/i);
  const resolutionNotes = noteMatch ? noteMatch[1].trim() : null;
  return { operation: "resolve_case", field: "status", rawValue: "resolved", canonicalValue: "resolved", resolutionNotes };
}

function parseSupportAssigneeIntent(message: string): SupportMutationIntent | null {
  const match = text(message).match(/\b(?:assign|reassign)(?:\s+this|\s+these|\s+those|\s+them)?(?:\s+cases?|\s+issues?|\s+tickets?)?\s+to\s+([A-Za-z][A-Za-z '.-]{1,60})/i);
  if (!match) return null;
  const name = match[1].trim().replace(/[.?!]+$/, "");
  if (!name || /^(?:me|myself|him|her|them|someone|anyone)$/i.test(name)) return null;
  return { operation: "reassign_owner", field: "assigned_staff", rawValue: name, canonicalValue: name };
}

function parseSupportPriorityIntent(message: string): SupportMutationIntent | null {
  const priority = parsePriorityIntent(message);
  if (!priority) return null;
  return { operation: "change_priority", field: "priority", rawValue: priority.rawValue, canonicalValue: priority.canonicalValue };
}

export function parseSupportMutationIntent(message: string): SupportMutationIntent | null {
  return parseSupportResolveIntent(message) || parseSupportAssigneeIntent(message) || parseSupportPriorityIntent(message);
}

// ---------------------------------------------------------------------
// Automations — pause/resume. No STATUS_TRANSITIONS table (there's no
// state machine, just a boolean `enabled`), so no validateTransition
// call for this one; the only real "invalid" case (already in that
// state) is checked directly against the ref/context's own current value.
// ---------------------------------------------------------------------
export type AutomationMutationIntent = { operation: "pause" | "resume"; field: "enabled"; rawValue: string; canonicalValue: boolean };

export function parseAutomationMutationIntent(message: string): AutomationMutationIntent | null {
  const m = text(message);
  if (/\b(?:pause|disable|turn off|deactivate)\b/i.test(m)) {
    return { operation: "pause", field: "enabled", rawValue: "pause", canonicalValue: false };
  }
  if (/\b(?:resume|enable|turn on|activate|reactivate)\b/i.test(m)) {
    return { operation: "resume", field: "enabled", rawValue: "resume", canonicalValue: true };
  }
  return null;
}

export function isAutomationMutationMessage(message: string): boolean {
  return Boolean(parseAutomationMutationIntent(message));
}

export type PortfolioMutationIntent = { operation: "status_transition"; field: "status"; rawValue: string; canonicalValue: string };

const PORTFOLIO_STATUS_WORDS: Array<[RegExp, string]> = [
  [/\bnormal\b/i, "normal"],
  [/\battention\b|\bat risk\b|\bneeds attention\b/i, "attention"],
  [/\bon hold\b/i, "on_hold"],
  [/\bactive\b/i, "active"],
  [/\bcomplete[d]?\b/i, "completed"],
  [/\bcancell?ed\b/i, "cancelled"],
];

export function parsePortfolioMutationIntent(message: string): PortfolioMutationIntent | null {
  const m = text(message);
  if (!/\b(?:move|change|update|mark|set)\b/i.test(m)) return null;
  for (const [pattern, canonical] of PORTFOLIO_STATUS_WORDS) {
    const match = m.match(pattern);
    if (match) return { operation: "status_transition", field: "status", rawValue: match[0], canonicalValue: canonical };
  }
  return null;
}

// Milestone 2 correctness note: Office's updateOperationalRecord (see
// office-operational-workflows.js's assertTransition/normalizeStatus)
// validates transitions against review_status, falling back to status
// only when review_status is absent -- review_status is the field this
// programme's PartnershipContextSlot actually carries too (Backend has
// no forwarded "status" field for partnerships at all). field is
// "review_status", not "status", to match what's real on both ends.
export type PartnershipMutationIntent = { operation: "status_transition"; field: "review_status"; rawValue: string; canonicalValue: string };

const PARTNERSHIP_STATUS_WORDS: Array<[RegExp, string]> = [
  [/\bunder review\b/i, "under_review"],
  [/\bactive\b/i, "active"],
  [/\bpaused\b/i, "paused"],
  [/\bclosed\b/i, "closed"],
  [/\bdeclined\b/i, "declined"],
];

export function parsePartnershipMutationIntent(message: string): PartnershipMutationIntent | null {
  const m = text(message);
  if (!/\b(?:move|change|update|mark|set)\b/i.test(m)) return null;
  for (const [pattern, canonical] of PARTNERSHIP_STATUS_WORDS) {
    const match = m.match(pattern);
    if (match) return { operation: "status_transition", field: "review_status", rawValue: match[0], canonicalValue: canonical };
  }
  return null;
}

export { TASK_STATUS_TRANSITIONS, MEETING_STATUS_TRANSITIONS, SUPPORT_STATUS_TRANSITIONS, PORTFOLIO_STATUS_TRANSITIONS, PARTNERSHIP_STATUS_TRANSITIONS, validateTransition };

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
    child_operations: null,
  };
}

// Phase 4, PR 4 -- wraps N already-built single-record proposals (each
// constructed by the exact same per-operation builders as a lone
// proposal, just looped over a resolved result-set target instead of
// the single open *_context slot) into one parent. The parent itself
// has no execute_directive (target_entity_id is the sentinel "batch")
// -- Office iterates child_operations on confirm, one apiPatchOperational
// call per child, the SAME call every single-record confirm already
// makes.
export function buildBatchGovernedActionProposal(input: {
  threadId: string;
  actorId: string;
  domain: string;
  operation: string;
  description: string;
  riskLevel: OfficeMutationRiskLevel;
  children: GovernedActionProposal[];
}): GovernedActionProposal {
  const now = new Date();
  const proposalId = randomUUID();
  return {
    proposal_id: proposalId,
    thread_id: input.threadId,
    actor_id: input.actorId,
    domain: input.domain,
    target_entity_type: input.children[0]?.target_entity_type || "task",
    target_entity_id: "batch",
    operation: input.operation,
    parameters: { child_count: input.children.length },
    description: input.description,
    previous_state: null,
    proposed_state: null,
    authorization: { allowed: true, reason: null, required_permissions: [] },
    validation: { valid: true, reason: null },
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
    execute_directive: null,
    child_operations: input.children,
  };
}

// Phase 3/4 -- revision accumulation. Previously, "actually Tuesday"
// followed by "and give it to Tony" replaced the whole proposal each
// time (a fresh single-field buildGovernedActionProposal() call
// derived from the still-unchanged task_context), so the second
// revision silently discarded the first. This instead ADDS the new
// field into the same proposal's parameters/proposed_state/
// execute_directive.patch, refreshing the TTL (same "read the card,
// don't let a stale yes fire days later" reasoning as a fresh
// proposal). Single-record only -- batch proposals are explicitly out
// of scope here (see ConversationOrchestrator.ts's fallthrough guard).
//
// Milestone 2 (Backend): generalized from Tasks-only to any single-
// record domain's mutation intent shape (the caller picks the right
// per-domain parser; this function only needs {field, rawValue,
// canonicalValue}). Also now accumulates previous_state, not just
// proposed_state -- previously a field added on a LATER revision never
// got a previous_state entry at all (mergeTaskRevisionIntoProposal
// never touched it), so the multi-field diff card had nothing to show
// on the "before" side for that field. currentValue is the field's
// live value at the moment of the revision (from the caller's already-
// populated context slot) -- captured once, on first mention, same
// "don't re-derive, don't fabricate" principle as everywhere else in
// this file.
export function mergeTaskRevisionIntoProposal(
  pending: GovernedActionProposal,
  intent: { operation: string; field: string; rawValue: string; canonicalValue: unknown },
  description: string,
  currentValue?: unknown
): GovernedActionProposal {
  const now = new Date();
  const priorFieldsRaw = recordOf(pending.parameters).fields;
  // Seed from the base proposal's own field/raw_value/canonical_value on
  // the FIRST merge (buildGovernedActionProposal never populates a
  // `fields` map itself -- that shape is introduced here) so a proposal
  // revised exactly once still carries a complete fields map, not just
  // the newly-added one.
  const priorFields: Record<string, unknown> =
    priorFieldsRaw && typeof priorFieldsRaw === "object"
      ? (priorFieldsRaw as Record<string, unknown>)
      : text((pending.parameters as Record<string, unknown> | undefined)?.field)
      ? { [(pending.parameters as Record<string, unknown>).field as string]: { raw_value: (pending.parameters as Record<string, unknown>).raw_value, canonical_value: (pending.parameters as Record<string, unknown>).canonical_value } }
      : {};
  const priorPreviousState = recordOf(pending.previous_state);
  const nextPreviousState = Object.prototype.hasOwnProperty.call(priorPreviousState, intent.field)
    ? priorPreviousState
    : { ...priorPreviousState, [intent.field]: currentValue ?? null };
  return {
    ...pending,
    description,
    parameters: {
      ...pending.parameters,
      fields: {
        ...priorFields,
        [intent.field]: { raw_value: intent.rawValue, canonical_value: intent.canonicalValue },
      },
    },
    previous_state: nextPreviousState,
    proposed_state: { ...(pending.proposed_state || {}), [intent.field]: intent.canonicalValue },
    execute_directive: pending.execute_directive
      ? { ...pending.execute_directive, patch: { ...pending.execute_directive.patch, [intent.field]: intent.canonicalValue } }
      : pending.execute_directive,
    expires_at: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
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
    child_operations: proposal.child_operations ? proposal.child_operations.map(proposalPublicView) : null,
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
