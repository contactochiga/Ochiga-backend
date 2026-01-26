// src/services/otpService.ts
import { redis } from "../config/redis";
import type { OtpPurpose } from "./mailer/resendMailer";

const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const RATE_LIMIT_SECONDS = 60;   // 1 minute between OTP sends per purpose

function otpKey(email: string, purpose: OtpPurpose) {
  return `otp:${purpose}:${email.toLowerCase()}`;
}

function rateKey(email: string, purpose: OtpPurpose) {
  return `otp:rate:${purpose}:${email.toLowerCase()}`;
}

export function generateOtpCode() {
  // 6-digit numeric
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function canSendOtp(email: string, purpose: OtpPurpose) {
  const key = rateKey(email, purpose);
  const exists = await redis.exists(key);
  if (exists) return false;

  // set rate limiter key
  await redis.set(key, "1", { EX: RATE_LIMIT_SECONDS });
  return true;
}

export async function saveOtp(email: string, purpose: OtpPurpose, code: string) {
  const key = otpKey(email, purpose);
  await redis.set(
    key,
    JSON.stringify({
      code,
      purpose,
      createdAt: Date.now(),
    }),
    { EX: OTP_TTL_SECONDS }
  );
  return true;
}

export async function verifyOtp(email: string, purpose: OtpPurpose, code: string) {
  const key = otpKey(email, purpose);
  const raw = await redis.get(key);
  if (!raw) return false;

  const payload = JSON.parse(raw) as { code: string };
  const ok = payload.code === code;

  if (ok) {
    // consume OTP once used
    await redis.del(key);
  }

  return ok;
}
