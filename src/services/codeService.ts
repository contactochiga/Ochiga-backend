// src/services/codeService.ts
import crypto from "crypto";

/**
 * Security: generate a numeric visitor access code using the
 * cryptographically-secure RNG (crypto.randomInt) instead of Math.random(),
 * which is predictable and unsuitable for security-sensitive tokens.
 */
export async function generateAccessCode(length = Number(process.env.VISITOR_CODE_LENGTH || 8)) {
  // numeric code
  const safeLength = Number.isFinite(length) && length >= 4 ? Math.floor(length) : 8;
  const min = Math.pow(10, safeLength - 1);
  const max = Math.pow(10, safeLength) - 1;
  return crypto.randomInt(min, max + 1).toString();
}
