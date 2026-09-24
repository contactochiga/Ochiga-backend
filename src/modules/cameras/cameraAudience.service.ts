import { supabaseAdmin } from "../../supabase/supabaseClient";
import { CAMERA_ACCESS_SELECT, cameraHomeId, canAccessCamera } from "./cameraAccess.policy";

const text = (value: unknown) => String(value || "").trim();

export function derivedCameraId(value: any): string {
  return text(value?.camera_id || value?.cameraId || value?.metadata?.camera_id ||
    value?.payload?.camera_id || value?.payload?.cameraId ||
    value?.payload?.camera_infrastructure?.camera_id || value?.camera_infrastructure?.camera_id ||
    (value?.resourceType === "camera" ? value?.resourceId : ""));
}

/** Batch source rehydration for transport boundaries. No registry/default Home
 * fallback: a delivery context is established from ACTIVE memberships, then
 * the existing camera policy makes the decision with the user's current role.
 * This is recipient selection, not a new role or camera privacy model. */
export async function cameraAudience(cameraIds: string[], userIds: string[]) {
  const allowed = new Map<string, Set<string>>();
  const ids = [...new Set(cameraIds.filter(Boolean))];
  const users = [...new Set(userIds.filter(Boolean))];
  if (!ids.length || !users.length) return allowed;
  const cameras = await supabaseAdmin.from("facility_cameras").select(CAMERA_ACCESS_SELECT).in("id", ids);
  if (cameras.error) return allowed;
  const estates = [...new Set((cameras.data || []).map((c: any) => c.estate_id).filter(Boolean))];
  const homes = [...new Set((cameras.data || []).map(cameraHomeId).filter(Boolean))];
  const [accounts, estateMembers, homeMembers] = await Promise.all([
    supabaseAdmin.from("users").select("id,role").in("id", users),
    supabaseAdmin.from("estate_memberships").select("user_id,estate_id").in("user_id", users).in("estate_id", estates).eq("status", "active"),
    homes.length ? supabaseAdmin.from("home_memberships").select("user_id,home_id").in("user_id", users).in("home_id", homes).eq("status", "active") : Promise.resolve({ data: [], error: null }),
  ]);
  if (accounts.error || estateMembers.error || homeMembers.error) return allowed;
  for (const camera of cameras.data || []) {
    const recipients = new Set<string>();
    const homeId = cameraHomeId(camera);
    for (const user of accounts.data || []) {
      const homeMember = (homeMembers.data || []).some((m: any) => m.user_id === user.id && m.home_id === homeId);
      const estateMember = (estateMembers.data || []).some((m: any) => m.user_id === user.id && m.estate_id === camera.estate_id);
      const platform = ["admin", "system_admin"].includes(String(user.role));
      if (!homeMember && !estateMember && !platform) continue;
      if (canAccessCamera(camera, { id: user.id, role: user.role, estate_id: camera.estate_id, home_id: homeMember ? homeId : null }).ok) recipients.add(String(user.id));
    }
    allowed.set(String(camera.id), recipients);
  }
  return allowed;
}

export async function filterCameraNotificationRows(rows: Record<string, any>[]) {
  const cameraRows = rows.filter(row => derivedCameraId(row));
  if (!cameraRows.length) return rows;
  const allowed = await cameraAudience(cameraRows.map(derivedCameraId), cameraRows.map(row => text(row.user_id)));
  return rows.filter(row => !derivedCameraId(row) || allowed.get(derivedCameraId(row))?.has(text(row.user_id)));
}
