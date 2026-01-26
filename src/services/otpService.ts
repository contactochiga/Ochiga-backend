import crypto from "crypto";
import { redis } from "./redisClient";

const ttl = Number(process.env.OTP_TTL_SECONDS || 600);
const cooldown = Number(process.env.OTP_COOLDOWN_SECONDS || 45);
const maxAttempts = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS || 6);

function otpKey(email: string) {
  return `otp:email:${email.toLowerCase()}`;
}
function cooldownKey(email: string) {
  return `otp:cooldown:${email.toLowerCase()}`;
}

function hash(code: string) {
  // fast hash ok for OTP because it's short-lived + attempt-limited
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function generateOtpCode() {
  // 6-digit
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
}

export async function canSendOtp(email: string) {
  const cd = await redis.get(cooldownKey(email));
  return !cd;
}

export async function saveOtp(email: string, code: string) {
  const payload = JSON.stringify({
    hash: hash(code),
    attempts: 0,
    createdAt: Date.now(),
  });

  await redis.set(otpKey(email), payload, "EX", ttl);
  await redis.set(cooldownKey(email), "1", "EX", cooldown);
}

export async function verifyOtp(email: string, code: string) {
  const raw = await redis.get(otpKey(email));
  if (!raw) return { ok: false as const, reason: "expired" as const };

  const data = JSON.parse(raw) as { hash: string; attempts: number; createdAt: number };

  if (data.attempts >= maxAttempts) {
    await redis.del(otpKey(email));
    return { ok: false as const, reason: "too_many_attempts" as const };
  }

  const match = data.hash === hash(code);

  if (!match) {
    data.attempts += 1;
    await redis.set(otpKey(email), JSON.stringify(data), "EX", ttl);
    return { ok: false as const, reason: "invalid" as const };
  }

  await redis.del(otpKey(email));
  return { ok: true as const };
}
