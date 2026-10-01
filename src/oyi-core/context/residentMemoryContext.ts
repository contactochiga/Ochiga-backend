import type { AuthUser } from "../../middleware/auth";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { memoryVisibleTo, type GovernedMemory } from "../contracts/memory";

// Context retention policy, not device/camera freshness. No historical row is
// promoted into present operational truth or inferred to be a user preference.
export const RESIDENT_CONTEXT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const RESIDENT_MEMORY_ADMITTED_TYPES = ["recent_intelligence_query", "favorite_scene", "conversation_context", "recent_maintenance_issue"] as const;
const TYPES = new Set<string>(RESIDENT_MEMORY_ADMITTED_TYPES);
export function residentMemoryProjection(row: Record<string, any>): GovernedMemory | null {
  if (!TYPES.has(row.memory_type) || !row.user_id || !row.id) return null;
  const observed = Date.parse(row.last_seen_at);
  if (!Number.isFinite(observed)) return null;
  const raw = row.memory_value && typeof row.memory_value === "object" ? row.memory_value : {};
  const value: Record<string, unknown> = {};
  // Stored values can be contributed by the owning user under existing RLS.
  // Never admit role/permissions, arbitrary instructions or stale health fields.
  for (const key of ["prompt", "last_reply", "scene_id", "scene_name", "request_id", "title"]) {
    if (typeof raw[key] === "string") value[key] = raw[key].slice(0, 500);
  }
  return {
    id: String(row.id), kind: row.memory_type === "recent_intelligence_query" ? "conversation" : "operational_reference",
    owner: "core", audience: "actor_private", trust: "context_only", retention: "durable",
    scope: { actorId: row.user_id, estateId: row.estate_id || null, homeId: row.home_id || null, sessionId: null },
    provenance: { store: "resident_memory", recordId: String(row.id), observedAt: new Date(observed).toISOString() },
    expiresAt: new Date(observed + RESIDENT_CONTEXT_RETENTION_MS).toISOString(), value,
  };
}

export async function loadResidentMemoryContext(actor: AuthUser, now = Date.now()): Promise<GovernedMemory[]> {
  let query = supabaseAdmin.from("resident_memory")
    .select("id,user_id,estate_id,home_id,memory_type,memory_key,memory_value,last_seen_at")
    .eq("user_id", actor.id).gte("last_seen_at", new Date(now - RESIDENT_CONTEXT_RETENTION_MS).toISOString())
    .order("last_seen_at", { ascending: false }).limit(20);
  query = actor.estate_id ? query.eq("estate_id", actor.estate_id) : query.is("estate_id", null);
  query = actor.home_id ? query.eq("home_id", actor.home_id) : query.is("home_id", null);
  const { data, error } = await query;
  if (error) throw new Error("resident_memory_context_unavailable");
  const scope = { actorId: actor.id, estateId: actor.estate_id || null, homeId: actor.home_id || null, sessionId: null };
  const seen = new Set<string>();
  return (data || []).flatMap((row: any) => {
    const memory = residentMemoryProjection(row);
    const key = `${row.memory_type}:${row.memory_key}`;
    if (!memory || !memoryVisibleTo(memory, scope, now) || seen.has(key)) return [];
    seen.add(key);
    return [memory];
  }).slice(0, 8);
}
