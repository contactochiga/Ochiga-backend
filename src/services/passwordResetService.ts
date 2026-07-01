import crypto from "crypto";
import jwt from "jsonwebtoken";
import { redis } from "../config/redis";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;
const RESET_TOKEN_TTL_SECONDS = 10 * 60;
const RESET_USED_TTL_SECONDS = 30 * 60;

if (!APP_JWT_SECRET) {
  console.warn("⚠️ APP_JWT_SECRET is missing in .env");
}

function activeResetKey(jti: string) {
  return `password_reset:active:${jti}`;
}

function usedResetKey(jti: string) {
  return `password_reset:used:${jti}`;
}

export function signPasswordResetToken(email: string) {
  if (!APP_JWT_SECRET) throw new Error("APP_JWT_SECRET not set");
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { typ: "password_reset", email, jti },
    APP_JWT_SECRET,
    { expiresIn: `${RESET_TOKEN_TTL_SECONDS}s` }
  );
  return { token, jti };
}

export async function storePasswordResetToken(email: string, jti: string) {
  await redis.set(activeResetKey(jti), email, { EX: RESET_TOKEN_TTL_SECONDS });
}

export async function consumePasswordResetToken(email: string, token: string) {
  if (!APP_JWT_SECRET) throw new Error("APP_JWT_SECRET not set");

  let decoded: any;
  try {
    decoded = jwt.verify(token, APP_JWT_SECRET);
  } catch {
    return { ok: false as const, reason: "expired" as const };
  }

  if (decoded?.typ !== "password_reset" || !decoded?.email || !decoded?.jti) {
    return { ok: false as const, reason: "invalid" as const };
  }

  if (String(decoded.email).trim().toLowerCase() !== email) {
    return { ok: false as const, reason: "invalid" as const };
  }

  const activeKey = activeResetKey(String(decoded.jti));
  const usedKey = usedResetKey(String(decoded.jti));
  const [active, used] = await Promise.all([redis.get(activeKey), redis.get(usedKey)]);

  if (used) {
    return { ok: false as const, reason: "used" as const };
  }

  if (!active || active !== email) {
    return { ok: false as const, reason: "expired" as const };
  }

  await redis
    .multi()
    .set(usedKey, email, { EX: RESET_USED_TTL_SECONDS })
    .del(activeKey)
    .exec();

  return {
    ok: true as const,
    jti: String(decoded.jti),
  };
}
