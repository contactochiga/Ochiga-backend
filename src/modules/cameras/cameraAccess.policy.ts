export type CameraPrivacyScope = "facility" | "home" | "office";

type CameraAccessUser = {
  id?: string | null;
  role?: string | null;
  estate_id?: string | null;
  home_id?: string | null;
};

/**
 * Camera requests are resolved through the same membership-aware OIS context as
 * every other Consumer domain.  Do not use users.home_id as the active Home:
 * it is only a login/default convenience and is stale for a multi-Home user
 * after a context switch.
 */
export function cameraAccessActor(user: CameraAccessUser | null | undefined, context?: { estate_id?: string | null; home_id?: string | null } | null): CameraAccessUser {
  return {
    ...(user || {}),
    estate_id: clean(context?.estate_id) || clean(user?.estate_id) || null,
    home_id: clean(context?.home_id) || clean(user?.home_id) || null,
  };
}

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

export function cameraHomeAssociation(camera: any) {
  const meta = metadata(camera);
  // The database column is authoritative.  Legacy metadata is read only when
  // that column is absent, in this explicit order.  A conflicting legacy value
  // never overrides a bound camera.home_id.
  const candidates = [
    ["column", camera?.home_id],
    ["metadata.home_id", meta.home_id],
    ["metadata.homeId", meta.homeId],
    ["metadata.bound_home_id", meta.bound_home_id],
    ["metadata.private_home_id", meta.private_home_id],
  ] as const;
  const selected = candidates.find(([, value]) => clean(value));
  const id = clean(selected?.[1]);
  return {
    id,
    source: selected?.[0] || null,
    conflicts: candidates
      .slice(1)
      .map(([source, value]) => ({ source, id: clean(value) }))
      .filter((item) => Boolean(id && item.id && item.id !== id)),
  };
}

export function cameraHomeId(camera: any) {
  return cameraHomeAssociation(camera).id;
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
