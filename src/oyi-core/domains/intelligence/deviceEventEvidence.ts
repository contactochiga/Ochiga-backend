import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import type { OperationalScope } from "../../contracts/intelligence";

export type DeviceEventRow = {
  id: string;
  device_id: string | null;
  estate_id: string | null;
  home_id: string | null;
  room_id: string | null;
  event_type: string;
  new_state: Record<string, unknown>;
  occurred_at: string;
};

// Programme 1's device evidence (deviceEvidence.ts) only exposes CURRENT
// state — real offline-clustering detection needs event HISTORY, which
// Programme 1 never queries. Per §53 of the Programme 3 spec ("use direct
// domain evidence when a specific prediction requires deeper history"),
// this reads the same real, actively-written device_events table the
// legacy predictionEngine.ts already proved works — not a new evidence
// system, just a deeper read of an existing one.
export async function loadDeviceEventHistory(scope: OperationalScope, windowDays: number, limit = 200): Promise<{ rows: DeviceEventRow[]; unavailable: boolean }> {
  if (!scope.home_id && !scope.estate_id) return { rows: [], unavailable: false };
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    let query = supabaseAdmin
      .from("device_events")
      .select("id,device_id,estate_id,home_id,room_id,event_type,new_state,occurred_at")
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    query = scope.home_id ? query.eq("home_id", scope.home_id) : query.eq("estate_id", scope.estate_id as string);
    const { data, error } = await query;
    if (error) throw error;
    return { rows: Array.isArray(data) ? (data as DeviceEventRow[]) : [], unavailable: false };
  } catch (error) {
    logger.warn("oyi_device_event_history_load_failed", { scope, error });
    return { rows: [], unavailable: true };
  }
}
