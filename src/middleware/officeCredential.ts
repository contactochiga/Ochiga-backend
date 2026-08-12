import { Request } from "express";
import crypto from "crypto";

/**
 * Shared credential resolution for Backend <-> Office integration
 * endpoints (the /office export/conversation routes and the
 * communications office-public surface). Every call site accepts the
 * same three credential sources, in the same precedence, so the two
 * middlewares that use this can never drift apart again:
 *   1. x-api-key         (legacy header)
 *   2. x-office-api-key  (the Office gateway's own header name — see
 *                         ochiga-office/src/lead-agents/oyi-core-gateway.js)
 *   3. Authorization: Bearer
 */

export function resolveOfficeSyncKey() {
  return process.env.OFFICE_SYNC_API_KEY || process.env.OFFICE_EXPORT_API_KEY || "";
}

export function extractOfficeBearerToken(req: Request) {
  const auth = req.headers.authorization || "";
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function resolveOfficeCredential(req: Request) {
  return String(
    req.headers["x-api-key"] || req.headers["x-office-api-key"] || extractOfficeBearerToken(req) || ""
  ).trim();
}

export function officeCredentialTimingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
