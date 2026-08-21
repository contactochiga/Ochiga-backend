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
// "do that every Friday" / "do this every day" -- deliberately narrow:
// requires the literal referring word ("that"/"this") so a message about
// an UNRELATED weekly cadence ("we meet every Friday") doesn't
// misfire. 0=Sunday..6=Saturday, matching automationScheduleService.ts's
// own convention.
// ---------------------------------------------------------------------
export type AutomationScheduleIntent = { weekday: number; weekdayName: string };

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseAutomationScheduleIntent(message: string): AutomationScheduleIntent | null {
  const m = text(message).toLowerCase();
  const match = m.match(/\bdo (?:that|this)\s+every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!match) return null;
  const weekday = WEEKDAY_NAMES.indexOf(match[1]);
  if (weekday < 0) return null;
  return { weekday, weekdayName: match[1].charAt(0).toUpperCase() + match[1].slice(1) };
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
export function automationScheduleSuggestionParameters(intent: AutomationScheduleIntent, lastAction: LastVerifiedOfficeAction) {
  return {
    suggested_name: `${lastAction.description} every ${intent.weekdayName}`.slice(0, 120),
    suggested_schedule: {
      schedule_type: "weekdays" as const,
      weekdays: [intent.weekday],
      local_time: "09:00",
    },
  };
}

export function automationSuggestionProposalId(requestId: string) {
  return `office_automation_schedule_${requestId}`;
}
