import assert from "node:assert/strict";
import fs from "node:fs";

// PHASE 2 of the Oyi Facility commercial-production closure programme --
// Section 17 security regression checks. Static/lexical assertions against
// the COMPILED output, matching this repo's own established smoke-test
// convention (see commercial-provisioning-security-smoke.mjs,
// invite-first-onboarding-smoke.mjs). Does not require a live DB/network.
//
// Covers: unauthorized cross-tenant access, forged tenant/role, privilege
// escalation, last-owner protection, revoked-invitation replay, cross-
// Facility boundary, integration-secret masking, and the role-promotion
// bug that made every Phase 1 facility owner permission-less.

function readDist(relativePath) {
  const full = new URL(`../dist/${relativePath}`, import.meta.url);
  return fs.readFileSync(full, "utf8");
}

function readRepo(relativePath) {
  const full = new URL(`../${relativePath}`, import.meta.url);
  return fs.readFileSync(full, "utf8");
}

// 1) The Phase-1-critical role-promotion bug is fixed: activate_estate_owner_invite
// must resolve a real platform role for BOTH the new-user and existing-user
// branches, never leaving a facility owner at role "resident".
{
  const sql = readRepo("supabase/migrations/20260829090000_fix_estate_owner_invite_role_promotion.sql");
  assert.ok(/estate_membership_role_to_platform_role/.test(sql), "must define the membership-role-to-platform-role mapping function");
  assert.ok(/case\s+p_role/i.test(sql), "mapping must branch on the invite's membership role, not hardcode a single value");
  assert.ok(/when\s+'owner'\s+then\s+'estate_admin'/i.test(sql) && /when\s+'admin'\s+then\s+'estate_admin'/i.test(sql), "owner/admin membership roles must map to platform role estate_admin");
  assert.ok(/v_platform_role/.test(sql), "activation must compute and use a resolved platform role variable");
  assert.ok(
    /insert into users[\s\S]{0,400}v_platform_role/.test(sql),
    "the new-user branch must insert using the resolved platform role, not a hardcoded 'resident'"
  );
  assert.ok(
    /update users u\s+set\s+role\s*=\s*v_platform_role/is.test(sql),
    "the existing-user branch must now update users.role -- Phase 1 left this branch untouched entirely"
  );
  assert.ok(!/role:\s*['"]resident['"]/.test(sql.replace(/--.*$/gm, "")), "no code path may hardcode role resident for an owner-tier activation");
}

// 2) The membership_role enum is extended additively (no destructive rename),
// covering the previously-missing canonical values including finance_operator.
{
  const sql = readRepo("supabase/migrations/20260829091000_extend_membership_role_canonical_values.sql");
  for (const value of ["estate_admin", "facility_manager", "security_operator", "maintenance_operator", "finance_operator"]) {
    assert.ok(new RegExp(`add value if not exists '${value}'`, "i").test(sql), `enum extension must additively add '${value}'`);
  }
  assert.ok(!/drop type|drop value/i.test(sql), "enum extension must never drop existing values");
}

// 3) Cross-tenant membership mutation is closed: both PATCH and DELETE on
// estate-users load the target row and verify it belongs to the caller's
// OWN estate before doing anything, returning 404 (never 403) on mismatch
// so a foreign-tenant membership ID's existence is never confirmed.
{
  const src = readDist("controllers/estateUsers.controller.js");
  assert.ok(/loadOwnEstateMembership/.test(src), "a shared own-estate loader must exist");
  const loaderMatch = src.match(/function loadOwnEstateMembership[\s\S]*?\n\}/);
  assert.ok(loaderMatch, "loadOwnEstateMembership must be defined");
  assert.ok(/data\.estate_id\s*!==\s*estateId/.test(loaderMatch[0]), "loader must compare the row's estate_id against the caller's own estate_id");
  assert.ok(/404/.test(loaderMatch[0]), "a foreign-tenant membership must 404, not 403 (never confirm existence)");

  const updateFn = src.match(/async function updateEstateUser[\s\S]*?\n\}/)[0];
  assert.ok(/loadOwnEstateMembership/.test(updateFn), "PATCH must call the own-estate loader");
  const removeFn = src.match(/async function removeEstateUser[\s\S]*?\n\}/)[0];
  assert.ok(/loadOwnEstateMembership/.test(removeFn), "DELETE must also call the own-estate loader -- this check was previously entirely absent");
}

// 4) Privilege escalation is closed: self-mutation is blocked, and role
// changes/grants are gated through the rank-hierarchy helpers, not a
// hardcoded role list.
{
  const src = readDist("controllers/estateUsers.controller.js");
  const updateFn = src.match(/async function updateEstateUser[\s\S]*?\n\}/)[0];
  assert.ok(/membership\.user_id\s*===\s*req\.user\.id/.test(updateFn), "actor must not be able to mutate their own membership through this admin endpoint");
  assert.ok(/canManageTargetRole/.test(updateFn), "must check actor rank against the TARGET's current role before any mutation");
  assert.ok(/canGrantMembershipRole/.test(updateFn), "must check actor rank against the REQUESTED role before granting it");

  const removeFn = src.match(/async function removeEstateUser[\s\S]*?\n\}/)[0];
  assert.ok(/membership\.user_id\s*===\s*req\.user\.id/.test(removeFn), "actor must not be able to remove their own membership through this admin endpoint");
  assert.ok(/canManageTargetRole/.test(removeFn), "removal must also check actor rank against the target's role");
}

// 5) Last-owner protection exists on BOTH mutation paths -- Phase 1/pre-
// Phase-2 state only had it on PATCH; DELETE could zero out an estate's
// owners outright.
{
  const src = readDist("controllers/estateUsers.controller.js");
  const updateFn = src.match(/async function updateEstateUser[\s\S]*?\n\}/)[0];
  assert.ok(/at least one owner\/administrator/i.test(updateFn), "PATCH must protect against demoting the last owner-tier member");
  const removeFn = src.match(/async function removeEstateUser[\s\S]*?\n\}/)[0];
  assert.ok(/at least one owner\/administrator/i.test(removeFn), "DELETE must protect against removing the last owner-tier member");
  assert.ok(/rankOfMembershipRole\)\(membership\.role\)\s*>=\s*100/.test(removeFn), "the last-owner check must key off the real rank, not a hardcoded role string");
}

// 6) The rank-hierarchy helpers correctly refuse to grant platform-only
// roles through any estate-scoped endpoint, and never let a platform-only
// actor rank be reachable via tenant mutation (no facility user can grant
// Ochiga platform roles).
{
  const src = readDist("services/estateMembershipRoles.js");
  assert.ok(/PLATFORM_ONLY_ROLES/.test(src), "platform-only roles must be enumerated separately from estate-manageable roles");
  assert.ok(/super_admin/.test(src) && /ochiga_admin/.test(src) && /ochiga_staff/.test(src) && /ai_agent/.test(src), "platform-only role set must include all four platform-exclusive roles");
  const grantFn = src.match(/function canGrantMembershipRole[\s\S]*?\n\}/)[0];
  assert.ok(/PLATFORM_ONLY_ROLES\.has/.test(grantFn), "canGrantMembershipRole must reject any requested role that is platform-only");
}

// 7) The estate-membership-role -> platform-role TS mirror never reuses the
// LEGACY_ROLE_ALIASES table (which maps bare "admin" to the PLATFORM role
// super_admin) -- that conflation would be a real privilege-escalation bug
// if applied to a tenant-scoped membership role.
{
  const src = readDist("services/estateMembershipRoles.js");
  assert.ok(!/require\(["']\.\.\/core\/foundation\/permissions["']\)/.test(src), "estate membership role mapping must not import the platform-scoped permissions/legacy-alias module at all");
  assert.ok(!/LEGACY_ROLE_ALIASES[.[]/.test(src), "estate membership role mapping must not reference (import or index into) the platform-scoped legacy alias table, even if named in an explanatory comment");
}

// 8) The /super-admin/* cross-tenant leak is closed at the router level, on
// top of (not instead of) each route's existing granular permission check.
{
  const src = readDist("routes/superAdmin.js");
  const guardMatch = src.match(/function requirePlatformStaff[\s\S]*?\n\}/);
  assert.ok(guardMatch, "requirePlatformStaff guard must exist");
  assert.ok(/super_admin/.test(guardMatch[0]) && /ochiga_admin/.test(guardMatch[0]), "guard must check for an actual platform role, not a generic permission key");
  assert.ok(/router\.use\(\w+\.requireAuth,\s*requirePlatformStaff\)/.test(src), "the guard must be applied router-wide via router.use, covering every /super-admin/* route unconditionally");
}

// 9) Facility Profile updates (PATCH /facility/estates/:estateId) enforce
// the cross-Facility boundary the same way (404 on mismatch, never 403),
// and never expose a writable field beyond the safe identity/location set --
// no commercial/subscription/deployment field can be smuggled in.
{
  const src = readDist("controllers/facility.controller.js");
  const updateEstateFn = src.match(/async function updateEstate[\s\S]*?\n\}\n\}/) || src.match(/async function updateEstate[\s\S]*?\nexport /);
  const body = (updateEstateFn && updateEstateFn[0]) || src.slice(src.indexOf("async function updateEstate"), src.indexOf("async function updateEstate") + 3000);
  assert.ok(/estateId\s*!==\s*req\.user\?\.estate_id/.test(body), "updateEstate must 404 when the path estate does not match the caller's own estate");
  assert.ok(/isPlatformStaff/.test(body), "updateEstate must recognize platform staff via the real role check, not the old dead admin-string fallback");
  for (const forbidden of ["subscription", "plan", "commercial_status", "deployment_status", "billing"]) {
    assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(body), `updateEstate must never accept a client-writable '${forbidden}' field`);
  }
}

// 10) audit.read / settings.manage are scoped correctly: estate_admin gets
// both, facility_manager gets audit.read only (Facility Profile identity
// edits stay reserved for the top estate role) -- and the grant cannot leak
// cross-tenant because the unscoped /super-admin/audit-logs path is
// separately hard-gated (already proven in check 8).
{
  const src = readDist("core/foundation/permissions.js");
  const estateAdminBlock = src.match(/estate_admin:\s*\[[\s\S]*?\]/)[0];
  assert.ok(/"settings\.manage"/.test(estateAdminBlock), "estate_admin must hold settings.manage");
  assert.ok(/"audit\.read"/.test(estateAdminBlock), "estate_admin must hold audit.read");
  const facilityManagerBlock = src.match(/facility_manager:\s*\[[\s\S]*?\]/)[0];
  assert.ok(/"audit\.read"/.test(facilityManagerBlock), "facility_manager must hold audit.read");
  assert.ok(!/"settings\.manage"/.test(facilityManagerBlock), "facility_manager must NOT hold settings.manage -- deliberately reserved for estate_admin");
}

// 11) The new tenant-scoped audit reader hard-scopes every query to the
// caller's own estate_id -- it must be structurally impossible for it to
// return another tenant's events.
{
  const src = readDist("services/auditQueryService.js");
  assert.ok(/getEstateAuditLog/.test(src), "getEstateAuditLog must exist");
  const fnMatch = src.match(/function getEstateAuditLog[\s\S]*?\n\}/) || src.match(/getEstateAuditLog\s*=[\s\S]*?\n\}/);
  assert.ok(fnMatch, "getEstateAuditLog implementation must be found");
  assert.ok(/\.eq\(["']estate_id["']/.test(fnMatch[0]), "audit log query must unconditionally filter by estate_id");
}

// 12) Revoked-invitation replay is impossible: revoke/resend load through
// the same own-estate loader as team-member mutation, only a pending
// invite may be revoked or resent, and resend rotates the token (the old
// link stops working).
{
  const src = readDist("controllers/estateInvites.controller.js");
  assert.ok(/loadOwnEstateInvite/.test(src), "a shared own-estate invite loader must exist");
  const loaderMatch = src.match(/function loadOwnEstateInvite[\s\S]*?\n\}/)[0];
  assert.ok(/data\.estate_id\s*!==\s*estateId/.test(loaderMatch), "invite loader must verify estate ownership");
  assert.ok(/404/.test(loaderMatch), "a foreign-tenant invite must 404, never 403");

  const revokeFn = src.match(/async function revokeEstateInvite[\s\S]*?\n\}/)[0];
  assert.ok(/invite\.status\s*!==\s*["']pending["']/.test(revokeFn), "only a pending invite may be revoked -- refuses to re-revoke an already-resolved invite");

  const resendFn = src.match(/async function resendEstateInvite[\s\S]*?\n\}/)[0];
  assert.ok(/invite\.status\s*!==\s*["']pending["']/.test(resendFn), "only a pending invite may be resent");
  assert.ok(/randomBytes\(32\)/.test(resendFn), "resend must mint a fresh token");
}

// 13) Underlying RPC replay protection (Phase 1, re-confirmed unchanged this
// phase): row-locked, status must still be 'pending', and expiry is
// enforced server-side regardless of client claims.
{
  const sql = readRepo("supabase/migrations/20260828120000_estate_owner_invite_activation.sql");
  assert.ok(/for update/.test(sql), "invite validation/activation must row-lock to prevent replay/double-accept");
  assert.ok(/v_invite\.status\s*<>\s*'pending'/.test(sql), "activation must reject any invite whose status is not pending (revoked, accepted, or expired)");
  assert.ok(/v_invite\.expires_at\s*<=\s*now\(\)/.test(sql), "activation must independently re-check expiry server-side");
}

// 14) Team-member invite creation itself is gated by the same rank-based
// grant check (no forged/self-escalated role in the invite body), and
// duplicate-active-member invites are refused.
{
  const src = readDist("controllers/estateInvites.controller.js");
  const createFn = src.match(/async function createEstateInvite[\s\S]*?\n\}/)[0];
  assert.ok(/canGrantMembershipRole/.test(createFn), "createEstateInvite must check the requested role against the actor's grant authority");
  assert.ok(/isValidMembershipRole/.test(createFn), "createEstateInvite must reject an unknown/forged role string");
  assert.ok(/already a member of your estate/i.test(createFn), "must refuse to invite an already-active member of the same estate");
}

// 15) Integration credentials are never exposed client-side: the Facility
// integrations UI surfaces readiness/connection status strings only, never
// a raw provider key/secret/token field.
{
  const src = readRepo("../facility-oyi/app/(protected)/facility-administration/page.tsx");
  const integrationsFn = src.match(/function IntegrationsSection[\s\S]*?\n\}/)[0];
  for (const forbidden of ["api_key", "apiKey", "client_secret", "clientSecret", "access_token", "accessToken", "private_key"]) {
    assert.ok(!integrationsFn.includes(forbidden), `Integrations panel must never render a raw '${forbidden}' field`);
  }
}

console.log("facility-administrative-backbone-phase2-smoke: ALL PASSED");
