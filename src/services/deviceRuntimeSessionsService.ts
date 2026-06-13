import { supabaseAdmin } from "../supabase/supabaseClient";

type RuntimeInput = {
  deviceId: string;
  estateId?: string | null;
  homeId?: string | null;
  roomId?: string | null;
  source?: string | null;
  previousState?: Record<string, any> | null;
  newState?: Record<string, any> | null;
  occurredAt?: string;
};

function boolValue(value: any): boolean | null {
  if (value === true || value === false) return value;
  const text = String(value ?? "").toLowerCase();
  if (["true", "on", "1", "yes", "open", "active"].includes(text)) return true;
  if (["false", "off", "0", "no", "closed", "inactive"].includes(text)) return false;
  return null;
}

export function firstRuntimePowerState(state: any): boolean | null {
  if (!state || typeof state !== "object") return null;
  for (const key of ["switch", "power", "on", "running", "enabled", "power_state"]) {
    const next = boolValue(state[key]);
    if (next !== null) return next;
  }
  if (state.last_command && typeof state.last_command === "object") return firstRuntimePowerState(state.last_command);
  if (state.verified_state && typeof state.verified_state === "object") return firstRuntimePowerState(state.verified_state);
  for (const [key, value] of Object.entries(state)) {
    if (/^switch(_\d+)?$/i.test(key)) {
      const next = boolValue(value);
      if (next !== null) return next;
    }
  }
  return null;
}

export async function updateDeviceRuntimeSession(input: RuntimeInput) {
  const deviceId = String(input.deviceId || "").trim();
  if (!deviceId) return { ok: false, skipped: true };
  const previous = firstRuntimePowerState(input.previousState);
  const next = firstRuntimePowerState(input.newState);
  if (next === null || previous === next) return { ok: true, skipped: true };
  const occurredAt = input.occurredAt || new Date().toISOString();

  if (next === true) {
    const existing = await supabaseAdmin
      .from("device_runtime_sessions")
      .select("id")
      .eq("device_id", deviceId)
      .is("ended_at", null)
      .limit(1);
    if (!existing.error && (existing.data || []).length) return { ok: true, already_open: true };
    const { error } = await supabaseAdmin.from("device_runtime_sessions").insert({
      device_id: deviceId,
      estate_id: input.estateId || null,
      home_id: input.homeId || null,
      room_id: input.roomId || null,
      started_at: occurredAt,
      source: input.source || "system",
    } as any);
    if (error) return { ok: false, error: error.message };
    return { ok: true, opened: true };
  }

  const { data: open } = await supabaseAdmin
    .from("device_runtime_sessions")
    .select("id,started_at")
    .eq("device_id", deviceId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!open?.id) return { ok: true, no_open_session: true };
  const duration = Math.max(0, Math.floor((new Date(occurredAt).getTime() - new Date((open as any).started_at).getTime()) / 1000));
  const { error } = await supabaseAdmin
    .from("device_runtime_sessions")
    .update({ ended_at: occurredAt, duration_seconds: duration, updated_at: new Date().toISOString() } as any)
    .eq("id", (open as any).id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, closed: true, duration_seconds: duration };
}

function sinceFor(range: any) {
  const text = String(range || "today").toLowerCase();
  const now = new Date();
  if (text === "week" || text === "7d") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (text === "30d" || text === "month") return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export async function summarizeDeviceRuntime(filters: { deviceId?: string; homeId?: string; range?: string }) {
  const since = sinceFor(filters.range);
  let q = supabaseAdmin.from("device_runtime_sessions").select("*").gte("started_at", since).order("started_at", { ascending: false }).limit(500);
  if (filters.deviceId) q = q.eq("device_id", filters.deviceId);
  if (filters.homeId) q = q.eq("home_id", filters.homeId);
  const { data, error } = await q;
  if (error) throw error;
  const now = Date.now();
  const rows = data || [];
  const totalSeconds = rows.reduce((sum: number, row: any) => {
    if (row.duration_seconds !== null && row.duration_seconds !== undefined) return sum + Number(row.duration_seconds || 0);
    if (!row.ended_at && row.started_at) return sum + Math.max(0, Math.floor((now - new Date(row.started_at).getTime()) / 1000));
    return sum;
  }, 0);
  return { range: filters.range || "today", total_seconds: totalSeconds, activations: rows.length, open_sessions: rows.filter((row: any) => !row.ended_at).length, sessions: rows };
}
