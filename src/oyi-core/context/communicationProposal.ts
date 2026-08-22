// Oyi Communication Actions Runtime -- conversational governance pointer.
//
// Unlike GovernedActionProposal (officeActionProposal.ts), a communication
// is executed by BACKEND ITSELF (CommunicationRuntime.dispatch(), which
// either calls the provider directly -- email -- or bridges to Office for
// WhatsApp, still a Backend-initiated call). There is no client-side
// PATCH round-trip to wait for, so this pointer is deliberately smaller
// than a GovernedActionProposal: the full CommunicationRecord already
// lives in oyi_communications (persisted by CommunicationRuntime.plan()
// itself, for a complete audit trail even of unconfirmed drafts) -- this
// just remembers WHICH one is pending confirmation for this thread/actor,
// the same oyi_conversation_threads.metadata JSONB sibling-key pattern
// Phase 2/3 established, under its own key (pending_communication) so a
// pending Task/Meeting mutation and a pending communication can coexist
// without colliding.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";

export type PendingCommunicationPointer = {
  communication_id: string;
  thread_id: string;
  actor_id: string;
  channel: string;
  summary: string;
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

export function buildPendingCommunicationPointer(input: {
  communicationId: string;
  threadId: string;
  actorId: string;
  channel: string;
  summary: string;
}): PendingCommunicationPointer {
  const now = Date.now();
  return {
    communication_id: input.communicationId,
    thread_id: input.threadId,
    actor_id: input.actorId,
    channel: input.channel,
    summary: input.summary,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + TTL_MS).toISOString(),
  };
}

async function loadStoredPointer(threadId: string | null | undefined, actorId: string | null | undefined): Promise<Partial<PendingCommunicationPointer> | null> {
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
    return recordOf(recordOf((data as any).metadata).pending_communication) as Partial<PendingCommunicationPointer>;
  } catch (error) {
    logger.warn("oyi_communication_proposal_load_failed", { thread_id: threadId, error });
    return null;
  }
}

export function usablePendingCommunicationPointer(
  stored: Partial<PendingCommunicationPointer> | null | undefined,
  actorId: string | null | undefined,
  threadId: string | null | undefined,
  now: number = Date.now()
): PendingCommunicationPointer | null {
  if (!stored || !actorId || !threadId) return null;
  if (text(stored.actor_id) !== text(actorId)) return null;
  if (text(stored.thread_id) !== text(threadId)) return null;
  if (!stored.expires_at || Date.parse(stored.expires_at) < now) return null;
  if (!stored.communication_id) return null;
  return stored as PendingCommunicationPointer;
}

export async function loadPendingCommunicationPointer(
  threadId: string | null | undefined,
  actorId: string | null | undefined
): Promise<PendingCommunicationPointer | null> {
  const stored = await loadStoredPointer(threadId, actorId);
  return usablePendingCommunicationPointer(stored, actorId, threadId);
}

// Status-agnostic passthrough for an unrelated turn -- mirrors
// loadAnyOfficeActionProposal's own reasoning (an unrelated read
// question must not silently wipe an in-flight communication pointer).
export async function loadAnyCommunicationPointer(
  threadId: string | null | undefined,
  actorId: string | null | undefined
): Promise<PendingCommunicationPointer | null> {
  const stored = await loadStoredPointer(threadId, actorId);
  if (!stored || !actorId || !threadId) return null;
  if (text(stored.actor_id) !== text(actorId)) return null;
  if (text(stored.thread_id) !== text(threadId)) return null;
  if (!stored.expires_at || Date.parse(stored.expires_at) < Date.now()) return null;
  if (!stored.communication_id) return null;
  return stored as PendingCommunicationPointer;
}
