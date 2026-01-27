// src/services/otpService.ts
import { redis } from "../config/redis";

export type OtpPurpose = "signup" | "login";

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
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
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
}

export async function verifyOtp(
  email: string,
  purpose: OtpPurpose,
  code: string
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" }> {
  const key = otpKey(email, purpose);
  const uKey = usedKey(email, purpose);

  // ✅ If already verified recently (double submit), return OK
  const used = await redis.get(uKey);
  if (used && used === code) return { ok: true };

  const saved = await redis.get(key);

  if (!saved) return { ok: false, reason: "expired" };
  if (saved !== code) return { ok: false, reason: "invalid" };

  // ✅ Mark as used briefly so a second verify returns OK (idempotent)
  // Then delete the OTP (one-time use)
  await redis
    .multi()
    .set(uKey, code, { EX: USED_TTL_SECONDS })
    .del(key)
    .exec();

  return { ok: true };
}
