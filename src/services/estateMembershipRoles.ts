// Phase 2 commercial-hardening: shared estate-membership role/hierarchy
// helpers. Mirrors (and must be kept in sync with) the SQL function
// estate_membership_role_to_platform_role() added in
// supabase/migrations/20260829090000_fix_estate_owner_invite_role_promotion.sql
// -- that one runs inside the invite-activation RPC; this one runs in the
// request-handling hot path for admin mutations (listing/updating/removing
// team members), where a synchronous in-process check is preferable to an
// extra DB round trip. Deliberately NOT core/foundation/permissions.ts's
// LEGACY_ROLE_ALIASES, which maps the bare word "admin" -> "super_admin" --
// correct for a platform-scoped role string, wrong for an estate-scoped
// membership role (an estate's "admin" must become "estate_admin", never
// the platform role "super_admin").

const MEMBERSHIP_ROLE_TO_PLATFORM_ROLE: Record<string, string> = {
  owner: "estate_admin",
  admin: "estate_admin",
  manager: "facility_manager",
  security: "security_operator",
  staff: "maintenance_operator",
  member: "resident",
  guest: "guest",
  viewer: "guest",
  // Canonical values (membership_role enum extended in
  // 20260829091000_extend_membership_role_canonical_values.sql) pass
  // through unchanged.
  estate_admin: "estate_admin",
  facility_manager: "facility_manager",
  security_operator: "security_operator",
  maintenance_operator: "maintenance_operator",
  finance_operator: "finance_operator",
  resident: "resident",
};

// Platform-level roles that must NEVER be reachable through a tenant-scoped
// estate-membership mutation, regardless of what string is supplied.
const PLATFORM_ONLY_ROLES = new Set(["super_admin", "ochiga_admin", "ochiga_staff", "ai_agent"]);

// Relative authority within a single estate. Only roles a Facility
// administrator can legitimately hold/grant are ranked; anything else ranks
// at -1 (unmanageable/ungrantable through this surface).
const PLATFORM_ROLE_RANK: Record<string, number> = {
  estate_admin: 100,
  facility_manager: 80,
  security_operator: 50,
  maintenance_operator: 50,
  finance_operator: 50,
  resident: 10,
  guest: 0,
};

export function platformRoleForMembershipRole(membershipRole: string): string {
  return MEMBERSHIP_ROLE_TO_PLATFORM_ROLE[String(membershipRole || "").toLowerCase()] || "resident";
}

export function rankOfPlatformRole(platformRole: string): number {
  if (PLATFORM_ONLY_ROLES.has(platformRole)) return -1;
  return PLATFORM_ROLE_RANK[platformRole] ?? -1;
}

export function rankOfMembershipRole(membershipRole: string): number {
  return rankOfPlatformRole(platformRoleForMembershipRole(membershipRole));
}

// A super_admin/ochiga_admin acting as platform staff (not a tenant member)
// outranks everything within any estate -- used for Office-driven /
// platform-operator flows, never returned from rankOfPlatformRole() itself
// since those roles are deliberately unmanageable via tenant endpoints.
export function actorEstateRank(actorPlatformRole: string): number {
  if (actorPlatformRole === "super_admin" || actorPlatformRole === "ochiga_admin") return Number.POSITIVE_INFINITY;
  return rankOfPlatformRole(actorPlatformRole);
}

// Is this a legitimate membership_role value at all (legacy or canonical),
// as opposed to an arbitrary/forged string (e.g. "super_admin")?
export function isValidMembershipRole(role: string): boolean {
  return Object.prototype.hasOwnProperty.call(MEMBERSHIP_ROLE_TO_PLATFORM_ROLE, String(role || "").toLowerCase());
}

// May `actorPlatformRole` manage a member currently holding
// `targetMembershipRole`? Strictly cannot manage a HIGHER-ranked member;
// same-or-lower is allowed (an estate_admin may manage another estate_admin
// -- co-owners removing a rogue peer is a legitimate real-world need; the
// "last owner" check elsewhere is what actually protects the tenant from
// being orphaned).
export function canManageTargetRole(actorPlatformRole: string, targetMembershipRole: string): boolean {
  const actorRank = actorEstateRank(actorPlatformRole);
  const targetRank = rankOfMembershipRole(targetMembershipRole);
  if (targetRank < 0) return false;
  return actorRank >= targetRank;
}

// May `actorPlatformRole` GRANT `requestedMembershipRole` to someone (invite
// or role-change)? An actor may never grant a role ranked above their own.
export function canGrantMembershipRole(actorPlatformRole: string, requestedMembershipRole: string): boolean {
  if (!isValidMembershipRole(requestedMembershipRole)) return false;
  if (PLATFORM_ONLY_ROLES.has(String(requestedMembershipRole || "").toLowerCase())) return false;
  const actorRank = actorEstateRank(actorPlatformRole);
  const requestedRank = rankOfMembershipRole(requestedMembershipRole);
  if (requestedRank < 0) return false;
  return actorRank >= requestedRank;
}
