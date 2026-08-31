#!/usr/bin/env node
// Security fix: activate_resident_invite() unconditionally wrote
// username/password_hash on every activation -- an existing Oyi identity
// accepting an additional Home invitation had its real credentials
// silently replaced by whatever was typed on the invitation-activation
// screen. Confirmed this actually happened in production (audit_events
// shows one identity activating two separate resident invites six weeks
// apart; the second silently overwrote the first's credentials).
//
// Fixed by mirroring the exact p_existing_user_id pattern
// activate_estate_owner_invite() already established for this same
// problem: an authenticated caller accepts through a path that never
// touches username/password_hash, and the new-identity path now refuses
// to run at all against an email that already has a password set.
//
// The rewritten RPC was proven correct via a real, rolled-back
// transaction against the linked production database (not committed
// here -- production schema/constraints verification, not a source-level
// regression test): all 10 security scenarios plus the multi-Home
// fixture passed with zero rows persisted. This script is the static,
// CI-registered regression guard that the source code itself still has
// every required property.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

function expect(file, pattern, message) {
  const body = read(file);
  if (!pattern.test(body)) failures.push(`${file}: ${message}`);
}

function expectNot(file, pattern, message) {
  const body = read(file);
  if (pattern.test(body)) failures.push(`${file}: ${message}`);
}

const MIGRATION = "supabase/migrations/20260901120000_fix_resident_invite_existing_identity_credentials.sql";

expect(
  MIGRATION,
  /drop function if exists activate_resident_invite\(text, text, text\);/,
  "must explicitly drop the old 3-arg signature -- leaving it alongside the new one would let any caller still using 3 args silently resolve to the un-fixed overload",
);
expect(
  MIGRATION,
  /create or replace function activate_resident_invite\(\s*p_token_hash text,\s*p_username text,\s*p_password_hash text,\s*p_existing_user_id uuid\s*\)/,
  "must define the new 4-arg signature with p_existing_user_id",
);

// Isolate the existing-identity branch (between "if p_existing_user_id is
// not null then" and the matching "else") and prove it never sets
// username or password_hash.
{
  const body = read(MIGRATION);
  const branchMatch = body.match(/if p_existing_user_id is not null then([\s\S]*?)else/);
  if (!branchMatch) {
    failures.push(`${MIGRATION}: could not locate the existing-identity branch (if p_existing_user_id is not null then ... else)`);
  } else {
    const branch = branchMatch[1];
    if (/password_hash\s*=/.test(branch)) {
      failures.push(`${MIGRATION}: SECURITY -- the existing-identity branch must never assign password_hash`);
    }
    if (/\busername\s*=/.test(branch)) {
      failures.push(`${MIGRATION}: SECURITY -- the existing-identity branch must never assign username`);
    }
    if (!/lower\(v_user\.email\) <> lower\(v_invite\.invited_email\)/.test(branch)) {
      failures.push(`${MIGRATION}: existing-identity branch must verify the authenticated identity's email matches the invitation recipient`);
    }
    if (!/estate_id = coalesce\(u\.estate_id, v_invite\.estate_id\)/.test(branch) || !/home_id = coalesce\(u\.home_id, v_invite\.home_id\)/.test(branch)) {
      failures.push(`${MIGRATION}: existing-identity branch must coalesce (never unconditionally overwrite) the default-context estate_id/home_id fields`);
    }
  }
}

// New-identity branch must refuse to run against an email that already
// has a password set.
expect(
  MIGRATION,
  /if v_user\.password_hash is not null then\s*-- This identity already has real credentials[\s\S]*?raise exception 'An account already exists for this email\. Please sign in instead\.';/,
  "the new-identity branch must refuse activation (not overwrite) when the matched user already has a password set",
);
expect(
  MIGRATION,
  /update users u\s*set username = btrim\(p_username\),\s*password_hash = p_password_hash,[\s\S]*?estate_id = coalesce\(u\.estate_id, v_invite\.estate_id\),\s*home_id = coalesce\(u\.home_id, v_invite\.home_id\)/,
  "the new-identity branch must also coalesce estate_id/home_id, not unconditionally overwrite them",
);

// Membership writes stay untouched (additive, resident-hardcoded on
// estate_memberships, real invited role on home_memberships) -- this fix
// must not touch the already-correct Home-vs-Facility role model.
expect(
  MIGRATION,
  /insert into estate_memberships \(estate_id, user_id, role, status, updated_at\)\s*values \(v_invite\.estate_id, v_user\.id, 'resident', 'active', now\(\)\);/,
  "estate_memberships insert must still hardcode role='resident' -- a Home invitation must never grant Facility authority",
);
expect(
  MIGRATION,
  /insert into home_memberships \(home_id, user_id, role, status, updated_at\)\s*values \(v_invite\.home_id, v_user\.id, v_invite\.role, 'active', now\(\)\);/,
  "home_memberships insert must still use the invitation's real role, unmodified",
);

// Grants: only service_role, matching the RPC's existing security posture.
expect(
  MIGRATION,
  /revoke all on function activate_resident_invite\(text, text, text, uuid\) from public, anon, authenticated;/,
  "must revoke the new signature from public/anon/authenticated",
);
expect(
  MIGRATION,
  /grant execute on function activate_resident_invite\(text, text, text, uuid\) to service_role;/,
  "must grant the new signature to service_role only",
);

// Service layer: both paths wired, existing-identity path never receives
// a password/username to send.
const SERVICE = "src/services/residentInviteActivationService.ts";
expect(SERVICE, /export async function acceptResidentInviteAsExistingUser/, "service must export the existing-identity acceptance function");
{
  const body = read(SERVICE);
  const existingFn = body.match(/export async function acceptResidentInviteAsExistingUser[\s\S]*?\n}/)?.[0] || "";
  if (!/p_existing_user_id: input\.userId/.test(existingFn)) {
    failures.push(`${SERVICE}: acceptResidentInviteAsExistingUser must pass p_existing_user_id`);
  }
  if (!/p_username: null/.test(existingFn) || !/p_password_hash: null/.test(existingFn)) {
    failures.push(`${SERVICE}: SECURITY -- acceptResidentInviteAsExistingUser must never send a username/password to the RPC`);
  }
}
expect(SERVICE, /p_existing_user_id: null,/, "activateResidentInvite (new-identity path) must explicitly pass p_existing_user_id: null");

// Route: existing-identity endpoint requires real authentication, and an
// invite claim can never be attributed to anyone but the caller's own id.
const ROUTE = "src/routes/inviteActivation.ts";
expect(ROUTE, /router\.post\("\/accept", requireAuth, async/, "the existing-identity accept route must require authentication");
expect(ROUTE, /acceptResidentInviteAsExistingUser\(\{\s*token: req\.body\?\.token,\s*userId: \(req as any\)\.user\?\.id,/, "the route must pass the authenticated caller's own id, never a client-supplied user id");

if (failures.length) {
  console.error("resident-invite-existing-identity-smoke: FAILED");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("resident-invite-existing-identity-smoke: ALL PASSED");
