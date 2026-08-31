import assert from "node:assert/strict";
import fs from "node:fs";

// publicUrls.ts resolves its exported constants once, at module load, from
// process.env -- set this explicitly rather than relying on ambient
// NODE_ENV, so the behavioral check below (#4) is deterministic.
process.env.CONSUMER_APP_URL ||= "https://app.getoyi.com";

// Production incident: the Home/resident invitation email link and QR
// code both pointed at "https://oyi.com" (a third-party domain-parking
// page) instead of the real Consumer frontend, because
// makeResidentInviteUrl() (and three duplicate copies of the same logic)
// chained through CONSUMER_APP_BASE (defined nowhere) and
// VISITOR_LINK_BASE (a real var, but scoped to visitor-pass deep links,
// not Consumer onboarding) before falling back to the dead literal.
// Fixed with one canonical builder (src/config/publicUrls.ts) that both
// the email link and the QR now consume. Static/lexical assertions
// against the compiled dist output, matching this repo's own established
// convention (commercial-provisioning-security-smoke.mjs). Does not
// require a live DB/network.

function readDist(relativePath) {
  const full = new URL(`../dist/${relativePath}`, import.meta.url);
  return fs.readFileSync(full, "utf8");
}

// 1) The one canonical builder exists, uses CONSUMER_APP_URL (the
// already-established name elsewhere in this codebase -- originPolicy.ts,
// walletController.ts -- not a newly-invented or Facility/backend-scoped
// name), and the fallback is the real, empirically-verified live
// production domain, not a guess or a dead one.
{
  const src = readDist("config/publicUrls.js");
  assert.ok(/function buildConsumerHomeInviteUrl/.test(src), "the canonical Home-invite URL builder must exist");
  assert.ok(/CONSUMER_APP_URL/.test(src), "must resolve from CONSUMER_APP_URL, the established consumer-frontend variable name");
  assert.ok(/app\.getoyi\.com/.test(src), "the production fallback must be the real, verified-live Consumer frontend domain");
  assert.ok(!/process\.env\.CONSUMER_APP_BASE/.test(src), "must not resurrect the dead CONSUMER_APP_BASE variable that was never defined anywhere");
  assert.ok(!/process\.env\.VISITOR_LINK_BASE/.test(src), "must never fall back to VISITOR_LINK_BASE -- that variable is scoped to visitor-pass deep links, not Consumer onboarding");
  assert.ok(!/exports\.\w+ = ["']https:\/\/oyi\.com["']|return ["']https:\/\/oyi\.com["']/.test(src), "the dead third-party domain-parking fallback must not be used as a live value");

  assert.ok(/function buildFacilityStaffInviteUrl/.test(src), "the Facility staff-invite URL builder must exist alongside it");
  assert.ok(/facility\.getoyi\.com/.test(src), "the Facility staff-invite fallback must be the real, verified-live Facility frontend domain, not the dead facility.oyi.com");
  assert.ok(!/facility\.oyi\.com/.test(src), "the dead facility.oyi.com fallback must be gone");
}

// 2) Every call site that builds a resident/Home-invite URL must go
// through the canonical builder -- not rebuild its own with the same
// (or a new) wrong fallback chain. Covers both the primary path
// (homeUsers.controller.ts, create + resend) and the three duplicate
// legacy call sites the audit found (residents.ts, estates.ts,
// facility.controller.ts).
{
  const homeUsersSrc = readDist("controllers/homeUsers.controller.js");
  assert.ok(/buildConsumerHomeInviteUrl/.test(homeUsersSrc), "homeUsers.controller.js must use the canonical builder");
  assert.ok(!/process\.env\.CONSUMER_APP_BASE|process\.env\.VISITOR_LINK_BASE/.test(homeUsersSrc), "homeUsers.controller.js must not read the dead/wrong-scoped env vars directly anymore");

  for (const [file, label] of [
    ["routes/residents.js", "residents.js"],
    ["routes/estates.js", "estates.js"],
    ["controllers/facility.controller.js", "facility.controller.js"],
  ]) {
    const src = readDist(file);
    assert.ok(/buildConsumerHomeInviteUrl/.test(src), `${label} must use the canonical builder, not its own copy of the wrong fallback chain`);
    assert.ok(!/VISITOR_LINK_BASE/.test(src), `${label} must not read VISITOR_LINK_BASE directly anymore`);
    assert.ok(!/["']https:\/\/oyi\.com["']/.test(src), `${label} must not hardcode the dead domain-parking fallback`);
  }

  const estateInvitesSrc = readDist("controllers/estateInvites.controller.js");
  assert.ok(/buildFacilityStaffInviteUrl/.test(estateInvitesSrc), "estateInvites.controller.js (Facility staff invite) must use its canonical builder");
  assert.ok(!/["']https:\/\/facility\.oyi\.com["']/.test(estateInvitesSrc), "estateInvites.controller.js must not hardcode the dead facility.oyi.com fallback as a live literal");
}

// 3) The QR must encode exactly the same string as the email link -- one
// inviteUrl variable feeds both QRCode.toDataURL(...) and the email
// template, never a second independently-built URL.
{
  const homeUsersSrc = readDist("controllers/homeUsers.controller.js");
  const qrCalls = [...homeUsersSrc.matchAll(/const inviteUrl = makeResidentInviteUrl\([^)]*\);[\s\S]{0,200}?qrcode_1\.default\.toDataURL\(inviteUrl\)/g)];
  assert.ok(qrCalls.length >= 2, "both the create and resend paths must generate the QR from the same inviteUrl variable used for the email link");

  for (const file of ["routes/residents.js", "routes/estates.js", "controllers/facility.controller.js"]) {
    const src = readDist(file);
    assert.ok(
      /const inviteUrl = \(0, publicUrls_1\.buildConsumerHomeInviteUrl\)\([^)]*\);[\s\S]{0,120}?qrcode_1\.default\.toDataURL\(inviteUrl\)/.test(src),
      `${file}: the QR must be generated from the exact same inviteUrl the email/response uses, not a second construction`
    );
  }
}

// 4) Token survives URL construction -- a real behavioral check (not
// just a regex), proving the exact raw token round-trips through the
// canonical builder's URL encoding without truncation or mangling.
{
  const publicUrlsSrc = readDist("config/publicUrls.js");
  // Exercise the actual compiled function.
  const mod = await import(new URL("../dist/config/publicUrls.js", import.meta.url));
  const rawToken = "a1b2c3d4e5f6" + "9".repeat(52); // same shape as crypto.randomBytes(32).toString("hex")
  const url = mod.buildConsumerHomeInviteUrl(rawToken);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/auth/invite", "the canonical URL must use the real Consumer onboarding route");
  assert.equal(parsed.searchParams.get("token"), rawToken, "the exact raw token must survive URL construction and be readable back out, unmangled");
  assert.ok(publicUrlsSrc.includes("encodeURIComponent"), "the token must be explicitly URL-encoded when building the link");
}

// 5-9) Invitation state machine (validate_resident_invite /
// activate_resident_invite) -- unchanged by this fix, re-asserted here
// so the URL fix doesn't silently ship alongside a state-machine
// regression. Row-locked, single-use, generic failure message (no
// leaking which specific condition failed), scoped home/estate join.
{
  const migrationFiles = fs.readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((n) => n.endsWith(".sql"));
  const definingFiles = migrationFiles.filter((name) => {
    const sql = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    return /create or replace function activate_resident_invite/.test(sql);
  }).sort();
  assert.ok(definingFiles.length >= 1, "activate_resident_invite must be defined by at least one migration");
  const latestSql = fs.readFileSync(new URL(`../supabase/migrations/${definingFiles[definingFiles.length - 1]}`, import.meta.url), "utf8");

  assert.ok(/for update/.test(latestSql), "the invite row must be locked to prevent concurrent double-accept (already-claimed-twice protection)");
  assert.ok(/v_invite\.status <> 'pending'/.test(latestSql), "a non-pending (already accepted) invite must be rejected");
  assert.ok(/v_invite\.revoked_at is not null/.test(latestSql), "a revoked invite must be rejected");
  assert.ok(/v_invite\.expires_at <= now\(\)/.test(latestSql), "an expired invite must be rejected and marked expired");
  assert.ok(/h\.id = v_invite\.home_id and h\.estate_id = v_invite\.estate_id/.test(latestSql), "the invite must resolve to the correct Home, scoped to its own estate");

  const validateFiles = migrationFiles.filter((name) => {
    const sql = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    return /create or replace function validate_resident_invite/.test(sql);
  }).sort();
  const validateSql = fs.readFileSync(new URL(`../supabase/migrations/${validateFiles[validateFiles.length - 1]}`, import.meta.url), "utf8");
  assert.ok(/Invite not found, expired, revoked, or already accepted/.test(validateSql), "invalid/expired/revoked/claimed must all fail with the same generic message -- never leak which specific condition matched");
}

// 12-13) Successful acceptance creates the correct, scoped Home
// membership -- and the write is scoped to (home_id, user_id), so an
// existing identity's membership on any OTHER home is never touched by
// this activation.
{
  const migrationFiles = fs.readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((n) => n.endsWith(".sql")).sort();
  const definingFiles = migrationFiles.filter((name) => {
    const sql = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    return /create or replace function activate_resident_invite/.test(sql);
  });
  const latestSql = fs.readFileSync(new URL(`../supabase/migrations/${definingFiles[definingFiles.length - 1]}`, import.meta.url), "utf8");

  assert.ok(
    /where hm\.home_id = v_invite\.home_id and hm\.user_id = v_user\.id/.test(latestSql),
    "the home_memberships write must stay scoped to this invite's own home_id, never touching a membership on a different Home"
  );
  assert.ok(
    /values \(v_invite\.home_id, v_user\.id, v_invite\.role, 'active', now\(\)\)/.test(latestSql),
    "a fresh membership must be created with the invitation's own role, for this Home only"
  );
}

// 14) Facility invitation status updates truthfully after acceptance --
// the invites row itself is marked accepted/claimed, which is what
// Facility's own status displays read from.
{
  const migrationFiles = fs.readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((n) => n.endsWith(".sql")).sort();
  const definingFiles = migrationFiles.filter((name) => {
    const sql = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    return /create or replace function activate_resident_invite/.test(sql);
  });
  const latestSql = fs.readFileSync(new URL(`../supabase/migrations/${definingFiles[definingFiles.length - 1]}`, import.meta.url), "utf8");
  assert.ok(/set status = 'accepted',\s*\n\s*claimed_by = v_user\.id,\s*\n\s*claimed_at = now\(\)/.test(latestSql), "the invite row must be truthfully marked accepted/claimed on success");
}

console.log("home-invite-consumer-url-smoke: ALL PASSED");
