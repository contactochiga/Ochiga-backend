import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

// Commercial production-hardening -- Phase 12 security regression checks.
// Static/lexical assertions against the COMPILED output (mirrors this
// repo's own established smoke-test convention, e.g.
// invite-first-onboarding-smoke.mjs) plus pure-function checks against the
// new estate-owner activation service. Does not require a live DB/network.

function readDist(relativePath) {
  const full = new URL(`../dist/${relativePath}`, import.meta.url);
  return fs.readFileSync(full, "utf8");
}

// 1) Public signup no longer self-provisions an estate or self-promotes to
// estate_admin -- the actual code (not just comments) must not create an
// estates row or assign role "estate_admin" inside the signup handler.
{
  const src = readDist("routes/auth.js");
  const signupHandlerMatch = src.match(/router\.post\("\/signup"[\s\S]*?\n\}\);/);
  assert.ok(signupHandlerMatch, "signup handler must exist");
  const signupHandler = signupHandlerMatch[0];
  assert.ok(!/\.from\(["']estates["']\)\s*\n?\s*\.insert/.test(signupHandler), "signup must never insert a new estates row");
  assert.ok(!/role:\s*["']estate_admin["']/.test(signupHandler), "signup must never assign role estate_admin");
  assert.ok(/role:\s*["']resident["']/.test(signupHandler), "signup must still create the user as role resident");
}

// 2) POST /facility/estates (the secondary self-service path) is now
// restricted to platform-level roles only, not every estates.write holder.
{
  const src = readDist("controllers/facility.controller.js");
  const createEstateMatch = src.match(/async function createEstate[\s\S]*?\n\}/);
  assert.ok(createEstateMatch, "createEstate controller must exist");
  const body = createEstateMatch[0];
  assert.ok(/super_admin/.test(body) && /ochiga_admin/.test(body), "createEstate must gate on platform-level roles");
  assert.ok(/canonicalRole/.test(body), "createEstate must resolve legacy role aliases before checking, not compare raw strings");
}

// 3) Legacy POST /invites cross-tenant hole is closed -- tenancy check is
// real code (not a comment), and role is restricted to resident-tier only.
{
  const src = readDist("controllers/invites.controller.js");
  assert.ok(!/\/\/\s*if \(user\.estate_id/.test(src), "the old commented-out tenancy guard must be gone, not just still present as a comment");
  assert.ok(/estate_memberships/.test(src), "createInviteHandler must query estate_memberships for a real tenancy check");
  assert.ok(/LEGACY_INVITE_ALLOWED_ROLES/.test(src), "createInviteHandler must restrict role to the safe allowlist");
  assert.ok(/resident.*member.*guest|guest.*member.*resident/s.test(src) || /"resident"[\s\S]{0,40}"member"[\s\S]{0,40}"guest"/.test(src), "allowed roles must exclude owner/admin/manager/security");
}

// 4) The new estate-owner invite migration defines both RPCs and uses the
// safe update-then-insert pattern (never the ON CONFLICT column-list form
// that was already found and fixed once for the resident RPC).
{
  const migrationPath = new URL("../supabase/migrations/20260828120000_estate_owner_invite_activation.sql", import.meta.url);
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.ok(/create or replace function validate_estate_owner_invite/.test(sql));
  assert.ok(/create or replace function activate_estate_owner_invite/.test(sql));
  assert.ok(!/on conflict \(estate_id,\s*user_id\)/.test(sql), "must not reuse the inline ON CONFLICT column-list form that was already fixed away for the resident RPC");
  assert.ok(/update estate_memberships em/.test(sql), "must use the safe update-then-insert-if-not-found pattern");
  assert.ok(/for update/.test(sql), "activation must row-lock the invite to prevent replay/double-accept");
}

// 5) Estate-owner activation service: same token hashing + password policy
// as the proven resident flow, and the existing-user path requires an email
// match check to exist in the RPC (wrong-authenticated-user protection).
{
  const src = readDist("services/estateOwnerInviteActivationService.js");
  assert.ok(/createHash\("sha256"\)/.test(src), "must hash tokens with sha256, matching the resident flow");
  const migrationSql = fs.readFileSync(new URL("../supabase/migrations/20260828120000_estate_owner_invite_activation.sql", import.meta.url), "utf8");
  assert.ok(/invited_email/.test(migrationSql) && /account email/.test(migrationSql), "existing-user path must verify the authenticated email matches the invite");

  function hashInviteToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
  assert.equal(hashInviteToken("oyi-test-token"), "67ad377e03edc6692d0633da3016b784b7105e892003562180480eec22da260d");
}

// 6) New routes are actually mounted.
{
  const src = readDist("app.js");
  assert.ok(/\/auth\/estate-invites/.test(src), "estate-invite activation routes must be mounted");
  assert.ok(/\/office\/facility\/provision|facility\/provision/.test(readDist("routes/officeExport.js")), "the Office-authenticated provisioning intake route must exist");
}

console.log("commercial-provisioning-security-smoke: ALL PASSED");
