// Oyi Autonomous Work Runtime -- conversational governance pointer for
// goal creation. Exact same shape/reasoning as communicationProposal.ts:
// the full draft goal already lives in oyi_goals (status "proposed",
// created by goalRuntime.create() itself, for a complete audit trail
// even of unconfirmed drafts) -- this just remembers WHICH one is
// pending confirmation for this thread/actor, under its own
// oyi_conversation_threads.metadata sibling key (pending_goal) so it
// never collides with a pending Task/Meeting mutation or a pending
// communication.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";

export type PendingGoalPointer = {
  goal_id: string;
  thread_id: string;
  actor_id: string;
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

export function buildPendingGoalPointer(input: { goalId: string; threadId: string; actorId: string; summary: string }): PendingGoalPointer {
  const now = Date.now();
  return {
    goal_id: input.goalId,
    thread_id: input.threadId,
    actor_id: input.actorId,
    summary: input.summary,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + TTL_MS).toISOString(),
  };
}

async function loadStoredPointer(threadId: string | null | undefined, actorId: string | null | undefined): Promise<Partial<PendingGoalPointer> | null> {
  if (!threadId || !isUuid(threadId) || !actorId) return null;
  try {
    const { data, error } = await supabaseAdmin.from("oyi_conversation_threads").select("metadata,user_id").eq("id", threadId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (text((data as any).user_id) !== text(actorId)) return null;
    return recordOf(recordOf((data as any).metadata).pending_goal) as Partial<PendingGoalPointer>;
  } catch (error) {
    logger.warn("oyi_goal_proposal_load_failed", { thread_id: threadId, error });
    return null;
  }
}

export async function loadPendingGoalPointer(threadId: string | null | undefined, actorId: string | null | undefined): Promise<PendingGoalPointer | null> {
  const stored = await loadStoredPointer(threadId, actorId);
  if (!stored || !actorId || !threadId) return null;
  if (text(stored.actor_id) !== text(actorId)) return null;
  if (text(stored.thread_id) !== text(threadId)) return null;
  if (!stored.expires_at || Date.parse(stored.expires_at) < Date.now()) return null;
  if (!stored.goal_id) return null;
  return stored as PendingGoalPointer;
}
