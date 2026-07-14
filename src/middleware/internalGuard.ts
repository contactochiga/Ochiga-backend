// src/middleware/internalGuard.ts
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { hasPermission } from "../core/foundation";
import { emitAuditEvent } from "../core/foundation";

/**
 * Security: guard for operational/internal endpoints that expose infrastructure
 * details (e.g. /metrics, /health/runtime).
 *
 * Accepts EITHER:
 *   1. A valid ops bearer token matching OYI_OPS_TOKEN (constant-time compare),
 *      intended for scrapers / internal tooling. OR
 *   2. An authenticated platform staff/admin user (office.read permission).
 *
 * The basic /health liveness endpoint stays public; this guard is only applied
 * to endpoints that reveal operational detail beyond a simple up/down signal.
 */
function opsTokenList() {
  return String(process.env.OYI_OPS_TOKEN || process.env.OPS_TOKEN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function secureEqual(a: string, b: string) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function extractBearerToken(req: Request) {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return String(req.headers["x-ops-token"] || "").trim();
}

export function requireInternalAccess(req: Request, res: Response, next: NextFunction) {
  // 1) Static ops token (for Prometheus scrapers / runbooks).
  const presented = extractBearerToken(req);
  const allowed = opsTokenList();
  if (presented && allowed.length && allowed.some((candidate) => secureEqual(candidate, presented))) {
    return next();
  }

  // 2) Authenticated staff/admin (office.read covers ochiga_staff and above).
  const user = (req as any).user;
  if (user?.id && hasPermission(user, "office.read")) {
    return next();
  }

  void emitAuditEvent({
    actorId: user?.id || null,
    actorRole: user?.role || "guest",
    action: "internal.endpoint.denied",
    resourceType: "operational",
    resourceId: req.path,
    status: "denied",
    metadata: { method: req.method, reason: presented ? "invalid_ops_token" : "missing_auth" },
    req,
  } as any);

  return res.status(401).json({ error: "Authentication required for this operational endpoint." });
}
