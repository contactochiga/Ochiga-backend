// src/services/otpService.ts
import { redis } from "../config/redis";

export type OtpPurpose = "signup" | "login";

const OTP_TTL_SECONDS = 10 * 60; // 10 mins
const RL_TTL_SECONDS = 60; // 60 secs rate limit

function otpKey(email: string, purpose: OtpPurpose) {
  return `otp:${purpose}:${email}`;
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
  // simple 1-per-minute gate
  const key = rlKey(email, purpose);
  const exists = await redis.get(key);
  if (exists) return false;

  await redis.set(key, "1", { EX: RL_TTL_SECONDS });
  return true;
}

export async function saveOtp(email: string, purpose: OtpPurpose, code: string) {
  await redis.set(otpKey(email, purpose), code, { EX: OTP_TTL_SECONDS });
}

export async function verifyOtp(
  email: string,
  purpose: OtpPurpose,
  code: string
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" }> {
  const key = otpKey(email, purpose);
  const saved = await redis.get(key);

  if (!saved) return { ok: false, reason: "expired" };
  if (saved !== code) return { ok: false, reason: "invalid" };

  await redis.del(key);
  return { ok: true };
}
