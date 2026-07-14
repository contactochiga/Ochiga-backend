// src/services/otpService.ts
import crypto from "crypto";
import { redis } from "../config/redis";

export type OtpPurpose = "signup" | "login" | "password_reset";

const OTP_TTL_SECONDS = 10 * 60; // 10 mins
const RL_TTL_SECONDS = 60; // 60 secs rate limit

// ✅ If client double-submits verify, we still return OK for a short time
const USED_TTL_SECONDS = 30; // 30 secs (enough to avoid double-tap issues)

function otpKey(email: string, purpose: OtpPurpose) {
  return `otp:${purpose}:${email}`;
}

function usedKey(email: string, purpose: OtpPurpose) {
  return `otp:used:${purpose}:${email}`;
}

function rlKey(email: string, purpose: OtpPurpose) {
  return `otp:rl:${purpose}:${email}`;
}

export function generateOtpCode(length = 6) {
  const safeLength = Number.isFinite(length) && length >= 4 ? Math.floor(length) : 6;
  const min = 10 ** (safeLength - 1);
  const max = 10 ** safeLength - 1;
  // Security: use cryptographically-secure RNG so OTP codes are not predictable.
  return String(crypto.randomInt(min, max + 1));
}

export async function canSendOtp(email: string, purpose: OtpPurpose) {
  const key = rlKey(email, purpose);
  const exists = await redis.get(key);
  if (exists) return false;

  await redis.set(key, "1", { EX: RL_TTL_SECONDS });
  return true;
}

export async function saveOtp(email: string, purpose: OtpPurpose, code: string) {
  // overwrite existing OTP if resend
  await redis.set(otpKey(email, purpose), code, { EX: OTP_TTL_SECONDS });

  // clear any "used" marker so the new OTP can be verified
  await redis.del(usedKey(email, purpose));

  // reset the brute-force attempt counter when a fresh OTP is issued
  await redis.del(attemptKey(email, purpose));
}

const OTP_MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS || 6) || 6;
const OTP_ATTEMPT_TTL_SECONDS = OTP_TTL_SECONDS + 60;

function attemptKey(email: string, purpose: OtpPurpose) {
  return `otp:attempts:${purpose}:${email}`;
}

export async function verifyOtp(
  email: string,
  purpose: OtpPurpose,
  code: string
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "locked" }> {
  const key = otpKey(email, purpose);
  const uKey = usedKey(email, purpose);
  const aKey = attemptKey(email, purpose);

  // ✅ If already verified recently (double submit), return OK
  const used = await redis.get(uKey);
  if (used && used === code) return { ok: true };

  // Security: enforce a brute-force attempt cap. Once exceeded, the OTP is
  // locked until it expires or is regenerated, even if the correct code is
  // later supplied.
  const attempts = Number(await redis.get(aKey)) || 0;
  if (attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    return { ok: false, reason: "locked" };
  }

  const saved = await redis.get(key);

  if (!saved) return { ok: false, reason: "expired" };
  if (saved !== code) {
    // Increment the attempt counter with a TTL aligned to OTP lifetime.
    const next = attempts + 1;
    if (attempts === 0) {
      await redis.set(aKey, String(next), { EX: OTP_ATTEMPT_TTL_SECONDS });
    } else {
      await redis.incr(aKey);
    }
    return { ok: false, reason: "invalid" };
  }

  // ✅ Mark as used briefly so a second verify returns OK (idempotent)
  // Then delete the OTP (one-time use) and clear the attempt counter.
  await redis
    .multi()
    .set(uKey, code, { EX: USED_TTL_SECONDS })
    .del(key)
    .del(aKey)
    .exec();

  return { ok: true };
}
