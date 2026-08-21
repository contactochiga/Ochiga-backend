// Oyi Conversational Runtime Completion Programme, Phase 4, PR 6 --
// DB-touching half of officeAutomationSuggestion.ts, split out
// specifically so corporateOfficeInternalPolicy.ts (a genuinely
// Supabase-free policy file) can import the pure parsing/building
// functions without pulling in a live Supabase client construction.
import { logger } from "../../observability/logger";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { LAST_VERIFIED_ACTION_TTL_MS, type LastVerifiedOfficeAction } from "./officeAutomationSuggestion";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

export async function loadLastVerifiedOfficeAction(
  threadId: string | null | undefined,
  actorId: string | null | undefined
): Promise<LastVerifiedOfficeAction | null> {
  if (!threadId || !isUuid(threadId) || !actorId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("oyi_conversation_threads")
      .select("metadata,user_id")
      .eq("id", threadId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (text((data as { user_id?: unknown }).user_id) !== text(actorId)) return null;
    const stored = recordOf(recordOf((data as { metadata?: unknown }).metadata).last_verified_office_action) as Partial<LastVerifiedOfficeAction>;
    if (!stored.verified_at || !stored.description) return null;
    if (Date.now() - Date.parse(stored.verified_at) > LAST_VERIFIED_ACTION_TTL_MS) return null;
    return stored as LastVerifiedOfficeAction;
  } catch (error) {
    logger.warn("oyi_last_verified_office_action_load_failed", { thread_id: threadId, error });
    return null;
  }
}
