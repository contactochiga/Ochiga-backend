// Oyi generic person/recipient continuity.
//
// Two sibling keys in oyi_conversation_threads.metadata, same JSONB
// pattern Phase 2/3/Communication-Runtime already established:
//
// - resolved_person_context: the person currently "in focus" for this
//   thread ("Open the Daniel lead" -> "him"/"her"/"them" on later turns
//   resolve here). Three-state (undefined preserve / null clear / value
//   set), same convention as business_active_context.
//
// - pending_recipient_disambiguation: short-TTL state while Oyi is
//   waiting for the user to pick between multiple plausible matches
//   ("I found two contacts named David...") -- holds the candidate list
//   plus enough of the original request (channel/subject/body) to
//   resume it once the user picks one.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import type { ResolvedRecipient } from "../../contracts/recipientResolution";

export type PersonContext = {
  recipient: ResolvedRecipient;
  set_at: string;
};

export type PendingRecipientDisambiguation = {
  thread_id: string;
  actor_id: string;
  query: string;
  candidates: ResolvedRecipient[];
  resume: { channel: string; subject: string | null; body: string } | null;
  created_at: string;
  expires_at: string;
};

const TTL_MS = 10 * 60 * 1000;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

async function loadThreadMetadata(threadId: string | null | undefined, actorId: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!threadId || !isUuid(threadId) || !actorId) return null;
  try {
    const { data, error } = await supabaseAdmin.from("oyi_conversation_threads").select("metadata,user_id").eq("id", threadId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (text((data as any).user_id) !== text(actorId)) return null;
    return recordOf((data as any).metadata);
  } catch (error) {
    logger.warn("oyi_person_context_load_failed", { thread_id: threadId, error });
    return null;
  }
}

export async function loadPersonContext(threadId: string | null | undefined, actorId: string | null | undefined): Promise<PersonContext | null> {
  const metadata = await loadThreadMetadata(threadId, actorId);
  const stored = recordOf(metadata?.resolved_person_context) as Partial<PersonContext>;
  if (!stored?.recipient) return null;
  return stored as PersonContext;
}

export function buildPersonContext(recipient: ResolvedRecipient): PersonContext {
  return { recipient, set_at: new Date().toISOString() };
}

export async function loadPendingRecipientDisambiguation(
  threadId: string | null | undefined,
  actorId: string | null | undefined
): Promise<PendingRecipientDisambiguation | null> {
  const metadata = await loadThreadMetadata(threadId, actorId);
  const stored = recordOf(metadata?.pending_recipient_disambiguation) as Partial<PendingRecipientDisambiguation>;
  if (!stored?.candidates?.length) return null;
  if (text(stored.actor_id) !== text(actorId)) return null;
  if (text(stored.thread_id) !== text(threadId)) return null;
  if (!stored.expires_at || Date.parse(stored.expires_at) < Date.now()) return null;
  return stored as PendingRecipientDisambiguation;
}

export function buildPendingRecipientDisambiguation(input: {
  threadId: string;
  actorId: string;
  query: string;
  candidates: ResolvedRecipient[];
  resume: PendingRecipientDisambiguation["resume"];
}): PendingRecipientDisambiguation {
  const now = Date.now();
  return {
    thread_id: input.threadId,
    actor_id: input.actorId,
    query: input.query,
    candidates: input.candidates,
    resume: input.resume,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + TTL_MS).toISOString(),
  };
}

// Matches a user's disambiguation reply ("David Okoro", "the first one",
// "the one at ABC Ltd") against the pending candidate list. Returns null
// on no confident match -- the caller should re-ask rather than guess.
export function matchDisambiguationReply(message: string, candidates: ResolvedRecipient[]): ResolvedRecipient | null {
  const normalized = text(message).toLowerCase();
  if (!normalized) return null;
  const ordinalWords: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };
  const ordinalMatch = normalized.match(/\b(first|second|third|fourth|fifth)\b/);
  if (ordinalMatch) {
    const index = ordinalWords[ordinalMatch[1]];
    if (candidates[index]) return candidates[index];
  }
  const numberMatch = normalized.match(/\b(\d+)(?:st|nd|rd|th)?\b/);
  if (numberMatch) {
    const index = Number(numberMatch[1]) - 1;
    if (candidates[index]) return candidates[index];
  }
  const nameMatches = candidates.filter((c) => c.display_name && normalized.includes(c.display_name.toLowerCase()));
  if (nameMatches.length === 1) return nameMatches[0];
  const orgMatches = candidates.filter((c) => c.organisation_name && normalized.includes(c.organisation_name.toLowerCase()));
  if (orgMatches.length === 1) return orgMatches[0];
  return null;
}
