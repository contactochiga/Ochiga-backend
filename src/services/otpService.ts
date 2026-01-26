// src/services/otpService.ts
import crypto from "crypto";
import { redis } from "../config/redis";

type Purpose = "signup" | "login";

const OTP_TTL_SECONDS = 10 * 60; // 10 mins
const RATE_LIMIT_SECONDS = 30;   // 1 OTP per 30s per email+purpose

function otpKey(email: string, purpose: Purpose) {
  return `otp:${purpose}:${email}`;
}

function rlKey(email: string, purpose: Purpose) {
  return `otp:rl:${purpose}:${email}`;
}

function hashCode(code: string) {
  const pepper = process.env.OTP_PEPPER || "ochiga-otp-pepper";
  return crypto.createHash("sha256").update(`${pepper}:${code}`).digest("hex");
}

export function generateOtpCode(length = 6) {
  // numeric only
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return crypto.randomInt(min, max).toString();
}

export async function canSendOtp(email: string, purpose: Purpose) {
  // if key exists => too soon
  const key = rlKey(email, purpose);
  const exists = await redis.exists(key);
  if (exists) return false;

  // set rate limit marker
  await redis.set(key, "1", { EX: RATE_LIMIT_SECONDS });
  return true;
}

export async function saveOtp(email: string, purpose: Purpose, code: string) {
  const key = otpKey(email, purpose);
  const hashed = hashCode(code);

  // store hash with expiry
  await redis.set(key, hashed, { EX: OTP_TTL_SECONDS });
}

export async function verifyOtpCode(email: string, purpose: Purpose, code: string) {
  const key = otpKey(email, purpose);
  const stored = await redis.get(key);
  if (!stored) return false;

  const incoming = hashCode(code);
  const ok = stored === incoming;

  if (ok) {
    // one-time use
    await redis.del(key);
  }

  return ok;
}
