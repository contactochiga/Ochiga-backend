// Wave 7 Slice 6 -- honest actor resolution for a GoalPlanStep's
// device_action. GoalRuntime persists only requesting_actor_id (a bare
// string id) -- there is no existing "reconstruct a full AuthUser from a
// bare id" helper anywhere in this codebase (confirmed by audit). This
// module does NOT invent a synthetic system/automation actor (no
// "facility_manager"/"system" role is fabricated here) -- it performs
// the exact same real `users` table lookup src/middleware/auth.ts's own
// loadUserContext() already performs for every authenticated request,
// reusing the same real permissionsForRole() derivation. If no real
// actor id was recorded on the goal, or the users row can't be found,
// this returns null -- the caller (goalEvaluator.ts) must then fail the
// step closed to needs_human, never proceed with a fabricated actor.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { permissionsForRole } from "../../core/foundation";
import type { AuthUser } from "../../middleware/auth";

export async function resolveGoalDeviceActor(requestingActorId: string | null): Promise<AuthUser | null> {
  if (!requestingActorId) return null;
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id,email,username,role,estate_id,home_id,permission_scopes")
    .eq("id", requestingActorId)
    .maybeSingle();
  if (error || !data) return null;
  const role = (data as any).role;
  if (!role) return null; // no real role on file -- cannot honestly authorize anything
  const permissionScopes = Array.isArray((data as any).permission_scopes) ? (data as any).permission_scopes : [];
  return {
    id: (data as any).id,
    email: (data as any).email ?? undefined,
    username: (data as any).username ?? undefined,
    role,
    estate_id: (data as any).estate_id ?? undefined,
    home_id: (data as any).home_id ?? undefined,
    permission_scopes: permissionScopes,
    permissions: permissionsForRole(role, permissionScopes),
  };
}
