// Public/Osa progressive qualification -- the minimum ephemeral
// representation needed so a public prospect supplying facts across
// several turns ("I own land in VI." / "It's about 1,200 sqm." / "I am
// considering a JV." / "I do not want to sell.") is never asked to repeat
// them, and "What would you need from me?" can synthesize what's already
// known instead of restarting.
//
// Exact same shape/reasoning as goalProposal.ts/communicationProposal.ts:
// this is NOT a new memory system, not a durable GoalRuntime entry, and
// not an Osa-specific second brain -- it is a sibling key
// (public_opportunity_objective) under the SAME oyi_conversation_threads
// .metadata jsonb column every other ephemeral per-thread pointer in this
// codebase already uses (see resultSetContext.ts, pending_goal above,
// pending_action_proposal, pending_communication, etc.), persisted through
// the SAME canonicalConversationPersistence.ts upsert.
//
// Privacy containment: this state exists ONLY for the public_corporate
// surface. loadPublicOpportunityObjective cross-checks the thread's own
// persisted `surface` column (not just presence of the metadata key)
// before returning anything, so it can never be read back for a thread
// that isn't actually public_corporate -- there is no code path anywhere
// that lets this become a route around any other surface's capability
// authority, because no other surface's capabilities ever read or write
// this key.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";

// "development_partnership" reuses the existing JV assessment engine
// (developmentJv.ts's assessJvOpportunity) for known_facts reasoning.
// "technology_inquiry" is the generic fallback for any other progressive
// public inquiry (e.g. a facility/technology capability question heading
// toward a staff handoff) -- proves the same mechanism generalizes
// without a JV-shaped assessment engine behind it.
export type PublicOpportunityType = "development_partnership" | "technology_inquiry";

export type PublicOpportunityObjective = {
  objective_type: PublicOpportunityType;
  known_facts: Record<string, string>;
  constraints: string[];
  current_subject: string | null;
  next_move: string | null;
  turns: number;
  created_at: string;
  updated_at: string;
};

export const PUBLIC_OPPORTUNITY_OBJECTIVE_TTL_MS = 30 * 60 * 1000;
const TTL_MS = PUBLIC_OPPORTUNITY_OBJECTIVE_TTL_MS;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function isValidPublicOpportunityObjective(value: unknown): value is PublicOpportunityObjective {
  const record = recordOf(value);
  return Boolean(record.objective_type) && typeof record.known_facts === "object" && Array.isArray(record.constraints);
}

export async function loadPublicOpportunityObjective(threadId: string | null | undefined): Promise<PublicOpportunityObjective | null> {
  if (!threadId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("oyi_conversation_threads")
      .select("metadata,surface")
      .eq("id", threadId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    // The privacy boundary: a stored objective is only ever honoured for
    // a thread whose OWN persisted surface is public_corporate, regardless
    // of what key happens to be present in its metadata.
    if (text((data as any).surface) !== "public_corporate") return null;
    const stored = recordOf((data as any).metadata).public_opportunity_objective;
    if (!isValidPublicOpportunityObjective(stored)) return null;
    if (!stored.updated_at || Date.now() - Date.parse(stored.updated_at) > TTL_MS) return null;
    return stored;
  } catch (error) {
    logger.warn("oyi_public_opportunity_objective_load_failed", { thread_id: threadId, error });
    return null;
  }
}
