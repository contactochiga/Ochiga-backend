import assert from "node:assert/strict";
import crypto from "node:crypto";

function hashInviteToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function validateActivationPassword(password) {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(password)) return "Password must include a number.";
  return null;
}

assert.equal(hashInviteToken("oyi-test-token"), "67ad377e03edc6692d0633da3016b784b7105e892003562180480eec22da260d");
assert.equal(validateActivationPassword("weak"), "Password must be at least 10 characters.");
assert.equal(validateActivationPassword("alllowercase1"), "Password must include an uppercase letter.");
assert.equal(validateActivationPassword("ALLUPPERCASE1"), "Password must include a lowercase letter.");
assert.equal(validateActivationPassword("ValidPassword1"), null);

console.log("invite-first onboarding static smoke checks passed");
