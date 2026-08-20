// Oyi Conversational Runtime Completion Programme, Phase 2 — Conversation
// Continuity for office_internal.
//
// Office's frontend already resends the currently-selected record's
// *_context slot (task_context, automation_context, etc.) on EVERY turn
// for as long as the same detail page stays open (see office.js's
// currentSelectedObjectContext(), spread into every sendOyiMessage()
// call). That means the dominant continuity signal for "what record is
// this turn about" is usually already sitting on the CURRENT request --
// the structural bug fixed here is that domain resolution only ever
// looked at this turn's TEXT (classifyDomain), never at which context
// slot was actually populated, so a keyword-less follow-up ("who owns
// it?") or an incidentally-matching keyword ("is it connected to a
// task?" while an Automation is open) could route to the wrong place or
// nowhere at all.
//
// Deliberately NOT built on Consumer/Facility's ResultSetContext
// machinery (resultSetContext.ts) -- that's a list-of-records abstraction
// (ordinal/attribute/filter resolution against "the leads I just
// showed you"), the wrong shape for Office's "exactly one record is
// open right now" model. This is a small, purpose-built, additive
// sibling that reuses the SAME oyi_conversation_threads table (writing
// into a new metadata.business_active_context key, no migration) and the
// SAME persistCanonicalConversationTurn write path (no second write).
import { logger } from "../../observability/logger";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import type { CanonicalConversationRequestContext } from "../contracts/conversation";
import type { CapabilityContext } from "../contracts/capability";
import type { ResolvedTurn } from "../contracts/resolvedTurn";
import type { OyiDomain } from "../runtime/languageUnderstanding";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

export type OfficeContextSlotKey =
  | "task_context"
  | "automation_context"
  | "meeting_context"
  | "support_context"
  | "portfolio_context"
  | "partnership_context"
  | "document_context"
  | "content_context";

// Only slots that map to a real, currently-registered single-record
// capability. crm_context (reads operational_snapshot, not a single
// selected record) and project_context (no registered capability at
// all) are deliberately excluded -- continuity has nothing to hand off
// to for either.
export const OFFICE_CONTEXT_SLOT_DOMAIN: Record<OfficeContextSlotKey, OyiDomain> = {
  task_context: "office_tasks",
  automation_context: "automations",
  meeting_context: "office_meetings",
  support_context: "office_support",
  portfolio_context: "office_portfolio",
  partnership_context: "corporate_partnerships",
  document_context: "office_documents",
  content_context: "office_content",
};

const OFFICE_SLOT_REF_FIELD: Record<OfficeContextSlotKey, string> = {
  task_context: "task_ref",
  automation_context: "automation_ref",
  meeting_context: "meeting_ref",
  support_context: "support_case_ref",
  portfolio_context: "portfolio_ref",
  partnership_context: "partnership_ref",
  document_context: "document_ref",
  content_context: "content_ref",
};

const OFFICE_RECORD_DOMAINS = new Set<OyiDomain>(Object.values(OFFICE_CONTEXT_SLOT_DOMAIN));

export function isOfficeRecordDomain(domain: string | null | undefined): boolean {
  return Boolean(domain && OFFICE_RECORD_DOMAINS.has(domain as OyiDomain));
}

export type PopulatedOfficeSlot = {
  slotKey: OfficeContextSlotKey;
  domain: OyiDomain;
  slot: Record<string, unknown>;
  ref: string | null;
  safeSummary: string | null;
};

// Returns the SINGLE populated *_context slot on this request, or null if
// zero or more than one are populated. More than one populated at once
// shouldn't happen (Office's frontend only ever sends the one currently-
// selected object's slot) but if it ever did, guessing which one the
// user means risks silently answering about the wrong record -- treated
// identically to "nothing populated" rather than picking one.
export function populatedOfficeContextSlot(context: CapabilityContext): PopulatedOfficeSlot | null {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const record = requestContext as Record<string, unknown>;
  const populated: PopulatedOfficeSlot[] = [];
  for (const slotKey of Object.keys(OFFICE_CONTEXT_SLOT_DOMAIN) as OfficeContextSlotKey[]) {
    const rawSlot = record[slotKey];
    if (!rawSlot || typeof rawSlot !== "object" || Array.isArray(rawSlot)) continue;
    const slot = rawSlot as Record<string, unknown>;
    const safeSummary = text(slot.safe_summary) || null;
    const ref = text(slot[OFFICE_SLOT_REF_FIELD[slotKey]]) || null;
    if (!safeSummary && !ref) continue;
    populated.push({ slotKey, domain: OFFICE_CONTEXT_SLOT_DOMAIN[slotKey], slot, ref, safeSummary });
  }
  return populated.length === 1 ? populated[0] : null;
}

// Explicit closure/pivot language -- when present alongside a text-
// classified domain whose context slot ISN'T populated, the switch is
// honored (the currently-open record's context is left behind) instead
// of being treated as an incidental keyword mention of the open record's
// attributes (e.g. "is it connected to a task?" while an Automation is
// open has NO such phrase, so it stays in Automation context).
const EXPLICIT_SWITCH_PATTERN = /\b(?:we'?re done with|done with (?:this|that)|finished with (?:this|that)|moving on from|switching to|switching over to|let'?s (?:talk|switch) about|forget (?:this|that)|different question|new topic|instead\b)/i;

export function hasExplicitDomainSwitchSignal(message: string): boolean {
  return EXPLICIT_SWITCH_PATTERN.test(text(message));
}

export type OfficeActiveContext = {
  thread_id: string;
  actor_id: string;
  surface: "office_internal";
  active_domain: OyiDomain;
  active_context_slot_key: OfficeContextSlotKey;
  active_record_ref: string | null;
  active_record_safe_summary: string | null;
  active_context_slot: Record<string, unknown>;
  active_capability_key: string | null;
  last_intent_label: string | null;
  last_user_message: string;
  last_result_status: string | null;
  last_result_excerpt: string | null;
  updated_at: string;
  expires_at: string;
};

// 45 minutes -- long enough to survive a staff member reading through a
// record's linked pages and coming back to the chat, short enough that a
// stale record-linkage doesn't silently resurface hours later in what is
// functionally a new conversation.
const OFFICE_ACTIVE_CONTEXT_TTL_MS = 45 * 60 * 1000;

export function buildOfficeActiveContext(input: {
  threadId: string;
  actorId: string;
  populated: PopulatedOfficeSlot;
  capabilityKey: string | null;
  intentLabel: string | null;
  userMessage: string;
  resultStatus: string | null;
  resultAnswer: string | null;
}): OfficeActiveContext {
  const now = new Date();
  return {
    thread_id: input.threadId,
    actor_id: input.actorId,
    surface: "office_internal",
    active_domain: input.populated.domain,
    active_context_slot_key: input.populated.slotKey,
    active_record_ref: input.populated.ref,
    active_record_safe_summary: input.populated.safeSummary,
    active_context_slot: input.populated.slot,
    active_capability_key: input.capabilityKey,
    last_intent_label: input.intentLabel,
    last_user_message: text(input.userMessage).slice(0, 240),
    last_result_status: input.resultStatus,
    last_result_excerpt: text(input.resultAnswer).slice(0, 240),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + OFFICE_ACTIVE_CONTEXT_TTL_MS).toISOString(),
  };
}

// Pure validation, split out from the DB fetch below so it's directly
// unit-testable without a live Supabase connection. Never treats memory
// belonging to a different actor, a different surface, or memory past
// its expiry as usable -- callers must treat a null return exactly like
// "no memory exists" and degrade honestly, never fabricate.
export function usableOfficeActiveContext(
  stored: Partial<OfficeActiveContext> | null | undefined,
  actorId: string | null | undefined,
  now: number = Date.now()
): OfficeActiveContext | null {
  if (!stored || !actorId) return null;
  if (stored.surface !== "office_internal") return null;
  if (text(stored.actor_id) !== text(actorId)) return null;
  if (!stored.expires_at || Date.parse(stored.expires_at) < now) return null;
  if (!stored.active_domain || !stored.active_context_slot_key || !stored.active_context_slot) return null;
  return stored as OfficeActiveContext;
}

// This never fetches a record from any store; it only replays a
// *_context object the SAME actor's OWN earlier turn in this SAME thread
// already received from Office's frontend, so it cannot grant access to
// anything the actor couldn't already see.
export async function loadOfficeActiveContext(
  threadId: string | null | undefined,
  actorId: string | null | undefined
): Promise<OfficeActiveContext | null> {
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
    const stored = recordOf(recordOf((data as any).metadata).business_active_context) as Partial<OfficeActiveContext>;
    return usableOfficeActiveContext(stored, actorId);
  } catch (error) {
    logger.warn("oyi_office_active_context_load_failed", { thread_id: threadId, error });
    return null;
  }
}

export type OfficeContinuitySource =
  | "unchanged"
  | "populated_slot_precedence"
  | "keyword_overridden_by_active_slot"
  | "explicit_switch_honored"
  | "persisted_memory_reinjected"
  | "persisted_memory_unavailable";

export type OfficeContinuityResult = {
  resolvedTurn: ResolvedTurn;
  context: CanonicalConversationRequestContext;
  source: OfficeContinuitySource;
};

// The single entry point called from ConversationOrchestrator.run(),
// right after resolveTurnAuthority() and before capability resolution.
// office_internal only -- a no-op (source: "unchanged", same objects
// returned) for every other surface, so Consumer/Facility/public_
// corporate are structurally unaffected by construction, not by
// convention.
//
// Precedence, in order:
//   1. This turn's OWN populated *_context slot always wins over a
//      stale/incidental keyword UNLESS the message contains an explicit
//      switch/closure phrase naming a genuinely different domain (case D
//      in the Phase 2 spec) -- "is it connected to a task?" while an
//      Automation is open has no such phrase, so it stays in Automation
//      context (case B); "we're done with this meeting, what's happening
//      with the support case for AC failure?" does, so Support wins even
//      though support_context isn't populated (the capability then
//      answers its own honest "I don't have that case open").
//   2. A genuinely different, non-record business domain named in text
//      (crm/office_financial/office_reports/office_development) is
//      always the user's own explicit, unambiguous signal -- never
//      overridden by a stale open record.
//   3. Only when the text names NO domain at all (a true pronoun/
//      reference follow-up, e.g. "who owns it?") AND no slot is
//      populated on this request AND there's no explicit switch-away
//      phrase, fall back to persisted per-thread memory -- checked
//      against the CURRENT actor and an expiry window inside
//      loadOfficeActiveContext, never trusted blindly.
export async function resolveOfficeConversationContinuity(
  context: CanonicalConversationRequestContext,
  resolvedTurn: ResolvedTurn
): Promise<OfficeContinuityResult> {
  if (context.input.surface !== "office_internal") {
    return { resolvedTurn, context, source: "unchanged" };
  }
  const rawDomain = resolvedTurn.domain;
  const message = context.input.message;
  const populated = populatedOfficeContextSlot(context as CapabilityContext);

  if (populated) {
    if (rawDomain === populated.domain) {
      return { resolvedTurn, context, source: "unchanged" };
    }
    if (isOfficeRecordDomain(rawDomain) && hasExplicitDomainSwitchSignal(message)) {
      return { resolvedTurn, context, source: "explicit_switch_honored" };
    }
    if (rawDomain !== null && !isOfficeRecordDomain(rawDomain)) {
      // A genuinely different, non-record business topic -- respect it.
      return { resolvedTurn, context, source: "unchanged" };
    }
    const adjustedResolvedTurn: ResolvedTurn = {
      ...resolvedTurn,
      domain: populated.domain,
      semantic_frame: { ...resolvedTurn.semantic_frame, domain: populated.domain },
    };
    return {
      resolvedTurn: adjustedResolvedTurn,
      context,
      source: rawDomain === null ? "populated_slot_precedence" : "keyword_overridden_by_active_slot",
    };
  }

  if (rawDomain !== null) {
    // A real domain was named but its slot isn't populated this turn --
    // normal honest-absence territory ("select a record first"), nothing
    // to reinject.
    return { resolvedTurn, context, source: "unchanged" };
  }
  if (!context.input.thread_id || hasExplicitDomainSwitchSignal(message)) {
    return { resolvedTurn, context, source: "unchanged" };
  }
  const memory = await loadOfficeActiveContext(context.input.thread_id, context.actor?.id || null);
  if (!memory) {
    return { resolvedTurn, context, source: "persisted_memory_unavailable" };
  }
  const adjustedResolvedTurn: ResolvedTurn = {
    ...resolvedTurn,
    domain: memory.active_domain,
    semantic_frame: { ...resolvedTurn.semantic_frame, domain: memory.active_domain },
  };
  const adjustedContext: CanonicalConversationRequestContext = {
    ...context,
    input: {
      ...context.input,
      context: {
        ...recordOf(context.input.context),
        [memory.active_context_slot_key]: memory.active_context_slot,
      },
    },
  };
  return { resolvedTurn: adjustedResolvedTurn, context: adjustedContext, source: "persisted_memory_reinjected" };
}
