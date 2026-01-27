// src/middleware/auth.ts
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { UserRole } from "../types/user";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;
if (!APP_JWT_SECRET) {
  console.warn("⚠️ APP_JWT_SECRET is missing in env");
}

/* ---------------------------------------------------------
 * AUTH USER (SINGLE SOURCE OF TRUTH)
 * --------------------------------------------------------- */
export interface AuthUser {
  id: string;
  email?: string;
  username?: string;
  role: UserRole;
  estate_id?: string;
  home_id?: string;
}

/* ---------------------------------------------------------
 * 🔥 EXPRESS DECLARATION MERGING (ONLY PLACE)
 * --------------------------------------------------------- */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/* ---------------------------------------------------------
 * TOKEN EXTRACTION (Bearer / raw / cookie)
 * --------------------------------------------------------- */
function extractToken(req: Request): string | null {
  // 1) Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader) {
    // supports:
    // - "Bearer <token>"
    // - "bearer <token>"
    // - "<token>"
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 1) return parts[0] || null;
    if (parts.length >= 2) return parts[1] || null;
  }

  // 2) Cookie-based token (requires cookie-parser middleware in app.ts)
  const anyReq = req as any;
  const cookieToken =
    anyReq?.cookies?.oyi_facility_token || // ✅ facility cookie
    anyReq?.cookies?.oyi_consumer_token || // ✅ consumer cookie
    anyReq?.cookies?.token ||
    anyReq?.cookies?.access_token ||
    anyReq?.cookies?.jwt ||
    null;

  if (cookieToken && typeof cookieToken === "string") return cookieToken;

  return null;
}

/* ---------------------------------------------------------
 * VERIFY TOKEN
 * --------------------------------------------------------- */
function verifyToken(req: Request, res: Response): AuthUser | null {
  try {
    if (!APP_JWT_SECRET) {
      res
        .status(500)
        .json({ error: "Server misconfigured (APP_JWT_SECRET missing)" });
      return null;
    }

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Missing token" });
      return null;
    }

    const decoded = jwt.verify(token, APP_JWT_SECRET) as AuthUser;

    // minimal shape check
    if (!decoded?.id || !decoded?.role) {
      res.status(401).json({ error: "Invalid token payload" });
      return null;
    }

    req.user = decoded;
    return decoded;
  } catch (err) {
    console.error("JWT Error:", err);
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
}

/* ---------------------------------------------------------
 * REQUIRE AUTH
 * --------------------------------------------------------- */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = verifyToken(req, res);
  if (!user) return;
  next();
}

/* ---------------------------------------------------------
 * LOW-LEVEL ROLE GUARD (ADMIN OVERRIDE)
 * --------------------------------------------------------- */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // 👑 Platform admin override
    if (user.role === "admin") return next();

    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}

/* ---------------------------------------------------------
 * OPTIONAL USER ATTACH (NON-BLOCKING)
 * --------------------------------------------------------- */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!APP_JWT_SECRET) return next();

    const token = extractToken(req);
    if (!token) return next();

    const decoded = jwt.verify(token, APP_JWT_SECRET) as AuthUser;
    if (decoded?.id && decoded?.role) req.user = decoded;
  } catch {
    // ignore invalid token
  }

  next();
}
