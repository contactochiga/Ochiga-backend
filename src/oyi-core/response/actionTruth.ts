import { supabaseAdmin } from "../../supabase/supabaseClient";

// IQ-8: truthful answer to "did you change / switch / send anything?". It reads the thread's own action records; if they cannot be read the
// answer says so instead of guessing.
const ATTEMPTED = new Set(["queued", "sent", "provider_accepted", "verifying", "confirmed", "unobservable", "timed_out", "failed"]);
export type ActionTruth = { known: boolean; attempted: number; confirmed?: number; failed?: number };
export async function threadActionTruth(threadId: string | null | undefined): Promise<ActionTruth> {
  if (!threadId) return { known: true, attempted: 0, confirmed: 0, failed: 0 };
  try {
    const { data, error } = await supabaseAdmin.from("oyi_actions").select("status").eq("thread_id", threadId);
    if (error) return { known: false, attempted: 0 };
    const rows = (data || []) as Array<{ status?: string }>;
    return { known: true, attempted: rows.filter((r) => ATTEMPTED.has(String(r.status))).length, confirmed: rows.filter((r) => r.status === "confirmed").length, failed: rows.filter((r) => ["failed", "timed_out"].includes(String(r.status))).length };
  } catch { return { known: false, attempted: 0 }; }
}
/** A question about whether something was sent / emailed / told / passed on: nothing in chat sends communications, so absent a canonical receipt the answer is "no record". */
export function communicationTruthLead(t: ActionTruth, future = false): string {
  if (future) return "I can't promise or confirm that anyone will call, reply or contact you: I have no acknowledgement or receipt, and what happens next is for the team. Nothing has been arranged from this chat.";
  if (!t.known) return "I can't confirm that right now: I could not read this conversation's records.";
  return "I can't confirm that anything was sent, emailed or passed on from here: I have no record of it (and no delivery or acknowledgement receipt). Nothing is sent from this chat unless you ask and confirm a specific action.";
}
export function actionTruthLead(t: ActionTruth): string {
  if (!t.known) return "I can't confirm that right now: I could not read this conversation's action records.";
  if (t.attempted === 0) return "No — nothing was changed in this conversation. I have not executed, sent or altered anything; I have only discussed it.";
  if ((t.confirmed ?? 0) > 0) return `Yes — ${t.confirmed} command${t.confirmed === 1 ? " was" : "s were"} sent and confirmed from this conversation; the confirmation records show what each one did.`;
  return `A command was sent from this conversation (${t.attempted}), but it is not confirmed as done${(t.failed ?? 0) > 0 ? " — at least one failed or timed out" : ""}; I can't say the device changed.`;
}
