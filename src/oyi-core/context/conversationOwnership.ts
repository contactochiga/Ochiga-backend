import { createHash } from "node:crypto";
import type { AuthUser } from "../../middleware/auth";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import type { CanonicalConversationRequestContext } from "../contracts/conversation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A bridge-scoped public session is not a shared guest identity or a staff user. */
export function publicConversationActor(sessionId: string): AuthUser {
  if (!sessionId || sessionId.length > 256) throw Object.assign(new Error("invalid_public_session"), { status: 400 });
  const hash = createHash("sha256").update(`oyi:public-session:v1:${sessionId}`).digest("hex");
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return { id, email: "public-intelligence@ochiga.local", role: "guest", permissions: [], permission_scopes: [] };
}

export function threadScopeMatches(row: Record<string, any>, context: CanonicalConversationRequestContext): boolean {
  if (!context.actor?.id || row.user_id !== context.actor.id || row.surface !== context.input.surface) return false;
  for (const key of ["estate_id", "home_id"] as const) {
    const expected = context.oisContext?.[key] || context.input[key] || context.actor[key] || null;
    if ((row[key] || null) !== expected) return false;
  }
  return true;
}

/** Run before any follow-up/result-set/proposal hydration using the service role. */
export async function authorizeConversationThread(context: CanonicalConversationRequestContext): Promise<CanonicalConversationRequestContext> {
  const threadId = context.input.thread_id;
  if (!threadId) return context;
  if (!UUID.test(threadId)) return { ...context, input: { ...context.input, thread_id: null } };
  const { data, error } = await supabaseAdmin.from("oyi_conversation_threads")
    .select("id,user_id,surface,estate_id,home_id").eq("id", threadId).maybeSingle();
  if (error) throw Object.assign(new Error("conversation_ownership_unavailable"), { status: 503 });
  // A supplied but nonexistent ID must not become a caller-chosen future ownership claim.
  if (!data) return { ...context, input: { ...context.input, thread_id: null } };
  if (!threadScopeMatches(data, context)) throw Object.assign(new Error("conversation_access_denied"), { status: 403 });
  return context;
}
