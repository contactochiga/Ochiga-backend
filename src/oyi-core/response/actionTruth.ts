import { supabaseAdmin } from "../../supabase/supabaseClient";

// IQ-8: truthful answer to "did you change / switch / send anything?". It reads the thread's own action records; if they cannot be read the
// answer says so instead of guessing.
const ATTEMPTED = new Set(["queued", "sent", "provider_accepted", "verifying", "confirmed", "unobservable", "timed_out", "failed"]);
export async function threadActionTruth(threadId: string | null | undefined): Promise<{ known: boolean; attempted: number }> {
  if (!threadId) return { known: true, attempted: 0 };
  try {
    const { data, error } = await supabaseAdmin.from("oyi_actions").select("status").eq("thread_id", threadId);
    if (error) return { known: false, attempted: 0 };
    return { known: true, attempted: (data || []).filter((r: { status?: string }) => ATTEMPTED.has(String(r.status))).length };
  } catch { return { known: false, attempted: 0 }; }
}
export function actionTruthLead(t: { known: boolean; attempted: number }): string {
  if (!t.known) return "I can't confirm that right now: I could not read this conversation's action records.";
  if (t.attempted === 0) return "No — nothing was changed in this conversation. I have not executed, sent or altered anything; I have only discussed it.";
  return `Yes — ${t.attempted} command${t.attempted === 1 ? " was" : "s were"} sent from this conversation; the confirmation records show what each one did.`;
}
