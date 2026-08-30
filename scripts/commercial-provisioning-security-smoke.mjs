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

// 7) Office->Facility provisioning lifecycle -- owner-invite resend/revoke
// are Office-key-gated (never a Facility session), scoped by estate_id
// (never a client-guessable invite id), and share the exact rotate/revoke
// SQL estateInvites.controller.ts already uses -- no duplicated logic.
{
  const src = readDist("routes/officeExport.js");
  assert.ok(/facility\/estates\/:estateId\/owner-invite\/resend/.test(src), "owner-invite resend route must exist");
  assert.ok(/facility\/estates\/:estateId\/owner-invite\/revoke/.test(src), "owner-invite revoke route must exist");
  const resendMatch = src.match(/router\.post\("\/facility\/estates\/:estateId\/owner-invite\/resend"[\s\S]*?\n\}\);/);
  const revokeMatch = src.match(/router\.post\("\/facility\/estates\/:estateId\/owner-invite\/revoke"[\s\S]*?\n\}\);/);
  assert.ok(resendMatch && /requireOfficeExportKey/.test(resendMatch[0]), "resend must be gated by requireOfficeExportKey, not a Facility session");
  assert.ok(revokeMatch && /requireOfficeExportKey/.test(revokeMatch[0]), "revoke must be gated by requireOfficeExportKey, not a Facility session");
  assert.ok(resendMatch && /findPendingOwnerInvite/.test(resendMatch[0]), "resend must resolve the invite from the estate_id Office already knows, never a client-submitted invite id");
  assert.ok(revokeMatch && /findPendingOwnerInvite/.test(revokeMatch[0]), "revoke must resolve the invite from the estate_id Office already knows, never a client-submitted invite id");

  const mutationSrc = readDist("services/estateInviteMutationService.js");
  assert.ok(/function rotateEstateInviteToken/.test(mutationSrc) && /function revokeEstateInviteById/.test(mutationSrc), "shared mutation service must exist");
  const controllerSrc = readDist("controllers/estateInvites.controller.js");
  assert.ok(/rotateEstateInviteToken|revokeEstateInviteById/.test(controllerSrc), "estateInvites.controller.js must call the shared service, not reimplement token rotation/revocation");
}

// 8) Portfolio projection now surfaces a real owner_activated signal (how
// Office learns activation completed), computed from a real
// estate_memberships read -- not a new webhook, not a fabricated field.
{
  const src = readDist("routes/officeExport.js");
  assert.ok(/safeSelectWithStatus\("estate_memberships"\)/.test(src), "projection must read real estate_memberships rows");
  assert.ok(/owner_activated/.test(src), "projection must expose owner_activated per estate");
  assert.ok(/activeOwnerEstateIds/.test(src), "owner_activated must be derived from an actual active owner/admin membership, not hardcoded");
}

// 9) Generic invite-conflict response -- must not flatly confirm account
// existence for a specific email anymore.
{
  const migrationSql = fs.readFileSync(new URL("../supabase/migrations/20260901090000_soften_estate_owner_invite_conflict_message.sql", import.meta.url), "utf8");
  assert.ok(!/An account already exists for this email/.test(migrationSql), "the account-existence-confirming message must be gone");
  assert.ok(/This invitation could not be completed/.test(migrationSql), "a generic, still-actionable message must replace it");
  const routeSrc = readDist("routes/estateOwnerInviteActivation.js");
  assert.ok(!/already exists/.test(routeSrc), "the route's error-status mapping must not still key off the removed leaking phrase");
}

// 10) Tenant isolation / adversarial coverage already proven at the RPC
// level (row-locking, email-match check, single-use token, estate-scoped
// lookup) -- re-assert these hold across both migrations.
{
  const baseSql = fs.readFileSync(new URL("../supabase/migrations/20260828120000_estate_owner_invite_activation.sql", import.meta.url), "utf8");
  const softenedSql = fs.readFileSync(new URL("../supabase/migrations/20260901090000_soften_estate_owner_invite_conflict_message.sql", import.meta.url), "utf8");
  for (const sql of [baseSql, softenedSql]) {
    assert.ok(/for update/.test(sql), "invite row must be locked to prevent concurrent double-accept (replay/concurrent-acceptance safety)");
  }
  assert.ok(/for update/.test(softenedSql), "the re-created function must still row-lock, not silently drop that protection on re-create");
  assert.ok(/lower\(v_user\.email\) <> lower\(v_invite\.invited_email\)/.test(softenedSql), "existing-user path must still verify the authenticated email matches the invite (wrong-email/cross-account misuse protection)");
  assert.ok(/i\.estate_id = v_invite\.estate_id/.test(softenedSql) || /estate_id = v_invite\.estate_id/.test(softenedSql), "membership write must stay scoped to the invite's own estate_id (cross-Facility invitation misuse protection)");
}

// 11) Governed Portfolio-delete: only ever removes a never-activated
// estate, is idempotent, never touches the users table, and always
// audits both the invite removal and the estate deletion.
{
  const src = readDist("routes/officeExport.js");
  assert.ok(/facility\/estates\/:estateId["']/.test(src), "delete-estate route must exist");
  const deleteMatch = src.match(/router\.delete\("\/facility\/estates\/:estateId"[\s\S]*?\n\}\);/);
  assert.ok(deleteMatch, "DELETE /facility/estates/:estateId handler must exist");
  const body = deleteMatch[0];
  assert.ok(/requireOfficeExportKey/.test(body), "delete must be gated by requireOfficeExportKey, not a Facility session");
  assert.ok(/already_deleted/.test(body), "delete must be idempotent -- a repeat call on an already-gone estate must not error");
  assert.ok(/checkEstateDeletionEligibility/.test(body), "delete must run the real eligibility check before removing anything");
  assert.ok(/409/.test(body) && /facility_has_operational_dependencies/.test(body), "an ineligible Facility must be blocked with a clear reason, not silently deleted");
  assert.ok(!/\.from\(["']users["']\)\s*\n?\s*\.delete/.test(body), "delete must never issue a DELETE against the users table -- shared identities must survive");
  assert.ok(/\.from\(["']invites["']\)\s*\n?\s*\.delete/.test(body), "delete must explicitly remove the estate's outstanding invite(s)");
  assert.ok(/\.from\(["']estates["']\)\s*\n?\s*\.delete/.test(body), "delete must remove the estate row itself once eligible");
  assert.ok(/facility\.invitation\.revoked/.test(body) && /facility\.deleted/.test(body), "delete must audit both the invitation removal and the estate deletion");

  const eligibilitySrc = readDist("services/estateDeletionEligibility.js");
  assert.ok(/estate_memberships/.test(eligibilitySrc), "eligibility must gate on real membership activation, not a fabricated status field");
  assert.ok(/homes/.test(eligibilitySrc) && /devices/.test(eligibilitySrc) && /maintenance_requests/.test(eligibilitySrc), "eligibility must check real Buildings/Homes/devices/maintenance dependency tables");
  assert.ok(!/\.from\(["']users["']\)\s*\n?\s*\.delete/.test(eligibilitySrc), "eligibility check must never itself delete anything, including users");
}

// 12) Production incident: /office/facility/provision's estate insert
// (and facility.controller.ts's createEstate) both write a `type` field
// that had never actually been migrated -- undetected until this route's
// first real end-to-end UI-driven use, which failed with
// facility_provision_failed. The migration restoring the column must
// exist, be additive, and match the "estate" default the insert code has
// always assumed.
{
  const migrationSql = fs.readFileSync(new URL("../supabase/migrations/20260830180000_estates_add_type_column.sql", import.meta.url), "utf8");
  assert.ok(/alter table estates add column if not exists type/.test(migrationSql), "the migration must additively restore the missing estates.type column");
  assert.ok(/default 'estate'/.test(migrationSql), "the column default must match the insert code's own \"estate\" fallback");

  const provisionSrc = readDist("routes/officeExport.js");
  assert.ok(/type:\s*safeText\(body\.type/.test(provisionSrc), "the provisioning insert must still write type -- this fix restores the column, it does not strip the field");
}

console.log("commercial-provisioning-security-smoke: ALL PASSED");
