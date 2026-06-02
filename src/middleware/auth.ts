// src/middleware/auth.ts
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { UserRole } from "../types/user";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitAuditEvent, hasPermission, permissionsForRole, type PermissionKey } from "../core/foundation";

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
  permissions?: string[];
  permission_scopes?: string[];
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
async function hydrateUserContext(decoded: AuthUser): Promise<AuthUser> {
  if (!decoded?.id) return decoded;

  const { data } = await supabaseAdmin
    .from("users")
    .select("id,email,username,role,estate_id,home_id,permission_scopes")
    .eq("id", decoded.id)
    .maybeSingle();

  if (!data) return decoded;

  const role = ((data as any)?.role || decoded.role) as UserRole;
  const permissionScopes = Array.isArray((data as any)?.permission_scopes)
    ? (data as any).permission_scopes
    : decoded.permission_scopes || [];

  return {
    ...decoded,
    email: (data as any)?.email ?? decoded.email,
    username: (data as any)?.username ?? decoded.username,
    role,
    estate_id: (data as any)?.estate_id === null ? undefined : (data as any)?.estate_id ?? decoded.estate_id,
    home_id: (data as any)?.home_id === null ? undefined : (data as any)?.home_id ?? decoded.home_id,
    permission_scopes: permissionScopes,
    permissions: permissionsForRole(role, permissionScopes),
  };
}

async function verifyToken(req: Request, res: Response): Promise<AuthUser | null> {
  try {
    if (!APP_JWT_SECRET) {
      res
        .status(500)
        .json({ error: "Server misconfigured (APP_JWT_SECRET missing)" });
      return null;
    }

    const token = extractToken(req);
    if (!token) {
      void emitAuditEvent({
        actorId: null,
        actorRole: "guest",
        action: "auth.failed",
        resourceType: "route",
        resourceId: req.path,
        status: "denied",
        metadata: { method: req.method, reason: "missing_token" },
        req,
      });
      res.status(401).json({ error: "Missing token" });
      return null;
    }

    const decoded = jwt.verify(token, APP_JWT_SECRET) as AuthUser;

    // minimal shape check
    if (!decoded?.id || !decoded?.role) {
      void emitAuditEvent({
        actorId: decoded?.id || null,
        actorRole: decoded?.role || "guest",
        action: "auth.failed",
        resourceType: "route",
        resourceId: req.path,
        status: "denied",
        metadata: { method: req.method, reason: "invalid_payload" },
        req,
      });
      res.status(401).json({ error: "Invalid token payload" });
      return null;
    }

    const hydrated = await hydrateUserContext(decoded);
    req.user = hydrated;
    return hydrated;
  } catch (err) {
    console.error("JWT Error:", err);
    void emitAuditEvent({
      actorId: null,
      actorRole: "guest",
      action: "auth.failed",
      resourceType: "route",
      resourceId: req.path,
      status: "denied",
      metadata: { method: req.method, reason: "invalid_or_expired_token" },
      req,
    });
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
}

/* ---------------------------------------------------------
 * REQUIRE AUTH
 * --------------------------------------------------------- */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await verifyToken(req, res);
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
 * ACTION-BASED PERMISSION GUARD
 * --------------------------------------------------------- */
export function requirePermission(permission: PermissionKey | string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      void emitAuditEvent({
        actorId: null,
        actorRole: "guest",
        action: "permission.denied",
        resourceType: "route",
        resourceId: req.path,
        status: "denied",
        metadata: { method: req.method, permission },
        req,
      });
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!hasPermission(user, permission)) {
      void emitAuditEvent({
        actorId: user.id,
        actorRole: user.role,
        actorEmail: user.email,
        action: "permission.denied",
        resourceType: "route",
        resourceId: req.path,
        estateId: user.estate_id,
        status: "denied",
        metadata: { method: req.method, permission, actorEmail: user.email },
        req,
      });
      return res.status(403).json({ error: "Insufficient permissions", permission });
    }
    return next();
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
    if (decoded?.id && decoded?.role) {
      req.user = {
        ...decoded,
        permissions: permissionsForRole(decoded.role, decoded.permission_scopes || []),
      };
    }
  } catch {
    // ignore invalid token
  }

  next();
}
