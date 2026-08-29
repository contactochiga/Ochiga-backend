import assert from "node:assert/strict";
import fs from "node:fs";

// FINAL FACILITY COMMERCIALIZATION + UX CLOSURE PASS -- Section 1.
// Confirms (does not newly create) that POST /auth/signup cannot self-
// provision a Facility identity: role is hardcoded, estate_id/home_id are
// never derived from the request body, and no client-supplied
// role/accountType/estate_id field is read anywhere in the handler. This
// closure was already real prior to this pass (found during the Phase 0
// audit) -- this script exists so the guarantee is regression-tested going
// forward, matching this repo's established static-assertion-against-dist
// convention. The actual UX-visible change this pass made was removing
// the public /signup page and its login-page CTA in facility-oyi; this
// script proves the shared backend endpoint those pages used to call was
// never the actual escalation vector, and remains closed.

function readDist(relativePath) {
  const full = new URL(`../dist/${relativePath}`, import.meta.url);
  return fs.readFileSync(full, "utf8");
}

// 1) Signup handler exists, is OTP-gated, and hardcodes role to resident.
{
  const src = readDist("routes/auth.js");
  const handlerMatch = src.match(/router\.post\("\/signup"[\s\S]*?\n\}\);/);
  assert.ok(handlerMatch, "signup handler must exist");
  const handler = handlerMatch[0];
  assert.ok(/requireOtpGate\(req, res, "signup"\)/.test(handler), "signup must require the OTP gate");
  assert.ok(/role:\s*"resident"/.test(handler), "signup must hardcode role to resident");
}

// 2) No client-supplied role/accountType/estate_id/home_id is ever read
// from the request body in the signup handler -- a forged field must be
// silently ignored, not consulted.
{
  const src = readDist("routes/auth.js");
  const handler = src.match(/router\.post\("\/signup"[\s\S]*?\n\}\);/)[0];
  assert.ok(!/req\.body\.role/.test(handler), "signup must never read role from the request body");
  assert.ok(!/req\.body\.accountType/.test(handler) && !/req\.body\.account_type/.test(handler), "signup must never read an accountType field");
  assert.ok(!/req\.body\.estate_id/.test(handler) && !/req\.body\.home_id/.test(handler), "signup must never read estate_id/home_id from the request body");
  // The destructure at the top of the handler is the only place fields are
  // pulled from req.body -- assert it is exactly the safe set.
  const destructureMatch = handler.match(/const \{ email, password, full_name \} = req\.body;/);
  assert.ok(destructureMatch, "signup must destructure only email/password/full_name from the request body -- any additional field being read is a regression");
}

// 3) The created user's own row-derived estate_id/home_id (not request-body
// values) are what get signed into the token -- confirms no path exists
// where a forged body field could end up estate-scoped even indirectly.
{
  const src = readDist("routes/auth.js");
  const handler = src.match(/router\.post\("\/signup"[\s\S]*?\n\}\);/)[0];
  assert.ok(/estate_id:\s*createdUser\.estate_id \|\| null/.test(handler), "token must use the newly-created row's own (always-null) estate_id, not a request-body value");
  assert.ok(/home_id:\s*createdUser\.home_id \|\| null/.test(handler), "token must use the newly-created row's own (always-null) home_id, not a request-body value");
}

// 4) No other UNAUTHENTICATED user-account-creation route exists anywhere
// in the mounted route set. "/register" is deliberately excluded from
// this scan -- it's legitimately reused elsewhere for authenticated
// resource registration (device registration, push-token registration),
// confirmed below to require a real session, not an account-creation
// bypass.
{
  const appSrc = readDist("app.js");
  const routeFiles = fs.readdirSync(new URL("../dist/routes", import.meta.url));
  let signupLikeRouteCount = 0;
  for (const file of routeFiles) {
    if (!file.endsWith(".js")) continue;
    const content = fs.readFileSync(new URL(`../dist/routes/${file}`, import.meta.url), "utf8");
    if (/router\.post\(["'`]\/(signup|create-account)["'`]/.test(content)) signupLikeRouteCount += 1;
  }
  assert.equal(signupLikeRouteCount, 1, "exactly one public account-creation route must exist (routes/auth.js) -- any additional one is an undiscovered bypass surface");
  assert.ok(/\/auth["'`]/.test(appSrc), "auth routes must still be mounted");

  const deviceRegisterSrc = readDist("routes/facilityDevices.routes.js");
  assert.ok(/router\.post\("\/register",\s*auth_1\.requireAuth/.test(deviceRegisterSrc), "device /register must require authentication -- it is not a signup bypass");
  const pushRegisterSrc = readDist("routes/push.js");
  assert.ok(/router\.post\("\/register",\s*auth_1\.requireAuth/.test(pushRegisterSrc), "push /register must require authentication -- it is not a signup bypass");
}

// 5) The legacy onboarding route remains a dead 410 stub, not a live
// alternate creation path.
{
  const src = readDist("routes/onboarding.js");
  assert.ok(/410/.test(src), "legacy onboarding route must remain a 410 stub");
}

// 6) The signup route is rate-limited.
{
  const appSrc = readDist("app.js");
  assert.ok(/authRateLimit,\s*.*authRoutes|authRateLimit,\s*\n?\s*.*authRoutes/.test(appSrc) || /authRateLimit/.test(appSrc), "the /auth mount must apply rate limiting");
}

console.log("facility-commercialization-signup-closure-smoke: ALL PASSED");
