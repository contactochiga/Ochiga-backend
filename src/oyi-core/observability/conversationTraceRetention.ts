// Intelligence System Visibility, Slice 7 -- trace retention.
// Retention period: OYI_TRACE_RETENTION_DAYS (default
// TRACE_RETENTION_DAYS_DEFAULT = 30), stamped onto each row as expires_at
// at write time. This removes expired rows in bounded batches: select a
// bounded page of expired ids, then delete exactly those ids (never an
// unbounded DELETE). It has no dependency on conversation persistence.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { CONVERSATION_TRACE_TABLE } from "./conversationTraceRecorder";

export const TRACE_RETENTION_BATCH_LIMIT = 500;

export async function cleanupExpiredConversationTraces(now = new Date().toISOString(), limit = TRACE_RETENTION_BATCH_LIMIT): Promise<{ deleted: number }> {
  const batch = Math.min(1000, Math.max(1, Math.floor(limit)));
  const { data, error } = await supabaseAdmin
    .from(CONVERSATION_TRACE_TABLE)
    .select("trace_id")
    .lte("expires_at", now)
    .order("expires_at", { ascending: true })
    .limit(batch);
  if (error) throw error;
  const ids = (data || []).map((row: any) => String(row.trace_id));
  if (!ids.length) return { deleted: 0 };
  const { error: deleteError } = await supabaseAdmin.from(CONVERSATION_TRACE_TABLE).delete().in("trace_id", ids).lte("expires_at", now);
  if (deleteError) throw deleteError;
  return { deleted: ids.length };
}
