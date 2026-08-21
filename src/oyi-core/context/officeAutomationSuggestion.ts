// Oyi Conversational Runtime Completion Programme, Phase 4, PR 6 -- NL
// scheduling handoff.
//
// ARCHITECTURE NOTE (a deviation from the brief, disclosed before
// implementing, per the programme's own "explain the deviation clearly"
// instruction): the New Automation wizard's "Then" step -- and the
// backend execution it drives (consumer_automations, scenes.ts) --
// only ever creates or transitions a WORKFLOW. Tasks (the CRM
// collection Phase 4 PR 2-5's governed proposals operate on) are not an
// automatable entity in this system at all; there is no real "change a
// task's due date weekly" action to hand the wizard. Fabricating one
// would violate the programme's own repeated instruction to never
// invent an unsupported action. So this recognizes "do that every
// Friday" and prefills only what's real: the TRIGGER (a genuine,
// already-executed automationScheduleService.ts "weekdays" schedule the
// wizard's own UI just didn't expose a control for yet -- added
// alongside this) and a suggested name referencing the just-verified
// operation. The ACTION step still requires the same manual entry it
// always has; nothing about "never auto-create" changes.
//
// Pure only -- no Supabase import. corporateOfficeInternalPolicy.ts
// (toolProposals()) is a genuinely Supabase-free policy file today and
// must stay that way; the DB-touching loader lives in the sibling
// officeAutomationSuggestionStore.ts instead, imported only where a
// live thread read is actually needed (canonicalConversationPersistence.
// ts, officeExport.ts).
import type { GovernedActionProposal } from "../../contracts/governedAction";

function text(value: unknown) {
  return String(value ?? "").trim();
}

// ---------------------------------------------------------------------
// "do that every Friday" / "repeat this weekly" / "run that monthly" --
// deliberately narrow: requires a literal referring word ("that"/
// "this"/"it") so a message about an UNRELATED cadence ("we meet every
// Friday") doesn't misfire. 0=Sunday..6=Saturday, matching
// automationScheduleService.ts's own convention.
//
// Milestone 2 widened this from weekday-only to also recognize daily
// and generic weekly/monthly cadence references (still referent-gated).
// "monthly" is deliberately never given a schedule prefill below --
// automationScheduleService.ts (and the wizard's own schedule_type
// options: once/daily/weekdays) has no monthly recurrence at all, and
// inventing one here would violate the "never invent an unsupported
// action" rule this whole mechanism exists to uphold. Recognizing the
// cadence WORD still matters, though: it's what stops the message from
// being misrouted to an unrelated read capability (see
// GENERIC_AUTOMATION_REFERENCE_PATTERN below), and it lets the reason
// text be honest about the gap instead of silently prefilling nothing.
// ---------------------------------------------------------------------
export type AutomationScheduleIntent =
  | { cadence: "weekday"; weekday: number; weekdayName: string }
  | { cadence: "daily" }
  | { cadence: "weekly" }
  | { cadence: "monthly" };

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const REFERENT = "(?:that|this|it)";

export function parseAutomationScheduleIntent(message: string): AutomationScheduleIntent | null {
  const m = text(message).toLowerCase();

  const weekdayMatch = m.match(new RegExp(`\\b(?:do|run|repeat)?\\s*${REFERENT}\\s+every\\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\\b`));
  if (weekdayMatch) {
    const weekday = WEEKDAY_NAMES.indexOf(weekdayMatch[1]);
    if (weekday >= 0) {
      return { cadence: "weekday", weekday, weekdayName: weekdayMatch[1].charAt(0).toUpperCase() + weekdayMatch[1].slice(1) };
    }
  }

  const dailyMatch = new RegExp(`\\b(?:do|run|repeat)\\s+${REFERENT}\\s+(?:every\\s+day|daily)\\b`).test(m) ||
    new RegExp(`\\bkeep\\s+doing\\s+${REFERENT}\\s+(?:every\\s+day|daily)\\b`).test(m);
  if (dailyMatch) return { cadence: "daily" };

  const monthlyMatch = new RegExp(`\\b(?:do|run|repeat)\\s+${REFERENT}\\s+(?:every\\s+month|monthly)\\b`).test(m);
  if (monthlyMatch) return { cadence: "monthly" };

  const weeklyMatch =
    new RegExp(`\\b(?:do|run|repeat)\\s+${REFERENT}\\s+(?:every\\s+week|weekly|each\\s+week)\\b`).test(m) ||
    new RegExp(`\\bkeep\\s+doing\\s+${REFERENT}\\s+(?:every\\s+week|weekly|each\\s+week)\\b`).test(m) ||
    new RegExp(`\\bmake\\s+${REFERENT}\\s+recurring\\b`).test(m);
  if (weeklyMatch) return { cadence: "weekly" };

  return null;
}

// ---------------------------------------------------------------------
// Broader than parseAutomationScheduleIntent on purpose -- this is the
// existing generic detector corporateOfficeInternalPolicy.ts's
// toolProposals() already used to open the manual New Automation wizard
// (name-only, no prefill) for phrasing too vague to safely prefill a
// trigger from ("whenever a new qualified lead arrives, create a
// follow-up", "set up a rule for this"). Milestone 2 hoists it here as
// the single source of truth so office_*.read capabilities can also
// defer to it (a scheduling/automation REFERENCE of any shape must
// never be claimed by an unrelated record-read capability, not just the
// narrow weekday-prefill shape -- that was the exact office_tasks.read
// collision found in Milestone 1 production verification).
// ---------------------------------------------------------------------
export const GENERIC_AUTOMATION_REFERENCE_PATTERN = /\b(automat|recurring|every (day|week|time|month)|whenever|set up a rule)\b/i;

export function isAutomationScheduleOrRecurrenceMessage(message: string): boolean {
  return Boolean(parseAutomationScheduleIntent(message)) || GENERIC_AUTOMATION_REFERENCE_PATTERN.test(text(message));
}

// ---------------------------------------------------------------------
// Persisted alongside pending_action_proposal (same
// oyi_conversation_threads.metadata JSONB, sibling key, 10-minute-ish
// freshness window so "do that every Friday" only ever resolves against
// something the staff member JUST verified in this same conversation --
// never a record from days ago). Set once, on successful verification
// (see ConversationOrchestrator.ts); read-only elsewhere (see
// officeAutomationSuggestionStore.ts's loader).
// ---------------------------------------------------------------------
export type LastVerifiedOfficeAction = {
  domain: string;
  operation: string;
  target_entity_type: string;
  target_label: string;
  description: string;
  verified_at: string;
};

export const LAST_VERIFIED_ACTION_TTL_MS = 10 * 60 * 1000;

export function buildLastVerifiedOfficeAction(proposal: GovernedActionProposal, label: string, description: string): LastVerifiedOfficeAction {
  return {
    domain: proposal.domain,
    operation: proposal.operation,
    target_entity_type: proposal.target_entity_type,
    target_label: label,
    description,
    verified_at: new Date().toISOString(),
  };
}

// office.create_automation's EXISTING parameters shape (toolProposals(),
// corporateOfficeInternalPolicy.ts) gains two purely-additive fields --
// suggested_schedule (real, wizard-consumable) and a richer
// suggested_name. review_required stays true; nothing here can create
// an automation on its own.
//
// cadence "monthly" deliberately omits suggested_schedule entirely (see
// the header note on parseAutomationScheduleIntent) -- the wizard opens
// with just a descriptive name, same as the generic no-prefill path,
// rather than guessing a schedule shape the runtime can't represent.
// cadence "weekly" prefills the real schedule_type but leaves weekdays
// empty rather than inventing which day was meant.
export function automationScheduleSuggestionParameters(intent: AutomationScheduleIntent, lastAction: LastVerifiedOfficeAction) {
  const cadenceLabel = intent.cadence === "weekday" ? `every ${intent.weekdayName}` : intent.cadence === "daily" ? "every day" : intent.cadence === "weekly" ? "every week" : "every month";
  const suggested_name = `${lastAction.description} ${cadenceLabel}`.slice(0, 120);
  if (intent.cadence === "weekday") {
    return { suggested_name, suggested_schedule: { schedule_type: "weekdays" as const, weekdays: [intent.weekday], local_time: "09:00" } };
  }
  if (intent.cadence === "daily") {
    return { suggested_name, suggested_schedule: { schedule_type: "daily" as const, local_time: "09:00" } };
  }
  if (intent.cadence === "weekly") {
    return { suggested_name, suggested_schedule: { schedule_type: "weekdays" as const, weekdays: [] as number[], local_time: "09:00" } };
  }
  return { suggested_name };
}

export function automationSuggestionProposalId(requestId: string) {
  return `office_automation_schedule_${requestId}`;
}
