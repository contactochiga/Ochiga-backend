// Oyi Communication Actions Runtime -- the DRAFT ARTIFACT, kept
// deliberately distinct from PendingCommunicationPointer
// (communicationProposal.ts). Four kinds of Office conversational state
// are not interchangeable:
//   RESULT SET             -- resultSetContext.ts (which records came back)
//   ACTIVE BUSINESS OBJECT  -- officeConversationContext.ts / a result
//                              set's own selected_object_ref (which
//                              lead/task/etc. is currently being discussed)
//   DRAFT ARTIFACT          -- this file (the response/message being
//                              edited, BEFORE it is offered for send)
//   PENDING GOVERNED ACTION -- communicationProposal.ts's
//                              PendingCommunicationPointer (the exact
//                              send awaiting confirmation)
// A draft survives being cancelled-and-resent: "Send it." -> "Actually
// don't." cancels the PENDING send, not the draft itself, so a second
// "Send it." recreates a fresh pending proposal from the SAME draft
// content and target, per the required journey. Same
// oyi_conversation_threads.metadata JSONB sibling-key pattern as every
// other ephemeral per-thread pointer in this codebase (its own key,
// draft_communication, so it never collides with a pending send or a
// pending Task/Meeting mutation).
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import type { CommunicationChannelSelector, CommunicationRecipient } from "../../contracts/communication";

export type DraftCommunicationPointer = {
  target_domain: string;
  target_ref: string;
  target_label: string;
  channel: CommunicationChannelSelector;
  recipient_hint: Partial<CommunicationRecipient>;
  subject: string | null;
  body: string;
  thread_id: string;
  actor_id: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export const COMMUNICATION_DRAFT_TTL_MS = 30 * 60 * 1000;
const TTL_MS = COMMUNICATION_DRAFT_TTL_MS;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

export function buildDraftCommunicationPointer(input: {
  targetDomain: string;
  targetRef: string;
  targetLabel: string;
  channel: CommunicationChannelSelector;
  recipientHint: Partial<CommunicationRecipient>;
  subject: string | null;
  body: string;
  threadId: string;
  actorId: string;
  createdAt?: string;
}): DraftCommunicationPointer {
  const now = Date.now();
  return {
    target_domain: input.targetDomain,
    target_ref: input.targetRef,
    target_label: input.targetLabel,
    channel: input.channel,
    recipient_hint: input.recipientHint,
    subject: input.subject,
    body: input.body,
    thread_id: input.threadId,
    actor_id: input.actorId,
    created_at: input.createdAt || new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    expires_at: new Date(now + TTL_MS).toISOString(),
  };
}

async function loadStoredDraft(threadId: string | null | undefined, actorId: string | null | undefined): Promise<Partial<DraftCommunicationPointer> | null> {
  if (!threadId || !isUuid(threadId) || !actorId) return null;
  try {
    const { data, error } = await supabaseAdmin.from("oyi_conversation_threads").select("metadata,user_id").eq("id", threadId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (text((data as any).user_id) !== text(actorId)) return null;
    return recordOf(recordOf((data as any).metadata).draft_communication) as Partial<DraftCommunicationPointer>;
  } catch (error) {
    logger.warn("oyi_communication_draft_load_failed", { thread_id: threadId, error });
    return null;
  }
}

export function usableDraftCommunication(
  stored: Partial<DraftCommunicationPointer> | null | undefined,
  actorId: string | null | undefined,
  threadId: string | null | undefined,
  now: number = Date.now()
): DraftCommunicationPointer | null {
  if (!stored || !actorId || !threadId) return null;
  if (text(stored.actor_id) !== text(actorId)) return null;
  if (text(stored.thread_id) !== text(threadId)) return null;
  if (!stored.expires_at || Date.parse(stored.expires_at) < now) return null;
  if (!stored.body || !stored.target_ref) return null;
  return stored as DraftCommunicationPointer;
}

export async function loadDraftCommunication(
  threadId: string | null | undefined,
  actorId: string | null | undefined
): Promise<DraftCommunicationPointer | null> {
  const stored = await loadStoredDraft(threadId, actorId);
  return usableDraftCommunication(stored, actorId, threadId);
}
