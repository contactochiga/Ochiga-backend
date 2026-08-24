export type CameraPrivacyScope = "facility" | "home" | "office";

type CameraAccessUser = {
  id?: string | null;
  role?: string | null;
  estate_id?: string | null;
  home_id?: string | null;
};

function clean(value: any) {
  return String(value || "").trim();
}

function metadata(camera: any) {
  return camera?.metadata && typeof camera.metadata === "object" ? camera.metadata : {};
}

export function cameraPrivacyScope(camera: any): CameraPrivacyScope {
  const meta = metadata(camera);
  const raw = clean(camera?.privacy_scope || meta.privacy_scope || meta.scope).toLowerCase();
  if (raw === "home") return "home";
  if (raw === "office") return "office";
  return "facility";
}

export function cameraHomeId(camera: any) {
  const meta = metadata(camera);
  return clean(camera?.home_id || meta.home_id || meta.homeId || meta.bound_home_id || meta.private_home_id);
}

export function cameraOfficeAllowedUserIds(camera: any) {
  const meta = metadata(camera);
  const values = Array.isArray(meta.office_allowed_user_ids)
    ? meta.office_allowed_user_ids
    : Array.isArray(meta.allowed_user_ids)
      ? meta.allowed_user_ids
      : [];
  return new Set(values.map((item: any) => clean(item)).filter(Boolean));
}

function facilityRole(role: string) {
  return ["admin", "system_admin", "estate_admin", "facility_manager", "manager", "security", "operator", "owner"].includes(role);
}

export function canAccessCamera(camera: any, user: CameraAccessUser | null | undefined) {
  if (!camera || !user?.id) return { ok: false, reason: "not_authenticated" };

  const role = clean(user.role).toLowerCase();
  if (role === "admin" || role === "system_admin") return { ok: true, reason: "platform_admin" };

  const cameraEstateId = clean(camera.estate_id);
  const userEstateId = clean(user.estate_id);
  if (cameraEstateId && cameraEstateId !== userEstateId) {
    return { ok: false, reason: "estate_scope_mismatch" };
  }

  const scope = cameraPrivacyScope(camera);
  if (scope === "home") {
    const homeId = cameraHomeId(camera);
    if (!homeId) return { ok: false, reason: "home_camera_missing_scope" };
    return clean(user.home_id) === homeId ? { ok: true, reason: "home_member" } : { ok: false, reason: "home_scope_mismatch" };
  }

  if (scope === "office") {
    const allowed = cameraOfficeAllowedUserIds(camera);
    if (allowed.has(clean(user.id))) return { ok: true, reason: "office_explicit_user" };
    return { ok: false, reason: "office_permission_required" };
  }

  if (facilityRole(role)) return { ok: true, reason: "facility_role" };
  return { ok: false, reason: "facility_camera_permission_required" };
}

export function requireCameraAccess(camera: any, user: CameraAccessUser | null | undefined) {
  const result = canAccessCamera(camera, user);
  if (!result.ok) {
    const error: any = new Error("Permission denied");
    error.statusCode = 403;
    error.reason = result.reason;
    throw error;
  }
  return result;
}
